'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');
const { findById } = require('../db');

function signAppToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

async function requireAuth(req, res, next) {
  // 1. Try Bearer token
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      const user = await findById(payload.sub);
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  // 2. Try JWT cookie
  const cookieToken = req.cookies && req.cookies['kelion.token'];
  if (cookieToken) {
    try {
      const payload = jwt.verify(cookieToken, config.jwt.secret);
      const user = await findById(payload.sub);
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch (err) {
      res.clearCookie('kelion.token', { path: '/' });
      return res.status(401).json({ error: 'Session expired' });
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}

module.exports = { signAppToken, requireAuth };
