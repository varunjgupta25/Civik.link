/**
 * civik.link — Authentication Serverless Function (Node.js)
 * Handles OTP request and verification via Brevo API
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';

// In-memory OTP storage (Note: In serverless, this is per-instance, 
// which is fine for a quick demo. For production, use Redis/Supabase)
const OTP_STORE = new Map();
const OTP_EXPIRY = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, email, otp, udid } = req.body;

  // --- ACTION: REQUEST OTP ---
  if (req.method === 'POST' && req.url.includes('request-otp')) {
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    OTP_STORE.set(email.toLowerCase(), {
      otp: generatedOtp,
      expiry: Date.now() + OTP_EXPIRY
    });

    try {
      const BREVO_KEY = process.env.BREVO_API_KEY;
      if (!BREVO_KEY) {
        console.log(`[DEV] OTP for ${email}: ${generatedOtp}`);
        return res.status(200).json({ success: true, delivery: 'console' });
      }

      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: "civik.link", email: "onboarding@brevo.com" },
        to: [{ email }],
        subject: `${generatedOtp} is your civik.link verification code`,
        textContent: `Hi,\n\nYour civik.link verification code is: ${generatedOtp}\n\nThis code expires in 5 minutes.\n\n— The civik.link Team`
      }, {
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' }
      });

      return res.status(200).json({ success: true, delivery: 'email' });
    } catch (err) {
      console.error('[Auth Error]', err.response?.data || err.message);
      return res.status(502).json({ error: 'Failed to send email. Please try again.' });
    }
  }

  // --- ACTION: VERIFY OTP ---
  if (req.method === 'POST' && req.url.includes('verify-otp')) {
    const stored = OTP_STORE.get(email?.toLowerCase());
    
    if (!stored || stored.otp !== otp || Date.now() > stored.expiry) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    // Generate JWT
    const token = jwt.sign(
      { email: email.toLowerCase(), udid: udid || 'gen-user' },
      process.env.JWT_SECRET || 'temp-secret',
      { expiresIn: '7d' }
    );

    OTP_STORE.delete(email.toLowerCase());
    return res.status(200).json({ success: true, token, user: { email } });
  }

  return res.status(404).json({ error: 'Not found' });
}
