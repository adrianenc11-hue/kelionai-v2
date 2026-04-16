'use strict';

const { Router } = require('express');
const router = Router();

// Returns a short-lived ephemeral token so the browser can connect
// directly to OpenAI Realtime API via WebRTC without exposing the main API key.
function pickVoice(avatar) {
  if (avatar === 'kira') return process.env.OPENAI_VOICE_KIRA || 'shimmer';
  return process.env.OPENAI_VOICE_KELION || 'ash';
}

router.get('/token', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const avatar = req.query.avatar || 'kelion';
    const voice = pickVoice(avatar);
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[realtime] OpenAI session error:', err);
      return res.status(500).json({ error: 'Failed to create realtime session' });
    }

    const data = await r.json();
    res.json({
      token:     data.client_secret.value,
      expiresAt: data.client_secret.expires_at,
      voice,
    });
  } catch (err) {
    console.error('[realtime] Error:', err.message);
    res.status(500).json({ error: 'Failed to create realtime session' });
  }
});

module.exports = router;
