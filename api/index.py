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
from fastapi import FastAPI, HTTPException, Depends, Header, Cookie, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv(os.path.join(BASE_DIR, "server", ".env"), override=True)

app = FastAPI(title="civik.link API", version="2.0.0")

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

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Database Setup ──────────────────────────────────────────────────────────

# Database configuration
# On Vercel, we prefer PostgreSQL (Supabase). Locally, we use SQLite.
DB_URL = os.getenv("DATABASE_URL") # For Supabase/Postgres

def get_db():
    if DB_URL:
        # If user has set up Supabase/Postgres
        import psycopg2
        from psycopg2.extras import RealDictCursor
        conn = psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)
        return conn
    
    # Fallback to SQLite (Note: Vercel is read-only, so this will be temporary per session)
    db_path = os.path.join(BASE_DIR, "civik.db")
    # If on Vercel and file doesn't exist, use memory for zero-crash demo
    if not os.path.exists(db_path) and os.getenv("VERCEL"):
        conn = sqlite3.connect(":memory:", check_same_thread=False)
    else:
        conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    # Use standard SQL that works on both SQLite and Postgres
    queries = [
        """CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            udid TEXT,
            profile_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS health_data (
            phone       TEXT PRIMARY KEY,
            health_json TEXT NOT NULL DEFAULT '{}',
            updated_at  REAL NOT NULL
        )"""
    ]
    # For Postgres, AUTOINCREMENT is SERIAL
    if DB_URL:
        pass # Adjustments for specific schemas if needed
        
    c = conn.cursor()
    for q in queries:
        c.execute(q)
    conn.commit()
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
    if current and now - current["sent_at"] < OTP_RESEND_SECONDS:
        wait = int(OTP_RESEND_SECONDS - (now - current["sent_at"]))
        raise HTTPException(status_code=429, detail=f"Please wait {wait}s before requesting another OTP")

    otp = f"{secrets.randbelow(1_000_000):06d}"
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
    if not secrets.compare_digest(record["otp_hash"], otp_hash):
        raise HTTPException(status_code=401, detail="Invalid OTP")

    OTP_STORE.pop(identifier, None)

def send_otp(email: str, otp: str) -> str:
    """Send OTP via Brevo API (HTTPS — bypasses Render port blocks)."""
    brevo_key = os.getenv("BREVO_API_KEY")

    if brevo_key:
        try:
            resp = requests.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={
                    "api-key": brevo_key,
                    "Content-Type": "application/json",
                },
                json={
                    "sender": {"name": "civik.link", "email": "onboarding@brevo.com"},
                    "to": [{"email": email}],
                    "subject": f"{otp} is your civik.link verification code",
                    "textContent": f"Hi,\n\nYour civik.link verification code is: {otp}\n\nThis code expires in 5 minutes.\n\n— The civik.link Team"
                },
                timeout=15,
            )
            if resp.status_code in (200, 201, 202):
                return "email"
            print(f"[AUTH] Brevo error {resp.status_code}: {resp.text}")
            raise HTTPException(status_code=502, detail="Email service error")
        except Exception as e:
            print(f"[AUTH] Brevo exception: {e}")
            raise HTTPException(status_code=502, detail="Could not send verification email")

    # Fallback for local testing (No email sent, just printed to console)
    if os.getenv("APP_ENV") != "production":
        print(f"[AUTH] ⚡ DEV MODE — OTP for {email}: {otp}")
        return "console"
    
    raise HTTPException(status_code=500, detail="Email service not configured")

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
async def request_otp(req: OtpRequest):
    email = normalize_email(req.email)
    otp = issue_otp(email)
    delivery = send_otp(email, otp)
    return {"success": True, "expires_in": OTP_TTL_SECONDS, "delivery": delivery}

@app.post("/api/auth/verify-otp")
async def verify_otp(req: OtpVerifyRequest, response: Response):
    email = normalize_email(req.email)
    consume_otp(email, req.otp)
    udid = get_or_create_user(email)
    token = create_access_token({"sub": email, "role": "citizen"})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
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
async def save_profile(req: ProfileSaveRequest, user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    row   = conn.execute("SELECT profile_json FROM users WHERE phone=?", (phone,)).fetchone()
    existing = json.loads(row["profile_json"]) if row else {}
    merged   = {**existing, **req.profile, "email": phone}
    conn.execute("UPDATE users SET profile_json=? WHERE phone=?", (json.dumps(merged), phone))
    conn.commit()
    conn.close()
    print(f"[DB] Profile saved: {phone}")
    return {"success": True, "profile": merged}

# ── Health Data Routes ──────────────────────────────────────────────────────

@app.get("/api/health-data")
async def get_health(user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    row   = conn.execute("SELECT health_json FROM health_data WHERE phone=?", (phone,)).fetchone()
    conn.close()
    return {"health": json.loads(row["health_json"]) if row else None}

@app.post("/api/health-data")
async def save_health(req: HealthSaveRequest, user=Depends(verify_token)):
    phone = user["sub"]
    conn  = get_db()
    exists = conn.execute("SELECT phone FROM health_data WHERE phone=?", (phone,)).fetchone()
    if exists:
        conn.execute("UPDATE health_data SET health_json=?, updated_at=? WHERE phone=?",
                     (json.dumps(req.health), time.time(), phone))
    else:
        conn.execute("INSERT INTO health_data (phone, health_json, updated_at) VALUES (?,?,?)",
                     (phone, json.dumps(req.health), time.time()))
    conn.commit()
    conn.close()
    print(f"[DB] Health saved: {phone}")
    return {"success": True}

# ── AI Chat Route ───────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(req: ChatRequest, user=Depends(verify_token)):
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": f"You are civik Assistant, a helpful AI for Indian citizens. Context: {req.context}"},
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

CLIENT_DIR = os.path.join(BASE_DIR, "client")

from fastapi.responses import FileResponse, JSONResponse, Response as FastAPIResponse
from fastapi.staticfiles import StaticFiles

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    favicon_path = os.path.join(CLIENT_DIR, "favicon.ico")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path)
    return FastAPIResponse(status_code=204)

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
    print("\n[START] civik.link Backend v2.0 — http://localhost:8000")
    print(f"[DB]    Database: {DB_PATH}")
    print("[API]   /api/auth/request-otp  /api/auth/verify-otp  /api/profile  /api/health-data  /api/chat\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
