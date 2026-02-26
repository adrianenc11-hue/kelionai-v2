// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — API KEY AUTH MIDDLEWARE
// Validates X-API-Key header and applies per-key rate limiting
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('../logger');

// In-memory rate limit tracker: keyId → { count, resetAt }
const keyRateLimits = new Map();

function isKeyRateLimited(keyId, limit) {
    const now = Date.now();
    const entry = keyRateLimits.get(keyId);
    if (!entry || now >= entry.resetAt) {
        keyRateLimits.set(keyId, { count: 1, resetAt: now + 60 * 60 * 1000 });
        return false;
    }
    if (entry.count >= limit) return true;
    entry.count++;
    return false;
}

// Clean up stale entries every hour to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of keyRateLimits.entries()) {
        if (now >= entry.resetAt) keyRateLimits.delete(id);
    }
}, 60 * 60 * 1000);

function apiKeyAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required. Add X-API-Key header.' });

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service unavailable' });

    supabaseAdmin
        .from('api_keys')
        .select('id, user_id, name, rate_limit, request_count, revoked_at')
        .eq('key', apiKey)
        .single()
        .then(({ data, error }) => {
            if (error || !data) {
                logger.warn({ component: 'ApiKeyAuth' }, 'Invalid API key attempt');
                return res.status(401).json({ error: 'Invalid API key' });
            }
            if (data.revoked_at) {
                return res.status(401).json({ error: 'API key has been revoked' });
            }

            const limit = data.rate_limit || 100;
            if (isKeyRateLimited(data.id, limit)) {
                return res.status(429).json({ error: 'Rate limit exceeded. Max ' + limit + ' requests/hour.' });
            }

            req.apiKey = data;
            req.apiKeyUserId = data.user_id;

            // Update lastUsed + requestCount asynchronously (non-blocking)
            // Uses rpc to atomically increment request_count at DB level
            supabaseAdmin
                .rpc('increment_api_key_count', { key_id: data.id })
                .then(() => {})
                .catch(() => {
                    // Fallback: plain update if rpc not available
                    supabaseAdmin
                        .from('api_keys')
                        .update({ last_used_at: new Date().toISOString() })
                        .eq('id', data.id)
                        .then(() => {}).catch(() => {});
                });

            next();
        })
        .catch(() => {
            res.status(503).json({ error: 'Service unavailable' });
        });
}

module.exports = { apiKeyAuth };
