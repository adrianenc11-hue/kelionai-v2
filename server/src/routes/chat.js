'use strict';

// POST /api/chat — text chat using Gemma 4 via generateContent API.
// This is a fallback/primary text chat route that does NOT require
// the Gemini Live WebSocket. Works with any model that supports
// generateContent, including Gemma 4.

const { Router } = require('express');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const ipGeo = require('../services/ipGeo');

const router = Router();

// In-memory conversation history per session (simple, resets on server restart)
const sessions = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 30 * 60 * 1000; // 30 min

// Cleanup old sessions every 5 min
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) {
    if (s.lastUsed < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

router.post('/', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });
    }

    // Auth / trial gating (same logic as realtime)
    const adminUser = await peekSignedInUser(req);
    const isAdmin = await isAdminUser(adminUser);
    const isGuest = !adminUser;

    if (isGuest && !isAdmin) {
      const guestIp = ipGeo.clientIp(req) || req.ip || '';
      const trial = await trialStatus(guestIp);
      if (!trial.allowed) {
        return res.status(401).json({
          error: trial.reason === 'lifetime_expired'
            ? 'Free trial expired. Create an account to continue.'
            : 'Daily free trial used up. Come back tomorrow or sign in.',
        });
      }
      await stampTrialIfFresh(guestIp, trial);
    }

    const { message, sessionId } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Session history
    const sid = sessionId || 'default';
    if (!sessions.has(sid)) {
      sessions.set(sid, { history: [], lastUsed: Date.now() });
    }
    const session = sessions.get(sid);
    session.lastUsed = Date.now();

    // Add user message to history
    session.history.push({ role: 'user', parts: [{ text: message.trim() }] });
    if (session.history.length > MAX_HISTORY * 2) {
      session.history = session.history.slice(-MAX_HISTORY * 2);
    }

    // Model: prefer Gemma 4, fallback to Gemini Flash
    const model = process.env.CHAT_MODEL || 'gemma-4-31b-it';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: session.history,
      systemInstruction: {
        parts: [{
          text: `You are Kelion, a friendly and intelligent AI assistant. CRITICAL LANGUAGE RULE: Automatically detect the language the user writes in and ALWAYS respond in that same language. If the user writes in Romanian, respond in Romanian. If in Spanish, respond in Spanish. If you cannot detect the language or the user hasn't written yet, default to English. Never mix languages in a response. Be helpful, warm, and conversational. Keep responses concise but informative.`
        }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[chat] Gemma 4 generateContent failed:', r.status, errText.slice(0, 500));
      // Fallback to smaller Gemma 4 variant if primary fails
      if (model === 'gemma-4-31b-it') {
        const fallbackModel = 'gemma-4-26b-a4b-it';
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const r2 = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r2.ok) {
          const data = await r2.json();
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
          session.history.push({ role: 'model', parts: [{ text: reply }] });
          return res.json({ reply, model: fallbackModel, fallback: true });
        }
      }
      return res.status(500).json({ error: 'AI generation failed' });
    }

    const data = await r.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';

    // Add assistant response to history
    session.history.push({ role: 'model', parts: [{ text: reply }] });

    res.json({ reply, model });
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
