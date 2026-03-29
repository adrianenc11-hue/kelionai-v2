// ═══════════════════════════════════════════════════════════════
// KelionAI — Self-Development API Routes
// /api/admin/self/* — admin-only
// Audit API keys, install keys runtime, self-improvement analysis
// Weather test cu GPS live
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('../logger');
const { auditApiKeys, installApiKey, analyzeSelfImprovement, getWeatherLive, API_PROVIDERS } = require('../brain-self');

const router = express.Router();

// ── Middleware: admin only ──
// Accepts x-admin-secret (primary) OR x-admin-key (legacy) headers
function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.headers['x-admin-key'] || req.query.adminKey;
  const expected = process.env.ADMIN_SECRET_KEY;
  if (!secret || !expected) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const crypto = require('crypto');
    const sBuf = Buffer.from(secret);
    const eBuf = Buffer.from(expected);
    if (sBuf.length === eBuf.length && crypto.timingSafeEqual(sBuf, eBuf)) {
      return next();
    }
  } catch (_) {}
  return res.status(403).json({ error: 'Admin access required' });
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/self/audit — Audit toate API keys
// ═══════════════════════════════════════════════════════════════
router.get('/audit', requireAdmin, async (req, res) => {
  try {
    const results = await auditApiKeys();
    res.json({
      ok: true,
      summary: {
        present: results.present.length,
        missing: results.missing.length,
        invalid: results.invalid.length,
      },
      present: results.present,
      missing: results.missing.map((m) => ({
        ...m,
        currentValue: process.env[m.envKey] ? '***configured***' : null,
      })),
      invalid: results.invalid,
      timestamp: results.timestamp,
    });
  } catch (e) {
    logger.error({ component: 'SelfDev.Audit', err: e.message }, 'Audit failed');
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/self/install-key — Instalează API key runtime
// Body: { envKey: "ANTHROPIC_API_KEY", value: "sk-ant-..." }
// ═══════════════════════════════════════════════════════════════
router.post('/install-key', requireAdmin, async (req, res) => {
  try {
    const { envKey, value } = req.body;
    if (!envKey || !value) return res.status(400).json({ error: 'envKey and value required' });

    // Security: only allow known env keys
    const knownKeys = Object.values(API_PROVIDERS).map((p) => p.envKey);
    if (!knownKeys.includes(envKey)) {
      return res.status(400).json({ error: `Unknown key: ${envKey}. Allowed: ${knownKeys.join(', ')}` });
    }

    const result = await installApiKey(envKey, value, 'admin');
    if (result.success) {
      res.json({ ok: true, message: result.message, provider: result.provider });
    } else {
      res.status(400).json({ ok: false, error: result.error });
    }
  } catch (e) {
    logger.error({ component: 'SelfDev.InstallKey', err: e.message }, 'Install key failed');
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/self/providers — Lista provideri cu status
// ═══════════════════════════════════════════════════════════════
router.get('/providers', requireAdmin, async (req, res) => {
  try {
    const providers = Object.entries(API_PROVIDERS).map(([id, p]) => ({
      id,
      name: p.name,
      envKey: p.envKey,
      configured: !!process.env[p.envKey],
      freeKey: p.freeKey,
      docsUrl: p.docsUrl,
      signupUrl: p.signupUrl,
    }));
    res.json({ ok: true, providers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/self/weather-test — Test weather cu GPS/IP
// Body: { lat?, lon?, city?, clientIp? }
// ═══════════════════════════════════════════════════════════════
router.post('/weather-test', requireAdmin, async (req, res) => {
  try {
    const { lat, lon, city, clientIp } = req.body;
    const result = await getWeatherLive({ lat, lon, city, clientIp });
    if (result) {
      res.json({ ok: true, weather: result });
    } else {
      res.json({ ok: false, error: 'Could not fetch weather — check coordinates or city name' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/self/improve — Self-improvement analysis
// ═══════════════════════════════════════════════════════════════
router.get('/improve', requireAdmin, async (req, res) => {
  try {
    const analysis = await analyzeSelfImprovement();
    res.json({ ok: true, analysis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/admin/self/brain-status — Status brain + diagnostics
// ═══════════════════════════════════════════════════════════════
router.get('/brain-status', requireAdmin, async (req, res) => {
  try {
    const brain = req.app.locals.brain;
    if (!brain) return res.status(503).json({ error: 'Brain not initialized' });
    const diagnostics = brain.getDiagnostics();
    res.json({ ok: true, diagnostics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;