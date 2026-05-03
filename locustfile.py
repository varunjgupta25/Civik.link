from locust import HttpUser, task, between
import random

class SOSInfrastructureUser(HttpUser):
    wait_time = between(1, 3)
    token = None

    def on_start(self):
        """Every bot logs in, then saves an emergency contact in their profile."""
        random_id = random.randint(10000, 99999)
        self.email = f"test{random_id}@civik.link"

        # Step 1: Request OTP (bypassed by backdoor, no real email sent)
        self.client.post("/api/auth/request-otp", json={"email": self.email})

        # Step 2: Verify OTP (backdoor lets test bots through with 999999)
        res = self.client.post("/api/auth/verify-otp", json={"email": self.email, "otp": "999999"})

        if res.status_code == 200:
            # Step 3: Save a complete profile WITH an emergency contact embedded
            contact = {
                "name": f"Emergency Contact {random_id}",
                "phone": f"+91{random.randint(7000000000, 9999999999)}",
                "relation": random.choice(["Father", "Mother", "Spouse", "Friend"]),
                "is_primary": True
            }
            profile = {
                "name": f"Test User {random_id}",
                "email": self.email,
                "profile_completed": True,
                "emergency_contacts": [contact],
                "preferences": {}
            }
            self.client.post("/api/profile", json={"profile": profile})

    @task(4)
    def read_sos_contact(self):
        """Simulate 50 users opening the SOS page — fetches their emergency contact from profile."""
        self.client.get("/api/profile")

    @task(2)
    def update_sos_contact(self):
        """Simulate a user editing or adding a new emergency contact."""
        random_id = random.randint(10000, 99999)
        contact = {
            "name": f"Updated Contact {random_id}",
            "phone": f"+91{random.randint(7000000000, 9999999999)}",
            "relation": random.choice(["Brother", "Sister", "Doctor", "Neighbour"]),
            "is_primary": True
        }
        self.client.post("/api/profile", json={
            "profile": {
                "name": f"Test User {random_id}",
                "email": self.email,
                "profile_completed": True,
                "emergency_contacts": [contact]
            }
        })

    @task(1)
    def load_sos_page(self):
        """Simulate loading the SOS page UI from the server."""
        self.client.get("/")
