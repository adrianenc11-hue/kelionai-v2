'use strict';

/**
 * /api/tts — SUSPENDED.
 * Voice comes from Canal B (Gemini Live WebSocket) only.
 */

const { Router } = require('express');
const router = Router();

router.post('/', (_req, res) => {
  res.status(410).json({ error: 'TTS suspended. Voice from WebSocket only.' });
});

module.exports = router;
