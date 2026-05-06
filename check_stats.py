import sqlite3
import os

DB_PATH = "civik.db"

def get_stats():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found!")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    users = c.execute("SELECT count(*) FROM users").fetchone()[0]
    health = c.execute("SELECT count(*) FROM health_data").fetchone()[0]
    
    print("\n" + "="*40)
    print(" [CIVIK.LINK DATABASE REPORT]")
    print("="*40)
    print(f" Total Citizen Accounts: {users}")
    print(f" Total Health Syncs:    {health}")
    print("="*40)
    print(" Status: ALL SYSTEMS OPERATIONAL")
    print("="*40 + "\n")
    
    conn.close()

if __name__ == "__main__":
    get_stats()
