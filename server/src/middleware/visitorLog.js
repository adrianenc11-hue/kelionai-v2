'use strict';

// Visitor analytics middleware.
//
// Adrian 2026-04-20: "nu vad buton vizite reale cine a vizitat situl, ip
// tara restul datelor lor". This middleware records one row per SPA page
// load (HTML GET requests only — NOT per API call or per static asset).
// Country is read from CDN-provided headers (`cf-ipcountry`,
// `x-vercel-ip-country`, `x-appengine-country`). We never do external
// IP→country lookups on the request hot path.
//
// The write is fire-and-forget: the DB call is not awaited and any error
// is swallowed so a failing analytics insert can never delay or break a
// page load.

const { recordVisitorEvent } = require('../db');
const jwt = require('jsonwebtoken');
const config = require('../config');

function extractIp(req) {
  // Prefer the first entry of x-forwarded-for when behind a reverse proxy
  // (Railway, Cloudflare). `req.ip` reflects Express's `trust proxy`
  // setting which may or may not be enabled — belt and suspenders.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  if (req.ip) return req.ip;
  if (req.connection && req.connection.remoteAddress) return req.connection.remoteAddress;
  return null;
}

function extractCountry(req) {
  // Try every CDN header we might sit behind. Railway currently does not
  // add a geo header by default, but Cloudflare / Vercel / App Engine do,
  // and we might flip providers.
  const h = req.headers;
  return (
    h['cf-ipcountry'] ||
    h['x-vercel-ip-country'] ||
    h['x-appengine-country'] ||
    h['x-country-code'] ||
    null
  );
}

function extractUserFromToken(req) {
  // Same cookie name and secret as middleware/auth.js `requireAuth`. We
  // decode best-effort here; if it's missing or invalid the visitor row
  // is still written as an anonymous page load.
  try {
    const token = req.cookies && req.cookies['kelion.token'];
    if (!token) return null;
    const payload = jwt.verify(token, config.jwt && config.jwt.secret);
    if (!payload) return null;
    return { id: payload.id || null, email: payload.email || null };
  } catch (_) {
    return null;
  }
}

function looksLikePageLoad(req) {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  if (/^\/(api|auth)(\/|$)/.test(p)) return false;
  if (p === '/health' || p === '/ping' || p === '/favicon.ico' || p === '/robots.txt') return false;
  // Skip static assets: anything with a typical web-asset extension.
  if (/\.(js|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp3|mp4|webm|txt|xml|json)$/i.test(p)) return false;
  // Only log real HTML navigations — XHR/fetch requests set Accept to
  // `*/*` or `application/json`, not `text/html`.
  const accept = (req.headers['accept'] || '').toString();
  if (!/text\/html/i.test(accept)) return false;
  return true;
}

function visitorLog(req, res, next) {
  try {
    if (!looksLikePageLoad(req)) return next();
    const user = extractUserFromToken(req);
    const payload = {
      path: (req.path || '').slice(0, 300),
      ip: (extractIp(req) || '').slice(0, 64) || null,
      country: (extractCountry(req) || '').slice(0, 8) || null,
      userAgent: (req.headers['user-agent'] || '').toString().slice(0, 500) || null,
      referer: (req.headers['referer'] || req.headers['referrer'] || '').toString().slice(0, 500) || null,
      userId: user && user.id ? user.id : null,
      userEmail: user && user.email ? user.email : null,
    };
    // Fire and forget — we never wait on the DB write.
    recordVisitorEvent(payload).catch(() => {});
  } catch (_) {
    // Middleware must never fail.
  }
  next();
}

module.exports = { visitorLog };
