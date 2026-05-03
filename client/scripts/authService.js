/**
 * civik.link — Auth Service
 * Sophisticated JWT handling for mobile
 */

const AuthService = {

  /**
   * Requests a one-time code for the email address.
   */
  async requestOtp(email) {
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email })
      });

      if (response.status === 404) throw new Error('Auth route not found (404). Are you on port 8000?');
      if (!response.ok) throw new Error('Server responded with error: ' + response.status);

      return await response.json();
    } catch (err) {
      console.error('[AuthService] OTP request error:', err);
      throw err;
    }
  },

  /**
   * Verifies the one-time code. The backend stores auth in an HttpOnly cookie.
   */
  async verifyOtp(email, otp) {
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, otp })
      });

      if (response.status === 404) throw new Error('Auth route not found (404). Are you on port 8000?');
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || 'Server responded with error: ' + response.status);
      }

      return await response.json();
    } catch (err) {
      console.error('[AuthService] OTP verification error:', err);
      throw err;
    }
  },

  /**
   * Checks if user is authenticated
   */
  async isAuthenticated() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      return response.ok;
    } catch (e) {
      return false;
    }
  },

  /**
   * Logs out
   */
  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {
      console.warn('[AuthService] Logout request failed:', e);
    }
    localStorage.removeItem('civik_jwt_token');
    window.location.reload();
  },

  /**
   * Kept for older call sites. Cookie auth does not need JS-readable headers.
   */
  getAuthHeaders() {
    return {};
  }
};

export default AuthService;
