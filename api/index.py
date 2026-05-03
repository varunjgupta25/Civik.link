import os
import json
import sqlite3
import hashlib
import secrets
import jwt
import requests
from fastapi import FastAPI, HTTPException, Depends, Header, Cookie, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Vercel handles env vars natively, but we load for local
load_dotenv()

app = FastAPI(title="civik.link API", version="2.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Config
SECRET_KEY = os.getenv("JWT_SECRET", "temporary-secret-for-demo")
BREVO_API_KEY = os.getenv("BREVO_API_KEY")
DB_URL = os.getenv("DATABASE_URL")

# --- DB HELPERS ---
def get_db():
    if DB_URL:
        try:
            import psycopg2
            from psycopg2.extras import RealDictCursor
            return psycopg2.connect(DB_URL, cursor_factory=RealDictCursor)
        except ImportError:
            print("[ERROR] psycopg2 not found, falling back to memory")
    
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

# --- EMAIL HELPERS ---
def send_otp(email: str, otp: str):
    if not BREVO_API_KEY:
        print(f"[AUTH] No API Key. OTP for {email}: {otp}")
        return "console"
    
    resp = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
        json={
            "sender": {"name": "civik.link", "email": "onboarding@brevo.com"},
            "to": [{"email": email}],
            "subject": f"{otp} is your verification code",
            "textContent": f"Your code is: {otp}"
        },
        timeout=10
    )
    return "email" if resp.status_code < 300 else "error"

# --- ROUTES ---
@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "vercel"}

@app.post("/api/auth/request-otp")
async def request_otp(req: dict):
    email = req.get("email", "").lower().strip()
    otp = str(secrets.randbelow(900000) + 100000)
    # In a real app, store this in Redis/DB. For demo, we just pretend.
    delivery = send_otp(email, otp)
    return {"success": True, "delivery": delivery, "msg": "Real code sent!"}

# Export for Vercel
app = app
