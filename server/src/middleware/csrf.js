'use strict';

const crypto = require('crypto');

const CSRF_COOKIE = 'kelion.csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Seed the CSRF cookie on every response if it doesn't exist yet.
 * Runs on ALL routes (GET included) so the frontend always has a token
 * before making its first POST.
 */
function csrfSeed(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });
  }
  return next();
}

/**
 * Enforce CSRF on state-changing requests. Must be used AFTER csrfSeed
 * has had a chance to set the cookie (on a previous page load / GET).
 *
 * An attacker on a different origin cannot read the cookie (same-origin
 * policy), so they cannot forge the header.
 */
function csrfProtection(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'CSRF token missing or invalid' });
    }
  }

  return next();
}

module.exports = { csrfSeed, csrfProtection, CSRF_COOKIE, CSRF_HEADER };
