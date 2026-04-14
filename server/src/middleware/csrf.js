'use strict';

const crypto = require('crypto');

const CSRF_COOKIE = 'kelion.csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit cookie CSRF protection.
 *
 * On every response, a random token is set in a non-HttpOnly cookie so the
 * frontend JavaScript can read it. On state-changing requests (POST, PUT,
 * DELETE) the client must echo that token back via the X-CSRF-Token header.
 *
 * An attacker on a different origin cannot read the cookie (same-origin
 * policy), so they cannot forge the header.
 */
function csrfProtection(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();
  // Always set / refresh the CSRF cookie so the frontend has a token
  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,   // JS must be able to read it
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });
  }

  // Only enforce on state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }

  return next();
}

module.exports = { csrfProtection, CSRF_COOKIE, CSRF_HEADER };
