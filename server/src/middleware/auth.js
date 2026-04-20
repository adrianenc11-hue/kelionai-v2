'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserByGoogleId, findById } = require('../db');

/**
 * Middleware pentru verificarea autentificării.
 * Suportă:
 * - JWT tokens în header Authorization: Bearer <token>
 * - Session cookies pentru web clients
 */
async function requireAuth(req, res, next) {
  try {
    // Check for JWT token: Bearer header first, then cookie
    const authHeader = req.headers.authorization || '';
    const rawToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : (req.cookies && req.cookies['kelion.token']) || null;

    if (rawToken) {
      try {
        const decoded = jwt.verify(rawToken, config.jwt.secret);
        // When the app runs against Postgres (users.id BIGSERIAL, FK
        // columns BIGINT), a JWT whose `sub` is not strictly numeric
        // blows up every downstream query with
        //   "invalid input syntax for type bigint: \"<sub>\""
        // and the 500 never clears the cookie, so the user stays stuck
        // (see [credits/balance] log spam for `feccb5ed-...` sub).
        //
        // Reject non-numeric subs in Postgres mode only. SQLite's type
        // system is lenient and the Jest mock DB in __tests__/helpers
        // uses string ids like `uid-1`, so the guard would otherwise
        // break every authenticated test.
        const rawSub = decoded.sub;
        const USE_POSTGRES = !!process.env.DATABASE_URL;
        if (USE_POSTGRES) {
          const numericSub = Number.parseInt(rawSub, 10);
          if (!Number.isFinite(numericSub) || String(numericSub) !== String(rawSub)) {
            res.clearCookie('kelion.token', { path: '/' });
            return res.status(401).json({ error: 'Stale token — please sign in again.' });
          }
        }
        req.user = {
          id: rawSub,
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
async function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Check admin status from DB (more reliable than JWT role)
  try {
    const dbUser = await findById(req.user.id);
    if (dbUser && dbUser.role === 'admin') {
      req.user.role = 'admin';
      return next();
    }
  } catch (_) { /* fall through to other checks */ }

  const defaultAdmins = ['adrianenc11@gmail.com'];
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const allAdmins = [...new Set([...defaultAdmins, ...adminEmails])];
  
  if (req.user.role === 'admin' || (req.user.email && allAdmins.includes(req.user.email.toLowerCase()))) {
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
