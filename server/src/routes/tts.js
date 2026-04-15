'use strict';

const { Router } = require('express');
const router = Router();

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// Adam — eleven_multilingual_v2 male voice (auto-detects language)
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'Text is required and must be under 2000 characters' });
  }

  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  if (!apiKey) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured. Set ELEVENLABS_API_KEY.' });
  }

  try {
    const response = await fetch(`${ELEVENLABS_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key':   apiKey,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability:        0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[tts] ElevenLabs error:', err);
      return res.status(500).json({ error: 'Voice synthesis failed' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buffer.length });
    res.send(buffer);
  } catch (err) {
    console.error('[tts] Error:', err.message);
    res.status(500).json({ error: 'Voice synthesis failed' });
  }
});

module.exports = router;
