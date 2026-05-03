from locust import HttpUser, task, between

class CivikLinkVirtualUser(HttpUser):
    # Simulate a human taking 1 to 3 seconds to read the screen before clicking
    wait_time = between(1, 3)

    @task(3)
    def view_homepage(self):
        # The virtual user loads the main app and its assets
        self.client.get("/")
        self.client.get("/styles/main.css")
        self.client.get("/scripts/app_v2.js")

    @task(1)
    def fetch_api_data(self):
        # The virtual user pretends to look at government schemes and health data
        self.client.get("/api/schemes")
        self.client.get("/api/health-data")
