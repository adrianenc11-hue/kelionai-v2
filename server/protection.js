// ═══════════════════════════════════════════════════════════════
// KelionAI — Protection Router
// POST /api/protection/fingerprint  — receive & log client fingerprint
// GET  /api/protection/verify       — verify session (HMAC signed)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const logger = require('./logger');

const router = express.Router();
router.use(express.json());

// ── In-memory fingerprint store ────────────────────────────────
// { sessionId -> { ip, userAgent, screen, timezone, lang, timestamp } }
const MAX_ENTRIES = 10000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const SUSPICIOUS_THRESHOLD = 100;    // sessions per IP per hour
const store = new Map();

// Periodic cleanup of expired entries (runs every hour)
setInterval(function pruneStore() {
    const cutoff = Date.now() - TTL_MS;
    for (const [key, val] of store) {
        if (val.timestamp < cutoff) store.delete(key);
    }
}, 60 * 60 * 1000).unref();

// Count sessions from an IP in the last hour
function countRecentFromIp(ip) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let count = 0;
    for (const val of store.values()) {
        if (val.ip === ip && val.timestamp >= cutoff) count++;
    }
    return count;
}

// Evict the oldest entry when at capacity
function evictOldest() {
    let oldest = Infinity;
    let oldestKey = null;
    for (const [key, val] of store) {
        if (val.timestamp < oldest) { oldest = val.timestamp; oldestKey = key; }
    }
    if (oldestKey !== null) store.delete(oldestKey);
}

// ── POST /api/protection/fingerprint ──────────────────────────
router.post('/fingerprint', function (req, res) {
    const { sessionId, userAgent, screen, timezone, lang } = req.body || {};
    const ip = req.ip || req.connection.remoteAddress || 'unknown';

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
        return res.status(400).json({ error: 'Invalid sessionId' });
    }

    const entry = {
        ip,
        userAgent: String(userAgent || '').slice(0, 512),
        screen: String(screen || '').slice(0, 32),
        timezone: String(timezone || '').slice(0, 64),
        lang: String(lang || '').slice(0, 16),
        timestamp: Date.now()
    };

    // Enforce capacity limit
    if (store.size >= MAX_ENTRIES && !store.has(sessionId)) evictOldest();

    store.set(sessionId, entry);

    // Suspicious activity check
    const recentCount = countRecentFromIp(ip);
    if (recentCount > SUSPICIOUS_THRESHOLD) {
        logger.warn({ component: 'Protection', ip, recentCount }, 'Suspicious fingerprint activity detected');
    }

    logger.info({ component: 'Protection', sessionId: sessionId.slice(0, 8) + '...', ip }, 'Fingerprint received');

    return res.json({ ok: true });
});

// ── GET /api/protection/verify ─────────────────────────────────
// Clients may call this to get a short-lived signed token they can
// attach to subsequent requests so the server can verify the session.
router.get('/verify', function (req, res) {
    const sessionId = req.query.sessionId;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
        return res.status(400).json({ error: 'Invalid sessionId' });
    }

    const entry = store.get(sessionId);
    if (!entry) {
        return res.status(404).json({ verified: false, error: 'Session not found' });
    }

    const secret = process.env.PROTECTION_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        return res.json({ verified: true, token: null });
    }
    const payload = `${sessionId}:${entry.timestamp}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = Buffer.from(payload).toString('base64url') + '.' + sig;

    return res.json({ verified: true, token });
});

// ── GET /api/admin/fingerprints — exported for index.js use ───
function getFlaggedSessions() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const ipCounts = new Map();

    for (const val of store.values()) {
        if (val.timestamp >= cutoff) {
            ipCounts.set(val.ip, (ipCounts.get(val.ip) || 0) + 1);
        }
    }

    const flagged = [];
    for (const [ip, count] of ipCounts) {
        if (count > SUSPICIOUS_THRESHOLD) flagged.push({ ip, count });
    }

    return { totalEntries: store.size, flaggedIPs: flagged };
}

module.exports = { router, getFlaggedSessions };
