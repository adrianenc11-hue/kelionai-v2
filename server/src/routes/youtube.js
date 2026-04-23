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
// When `YOUTUBE_API_KEY` is not configured OR the API call fails
// (quota exceeded, 5xx, etc.), we transparently fall back to scraping
// the public YouTube search-results page for the first videoId. This
// keeps "play some jazz" working in the 90% common case without
// requiring Adrian to spin up a Data API key + billing.
//
// The scrape path is opt-out via `YOUTUBE_SCRAPE_FALLBACK=0` for
// deployments that want strict no-fallback semantics; defaults to ON.

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

// ---- API-keyed path -------------------------------------------------
async function searchViaApi(q, apiKey) {
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
    return { upstreamError: true, status: r.status, text: text.slice(0, 200) };
  }
  const data = await r.json();
  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item || !item.id || !item.id.videoId) {
    return { empty: true };
  }
  return {
    videoId: item.id.videoId,
    title: item.snippet?.title || '',
    channelTitle: item.snippet?.channelTitle || '',
    thumbnail:
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      '',
  };
}

// ---- Scrape fallback ------------------------------------------------
// Fetches `https://www.youtube.com/results?search_query=<q>` and parses
// the embedded `ytInitialData` JSON for the first regular videoRenderer
// (skips shorts/ads/channels). YouTube's search-results HTML is stable
// enough for this to keep working across deployments; when the shape
// changes we fall through to null and the client sees the usual
// "external search card" fallback.
async function searchViaScrape(q) {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', q);
  // `hl=en&gl=US` nudges YouTube to serve the classic layout in English
  // so the scrape regex doesn't miss on locale-dependent markup.
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'US');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let r;
  try {
    r = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        // A desktop UA yields the richest ytInitialData payload. Mobile UAs
        // return a trimmed JSON that drops thumbnail URLs.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!r || !r.ok) return null;
  const html = await r.text().catch(() => '');
  if (!html) return null;

  // `var ytInitialData = {...};` is the canonical search-results payload.
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const sections =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const it of items) {
      const vr = it?.videoRenderer;
      if (!vr || !vr.videoId) continue;
      // Skip entries tagged as "LIVE" only when they lack a videoId; all
      // others (regular, premieres finished, upload) embed fine.
      const title = vr.title?.runs?.[0]?.text
        || vr.title?.accessibility?.accessibilityData?.label
        || '';
      const channelTitle = vr.ownerText?.runs?.[0]?.text
        || vr.longBylineText?.runs?.[0]?.text
        || '';
      const thumbs = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbs.length ? thumbs[thumbs.length - 1]?.url || '' : '';
      return {
        videoId: vr.videoId,
        title: String(title).slice(0, 200),
        channelTitle: String(channelTitle).slice(0, 120),
        thumbnail: String(thumbnail).slice(0, 400),
      };
    }
  }
  return null;
}

function scrapeEnabled() {
  // Opt-out via env flag so ops can disable the fallback if YouTube ever
  // pushes a ToS update we need to respect. Default ON.
  return String(process.env.YOUTUBE_SCRAPE_FALLBACK || '1').trim() !== '0';
}

/**
 * GET /api/youtube/search?q=…
 * → { videoId, title, channelTitle, thumbnail }
 *
 * Flow:
 *   1. If YOUTUBE_API_KEY is set → try the official Data API v3.
 *   2. If no key (or API returned 4xx/5xx/empty) AND scrape fallback is
 *      enabled → parse the public results HTML.
 *   3. Otherwise keep the legacy 404 / 204 / 502 semantics so the
 *      client's "external card" fallback still fires.
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim().slice(0, 200);
  if (!q) {
    return res.status(400).json({ error: 'Missing q' });
  }
  const cacheKey = q.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  const allowScrape = scrapeEnabled();

  try {
    if (apiKey) {
      const result = await searchViaApi(q, apiKey);
      if (result && result.videoId) {
        cachePut(cacheKey, result);
        return res.json(result);
      }
      if (result && result.upstreamError) {
        console.warn('[youtube/search] api upstream error', result.status, result.text);
        // Fall through to scrape fallback instead of bouncing the user
        // to the external card — quotaExceeded is the common case once
        // the free 10k units/day cap is hit and we can still play the
        // video via scrape.
        if (allowScrape) {
          const scraped = await searchViaScrape(q).catch(() => null);
          if (scraped && scraped.videoId) {
            cachePut(cacheKey, scraped);
            return res.json(scraped);
          }
        }
        return res.status(502).json({ error: 'YouTube upstream error', status: result.status });
      }
      if (result && result.empty) {
        // API returned zero embeddable results — try scraping for any
        // match the user can still watch (even if not flagged embeddable
        // in the API; YouTube's embeddable flag is conservative). If
        // scrape also misses, preserve the 204 contract.
        if (allowScrape) {
          const scraped = await searchViaScrape(q).catch(() => null);
          if (scraped && scraped.videoId) {
            cachePut(cacheKey, scraped);
            return res.json(scraped);
          }
        }
        return res.status(204).end();
      }
    }

    // No API key path — scrape straight away when enabled.
    if (!apiKey && allowScrape) {
      const scraped = await searchViaScrape(q).catch(() => null);
      if (scraped && scraped.videoId) {
        cachePut(cacheKey, scraped);
        return res.json(scraped);
      }
      return res.status(204).end();
    }

    // Scrape disabled AND no API key → preserve legacy 404 contract so
    // the client falls back to its external-results card.
    return res.status(404).json({ error: 'YouTube search not configured' });
  } catch (err) {
    console.error('[youtube/search] failed:', err && err.message);
    return res.status(500).json({ error: 'YouTube search failed' });
  }
});

module.exports = router;
module.exports._internal = { searchViaApi, searchViaScrape };
