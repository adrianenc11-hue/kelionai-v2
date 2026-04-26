'use strict';

/**
 * /api/chat — SUSPENDED.
 * All AI goes through Canal B (Gemini Live WebSocket).
 */

const { Router } = require('express');
const router = Router();

router.post('/', (_req, res) => {
  res.status(410).json({ error: 'Chat API suspended. Use voice WebSocket.' });
});

router.post('/demo', (_req, res) => {
  res.status(410).json({ error: 'Demo API suspended. Use voice WebSocket.' });
});

module.exports = router;
