'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserByGoogleId, findById, findByEmail, getUserByEmail } = require('../db');

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
        let effectiveSub = rawSub;
        if (USE_POSTGRES) {
          const numericSub = Number.parseInt(rawSub, 10);
          const isNumeric = Number.isFinite(numericSub) && String(numericSub) === String(rawSub);
          if (!isNumeric) {
            // Legacy token (pre-migration Google OAuth UUID sub, or stale
            // string id). Instead of locking the user out with "Stale
            // token — please sign in again.", transparently migrate the
            // session: look them up by the email claim in the same JWT,
            // re-issue a fresh token carrying the numeric user.id, and
            // overwrite the cookie. The request proceeds normally so
            // actions like POST /api/credits/checkout don't fail.
            let migratedUser = null;
            let migrationTrace = { triedEmail: null, emailErr: null, triedGoogleId: null, googleErr: null };
            if (decoded.email) {
              migrationTrace.triedEmail = String(decoded.email).toLowerCase();
              try {
                migratedUser = await findByEmail(decoded.email);
              } catch (e) {
                migrationTrace.emailErr = e && e.message;
                migratedUser = null;
              }
              // Case-insensitive fallback — some legacy tokens carry the
              // email in the original case from Google while the DB row
              // was lowercased at insert time (or vice-versa).
              if (!migratedUser) {
                try {
                  migratedUser = await findByEmail(String(decoded.email).toLowerCase());
                } catch (_) {}
              }
            }
            if (!migratedUser) {
              // Fallback: the non-numeric sub may BE the Google OAuth UUID
              // for this user (pre-Postgres sign-ins stored Google `sub`
              // directly). Look them up by google_id.
              migrationTrace.triedGoogleId = String(rawSub);
              try {
                migratedUser = await getUserByGoogleId(String(rawSub));
              } catch (e) {
                migrationTrace.googleErr = e && e.message;
              }
            }
            if (!migratedUser && decoded.email) {
              // Last resort: the JWT signature is valid (verified above
              // with our secret), so we trust its email+name claims.
              // This user DID have a DB row once; it was wiped by a
              // purge or schema reset. Re-create a shell row so the
              // request can proceed — without this path, a legitimately
              // signed-in user whose row was purged is permanently
              // locked out even though their JWT is cryptographically
              // valid and not expired.
              migrationTrace.autoCreate = { email: String(decoded.email).toLowerCase() };
              try {
                const created = await createUser({
                  google_id: String(rawSub),
                  email: String(decoded.email).toLowerCase(),
                  name: decoded.name || String(decoded.email).split('@')[0],
                  picture: null,
                });
                if (created && created.id) {
                  migratedUser = created;
                  migrationTrace.autoCreate.id = created.id;
                }
              } catch (e) {
                migrationTrace.autoCreateErr = e && e.message;
                // Unique-email race: another concurrent request may have
                // just created the row. Re-read and reuse.
                if (/UNIQUE|duplicate/i.test(e && e.message || '')) {
                  try {
                    migratedUser = await findByEmail(String(decoded.email).toLowerCase());
                  } catch (_) {}
                }
              }
            }
            if (!migratedUser || !migratedUser.id) {
              // Log ONCE per failure so Railway logs expose WHY migration
              // failed for this session. Zero PII beyond the email claim
              // (which the user already typed themselves at sign-in).
              try {
                console.warn('[auth] JWT migration failed', JSON.stringify({
                  rawSub: String(rawSub).slice(0, 40),
                  hasEmail: !!decoded.email,
                  trace: migrationTrace,
                }));
              } catch (_) {}
              res.clearCookie('kelion.token', { path: '/' });
              return res.status(401).json({
                error: 'Stale token — please sign in again.',
                code: 'stale_token',
                hint: 'Sign out, close the tab, open a new tab and sign in again with email + password.',
              });
            }
            const freshToken = jwt.sign(
              {
                sub: migratedUser.id,
                email: migratedUser.email,
                name: migratedUser.name,
                role: migratedUser.role || decoded.role || 'user',
              },
              config.jwt.secret,
              { expiresIn: config.jwt.expiresIn }
            );
            try {
              res.cookie('kelion.token', freshToken, {
                httpOnly: true,
                secure: !!config.isProduction,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                path: '/',
              });
            } catch (_) { /* cookie setting is best-effort */ }
            // Also expose the fresh token in a response header so the
            // SPA can stash it as its Bearer fallback immediately — the
            // next authenticated fetch will use the new token without
            // waiting for a page reload.
            try { res.setHeader('X-Kelion-Refreshed-Token', freshToken); } catch (_) {}
            effectiveSub = migratedUser.id;
            decoded.email = migratedUser.email;
            decoded.name = migratedUser.name;
            decoded.role = migratedUser.role || decoded.role || 'user';
          }
        }
        req.user = {
          id: effectiveSub,
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
