'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserByGoogleId } = require('../db');

/**
 * Middleware pentru verificarea autentificării.
 * Suportă:
 * - JWT tokens în header Authorization: Bearer <token>
 * - Session cookies pentru web clients
 */
async function requireAuth(req, res, next) {
  try {
    // Check for JWT token first
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        req.user = {
          id: decoded.sub,
          email: decoded.email,
          name: decoded.name,
          role: decoded.role || 'user',
        };
        return next();
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
      }
    }

    // Check for session (if express-session was configured)
    if (req.session && req.session.userId) {
      req.user = req.session.user;
      return next();
    }

    // No auth found
    return res.status(401).json({ error: 'Authentication required' });
  } catch (err) {
    console.error('[requireAuth] Error:', err.message);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Middleware pentru verificarea rolului de admin.
 * Trebuie folosit DUPĂ requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  
  if (req.user.role === 'admin' || (req.user.email && adminEmails.includes(req.user.email.toLowerCase()))) {
    return next();
  }

  return res.status(403).json({ error: 'Admin access required' });
}

/**
 * Semnează un token JWT pentru aplicațiile mobile.
 */
function signAppToken(user) {
  return jwt.sign(
    { 
      sub: user.id, 
      email: user.email, 
      name: user.name,
      role: user.role || 'user',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

module.exports = {
  requireAuth,
  requireAdmin,
  signAppToken,
};
