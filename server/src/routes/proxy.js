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

// Simple in-memory rate limiter (30 req/min per IP)
const WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const STREAM_HEADER_TIMEOUT_MS = 15_000;
const ratemap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const max = 30;
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
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local (includes cloud metadata endpoints)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark testing
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function parseIPv6ToBytes(ip) {
  const zoneIndex = ip.indexOf('%');
  const clean = (zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip).toLowerCase();
  if (!clean) return null;

  const ipv4Match = clean.match(/(.+):(\d+\.\d+\.\d+\.\d+)$/);
  let expanded = clean;
  if (ipv4Match) {
    const v4 = ipv4Match[2].split('.').map((n) => Number.parseInt(n, 10));
    if (v4.length !== 4 || v4.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    expanded = `${ipv4Match[1]}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = expanded.split('::');
  if (halves.length > 2) return null;
  const parseHextets = (segment) => {
    if (!segment) return [];
    const parts = segment.split(':');
    if (parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
    return parts.map((part) => Number.parseInt(part, 16));
  };
  const leftNums = parseHextets(halves[0]);
  const rightNums = parseHextets(halves[1] || '');
  if (!leftNums || !rightNums) return null;

  let hextets;
  if (halves.length === 1) {
    if (leftNums.length !== 8) return null;
    hextets = leftNums;
  } else {
    if (leftNums.length + rightNums.length > 8) return null;
    hextets = [...leftNums, ...Array(8 - leftNums.length - rightNums.length).fill(0), ...rightNums];
  }

  const bytes = [];
  for (const h of hextets) {
    bytes.push((h >> 8) & 0xff, h & 0xff);
  }
  return bytes;
}

function isPrivateIPv6(ip) {
  const bytes = parseIPv6ToBytes(ip);
  if (!bytes || bytes.length !== 16) return true;

  const isAllZero = bytes.every((b) => b === 0);
  const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (isAllZero || isLoopback) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast

  const isIpv4Mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIpv4Mapped) {
    return isPrivateIPv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  return false;
}

async function assertPublicUrl(targetUrl) {
  const rawHost = (targetUrl.hostname || '').toLowerCase();
  if (rawHost.includes('[') || rawHost.includes(']')) {
    if (!(rawHost.startsWith('[') && rawHost.endsWith(']'))) throw new Error('Invalid URL host');
  }
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host) throw new Error('Invalid URL host');
  // Block local hostnames up-front even if a custom DNS resolver rewrites them.
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::') {
    throw new Error('Private or internal URLs are not allowed');
  }

  const ipFamily = net.isIP(host);
  if (ipFamily === 4 && isPrivateIPv4(host)) throw new Error('Private or internal URLs are not allowed');
  if (ipFamily === 6 && isPrivateIPv6(host)) throw new Error('Private or internal URLs are not allowed');

  const resolved = await dns.lookup(host, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('Could not resolve target host');
  for (const addr of resolved) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) {
      throw new Error('Private or internal URLs are not allowed');
    }
    if (addr.family === 6 && isPrivateIPv6(addr.address)) {
      throw new Error('Private or internal URLs are not allowed');
    }
  }
}

router.get('/', async (req, res) => {
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
    // CRITICAL: We must explicitly set Content-Security-Policy here because
    // Helmet's global middleware adds `frame-ancestors 'self'` to ALL routes,
    // which would block the proxied content from rendering inside the monitor
    // iframe. This override runs after Helmet and takes final precedence.
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *;");
    res.setHeader('Access-Control-Allow-Origin', '*');

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

      // Remove any <meta http-equiv="Content-Security-Policy"> tags
      html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '');
      html = html.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '');

      // Neutralize JavaScript frame-busting code.
      // Many sites (Google, Facebook, etc.) have JS that checks:
      //   if (top !== self) top.location = self.location;
      // We inject a script BEFORE everything else that overrides `top`
      // to point to `self`, so the check passes silently.
      const frameBustNeutralizer = `<script>
try {
  // Override top/parent references so frame-busting JS thinks it's the top window
  Object.defineProperty(window, 'top', { get: function() { return window.self; }, configurable: false });
  Object.defineProperty(window, 'parent', { get: function() { return window.self; }, configurable: false });
} catch(e) {}
</script>`;
      // Inject neutralizer as early as possible (before <head> content)
      if (html.includes('<head')) {
        html = html.replace(/(<head[^>]*>)/i, `$1${frameBustNeutralizer}`);
      } else {
        html = frameBustNeutralizer + html;
      }

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

// ── Streaming media proxy ─────────────────────────────────────────
// GET /api/proxy/stream?url=http://... — pipes audio/video data directly
// without buffering the entire response in memory. The main proxy above
// uses arrayBuffer() which would consume unlimited RAM on infinite live
// streams (radio, IPTV). This endpoint streams chunk-by-chunk.
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
        // Timeout only the header phase; we clear it after fetch resolves.
        signal: controller.signal,
      });
    } finally {
      clearTimeout(fetchTimeout);
    }
    res.status(upstream.status);

    // Forward content-type and set CORS/CSP headers
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
