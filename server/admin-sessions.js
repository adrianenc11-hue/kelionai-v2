// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Session Tokens
// Issues short-lived random tokens instead of exposing raw secret
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');

const sessions = new Map();
const TTL = 24 * 60 * 60 * 1000; // 24 hours

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TTL);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (Date.now() > expires) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function revokeSession(token) {
  sessions.delete(token);
}

// Purge expired sessions every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [t, exp] of sessions) {
      if (now > exp) sessions.delete(t);
    }
  },
  60 * 60 * 1000
).unref();

module.exports = { createSession, validateSession, revokeSession };
