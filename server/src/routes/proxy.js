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
const router = Router();

// Simple in-memory rate limiter (30 req/min per IP)
const ratemap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const window = 60_000;
  const max = 30;
  let entry = ratemap.get(ip);
  if (!entry || now - entry.start > window) {
    entry = { start: now, count: 0 };
    ratemap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > max) return false;
  return true;
}
// Cleanup stale entries every 5 min
setInterval(() => {
  const cutoff = Date.now() - 120_000;
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
]);

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
    const upstream = await fetch(targetUrl.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KelionMonitor/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });

    // Forward status
    res.status(upstream.status);

    // Forward headers, stripping frame-blocking ones
    for (const [k, v] of upstream.headers.entries()) {
      if (BLOCKED_HEADERS.has(k.toLowerCase())) continue;
      try { res.setHeader(k, v); } catch { /* ignore invalid headers */ }
    }

    // Add permissive headers so the iframe works
    res.setHeader('X-Frame-Options', 'ALLOWALL');
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

module.exports = router;
