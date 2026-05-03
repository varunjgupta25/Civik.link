"""
civik.link — Database Inspector
Run: python check_db.py
"""
import sqlite3, json, os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "civik.db")

if not os.path.exists(DB_PATH):
    print("❌ civik.db NOT FOUND — restart the server first!")
    exit()

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

print(f"\n{'='*55}")
print(f"  civik.link Database Inspector")
print(f"  File: {DB_PATH}")
print(f"{'='*55}\n")

# ── Users ──────────────────────────────────────────────
users = conn.execute("SELECT * FROM users").fetchall()
print(f"👥 USERS ({len(users)} registered)\n")
if not users:
    print("   (No users yet — login to the app first!)\n")
for u in users:
    profile = json.loads(u["profile_json"])
    print(f"  📱 Phone  : {u['phone']}")
    print(f"     Name   : {profile.get('name', '—')}")
    print(f"     Profile: {'✅ Complete' if profile.get('profile_completed') else '⏳ Incomplete'}")
    print()

# ── Health Data ────────────────────────────────────────
health_rows = conn.execute("SELECT * FROM health_data").fetchall()
print(f"🏥 HEALTH DATA ({len(health_rows)} records)\n")
if not health_rows:
    print("   (No health data yet — fill in your health profile!)\n")
for h in health_rows:
    data = json.loads(h["health_json"])
    print(f"  📱 Phone  : {h['phone']}")
    print(f"     Score  : {data.get('health_score', {}).get('value', '—')}")
    meds = data.get('medications', [])
    print(f"     Meds   : {len(meds)} medication(s) on record")
    print()

print(f"{'='*55}")
print("✅ Database check complete!\n")
conn.close()
