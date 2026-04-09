'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { findById } = require('../db');

/**
 * Issue a signed application JWT for mobile clients.
 *
 * @param {{ id: string, email: string, name: string }} user
 * @returns {string}
 */
function signAppToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Express middleware that requires a valid session or Bearer JWT.
 *
 * - Web clients: session cookie → req.session.userId
 * - Mobile clients: Authorization: Bearer <jwt>
 *
 * Sets req.user on success, responds 401 otherwise.
 */
async function requireAuth(req, res, next) {
  // 1. Try Bearer token (mobile)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      const user = findById(payload.sub);
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  // 2. Try session cookie (web)
  if (req.session && req.session.userId) {
    const user = findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user = user;
    return next();
  }

  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = { signAppToken, requireAuth };
