'use strict';

// IP-based geolocation — no browser permission, no prompt.
// We read the client IP from standard proxy headers (Cloudflare, Railway,
// x-forwarded-for) and ask a free IP-geo endpoint. We cache per-IP for 1h
// so chat / voice sessions are snappy and we stay well inside free quotas.
//
// Provider: https://ipapi.co — 30k requests/month free, no key needed.
// If it fails we fall back to no location (the AI behaves as before).

const CACHE = new Map(); // ip -> { expires, data }
const TTL_MS = 60 * 60 * 1000; // 1 hour
const LOOKUP_TIMEOUT_MS = 1500; // don't stall token mint if ipapi is slow
// Hard cap on unique IPs held in memory. Expired entries are evicted on every
// read; if the Map is still growing past MAX_CACHE_ENTRIES (e.g. sudden burst
// of unique IPs inside a single TTL window), we drop the oldest-inserted
// entries first. Keeps the footprint bounded regardless of traffic shape.
const MAX_CACHE_ENTRIES = 2000;

function evictExpired(now) {
  for (const [ip, entry] of CACHE) {
    if (entry.expires <= now) CACHE.delete(ip);
  }
}

function enforceCap() {
  while (CACHE.size > MAX_CACHE_ENTRIES) {
    // Map iteration order is insertion order, so the first key is the oldest.
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

function clientIp(req) {
  // Prefer Cloudflare's CF-Connecting-IP, fall back to Railway/standard x-forwarded-for.
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.toString().split(',')[0].trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.toString().split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return real.toString().split(',')[0].trim();
  return (req.ip || req.connection?.remoteAddress || '').toString();
}

function isPrivate(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const n = parseInt(ip.split('.')[1] || '0', 10);
    if (n >= 16 && n <= 31) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local IPv6
  return false;
}

async function lookup(ip) {
  if (!ip || isPrivate(ip)) return null;
  const now = Date.now();
  // Lazy TTL + cap enforcement on every read keeps memory bounded without a
  // background timer (which wouldn't survive Railway cold starts anyway).
  evictExpired(now);
  const cached = CACHE.get(ip);
  if (cached && cached.expires > now) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KelionAI/1.0 (+https://kelionai.app)' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.error) return null;
    const data = {
      ip,
      city: j.city || null,
      region: j.region || null,
      country: j.country_name || j.country || null,
      countryCode: j.country_code || null,
      timezone: j.timezone || null,
      latitude: typeof j.latitude === 'number' ? j.latitude : null,
      longitude: typeof j.longitude === 'number' ? j.longitude : null,
      languages: j.languages || null,
    };
    CACHE.set(ip, { expires: Date.now() + TTL_MS, data });
    enforceCap();
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns a short human-friendly line to paste into the persona prompt.
// Empty string when we could not resolve anything.
function formatForPrompt(geo) {
  if (!geo) return '';
  const bits = [];
  if (geo.city) bits.push(geo.city);
  if (geo.region && geo.region !== geo.city) bits.push(geo.region);
  if (geo.country) bits.push(geo.country);
  const coords = (geo.latitude != null && geo.longitude != null)
    ? ` (${geo.latitude.toFixed(3)}, ${geo.longitude.toFixed(3)})`
    : '';
  const tz = geo.timezone ? `, timezone ${geo.timezone}` : '';
  return bits.length ? `${bits.join(', ')}${coords}${tz}` : '';
}

module.exports = {
  clientIp,
  lookup,
  formatForPrompt,
};
