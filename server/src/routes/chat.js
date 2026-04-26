'use strict';

/**
 * /api/chat — SUSPENDED.
 *
 * All AI communication now goes through Canal B (Gemini Live WebSocket).
 * This route is kept as a stub so existing clients get a clear 410 response
 * instead of a 404. The original code has been physically removed.
 */

const { Router } = require('express');
const router = Router();

// Main chat endpoint — suspended.
router.post('/', (_req, res) => {
  res.status(410).json({ error: 'Chat API removed. All AI uses voice WebSocket (Canal B).' });
});

// Demo endpoint — suspended.
router.post('/demo', (_req, res) => {
  res.status(410).json({ error: 'Demo API removed. All AI uses voice WebSocket (Canal B).' });
});

module.exports = router;
