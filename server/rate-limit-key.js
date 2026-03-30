'use strict';
const logger = require('./logger');

/**
 * Smart rate-limit key generator: uses user ID from JWT for authenticated
 * requests, falls back to IP for anonymous. This prevents users behind
 * the same NAT/VPN from sharing a single rate-limit bucket.
 */
function rateLimitKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const token = auth.slice(7);
      const parts = token.split('.');
      if (parts.length === 3) {
        const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(Buffer.from(raw, 'base64').toString());
        if (payload.sub) return `user:${payload.sub}`;
      }
    } catch (err) {
      logger.debug({ component: 'RateLimit', err: err.message }, 'JWT parse failed, falling back to IP');
    }
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

module.exports = { rateLimitKey };
