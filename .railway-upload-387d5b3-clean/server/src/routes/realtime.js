'use strict';

const { Router } = require('express');
const config = require('../config');
const router = Router();

// Hard cap on realtime/trial token lifetime; configured via TRIAL_MAX_SECONDS.
const TRIAL_MAX_MS = config.trial.maxSeconds * 1000;

// Returns a short-lived ephemeral token so the browser can connect
// directly to the real-time voice API without exposing the main API key.
//
// Two providers are supported:
//  - OpenAI Realtime (WebRTC, model gpt-4o-realtime-preview)     → GET /token
//  - Gemini Live     (WebSocket, model gemini-live-2.5-flash)    → GET /gemini-token
router.get('/token', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const voice = config.openai.voiceKelion;
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openai.realtimeModel,
        voice,
      }),
    });

    if (!r.ok) {
      const body = await r.text();
      console.error('[realtime] OpenAI session error:', r.status, body);
      return res.status(500).json({ error: 'Failed to create realtime session', upstream_status: r.status, detail: body.slice(0, 500) });
    }

    const data = await r.json();
    const upstreamExpiresAt = data.client_secret?.expires_at;
    const capExpiresAt = Math.floor((Date.now() + TRIAL_MAX_MS) / 1000);
    const expiresAt = upstreamExpiresAt && upstreamExpiresAt < capExpiresAt ? upstreamExpiresAt : capExpiresAt;

    res.json({
      token:     data.client_secret.value,
      expiresAt,
      voice,
    });
  } catch (err) {
    console.error('[realtime] Error:', err.message);
    res.status(500).json({ error: 'Failed to create realtime session', detail: err.message });
  }
});

// Ordered list of Gemini Live models to try. Sourced from
// GEMINI_LIVE_MODEL (optional primary) + GEMINI_LIVE_FALLBACKS (CSV).
// The API naming changes across previews; the first one that works wins.
function geminiLiveModelCandidates() {
  const primary = config.gemini.liveModel;
  const list = [primary, ...config.gemini.liveFallbacks].filter(Boolean);
  const seen = new Set();
  return list.filter(m => (seen.has(m) ? false : (seen.add(m), true)));
}

// Gemini Live ephemeral token
// Docs: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
router.get('/gemini-token', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const voice = config.gemini.liveVoiceKelion;
  const now = Date.now();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
  const expireTime            = new Date(now + TRIAL_MAX_MS).toISOString();
  const url = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens?key=' + encodeURIComponent(apiKey);

  const attempts = [];
  for (const model of geminiLiveModelCandidates()) {
    try {
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

      if (r.ok) {
        const data = await r.json();
        return res.json({
          token:     data.name,
          expiresAt: expireTime,
          model,
          voice,
          provider:  'gemini',
        });
      }

      const body = await r.text();
      attempts.push({ model, status: r.status, detail: body.slice(0, 300) });
      console.error('[realtime] Gemini token attempt failed:', model, r.status, body.slice(0, 300));
    } catch (err) {
      attempts.push({ model, error: err.message });
      console.error('[realtime] Gemini token attempt threw:', model, err.message);
    }
  }

  return res.status(500).json({
    error: 'Failed to create Gemini live session across all candidate models',
    attempts,
  });
});

module.exports = router;
