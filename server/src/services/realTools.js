'use strict';

/**
 * Real, deterministic tool executors for Kelion.
 *
 * All tools call free public APIs (no key required) so they work out of
 * the box on prod without adding any paid dependency:
 *
 *   - calculate        → mathjs (local, offline)
 *   - get_weather      → Open-Meteo (free, no key)
 *   - web_search       → DuckDuckGo Instant Answer (free, no key)
 *   - translate        → LibreTranslate (public instance, no key)
 *   - get_route        → OSRM + Nominatim (free, no key)
 *   - get_news         → GDELT Doc API (free, no key)
 *   - get_crypto_price → CoinGecko (free, no key)
 *   - get_stock_price  → Yahoo Finance query1 (free, unofficial)
 *
 * Each executor returns a small JSON-safe object that the LLM can read
 * back on the second streaming pass. Every error path is caught and
 * returned as `{ ok: false, error }` — the chat stream never throws.
 *
 * If paid keys are later added (SERPER_API_KEY, DEEPL_API_KEY, TAVILY_API_KEY,
 * NEWS_API_KEY, ALPHA_VANTAGE_KEY, …) the respective executor prefers
 * them automatically — no code change needed elsewhere.
 */

// Restricted mathjs instance — OOM guard against user expressions that
// construct huge matrices via `ones(N,N)` / `zeros(N,N)` / `range(...)`.
// Devin Review on PR #133 (BUG_0002) confirmed `ones(10000,10000)` allocates
// 752 MB even with the 500-char length cap, so we build a mathjs scope that
// disables every matrix-constructor, range, and factorial function. The
// remaining surface (arithmetic, trig, log, exp, pow, sqrt, comparisons…) is
// still enough for every user-facing calculator use case.
const { create, all } = require('mathjs');
const mathRestricted = create(all, {
  // Bignumber arithmetic with a soft precision cap keeps memory bounded
  // even for expressions like `factorial(1000)`.
  number: 'number',
});
// Save original gamma before we override it below — we need it for the
// capped replacement that still delegates to the Lanczos approximation.
const _origGamma = mathRestricted.gamma;
mathRestricted.import(
  {
    // Wipe the dangerous constructors + anything that builds arbitrary
    // sized collections. If a user really needs matrices they can use the
    // UI once we add a dedicated tool for it — not free-form math.
    ones: () => { throw new Error('matrix constructors disabled'); },
    zeros: () => { throw new Error('matrix constructors disabled'); },
    identity: () => { throw new Error('matrix constructors disabled'); },
    diag: () => { throw new Error('matrix constructors disabled'); },
    range: () => { throw new Error('range is disabled'); },
    concat: () => { throw new Error('concat is disabled'); },
    flatten: () => { throw new Error('flatten is disabled'); },
    resize: () => { throw new Error('resize is disabled'); },
    reshape: () => { throw new Error('reshape is disabled'); },
    matrix: () => { throw new Error('matrix is disabled'); },
    // Factorial / gamma — capped to prevent OOM (e.g. `1e9!`), but
    // still functional for university-level math (combinatorics,
    // probability, statistics).
    factorial: (n) => {
      const x = Number(n);
      if (!Number.isFinite(x) || x < 0 || x > 170) {
        throw new Error('factorial out of range (0..170)');
      }
      let out = 1;
      for (let i = 2; i <= x; i += 1) out *= i;
      return out;
    },
    // gamma(n) is essential for university-level statistics, probability,
    // and integral calculus. We delegate to mathjs's internal gamma but
    // cap the input to prevent memory abuse.
    gamma: (n) => {
      const x = Number(n);
      if (!Number.isFinite(x) || Math.abs(x) > 170) {
        throw new Error('gamma out of range (|n| ≤ 170)');
      }
      return _origGamma(x);
    },
    // Combinations C(n,k) and permutations P(n,k) for combinatorics
    combinations: (n, k) => {
      const ni = Math.round(Number(n)), ki = Math.round(Number(k));
      if (ni < 0 || ki < 0 || ki > ni || ni > 170) throw new Error('combinations out of range');
      let out = 1;
      for (let i = 1; i <= ki; i++) out = out * (ni - ki + i) / i;
      return Math.round(out);
    },
    permutations: (n, k) => {
      const ni = Math.round(Number(n)), ki = Math.round(Number(k));
      if (ni < 0 || ki < 0 || ki > ni || ni > 170) throw new Error('permutations out of range');
      let out = 1;
      for (let i = ni - ki + 1; i <= ni; i++) out *= i;
      return Math.round(out);
    },
  },
  { override: true }
);

function safeEvaluate(expr) {
  return mathRestricted.evaluate(expr);
}

// Small helper so every fetch has a hard deadline — voice/text chat
// stream expects the tool result within a couple of seconds, not 30s.
// Falls back to dynamic node-fetch import when running on a Node version
// that predates the global `fetch` (Devin Review BUG_0004-adjacent).
let nodeFetchPromise = null;
async function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  if (!nodeFetchPromise) {
    nodeFetchPromise = import('node-fetch').then((mod) => mod.default || mod);
  }
  return nodeFetchPromise;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000, retries = 2) {
  const fetchImpl = await getFetch();

  let lastErr;
  let lastStatus;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
      if (!r.ok && [502, 503, 504].includes(r.status) && attempt < retries) {
        lastStatus = r.status;
        await r.text().catch(() => ''); // drain body
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1))); // 1s, 2s backoff
        continue;
      }
      return r;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
        continue;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (lastErr) throw lastErr;
  throw new Error(`Request failed after retries with status ${lastStatus}`);
}

// ──────────────────────────────────────────────────────────────────
// SSRF guard — used by any tool that dereferences a user-supplied URL
// (fetch_url, rss_read). The rule is: https only, and the hostname
// must not resolve to a private / loopback / link-local / metadata
// range. Without this guard an unauthenticated caller could POST
// `{ url: 'http://169.254.169.254/latest/meta-data/' }` to
// /api/tools/execute and exfiltrate cloud metadata.
// Devin Review on PR #134 flagged this as the critical SSRF vector.
const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return true;
  const [a, b] = parts;
  if (a === 0) return true;                                   // 0.0.0.0/8
  if (a === 10) return true;                                  // 10/8
  if (a === 127) return true;                                 // loopback
  if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12
  if (a === 192 && b === 168) return true;                    // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
  if (a >= 224) return true;                                  // multicast + reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;  // ULA
  if (/^fe[89ab]/i.test(lower)) return true;                          // link-local fe80::/10 (fe80-febf)
  if (/^fe[cdef]/i.test(lower)) return true;                          // deprecated site-local fec0::/10
  if (lower.startsWith('ff')) return true;                            // multicast ff00::/8 (defense-in-depth; HTTP is TCP-only)
  if (lower.startsWith('::ffff:')) {
    // Node's WHATWG URL parser normalises ::ffff:A.B.C.D to ::ffff:XXXX:XXXX
    // (hex pair). Without the hex→dotted conversion below, isPrivateIPv4
    // receives a non-dotted string, its `.split('.').length !== 4` guard
    // trips, and every IPv4-mapped IPv6 host — including public ones like
    // 8.8.8.8 — is treated as private.
    const v4 = lower.slice('::ffff:'.length);
    const hexMatch = v4.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1], 16);
      const lo = Number.parseInt(hexMatch[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIPv4(dotted);
    }
    return isPrivateIPv4(v4);
  }
  return false;
}

async function assertPublicHttpsUrl(rawUrl) {
  if (!/^https:\/\//i.test(rawUrl)) {
    return { ok: false, error: 'url must start with https:// (http not allowed)' };
  }
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, error: 'invalid url' }; }
  const host = (parsed.hostname || '').toLowerCase();
  if (!host) return { ok: false, error: 'invalid host' };
  // Block well-known internal names outright — some DNS setups return
  // a public IP for "localhost" if the caller has a broken resolver.
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    // `.internal` also covers `metadata.google.internal` (GCP) and
    // `instance-data.internal` (AWS IMDS) without needing explicit entries.
    || host.endsWith('.internal')
    || host.endsWith('.local')
  ) {
    return { ok: false, error: 'private host blocked' };
  }
  // If the URL already contains a literal IP, skip DNS and validate it
  // directly. Strip IPv6 brackets that `URL` leaves on hostname.
  const ipLiteral = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const family = net.isIP(ipLiteral);
  if (family) {
    if (family === 4 && isPrivateIPv4(ipLiteral)) return { ok: false, error: 'private IP blocked' };
    if (family === 6 && isPrivateIPv6(ipLiteral)) return { ok: false, error: 'private IP blocked' };
    return { ok: true };
  }
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of addrs) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return { ok: false, error: 'resolved to private IP' };
      if (a.family === 6 && isPrivateIPv6(a.address)) return { ok: false, error: 'resolved to private IP' };
    }
  } catch (err) {
    return { ok: false, error: `dns lookup failed: ${err && err.message ? err.message : String(err)}` };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// calculate

function toolCalculate({ expression }) {
  const expr = (expression || '').toString().trim();
  if (!expr) return { ok: false, error: 'missing expression' };
  if (expr.length > 500) return { ok: false, error: 'expression too long (max 500 chars)' };
  try {
    const value = safeEvaluate(expr);
    let result;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      result = value;
    } else if (value != null && typeof value.toString === 'function') {
      result = value.toString();
    } else {
      result = JSON.stringify(value);
    }
    return { ok: true, expression: expr, result };
  } catch (err) {
    return { ok: false, error: 'invalid expression: ' + (err && err.message ? err.message : String(err)) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_weather

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`geocoding failed (${r.status})`);
  const data = await r.json();
  const hit = data && Array.isArray(data.results) && data.results[0];
  if (!hit) throw new Error(`could not find location "${city}"`);
  return {
    latitude: hit.latitude,
    longitude: hit.longitude,
    name: hit.name,
    country: hit.country || null,
    timezone: hit.timezone || null,
  };
}

async function toolGetWeather({ city, lat, lon, days, _maxDays }) {
  try {
    let place = null;
    let latitude = Number.parseFloat(lat);
    let longitude = Number.parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (!city) return { ok: false, error: 'provide city or lat+lon' };
      place = await geocodeCity(String(city).slice(0, 100));
      latitude = place.latitude;
      longitude = place.longitude;
    }
    // Default ceiling stays at 7 days to match the `get_weather` contract,
    // but `toolGetForecast` can pass `_maxDays: 16` so that the forecast
    // variant is not silently truncated to a week. Open-Meteo's free tier
    // supports up to 16 forecast_days.
    const ceiling = Math.max(1, Math.min(16, Number.parseInt(_maxDays, 10) || 7));
    const n = Math.max(1, Math.min(ceiling, Number.parseInt(days, 10) || 1));
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'
      + `&forecast_days=${n}&timezone=auto`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `weather API ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      location: place ? { name: place.name, country: place.country, latitude, longitude } : { latitude, longitude },
      current: data.current || null,
      daily: data.daily || null,
      units: { ...(data.current_units || {}), ...(data.daily_units || {}) },
      source: 'open-meteo.com',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// play_radio — global live-radio search via radio-browser.info
//
// Returns a directly-playable HTTP(S) stream URL for the matching
// station so the client can feed it into an HTML5 <audio> element.
// Bypasses the YouTube embed-restriction trap that drove "porneste un
// post de radio live" to error 153 — radio-browser stations expose
// raw `.aac` / `.mp3` / `.m3u8` URLs that play in any browser without
// X-Frame-Options trouble.
//
// API: https://api.radio-browser.info/ — community-mirrored, no key,
// rate-limited politely by sending a UA. We pick a random server from
// the public DNS round-robin so we never hammer one mirror. If a
// station's `url_resolved` is missing (the redirect chain failed at
// scrape time), fall back to `url`. The model gets back enough
// metadata to say "now playing Radio ZU, Bucharest" without further
// calls.
//
// Adrian's directive: Kelion must speak any language and find any
// station globally — radio-browser ships ~50,000 stations across
// every country. The optional `country` / `language` / `tag` filters
// let the model narrow down when the user is specific ("a French jazz
// station", "a Japanese news station"); the default `byname` search
// is fuzzy enough to handle "Europa FM", "BBC Radio 1", "NHK", etc.

let _radioBrowserHost = null;
async function getRadioBrowserHost() {
  if (_radioBrowserHost) return _radioBrowserHost;
  // The community keeps a JSON list of healthy mirrors. Pick one at
  // random so traffic is spread. Cache for the lifetime of the process
  // (the list is stable — Railway redeploys reset this anyway).
  try {
    const r = await fetchWithTimeout('https://all.api.radio-browser.info/json/servers', {}, 4000);
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const pick = arr[Math.floor(Math.random() * arr.length)];
        if (pick && typeof pick.name === 'string') {
          _radioBrowserHost = `https://${pick.name}`;
          return _radioBrowserHost;
        }
      }
    }
  } catch { /* fall through */ }
  _radioBrowserHost = 'https://de1.api.radio-browser.info';
  return _radioBrowserHost;
}

async function toolPlayRadio({ query, country, language, tag, limit }) {
  const q = (query || '').toString().trim();
  if (!q && !country && !language && !tag) {
    return { ok: false, error: 'provide query, country, language, or tag' };
  }
  const n = Math.max(1, Math.min(5, Number.parseInt(limit, 10) || 1));
  const host = await getRadioBrowserHost();
  // Prefer name search when a query is given; fall back to advanced
  // search when only filters are present.
  let url;
  if (q) {
    const params = new URLSearchParams({
      name: q,
      limit: String(n * 4),    // overfetch + filter to playable
      hidebroken: 'true',
      order: 'clickcount',     // popularity-weighted, biases to live
      reverse: 'true',
    });
    if (country) params.set('country', String(country).slice(0, 60));
    if (language) params.set('language', String(language).slice(0, 60));
    if (tag) params.set('tag', String(tag).slice(0, 40));
    url = `${host}/json/stations/search?${params.toString()}`;
  } else {
    const params = new URLSearchParams({
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: String(n * 4),
    });
    if (country) params.set('country', String(country).slice(0, 60));
    if (language) params.set('language', String(language).slice(0, 60));
    if (tag) params.set('tag', String(tag).slice(0, 40));
    url = `${host}/json/stations/search?${params.toString()}`;
  }
  try {
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'KelionAI/1.0 (+https://kelionai.app)' },
    }, 6000);
    if (!r.ok) return { ok: false, error: `radio-browser ${r.status}` };
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, error: `no station found for "${q || (country || language || tag)}"` };
    }
    // Filter to entries that have a working stream URL.
    const playable = arr
      .map((s) => ({
        name: (s.name || '').toString().trim(),
        url: (s.url_resolved || s.url || '').toString().trim(),
        country: (s.country || '').toString(),
        language: (s.language || '').toString(),
        codec: (s.codec || '').toString().toLowerCase(),
        bitrate: Number(s.bitrate) || null,
        homepage: (s.homepage || '').toString(),
        favicon: (s.favicon || '').toString(),
        tags: (s.tags || '').toString(),
      }))
      .filter((s) => /^https?:\/\//i.test(s.url) && s.name)
      // Drop video-only or DRM-locked codecs the browser can't play
      // inline. AAC / MP3 / Opus / Ogg cover the vast majority.
      .filter((s) => !s.codec || /(aac|mp3|opus|ogg|mpeg|flac)/.test(s.codec))
      .slice(0, n);
    if (playable.length === 0) {
      return { ok: false, error: 'no playable stream URL among matches' };
    }
    return {
      ok: true,
      stations: playable,
      // Convenience: the model usually wants the first one. Saves a
      // second round trip when it just needs to call play_audio_stream.
      pick: playable[0],
      source: 'radio-browser.info',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// web_search

async function toolWebSearch({ query, limit }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const n = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 5));

  // Priority 0: Google Custom Search API (requires GOOGLE_API_KEY + GOOGLE_CSE_ID)
  const googleSearchKey = process.env.GOOGLE_API_KEY;
  const googleCseId = process.env.GOOGLE_CSE_ID;
  if (googleSearchKey && googleCseId) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${googleSearchKey}&cx=${googleCseId}&q=${encodeURIComponent(q)}&num=${n}`;
      const r = await fetchWithTimeout(url);
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data.items) ? data.items.slice(0, n) : [];
        return {
          ok: true,
          query: q,
          results: items.map((o) => ({ title: o.title, url: o.link, snippet: o.snippet })),
          totalResults: data.searchInformation?.totalResults || null,
          source: 'google-custom-search',
        };
      }
    } catch (_) { /* fall through to Tavily */ }
  }

  // Priority 1: Tavily — AI-optimized search with summarization + URLs.
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey) {
    try {
      const r = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: q,
          max_results: n,
          search_depth: 'basic',
          include_answer: true,
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const results = Array.isArray(data.results) ? data.results.slice(0, n) : [];
        return {
          ok: true,
          query: q,
          results: results.map((o) => ({ title: o.title, url: o.url, snippet: o.content })),
          answer: data.answer || null,
          source: 'tavily.com',
        };
      }
    } catch (_) { /* fall through to Serper */ }
  }

  // Serper.dev preferred next if key present — richer results with URLs.
  // Falls back to DuckDuckGo Instant Answer (free, no key) otherwise.
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    try {
      const r = await fetchWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: n }),
      });
      if (r.ok) {
        const data = await r.json();
        const organic = Array.isArray(data.organic) ? data.organic.slice(0, n) : [];
        return {
          ok: true,
          query: q,
          results: organic.map((o) => ({ title: o.title, url: o.link, snippet: o.snippet })),
          answerBox: data.answerBox || null,
          source: 'serper.dev',
        };
      }
    } catch (_) { /* fall through to DuckDuckGo */ }
  }
  // DuckDuckGo Instant Answer — good for quick factual lookups
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetchWithTimeout(url);
    if (r.ok) {
      const data = await r.json();
      const results = [];
      if (data.AbstractText) {
        results.push({ title: data.Heading || q, url: data.AbstractURL || null, snippet: data.AbstractText });
      }
      if (Array.isArray(data.RelatedTopics)) {
        for (const t of data.RelatedTopics) {
          if (results.length >= n) break;
          if (t.Text && t.FirstURL) {
            results.push({ title: t.Text.split(' - ')[0] || t.Text, url: t.FirstURL, snippet: t.Text });
          } else if (Array.isArray(t.Topics)) {
            for (const inner of t.Topics) {
              if (results.length >= n) break;
              if (inner.Text && inner.FirstURL) {
                results.push({ title: inner.Text.split(' - ')[0] || inner.Text, url: inner.FirstURL, snippet: inner.Text });
              }
            }
          }
        }
      }
      if (results.length > 0) {
        return { ok: true, query: q, results, answer: data.Answer || null, source: 'duckduckgo.com' };
      }
    }
  } catch (_) { /* fall through to DDG HTML */ }

  // DuckDuckGo HTML search — real web results. The IA API above is just
  // a dictionary lookup. This scrapes the actual search page.
  // Tested 2026-04-29: returns 5+ organic results for diverse queries.
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const r = await fetchWithTimeout(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, 10000);
    if (r.ok) {
      const html = await r.text();
      const results = [];
      const re = /class="result\s+results_links\s+results_links_deep\s+web-result\s*">([\s\S]*?)(?=<div\s+class="result\s|<\/div>\s*<\/div>\s*<\/div>\s*$)/g;
      let match;
      while ((match = re.exec(html)) !== null && results.length < n) {
        const block = match[1];
        if (block.includes('result--ad')) continue;
        const hrefMatch = block.match(/href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]+)"/);
        if (!hrefMatch) continue;
        const uddgMatch = hrefMatch[1].match(/uddg=([^&]+)/);
        if (!uddgMatch) continue;
        const resultUrl = decodeURIComponent(uddgMatch[1]);
        if (resultUrl.includes('duckduckgo.com')) continue;
        const titleMatch = block.match(/class="result__a"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim() : '';
        const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim() : '';
        if (title) results.push({ title, url: resultUrl, snippet: snippet.slice(0, 300) });
      }
      if (results.length > 0) {
        return { ok: true, query: q, results, source: 'duckduckgo.com (html)' };
      }
    }
  } catch (_) { /* fall through to Bing */ }

  // Bing web search scraping — final fallback. DDG rate-limits servers
  // (returns 202 + captcha). Bing is more tolerant and consistently
  // returns organic results. Tested 2026-04-29: 5/5 for all test queries.
  try {
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=${Math.min(n, 10)}`;
    const r = await fetchWithTimeout(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, 10000);
    if (r.ok) {
      const html = await r.text();
      const results = [];
      const blocks = html.split('class="b_algo"');
      for (let i = 1; i < blocks.length && results.length < n; i++) {
        const block = blocks[i];
        const titleMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!titleMatch) continue;
        const resultUrl = titleMatch[1];
        const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        if (title && resultUrl) {
          results.push({ title, url: resultUrl, snippet: snippet.slice(0, 300) });
        }
      }
      if (results.length > 0) {
        return { ok: true, query: q, results, source: 'bing.com' };
      }
    }
  } catch (_) { /* give up */ }

  return { ok: false, query: q, error: 'No search results found.', suggestion: 'Try browse_web.' };
}

// ──────────────────────────────────────────────────────────────────
// translate

async function toolTranslate({ text, to, from }) {
  const src = (text || '').toString();
  if (!src.trim()) return { ok: false, error: 'missing text' };
  if (src.length > 5000) return { ok: false, error: 'text too long (max 5000 chars)' };
  const target = (to || '').toString().toLowerCase().slice(0, 5) || 'en';
  const source = (from || 'auto').toString().toLowerCase().slice(0, 5) || 'auto';

  // Priority 1: Google Cloud Translation API (professional, 500K chars/mo free)
  const googleApiKey = process.env.GOOGLE_API_KEY;
  if (googleApiKey) {
    try {
      const r = await fetchWithTimeout('https://translation.googleapis.com/language/translate/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: src,
          target,
          source: source === 'auto' ? undefined : source,
          key: googleApiKey,
          format: 'text',
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const t0 = data?.data?.translations?.[0];
        if (t0) {
          return {
            ok: true,
            translated: t0.translatedText,
            detectedSource: (t0.detectedSourceLanguage || source).toLowerCase(),
            target,
            source: 'google-translate',
          };
        }
      }
    } catch (_) { /* fall through to DeepL */ }
  }

  // Priority 2: DeepL — higher quality for EU languages.
  const deeplKey = process.env.DEEPL_API_KEY;
  if (deeplKey) {
    try {
      const host = deeplKey.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
      const body = new URLSearchParams();
      body.append('auth_key', deeplKey);
      body.append('text', src);
      body.append('target_lang', target.toUpperCase());
      if (source !== 'auto') body.append('source_lang', source.toUpperCase());
      const r = await fetchWithTimeout(`https://${host}/v2/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (r.ok) {
        const data = await r.json();
        const first = data && Array.isArray(data.translations) && data.translations[0];
        if (first) {
          return {
            ok: true,
            translated: first.text,
            detectedSource: (first.detected_source_language || source).toLowerCase(),
            target,
            source: 'deepl',
          };
        }
      }
    } catch (_) { /* fall through to LibreTranslate */ }
  }

  const endpoints = [
    process.env.LIBRETRANSLATE_URL,
    'https://translate.terraprint.co/translate',
    'https://libretranslate.de/translate',
  ].filter(Boolean);

  for (const url of endpoints) {
    try {
      const r = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: src, source, target, format: 'text' }),
      });
      if (!r.ok) continue;
      const data = await r.json();
      if (data && typeof data.translatedText === 'string') {
        return {
          ok: true,
          translated: data.translatedText,
          detectedSource: data.detectedLanguage?.language || source,
          target,
          source: 'libretranslate',
        };
      }
    } catch (_) { continue; }
  }

  // Priority 4: MyMemory — free, no key, 5000 words/day
  // MyMemory requires explicit 2-letter codes. 'autodetect' as source
  // triggers their auto-detection. Empty source causes INVALID LANGUAGE error.
  try {
    const mmSource = source === 'auto' ? 'autodetect' : source;
    const langPair = `${mmSource}|${target}`;
    const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(src)}&langpair=${encodeURIComponent(langPair)}`;
    const r = await fetchWithTimeout(mmUrl, {}, 8000);
    if (r.ok) {
      const data = await r.json();
      const txt = data?.responseData?.translatedText;
      // Guard against error messages returned as "translations"
      if (txt && !txt.startsWith('INVALID') && !txt.startsWith('MYMEMORY')) {
        return {
          ok: true,
          translated: txt,
          detectedSource: data.responseData?.detectedLanguage || mmSource,
          target,
          source: 'mymemory',
        };
      }
    }
  } catch (_) { /* give up */ }

  return { ok: false, error: 'no translation provider available' };
}

// ──────────────────────────────────────────────────────────────────
// get_forecast — 7+ day extended weather (wraps get_weather)

async function toolGetForecast({ city, lat, lon, days }) {
  const n = Math.max(1, Math.min(16, Number.parseInt(days, 10) || 7));
  // Pass the 16-day ceiling so toolGetWeather doesn't silently clamp to 7.
  return toolGetWeather({ city, lat, lon, days: n, _maxDays: 16 });
}

// ──────────────────────────────────────────────────────────────────
// get_air_quality — Open-Meteo Air Quality API (free, no key)
// OpenAQ v2 deprecated (410 Gone). Using Open-Meteo AQI instead.

async function toolGetAirQuality({ city, lat, lon }) {
  try {
    let latitude = Number.parseFloat(lat);
    let longitude = Number.parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (!city) return { ok: false, error: 'provide city or lat+lon' };
      const place = await geocodeCity(String(city).slice(0, 100));
      latitude = place.latitude;
      longitude = place.longitude;
    }
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `open-meteo-aqi ${r.status}` };
    const data = await r.json();
    const c = data.current || {};
    return {
      ok: true,
      coords: { latitude, longitude },
      location: { name: city || `${latitude.toFixed(2)},${longitude.toFixed(2)}` },
      aqi: c.european_aqi,
      pm2_5: c.pm2_5,
      pm10: c.pm10,
      ozone: c.ozone,
      no2: c.nitrogen_dioxide,
      so2: c.sulphur_dioxide,
      co: c.carbon_monoxide,
      source: 'open-meteo.com (air-quality)',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_news — GDELT Doc API v2 + GNews fallback

async function toolGetNews({ topic, query, lang, limit }) {
  const q = (topic || query || '').toString().trim() || 'world';
  const n = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 10));
  const l = (lang || '').toString().toLowerCase().slice(0, 8);

  // Priority 1: GDELT (free, no key)
  const langFilter = l ? ` sourcelang:${l}` : '';
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q + langFilter)}&mode=artlist&format=json&maxrecords=${n}&sort=datedesc`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if (r.ok) {
      const data = await r.json();
      const arts = Array.isArray(data.articles) ? data.articles.slice(0, n) : [];
      if (arts.length > 0) {
        return {
          ok: true,
          topic: q,
          articles: arts.map((a) => ({
            title: a.title,
            url: a.url,
            source: a.sourcecountry ? `${a.domain} (${a.sourcecountry})` : a.domain,
            seendate: a.seendate,
            language: a.language,
          })),
          source: 'gdeltproject.org',
        };
      }
    }
  } catch (_) { /* fall through to GNews */ }

  // Priority 2: GNews (free tier, 100 req/day)
  const gnewsKey = process.env.GNEWS_API_KEY;
  if (gnewsKey) {
    try {
      const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&max=${n}&token=${gnewsKey}${l ? `&lang=${l}` : ''}`;
      const r = await fetchWithTimeout(url);
      if (r.ok) {
        const data = await r.json();
        const arts = Array.isArray(data.articles) ? data.articles.slice(0, n) : [];
        return {
          ok: true, topic: q,
          articles: arts.map((a) => ({ title: a.title, url: a.url, source: a.source?.name || '', seendate: a.publishedAt })),
          source: 'gnews.io',
        };
      }
    } catch (_) { /* fall through */ }
  }

  // Priority 3: NewsAPI.org
  const newsApiKey = process.env.NEWSAPI_KEY;
  if (newsApiKey) {
    try {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=${n}&sortBy=publishedAt&apiKey=${newsApiKey}${l ? `&language=${l}` : ''}`;
      const r = await fetchWithTimeout(url);
      if (r.ok) {
        const data = await r.json();
        const arts = Array.isArray(data.articles) ? data.articles.slice(0, n) : [];
        return {
          ok: true, topic: q,
          articles: arts.map((a) => ({ title: a.title, url: a.url, source: a.source?.name || '', seendate: a.publishedAt })),
          source: 'newsapi.org',
        };
      }
    } catch (_) { /* give up */ }
  }

  return { ok: false, error: 'news unavailable (rate limited — try again in a minute)' };
}

// ──────────────────────────────────────────────────────────────────
// get_crypto_price — CoinGecko simple price

// Map common tickers → CoinGecko IDs so the model can pass either.
const CRYPTO_TICKER_MAP = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', doge: 'dogecoin',
  ada: 'cardano', xrp: 'ripple', ltc: 'litecoin', bch: 'bitcoin-cash',
  bnb: 'binancecoin', dot: 'polkadot', avax: 'avalanche-2', matic: 'matic-network',
  trx: 'tron', link: 'chainlink', atom: 'cosmos', usdt: 'tether', usdc: 'usd-coin',
};

async function toolGetCryptoPrice({ coin, ids, vs }) {
  const rawList = (ids || coin || 'bitcoin').toString().toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const resolved = rawList.map((id) => CRYPTO_TICKER_MAP[id] || id);
  const c = resolved.join(',');
  const v = (vs || 'usd').toString().toLowerCase().trim();
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(c)}&vs_currencies=${encodeURIComponent(v)}&include_24hr_change=true&include_market_cap=true`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `coingecko ${r.status}` };
    const data = await r.json();
    if (!data || Object.keys(data).length === 0) {
      return { ok: false, error: `unknown coin id(s) "${c}" (try 'bitcoin', 'ethereum', 'solana' …)` };
    }
    // Both a per-coin map and the legacy single-coin shape so existing callers keep working.
    const prices = {};
    for (const [id, entry] of Object.entries(data)) {
      prices[id] = {
        [v]: entry[v],
        [`${v}_market_cap`]: entry[`${v}_market_cap`] ?? null,
        [`${v}_24h_change`]: entry[`${v}_24h_change`] ?? null,
      };
    }
    const firstId = Object.keys(data)[0];
    const first = data[firstId];
    return {
      ok: true,
      coin: firstId,
      vs: v,
      price: first?.[v] ?? null,
      marketCap: first?.[`${v}_market_cap`] ?? null,
      change24h: first?.[`${v}_24h_change`] ?? null,
      prices,
      source: 'coingecko.com',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_stock_price — Yahoo Finance query1 (free, no key, unofficial)

async function toolGetStockPrice({ symbol }) {
  const s = (symbol || '').toString().trim().toUpperCase();
  if (!s) return { ok: false, error: 'missing symbol' };
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1d`;
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Kelion/1.0)' },
    });
    if (!r.ok) return { ok: false, error: `yahoo ${r.status}` };
    const data = await r.json();
    const res = data?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta) return { ok: false, error: `unknown symbol "${s}"` };
    return {
      ok: true,
      symbol: s,
      price: meta.regularMarketPrice,
      currency: meta.currency,
      previousClose: meta.chartPreviousClose,
      exchange: meta.exchangeName,
      dayRange: { low: meta.regularMarketDayLow, high: meta.regularMarketDayHigh },
      source: 'query1.finance.yahoo.com',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_forex / currency_convert — exchangerate.host (free, no key)

async function toolGetForex({ base, from, to, amount }) {
  const b = (base || from || 'USD').toString().toUpperCase().slice(0, 3);
  const t = (to || 'EUR').toString().toUpperCase().slice(0, 3);
  const a = Number.parseFloat(amount);
  const amt = Number.isFinite(a) ? a : 1;

  // Priority 1: frankfurter.app — free, no key, ECB data
  try {
    const url = `https://api.frankfurter.app/latest?from=${b}&to=${t}&amount=${amt}`;
    const r = await fetchWithTimeout(url);
    if (r.ok) {
      const data = await r.json();
      if (data.rates && data.rates[t] != null) {
        return {
          ok: true, base: b, from: b, to: t,
          rate: data.rates[t] / amt,
          amount: amt, result: data.rates[t],
          date: data.date, source: 'frankfurter.app (ECB)',
        };
      }
    }
  } catch (_) { /* fall through */ }

  // Priority 2: open.er-api.com — free, no key
  try {
    const url = `https://open.er-api.com/v6/latest/${b}`;
    const r = await fetchWithTimeout(url);
    if (r.ok) {
      const data = await r.json();
      if (data.rates && data.rates[t] != null) {
        const rate = data.rates[t];
        return {
          ok: true, base: b, from: b, to: t,
          rate, amount: amt, result: +(rate * amt).toFixed(4),
          date: data.time_last_update_utc, source: 'open.er-api.com',
        };
      }
    }
  } catch (_) { /* fall through */ }

  return { ok: false, error: `Could not convert ${b} to ${t}` };
}

const toolCurrencyConvert = toolGetForex;

// ──────────────────────────────────────────────────────────────────
// get_earthquakes — USGS GeoJSON feed

async function toolGetEarthquakes({ minMagnitude, min_magnitude, period, limit }) {
  // Accept both camelCase and snake_case — catalog uses `min_magnitude`.
  const mag = Math.max(0, Math.min(9, Number.parseFloat(minMagnitude ?? min_magnitude) || 2.5));
  const feed = { hour: 'all_hour', day: 'all_day', week: 'all_week', month: 'all_month' }[
    (period || 'day').toString().toLowerCase()
  ] || 'all_day';
  const cap = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 10));
  try {
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `usgs ${r.status}` };
    const data = await r.json();
    const quakes = (data.features || [])
      .filter((f) => (f.properties?.mag ?? 0) >= mag)
      .slice(0, cap)
      .map((f) => ({
        magnitude: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toISOString(),
        url: f.properties.url,
        coords: f.geometry?.coordinates || null,
      }));
    return { ok: true, minMagnitude: mag, period: period || 'day', count: quakes.length, quakes, source: 'usgs.gov' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_sun_times — sunrise-sunset.org

async function toolGetSunTimes({ city, lat, lon, date }) {
  try {
    let latitude = Number.parseFloat(lat);
    let longitude = Number.parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (!city) return { ok: false, error: 'provide city or lat+lon' };
      const place = await geocodeCity(String(city).slice(0, 100));
      latitude = place.latitude;
      longitude = place.longitude;
    }
    const d = date ? `&date=${encodeURIComponent(date)}` : '';
    const url = `https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&formatted=0${d}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `sunrise-sunset ${r.status}` };
    const data = await r.json();
    if (data.status !== 'OK') return { ok: false, error: data.status };
    return {
      ok: true,
      coords: { latitude, longitude },
      date: date || 'today',
      sunrise: data.results.sunrise,
      sunset: data.results.sunset,
      solar_noon: data.results.solar_noon,
      day_length: data.results.day_length,
      civil_twilight_begin: data.results.civil_twilight_begin,
      civil_twilight_end: data.results.civil_twilight_end,
      source: 'sunrise-sunset.org',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_moon_phase — computed from Julian date (offline, deterministic)

function toolGetMoonPhase({ date }) {
  try {
    const d = date ? new Date(date) : new Date();
    if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid date' };
    // Normalization: known new moon 2000-01-06 18:14 UT → JD 2451550.1
    const jd = d.getTime() / 86400000 + 2440587.5;
    const days = jd - 2451550.1;
    const cycles = days / 29.530588853;
    const phase = cycles - Math.floor(cycles); // 0..1
    const names = [
      'new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
      'full moon', 'waning gibbous', 'last quarter', 'waning crescent',
    ];
    const bucket = Math.floor(((phase + 1 / 16) * 8)) % 8;
    return {
      ok: true,
      date: d.toISOString(),
      phase: phase.toFixed(4),
      illumination_percent: Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50),
      name: names[bucket],
      age_days: (phase * 29.530588853).toFixed(2),
      source: 'computed (Jean Meeus algorithm, offline)',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// Nominatim helpers — geocode / reverse_geocode / nearby_places

const NOMINATIM_HEADERS = {
  'User-Agent': 'Kelion/1.0 (https://kelionai.app)',
  'Accept-Language': 'en',
};

async function toolGeocode({ query, address, city, place }) {
  const q = (query || address || city || place || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
    const r = await fetchWithTimeout(url, { headers: NOMINATIM_HEADERS });
    if (!r.ok) return { ok: false, error: `nominatim ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      query: q,
      results: (data || []).slice(0, 5).map((h) => ({
        latitude: Number.parseFloat(h.lat),
        longitude: Number.parseFloat(h.lon),
        displayName: h.display_name,
        type: h.type,
        address: h.address || null,
      })),
      source: 'nominatim.openstreetmap.org',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolReverseGeocode({ lat, lon }) {
  const latitude = Number.parseFloat(lat);
  const longitude = Number.parseFloat(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, error: 'missing lat/lon' };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
    const r = await fetchWithTimeout(url, { headers: NOMINATIM_HEADERS });
    if (!r.ok) return { ok: false, error: `nominatim ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      coords: { latitude, longitude },
      displayName: data.display_name,
      address: data.address || null,
      source: 'nominatim.openstreetmap.org',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_route — OSRM (free, no key) + Nominatim for addresses

async function resolveCoord(input) {
  if (!input) return null;
  if (typeof input === 'object' && Number.isFinite(input.lat) && Number.isFinite(input.lon)) {
    return { latitude: input.lat, longitude: input.lon };
  }
  const s = String(input).trim();
  // "lat,lon" shorthand
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { latitude: Number.parseFloat(m[1]), longitude: Number.parseFloat(m[2]) };
  const g = await toolGeocode({ query: s });
  return g.ok && g.results[0] ? { latitude: g.results[0].latitude, longitude: g.results[0].longitude } : null;
}

async function toolGetRoute({ from, to, mode, profile: profileArg }) {
  const a = await resolveCoord(from);
  const b = await resolveCoord(to);
  if (!a || !b) return { ok: false, error: `could not resolve ${a ? 'destination' : 'origin'}` };
  const rawMode = (mode || profileArg || 'driving').toString().toLowerCase();

  // Priority 1: Google Directions API (real-time traffic, transit, accurate)
  const googleKey = process.env.GOOGLE_API_KEY;
  if (googleKey) {
    const googleMode = { driving: 'driving', car: 'driving', walking: 'walking', walk: 'walking', cycling: 'bicycling', bike: 'bicycling', transit: 'transit' }[rawMode] || 'driving';
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${a.latitude},${a.longitude}&destination=${b.latitude},${b.longitude}&mode=${googleMode}&language=ro&key=${googleKey}`;
      const r = await fetchWithTimeout(url);
      if (r.ok) {
        const data = await r.json();
        if (data.status === 'OK' && data.routes && data.routes[0]) {
          const route = data.routes[0];
          const leg = route.legs[0];
          const steps = (leg.steps || []).slice(0, 10).map(s => ({
            instruction: (s.html_instructions || '').replace(/<[^>]+>/g, ''),
            distance: s.distance?.text,
            duration: s.duration?.text,
          }));
          return {
            ok: true,
            from: { ...a, address: leg.start_address },
            to: { ...b, address: leg.end_address },
            mode: googleMode,
            distance_km: +(leg.distance.value / 1000).toFixed(2),
            distance_text: leg.distance.text,
            duration_min: +(leg.duration.value / 60).toFixed(1),
            duration_text: leg.duration.text,
            duration_in_traffic: leg.duration_in_traffic?.text || null,
            steps,
            source: 'google-directions',
          };
        }
      }
    } catch (_) { /* fall through to OSRM */ }
  }

  // Fallback: OSRM (free, no key needed)
  const profile = { driving: 'driving', car: 'driving', walking: 'foot', walk: 'foot', cycling: 'bike', bike: 'bike' }[rawMode] || 'driving';
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=false&alternatives=false&steps=false`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `osrm ${r.status}` };
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route) return { ok: false, error: 'no route found' };
    return {
      ok: true,
      from: a,
      to: b,
      mode: profile,
      distance_km: +(route.distance / 1000).toFixed(2),
      duration_min: +(route.duration / 60).toFixed(1),
      source: 'project-osrm.org',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// nearby_places — Overpass (OSM) POI search around a coordinate

const AMENITY_MAP = {
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  bar: '["amenity"="bar"]',
  pub: '["amenity"="pub"]',
  atm: '["amenity"="atm"]',
  bank: '["amenity"="bank"]',
  pharmacy: '["amenity"="pharmacy"]',
  hospital: '["amenity"="hospital"]',
  supermarket: '["shop"="supermarket"]',
  gas: '["amenity"="fuel"]',
  fuel: '["amenity"="fuel"]',
  parking: '["amenity"="parking"]',
  hotel: '["tourism"="hotel"]',
  charging: '["amenity"="charging_station"]',
};

async function toolNearbyPlaces({ lat, lon, category, query: queryArg, radius, radius_m, limit }) {
  const latitude = Number.parseFloat(lat);
  const longitude = Number.parseFloat(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, error: 'missing lat/lon' };
  // Catalog uses `query` + `radius_m` + `limit`; legacy callers pass `category` + `radius`.
  const c = (queryArg || category || 'restaurant').toString().toLowerCase();
  const filter = AMENITY_MAP[c] || `["amenity"="${c.replace(/"/g, '')}"]`;
  const rad = Math.max(50, Math.min(10000, Number.parseInt(radius_m ?? radius, 10) || 1500));
  const cap = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 10));
  const query = `[out:json][timeout:10];(node${filter}(around:${rad},${latitude},${longitude}););out body ${cap};`;
  try {
    // Use form-urlencoded (Overpass returns 406 with text/plain)
    const r = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!r.ok) return { ok: false, error: `overpass ${r.status}` };
    const data = await r.json();
    const elements = (data.elements || []).slice(0, 15);
    return {
      ok: true,
      category: c,
      center: { latitude, longitude },
      radius_m: rad,
      count: elements.length,
      places: elements.map((e) => ({
        name: e.tags?.name || '(unnamed)',
        latitude: e.lat,
        longitude: e.lon,
        tags: e.tags || null,
      })),
      source: 'overpass-api.de',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_elevation — Open-Elevation

async function toolGetElevation({ lat, lon }) {
  const latitude = Number.parseFloat(lat);
  const longitude = Number.parseFloat(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, error: 'missing lat/lon' };

  // Priority 1: Open-Meteo Elevation API (fast, reliable)
  try {
    const omUrl = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;
    const omR = await fetchWithTimeout(omUrl, {}, 5000);
    if (omR.ok) {
      const omData = await omR.json();
      const elev = Array.isArray(omData.elevation) ? omData.elevation[0] : null;
      if (elev != null) {
        return { ok: true, latitude, longitude, elevation_m: elev, source: 'open-meteo.com' };
      }
    }
  } catch (_) { /* fall through */ }

  // Priority 2: Open-Elevation (sometimes slow/timeout)
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${latitude},${longitude}`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if (!r.ok) return { ok: false, error: `open-elevation ${r.status}` };
    const data = await r.json();
    const hit = data.results && data.results[0];
    if (!hit) return { ok: false, error: 'no elevation data' };
    return { ok: true, coords: { latitude, longitude }, elevation_m: hit.elevation, source: 'open-elevation.com' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_timezone — timeapi.io

async function toolGetTimezone({ city, lat, lon }) {
  try {
    let latitude = Number.parseFloat(lat);
    let longitude = Number.parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (!city) return { ok: false, error: 'provide city or lat+lon' };
      const place = await geocodeCity(String(city).slice(0, 100));
      latitude = place.latitude;
      longitude = place.longitude;
    }
    const url = `https://www.timeapi.io/api/Time/current/coordinate?latitude=${latitude}&longitude=${longitude}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `timeapi ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      coords: { latitude, longitude },
      timezone: data.timeZone,
      dateTime: data.dateTime,
      dayOfWeek: data.dayOfWeek,
      dstActive: data.dstActive,
      source: 'timeapi.io',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// unit_convert — deterministic, offline

const UNIT_CONVERSIONS = {
  // length (to meters)
  m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, miles: 1609.344,
  yd: 0.9144, ft: 0.3048, in: 0.0254, nm: 1852,
  // mass (to kilograms)
  kg: 1, g: 0.001, mg: 1e-6, t: 1000, lb: 0.45359237, lbs: 0.45359237, oz: 0.0283495,
  // volume (to liters)
  l: 1, ml: 0.001, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.236588, floz: 0.0295735,
  // time (to seconds)
  s: 1, min: 60, h: 3600, hr: 3600, day: 86400, wk: 604800,
  // data size (to bytes). Decimal (kB=1000) + binary (KiB=1024) so either
  // convention works. The KELION_TOOLS catalog advertises GB/MB as
  // examples, so we need these here.
  b: 1, byte: 1, bytes: 1,
  kb: 1000, mb: 1000 * 1000, gb: 1000 ** 3, tb: 1000 ** 4, pb: 1000 ** 5,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, pib: 1024 ** 5,
};
const UNIT_CATEGORY = {
  m: 'length', km: 'length', cm: 'length', mm: 'length', mi: 'length', miles: 'length',
  yd: 'length', ft: 'length', in: 'length', nm: 'length',
  kg: 'mass', g: 'mass', mg: 'mass', t: 'mass', lb: 'mass', lbs: 'mass', oz: 'mass',
  l: 'volume', ml: 'volume', gal: 'volume', qt: 'volume', pt: 'volume', cup: 'volume', floz: 'volume',
  s: 'time', min: 'time', h: 'time', hr: 'time', day: 'time', wk: 'time',
  b: 'data', byte: 'data', bytes: 'data',
  kb: 'data', mb: 'data', gb: 'data', tb: 'data', pb: 'data',
  kib: 'data', mib: 'data', gib: 'data', tib: 'data', pib: 'data',
};

function toolUnitConvert({ value, from, to }) {
  const v = Number.parseFloat(value);
  if (!Number.isFinite(v)) return { ok: false, error: 'missing/invalid value' };
  // Normalize: lowercase + strip degree symbol / trailing "deg" prefix so
  // that `degF`, `°F`, `Deg c`, `Fahrenheit` all resolve to the same key.
  const normalize = (raw) => (raw || '').toString().toLowerCase().replace(/[°\s]/g, '').trim();
  const f = normalize(from);
  const t = normalize(to);
  // Temperature — non-linear, handled separately. Accept the full set of
  // aliases we advertise in the KELION_TOOLS catalog (degC/degF/degK).
  const TEMP_ALIASES = {
    c: 'c', degc: 'c', celsius: 'c',
    f: 'f', degf: 'f', fahrenheit: 'f',
    k: 'k', degk: 'k', kelvin: 'k',
  };
  const tempKey = (k) => TEMP_ALIASES[k];
  const fT = tempKey(f);
  const tT = tempKey(t);
  if (fT && tT) {
    let celsius;
    if (fT === 'c') celsius = v;
    else if (fT === 'f') celsius = (v - 32) * 5 / 9;
    else celsius = v - 273.15;
    let out;
    if (tT === 'c') out = celsius;
    else if (tT === 'f') out = celsius * 9 / 5 + 32;
    else out = celsius + 273.15;
    return { ok: true, value: v, from: fT, to: tT, result: +out.toFixed(6), category: 'temperature' };
  }
  if (!UNIT_CONVERSIONS[f] || !UNIT_CONVERSIONS[t]) return { ok: false, error: `unknown unit "${UNIT_CONVERSIONS[f] ? t : f}"` };
  if (UNIT_CATEGORY[f] !== UNIT_CATEGORY[t]) return { ok: false, error: `can't convert ${UNIT_CATEGORY[f]} to ${UNIT_CATEGORY[t]}` };
  const result = v * UNIT_CONVERSIONS[f] / UNIT_CONVERSIONS[t];
  return { ok: true, value: v, from: f, to: t, result: +result.toFixed(6), category: UNIT_CATEGORY[f] };
}

// ──────────────────────────────────────────────────────────────────
// search_academic — arXiv API

async function toolSearchAcademic({ query, limit }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const n = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 5));
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=${n}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `arxiv ${r.status}` };
    const text = await r.text();
    // Very small XML parser — arXiv atom feed.
    const entries = Array.from(text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)).slice(0, n);
    const results = entries.map((m) => {
      const block = m[1];
      const pick = (tag) => {
        const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return mm ? mm[1].replace(/\s+/g, ' ').trim() : null;
      };
      const idMatch = block.match(/<id>([\s\S]*?)<\/id>/);
      const authors = Array.from(block.matchAll(/<name>([\s\S]*?)<\/name>/g)).map((a) => a[1].trim());
      return {
        title: pick('title'),
        summary: pick('summary'),
        published: pick('published'),
        url: idMatch ? idMatch[1].trim() : null,
        authors: authors.slice(0, 5),
      };
    });
    return { ok: true, query: q, results, source: 'arxiv.org' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// search_github — GitHub Search API (unauth, 10 req/min)

async function toolSearchGithub({ query, type, limit }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const n = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 5));
  const kind = ({ repo: 'repositories', repos: 'repositories', repositories: 'repositories', code: 'code', issue: 'issues', issues: 'issues', user: 'users', users: 'users' }[
    (type || 'repositories').toString().toLowerCase()
  ]) || 'repositories';
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Kelion/1.0' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const url = `https://api.github.com/search/${kind}?q=${encodeURIComponent(q)}&per_page=${n}`;
    const r = await fetchWithTimeout(url, { headers });
    if (!r.ok) return { ok: false, error: `github ${r.status}` };
    const data = await r.json();
    const items = Array.isArray(data.items) ? data.items.slice(0, n) : [];
    return {
      ok: true,
      query: q,
      type: kind,
      total: data.total_count,
      results: items.map((i) => ({
        name: i.full_name || i.name || i.login,
        url: i.html_url,
        description: i.description || i.bio || null,
        stars: i.stargazers_count ?? null,
        language: i.language ?? null,
      })),
      source: 'api.github.com',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// search_stackoverflow — StackExchange API

async function toolSearchStackoverflow({ query, limit }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const n = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 5));
  try {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=${n}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `stackexchange ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      query: q,
      results: (data.items || []).slice(0, n).map((it) => ({
        title: it.title,
        url: it.link,
        score: it.score,
        answered: it.is_answered,
        answer_count: it.answer_count,
        tags: it.tags,
      })),
      source: 'stackoverflow.com',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// fetch_url — GET a URL and return text content (truncated)

async function toolFetchUrl({ url, max_chars }) {
  const u = (url || '').toString().trim();
  // SSRF guard: https only + no private/loopback/metadata IPs. The old
  // regex matched both http:// and https:// and there was no IP check,
  // which let any caller hit 169.254.169.254 / 127.0.0.1 / internal RDS.
  const guard = await assertPublicHttpsUrl(u);
  if (!guard.ok) return guard;
  const cap = Math.max(200, Math.min(20000, Number.parseInt(max_chars, 10) || 4000));
  try {
    const r = await fetchWithTimeout(u, {
      headers: { 'User-Agent': 'Kelion/1.0 (+https://kelionai.app)', Accept: 'text/html,application/json,*/*' },
    }, 12000);
    const ct = r.headers.get('content-type') || '';
    const buf = await r.text();
    if (ct.includes('application/json')) {
      const sliced = buf.length > cap ? buf.slice(0, cap) + '… [truncated]' : buf;
      return { ok: true, url: u, contentType: ct, bytes: buf.length, content: sliced, source: 'direct-fetch' };
    }
    // Strip tags for HTML; keep plain text for others.
    const stripped = buf
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    const text = stripped.length > cap ? stripped.slice(0, cap) + '… [truncated]' : stripped;
    return { ok: true, url: u, contentType: ct, bytes: buf.length, content: text, source: 'direct-fetch' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// rss_read — parse an RSS/Atom feed into entries

async function toolRssRead({ url, limit }) {
  const u = (url || '').toString().trim();
  const guard = await assertPublicHttpsUrl(u);
  if (!guard.ok) return guard;
  const n = Math.max(1, Math.min(30, Number.parseInt(limit, 10) || 10));
  try {
    const r = await fetchWithTimeout(u, { headers: { 'User-Agent': 'Kelion/1.0 (RSS)' } });
    if (!r.ok) return { ok: false, error: `fetch ${r.status}` };
    const xml = await r.text();
    const items = Array.from(xml.matchAll(/<(item|entry)[\s\S]*?<\/\1>/g)).slice(0, n);
    const pick = (block, tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
    };
    const entries = items.map((m) => {
      const b = m[0];
      const linkMatch = b.match(/<link[^>]*href="([^"]+)"/) || b.match(/<link[^>]*>([^<]+)<\/link>/);
      return {
        title: pick(b, 'title'),
        link: linkMatch ? linkMatch[1] : null,
        pubDate: pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated'),
        summary: pick(b, 'description') || pick(b, 'summary'),
      };
    });
    return { ok: true, url: u, count: entries.length, entries, source: 'rss' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// wikipedia_search — Wikipedia REST summary API

async function toolWikipediaSearch({ query, lang }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const l = (lang || 'en').toString().toLowerCase().slice(0, 5);
  try {
    // 1) search titles
    const s = await fetchWithTimeout(`https://${l}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`);
    if (!s.ok) return { ok: false, error: `wikipedia ${s.status}` };
    const sd = await s.json();
    const title = sd?.[1]?.[0];
    if (!title) return { ok: false, error: 'no wikipedia article found' };
    // 2) fetch summary
    const r = await fetchWithTimeout(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!r.ok) return { ok: false, error: `wikipedia summary ${r.status}` };
    const data = await r.json();
    return {
      ok: true,
      query: q,
      title: data.title,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
      thumbnail: data.thumbnail?.source || null,
      source: `${l}.wikipedia.org`,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// dictionary — Free Dictionary API (en) or Wiktionary

async function toolDictionary({ word, lang }) {
  const w = (word || '').toString().trim();
  if (!w) return { ok: false, error: 'missing word' };
  const l = (lang || 'en').toString().toLowerCase().slice(0, 5);
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/${l}/${encodeURIComponent(w)}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `dictionary ${r.status}` };
    const data = await r.json();
    if (!Array.isArray(data) || !data[0]) return { ok: false, error: 'word not found' };
    const entry = data[0];
    return {
      ok: true,
      word: entry.word,
      phonetic: entry.phonetic || entry.phonetics?.[0]?.text || null,
      meanings: (entry.meanings || []).slice(0, 3).map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions || []).slice(0, 3).map((d) => ({
          definition: d.definition,
          example: d.example || null,
        })),
      })),
      source: 'dictionaryapi.dev',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// Keyword → forced tool detection.
//
// If the latest user message clearly asks for one of these capabilities,
// we set tool_choice on the next chat.completions call so the model
// MUST call the tool — it cannot hallucinate. We only force when the
// cues are unambiguous; otherwise we fall back to tool_choice: 'auto'.

const TOOL_FORCE_RULES = [
  {
    name: 'calculate',
    re: /\b(calcul(ate|eaz[aă])|c[aâ]t face|how much is|what(?:'s| is) (?:[0-9]+|the (?:sum|product|difference)))\b|[0-9]+\s*[+\-*/^]\s*[0-9]+/i,
  },
  {
    name: 'get_weather',
    re: /\b(weather|forecast|temperature|how (?:hot|cold) is|ce vreme|ce temperatur[aă]|cum e vremea|ploua|ploaie|prognoz[aă])\b/i,
  },
  {
    name: 'web_search',
    re: /\b(search (?:the web|online|for)|google (?:for|up)|look up|find me info(?:rmation)? (?:on|about)|caut[aă] pe (?:net|google|internet)|g[aă]se[șs]te info)\b/i,
  },
  {
    name: 'translate',
    re: /\b(translate\s+(this|that|to|into)|how do you say .+ in|traduc(?:e|eți)\s+(asta|ăsta|textul|asta\s+în|în)|tradu\s+(asta|în|textul)|traducere\s+în)\b/i,
  },
  {
    name: 'get_news',
    re: /\b(news about|latest news|headlines on|știri despre|ultimele știri|titluri despre)\b/i,
  },
  {
    name: 'get_crypto_price',
    re: /\b(price of (bitcoin|btc|ethereum|eth|solana|sol|doge|ada|xrp)|cât costă (bitcoin|btc|ethereum|eth)|cotație (bitcoin|eth))\b/i,
  },
  {
    name: 'get_stock_price',
    re: /\b(stock price (of|for)|quote for|cotație (acțiuni )?pentru|preț acțiuni) [A-Z]{1,5}\b/i,
  },
  {
    name: 'get_forex',
    re: /\b(convert .+ (to|in) .+|exchange rate|rate [A-Z]{3}\/[A-Z]{3}|curs (valutar|schimb)|converteste|conversie valutar[ăa])\b/i,
  },
  {
    name: 'get_route',
    re: /\b(route from .+ to|how (do I|to) get from|directions from|rut[aă] de la .+ (p[aâ]n[aă] la|la)|distanț[aă] (de la|între))\b/i,
  },
  {
    name: 'wikipedia_search',
    re: /\b(wikipedia|wiki (about|on|for)|caut[aă] pe wikipedia)\b/i,
  },
  {
    name: 'dictionary',
    re: /\b(define .+|definition of|what does .+ mean|meaning of the word|definiție pentru)\b/i,
  },
  {
    name: 'get_earthquakes',
    re: /\b(recent earthquakes|cutremure recente|ultimele cutremure)\b/i,
  },
  {
    name: 'get_air_quality',
    re: /\b(air quality|AQI|pollution level|calitate (a )?aer(ului)?|poluare)\b/i,
  },
];

function pickForcedTool(lastUserMessage) {
  if (!lastUserMessage || typeof lastUserMessage !== 'string') return null;
  const text = lastUserMessage.slice(0, 500);
  for (const rule of TOOL_FORCE_RULES) {
    if (rule.re.test(text)) return rule.name;
  }
  return null;
}




// ──────────────────────────────────────────────────────────────────
// PR B — document + OCR tools. Backend-only; the LLM calls these via
// function-calling and gets back structured text it can summarise or
// translate. Inputs are either a public HTTPS URL (goes through the
// same SSRF guard as fetch_url) or a base64-encoded file — that way
// the chat UI can pass an uploaded blob directly without a temp-URL
// round-trip.
//
//   read_pdf      → pdf-parse
//   read_docx     → mammoth
//   ocr_image     → tesseract.js
//   ocr_passport  → tesseract.js + MRZ parser (TD3, ICAO 9303)

// 0.21A — ocr_engine: Super-module for Optical Character Recognition (OCR).
async function toolOcrEngine(args) {
  const mode = String(args?.mode || 'image').trim().toLowerCase();
  if (mode === 'passport') return toolOcrPassport(args);
  return toolOcrImage(args);
}


function decodeBase64Source(base64) {
  const raw = String(base64 || '').replace(/^data:[^,]+,/, '');
  if (!raw) return { ok: false, error: 'missing base64' };
  try {
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return { ok: false, error: 'empty base64' };
    return { ok: true, buffer: buf };
  } catch (_) {
    return { ok: false, error: 'invalid base64' };
  }
}

async function fetchBufferWithGuard(url, maxBytes, timeoutMs) {
  const guard = await assertPublicHttpsUrl(url);
  if (!guard.ok) return guard;
  try {
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Kelion/1.0 (+https://kelionai.app)' },
    }, timeoutMs);
    if (!r.ok) return { ok: false, error: `fetch ${r.status}` };
    const ab = await r.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      return { ok: false, error: `file too large (${ab.byteLength} bytes, max ${maxBytes})` };
    }
    return {
      ok: true,
      buffer: Buffer.from(ab),
      contentType: r.headers.get('content-type') || '',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

const tempFileStore = new Map();
function storeTempFile(id, buffer, mimeType) {
  tempFileStore.set(id, { buffer, mimeType, time: Date.now() });
  for (const [k, v] of tempFileStore.entries()) {
    if (Date.now() - v.time > 60 * 60 * 1000) tempFileStore.delete(k); // 1 hour sweep
  }
}
function getTempFile(id) {
  return tempFileStore.get(id);
}

async function loadDocBuffer({ url, base64, file_id }, maxBytes, timeoutMs) {
  if (file_id) {
    const f = getTempFile(file_id);
    if (!f) return { ok: false, error: 'Temporary file expired or not found' };
    if (f.buffer.length > maxBytes) {
      return { ok: false, error: `file too large (${f.buffer.length} bytes, max ${maxBytes})` };
    }
    return { ok: true, buffer: f.buffer, contentType: f.mimeType };
  }
  if (base64) {
    const decoded = decodeBase64Source(base64);
    // Defense in depth: the URL path already enforces maxBytes in
    // fetchBufferWithGuard, but base64 inputs skip that guard. Without
    // this check a caller bypassing the 1 MB Express body cap (e.g. a
    // future WebSocket route) could hand us an unbounded buffer.
    if (decoded.ok && decoded.buffer.length > maxBytes) {
      return {
        ok: false,
        error: `file too large (${decoded.buffer.length} bytes, max ${maxBytes})`,
      };
    }
    return decoded;
  }
  if (url) return fetchBufferWithGuard(String(url).trim(), maxBytes, timeoutMs);
  return { ok: false, error: 'provide either url, base64, or file_id' };
}

async function toolReadPdf({ url, base64, file_id, max_chars, max_pages }) {
  const loaded = await loadDocBuffer({ url, base64, file_id }, 25 * 1024 * 1024, 15000);
  if (!loaded.ok) return loaded;
  const cap = Math.max(500, Math.min(200000, Number.parseInt(max_chars, 10) || 100000)); // Cap marit pt analize profunde

  try {
    // Gemma 4 multimodal analysis via Google API (Text + Images)
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      const base64Data = loaded.buffer.toString('base64');
      const payload = {
        contents: [{
          parts: [
            { text: "Extract ALL text from this PDF. For every image, schematic, circuit diagram, or technical drawing, provide an EXTREMELY detailed technical description (including component values, physics principles, relationships, and exact labels). Do not miss any technical detail. Assume the user is a Senior Engineer/Physicist and needs precise diagnostic and analytical information from the manual." },
            { inlineData: { mimeType: 'application/pdf', data: base64Data } }
          ]
        }],
        generationConfig: { temperature: 0.1 }
      };

      const gemmaModel = process.env.GOOGLE_CHAT_MODEL || 'google/gemma-4-31b-it';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gemmaModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) {
          const truncated = text.length > cap;
          return {
            ok: true,
            method: 'gemma4-multimodal',
            text: truncated ? text.slice(0, cap) + '… [truncated]' : text,
            truncated,
            chars: text.length,
            bytes: loaded.buffer.length,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[read_pdf] Gemma 4 vision fallback failed:', err.message);
  }

  // Fallback: pdf-parse clasic (doar text) dacă Gemma 4 pică sau nu e setat API KEY
  const maxPages = Math.max(1, Math.min(200, Number.parseInt(max_pages, 10) || 50));
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(loaded.buffer, { max: maxPages });
    const text = (data.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const truncated = text.length > cap;
    return {
      ok: true,
      pages: data.numpages || null,
      info: data.info || null,
      text: truncated ? text.slice(0, cap) + '… [truncated]' : text,
      truncated,
      chars: text.length,
      bytes: loaded.buffer.length,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolReadDocx({ url, base64, file_id, max_chars }) {
  const loaded = await loadDocBuffer({ url, base64, file_id }, 25 * 1024 * 1024, 15000);
  if (!loaded.ok) return loaded;
  const cap = Math.max(500, Math.min(50000, Number.parseInt(max_chars, 10) || 8000));
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: loaded.buffer });
    const text = (result.value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const truncated = text.length > cap;
    return {
      ok: true,
      text: truncated ? text.slice(0, cap) + '… [truncated]' : text,
      truncated,
      chars: text.length,
      bytes: loaded.buffer.length,
      warnings: (result.messages || []).slice(0, 5).map((m) => m.message),
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// Lazy-require tesseract.js — importing it eagerly pulls in language
// training data worth ~8 MB that we do not want on hot-path requests
// that never touch OCR. Tests mock this via jest.mock('tesseract.js').
let _tesseractModule = null;
async function getTesseract() {
  if (!_tesseractModule) _tesseractModule = require('tesseract.js');
  return _tesseractModule;
}

async function toolOcrImage({ url, base64, file_id, lang, max_chars }) {
  const loaded = await loadDocBuffer({ url, base64, file_id }, 20 * 1024 * 1024, 20000);
  if (!loaded.ok) return loaded;
  const cap = Math.max(200, Math.min(20000, Number.parseInt(max_chars, 10) || 4000));
  // Accept only the leading run of [a-z+] after trim/lowercase so a value
  // like "eng+ron!; DROP TABLE" collapses to "eng+ron" instead of the
  // concatenation "eng+rondroptable".
  const langMatch = String(lang || 'eng').toLowerCase().trim().match(/^[a-z+]+/);
  const language = (langMatch ? langMatch[0] : '').slice(0, 32) || 'eng';
  try {
    const Tess = await getTesseract();
    const worker = await Tess.createWorker(language);
    try {
      const { data } = await worker.recognize(loaded.buffer);
      const text = (data && data.text ? data.text : '').trim();
      const truncated = text.length > cap;
      return {
        ok: true,
        text: truncated ? text.slice(0, cap) + '… [truncated]' : text,
        truncated,
        chars: text.length,
        confidence: Number.isFinite(Number(data && data.confidence))
          ? Number(data.confidence)
          : null,
        language,
      };
    } finally {
      try { await worker.terminate(); } catch (_) { /* no-op */ }
    }
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// MRZ date → ISO. Birth years ≥ 30 assume 19xx, < 30 assume 20xx; expiry
// always projects forward into 20xx. Matches ICAO 9303 century rule for
// passports issued before 2030 (no explicit century digit in MRZ).
function mrzDate(s, future = false) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const mm = s.slice(2, 4);
  const dd = s.slice(4, 6);
  const year = future ? 2000 + yy : (yy >= 30 ? 1900 + yy : 2000 + yy);
  return `${year}-${mm}-${dd}`;
}

function parseMrz(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return null;
  const td3 = lines.filter((l) => typeof l === 'string' && l.length === 44).slice(0, 2);
  if (td3.length === 2) {
    const l1 = td3[0];
    const l2 = td3[1];
    // MRZ name field: surname and given names are separated by exactly
    // two `<`, individual name tokens are separated by a single `<`, and
    // trailing `<` fill the field. Split on `<<` first so the surname
    // boundary is preserved even after we collapse single `<` to spaces.
    const nameField = l1.slice(5);
    const [surnameRaw, givenRaw = ''] = nameField.split('<<');
    const cleanName = (s) => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
    return {
      format: 'TD3',
      documentType: l1.slice(0, 2).replace(/</g, ''),
      issuingCountry: l1.slice(2, 5).replace(/</g, ''),
      surname: cleanName(surnameRaw),
      givenNames: cleanName(givenRaw),
      passportNumber: l2.slice(0, 9).replace(/</g, ''),
      nationality: l2.slice(10, 13).replace(/</g, ''),
      dateOfBirth: mrzDate(l2.slice(13, 19)),
      sex: l2[20] === '<' ? null : l2[20],
      dateOfExpiry: mrzDate(l2.slice(21, 27), true),
    };
  }
  return { format: 'unknown', lines };
}

async function toolOcrPassport({ url, base64 }) {
  const ocr = await toolOcrImage({ url, base64, lang: 'eng', max_chars: 20000 });
  if (!ocr.ok) return ocr;
  const cleaned = (ocr.text || '')
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter(Boolean);
  const mrzLines = cleaned.filter((l) => /^[A-Z0-9<]+$/.test(l) && (l.length === 30 || l.length === 36 || l.length === 44));
  return {
    ok: true,
    text: ocr.text,
    mrz: mrzLines,
    fields: parseMrz(mrzLines),
    confidence: ocr.confidence,
  };
}



// ──────────────────────────────────────────────────────────────────
// PR C — sandboxed code runner, regex tester, and user-intern tools.
//
// Tools whose name starts with `get_my_*` need a signed-in user and
// read it from the optional third `ctx` argument of executeRealTool.
// When the caller omits ctx (e.g. the text-chat route, which keeps
// the legacy two-argument call site) they return a polite "sign in
// first" message rather than crashing.

function toolRunRegex(args) {
  const pattern = String(args?.pattern || '');
  if (!pattern) return { ok: false, error: 'missing pattern' };
  if (pattern.length > 500) return { ok: false, error: 'pattern too long (max 500 chars)' };
  const input = String(args?.input ?? '');
  if (input.length > 50_000) return { ok: false, error: 'input too long (max 50 000 chars)' };
  // Allow only the standard flag subset — anything else is most likely
  // a caller mistake or an injection attempt.
  const flags = String(args?.flags || 'g').replace(/[^gimsuy]/g, '').slice(0, 6);
  const mode = String(args?.mode || 'match').toLowerCase();
  let re;
  try { re = new RegExp(pattern, flags); }
  catch (err) { return { ok: false, error: `invalid regex: ${err.message}` }; }
  try {
    if (mode === 'test') {
      return { ok: true, mode, matched: re.test(input) };
    }
    if (mode === 'replace') {
      const replacement = String(args?.replacement ?? '');
      const out = input.replace(re, replacement);
      const truncated = out.length > 50_000;
      return {
        ok: true,
        mode,
        output: truncated ? out.slice(0, 50_000) + '… [truncated]' : out,
        truncated,
      };
    }
    const maxMatches = Math.max(1, Math.min(500, Number.parseInt(args?.max_matches, 10) || 200));
    const matches = [];
    if (flags.includes('g')) {
      let m;
      while ((m = re.exec(input)) !== null) {
        matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
        if (matches.length >= maxMatches) break;
        // Guard zero-length matches (e.g. /a*/g) against an infinite loop.
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    } else {
      const m = re.exec(input);
      if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
    }
    return { ok: true, mode: 'match', count: matches.length, matches };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

let _e2bModule = null;
let _e2bLoadFailed = false;
async function getE2BModule() {
  if (_e2bLoadFailed) return null;
  if (_e2bModule) return _e2bModule;
  try {
    _e2bModule = require('@e2b/code-interpreter');
    return _e2bModule;
  } catch (_) {
    _e2bLoadFailed = true;
    return null;
  }
}

async function toolRunCode(args) {
  const key = process.env.E2B_API_KEY;
  if (!key) {
    // Fallback: execute locally via child_process (admin autonomy)
    const code = String(args?.code || '').trim();
    if (!code) return { ok: false, error: 'missing code' };
    const rawLang = String(args?.language || 'javascript').toLowerCase();
    let cmd;
    if (rawLang === 'python' || rawLang === 'python3') {
      const tmpFile = _path.join(REPO_ROOT, '.tmp_run_code.py');
      _fs.writeFileSync(tmpFile, code);
      cmd = `python3 ${tmpFile}`;
    } else {
      // JavaScript / Node.js
      const tmpFile = _path.join(REPO_ROOT, '.tmp_run_code.js');
      _fs.writeFileSync(tmpFile, code);
      cmd = `node ${tmpFile}`;
    }
    try {
      const { stdout, stderr } = await _exec(cmd, { cwd: REPO_ROOT, timeout: 60000 });
      return { ok: true, language: rawLang, stdout: (stdout || '').slice(0, 20000), stderr: (stderr || '').slice(0, 20000) };
    } catch (err) {
      return { ok: false, error: err.message, stdout: (err.stdout || '').slice(0, 20000), stderr: (err.stderr || '').slice(0, 20000) };
    }
  }
  const mod = await getE2BModule();
  if (!mod || !mod.Sandbox) {
    return {
      ok: false,
      unavailable: true,
      error: 'e2b SDK is not installed on this build. Install @e2b/code-interpreter to enable run_code.',
    };
  }
  const code = String(args?.code || '').trim();
  if (!code) return { ok: false, error: 'missing code' };
  if (code.length > 20_000) return { ok: false, error: 'code too long (max 20 000 chars)' };
  const rawLang = String(args?.language || 'python').toLowerCase();
  const language = rawLang === 'js' ? 'javascript' : rawLang === 'ts' ? 'typescript' : rawLang;
  if (!['python', 'javascript', 'typescript'].includes(language)) {
    return { ok: false, error: `unsupported language "${rawLang}" (try python, javascript)` };
  }
  const timeoutMs = Math.max(1000, Math.min(60_000, Number.parseInt(args?.timeout_ms, 10) || 15_000));
  const cap = (s) => {
    const t = String(s || '');
    return t.length > 8000 ? t.slice(0, 8000) + '… [truncated]' : t;
  };
  let sandbox = null;
  try {
    sandbox = await mod.Sandbox.create({ apiKey: key, timeoutMs });
    const execution = await sandbox.runCode(code, { language, timeoutMs });
    return {
      ok: true,
      language,
      stdout: cap((execution.logs?.stdout || []).join('')),
      stderr: cap((execution.logs?.stderr || []).join('')),
      text: cap(execution.text || ''),
      error: execution.error
        ? cap(execution.error.value || execution.error.name || 'execution error')
        : null,
      results: Array.isArray(execution.results)
        ? execution.results.slice(0, 5).map((r) => ({ type: r.type || 'text', text: cap(r.text || '') }))
        : [],
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (sandbox && typeof sandbox.kill === 'function') {
      try { await sandbox.kill(); } catch (_) { /* no-op */ }
    }
  }
}

function needSignIn() {
  return {
    ok: false,
    unavailable: true,
    error: "Sign in first — I can only read your account when you're signed in.",
  };
}

// `get_my_location` — server-side counterpart of the client tool. Reads
// the request's real GPS coords (passed via ctx.coords by the chat /
// realtime route) and never falls back to IP-geolocation. Adrian:
// "permanent trebuie sa foloseasca coordonatele gps reale ale aparatului".
// IP-geo is fine for telemetry but is forbidden as the user's "where am I"
// answer — too inaccurate (often the wrong city) and Kelion saying
// "you are in <wrong city>" is a worse failure than "I don't have your
// location yet, please tap Allow Location".
async function toolGetMyLocation(args, ctx) {
  const coords = ctx && ctx.coords;
  const lat = Number(coords?.lat);
  const lon = Number(coords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      have_gps: false,
      error: 'No real GPS coordinates from the device. Ask the user to tap the screen and allow location access (Settings → Location for the app).',
    };
  }
  const result = {
    ok: true,
    have_gps: true,
    lat,
    lon,
    accuracy: Number.isFinite(Number(coords?.accuracy)) ? Number(coords.accuracy) : null,
  };
  // Best-effort reverse geocode so Kelion can say "Cluj-Napoca, RO"
  // instead of raw coords. Failure here is non-fatal — the numeric
  // answer is still useful for downstream tools.
  if (args?.include_address !== false) {
    try {
      const rg = await toolReverseGeocode({ lat, lon });
      if (rg && rg.ok) {
        result.displayName = rg.displayName || rg.display_name || null;
        result.city = rg.city || rg.address?.city || rg.address?.town || rg.address?.village || null;
        result.country = rg.country || rg.address?.country || null;
      }
    } catch { /* keep numeric answer */ }
  }
  return result;
}

async function toolGetMyCredits(args, ctx) {
  const user = ctx && ctx.user;
  if (!user || !user.id) return needSignIn();
  try {
    const db = require('../db');
    const minutes = await db.getCreditsBalance(user.id);
    const fmt = (args && args.format === 'seconds') ? 'seconds' : 'minutes';
    const display = fmt === 'seconds'
      ? `${Math.round(minutes * 60)} s`
      : `${Math.round(minutes * 10) / 10} min`;
    return {
      ok: true,
      minutes,
      format: fmt,
      display,
      low: minutes < 2,
      empty: minutes <= 0,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolGetMyUsage(args, ctx) {
  const user = ctx && ctx.user;
  if (!user || !user.id) return needSignIn();
  try {
    const db = require('../db');
    const dbh = db.getDb ? await db.getDb() : null;
    if (!dbh) return { ok: false, error: 'db unavailable' };
    const maxRows = Math.min(40, Math.max(1, Number(args?.limit) || 20));
    const kindFilter = (args?.kind === 'topup' || args?.kind === 'consume') ? args.kind : null;
    const rows = await dbh.all(
      `SELECT delta_minutes, amount_cents, currency, kind, note, created_at
         FROM credit_transactions
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [user.id, maxRows],
    );
    const filtered = kindFilter
      ? rows.filter((r) => kindFilter === 'topup' ? r.kind === 'topup' : Number(r.delta_minutes) < 0)
      : rows;
    const topups = filtered.filter((r) => r.kind === 'topup');
    const consumed = filtered.filter((r) => Number(r.delta_minutes) < 0);
    const minutesConsumed = consumed.reduce((s, r) => s + Math.abs(Number(r.delta_minutes) || 0), 0);
    const minutesTopped = topups.reduce((s, r) => s + Math.max(0, Number(r.delta_minutes) || 0), 0);
    return {
      ok: true,
      minutesConsumed,
      minutesTopped,
      kindFilter: kindFilter || 'all',
      recent: filtered.slice(0, Math.min(maxRows, 10)).map((r) => ({
        kind: r.kind,
        deltaMinutes: Number(r.delta_minutes) || 0,
        amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
        currency: r.currency || null,
        note: r.note || null,
        at: r.created_at,
      })),
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolGetMyProfile(args, ctx) {
  const user = ctx && ctx.user;
  if (!user || !user.id) return needSignIn();
  try {
    const db = require('../db');
    const full = await db.getUserById(user.id);
    if (!full) return { ok: false, error: 'user not found' };
    const includeEmail = args?.include_email !== false;
    const result = {
      ok: true,
      id: full.id,
      name: full.name || user.name || null,
      creditsMinutes: Number(full.credits_balance_minutes || 0),
      createdAt: full.created_at || null,
    };
    if (includeEmail) result.email = full.email || user.email || null;
    return result;
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// PR D — communications + automations + package info
//
// These tools are ADDITIVE only. None of them modify existing tools or the
// frozen chat module. Keys are all opt-in: when the relevant env var is
// missing the tool returns `{ ok:false, unavailable:true }` with a human
// error, instead of crashing, so the catalog can advertise the tool
// unconditionally.

// Shared helper for "sign-in first" style responses (mirrors PR C ctx flow).
function needConfig(msg) {
  return { ok: false, unavailable: true, error: msg };
}

function isRfc5322ish(addr) {
  if (typeof addr !== 'string') return false;
  if (addr.length > 320) return false;
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(addr.trim());
}

async function toolSendEmail(args) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return needConfig('Email sending is not configured. Set RESEND_API_KEY (https://resend.com/api-keys) to enable send_email.');
  }
  const defaultFrom = process.env.RESEND_FROM || process.env.EMAIL_FROM || '';
  const from = String(args?.from || defaultFrom || '').trim();
  if (!from) {
    return needConfig('No sender address. Set RESEND_FROM (a verified Resend domain address) or pass the `from` argument.');
  }
  if (!isRfc5322ish(from)) return { ok: false, error: 'invalid "from" address' };
  const rawTo = args?.to;
  const toList = Array.isArray(rawTo) ? rawTo : (rawTo ? [rawTo] : []);
  const to = toList.map((x) => String(x || '').trim()).filter(Boolean);
  if (!to.length) return { ok: false, error: 'missing recipient (to)' };
  if (to.length > 50) return { ok: false, error: 'too many recipients (max 50)' };
  for (const addr of to) if (!isRfc5322ish(addr)) return { ok: false, error: `invalid recipient: ${addr}` };
  const subject = String(args?.subject || '').slice(0, 300);
  if (!subject) return { ok: false, error: 'missing subject' };
  const text = args?.text != null ? String(args.text) : '';
  const html = args?.html != null ? String(args.html) : '';
  if (!text && !html) return { ok: false, error: 'missing body (text or html)' };
  if (text.length > 200_000 || html.length > 500_000) {
    return { ok: false, error: 'body too large (text ≤ 200 KB, html ≤ 500 KB)' };
  }
  const body = { from, to, subject };
  if (text) body.text = text;
  if (html) body.html = html;
  if (Array.isArray(args?.cc) && args.cc.length) body.cc = args.cc.slice(0, 20);
  if (Array.isArray(args?.bcc) && args.bcc.length) body.bcc = args.bcc.slice(0, 20);
  if (args?.reply_to && isRfc5322ish(String(args.reply_to))) body.reply_to = String(args.reply_to);
  try {
    const r = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 10_000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: (j && (j.message || j.error || j.name)) || `Resend HTTP ${r.status}`,
      };
    }
    return { ok: true, id: j.id || null, provider: 'resend', to, subject };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function normalizeE164(s) {
  return typeof s === 'string' ? s.replace(/[\s\-()]/g, '').trim() : '';
}
function e164ish(s) {
  return typeof s === 'string' && /^\+?[1-9]\d{6,14}$/.test(normalizeE164(s));
}

async function toolSendSms(args) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromRaw = (args?.from || process.env.TWILIO_FROM || '').toString().trim();
  if (!sid || !token) {
    return needConfig('SMS sending is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (https://www.twilio.com/console) to enable send_sms.');
  }
  if (!fromRaw) {
    return needConfig('No Twilio sender number. Set TWILIO_FROM (E.164, e.g. +14155550123) or pass `from`.');
  }
  if (!e164ish(fromRaw)) return { ok: false, error: 'invalid "from" number (must be E.164, e.g. +14155550123)' };
  const toRaw = String(args?.to || '').trim();
  if (!toRaw) return { ok: false, error: 'missing recipient (to)' };
  if (!e164ish(toRaw)) return { ok: false, error: 'invalid "to" number (must be E.164)' };
  // Strip formatting chars before handing to Twilio — the API rejects numbers
  // containing whitespace / dashes / parens even though our validator accepts them.
  const from = normalizeE164(fromRaw);
  const rawTo = normalizeE164(toRaw);
  const message = String(args?.message || args?.body || '').trim();
  if (!message) return { ok: false, error: 'missing message' };
  if (message.length > 1600) return { ok: false, error: 'message too long (max 1600 chars — 10 SMS segments)' };
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ From: from, To: rawTo, Body: message });
  try {
    const r = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      10_000,
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        error: (j && (j.message || j.code)) || `Twilio HTTP ${r.status}`,
      };
    }
    return {
      ok: true,
      sid: j.sid || null,
      status: j.status || 'queued',
      provider: 'twilio',
      to: rawTo,
      from,
      segments: j.num_segments != null ? Number(j.num_segments) : undefined,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ── create_calendar_ics ───────────────────────────────────────────
// Build a minimal but valid RFC 5545 VCALENDAR/VEVENT. No external dep.
// Returns the .ics text and a base64 data URL the caller can surface as
// a download link. This is not a scheduler — callers that want a
// "real" calendar entry can feed the output to a mailer (via
// send_email) or an MDM system.

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// RFC 5545 §3.2 — parameter values cannot use backslash escapes. When the value
// contains CONTROL / ":" / ";" / "," it must be wrapped in DQUOTEs. DQUOTE
// itself cannot appear inside a parameter value at all (stripped).
function icsParamValue(s) {
  const clean = String(s || '').replace(/[\r\n]/g, ' ').replace(/"/g, '');
  return /[,;:]/.test(clean) ? `"${clean}"` : clean;
}

function icsFmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function toolCreateCalendarIcs(args) {
  const title = String(args?.title || '').trim();
  if (!title) return { ok: false, error: 'missing title' };
  if (title.length > 200) return { ok: false, error: 'title too long (max 200 chars)' };
  const startRaw = String(args?.start || '').trim();
  const endRaw = String(args?.end || '').trim();
  const dtStart = icsFmtDate(startRaw);
  if (!dtStart) return { ok: false, error: 'invalid `start` (expected ISO 8601)' };
  let dtEnd = icsFmtDate(endRaw);
  if (!dtEnd) {
    const fallback = new Date(new Date(startRaw).valueOf() + 60 * 60 * 1000);
    dtEnd = icsFmtDate(fallback.toISOString());
  }
  if (!dtEnd) return { ok: false, error: 'invalid `end` (expected ISO 8601)' };
  const description = String(args?.description || '').slice(0, 2000);
  const location = String(args?.location || '').slice(0, 200);
  const attendees = Array.isArray(args?.attendees) ? args.attendees.slice(0, 50) : [];
  const validAttendees = [];
  for (const a of attendees) {
    const email = String(a && a.email != null ? a.email : a).trim();
    if (!isRfc5322ish(email)) continue;
    const name = a && a.name ? String(a.name).slice(0, 100) : null;
    validAttendees.push({ email, name });
  }
  const uid = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}@kelion.local`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kelion//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsFmtDate(new Date().toISOString())}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  for (const at of validAttendees) {
    // RFC 5545 §3.2: parameter values containing CONTROL / ":" / ";" / "," must be
    // wrapped in DQUOTEs; DQUOTE itself cannot appear inside a parameter value, so
    // we strip it. Backslash escaping (\, \;) applies only to property VALUES.
    const cn = at.name ? `CN=${icsParamValue(at.name)};` : '';
    lines.push(`ATTENDEE;${cn}RSVP=TRUE:mailto:${at.email}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR', '');
  const ics = lines.join('\r\n');
  const base64 = Buffer.from(ics, 'utf8').toString('base64');
  return {
    ok: true,
    uid,
    start: dtStart,
    end: dtEnd,
    ics,
    dataUrl: `data:text/calendar;charset=utf-8;base64,${base64}`,
    attendees: validAttendees,
  };
}

// ── zapier_trigger ────────────────────────────────────────────────
// Generic webhook POST restricted to the official Zapier ingress host
// so the tool can't be repurposed as a general SSRF sink. Users paste
// their Catch Hook URL from Zapier and we POST the payload as JSON.

async function toolZapierTrigger(args) {
  const url = String(args?.webhook_url || args?.url || '').trim();
  if (!url) return { ok: false, error: 'missing webhook_url' };
  if (!/^https:\/\/hooks\.zapier\.com\/hooks\/catch\//i.test(url)) {
    return { ok: false, error: 'webhook_url must be a Zapier Catch Hook (https://hooks.zapier.com/hooks/catch/…)' };
  }
  // Schema advertises `payload` as a JSON string (the model's
  // endpoint rejects object-type params without explicit properties). Accept
  // both a pre-parsed object and a JSON string for backward compat.
  let payload = {};
  if (args?.payload) {
    if (typeof args.payload === 'string') {
      try { payload = JSON.parse(args.payload); } catch { return { ok: false, error: 'payload is not valid JSON' }; }
    } else if (typeof args.payload === 'object') {
      payload = args.payload;
    }
  }
  let body;
  try { body = JSON.stringify(payload); }
  catch { return { ok: false, error: 'payload is not JSON-serialisable' }; }
  if (body.length > 100_000) return { ok: false, error: 'payload too large (max 100 KB serialised)' };
  try {
    const r = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, 10_000);
    const txt = await r.text().catch(() => '');
    let parsed = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { /* leave as text */ }
    if (!r.ok) {
      return { ok: false, status: r.status, error: (parsed && (parsed.message || parsed.status)) || `Zapier HTTP ${r.status}` };
    }
    return {
      ok: true,
      status: r.status,
      zapierStatus: parsed ? (parsed.status || null) : null,
      zapierId: parsed ? (parsed.id || parsed.request_id || null) : null,
      response: parsed || (txt ? txt.slice(0, 500) : null),
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ── github_repo_info / npm_package_info / pypi_package_info ───────
// All three hit public APIs (no key required). GITHUB_TOKEN, if set,
// simply raises the unauth rate limit from 60→5 000 req/h.

function validSlugRepo(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/.test(s);
}

async function toolListGithubRepoFiles(args) {
  let slug = String(args?.repo || args?.slug || '').trim();
  if (!slug && args?.owner && args?.name) slug = `${args.owner}/${args.name}`;
  slug = slug.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  if (!validSlugRepo(slug)) return { ok: false, error: 'invalid repo slug (expected owner/name)' };
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kelion-ai-tools' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const branch = args?.branch ? String(args.branch) : 'HEAD';
  try {
    const r = await fetchWithTimeout(`https://api.github.com/repos/${slug}/git/trees/${branch}?recursive=1`, { headers }, 15000);
    if (r.status === 404) return { ok: false, status: 404, error: 'repo or branch not found' };
    if (r.status === 403) return { ok: false, status: 403, error: 'rate limited by GitHub API' };
    if (!r.ok) return { ok: false, status: r.status, error: `GitHub HTTP ${r.status}` };
    const j = await r.json();
    if (!j.tree) return { ok: false, error: 'no tree found' };

    // Filter out huge node_modules or .git paths, return only files
    const files = j.tree
      .filter(t => t.type === 'blob' && !t.path.includes('node_modules/') && !t.path.includes('.git/'))
      .map(t => t.path);

    return { ok: true, repo: slug, branch: j.sha, fileCount: files.length, files: files.slice(0, 1000) }; // cap at 1000 to avoid giant responses
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolReadGithubFile(args) {
  let slug = String(args?.repo || args?.slug || '').trim();
  if (!slug && args?.owner && args?.name) slug = `${args.owner}/${args.name}`;
  slug = slug.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  if (!validSlugRepo(slug)) return { ok: false, error: 'invalid repo slug (expected owner/name)' };
  const path = String(args?.path || '').trim();
  if (!path) return { ok: false, error: 'missing file path' };
  const branch = args?.branch ? String(args.branch) : 'HEAD';

  const headers = { Accept: 'application/vnd.github.v3.raw', 'User-Agent': 'kelion-ai-tools' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const r = await fetchWithTimeout(`https://api.github.com/repos/${slug}/contents/${path}?ref=${branch}`, { headers }, 15000);
    if (r.status === 404) return { ok: false, status: 404, error: 'file not found' };
    if (r.status === 403) return { ok: false, status: 403, error: 'rate limited or file too large' };
    if (!r.ok) return { ok: false, status: r.status, error: `GitHub HTTP ${r.status}` };
    const content = await r.text();
    const cap = 50000; // Cap to avoid blowing up context
    const truncated = content.length > cap;
    return {
      ok: true,
      repo: slug,
      path: path,
      content: truncated ? content.slice(0, cap) + '… [truncated]' : content,
      truncated
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolGithubRepoInfo(args) {
  let slug = String(args?.repo || args?.slug || '').trim();
  if (!slug && args?.owner && args?.name) slug = `${args.owner}/${args.name}`;
  slug = slug.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  if (!validSlugRepo(slug)) return { ok: false, error: 'invalid repo slug (expected owner/name)' };
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kelion-ai-tools' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const r = await fetchWithTimeout(`https://api.github.com/repos/${slug}`, { headers });
    if (r.status === 404) return { ok: false, status: 404, error: 'repo not found' };
    if (!r.ok) return { ok: false, status: r.status, error: `GitHub HTTP ${r.status}` };
    const j = await r.json();
    return {
      ok: true,
      fullName: j.full_name,
      description: j.description || null,
      homepage: j.homepage || null,
      url: j.html_url,
      stars: j.stargazers_count,
      forks: j.forks_count,
      watchers: j.subscribers_count,
      openIssues: j.open_issues_count,
      language: j.language || null,
      license: j.license ? (j.license.spdx_id || j.license.name || null) : null,
      topics: Array.isArray(j.topics) ? j.topics.slice(0, 20) : [],
      archived: !!j.archived,
      fork: !!j.fork,
      defaultBranch: j.default_branch,
      createdAt: j.created_at,
      pushedAt: j.pushed_at,
      updatedAt: j.updated_at,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function toolGetGithubIssues(args) {
  let slug = String(args?.repo || args?.slug || '').trim();
  if (!slug && args?.owner && args?.name) slug = `${args.owner}/${args.name}`;
  slug = slug.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  if (!validSlugRepo(slug)) return { ok: false, error: 'invalid repo slug (expected owner/name)' };
  const state = ['open', 'closed', 'all'].includes(args?.state) ? args.state : 'open';

  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'kelion-ai-tools' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const url = `https://api.github.com/repos/${slug}/issues?state=${state}&sort=updated&direction=desc&per_page=10`;
    const r = await fetchWithTimeout(url, { headers });
    if (r.status === 404) return { ok: false, status: 404, error: 'repo not found or no issues access' };
    if (!r.ok) return { ok: false, status: r.status, error: `GitHub HTTP ${r.status}` };
    const j = await r.json();
    if (!Array.isArray(j)) return { ok: false, error: 'unexpected GitHub response' };

    return {
      ok: true,
      repo: slug,
      state: state,
      issues: j.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        author: issue.user?.login,
        comments: issue.comments,
        created_at: issue.created_at,
        url: issue.html_url,
        body: issue.body ? (issue.body.slice(0, 300) + (issue.body.length > 300 ? '…' : '')) : null
      }))
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function validSlugNpm(s) {
  if (typeof s !== 'string' || !s) return false;
  if (s.length > 214) return false;
  if (s.startsWith('@')) return /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(s);
  return /^[a-z0-9][a-z0-9._-]*$/i.test(s);
}

async function toolNpmPackageInfo(args) {
  const name = String(args?.name || args?.package || '').trim();
  if (!validSlugNpm(name)) return { ok: false, error: 'invalid npm package name' };
  const encoded = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1).replace('/', '__SLASH__')).replace('__SLASH__', '/')}`
    : encodeURIComponent(name);
  try {
    const r = await fetchWithTimeout(`https://registry.npmjs.org/${encoded}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'kelion-ai-tools' },
    });
    if (r.status === 404) return { ok: false, status: 404, error: 'package not found' };
    if (!r.ok) return { ok: false, status: r.status, error: `npm HTTP ${r.status}` };
    const j = await r.json();
    const latest = (j['dist-tags'] && j['dist-tags'].latest) || null;
    const pkg = latest && j.versions ? j.versions[latest] : null;
    let weekly = null;
    try {
      const d = await fetchWithTimeout(
        `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
        { headers: { Accept: 'application/json' } },
        5000,
      );
      if (d.ok) {
        const dj = await d.json();
        weekly = dj && Number.isFinite(dj.downloads) ? dj.downloads : null;
      }
    } catch { /* best-effort */ }
    return {
      ok: true,
      name: j.name,
      latest,
      description: (pkg && pkg.description) || j.description || null,
      homepage: (pkg && pkg.homepage) || null,
      license: (pkg && pkg.license) || j.license || null,
      repository: pkg && pkg.repository ? (pkg.repository.url || pkg.repository) : null,
      keywords: Array.isArray(pkg && pkg.keywords) ? pkg.keywords.slice(0, 20) : [],
      weeklyDownloads: weekly,
      modified: j.time && j.time.modified ? j.time.modified : null,
      versions: Array.isArray(Object.keys(j.versions || {}))
        ? Object.keys(j.versions || {}).slice(-10)
        : [],
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function validSlugPypi(s) {
  return typeof s === 'string' && /^[A-Za-z0-9]([A-Za-z0-9._-]{0,99})$/i.test(s);
}

async function toolPypiPackageInfo(args) {
  const name = String(args?.name || args?.package || '').trim();
  if (!validSlugPypi(name)) return { ok: false, error: 'invalid PyPI package name' };
  try {
    const r = await fetchWithTimeout(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      headers: { Accept: 'application/json', 'User-Agent': 'kelion-ai-tools' },
    });
    if (r.status === 404) return { ok: false, status: 404, error: 'package not found' };
    if (!r.ok) return { ok: false, status: r.status, error: `PyPI HTTP ${r.status}` };
    const j = await r.json();
    const info = j.info || {};
    return {
      ok: true,
      name: info.name || name,
      latest: info.version || null,
      summary: info.summary || null,
      description: typeof info.description === 'string'
        ? (info.description.length > 2000 ? info.description.slice(0, 2000) + '…' : info.description)
        : null,
      homepage: info.home_page || (info.project_urls && info.project_urls.Homepage) || null,
      author: info.author || null,
      authorEmail: info.author_email || null,
      license: info.license || null,
      requiresPython: info.requires_python || null,
      yanked: !!(info.yanked),
      releases: Array.isArray(Object.keys(j.releases || {}))
        ? Object.keys(j.releases || {}).slice(-10)
        : [],
      projectUrls: info.project_urls || null,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// Local File and Git PR tools
// ──────────────────────────────────────────────────────────────────
const _path = require('path');
const _fs = require('fs');
const _cp = require('child_process');
const _util = require('util');
const _exec = _util.promisify(_cp.exec);

// Path to the repository root
const REPO_ROOT = _path.resolve(__dirname, '../../../');

function isPathSafe(p) {
  const normalized = p.toLowerCase();
  if (normalized.includes('c:\\windows')) return false;
  if (normalized.includes('system32')) return false;
  return true;
}

async function toolRunTerminalCommand(args) {
  try {
    const cmd = String(args?.command || '').trim();
    if (!cmd) return { ok: false, error: 'No command provided' };

    // Safety: only block absolute catastrophic commands
    if (cmd.includes('rm -rf /') || cmd.includes('mkfs')) {
      return { ok: false, error: 'Command blocked for security reasons.' };
    }

    let targetCwd = REPO_ROOT;
    if (args?.cwd) {
      targetCwd = _path.resolve(REPO_ROOT, args.cwd);
      if (!_fs.existsSync(targetCwd)) {
        _fs.mkdirSync(targetCwd, { recursive: true });
      }
    }

    // Admin autonomy: 120s timeout (was 30s), 20k output (was 5k)
    const timeout = Number(args?.timeout) || 120000;
    const { stdout, stderr } = await _exec(cmd, { cwd: targetCwd, timeout });
    return { ok: true, stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 20000) };
  } catch (err) {
    return { ok: false, error: err.message, stdout: (err.stdout || '').slice(0, 20000), stderr: (err.stderr || '').slice(0, 20000) };
  }
}

async function toolAskExpertCoder(args) {
  const question = String(args?.question || '');
  const context = String(args?.context || '');
  if (!question) return { ok: false, error: 'Question is required' };

  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) return { ok: false, error: 'OPENROUTER_API_KEY is not set' };

  const prompt = `You are an expert coder. Answer the question precisely.\n\nContext:\n${context}\n\nQuestion:\n${question}`;

  const MODELS = [
    args?.model || 'anthropic/claude-4.7-opus',
    'anthropic/claude-4.6-sonnet',
    'google/gemini-3.1-pro',
  ];
  // Deduplicate in case args.model matches one of the fallbacks
  const uniqueModels = [...new Set(MODELS)];
  const errors = [];

  for (const model of uniqueModels) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OR_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        errors.push(`${model}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      if (data.error) {
        errors.push(`${model}: ${data.error.message}`);
        continue;
      }
      return { ok: true, model, answer: data.choices[0].message.content };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  return { ok: false, error: `All expert models failed: ${errors.join(' | ')}` };
}

async function toolFetchDocumentation(args) {
  try {
    const url = String(args?.url || '');
    if (!url || !url.startsWith('http')) return { ok: false, error: 'Valid URL is required' };

    const res = await fetch(`https://r.jina.ai/${url}`);
    const text = await res.text();
    return { ok: true, content: text.slice(0, 15000) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolBrowseWeb(args) {
  try {
    const { task, start_url } = args || {};
    let markdownContext = '';
    let usedUrl = start_url || null;
    let liveUrl = start_url || null;

    if (start_url) {
      // User wants a specific page — fetch readable content via Jina Reader
      const fetchReq = await fetchWithTimeout(`https://r.jina.ai/${start_url}`, {
        headers: { 'Accept': 'text/markdown' },
      }, 12000);
      markdownContext = await fetchReq.text();
    } else if (task) {
      // Extract URL from natural-language task if present
      const urlMatch = task.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        // Task contains a URL — treat it as start_url
        liveUrl = urlMatch[0];
        usedUrl = urlMatch[0];
        const fetchReq = await fetchWithTimeout(`https://r.jina.ai/${liveUrl}`, {
          headers: { 'Accept': 'text/markdown' },
        }, 12000);
        markdownContext = await fetchReq.text();
      } else {
        // Pure text task — use KelionAI's web search to find relevant URLs,
        // then fetch the top result via Jina Reader for full content.
        // (Jina Search s.jina.ai requires an API key; toolWebSearch is free.)
        const searchResult = await toolWebSearch({ query: task, limit: 3 });
        if (searchResult.ok && Array.isArray(searchResult.results) && searchResult.results.length > 0) {
          const topResult = searchResult.results[0];
          liveUrl = topResult.url;
          usedUrl = topResult.url;
          // Fetch full readable content of the top result
          try {
            const fetchReq = await fetchWithTimeout(`https://r.jina.ai/${liveUrl}`, {
              headers: { 'Accept': 'text/markdown' },
            }, 12000);
            markdownContext = await fetchReq.text();
          } catch {
            // If Jina Reader fails, use the search snippet as content
            markdownContext = searchResult.results
              .map((r, i) => `${i + 1}. **${r.title}**\n${r.url}\n${r.snippet || ''}`)
              .join('\n\n');
          }
        } else {
          usedUrl = 'Search Results';
          markdownContext = searchResult.error || 'No results found.';
        }
      }
    } else {
      return { ok: false, error: 'Either task or start_url is required' };
    }

    return {
      ok: true,
      url: usedUrl,
      live_url: liveUrl,
      content: markdownContext.slice(0, 15000),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolListLocalFiles(args) {
  try {
    const dir = String(args?.dir || '.').trim();
    const resolvedPath = _path.resolve(REPO_ROOT, dir);
    if (!isPathSafe(resolvedPath)) return { ok: false, error: 'access denied: path points to a restricted OS directory' };
    if (!_fs.existsSync(resolvedPath)) return { ok: false, error: 'directory not found' };

    const entries = _fs.readdirSync(resolvedPath, { withFileTypes: true });
    const files = entries.map(e => {
      const full = _path.join(resolvedPath, e.name);
      if (e.isDirectory()) {
        return { name: e.name + '/', type: 'dir' };
      }
      try {
        const st = _fs.statSync(full);
        return { name: e.name, type: 'file', size: st.size };
      } catch (_) {
        return { name: e.name, type: 'file' };
      }
    });
    return { ok: true, dir, files };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolReadLocalFile(args) {
  try {
    const filePath = String(args?.path || '').trim();
    if (!filePath) return { ok: false, error: 'missing file path' };
    const resolvedPath = _path.resolve(REPO_ROOT, filePath);
    if (!isPathSafe(resolvedPath)) return { ok: false, error: 'access denied: path points to a restricted OS directory' };
    if (!_fs.existsSync(resolvedPath)) return { ok: false, error: 'file not found' };

    const raw = _fs.readFileSync(resolvedPath, 'utf8');
    const allLines = raw.split('\n');
    const totalLines = allLines.length;

    // Support line-range reading for large files
    const startLine = Math.max(1, parseInt(args?.start_line, 10) || 1);
    const endLine = Math.min(totalLines, parseInt(args?.end_line, 10) || totalLines);
    const sliced = allLines.slice(startLine - 1, endLine);

    // Add line numbers for precision editing
    const numbered = sliced.map((line, i) => `${startLine + i}: ${line}`).join('\n');
    const cap = 50000;
    const content = numbered.length > cap ? numbered.slice(0, cap) + '\n...[truncated]' : numbered;

    return { ok: true, path: filePath, totalLines, showing: `${startLine}-${endLine}`, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolEditLocalFile(args) {
  try {
    const filePath = String(args?.path || '').trim();
    const content = String(args?.content || '');
    if (!filePath) return { ok: false, error: 'missing file path' };
    const resolvedPath = _path.resolve(REPO_ROOT, filePath);
    if (!isPathSafe(resolvedPath)) return { ok: false, error: 'access denied: path points to a restricted OS directory' };

    const dir = _path.dirname(resolvedPath);
    if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });

    _fs.writeFileSync(resolvedPath, content, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolSearchCodebase(args) {
  try {
    const query = String(args?.query || '');
    if (!query) return { ok: false, error: 'Query is required' };
    const safeQuery = query.replace(/"/g, '\\"');
    // Support file-type filtering via include glob (e.g. '*.js', '*.jsx')
    const includeGlob = args?.include ? ` -- '${String(args.include).replace(/'/g, '')}'` : '';
    const caseSensitive = args?.case_sensitive === false ? '-i ' : '';
    const { stdout } = await _exec(`git grep -nI ${caseSensitive}"${safeQuery}"${includeGlob}`, { cwd: REPO_ROOT });
    const lines = stdout.trim().split('\n');
    const matches = lines.slice(0, 100).join('\n');
    return { ok: true, matches: matches || 'No matches found.', total: lines.length, truncated: lines.length > 100 };
  } catch (err) {
    return { ok: true, matches: 'No matches found.', total: 0 };
  }
}

async function toolReplaceInFile(args) {
  try {
    const filePath = String(args?.path || '').trim();
    const targetText = String(args?.target_text || '');
    const replacementText = String(args?.replacement_text || '');

    if (!filePath || !targetText) return { ok: false, error: 'path and target_text are required' };
    const resolvedPath = _path.resolve(REPO_ROOT, filePath);
    if (!isPathSafe(resolvedPath)) return { ok: false, error: 'access denied: restricted directory' };
    if (!_fs.existsSync(resolvedPath)) return { ok: false, error: 'File does not exist' };

    const content = _fs.readFileSync(resolvedPath, 'utf8');
    if (!content.includes(targetText)) {
      return { ok: false, error: 'Target text not found in the file. It must match exactly.' };
    }

    // Strict replacement of the first occurrence (or all, but usually targeted)
    const newContent = content.replace(targetText, replacementText);
    _fs.writeFileSync(resolvedPath, newContent, 'utf8');

    return { ok: true, path: filePath, status: 'Replaced successfully' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolCreateGithubPr(args) {
  try {
    const title = String(args?.title || 'Automated Kelion PR');
    const branch = String(args?.branch || 'feat/kelion-auto-' + Date.now());
    const message = String(args?.message || 'feat: automated updates');

    let gitStatus = '';
    try {
      const st = await _exec('git status --porcelain', { cwd: REPO_ROOT });
      gitStatus = st.stdout;
    } catch (e) { }

    if (!gitStatus.trim()) {
      return { ok: false, error: 'No changes to commit' };
    }

    await _exec(`git checkout -b ${branch}`, { cwd: REPO_ROOT });
    await _exec(`git add .`, { cwd: REPO_ROOT });
    await _exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: REPO_ROOT });
    await _exec(`git push -u origin ${branch}`, { cwd: REPO_ROOT });

    try {
      const { stdout: prUrl } = await _exec(`gh pr create --title "${title.replace(/"/g, '\\"')}" --body "Automated PR from Kelion."`, { cwd: REPO_ROOT });
      return { ok: true, url: prUrl.trim() };
    } catch (e) {
      return { ok: true, url: `https://github.com/adrianenc11-hue/kelionai-v2/pull/new/${branch}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function toolManageGithubPrs(args) {
  try {
    const action = args?.action;
    const prNumber = args?.pr_number;

    if (action === 'list') {
      const { stdout } = await _exec('gh pr list --state open --json number,title,url', { cwd: REPO_ROOT });
      return { ok: true, prs: JSON.parse(stdout || '[]') };
    } else if (action === 'merge') {
      if (!prNumber) return { ok: false, error: 'pr_number is required to merge' };
      const { stdout } = await _exec(`gh pr merge ${prNumber} --merge --admin`, { cwd: REPO_ROOT });
      return { ok: true, result: stdout };
    } else if (action === 'close') {
      if (!prNumber) return { ok: false, error: 'pr_number is required to close' };
      const { stdout } = await _exec(`gh pr close ${prNumber}`, { cwd: REPO_ROOT });
      return { ok: true, result: stdout };
    } else {
      return { ok: false, error: 'Unknown action. Use list, merge, or close.' };
    }
  } catch (err) {
    return { ok: false, error: 'GitHub CLI (gh) execution failed. You might need to authenticate using "gh auth login" in terminal. Details: ' + err.message };
  }
}
// ──────────────────────────────────────────────────────────────────
// Dispatch


// ── Agentic Loop: execute_plan ──────────────────────────────────
// Runs a sequence of tool calls server-side, passing results between
// steps. Each step can reference previous results via {{step_N}} in
// its args. On failure, optionally consults ask_expert_coder and
// retries. Returns a full execution report.
// Max 15 steps, 120s total timeout.
async function toolExecutePlan(args, ctx) {
  const MAX_STEPS = 15;
  const MAX_TOTAL_MS = 120000;
  let steps;
  try {
    steps = typeof args?.steps === 'string' ? JSON.parse(args.steps) : args?.steps;
  } catch (e) {
    return { ok: false, error: 'Invalid steps JSON: ' + e.message };
  }
  if (!Array.isArray(steps) || !steps.length) {
    return { ok: false, error: 'steps must be a non-empty array of { tool, args, on_fail? }' };
  }
  if (steps.length > MAX_STEPS) {
    return { ok: false, error: `Too many steps (max ${MAX_STEPS}). Split into multiple plans.` };
  }

  const report = [];
  const startTime = Date.now();

  // Interpolate {{step_N}} and {{step_N.field}} placeholders in a string
  function interpolate(str, results) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{\{step_(\d+)(?:\.(\w+))?\}\}/g, (_, idx, field) => {
      const r = results[parseInt(idx, 10)];
      if (!r) return `[step_${idx}: not yet executed]`;
      if (field) {
        const val = r.result?.[field];
        return val !== undefined ? String(val) : `[step_${idx}.${field}: not found]`;
      }
      // Return a compact JSON of the result
      try { return JSON.stringify(r.result).slice(0, 2000); }
      catch (_) { return '[unparseable]'; }
    });
  }

  // Deep-interpolate all string values in an args object
  function interpolateArgs(obj, results) {
    if (typeof obj === 'string') return interpolate(obj, results);
    if (Array.isArray(obj)) return obj.map(v => interpolateArgs(v, results));
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = interpolateArgs(v, results);
      return out;
    }
    return obj;
  }

  for (let i = 0; i < steps.length; i++) {
    // Timeout guard
    if (Date.now() - startTime > MAX_TOTAL_MS) {
      report.push({ step: i, tool: steps[i]?.tool, status: 'skipped', reason: 'total timeout exceeded' });
      continue;
    }

    const step = steps[i];
    const toolName = String(step?.tool || '').trim();
    if (!toolName) {
      report.push({ step: i, tool: '(empty)', status: 'error', error: 'missing tool name' });
      continue;
    }

    const rawArgs = step.args || {};
    const finalArgs = interpolateArgs(rawArgs, report);

    let result;
    try {
      result = await executeRealTool(toolName, finalArgs, ctx);
      if (result === null) {
        result = { ok: false, error: `Tool '${toolName}' not found in executor` };
      }
    } catch (err) {
      result = { ok: false, error: err.message };
    }

    const succeeded = result?.ok !== false;
    report.push({ step: i, tool: toolName, status: succeeded ? 'ok' : 'error', result });

    // Auto-heal on failure: consult expert and retry once
    if (!succeeded && step.on_fail !== 'skip' && step.on_fail !== 'stop') {
      const errorMsg = result?.error || result?.stderr || JSON.stringify(result).slice(0, 500);
      // Try to get a fix from the expert
      const expertResult = await toolAskExpertCoder({
        question: `A tool call failed. How should I fix this and retry?\n\nTool: ${toolName}\nArgs: ${JSON.stringify(finalArgs).slice(0, 1000)}\nError: ${errorMsg}`,
        context: `This is step ${i} of an automated plan. The goal is: ${args?.goal || 'complete the plan successfully'}.`,
      });

      if (expertResult?.ok && expertResult.answer) {
        report[report.length - 1].auto_heal = {
          consulted: true,
          suggestion: expertResult.answer.slice(0, 500),
        };
        // Retry the same step once with original args (expert advice is for the model's next plan)
        try {
          const retryResult = await executeRealTool(toolName, finalArgs, ctx);
          if (retryResult?.ok !== false) {
            report[report.length - 1].status = 'ok_after_retry';
            report[report.length - 1].result = retryResult;
          }
        } catch (_) { /* keep original error */ }
      }
    }

    // Stop execution if step failed and on_fail === 'stop'
    if (!succeeded && step.on_fail === 'stop') {
      report.push({ step: i + 1, status: 'aborted', reason: 'previous step failed with on_fail=stop' });
      break;
    }
  }

  const elapsed = Date.now() - startTime;
  const okCount = report.filter(r => r.status === 'ok' || r.status === 'ok_after_retry').length;
  return {
    ok: okCount > 0,
    summary: `${okCount}/${steps.length} steps succeeded in ${(elapsed / 1000).toFixed(1)}s`,
    steps: report,
  };
}


// F11 — Image generation. Returns a short-lived URL pointing at
// the in-process cache served by routes/generatedImages.js — the voice
// model's read-back stays tiny while the client gets a real PNG URL to
// embed on the avatar's stage monitor.
const { generateImage } = require('./imageGen');
async function toolGenerateImage(args) {
  const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
  const size = typeof args?.size === 'string' ? args.size : undefined;
  return generateImage({ prompt, size });
}

async function executeRealTool(name, args, ctx) {
  // Strip any leading-underscore keys from caller-supplied args. These are
  // reserved for internal wrappers (e.g. toolGetForecast passes `_maxDays`
  // to relax toolGetWeather's 7-day ceiling). An external caller posting
  // `{ _maxDays: 16 }` to /api/tools/execute shouldn't be able to bypass
  // the public contract of a tool. The reserved prefix is documented in
  // the tool schemas so this is a defence-in-depth, not a breaking change.
  const a = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k.startsWith('_')) continue;
    a[k] = v;
  }
  switch (name) {
    // ── math / offline ──
    case 'calculate': return toolCalculate(a);
    case 'unit_convert': return toolUnitConvert(a);
    case 'get_moon_phase': return toolGetMoonPhase(a);
    // ── radio / streaming ──
    case 'play_radio': return toolPlayRadio(a);
    // ── weather / feeds ──
    case 'get_weather': return toolGetWeather(a);
    case 'get_forecast': return toolGetForecast(a);
    case 'get_air_quality': return toolGetAirQuality(a);
    case 'get_news': return toolGetNews(a);
    case 'get_crypto_price': return toolGetCryptoPrice(a);
    case 'get_stock_price': return toolGetStockPrice(a);
    case 'get_forex': return toolGetForex(a);
    case 'currency_convert': return toolCurrencyConvert(a);
    case 'get_earthquakes': return toolGetEarthquakes(a);
    case 'get_sun_times': return toolGetSunTimes(a);
    // ── geo ──
    case 'geocode': return toolGeocode(a);
    case 'reverse_geocode': return toolReverseGeocode(a);
    case 'get_route': return toolGetRoute(a);
    case 'nearby_places': return toolNearbyPlaces(a);
    case 'get_elevation': return toolGetElevation(a);
    case 'get_timezone': return toolGetTimezone(a);
    // ── web / search ──
    case 'web_search': return toolWebSearch(a);
    case 'search_academic': return toolSearchAcademic(a);
    case 'search_github': return toolSearchGithub(a);
    case 'search_stackoverflow': return toolSearchStackoverflow(a);
    case 'fetch_url': return toolFetchUrl(a);
    case 'rss_read': return toolRssRead(a);
    // ── knowledge ──
    case 'wikipedia_search': return toolWikipediaSearch(a);
    case 'dictionary': return toolDictionary(a);
    // ── translation ──
    case 'translate': return toolTranslate(a);

    // ── PR B — documents + OCR ──
    case 'read_pdf': return toolReadPdf(a);
    case 'read_docx': return toolReadDocx(a);
    case 'ocr_image': return toolOcrImage(a);
    case 'ocr_passport': return toolOcrPassport(a);
    // ── PR D — communications + automations + package info ──
    case 'send_email': return toolSendEmail(a);
    case 'send_sms': return toolSendSms(a);
    case 'create_calendar_ics': return toolCreateCalendarIcs(a);
    case 'zapier_trigger': return toolZapierTrigger(a);
    case 'github_repo_info': return toolGithubRepoInfo(a);
    case 'list_github_repo_files': return toolListGithubRepoFiles(a);
    case 'read_github_file': return toolReadGithubFile(a);
    case 'npm_package_info': return toolNpmPackageInfo(a);
    case 'pypi_package_info': return toolPypiPackageInfo(a);
    // ── Local File tools ──
    case 'read_local_file': return toolReadLocalFile(a);
    case 'list_local_files': return toolListLocalFiles(a);
    case 'edit_local_file': return toolEditLocalFile(a);
    case 'search_codebase': return toolSearchCodebase(a);
    case 'replace_in_file': return toolReplaceInFile(a);
    case 'create_github_pr': return toolCreateGithubPr(a);
    case 'manage_github_prs': return toolManageGithubPrs(a);
    // ── God Mode aliases (declared in KELION_TOOLS, route to existing impls) ──
    case 'run_command': return toolRunTerminalCommand(a);
    case 'write_to_file': return toolEditLocalFile(a);
    case 'replace_file_content': return toolReplaceInFile(a);
    case 'multi_replace_file_content': {
      // Accepts { path, replacements: '[{target_content,replacement_content},...]' }
      try {
        const filePath = String(a?.path || '').trim();
        const reps = JSON.parse(a?.replacements || '[]');
        if (!filePath) return { ok: false, error: 'path is required' };
        const resolvedPath = _path.resolve(REPO_ROOT, filePath);
        if (!isPathSafe(resolvedPath)) return { ok: false, error: 'access denied' };
        if (!_fs.existsSync(resolvedPath)) return { ok: false, error: 'file not found' };
        let content = _fs.readFileSync(resolvedPath, 'utf8');
        let applied = 0;
        for (const r of reps) {
          if (r.target_content && content.includes(r.target_content)) {
            content = content.replace(r.target_content, r.replacement_content || '');
            applied++;
          }
        }
        _fs.writeFileSync(resolvedPath, content, 'utf8');
        return { ok: true, path: filePath, applied, total: reps.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    // ── Agentic Expert Tools ──
    case 'run_terminal_command': return toolRunTerminalCommand(a);
    case 'ask_expert_coder': return toolAskExpertCoder(a);
    case 'fetch_documentation': return toolFetchDocumentation(a);
    case 'browse_web': return toolBrowseWeb(a);
    // ── PR C — sandbox + regex + user-intern ──
    case 'run_regex': return toolRunRegex(a);
    case 'run_code': return toolRunCode(a);
    case 'get_my_location': return toolGetMyLocation(a, ctx);
    case 'get_my_credits': return toolGetMyCredits(a, ctx);
    case 'get_my_usage': return toolGetMyUsage(a, ctx);
    case 'get_my_profile': return toolGetMyProfile(a, ctx);
    // ── F11 — image generation (gpt-image-1) ──
    case 'generate_image': return toolGenerateImage(a);
    // ── PR 8/N — Memory of Actions (read-only self-reflection) ──
    case 'get_action_history': return toolGetActionHistory(a, ctx);
    // ── Silent vision auto-learn — write durable observations ──
    case 'learn_from_observation': return toolLearnFromObservation(a, ctx);
    // ── Explicit memory from text chat — user says "my name is X" etc. ──
    case 'remember_fact': return toolRememberFact(a, ctx);
    // ── MCP — Google Calendar / Gmail / Drive (per-user OAuth) ──
    case 'read_calendar': return toolReadCalendar(a, ctx);
    case 'read_email': return toolReadEmail(a, ctx);
    case 'search_files': return toolSearchFiles(a, ctx);
    // ── Agentic Loop ──
    case 'execute_plan': return toolExecutePlan(a, ctx);
    // ── Gemma 4 Deep Reasoning ──

    // ── Position 0 — Super LLM capabilities ──
    case 'query_database': return toolQueryDatabase(a, ctx);
    case 'check_updates': return toolCheckUpdates(a);
    case 'conversation_summary': return toolConversationSummary(a, ctx);
    case 'thinking_mode': return toolThinkingMode(a);
    case 'deep_search': return toolDeepSearch(a);
    case 'memory_sources': return toolMemorySources(a, ctx);
    case 'self_verify': return toolSelfVerify(a);
    case 'data_visualize': return toolDataVisualize(a);
    case 'computer_use': return toolComputerUse(a);
    case 'auto_test': return toolAutoTest(a);
    case 'session_persist': return toolSessionPersist(a, ctx);
    case 'parallel_tools': return toolParallelTools(a, ctx);
    case 'document_parser': return toolDocumentParser(a);
    case 'ocr_engine': return toolOcrEngine(a);
    case 'image_generator_editor': return toolImageGeneratorEditor(a);
    case 'hardware_manager': return toolHardwareManager(a);
    case 'cloud_manager': return toolCloudManager(a);
    case 'communication_hub': return toolCommunicationHub(a);
    case 'automation_engine': return toolAutomationEngine(a);
    case 'devops_toolkit': return toolDevopsToolkit(a);
    case 'scheduler_pro': return toolSchedulerPro(a, ctx);
    case 'smart_monitor': return toolSmartMonitor(a, ctx);
    case 'deep_memory_architect': return toolDeepMemoryArchitect(a, ctx);
    case 'task_orchestrator': return toolTaskOrchestrator(a, ctx);
    case 'universal_executor': return toolUniversalExecutor(a);
    case 'video_analyze': return toolVideoAnalyze(a);
    case 'audio_analyze': return toolAudioAnalyze(a);
    case 'multimedia_analyzer': return toolMultimediaAnalyzer(a);
    case 'image_edit': return toolImageEdit(a);
    case 'spreadsheet_analyze': return toolSpreadsheetAnalyze(a);
    case 'vision_analyze': return toolVisionAnalyze(a);
    case 'screen_capture': return toolScreenCapture(a);
    case 'clipboard_manager': return toolClipboardManager(a);
    case 'system_bridge': return toolSystemBridge(a);
    case 'task_planner': return toolTaskPlanner(a, ctx);
    case 'context_cache': return toolContextCache(a, ctx);
    case 'mcp_protocol': return toolMcpProtocol(a, ctx);
    case 'scheduled_task': return toolScheduledTask(a, ctx);
    case 'qr_code': return toolQrCode(a);
    case 'smart_alert': return toolSmartAlert(a, ctx);

    default: return null; // signal "not handled here"
  }
}

// ── MCP tool implementations — delegate to googleMcp.js ─────────
// These were wired in the switch above but had no function bodies,
// which would cause a ReferenceError at runtime. Each one checks
// sign-in + MCP_ENABLED + Google connection before calling the API.
const googleMcp = require('./googleMcp');

async function toolReadCalendar(args, ctx) {
  if (!ctx?.user?.id) return { ok: false, signed_in: false, error: 'Calendar access requires sign-in.' };
  if (!process.env.MCP_ENABLED) return { ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' };
  const connected = await googleMcp.hasGoogleConnection(ctx.user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(ctx.user.id);
    return { ok: false, error: `Google account not connected. Connect at: ${url}`, connectUrl: url };
  }
  try {
    const range = typeof args?.range === 'string' ? args.range : 'this week';
    // Parse natural-language range into timeMin/timeMax
    const now = new Date();
    let timeMin = now.toISOString();
    let timeMax;
    const r = range.toLowerCase();
    if (r.includes('today')) {
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      timeMax = end.toISOString();
    } else if (r.includes('tomorrow')) {
      const start = new Date(now); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setHours(23, 59, 59, 999);
      timeMin = start.toISOString(); timeMax = end.toISOString();
    } else if (r.includes('week')) {
      const end = new Date(now); end.setDate(end.getDate() + 7);
      timeMax = end.toISOString();
    } else {
      const end = new Date(now); end.setDate(end.getDate() + 7);
      timeMax = end.toISOString();
    }
    return await googleMcp.listCalendarEvents(ctx.user.id, { maxResults: 15, timeMin, timeMax });
  } catch (err) {
    return { ok: false, error: 'Failed to fetch calendar: ' + (err?.message || err) };
  }
}

async function toolReadEmail(args, ctx) {
  if (!ctx?.user?.id) return { ok: false, signed_in: false, error: 'Email access requires sign-in.' };
  if (!process.env.MCP_ENABLED) return { ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' };
  const connected = await googleMcp.hasGoogleConnection(ctx.user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(ctx.user.id);
    return { ok: false, error: `Google account not connected. Connect at: ${url}`, connectUrl: url };
  }
  try {
    const query = typeof args?.query === 'string' ? args.query : '';
    const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 20);
    return await googleMcp.listEmails(ctx.user.id, { maxResults: limit, query });
  } catch (err) {
    return { ok: false, error: 'Failed to fetch emails: ' + (err?.message || err) };
  }
}

async function toolSearchFiles(args, ctx) {
  if (!ctx?.user?.id) return { ok: false, signed_in: false, error: 'File search requires sign-in.' };
  if (!process.env.MCP_ENABLED) return { ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' };
  const connected = await googleMcp.hasGoogleConnection(ctx.user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(ctx.user.id);
    return { ok: false, error: `Google account not connected. Connect at: ${url}`, connectUrl: url };
  }
  try {
    const query = typeof args?.query === 'string' ? args.query : '';
    const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 20);
    return await googleMcp.listDriveFiles(ctx.user.id, { maxResults: limit, query });
  } catch (err) {
    return { ok: false, error: 'Failed to search files: ' + (err?.message || err) };
  }
}

// Explicit memory save — user tells Kelion something worth remembering.
// Unlike learn_from_observation (camera inferences, low confidence),
// these are direct user statements → HIGH confidence (0.9).
async function toolRememberFact(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: true, signed_in: false, persisted: 0, note: 'Guest — memory only works when signed in.' };
  }
  const factText = typeof args?.fact === 'string' ? args.fact.trim() : '';
  if (!factText) return { ok: false, error: 'fact is required' };
  const fact = factText.slice(0, 500);
  const kindIn = typeof args?.kind === 'string' ? args.kind.trim().toLowerCase() : '';
  const allowed = new Set(['fact', 'preference', 'routine', 'context', 'skill', 'goal']);
  const kind = allowed.has(kindIn) ? kindIn : 'fact';
  try {
    const db = require('../db');
    const inserted = await db.addMemoryItems(userId, [{
      kind,
      fact,
      subject: 'self',
      confidence: 0.9, // HIGH — user explicitly stated this
    }]);
    return { ok: true, signed_in: true, persisted: inserted.length };
  } catch (err) {
    console.warn('[remember_fact] failed:', err && err.message);
    return { ok: false, error: 'persist failed' };
  }
}

// Silent auto-learn. Adrian: "sa tina pentru el si sa faca propriile
// analize si sa invete". When the camera is on, Kelion forms private
// observations about the user (mood, environment, recurring objects,
// what they appear to be working on). The HARD rule in the persona
// forbids announcing these out loud — so this tool persists them
// directly into memory_items as low-confidence facts, ready to be
// re-affirmed (or overridden) by the explicit fact-extractor on the
// next conversation. For guests we no-op gracefully.
// Per-user cooldown for learn_from_observation — the model calls this repeatedly
// when the camera is active, flooding the DB with near-identical rows.
const _learnCooldown = new Map(); // userId → lastCallMs

async function toolLearnFromObservation(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: true, signed_in: false, persisted: 0 };
  }
  // Rate-limit: 1 call per 10 seconds per user
  const now = Date.now();
  const last = _learnCooldown.get(userId) || 0;
  if (now - last < 10000) {
    return { ok: true, signed_in: true, persisted: 0, throttled: true };
  }
  _learnCooldown.set(userId, now);
  const observation = typeof args?.observation === 'string' ? args.observation.trim() : '';
  if (!observation) {
    return { ok: false, error: 'observation is required' };
  }
  // Cap to a sane size; the fact-extractor schema also caps at 500.
  const fact = observation.slice(0, 280);
  const kindIn = typeof args?.kind === 'string' ? args.kind.trim().toLowerCase() : '';
  // Allowed kinds mirror the fact extractor + a new "observation" bucket
  // so the consolidator can later separate "she said it" from "I noticed
  // it from video".
  const allowed = new Set(['observation', 'preference', 'routine', 'context', 'mood', 'skill']);
  const kind = allowed.has(kindIn) ? kindIn : 'observation';
  // Confidence MUST stay low — these are model inferences, not user
  // statements. The consolidator promotes a fact only after multiple
  // affirmations across sessions. Cap at 0.6.
  const confRaw = Number(args?.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.max(0.1, Math.min(0.6, confRaw))
    : 0.4;
  try {
    const db = require('../db');
    const inserted = await db.addMemoryItems(userId, [{
      kind,
      fact,
      subject: 'self',
      confidence,
    }]);
    return { ok: true, signed_in: true, persisted: inserted.length };
  } catch (err) {
    console.warn('[learn_from_observation] failed:', err && err.message);
    return { ok: false, error: 'persist failed' };
  }
}



// PR #8/N — Memory of Actions. Self-reflection tool: lets Kelion read
// back its own recent tool calls for the signed-in user so it can
// decide whether to re-run something or reference a prior result.
// Reads only action_history rows; never writes. Gracefully returns
// `{ ok:false, signed_in:false }` for guests so the voice model can
// say "I only track your actions once you sign in" instead of guessing.
async function toolGetActionHistory(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: false, signed_in: false, error: 'Action history is only available when you are signed in.' };
  }
  const limitRaw = Number.parseInt(args?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(40, limitRaw)) : 10;
  const sessionId = typeof args?.session_id === 'string' && args.session_id.trim()
    ? args.session_id.trim().slice(0, 80)
    : null;
  // Lazy require matches the other DB-touching tools (toolGetMyCredits,
  // toolGetMyUsage, …) — the db module has start-up side effects on
  // older Node paths, and the existing style here keeps that opt-in.
  const db = require('../db');
  const rows = await db.listRecentActions(userId, { limit, sessionId });
  const actions = rows.map((r) => ({
    id: r.id,
    tool: r.tool_name,
    ok: !!r.ok,
    args: r.args_summary || null,
    result: r.result_summary || null,
    duration_ms: r.duration_ms,
    at: r.created_at,
    session_id: r.session_id || null,
  }));
  return { ok: true, count: actions.length, actions };
}

// ═════════════════════════════════════════════════════════════════════
// Position 0 — Super LLM capabilities
// ═════════════════════════════════════════════════════════════════════

// 0.5 — query_database: Kelion interconnected to ALL data in the DB.
// READ-ONLY. Supports predefined query types to prevent SQL injection.
// The user's data is always scoped to their own user_id.
async function toolQueryDatabase(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: false, signed_in: false, error: 'Database access requires sign-in.' };
  }
  const db = require('../db');
  const query = String(args?.query || '').trim().toLowerCase();
  const limitRaw = Number.parseInt(args?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

  try {
    // Predefined safe query types — never runs raw SQL
    if (query.includes('conversation') || query.includes('chat') || query.includes('mesaj')) {
      // Conversation stats — indexed by day, clean output
      const convos = await db.listConversations(userId, 200);
      const totalConversations = convos.length;
      let totalMessages = 0;
      let userMessages = 0;
      let assistantMessages = 0;

      // Group conversations by day
      const byDay = {};
      for (const c of convos) {
        const rawDate = c.created_at ? String(c.created_at) : '';
        const dayKey = rawDate.slice(0, 10) || 'unknown';
        if (!byDay[dayKey]) byDay[dayKey] = { date: dayKey, conversations: 0, messages: 0, titles: [] };
        byDay[dayKey].conversations++;
        const msgCount = c.message_count || 0;
        byDay[dayKey].messages += msgCount;
        totalMessages += msgCount;
        if (byDay[dayKey].titles.length < 5) {
          byDay[dayKey].titles.push(c.title || 'Fara titlu');
        }
      }

      // Count user vs assistant messages from a sample of recent conversations
      for (const c of convos.slice(0, 30)) {
        try {
          const convoData = await db.getConversationWithMessages(userId, c.id);
          const msgs = (convoData && convoData.messages) || [];
          for (const m of msgs) {
            if (m.role === 'user') userMessages++;
            if (m.role === 'assistant') assistantMessages++;
          }
        } catch (_) { /* skip if conversation not accessible */ }
      }

      // Sort days newest first
      const days = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

      // Build human-readable summary so the AI presents clean text
      const dayLines = days.slice(0, limit).map(d => {
        const titlesStr = d.titles.length > 0 ? ` (${d.titles.join(', ')})` : '';
        return `  • ${d.date}: ${d.conversations} conversații, ${d.messages} mesaje${titlesStr}`;
      });
      const summary = [
        `Ai ${totalConversations} conversații în baza de date cu un total de ${totalMessages} mesaje.`,
        `Din ultimele 30 de conversații: ${userMessages} mesaje ale tale, ${assistantMessages} mesaje Kelion.`,
        ``,
        `Detalii pe zile:`,
        ...dayLines,
      ].join('\n');

      return {
        ok: true,
        type: 'conversations',
        summary,
        total_conversations: totalConversations,
        total_messages: totalMessages,
        user_messages: userMessages,
        assistant_messages: assistantMessages,
        by_day: days.slice(0, limit),
      };
    }

    if (query.includes('memor') || query.includes('fact') || query.includes('ține minte')) {
      // Memory items
      const memories = await db.listMemoryItems(userId);
      return {
        ok: true,
        type: 'memory',
        total_items: memories.length,
        items: memories.slice(0, limit).map(m => ({
          id: m.id, kind: m.kind, fact: m.fact, subject: m.subject,
          subject_name: m.subject_name, tier: m.tier,
          created_at: m.created_at, last_affirmed_at: m.last_affirmed_at,
        })),
      };
    }

    if (query.includes('action') || query.includes('acțiun') || query.includes('tool') || query.includes('history')) {
      // Action history
      const rows = await db.listRecentActions(userId, { limit });
      return {
        ok: true,
        type: 'actions',
        total: rows.length,
        actions: rows.map(r => ({
          id: r.id, tool: r.tool_name, ok: !!r.ok,
          args: r.args_summary, result: r.result_summary,
          duration_ms: r.duration_ms, at: r.created_at,
        })),
      };
    }

    if (query.includes('credit') || query.includes('minut') || query.includes('balanț') || query.includes('usage')) {
      // Credits + transactions
      const user = await db.getUserById(userId);
      const txRows = await db.getRecentTransactions(userId, limit);
      return {
        ok: true,
        type: 'credits',
        balance_minutes: user?.credits_balance_minutes || 0,
        transactions: txRows.map(t => ({
          id: t.id, delta_minutes: t.delta_minutes,
          kind: t.kind, note: t.note, created_at: t.created_at,
        })),
      };
    }

    if (query.includes('profil') || query.includes('cont') || query.includes('account') || query.includes('user')) {
      // User profile
      const user = await db.getUserById(userId);
      return {
        ok: true,
        type: 'profile',
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        subscription_tier: user.subscription_tier,
        credits_balance_minutes: user.credits_balance_minutes,
        preferred_language: user.preferred_language,
        created_at: user.created_at,
      };
    }

    // Default: return available query types
    return {
      ok: true,
      type: 'help',
      message: 'Specify what to query. Available types: conversations, memory, actions, credits, profile.',
      hint: 'Use natural language like: "show my conversations", "what facts do you remember", "my credit balance"',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.4 — check_updates: Verify npm dependency versions.
// Runs `npm outdated --json` in the project root and parses the result.
async function toolCheckUpdates(args) {
  const { execSync } = require('child_process');
  const target = String(args?.path || '.').trim();
  try {
    const cwd = _path.resolve(REPO_ROOT, target);
    // npm outdated returns exit code 1 when there ARE outdated packages
    let raw;
    try {
      raw = execSync('npm outdated --json 2>&1', { cwd, timeout: 30000 }).toString();
    } catch (e) {
      raw = e.stdout ? e.stdout.toString() : '{}';
    }
    const outdated = JSON.parse(raw || '{}');
    const packages = Object.entries(outdated).map(([name, info]) => ({
      name,
      current: info.current || 'N/A',
      wanted: info.wanted || 'N/A',
      latest: info.latest || 'N/A',
      type: info.type || 'dependencies',
      needs_update: info.current !== info.latest,
    }));
    const needsUpdate = packages.filter(p => p.needs_update);
    return {
      ok: true,
      total_packages: packages.length,
      outdated_count: needsUpdate.length,
      up_to_date: needsUpdate.length === 0,
      outdated: needsUpdate.slice(0, 50),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.24 — conversation_summary: Auto-summarize conversations for context.
async function toolConversationSummary(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: false, signed_in: false, error: 'Conversation summary requires sign-in.' };
  }
  const db = require('../db');
  const limitRaw = Number.parseInt(args?.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, limitRaw)) : 5;

  try {
    const convos = await db.listConversations(userId, limit);
    const summaries = [];
    for (const c of convos) {
      try {
        const convoData = await db.getConversationWithMessages(userId, c.id);
        const msgs = (convoData && convoData.messages) || [];
        const totalChars = msgs.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        const userMsgs = msgs.filter(m => m.role === 'user');
        const assistantMsgs = msgs.filter(m => m.role === 'assistant');
        // Extract key topics from user messages (first 3 unique first sentences)
        const topics = [...new Set(
          userMsgs
            .map(m => (m.content || '').split(/[.!?\n]/)[0].trim())
            .filter(s => s.length > 5)
            .slice(0, 3)
        )];
        summaries.push({
          id: c.id,
          title: c.title || 'Fara titlu',
          created_at: c.created_at,
          updated_at: c.updated_at,
          total_messages: msgs.length,
          user_messages: userMsgs.length,
          assistant_messages: assistantMsgs.length,
          total_characters: totalChars,
          key_topics: topics,
          first_user_message: userMsgs[0]?.content?.slice(0, 150) || '',
          last_user_message: userMsgs[userMsgs.length - 1]?.content?.slice(0, 150) || '',
        });
      } catch (_) { /* skip inaccessible conversations */ }
    }
    return {
      ok: true,
      total_conversations: convos.length,
      summaries,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.6 — thinking_mode: Visible chain-of-thought reasoning.
// Routes to OpenRouter with a "think step-by-step" wrapper and returns
// both the reasoning steps and the final answer, so the UI can display them.
async function toolThinkingMode(args) {
  const question = String(args?.question || '').trim();
  if (!question) return { ok: false, error: 'question is required' };

  const context = typeof args?.context === 'string' ? args.context : '';

  // Use ask_expert_coder internally but with a structured thinking prompt
  const thinkingPrompt = `You are a brilliant problem-solver. Think step-by-step to answer this question. Structure your response EXACTLY as follows:

THINKING:
1. [First reasoning step]
2. [Second reasoning step]
3. [Continue as needed]

ANSWER:
[Your final, concise answer]

Question: ${question}${context ? `\n\nContext: ${context}` : ''}`;

  try {
    const result = await toolAskExpertCoder({
      question: thinkingPrompt,
      context: context || 'Step-by-step reasoning required.',
    });

    if (!result?.ok) return { ok: false, error: result?.error || 'Thinking failed' };

    const answer = result.answer || '';
    // Parse thinking steps and final answer
    const thinkingMatch = answer.match(/THINKING:\s*([\s\S]*?)(?=ANSWER:|$)/i);
    const answerMatch = answer.match(/ANSWER:\s*([\s\S]*?)$/i);

    const steps = thinkingMatch
      ? thinkingMatch[1].trim().split(/\n/).filter(l => l.trim()).map(l => l.replace(/^\d+\.\s*/, '').trim())
      : [answer];
    const finalAnswer = answerMatch ? answerMatch[1].trim() : answer;

    return {
      ok: true,
      thinking_steps: steps,
      answer: finalAnswer,
      model_used: result.model || 'unknown',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.8 — deep_search: Multi-source web synthesis.
// Runs multiple web searches, fetches top pages, and synthesizes a report.
async function toolDeepSearch(args) {
  const topic = String(args?.topic || '').trim();
  if (!topic) return { ok: false, error: 'topic is required' };

  const maxSources = Math.min(Math.max(Number(args?.max_sources) || 5, 2), 10);

  try {
    // Generate multiple search angles
    const searchQueries = [
      topic,
      `${topic} latest news 2026`,
      `${topic} review analysis`,
    ];

    const allResults = [];
    for (const q of searchQueries.slice(0, 3)) {
      const searchResult = await toolWebSearch({ query: q, limit: maxSources });
      if (searchResult?.ok && searchResult.results) {
        for (const r of searchResult.results) {
          // Deduplicate by URL
          if (!allResults.find(x => x.url === r.url)) {
            allResults.push(r);
          }
        }
      }
    }

    // Fetch content from top results
    const fetched = [];
    for (const r of allResults.slice(0, maxSources)) {
      try {
        const page = await toolFetchUrl({ url: r.url });
        if (page?.ok && page.content) {
          fetched.push({
            title: r.title || r.url,
            url: r.url,
            snippet: r.snippet || '',
            content_preview: (page.content || '').slice(0, 800),
          });
        }
      } catch (_) {
        fetched.push({
          title: r.title || r.url,
          url: r.url,
          snippet: r.snippet || '',
          content_preview: r.snippet || '',
        });
      }
    }

    // Synthesize using expert coder
    const synthesisPrompt = `Synthesize a comprehensive report on: "${topic}"

Sources (${fetched.length}):
${fetched.map((f, i) => `[${i + 1}] ${f.title}\n    URL: ${f.url}\n    ${f.content_preview.slice(0, 300)}`).join('\n\n')}

Write a structured synthesis report with:
1. Key findings
2. Contradictions or disagreements between sources
3. Most reliable conclusion
Keep it under 500 words.`;

    let synthesis = '';
    try {
      const expert = await toolAskExpertCoder({
        question: synthesisPrompt,
        context: `Deep search synthesis for: ${topic}`,
      });
      synthesis = expert?.answer || 'Synthesis unavailable.';
    } catch (_) {
      synthesis = 'Could not synthesize — raw results provided.';
    }

    return {
      ok: true,
      topic,
      sources_found: allResults.length,
      sources_fetched: fetched.length,
      synthesis,
      sources: fetched.map(f => ({
        title: f.title,
        url: f.url,
        snippet: f.snippet,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.10 — memory_sources: Show exactly where a fact came from.
// Returns the user's memory items with metadata (timestamps, kind, confidence).
async function toolMemorySources(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    return { ok: false, signed_in: false, error: 'Memory sources requires sign-in.' };
  }
  const db = require('../db');
  const query = String(args?.query || '').trim().toLowerCase();

  try {
    const memories = await db.listMemoryItems(userId);
    let filtered = memories;

    // Filter by query if provided
    if (query) {
      filtered = memories.filter(m =>
        (m.fact || '').toLowerCase().includes(query) ||
        (m.kind || '').toLowerCase().includes(query) ||
        (m.subject_name || '').toLowerCase().includes(query)
      );
    }

    return {
      ok: true,
      total_memories: memories.length,
      matching: filtered.length,
      sources: filtered.slice(0, 30).map(m => ({
        id: m.id,
        fact: m.fact,
        kind: m.kind,
        subject: m.subject,
        subject_name: m.subject_name || null,
        confidence: m.confidence || null,
        tier: m.tier || null,
        created_at: m.created_at,
        last_affirmed_at: m.last_affirmed_at || null,
        source_type: 'memory_item',
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.2 — self_verify: Re-check outputs after an edit/action.
// Reads back a file after edit, or re-runs a check, to confirm correctness.
async function toolSelfVerify(args) {
  const action = String(args?.action || '').trim();
  const target = String(args?.target || '').trim();

  if (!action) return { ok: false, error: 'action is required (e.g. "check_file", "verify_url", "re_calculate")' };

  try {
    if (action === 'check_file' || action === 'verify_file') {
      if (!target) return { ok: false, error: 'target (file path) is required for check_file' };
      const resolvedPath = _path.resolve(REPO_ROOT, target);
      if (!_fs.existsSync(resolvedPath)) {
        return { ok: false, verified: false, error: `File does not exist: ${target}` };
      }
      const content = _fs.readFileSync(resolvedPath, 'utf8');
      const lines = content.split('\n').length;
      const bytes = Buffer.byteLength(content, 'utf8');

      // Basic syntax checks
      const checks = [];
      if (target.endsWith('.json')) {
        try { JSON.parse(content); checks.push({ check: 'valid_json', passed: true }); }
        catch (e) { checks.push({ check: 'valid_json', passed: false, error: e.message }); }
      }
      if (target.endsWith('.js') || target.endsWith('.jsx') || target.endsWith('.ts')) {
        const openBraces = (content.match(/{/g) || []).length;
        const closeBraces = (content.match(/}/g) || []).length;
        checks.push({
          check: 'balanced_braces', passed: openBraces === closeBraces,
          detail: `{ = ${openBraces}, } = ${closeBraces}`
        });
        const openParens = (content.match(/\(/g) || []).length;
        const closeParens = (content.match(/\)/g) || []).length;
        checks.push({
          check: 'balanced_parens', passed: openParens === closeParens,
          detail: `( = ${openParens}, ) = ${closeParens}`
        });
      }

      const allPassed = checks.every(c => c.passed);
      return {
        ok: true,
        verified: allPassed || checks.length === 0,
        file: target,
        lines,
        bytes,
        checks,
        preview_first_5: content.split('\n').slice(0, 5).join('\n'),
        preview_last_5: content.split('\n').slice(-5).join('\n'),
      };
    }

    if (action === 're_calculate' || action === 'verify_math') {
      if (!target) return { ok: false, error: 'target (expression) is required for re_calculate' };
      const result1 = toolCalculate({ expression: target });
      const result2 = toolCalculate({ expression: target });
      return {
        ok: true,
        verified: result1?.result === result2?.result,
        expression: target,
        result: result1?.result,
        double_check: result2?.result,
        match: result1?.result === result2?.result,
      };
    }

    if (action === 'verify_url') {
      if (!target) return { ok: false, error: 'target (URL) is required for verify_url' };
      const result = await toolFetchUrl({ url: target });
      return {
        ok: true,
        verified: result?.ok === true,
        url: target,
        status: result?.ok ? 'reachable' : 'unreachable',
        title: result?.title || null,
        content_length: result?.content?.length || 0,
      };
    }

    return {
      ok: false,
      error: `Unknown action: ${action}. Use: check_file, re_calculate, verify_url`,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 0.22 — data_visualize: Generate Chart.js HTML for the monitor.
// Returns ready-to-use HTML that can be shown via show_on_monitor(kind='html').
async function toolDataVisualize(args) {
  const chartType = String(args?.type || 'bar').trim().toLowerCase();
  const title = String(args?.title || 'Chart').trim();
  let labels, datasets;

  try {
    labels = typeof args?.labels === 'string' ? JSON.parse(args.labels) : args?.labels;
    datasets = typeof args?.data === 'string' ? JSON.parse(args.data) : args?.data;
  } catch (e) {
    return { ok: false, error: 'Invalid JSON in labels or data: ' + e.message };
  }

  if (!Array.isArray(labels) || !Array.isArray(datasets)) {
    return { ok: false, error: 'labels (array) and data (array of numbers or array of datasets) are required' };
  }

  // Support simple array of numbers or array of dataset objects
  const colors = ['#7c3aed', '#a78bfa', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];
  let chartDatasets;
  if (datasets.length > 0 && typeof datasets[0] === 'number') {
    chartDatasets = [{
      label: title,
      data: datasets,
      backgroundColor: labels.map((_, i) => colors[i % colors.length]),
      borderColor: labels.map((_, i) => colors[i % colors.length]),
      borderWidth: 1,
    }];
  } else {
    chartDatasets = datasets.map((ds, i) => ({
      label: ds.label || `Series ${i + 1}`,
      data: ds.data || ds.values || [],
      backgroundColor: ds.color || colors[i % colors.length],
      borderColor: ds.color || colors[i % colors.length],
      borderWidth: 1,
      fill: chartType === 'line' ? false : undefined,
    }));
  }

  const chartConfig = {
    type: chartType,
    data: { labels, datasets: chartDatasets },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: title, font: { size: 18 } } },
      scales: chartType !== 'pie' && chartType !== 'doughnut' ? {
        y: { beginAtZero: true }
      } : undefined,
    },
  };

  const html = `<div style="max-width:700px;margin:0 auto;padding:20px">
<canvas id="kelionChart"></canvas>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>new Chart(document.getElementById('kelionChart'), ${JSON.stringify(chartConfig)})</script>`;

  return {
    ok: true,
    chart_type: chartType,
    html,
    instruction: 'Call show_on_monitor(kind="html", query=<this html>) to display the chart.',
  };
}

// 0.1 — computer_use: Generate and run a Playwright automation script.
async function toolComputerUse(args) {
  const task = String(args?.task || '').trim();
  const url = String(args?.url || '').trim();
  if (!task) return { ok: false, error: 'task is required' };
  const expertResult = await toolAskExpertCoder({
    question: `Write a minimal Node.js Playwright script that does: "${task}"${url ? ` starting at ${url}` : ''}. Use chromium.launch({headless:true}). Output ONLY the script, no explanation. The script should console.log a JSON result at the end.`,
    context: 'Playwright automation. Keep it under 40 lines.',
  });
  if (!expertResult?.ok) return { ok: false, error: 'Could not generate script' };
  const script = (expertResult.answer || '').replace(/```[\w]*\n?/g, '').trim();
  const tmpFile = _path.join(REPO_ROOT, 'server', '.tmp_playwright_' + Date.now() + '.js');
  try {
    _fs.writeFileSync(tmpFile, script, 'utf8');
    const { stdout, stderr } = await _exec(`node "${tmpFile}"`, { cwd: _path.join(REPO_ROOT, 'server'), timeout: 30000 });
    try { _fs.unlinkSync(tmpFile); } catch (_) { }
    return { ok: true, output: stdout.trim(), errors: stderr?.trim() || null, script_preview: script.slice(0, 500) };
  } catch (err) {
    try { _fs.unlinkSync(tmpFile); } catch (_) { }
    return { ok: false, error: err.message, script_preview: script.slice(0, 300) };
  }
}

// 0.3 — auto_test: Write and run a Jest test for a given file/function.
async function toolAutoTest(args) {
  const target = String(args?.target || '').trim();
  if (!target) return { ok: false, error: 'target file or function is required' };
  let fileContent = '';
  try {
    const resolved = _path.resolve(REPO_ROOT, target);
    if (_fs.existsSync(resolved)) fileContent = _fs.readFileSync(resolved, 'utf8').slice(0, 3000);
  } catch (_) { }
  const expert = await toolAskExpertCoder({
    question: `Write a Jest test file for: ${target}. Output ONLY the test code.`,
    context: fileContent || `Testing ${target}`,
  });
  if (!expert?.ok) return { ok: false, error: 'Could not generate test' };
  const testCode = (expert.answer || '').replace(/```[\w]*\n?/g, '').trim();
  const testFile = _path.join(REPO_ROOT, 'server', '__tests__', `auto_${Date.now()}.test.js`);
  _fs.writeFileSync(testFile, testCode, 'utf8');
  try {
    const { stdout } = await _exec(`npx jest "${testFile}" --no-coverage 2>&1`, { cwd: _path.join(REPO_ROOT, 'server'), timeout: 30000 });
    try { _fs.unlinkSync(testFile); } catch (_) { }
    return { ok: true, output: stdout.slice(-1500), test_file: testFile };
  } catch (err) {
    try { _fs.unlinkSync(testFile); } catch (_) { }
    return { ok: false, error: err.message?.slice(0, 500), test_code_preview: testCode.slice(0, 500) };
  }
}

// 0.7 — session_persist: Save/restore key-value session data in DB.
async function toolSessionPersist(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) return { ok: false, signed_in: false, error: 'Session persistence requires sign-in.' };
  const action = String(args?.action || 'get').trim();
  const key = String(args?.key || '').trim();
  if (!key) return { ok: false, error: 'key is required' };
  const db = require('../db');
  try {
    if (action === 'set' || action === 'save') {
      const value = String(args?.value || '');
      await db.addMemoryItems(userId, [{ kind: 'context', fact: `[session:${key}] ${value}`, subject: 'self', confidence: 0.95 }]);
      return { ok: true, action: 'saved', key };
    }
    const memories = await db.listMemoryItems(userId);
    const match = memories.find(m => (m.fact || '').startsWith(`[session:${key}]`));
    if (match) {
      const value = match.fact.replace(`[session:${key}] `, '');
      return { ok: true, action: 'loaded', key, value, created_at: match.created_at };
    }
    return { ok: true, action: 'not_found', key, value: null };
  } catch (err) { return { ok: false, error: err.message }; }
}

// 0.9 — parallel_tools: Execute multiple tool calls in parallel.
async function toolParallelTools(args, ctx) {
  let calls;
  try { calls = typeof args?.calls === 'string' ? JSON.parse(args.calls) : args?.calls; }
  catch (e) { return { ok: false, error: 'Invalid calls JSON: ' + e.message }; }
  if (!Array.isArray(calls) || !calls.length) return { ok: false, error: 'calls must be a non-empty array of {tool, args}' };
  if (calls.length > 10) return { ok: false, error: 'Max 10 parallel calls' };
  const results = await Promise.allSettled(calls.map(c => executeRealTool(String(c.tool), c.args || {}, ctx)));
  const output = results.map((r, i) => ({
    tool: calls[i].tool, status: r.status, result: r.status === 'fulfilled' ? r.value : { error: r.reason?.message },
  }));
  const ok = output.filter(o => o.result?.ok !== false).length;
  return { ok: ok > 0, completed: output.length, succeeded: ok, results: output };
}

// 0.11 — video_analyze: Extract metadata from a video URL/file.
// 0.11A — multimedia_analyzer: Super-module for multimedia analysis.
async function toolMultimediaAnalyzer(args) {
  const url = String(args?.url || '').trim();
  const type = String(args?.type || 'video');
  if (!url) return { ok: false, error: 'url is required for multimedia analysis' };
  
  if (type === 'audio') {
    return toolAudioAnalyze({ url });
  } else {
    return toolVideoAnalyze({ url });
  }
}

// 0.11 — video_analyze: Analyze video URL metadata.
async function toolVideoAnalyze(args) {
  const url = String(args?.url || '').trim();
  if (!url) return { ok: false, error: 'url is required' };
  try {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const vidId = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (vidId) {
        const oembed = await toolFetchUrl({ url: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vidId}&format=json` });
        if (oembed?.ok) { try { const d = JSON.parse(oembed.content); return { ok: true, source: 'youtube', video_id: vidId, title: d.title, author: d.author_name, thumbnail: d.thumbnail_url }; } catch (_) { } }
      }
    }
    const page = await toolFetchUrl({ url });
    return { ok: true, source: 'url', url, content_length: page?.content?.length || 0, fetched: !!page?.ok };
  } catch (err) { return { ok: false, error: err.message }; }
}

// 0.12 — audio_analyze: Analyze audio file metadata.
async function toolAudioAnalyze(args) {
  const url = String(args?.url || '').trim();
  if (!url) return { ok: false, error: 'url is required' };
  const ext = _path.extname(url).toLowerCase();
  const formats = { '.mp3': 'MPEG Audio', '.wav': 'WAV', '.flac': 'FLAC', '.aac': 'AAC', '.ogg': 'Ogg Vorbis', '.m4a': 'MPEG-4 Audio' };
  return { ok: true, url, detected_format: formats[ext] || 'unknown', extension: ext || 'none', playable: ['.mp3', '.wav', '.ogg', '.aac', '.m4a'].includes(ext), instruction: 'Use show_on_monitor(kind="audio", query=<url>) to play.' };
}

// 0.13 — image_edit: Basic image manipulation instructions (delegates to run_code).
async function toolImageEdit(args) {
  const operation = String(args?.operation || '').trim();
  const source = String(args?.source || '').trim();
  if (!operation || !source) return { ok: false, error: 'operation and source are required' };
  const script = `from PIL import Image; img = Image.open("${source}"); ` +
    (operation === 'resize' ? `img = img.resize((${args?.width || 800}, ${args?.height || 600})); img.save("output.png"); print("resized")` :
      operation === 'grayscale' ? `img = img.convert("L"); img.save("output.png"); print("grayscale")` :
        operation === 'rotate' ? `img = img.rotate(${args?.angle || 90}); img.save("output.png"); print("rotated")` :
          `print("unknown operation: ${operation}")`);
  return toolRunCode ? await toolRunCode({ language: 'python', code: script }) : { ok: false, error: 'run_code unavailable' };
}

// 0.22A — image_generator_editor: Super-module for Image Gen, Edit, and QR codes.
async function toolImageGeneratorEditor(args) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'generate') return toolGenerateImage({ prompt: args?.prompt, size: args?.width ? `${args.width}x${args.height}` : 'auto' });
  if (action === 'edit') return toolImageEdit(args);
  if (action === 'qr_code') return toolQrCode({ text: args?.text, size: args?.width || 300 });
  return { ok: false, error: 'Unknown action. Expected generate, edit, or qr_code.' };
}

// 0.14 — spreadsheet_analyze: Parse and analyze CSV data.
async function toolSpreadsheetAnalyze(args) {
  const data = String(args?.data || '').trim();
  if (!data) return { ok: false, error: 'data (CSV string) is required' };
  const lines = data.split('\n').map(l => l.split(',').map(c => c.trim()));
  const headers = lines[0] || [];
  const rows = lines.slice(1).filter(r => r.length > 0);
  const numericCols = {};
  headers.forEach((h, i) => {
    const vals = rows.map(r => parseFloat(r[i])).filter(v => !isNaN(v));
    if (vals.length > 0) numericCols[h] = { count: vals.length, sum: vals.reduce((a, b) => a + b, 0), min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
  });
  return { ok: true, headers, total_rows: rows.length, total_columns: headers.length, numeric_analysis: numericCols, sample_rows: rows.slice(0, 5) };
}

// 0.15 — vision_analyze: Detailed image analysis (delegates to ask_expert with image description).
async function toolVisionAnalyze(args) {
  const description = String(args?.description || '').trim();
  const question = String(args?.question || 'Describe this image in detail').trim();
  if (!description) return { ok: false, error: 'description of the image/scene is required (from camera frame or user upload)' };
  const expert = await toolAskExpertCoder({ question: `Analyze this visual scene: ${description}\n\nQuestion: ${question}`, context: 'Visual analysis task.' });
  return { ok: !!expert?.ok, analysis: expert?.answer || 'Analysis unavailable', question };
}

// 0.16 — screen_capture: Client-side tool marker (actual capture in frontend).
async function toolScreenCapture(args) {
  return { ok: true, client_action: 'screen_capture', instruction: 'The client will capture the screen and send it as a frame. Use the camera frames to see the result.' };
}

// 0.17 — task_planner: Create a structured task list with priorities.
async function toolTaskPlanner(args, ctx) {
  const goal = String(args?.goal || '').trim();
  if (!goal) return { ok: false, error: 'goal is required' };
  const expert = await toolAskExpertCoder({
    question: `Create a structured task plan for: "${goal}". Return a JSON array of objects with: {task, priority (1-5), estimated_minutes, dependencies (array of task indices), status: "pending"}. Max 10 tasks.`,
    context: 'Task planning. Return ONLY valid JSON array.',
  });
  let tasks = [];
  try {
    const raw = (expert?.answer || '').match(/\[[\s\S]*\]/)?.[0];
    tasks = raw ? JSON.parse(raw) : [];
  } catch (_) { tasks = [{ task: goal, priority: 1, estimated_minutes: 30, dependencies: [], status: 'pending' }]; }
  return { ok: true, goal, tasks, total_tasks: tasks.length, estimated_total_minutes: tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0) };
}

// 0.18 — clipboard_manager: Client-side clipboard read/write.
async function toolClipboardManager(args) {
  const action = String(args?.action || 'read').trim();
  if (action === 'write') {
    const text = String(args?.text || '');
    return { ok: true, client_action: 'clipboard_write', text, instruction: 'Content will be copied to clipboard on the client.' };
  }
  return { ok: true, client_action: 'clipboard_read', instruction: 'The client will read clipboard contents and send them back.' };
}

// 0.20A — document_parser: Super-module for document parsing (PDF, DOCX, CSV).
async function toolDocumentParser(args) {
  const type = String(args?.type || '').trim().toLowerCase();
  if (type === 'pdf') return toolReadPdf(args);
  if (type === 'docx') return toolReadDocx(args);
  if (type === 'spreadsheet' || type === 'csv' || type === 'xlsx') return toolSpreadsheetAnalyze(args);
  return { ok: false, error: 'Unknown document_parser type. Expected pdf, docx, or spreadsheet.' };
}

// 0.18A — system_bridge: Super-module for system control.
async function toolSystemBridge(args) {
  const action = String(args?.action || '').trim();
  if (action === 'screen_capture') {
    return toolScreenCapture(args);
  } else if (action === 'clipboard_read' || action === 'clipboard_write') {
    return toolClipboardManager({ action: action.replace('clipboard_', ''), text: args?.text });
  }
  return { ok: false, error: 'Unknown system_bridge action. Expected screen_capture, clipboard_read, or clipboard_write.' };
}

// 0.23A — hardware_manager: Super-module for hardware control.
async function toolHardwareManager(args) {
  return { ok: true, client_action: 'hardware_manager', instruction: 'The client will handle the hardware configuration for ' + (args?.device || 'unknown') };
}

// 0.24A — cloud_manager: Super-module for cloud storage.
async function toolCloudManager(args) {
  return { ok: true, client_action: 'cloud_manager', instruction: 'Cloud interaction requires MCP OAuth context on the client for ' + (args?.provider || 'unknown') };
}

// 0.25A — communication_hub: Super-module for Email/SMS.
async function toolCommunicationHub(args) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'send_email') return toolSendEmail({ to: args?.to, subject: args?.subject, text: args?.body });
  if (action === 'compose_draft') return { ok: true, client_action: 'compose_email_draft', to: args?.to, subject: args?.subject, body: args?.body };
  if (action === 'send_sms') return toolSendSms({ to: args?.to, body: args?.body });
  return { ok: false, error: 'Unknown action. Expected send_email, compose_draft, or send_sms.' };
}

// 0.26A — automation_engine: Super-module for Zapier and webhooks.
async function toolAutomationEngine(args) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'zapier_trigger' || action === 'webhook_trigger') return toolZapierTrigger({ webhook_url: args?.webhook_url, payload: args?.payload });
  return { ok: false, error: 'Unknown action. Expected zapier_trigger or webhook_trigger.' };
}

// 0.27A — devops_toolkit: Super-module for Git/GitHub.
async function toolDevopsToolkit(args) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'repo_info') return toolGithubRepoInfo({ repo: args?.repo });
  if (action === 'list_files') return toolListGithubRepoFiles({ repo: args?.repo, branch: args?.branch });
  if (action === 'read_file') return toolReadGithubFile({ repo: args?.repo, path: args?.path, branch: args?.branch });
  if (action === 'create_pr') return toolCreateGithubPr({ repo: args?.repo, title: args?.title, body: args?.body });
  if (action === 'manage_prs') return toolManageGithubPrs({ repo: args?.repo, action: args?.pr_action, issue_number: args?.issue_number });
  return { ok: false, error: 'Unknown action for devops_toolkit.' };
}

// 0.28A — scheduler_pro: Super-module for time management.
async function toolSchedulerPro(args, ctx) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'read_calendar') return toolReadCalendar(args, ctx);
  if (action === 'create_ics') return toolCreateCalendarIcs(args);
  if (action === 'schedule_task') return toolScheduledTask(args, ctx);
  if (action === 'plan_tasks') return toolTaskPlanner(args, ctx);
  return { ok: false, error: 'Unknown scheduler_pro action.' };
}

// 0.29A — smart_monitor: Super-module for alerts and monitoring.
async function toolSmartMonitor(args, ctx) {
  return toolSmartAlert(args, ctx);
}

// 0.30A — deep_memory_architect: Super-module for memory and context.
async function toolDeepMemoryArchitect(args, ctx) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'context_cache') return toolContextCache(args, ctx);
  if (action === 'session_persist') return toolSessionPersist(args, ctx);
  if (action === 'remember_fact') return toolRememberFact(args, ctx);
  if (action === 'learn_from_observation') return toolLearnFromObservation(args, ctx);
  if (action === 'get_history') return toolGetActionHistory(args, ctx);
  return { ok: false, error: 'Unknown deep_memory_architect action.' };
}

// 0.31A — task_orchestrator: Super-module for execution plans and parallelization.
async function toolTaskOrchestrator(args, ctx) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'parallel') return toolParallelTools(args, ctx);
  if (action === 'execute_plan') return toolExecutePlan(args, ctx);
  return { ok: false, error: 'Unknown task_orchestrator action.' };
}

// 0.32A — universal_executor: Super-module for code and terminal execution.
async function toolUniversalExecutor(args) {
  const action = String(args?.action || '').trim().toLowerCase();
  if (action === 'run_code') return toolRunCode(args);
  if (action === 'run_terminal') return toolRunTerminalCommand(args);
  if (action === 'run_regex') return toolRunRegex(args);
  return { ok: false, error: 'Unknown universal_executor action.' };
}

// 0.19 — context_cache: In-memory context cache for cross-turn references.
const _contextCache = new Map();
async function toolContextCache(args, ctx) {
  const action = String(args?.action || 'get').trim();
  const key = String(args?.key || '').trim();
  const userId = ctx?.user?.id || 'guest';
  const cacheKey = `${userId}:${key}`;
  if (action === 'set' || action === 'save') {
    const value = args?.value;
    _contextCache.set(cacheKey, { value, stored_at: new Date().toISOString() });
    if (_contextCache.size > 200) { const oldest = _contextCache.keys().next().value; _contextCache.delete(oldest); }
    return { ok: true, action: 'cached', key };
  }
  if (action === 'delete') { _contextCache.delete(cacheKey); return { ok: true, action: 'deleted', key }; }
  if (action === 'list') {
    const keys = [..._contextCache.keys()].filter(k => k.startsWith(userId + ':')).map(k => k.split(':').slice(1).join(':'));
    return { ok: true, action: 'list', keys, count: keys.length };
  }
  const entry = _contextCache.get(cacheKey);
  return { ok: true, action: 'get', key, found: !!entry, value: entry?.value || null, stored_at: entry?.stored_at || null };
}

// 0.20 — mcp_protocol: MCP connector status and management.
async function toolMcpProtocol(args, ctx) {
  const action = String(args?.action || 'status').trim();
  const userId = ctx?.user?.id;
  if (!userId) return { ok: false, signed_in: false, error: 'MCP requires sign-in.' };
  const googleMcpMod = require('./googleMcp');
  if (action === 'status') {
    const connected = await googleMcpMod.hasGoogleConnection(userId).catch(() => false);
    return { ok: true, mcp_enabled: !!process.env.MCP_ENABLED, google_connected: connected, available_services: ['google_calendar', 'gmail', 'google_drive'] };
  }
  if (action === 'connect') {
    const url = googleMcpMod.getConnectUrl(userId);
    return { ok: true, connect_url: url, instruction: 'Open this URL to connect your Google account.' };
  }
  return { ok: true, action, note: 'Use action: status or connect' };
}

// 0.21 — scheduled_task: Schedule a reminder or future action.
const _scheduledTasks = new Map();
async function toolScheduledTask(args, ctx) {
  const action = String(args?.action || 'create').trim();
  const userId = ctx?.user?.id || 'guest';
  if (action === 'list') {
    const tasks = [..._scheduledTasks.values()].filter(t => t.userId === userId);
    return { ok: true, tasks: tasks.map(t => ({ id: t.id, description: t.description, scheduled_for: t.scheduled_for, status: t.status })), count: tasks.length };
  }
  if (action === 'cancel') {
    const id = String(args?.id || '');
    const task = _scheduledTasks.get(id);
    if (task && task.userId === userId) { clearTimeout(task.timer); task.status = 'cancelled'; return { ok: true, cancelled: id }; }
    return { ok: false, error: 'Task not found' };
  }
  const description = String(args?.description || '').trim();
  const delayMin = Math.max(1, Math.min(1440, Number(args?.delay_minutes) || 5));
  if (!description) return { ok: false, error: 'description is required' };
  const id = 'sched_' + Date.now();
  const scheduledFor = new Date(Date.now() + delayMin * 60000).toISOString();
  const timer = setTimeout(() => { const t = _scheduledTasks.get(id); if (t) t.status = 'fired'; }, delayMin * 60000);
  _scheduledTasks.set(id, { id, userId, description, delay_minutes: delayMin, scheduled_for: scheduledFor, status: 'pending', timer });
  if (_scheduledTasks.size > 100) { const oldest = [..._scheduledTasks.entries()].find(([, v]) => v.status !== 'pending'); if (oldest) _scheduledTasks.delete(oldest[0]); }
  return { ok: true, id, description, scheduled_for: scheduledFor, delay_minutes: delayMin };
}

// 0.23 — qr_code: Generate a QR code image URL.
async function toolQrCode(args) {
  const text = String(args?.text || '').trim();
  if (!text) return { ok: false, error: 'text is required' };
  const size = Math.min(Math.max(Number(args?.size) || 300, 100), 1000);
  const encoded = encodeURIComponent(text);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`;
  return { ok: true, qr_url: url, text, size, instruction: 'Call show_on_monitor(kind="image", query=<qr_url>) to display the QR code, or show_on_monitor(kind="html", query="<img src=\\"<qr_url>\\" />").' };
}

// 0.25 — smart_alert: Set up a condition-based alert.
const _smartAlerts = new Map();
async function toolSmartAlert(args, ctx) {
  const action = String(args?.action || 'create').trim();
  const userId = ctx?.user?.id || 'guest';
  if (action === 'list') {
    const alerts = [..._smartAlerts.values()].filter(a => a.userId === userId);
    return { ok: true, alerts: alerts.map(a => ({ id: a.id, condition: a.condition, message: a.message, status: a.status })), count: alerts.length };
  }
  if (action === 'delete') {
    const id = String(args?.id || '');
    if (_smartAlerts.has(id)) { _smartAlerts.delete(id); return { ok: true, deleted: id }; }
    return { ok: false, error: 'Alert not found' };
  }
  const condition = String(args?.condition || '').trim();
  const message = String(args?.message || '').trim();
  if (!condition || !message) return { ok: false, error: 'condition and message are required' };
  const id = 'alert_' + Date.now();
  _smartAlerts.set(id, { id, userId, condition, message, status: 'active', created_at: new Date().toISOString() });
  return { ok: true, id, condition, message, status: 'active' };
}

// Full list of tool names handled by this module — keeps catalogs honest.
const REAL_TOOL_NAMES = [
  'calculate', 'unit_convert', 'get_moon_phase',
  'get_weather', 'get_forecast', 'get_air_quality', 'get_news',
  'get_crypto_price', 'get_stock_price', 'get_forex', 'currency_convert',
  'get_earthquakes', 'get_sun_times',
  'geocode', 'reverse_geocode', 'get_route', 'nearby_places',
  'get_elevation', 'get_timezone',
  'web_search', 'search_academic', 'search_github', 'search_stackoverflow',
  'fetch_url', 'rss_read',
  'wikipedia_search', 'dictionary',
  'translate',
  // PR B — documents + OCR
  'read_pdf', 'read_docx', 'ocr_image', 'ocr_passport',
  // PR C — sandboxed runners + user-intern tools
  'run_regex', 'run_code', 'get_my_credits', 'get_my_usage', 'get_my_profile',
  // PR D — communications + automations + package info
  'send_email', 'send_sms', 'create_calendar_ics', 'zapier_trigger',
  'github_repo_info', 'list_github_repo_files', 'read_github_file', 'npm_package_info', 'pypi_package_info',
  // F11 — image generation
  'generate_image',
  // PR 8/N — Memory of Actions
  'get_action_history',
  // Explicit memory save
  'remember_fact',
  // Live radio streaming
  'play_radio',
  // Deep reasoning
  'deep_think',
  // ── God Mode tools (local file ops + terminal) ──
  'run_command', 'run_terminal_command',
  'write_to_file', 'replace_file_content', 'multi_replace_file_content',
  'read_local_file', 'list_local_files', 'edit_local_file',
  'search_codebase', 'replace_in_file',
  'create_github_pr', 'manage_github_prs',
  'ask_expert_coder', 'fetch_documentation', 'browse_web',
  'execute_plan',
  // Silent vision auto-learn
  'learn_from_observation',
  // MCP — Google Calendar / Gmail / Drive
  'read_calendar', 'read_email', 'search_files',
  // ── Position 0 — Super LLM capabilities ──
  'query_database', 'check_updates', 'conversation_summary',
  'thinking_mode', 'deep_search', 'memory_sources', 'self_verify', 'data_visualize',
  'computer_use', 'auto_test', 'session_persist', 'parallel_tools',
  'video_analyze', 'audio_analyze', 'image_edit', 'spreadsheet_analyze',
  'vision_analyze', 'screen_capture', 'task_planner', 'clipboard_manager',
  'context_cache', 'mcp_protocol', 'scheduled_task', 'qr_code', 'smart_alert',
  'multimedia_analyzer', 'system_bridge', 'document_parser', 'ocr_engine',
  'image_generator_editor', 'hardware_manager', 'cloud_manager',
  'communication_hub', 'automation_engine', 'devops_toolkit',
  'scheduler_pro', 'smart_monitor', 'deep_memory_architect', 'task_orchestrator', 'universal_executor',
];

module.exports = {
  executeRealTool,
  pickForcedTool,
  REAL_TOOL_NAMES,
  // math / offline
  toolCalculate,
  toolUnitConvert,
  toolGetMoonPhase,
  // weather / feeds
  toolGetWeather,
  toolGetForecast,
  toolGetAirQuality,
  toolGetNews,
  toolGetCryptoPrice,
  toolGetStockPrice,
  toolGetForex,
  toolCurrencyConvert,
  toolGetEarthquakes,
  toolGetSunTimes,
  // geo
  toolGeocode,
  toolReverseGeocode,
  toolGetRoute,
  toolNearbyPlaces,
  toolGetElevation,
  toolGetTimezone,
  // web / search
  toolWebSearch,
  toolSearchAcademic,
  toolSearchGithub,
  toolSearchStackoverflow,
  toolFetchUrl,
  toolRssRead,
  // knowledge
  toolWikipediaSearch,
  toolDictionary,
  // translation
  toolTranslate,
  // PR B — documents + OCR
  toolReadPdf,
  toolReadDocx,
  toolOcrImage,
  toolOcrPassport,
  parseMrz,
  // PR C — sandbox + regex + user-intern
  toolRunRegex,
  toolRunCode,
  toolGetMyLocation,
  toolGetMyCredits,
  toolGetMyUsage,
  toolGetMyProfile,
  // PR D — communications + automations + package info
  toolSendEmail,
  toolSendSms,
  toolCreateCalendarIcs,
  toolZapierTrigger,
  toolGithubRepoInfo,
  toolListGithubRepoFiles,
  toolReadGithubFile,
  toolNpmPackageInfo,
  toolPypiPackageInfo,
  toolReadLocalFile,
  toolListLocalFiles,
  toolEditLocalFile,
  toolCreateGithubPr,
  toolRunTerminalCommand,
  toolAskExpertCoder,
  toolFetchDocumentation,
  // F11 — image generation
  toolGenerateImage,
  // PR 8/N — Memory of Actions
  toolGetActionHistory,
  // Silent auto-learn — observations from camera persisted to memory_items
  toolLearnFromObservation,
  // Explicit memory save from text chat
  toolRememberFact,
  // Faza A — global live radio search (radio-browser.info, ~50k stations)
  toolPlayRadio,
  // ── Position 0 — Super LLM capabilities ──
  toolQueryDatabase,
  toolCheckUpdates,
  toolConversationSummary,
  toolThinkingMode,
  toolDeepSearch,
  toolMemorySources,
  toolSelfVerify,
  toolDataVisualize,
  toolComputerUse,
  toolAutoTest,
  toolSessionPersist,
  toolParallelTools,
  toolVideoAnalyze,
  toolAudioAnalyze,
  toolImageEdit,
  toolSpreadsheetAnalyze,
  toolVisionAnalyze,
  toolScreenCapture,
  toolTaskPlanner,
  toolClipboardManager,
  toolContextCache,
  toolMcpProtocol,
  toolScheduledTask,
  toolQrCode,
  toolSmartAlert,
  toolMultimediaAnalyzer,
  toolSystemBridge,
  toolDocumentParser,
  toolOcrEngine,
  toolImageGeneratorEditor,
  toolHardwareManager,
  toolCloudManager,
  toolCommunicationHub,
  toolAutomationEngine,
  toolDevopsToolkit,
  toolSchedulerPro,
  toolSmartMonitor,
  toolDeepMemoryArchitect,
  toolTaskOrchestrator,
  toolUniversalExecutor,
  // Memory files
  storeTempFile,
  getTempFile,
};
