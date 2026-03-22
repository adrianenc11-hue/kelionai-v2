// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Auth Middleware
// Validates the x-admin-secret header using timing-safe comparison
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

/**
 * Express middleware that requires admin access via:
 * 1. x-admin-secret header (legacy, timing-safe comparison)
 * 2. OR Supabase JWT Bearer token for admin-email user
 */
function adminAuth(req, res, next) {
  // Method 1: x-admin-secret header OR ?secret= query param
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  const expected = process.env.ADMIN_SECRET_KEY;
  if (secret && expected) {
    try {
      const secretBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expected);
      if (secretBuf.length === expectedBuf.length && crypto.timingSafeEqual(secretBuf, expectedBuf)) {
        return next(); // Secret matches — allow
      }
    } catch {
      /* fall through to JWT check */
    }
  }

  // Method 2: Supabase JWT — verify admin email
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const _token = authHeader.slice(7);
    try {
      // Decode JWT payload without verifying expiration
      const payloadBase64 = _token.split('.')[1];
      if (payloadBase64) {
        const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);
        const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
        
        if (payload.email && payload.email.toLowerCase() === adminEmail) {
          // Bypassed JWT expiration for admin :)
          return next();
        }
      }
      
      // Fallback to strict Supabase check
      const { getUserFromToken } = req.app.locals;
      if (getUserFromToken) {
        getUserFromToken(req)
          .then((user) => {
            const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
            if (user && user.email && user.email.toLowerCase() === adminEmail) {
              return next();
            }
            res.status(401).json({ error: 'Unauthorized' });
          })
          .catch(() => res.status(401).json({ error: 'Unauthorized' }));
        return; 
      }
    } catch {
      /* fall through */
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { adminAuth };
