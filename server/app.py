"""
civik.link - Production Backend (Python/FastAPI)
Stability Level: Final Presentation Ready
"""
import os
import time
import json
import sqlite3
import hashlib
import secrets
import smtplib
import jwt
import requests
from email.message import EmailMessage
from fastapi import FastAPI, HTTPException, Depends, Header, Cookie, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel
from dotenv import load_dotenv
import asyncio
try:
    from bleak import BleakScanner, BleakClient
    HAS_BLUETOOTH = True
except ImportError:
    HAS_BLUETOOTH = False
    logger.warning("Bleak not installed. Bluetooth features will be disabled.")
except Exception as e:
    HAS_BLUETOOTH = False
    logger.warning(f"Bluetooth initialization failed: {e}")

# Load environment variables
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, "server", ".env"), override=True)

import logging
# Configure logging
LOG_FILE = os.path.join(BASE_DIR, "server.log")
file_handler = logging.FileHandler(LOG_FILE, encoding='utf-8')
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

logging.basicConfig(
    level=logging.INFO,
    handlers=[
        file_handler,
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("civik")
logger.setLevel(logging.INFO)

CLIENT_DIR = os.path.join(BASE_DIR, "client")

app = FastAPI(title="civik.link API", version="2.0.0")

@app.get("/debug-fs", include_in_schema=False)
async def debug_fs():
    return {
        "cwd": os.getcwd(),
        "base_dir": BASE_DIR,
        "client_dir": CLIENT_DIR,
        "client_exists": os.path.exists(CLIENT_DIR),
        "client_contents": os.listdir(CLIENT_DIR) if os.path.exists(CLIENT_DIR) else None,
        "root_contents": os.listdir(BASE_DIR)
    }

# Security
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    if os.getenv("APP_ENV") == "production":
        raise RuntimeError("JWT_SECRET must be set in production")
    SECRET_KEY = secrets.token_urlsafe(32)
    print("[WARN] JWT_SECRET not set. Using a temporary development secret.")
ALGORITHM    = "HS256"
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
APP_ENV = os.getenv("APP_ENV", "development")
COOKIE_SECURE = APP_ENV == "production"
COOKIE_MAX_AGE = 7 * 24 * 3600
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,https://civik.link,https://www.civik.link").split(",")
    if origin.strip()
]
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM") or SMTP_USERNAME
OTP_TTL_SECONDS = 5 * 60
OTP_RESEND_SECONDS = 30
MAX_OTP_ATTEMPTS = 5
OTP_STORE = {}
HARDWARE_SYNC_INTERVAL = 2 * 3600 # 2 hours
ACTIVE_DEVICES = {} # email -> bluetooth_address (In-memory for session)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    logger.info(f"{request.method} {request.url.path} - {response.status_code} ({duration:.2f}s)")
    return response

# ── Database Setup ──────────────────────────────────────────────────────────
# On Render, we use /data/civik.db for persistence
DB_PATH = os.getenv("DATABASE_URL", os.path.join(BASE_DIR, "civik.db"))
# Ensure directory exists if path is modified
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_db():
    # check_same_thread=False is needed for multi-worker uvicorn
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # PROFESSIONAL CONCURRENCY OPTIMIZATIONS
    conn.execute("PRAGMA journal_mode=WAL")      # Concurrent reads/writes
    conn.execute("PRAGMA synchronous=NORMAL")    # Performance vs Reliability trade-off
    conn.execute("PRAGMA busy_timeout=30000")    # Wait 30s instead of crashing on 'locked'
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            phone        TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL DEFAULT '{}',
            hardware_address TEXT,
            created_at   REAL NOT NULL
        )
    """)
    try:
        conn.execute("ALTER TABLE users ADD COLUMN hardware_address TEXT")
    except:
        pass # Column already exists
    c.execute("""
        CREATE TABLE IF NOT EXISTS health_data (
            phone       TEXT PRIMARY KEY,
            health_json TEXT NOT NULL DEFAULT '{}',
            updated_at  REAL NOT NULL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            phone       TEXT NOT NULL,
            title       TEXT NOT NULL,
            message     TEXT NOT NULL,
            type        TEXT DEFAULT 'info',
            is_read     INTEGER DEFAULT 0,
            created_at  REAL NOT NULL
        )
    """)
def save_health_background(phone: str, health_json: str):
    conn = get_db()
    try:
        now = time.time()
        conn.execute(
            "INSERT OR REPLACE INTO health_data (phone, health_json, updated_at) VALUES (?, ?, ?)",
            (phone, health_json, now)
        )
        conn.commit()
    except Exception as e:
        print(f"[BG-ERROR] Health Save: {e}")
    finally:
        conn.close()

def save_profile_background(phone: str, profile_json: str):
    conn = get_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO users (phone, profile_json, created_at) VALUES (?, ?, ?)",
            (phone, profile_json, time.time())
        )
        conn.commit()
    except Exception as e:
        print(f"[BG-ERROR] Profile Save: {e}")
    finally:
        conn.close()

init_db()

# ── Pydantic Models ─────────────────────────────────────────────────────────

class OtpRequest(BaseModel):
    email: str

class OtpVerifyRequest(BaseModel):
    email: str
    otp: str

class ChatRequest(BaseModel):
    message: str
    context: dict
    language: str = "en"

class ProfileSaveRequest(BaseModel):
    profile: dict

class HealthSaveRequest(BaseModel):
    health: dict

# ── Auth Helpers ────────────────────────────────────────────────────────────

def normalize_email(email: str) -> str:
    cleaned = email.strip().lower()
    if "@" not in cleaned or "." not in cleaned.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Valid email address is required")
    return cleaned

def generate_udid(identifier: str) -> str:
    """Generate a deterministic UDID from the login identifier.
    Format: CVLK-XXXX-XXXX (e.g. CVLK-A3F9-2B7E)
    """
    h = hashlib.sha256(identifier.encode()).hexdigest().upper()
    return f"CVLK-{h[0:4]}-{h[4:8]}"

def create_access_token(data: dict):
    payload = data.copy()
    payload["exp"] = time.time() + (7 * 24 * 3600)  # 7 days
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

async def verify_token(
    authorization: str = Header(None),
    access_token: str = Cookie(None),
):
    token = access_token
    if authorization:
        try:
            scheme, header_token = authorization.split(" ", 1)
            if scheme.lower() == "bearer" and header_token:
                token = header_token
        except ValueError:
            pass

    if not token:
        raise HTTPException(status_code=401, detail="Missing auth cookie")
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def issue_otp(identifier: str) -> str:
    now = time.time()
    current = OTP_STORE.get(identifier)
    if current and now - current["sent_at"] < OTP_RESEND_SECONDS and os.getenv("STRESS_TEST") != "true":
        wait = int(OTP_RESEND_SECONDS - (now - current["sent_at"]))
        raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting another OTP")

    # EMERGENCY PRESENTATION OVERRIDE: 
    # Always use 123456 for every user
    otp = "123456"
    OTP_STORE[identifier] = {
        "otp_hash": hashlib.sha256(otp.encode()).hexdigest(),
        "expires_at": now + OTP_TTL_SECONDS,
        "sent_at": now,
        "attempts": 0,
    }
    return otp

def consume_otp(identifier: str, otp: str):
    record = OTP_STORE.get(identifier)
    if not record:
        raise HTTPException(status_code=401, detail="OTP not requested or expired")
    if time.time() > record["expires_at"]:
        OTP_STORE.pop(identifier, None)
        raise HTTPException(status_code=401, detail="OTP expired")
    if record["attempts"] >= MAX_OTP_ATTEMPTS:
        OTP_STORE.pop(identifier, None)
        raise HTTPException(status_code=429, detail="Too many OTP attempts")

    record["attempts"] += 1
    otp_hash = hashlib.sha256(otp.strip().encode()).hexdigest()
    
    # Stress Test & Developer Backdoor
    if (os.getenv("STRESS_TEST") == "true" and otp.strip() == "999999") or \
       (identifier == "demo@civik.link" and otp.strip() == "123456"):
        OTP_STORE.pop(identifier, None)
        return

    if not secrets.compare_digest(record["otp_hash"], otp_hash):
        raise HTTPException(status_code=401, detail="Invalid OTP")

    OTP_STORE.pop(identifier, None)

def send_otp(email: str, otp: str) -> str:
    """Send OTP via SMTP (Gmail) — Hardened for Cloud Deployment."""
    logger.info(f"==== ATTEMPTING OTP EMAIL FOR {email} ====")
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 465))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_pass = os.getenv("SMTP_PASSWORD")

    if os.getenv("STRESS_TEST") == "true":
        return "stress_test"

    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart()
            msg['From'] = os.getenv("SMTP_FROM", smtp_user)
            msg['To'] = email
            msg['Subject'] = f"{otp} is your civik.link verification code"
            
            body = f"Hi,\n\nYour civik.link verification code is: {otp}\n\nThis code expires in 5 minutes.\n\n— The civik.link Team"
            msg.attach(MIMEText(body, 'plain'))

            # Use SSL for port 465, STARTTLS for others
            if smtp_port == 465:
                server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
            else:
                server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
                server.starttls()
            
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
            server.quit()
            logger.info(f"==== OTP SUCCESSFULLY SENT TO {email} ====")
            return "email"
        except Exception as e:
            logger.error(f"==== SMTP ERROR FOR {email}: {e} ====")
    
    logger.warning(f"==== SMTP FAILED OR UNCONFIGURED - OTP for {email}: {otp} ====")
    return "console"

def get_or_create_user(identifier: str) -> str:
    conn = get_db()
    c = conn.cursor()
    udid = generate_udid(identifier)
    existing = c.execute("SELECT phone, profile_json FROM users WHERE phone=?", (identifier,)).fetchone()
    if not existing:
        default = json.dumps({
            "name": "New User", "email": identifier, "phone": "",
            "udid": udid,
            "profile_completed": False, "preferences": {}
        })
        c.execute("INSERT INTO users (phone, profile_json, created_at) VALUES (?,?,?)",
                  (identifier, default, time.time()))
        conn.commit()
        print(f"[DB] New user: {identifier} | UDID: {udid}")
    else:
        profile = json.loads(existing["profile_json"])
        if not profile.get("email"):
            profile["email"] = identifier
        if not profile.get("udid"):
            profile["udid"] = udid
        c.execute("UPDATE users SET profile_json=? WHERE phone=?",
                  (json.dumps(profile), identifier))
        conn.commit()
        print(f"[DB] Backfilled profile auth fields for: {identifier} | UDID: {udid}")
    conn.close()
    return udid

# ── Auth Routes ─────────────────────────────────────────────────────────────

@app.post("/api/auth/request-otp")
async def request_otp(req: OtpRequest, background_tasks: BackgroundTasks):
    # email = normalize_email(req.email)
    # otp = issue_otp(email)
    # Background delivery disabled for presentation
    # background_tasks.add_task(send_otp, email, otp)
    return {"success": True, "expires_in": OTP_TTL_SECONDS, "delivery": "bypass"}

@app.post("/api/auth/verify-otp")
async def verify_otp(req: OtpVerifyRequest, response: Response):
    email = normalize_email(req.email)
    # EMERGENCY OVERRIDE: Accept 123456 for any account
    if req.otp.strip() != "123456":
        try:
            consume_otp(email, req.otp)
        except:
            raise HTTPException(status_code=401, detail="Invalid OTP. Hint: Use 123456")
    udid = get_or_create_user(email)
    token = create_access_token({"sub": email, "role": "citizen"})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {"success": True, "token_type": "cookie", "udid": udid}

@app.get("/api/auth/session")
async def session(user=Depends(verify_token)):
    return {"authenticated": True, "sub": user["sub"]}

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"success": True}

# ── Hardware Sync Logic ─────────────────────────────────────────────────────

from bleak import BleakClient, BleakScanner
import asyncio
import logging

logger = logging.getLogger("civik")

async def sync_device_data(email: str, address: str):
    """Attempt to connect to a BLE device and fetch heart rate."""
    logger.info(f"Attempting hardware sync for {email} at {address}")
    try:
        async with BleakClient(address, timeout=10.0) as client:
            if not client.is_connected:
                return None
            
            # Standard Heart Rate Service UUID
            HR_CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
            
            # Read heart rate (this is a simplified example, usually you'd notify)
            # For a quick sync, we try to read or wait for 1 value
            hr_value = 0
            
            def hr_handler(sender, data):
                nonlocal hr_value
                hr_value = data[1]
            
            await client.start_notify(HR_CHAR_UUID, hr_handler)
            await asyncio.sleep(2.0) # Wait for a reading
            await client.stop_notify(HR_CHAR_UUID)
            
            if hr_value > 0:
                # Save to DB
                conn = get_db()
                health_data_obj = {
                    "vitals": {
                        "heart_rate": {"value": hr_value, "unit": "bpm"},
                        "synced_at": time.time(),
                        "source": "Hardware (Python-Bleak)"
                    }
                }
                health_json = json.dumps(health_data_obj)
                
                # Corrected query matching init_db schema
                conn.execute(
                    "INSERT OR REPLACE INTO health_data (phone, health_json, updated_at) VALUES (?, ?, ?)",
                    (email, health_json, time.time())
                )
                conn.commit()
                
                # Trigger AI Analysis
                asyncio.create_task(process_ai_health_alert(email, health_data_obj))
                
                conn.close()
                logger.info(f"Successfully synced hardware HR: {hr_value} for {email}")
                return hr_value
    except Exception as e:
        logger.error(f"Hardware sync error for {email}: {e}")
    return None

async def process_ai_health_alert(email: str, health_data: dict):
    """Analyze health data using AI and create a notification if needed."""
    if not GROQ_API_KEY:
        logger.warning("AI Analysis skipped - GROQ_API_KEY missing")
        return

    try:
        # Get user profile for context
        conn = get_db()
        user_row = conn.execute("SELECT profile_json FROM users WHERE phone=?", (email,)).fetchone()
        profile = json.loads(user_row["profile_json"]) if user_row else {}
        conn.close()

        hr = health_data.get("vitals", {}).get("heart_rate", {}).get("value", 0)
        
        prompt = f"""
        Analyze this health data for {profile.get('name', 'User')}:
        Current Heart Rate: {hr} bpm.
        User Age: {profile.get('age', 'Unknown')}
        Health Conditions: {', '.join(profile.get('medical_conditions', [])) or 'None reported'}

        Based on this, generate a short, helpful health tip or alert.
        If the heart rate is abnormal for their age/conditions, make it a 'warning'.
        Otherwise, provide a positive reinforcement or lifestyle tip as 'info'.

        Response must be valid JSON:
        {{
          "title": "Short title",
          "message": "The advice here",
          "type": "info" or "warning"
        }}
        """

        res = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "system", "content": "You are a helpful health monitor AI."}, {"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            },
            timeout=15.0
        )
        
        if res.ok:
            suggestion = res.json()["choices"][0]["message"]["content"]
            data = json.loads(suggestion)
            
            # Save as notification
            conn = get_db()
            conn.execute(
                "INSERT INTO notifications (phone, title, message, type, created_at) VALUES (?, ?, ?, ?, ?)",
                (email, data["title"], data["message"], data["type"], time.time())
            )
            conn.commit()
            conn.close()
            logger.info(f"AI Alert generated for {email}: {data['title']}")

    except Exception as e:
        logger.error(f"AI Analysis failed for {email}: {e}")

async def background_hardware_worker():
    """Background loop to refresh hardware data every 2 hours."""
    logger.info("Starting background hardware refresh worker...")
    while True:
        await asyncio.sleep(HARDWARE_SYNC_INTERVAL)
        
        try:
            conn = get_db()
            users = conn.execute("SELECT phone, hardware_address FROM users WHERE hardware_address IS NOT NULL").fetchall()
            conn.close()
            
            logger.info(f"Running periodic hardware sync for {len(users)} devices...")
            for u in users:
                await sync_device_data(u['phone'], u['hardware_address'])
        except Exception as e:
            logger.error(f"Background worker error: {e}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(background_hardware_worker())

@app.post("/api/hardware/discover")
async def discover_hardware(user=Depends(verify_token)):
    """Scan for nearby health sensors."""
    if not HAS_BLUETOOTH:
        return {"devices": [], "status": "Bluetooth unavailable on this server"}
    try:
        devices = await BleakScanner.discover(timeout=5.0)
        # Filter for devices that look like health sensors or have names
        found = []
        for d in devices:
            if d.name:
                found.append({"name": d.name, "address": d.address})
        return {"devices": found}
    except Exception as e:
        logger.error(f"Hardware discovery error: {e}")
        return {"devices": [], "error": str(e)}

@app.post("/api/hardware/sync")
async def manual_hardware_sync(req: dict, user=Depends(verify_token)):
    """Manually trigger a sync for a specific device."""
    identifier = user["sub"] # Using 'sub' from JWT
    address = req.get("address")
    if not address:
        raise HTTPException(status_code=400, detail="Device address required")
    
    val = await sync_device_data(identifier, address)
    if val:
        # Persist address in DB for auto-refresh
        conn = get_db()
        conn.execute("UPDATE users SET hardware_address = ? WHERE phone = ?", (address, identifier))
        conn.commit()
        conn.close()
        return {"status": "success", "heart_rate": val}
    else:
        raise HTTPException(status_code=400, detail="Could not connect to device or fetch data")

# ── Profile Routes ──────────────────────────────────────────────────────────

@app.get("/api/profile")
async def get_profile(user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    row   = conn.execute("SELECT profile_json FROM users WHERE phone=?", (phone,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"profile": json.loads(row["profile_json"])}

@app.post("/api/profile")
async def save_profile(req: ProfileSaveRequest, background_tasks: BackgroundTasks, user=Depends(verify_token)):
    phone = user["sub"]
    # Ensure we don't lose the UDID
    udid = generate_udid(phone)
    profile_data = {**req.profile, "email": phone, "udid": udid}
    profile_json = json.dumps(profile_data)
    background_tasks.add_task(save_profile_background, phone, profile_json)
    return {"success": True}

# ── Health Data Routes ──────────────────────────────────────────────────────

@app.get("/api/health-data")
async def get_health(user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    row   = conn.execute("SELECT health_json FROM health_data WHERE phone=?", (phone,)).fetchone()
    conn.close()
    return {"health": json.loads(row["health_json"]) if row else None}

@app.get("/api/notifications")
async def get_notifications(user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    rows  = conn.execute(
        "SELECT id, title, message, type, is_read, created_at FROM notifications WHERE phone=? ORDER BY created_at DESC LIMIT 20",
        (phone,)
    ).fetchall()
    conn.close()
    return {"notifications": [dict(r) for r in rows]}

@app.post("/api/health-data")
async def save_health(req: HealthSaveRequest, background_tasks: BackgroundTasks, user=Depends(verify_token)):
    phone = user["sub"]
    health_json = json.dumps(req.health)
    background_tasks.add_task(save_health_background, phone, health_json)
    return {"success": True}

# ── AI Chat Route ───────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(req: ChatRequest, user=Depends(verify_token)):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {
                "role": "system", 
                "content": f"You are civik Assistant, a helpful AI for Indian citizens. Context: {req.context}. "
                           f"IMPORTANT: Respond ONLY in the following language: {req.language}. "
                           f"If the language is one of the 22 official Indian languages, ensure the tone is respectful and culturally appropriate."
            },
            {"role": "user",   "content": req.message}
        ],
        "temperature": 0.5
    }
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY.strip()}", "Content-Type": "application/json"},
            json=payload, timeout=15
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"AI Error: {resp.text}")
        return {"reply": resp.json()["choices"][0]["message"]["content"].strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI Connection Error: {str(e)}")

# ── SPA Catch-All + Favicon (must be before static mount) ───────────────────

from fastapi.responses import FileResponse, JSONResponse, Response as FastAPIResponse
from fastapi.staticfiles import StaticFiles

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    favicon_path = os.path.join(CLIENT_DIR, "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    return FastAPIResponse(status_code=204)

@app.get("/robots.txt", include_in_schema=False)
async def robots():
    robots_path = os.path.join(CLIENT_DIR, "robots.txt")
    if os.path.exists(robots_path):
        return FileResponse(robots_path)
    return FastAPIResponse(status_code=404)

@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap():
    sitemap_path = os.path.join(CLIENT_DIR, "sitemap.xml")
    if os.path.exists(sitemap_path):
        return FileResponse(sitemap_path, media_type="application/xml")
    return FastAPIResponse(status_code=404)

@app.get("/google406d89371bbd8320.html", include_in_schema=False)
async def google_verification():
    v_path = os.path.join(CLIENT_DIR, "google406d89371bbd8320.html")
    if os.path.exists(v_path):
        return FileResponse(v_path)
    return FastAPIResponse(status_code=404)

@app.exception_handler(404)
async def custom_404_handler(request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    index_path = os.path.join(CLIENT_DIR, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    return JSONResponse({"detail": "SPA index.html Not Found"}, status_code=404)

app.mount("/", StaticFiles(directory=CLIENT_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("\n[START] civik.link Backend v2.0 - http://localhost:8000")
    print(f"[DB]    Database: {DB_PATH}")
    print("[API]   /api/auth/request-otp  /api/auth/verify-otp  /api/profile  /api/health-data  /api/chat\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
