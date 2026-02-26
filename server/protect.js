// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — PROTECT ROUTER (Layer 7: Fingerprinting)
// DevTools attempt logging, session watermarking, fingerprinting
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const router = express.Router();

// ─── IN-MEMORY FINGERPRINT STORE ─────────────────────────────
// Max 1000 entries, auto-expire after 24 h
const MAX_ENTRIES = 1000;
const TTL_MS = 24 * 60 * 60 * 1000;
const fingerprintStore = new Map();

function pruneStore() {
    const now = Date.now();
    for (const [key, val] of fingerprintStore) {
        if (now - val.createdAt > TTL_MS) {
            fingerprintStore.delete(key);
        }
    }
    // Hard cap — evict oldest if still over limit
    if (fingerprintStore.size > MAX_ENTRIES) {
        const oldest = [...fingerprintStore.entries()]
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, fingerprintStore.size - MAX_ENTRIES);
        for (const [key] of oldest) fingerprintStore.delete(key);
    }
}

// ─── RATE LIMITERS ───────────────────────────────────────────
const protectLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ─── POST /api/protect/devtools-attempt ──────────────────────
router.post('/devtools-attempt', protectLimiter, async (req, res) => {
    try {
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';
        const { getUserFromToken } = req.app.locals;
        let userId = null;
        if (getUserFromToken) {
            const user = await getUserFromToken(req).catch(() => null);
            userId = user ? user.id : null;
        }
        logger.warn({
            component: 'Protect',
            event: 'devtools-attempt',
            ip,
            userAgent,
            userId,
            timestamp: req.body.timestamp || new Date().toISOString()
        }, '🔍 DevTools attempt detected');
        res.json({ logged: true });
    } catch (e) {
        logger.error({ component: 'Protect', err: e.message }, 'devtools-attempt error');
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── SHARED FINGERPRINT GENERATOR ────────────────────────────
async function generateFingerprint(req, overrideSessionId) {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const { getUserFromToken } = req.app.locals;
    let userId = 'guest';
    if (getUserFromToken) {
        const user = await getUserFromToken(req).catch(() => null);
        if (user) userId = user.id;
    }
    const sessionId = overrideSessionId || crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    const raw = `${userId}|${sessionId}|${timestamp}|${userAgent}|${ip}`;
    const token = crypto.createHash('sha256').update(raw).digest('hex');
    pruneStore();
    fingerprintStore.set(token, { userId, sessionId, ip, userAgent, createdAt: timestamp });
    return { token, sessionId, userId };
}

// ─── POST /api/protect/watermark ─────────────────────────────
router.post('/watermark', protectLimiter, async (req, res) => {
    try {
        const { token, sessionId, userId } = await generateFingerprint(req, req.body.sessionId);
        logger.info({ component: 'Protect', token: token.slice(0, 8) + '…', userId }, '💧 Watermark generated');
        res.json({ token, sessionId });
    } catch (e) {
        logger.error({ component: 'Protect', err: e.message }, 'watermark error');
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── GET /api/protect/fingerprint ────────────────────────────
router.get('/fingerprint', protectLimiter, async (req, res) => {
    try {
        const { token, sessionId } = await generateFingerprint(req);
        res.json({ token, sessionId });
    } catch (e) {
        logger.error({ component: 'Protect', err: e.message }, 'fingerprint error');
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
