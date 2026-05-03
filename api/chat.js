/**
 * civik.link — Groq AI Chat Serverless Function
 * Vercel Edge Function: /api/chat
 *
 * The GROQ_API_KEY lives ONLY in Vercel's environment variables.
 * It is never exposed to the browser. This function is the secure proxy.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama3-8b-8192'; // Fast, free, great for Q&A

export default async function handler(req, res) {

  // ── CORS preflight ────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Only POST allowed ──────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, context } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // ── Build System Prompt from user context ──────────────────────────────────
  const systemPrompt = `
You are the civik Assistant — a warm, empathetic AI helper for elderly and differently-abled Indian citizens.

You help users with:
- Understanding their health metrics (blood pressure, blood sugar, etc.)
- Medication reminders and information
- Government schemes and benefits (Ayushman Bharat, UDID, pensions, etc.)
- Doctor appointments and health tips
- Emergency contact information

CURRENT USER CONTEXT:
- Name: ${context?.userName || 'the user'}
- Health Score: ${context?.healthScore || 'unavailable'}/100 — ${context?.healthScoreLabel || ''}
- Blood Pressure: ${context?.bloodPressure || 'unavailable'} mmHg (${context?.bpStatus || ''})
- Blood Sugar (Fasting): ${context?.bloodSugar?.fasting || 'unavailable'} mg/dL (${context?.bsStatus || ''})
- Heart Rate: ${context?.heartRate || 'unavailable'} bpm
- Upcoming Appointment: ${context?.nextAppointment || 'None scheduled'}
- Today's Medicines: ${context?.medications?.join(', ') || 'None listed'}
- Enrolled Schemes: ${context?.enrolledSchemes?.join(', ') || 'None listed'}
- Tips for today: ${context?.healthTip || ''}

RESPONSE RULES:
1. Always reply in simple, clear English that an elderly person can understand. Avoid medical jargon.
2. Keep responses concise — 2-4 sentences max unless the question needs more detail.
3. Be warm, respectful, and encouraging. Address the user by their first name if possible.
4. If the user asks about medication dosages or serious medical decisions, always advise them to consult their doctor.
5. If you mention a government scheme, include the helpline number if you know it.
6. When giving emergency advice, always mention calling their doctor or 112 for true emergencies.
7. Never make up health data. Only use the context provided above.
8. If the question is unrelated to health, civic services, or the user's wellbeing, politely redirect.
  `.trim();

  // ── Call Groq API ──────────────────────────────────────────────────────────
  try {
    const groqResponse = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: message.trim() },
        ],
        max_tokens:  400,
        temperature: 0.55,
        stream:      false,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error('[Groq Error]', groqResponse.status, errText);
      return res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
    }

    const data  = await groqResponse.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({ error: 'Empty response from AI. Please try again.' });
    }

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('[chat.js] Unexpected error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' });
  }
}
