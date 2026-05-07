import random
import json
import time
from locust import HttpUser, task, between, events

class CivikUser(HttpUser):
    wait_time = between(1, 5)  # Simulate real user wait times
    
    def on_start(self):
        """Called when a user starts - we simulate a random login"""
        self.email = f"test_user_{random.randint(1000, 99999)}@civik.link"
        self.auth_token = None
        self.udid = None

    @task(5)
    def view_homepage(self):
        """Most users just browse the home page"""
        self.client.get("/")

    @task(2)
    def auth_flow(self):
        """Simulate a login flow"""
        # 1. Request OTP
        with self.client.post("/api/auth/request-otp", json={"email": self.email}, catch_response=True) as response:
            if response.status_code == 200:
                # 2. Verify OTP (using the test backdoor 999999 mentioned in reports)
                with self.client.post("/api/auth/verify-otp", json={
                    "email": self.email,
                    "otp": "123456" # Use the emergency bypass code
                }, catch_response=True) as verify_resp:
                    if verify_resp.status_code == 200:
                        data = verify_resp.json()
                        self.udid = data.get("udid")
                        # The token is in a cookie, Locust handles cookies automatically
                        self.auth_token = True 
                    else:
                        verify_resp.failure(f"OTP Verify Failed: {verify_resp.text}")
            else:
                response.failure(f"OTP Request Failed: {response.text}")

    @task(10)
    def profile_actions(self):
        """Simulate checking and updating profile (if logged in)"""
        if not self.auth_token:
            self.auth_flow() # Ensure we are logged in
            
        # Get Profile
        self.client.get("/api/profile")
        
        # Save Profile (Update)
        profile_data = {
            "profile": {
                "name": f"User {self.email.split('@')[0]}",
                "phone": f"+91{random.randint(7000000000, 9999999999)}",
                "blood_group": random.choice(["A+", "B+", "O+", "AB+"]),
                "profile_completed": True
            }
        }
        self.client.post("/api/profile", json=profile_data)

    @task(8)
    def health_data_actions(self):
        """Simulate health monitoring activity"""
        if not self.auth_token:
            self.auth_flow()

        # Get Health Data
        self.client.get("/api/health-data")
        
        # Save Health Data
        health_data = {
            "health": {
                "vitals": {
                    "heart_rate": {"value": random.randint(60, 100), "unit": "bpm"},
                    "blood_pressure": {"systolic": random.randint(110, 130), "diastolic": random.randint(70, 90)},
                    "oxygen_saturation": {"value": random.randint(95, 100), "unit": "%"}
                }
            }
        }
        self.client.post("/api/health-data", json=health_data)

    @task(3)
    def view_schemes(self):
        """Simulate loading the schemes list from mock data"""
        self.client.get("/mock/schemes.json")

    @task(4)
    def check_notifications(self):
        """Simulate checking notifications"""
        if not self.auth_token:
            self.auth_flow()
        self.client.get("/api/notifications")

    @task(1)
    def ai_chat(self):
        """Simulate AI Chat interaction (Expensive but part of the app)"""
        if not self.auth_token:
            self.auth_flow()
            
        payload = {
            "message": "What are some government health schemes for elderly citizens in India?",
            "context": {"location": "Mumbai", "age": 70}
        }
        # We catch response because this might fail if GROQ_API_KEY is missing or rate limited
        with self.client.post("/api/chat", json=payload, catch_response=True) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 500:
                response.failure("AI Chat Error (likely API Key issue)")
            else:
                response.success() # We don't want to skew results if it's just external API lag

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    print("--- Civik.Link Local Load Test Initializing ---")

@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    print("--- Civik.Link Local Load Test Completed ---")
