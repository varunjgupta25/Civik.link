"""
Quick script to view all users in the civik.link database.
Run from the project root: python view_users.py
"""
import sqlite3, json, os, datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "civik.db")

if not os.path.exists(DB_PATH):
    print(f"[ERROR] Database not found at: {DB_PATH}")
    print("Start the server first so it can create civik.db")
    exit(1)

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

# ── Users Table ──────────────────────────────────────────────────────────────
users = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
print(f"\n{'='*60}")
print(f"  USERS TABLE  ({len(users)} record(s))")
print(f"{'='*60}")

for i, row in enumerate(users, 1):
    profile = json.loads(row["profile_json"])
    created = datetime.datetime.fromtimestamp(row["created_at"]).strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n  [{i}] {row['phone']}")
    print(f"      Created : {created}")
    print(f"      Name    : {profile.get('name', 'N/A')}")
    print(f"      Email   : {profile.get('email', 'N/A')}")
    print(f"      UDID    : {profile.get('udid', 'N/A')}")
    print(f"      Onboard : {'[YES] Complete' if profile.get('profile_completed') else '[NO]  Incomplete'}")
    print(f"      Full Profile JSON:")
    print(f"      {json.dumps(profile, indent=8)}")

# ── Health Data Table ────────────────────────────────────────────────────────
health_rows = conn.execute("SELECT * FROM health_data ORDER BY updated_at DESC").fetchall()
print(f"\n{'='*60}")
print(f"  HEALTH_DATA TABLE  ({len(health_rows)} record(s))")
print(f"{'='*60}")

for i, row in enumerate(health_rows, 1):
    health = json.loads(row["health_json"])
    updated = datetime.datetime.fromtimestamp(row["updated_at"]).strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n  [{i}] {row['phone']}")
    print(f"      Last Updated: {updated}")
    print(f"      Health Data : {json.dumps(health, indent=8)}")

conn.close()
print(f"\n{'='*60}\n")
