'use strict';

// F10 — Server-side YouTube search used by the stage monitor so that
// `show_on_monitor({ kind: 'video', query: 'country music playlist' })`
// returns a *real, embeddable* video id instead of the deprecated
// `listType=search` URL (which YouTube now rejects with Error 153 —
// see PR #160 for the prior client-side fallback). This endpoint wraps
// the official YouTube Data API v3 search.list and filters to
// `videoEmbeddable=true` so any id it hands back is guaranteed to load
// inside an iframe — the avatar's stage monitor can then play it for
// real.
//
// Opt-in: requires `YOUTUBE_API_KEY` in the environment. Without the
// key we intentionally 404 so the client falls back to the external
// "open YouTube search" card shipped in PR #160 — still better UX than
// a dead iframe, and no silent quota consumption if the key was
// unintentionally revoked.

const { Router } = require('express');

const router = Router();

// Lightweight in-process cache so the same query doesn't burn quota
// every time the user reopens the monitor. 10-minute TTL is enough for
// freshness while keeping the typical "play some jazz" flow free.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX    = 500;
const cache = new Map(); // key -> { ts, payload }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}
function cachePut(key, payload) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { ts: Date.now(), payload });
}

/**
 * GET /api/youtube/search?q=…
 * → { videoId, title, channelTitle, thumbnail }
 *
 * Returns 404 when YOUTUBE_API_KEY is not configured so the client can
 * fall back gracefully to the external results card.
 * Returns 204 when the search produced zero embeddable hits.
 */
router.get('/search', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(404).json({ error: 'YouTube search not configured' });
  }
  const q = (req.query.q || '').toString().trim().slice(0, 200);
  if (!q) {
    return res.status(400).json({ error: 'Missing q' });
  }
  const cacheKey = q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.json(cached);
  }
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('maxResults', '1');
    url.searchParams.set('q', q);
    url.searchParams.set('key', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let r;
    try {
      r = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.warn('[youtube/search] upstream error', r.status, text.slice(0, 200));
      return res.status(502).json({ error: 'YouTube upstream error', status: r.status });
    }
    const data = await r.json();
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (!item || !item.id || !item.id.videoId) {
      return res.status(204).end();
    }
    const payload = {
      videoId: item.id.videoId,
      title: item.snippet?.title || '',
      channelTitle: item.snippet?.channelTitle || '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        '',
    };
    cachePut(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error('[youtube/search] failed:', err && err.message);
    return res.status(500).json({ error: 'YouTube search failed' });
  }
});

module.exports = router;
