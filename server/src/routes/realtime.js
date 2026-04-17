'use strict';

const { Router } = require('express');
const router = Router();

// Returns a short-lived ephemeral token so the browser can connect
// directly to the real-time voice API without exposing the main API key.
//
// Two providers are supported:
//  - OpenAI Realtime (WebRTC, model gpt-4o-realtime-preview)     → GET /token
//  - Gemini Live     (WebSocket, model gemini-3.1-flash-live-*)  → GET /gemini-token
function pickOpenAIVoice(avatar) {
  if (avatar === 'kira') return process.env.OPENAI_VOICE_KIRA || 'shimmer';
  return process.env.OPENAI_VOICE_KELION || 'ash';
}

function pickGeminiVoice(avatar) {
  if (avatar === 'kira') return process.env.GEMINI_LIVE_VOICE_KIRA || 'Puck';
  return process.env.GEMINI_LIVE_VOICE_KELION || 'Kore';
}

router.get('/token', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const avatar = req.query.avatar || 'kelion';
    const voice = pickOpenAIVoice(avatar);
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

// Gemini Live ephemeral token
// Docs: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
router.get('/gemini-token', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const avatar = req.query.avatar || 'kelion';
    const voice = pickGeminiVoice(avatar);
    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';

    // New session starts valid for 1 minute; full session length up to 30 min.
    const now = Date.now();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
    const expireTime            = new Date(now + 30 * 60 * 1000).toISOString();

    const url = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens?key=' + encodeURIComponent(apiKey);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        },
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[realtime] Gemini ephemeral token error:', err);
      return res.status(500).json({ error: 'Failed to create Gemini live session' });
    }

    const data = await r.json();
    // `name` is the ephemeral token; clients pass it as apiKey in @google/genai.
    res.json({
      token:     data.name,
      expiresAt: expireTime,
      model,
      voice,
      provider:  'gemini',
    });
  } catch (err) {
    console.error('[realtime] Gemini error:', err.message);
    res.status(500).json({ error: 'Failed to create Gemini live session' });
  }
});

module.exports = router;
