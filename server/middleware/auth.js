// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Auth Middleware
// Validates the x-admin-secret header using timing-safe comparison
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const { validateSession } = require('../admin-sessions');
const logger = require('../logger');

/**
 * Express middleware that requires admin access via:
 * 1. x-admin-secret header — session token or raw secret (timing-safe)
 * 2. OR Supabase JWT Bearer token for admin-email user
 */
function adminAuth(req, res, next) {
  // Method 1: x-admin-secret header only (no query string — leaks in logs)
  const secret = req.headers['x-admin-secret'];

  // 1a: Check session token first
  if (secret && validateSession(secret)) {
    return next();
  }

  // 1b: Fall back to raw ADMIN_SECRET_KEY (timing-safe)
  const expected = process.env.ADMIN_SECRET_KEY;
  if (secret && expected) {
    try {
      const secretBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expected);
      if (secretBuf.length === expectedBuf.length && crypto.timingSafeEqual(secretBuf, expectedBuf)) {
        return next(); // Secret matches — allow
      }
    } catch (err) {
      logger.debug({ component: 'Auth', err: err.message }, 'Admin secret comparison failed, trying JWT');
    }
  }

  // Method 2: Supabase JWT — verify admin email via proper token verification
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const { getUserFromToken } = req.app.locals;
      if (getUserFromToken) {
        getUserFromToken(req)
          .then((user) => {
            if (!user || user._tokenExpired) {
              return res.status(401).json({ error: 'Unauthorized' });
            }
            const adminEmails = (process.env.ADMIN_EMAIL || '')
              .toLowerCase()
              .split(',')
              .map((e) => e.trim())
              .filter(Boolean);
            if (user.email && adminEmails.includes(user.email.toLowerCase())) {
              return next();
            }
            res.status(401).json({ error: 'Unauthorized' });
          })
          .catch(() => res.status(401).json({ error: 'Unauthorized' }));
        return;
      }
    } catch (err) {
      logger.debug({ component: 'Auth', err: err.message }, 'JWT verification failed');
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { adminAuth };
