/**
 * civik.link — Fail-Proof Auth Handler (CommonJS)
 */

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { email, otp } = req.body || {};

    // 1. SIMPLE HEALTH CHECK
    if (req.url.includes('health')) {
      return res.status(200).json({ status: 'ok', engine: 'node-commonjs' });
    }

    // 2. REQUEST OTP
    if (req.url.includes('request-otp')) {
      console.log('OTP Requested for:', email);
      // For now, we return success immediately to ensure the function works
      return res.status(200).json({ 
        success: true, 
        delivery: 'demo-mode',
        msg: 'If this shows, the backend is ALIVE!' 
      });
    }

    // 3. VERIFY OTP
    if (req.url.includes('verify-otp')) {
      return res.status(200).json({ 
        success: true, 
        token: 'demo-token-' + Date.now(),
        user: { email: email || 'user@example.com' } 
      });
    }

    return res.status(404).json({ error: 'Endpoint not found' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
