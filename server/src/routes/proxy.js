'use strict';
// Monitor content proxy — strips X-Frame-Options and CSP frame-ancestors
// so ANY external URL can be embedded in the monitor iframe without a white screen.
//
// Usage: GET /api/proxy?url=https://embed.windy.com/...
//
// Security rules:
// - Only http/https URLs accepted.
// - Requests are made server-side (no CORS issues from browser).
// - We rewrite relative URLs in HTML to absolute so sub-resources load.
// - We remove X-Frame-Options and Content-Security-Policy headers.
// - We add permissive CORS + frame headers on the response.
// - Rate-limited to 30 req/min per IP to prevent abuse.

const { Router } = require('express');
const dns = require('dns/promises');
const net = require('net');
const { Readable } = require('stream');
const router = Router();

const WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const STREAM_HEADER_TIMEOUT_MS = 15_000;
const ratemap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const max = 300; // Increased to 300 to allow complex pages with many subresources
  let entry = ratemap.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { start: now, count: 0 };
    ratemap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > max) return false;
  return true;
}
// Cleanup stale entries every 5 min
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [k, v] of ratemap) {
    if (v.start < cutoff) ratemap.delete(k);
  }
}, 300_000).unref();

const BLOCKED_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'x-content-type-options',
  'report-to',
  'nel',
  // Don't forward these — let Express set its own
  'transfer-encoding',
  'connection',
  'keep-alive',
  // HTML is rewritten below, so upstream length/encoding may become stale.
  'content-length',
  'content-encoding',
]);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const zoneIndex = ip.indexOf('%');
  const clean = (zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip).toLowerCase();
  if (!clean) return true;
  const halves = clean.split('::');
  if (halves.length > 2) return true;
  const parseH = (s) => { if (!s) return []; const p = s.split(':'); if (p.some(x => !/^[0-9a-f]{1,4}$/i.test(x))) return null; return p.map(x => parseInt(x, 16)); };
  const left = parseH(halves[0]);
  const right = parseH(halves[1] || '');
  if (!left || !right) return true;
  let h;
  if (halves.length === 1) { if (left.length !== 8) return true; h = left; }
  else { if (left.length + right.length > 8) return true; h = [...left, ...Array(8 - left.length - right.length).fill(0), ...right]; }
  const b = []; for (const x of h) { b.push((x >> 8) & 0xff, x & 0xff); }
  if (b.length !== 16) return true;
  if (b.every(x => x === 0)) return true;
  if (b.slice(0, 15).every(x => x === 0) && b[15] === 1) return true;
  if ((b[0] & 0xfe) === 0xfc) return true;
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  if (b[0] === 0xff) return true;
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  return false;
}

async function assertPublicUrl(targetUrl) {
  const rawHost = (targetUrl.hostname || '').toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host) throw new Error('Invalid URL host');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::') {
    throw new Error('Private or internal URLs are not allowed');
  }
  const ipFamily = net.isIP(host);
  if (ipFamily === 4 && isPrivateIPv4(host)) throw new Error('Private or internal URLs are not allowed');
  if (ipFamily === 6 && isPrivateIPv6(host)) throw new Error('Private or internal URLs are not allowed');
  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('Could not resolve target host');
  for (const addr of resolved) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) throw new Error('Private or internal URLs are not allowed');
    if (addr.family === 6 && isPrivateIPv6(addr.address)) throw new Error('Private or internal URLs are not allowed');
  }
}

router.get('/', async (req, res) => {
  // Always set permissive CORS early so even errors (429, 400) don't trigger browser CORS warnings
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();

  if (!rateLimit(ip)) {
    return res.status(429).send('Rate limit exceeded. Please slow down.');
  }

  const rawUrl = (req.query.url || '').toString().trim();
  if (!rawUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

  // Only allow http/https
  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return res.status(400).send('Only http/https URLs are supported');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }
  try {
    await assertPublicUrl(targetUrl);
  } catch (err) {
    return res.status(400).send(err && err.message ? err.message : 'Invalid target URL');
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KelionMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // Forward status
    res.status(upstream.status);

    // Forward headers, stripping frame-blocking ones
    for (const [k, v] of upstream.headers.entries()) {
      if (BLOCKED_HEADERS.has(k.toLowerCase())) continue;
      try { res.setHeader(k, v); } catch { /* ignore invalid headers */ }
    }

    // Add permissive headers so the iframe works.
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;");
    res.setHeader('X-Content-Type-Options', 'none');

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('text/html')) {
      // For HTML: rewrite relative URLs to absolute so sub-resources load correctly
      let html = await upstream.text();

      // Inject <base href> so relative paths resolve to the original origin
      const baseTag = `<base href="${targetUrl.origin}${targetUrl.pathname.replace(/[^/]*$/, '')}">`;
      html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
      // If no <head>, inject at top
      if (!html.includes(baseTag)) {
        html = baseTag + html;
      }

      // Remove any <meta http-equiv="Content-Security-Policy"> tags and other frame-busters
      html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
      html = html.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');
      html = html.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, ''); // Prevent auto-redirects out of proxy
      html = html.replace(/<meta[^>]+name=["']?viewport["']?[^>]*>/gi, ''); // Let our CSS handle scaling if needed

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } else {
      // Binary/other content: pipe directly
      const buf = await upstream.arrayBuffer();
      res.send(Buffer.from(buf));
    }
  } catch (err) {
    console.warn('[proxy] fetch failed:', err && err.message);
    // Return a friendly error page that can display in the iframe
    res.status(502).setHeader('Content-Type', 'text/html').send(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8">
          <style>
            body { background: #0d0b1d; color: #ede9fe; font-family: system-ui; display: flex;
                   align-items: center; justify-content: center; height: 100vh; margin: 0; flex-direction: column; gap: 16px; }
            h2 { color: #a78bfa; font-size: 18px; }
            p { color: #94a3b8; font-size: 14px; max-width: 400px; text-align: center; }
            a { color: #7c3aed; }
          </style>
        </head>
        <body>
          <div style="font-size:48px">⚠️</div>
          <h2>Could not load content</h2>
          <p>${err && err.message ? err.message.slice(0, 200) : 'Network error'}</p>
          <a href="${rawUrl}" target="_blank" rel="noopener">Open directly ↗</a>
        </body>
      </html>
    `);
  }
});

// ── Streaming media proxy ─────────────────────────────────────────────
// GET /api/proxy/stream?url=http://... — pipes audio/video data directly
// without buffering the entire response in memory.

router.get('/stream', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  if (!rateLimit(ip)) {
    return res.status(429).send('Rate limit exceeded.');
  }

  const rawUrl = (req.query.url || '').toString().trim();
  if (!rawUrl) return res.status(400).send('Missing ?url= parameter');

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return res.status(400).send('Only http/https URLs are supported');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }
  try {
    await assertPublicUrl(targetUrl);
  } catch (err) {
    return res.status(400).send(err && err.message ? err.message : 'Invalid target URL');
  }

  try {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), STREAM_HEADER_TIMEOUT_MS);
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (compatible; KelionMonitor/1.0)',
      'Accept': 'audio/*, video/*, */*',
      'Icy-MetaData': '0',
    };
    for (const headerName of ['Range', 'If-Range', 'If-Modified-Since', 'If-None-Match']) {
      const headerValue = req.get(headerName);
      if (headerValue) requestHeaders[headerName] = headerValue;
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        redirect: 'follow',
        headers: requestHeaders,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(fetchTimeout);
    }

    res.status(upstream.status);

    // Forward content-type and range headers
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    for (const headerName of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']) {
      const headerValue = upstream.headers.get(headerName);
      if (headerValue) res.setHeader(headerName, headerValue);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    // Native fetch uses a Web ReadableStream; convert it before piping to Express.
    let nodeStream = null;
    if (upstream.body) {
      nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.pipe(res);
    } else {
      res.status(502).send('No response body');
    }

    // Clean up if client disconnects
    req.on('close', () => {
      try { if (nodeStream) nodeStream.destroy(); } catch {}
      try {
        if (upstream.body && upstream.body.cancel && !upstream.body.locked) upstream.body.cancel();
      } catch {}
    });
  } catch (err) {
    console.warn('[proxy/stream] error:', err && err.message);
    if (!res.headersSent) res.status(502).send('Stream proxy error');
  }
});

module.exports = router;
