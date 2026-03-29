// server/routes/developer.js
// ═══════════════════════════════════════════════════════════════
// KelionAI — Developer API (keys, webhooks, stats, v1 endpoints)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../rate-limit-key');

const router = express.Router();

const devLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Wait a minute.' },
  keyGenerator: rateLimitKey,
});

router.use(devLimiter);

// ─── Auth helpers ───

async function requireUser(req, res) {
  const { getUserFromToken } = req.app.locals;
  if (getUserFromToken) {
    const user = await getUserFromToken(req);
    if (user) return user;
  }
  res.status(401).json({ error: 'Authentication required' });
  return null;
}

function requireApiKey(req, res) {
  const key = req.headers['x-api-key'] || req.headers.authorization;
  if (!key) {
    res.status(401).json({ error: 'API key required' });
    return null;
  }
  // In a real implementation, validate the API key against developer_keys table
  res.status(401).json({ error: 'API key required' });
  return null;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/keys — List user's API keys
// ═══════════════════════════════════════════════════════════════
router.get('/keys', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ keys: [] });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/developer/keys — Create API key
// ═══════════════════════════════════════════════════════════════
router.post('/keys', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ key: null, message: 'Not implemented yet' });
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/developer/keys/:id — Delete API key
// ═══════════════════════════════════════════════════════════════
router.delete('/keys/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ deleted: false, message: 'Not implemented yet' });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/stats — Usage statistics
// ═══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ usage: {} });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/webhooks — List webhooks
// ═══════════════════════════════════════════════════════════════
router.get('/webhooks', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ webhooks: [] });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/developer/webhooks — Create webhook
// ═══════════════════════════════════════════════════════════════
router.post('/webhooks', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({ webhook: null, message: 'Not implemented yet' });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/v1/status — Public API status (no auth)
// ═══════════════════════════════════════════════════════════════
router.get('/v1/status', (req, res) => {
  res.json({
    status: 'online',
    version: process.env.npm_package_version || '2.0.0',
    endpoints: ['/v1/chat', '/v1/models', '/v1/user/profile', '/v1/status'],
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/v1/models — List available models
// ═══════════════════════════════════════════════════════════════
router.get('/v1/models', (req, res) => {
  if (!requireApiKey(req, res)) return;
});

// ═══════════════════════════════════════════════════════════════
// GET /api/developer/v1/user/profile — User profile via API key
// ═══════════════════════════════════════════════════════════════
router.get('/v1/user/profile', (req, res) => {
  if (!requireApiKey(req, res)) return;
});

// ═══════════════════════════════════════════════════════════════
// POST /api/developer/v1/chat — Chat via API key
// ═══════════════════════════════════════════════════════════════
router.post('/v1/chat', (req, res) => {
  if (!requireApiKey(req, res)) return;
});

module.exports = router;
