// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Auth Middleware
// Validates the x-admin-secret header using timing-safe comparison
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

/**
 * Express middleware that requires a valid ADMIN_SECRET_KEY via the
 * `x-admin-secret` request header.  Uses a timing-safe comparison to
 * prevent timing-based secret enumeration attacks.
 */
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    const expected = process.env.ADMIN_SECRET_KEY;
    if (!secret || !expected) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const secretBuf = Buffer.from(secret);
        const expectedBuf = Buffer.from(expected);
        if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { adminAuth };
