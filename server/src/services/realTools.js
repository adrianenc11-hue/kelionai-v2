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
mathRestricted.import(
  {
    // Wipe the dangerous constructors + anything that builds arbitrary
    // sized collections. If a user really needs matrices they can use the
    // UI once we add a dedicated tool for it — not free-form math.
    ones:       () => { throw new Error('matrix constructors disabled'); },
    zeros:      () => { throw new Error('matrix constructors disabled'); },
    identity:   () => { throw new Error('matrix constructors disabled'); },
    diag:       () => { throw new Error('matrix constructors disabled'); },
    range:      () => { throw new Error('range is disabled'); },
    concat:     () => { throw new Error('concat is disabled'); },
    flatten:    () => { throw new Error('flatten is disabled'); },
    resize:     () => { throw new Error('resize is disabled'); },
    reshape:    () => { throw new Error('reshape is disabled'); },
    matrix:     () => { throw new Error('matrix is disabled'); },
    // Factorial / gamma allow small-expression OOM (e.g. `1e9!`) — cap.
    factorial:  (n) => {
      const x = Number(n);
      if (!Number.isFinite(x) || x < 0 || x > 170) {
        throw new Error('factorial out of range (0..170)');
      }
      let out = 1;
      for (let i = 2; i <= x; i += 1) out *= i;
      return out;
    },
    gamma:      () => { throw new Error('gamma is disabled'); },
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

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const fetchImpl = await getFetch();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    latitude:  hit.latitude,
    longitude: hit.longitude,
    name:      hit.name,
    country:   hit.country || null,
    timezone:  hit.timezone || null,
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
      daily:   data.daily  || null,
      units:   { ...(data.current_units || {}), ...(data.daily_units || {}) },
      source:  'open-meteo.com',
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
    if (country)  params.set('country',  String(country).slice(0, 60));
    if (language) params.set('language', String(language).slice(0, 60));
    if (tag)      params.set('tag',      String(tag).slice(0, 40));
    url = `${host}/json/stations/search?${params.toString()}`;
  } else {
    const params = new URLSearchParams({
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: String(n * 4),
    });
    if (country)  params.set('country',  String(country).slice(0, 60));
    if (language) params.set('language', String(language).slice(0, 60));
    if (tag)      params.set('tag',      String(tag).slice(0, 40));
    url = `${host}/json/stations/search?${params.toString()}`;
  }
  try {
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'KelionAI/1.0 (+https://kelionai.app)' },
    }, 6000);
    if (!r.ok) return { ok: false, error: `radio-browser ${r.status}` };
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, error: `no station found for "${q || (country||language||tag)}"` };
    }
    // Filter to entries that have a working stream URL.
    const playable = arr
      .map((s) => ({
        name:    (s.name || '').toString().trim(),
        url:     (s.url_resolved || s.url || '').toString().trim(),
        country: (s.country || '').toString(),
        language:(s.language || '').toString(),
        codec:   (s.codec || '').toString().toLowerCase(),
        bitrate: Number(s.bitrate) || null,
        homepage:(s.homepage || '').toString(),
        favicon: (s.favicon || '').toString(),
        tags:    (s.tags || '').toString(),
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

  // Tavily preferred when a key is present — AI-optimized search with
  // summarization + URLs. Falls through to Serper, then DuckDuckGo.
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
        method:  'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q, num: n }),
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

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `search API ${r.status}` };
    const data = await r.json();
    const results = [];
    if (data.AbstractText) {
      results.push({
        title:   data.Heading || q,
        url:     data.AbstractURL || null,
        snippet: data.AbstractText,
      });
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
    return {
      ok: true,
      query: q,
      results,
      answer: data.Answer || null,
      definition: data.Definition || null,
      source: 'duckduckgo.com',
      note: results.length === 0 ? 'DuckDuckGo Instant Answer returned no direct hit — the model should answer honestly that it has no indexed result for this query, or try browse_web.' : undefined,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// translate

async function toolTranslate({ text, to, from }) {
  const src = (text || '').toString();
  if (!src.trim()) return { ok: false, error: 'missing text' };
  if (src.length > 5000) return { ok: false, error: 'text too long (max 5000 chars)' };
  const target = (to || '').toString().toLowerCase().slice(0, 5) || 'en';
  const source = (from || 'auto').toString().toLowerCase().slice(0, 5) || 'auto';

  // Prefer DeepL when a key is available — higher quality, esp. for EU langs.
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
// get_air_quality — OpenAQ v3 nearest-station lookup

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
    const url = `https://api.openaq.org/v2/latest?coordinates=${latitude},${longitude}&radius=25000&limit=5&order_by=distance`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `openaq ${r.status}` };
    const data = await r.json();
    const stations = Array.isArray(data.results) ? data.results.slice(0, 3) : [];
    return {
      ok: true,
      coords: { latitude, longitude },
      stations: stations.map((s) => ({
        location: s.location,
        city: s.city,
        country: s.country,
        measurements: (s.measurements || []).map((m) => ({
          parameter: m.parameter,
          value: m.value,
          unit: m.unit,
          lastUpdated: m.lastUpdated,
        })),
      })),
      source: 'openaq.org',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// get_news — GDELT Doc API v2 (free, no key)

async function toolGetNews({ topic, lang, limit }) {
  const q = (topic || '').toString().trim() || 'world';
  const n = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 10));
  const l = (lang || '').toString().toLowerCase().slice(0, 8);
  const langFilter = l ? ` sourcelang:${l}` : '';
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q + langFilter)}&mode=artlist&format=json&maxrecords=${n}&sort=datedesc`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `gdelt ${r.status}` };
    const data = await r.json();
    const arts = Array.isArray(data.articles) ? data.articles.slice(0, n) : [];
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
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
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
  // Accept either `base` or `from` — the catalog uses `from` but the
  // executor was historically `base`. Normalize here.
  const b = (base || from || 'USD').toString().toUpperCase().slice(0, 3);
  const t = (to || 'EUR').toString().toUpperCase().slice(0, 3);
  const a = Number.parseFloat(amount);
  try {
    const url = `https://api.exchangerate.host/convert?from=${b}&to=${t}${Number.isFinite(a) ? `&amount=${a}` : ''}`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return { ok: false, error: `exchangerate.host ${r.status}` };
    const data = await r.json();
    if (!data || data.success === false || typeof data.result !== 'number') {
      return { ok: false, error: 'conversion failed' };
    }
    return {
      ok: true,
      base: b,
      from: b,
      to: t,
      rate: data.info?.rate ?? null,
      amount: Number.isFinite(a) ? a : 1,
      result: data.result,
      date: data.date,
      source: 'exchangerate.host',
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
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

async function toolGeocode({ query }) {
  const q = (query || '').toString().trim();
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
  // Accept both `mode` and `profile` — catalog uses `profile`.
  const profile = { driving: 'driving', car: 'driving', walking: 'foot', walk: 'foot', cycling: 'bike', bike: 'bike' }[
    (mode || profileArg || 'driving').toString().toLowerCase()
  ] || 'driving';
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
    const r = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
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
  try {
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${latitude},${longitude}`;
    const r = await fetchWithTimeout(url);
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
// Groq-powered code helpers — ADDITIVE ONLY.
//
// These tools route to Groq (Qwen2.5-Coder-32B / Llama 3.3 70B) when
// `GROQ_API_KEY` is configured. They do NOT touch the chat flow: they
// are reachable exclusively via the KELION_TOOLS function-call path so
// the model can invoke them on demand. If the key is missing the helper
// returns `{ ok:false, unavailable:true, error }` and the model verbalizes
// a graceful "not configured" message. No fallback to Gemini/OpenAI — we
// want the user (or admin) to know the feature is opt-in.

const { groqChat } = require('./groq');

const SOLVE_PROBLEM_SYSTEM = [
  'You are an expert software engineer.',
  'Given a problem description, produce:',
  '  1. A brief plan (1-3 bullets).',
  '  2. A self-contained code solution in the requested language (or Python if unspecified).',
  '  3. A short correctness + complexity note.',
  'Keep the answer focused. No chit-chat.',
].join('\n');

const CODE_REVIEW_SYSTEM = [
  'You are a senior code reviewer.',
  'Review the supplied code. Output:',
  '  - Summary (1-2 sentences).',
  '  - Issues found (bug, perf, security, style) — each with file/line hint if visible.',
  '  - Concrete suggestions (code snippet when useful).',
  'Be specific. Skip praise.',
].join('\n');

const EXPLAIN_CODE_SYSTEM = [
  'You are a patient teacher.',
  'Explain the supplied code step-by-step in plain language suited to the requested audience.',
  'Call out non-obvious tricks, edge cases, and invariants. Do not rewrite the code.',
].join('\n');

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

async function loadDocBuffer({ url, base64 }, maxBytes, timeoutMs) {
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
  return { ok: false, error: 'provide either url or base64' };
}

async function toolReadPdf({ url, base64, max_chars, max_pages }) {
  const loaded = await loadDocBuffer({ url, base64 }, 25 * 1024 * 1024, 15000);
  if (!loaded.ok) return loaded;
  const cap = Math.max(500, Math.min(50000, Number.parseInt(max_chars, 10) || 8000));
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

async function toolReadDocx({ url, base64, max_chars }) {
  const loaded = await loadDocBuffer({ url, base64 }, 25 * 1024 * 1024, 15000);
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

async function toolOcrImage({ url, base64, lang, max_chars }) {
  const loaded = await loadDocBuffer({ url, base64 }, 20 * 1024 * 1024, 20000);
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
      documentType:   l1.slice(0, 2).replace(/</g, ''),
      issuingCountry: l1.slice(2, 5).replace(/</g, ''),
      surname:        cleanName(surnameRaw),
      givenNames:     cleanName(givenRaw),
      passportNumber: l2.slice(0, 9).replace(/</g, ''),
      nationality:    l2.slice(10, 13).replace(/</g, ''),
      dateOfBirth:    mrzDate(l2.slice(13, 19)),
      sex:            l2[20] === '<' ? null : l2[20],
      dateOfExpiry:   mrzDate(l2.slice(21, 27), true),
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

// Groq-powered coding tools (toolSolveProblem, toolCodeReview,
// toolExplainCode) and plan_task (toolPlanTask) REMOVED — Gemini Live
// handles coding questions and multi-step planning directly.

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
    return {
      ok: false,
      unavailable: true,
      error: 'Code sandbox not configured. Set E2B_API_KEY to enable run_code.',
    };
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
        result.city        = rg.city || rg.address?.city || rg.address?.town || rg.address?.village || null;
        result.country     = rg.country || rg.address?.country || null;
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
    const topups   = filtered.filter((r) => r.kind === 'topup');
    const consumed = filtered.filter((r) => Number(r.delta_minutes) < 0);
    const minutesConsumed = consumed.reduce((s, r) => s + Math.abs(Number(r.delta_minutes) || 0), 0);
    const minutesTopped   = topups.reduce((s, r) => s + Math.max(0, Number(r.delta_minutes) || 0), 0);
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
  const sid   = process.env.TWILIO_ACCOUNT_SID;
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
  const endRaw   = String(args?.end   || '').trim();
  const dtStart = icsFmtDate(startRaw);
  if (!dtStart) return { ok: false, error: 'invalid `start` (expected ISO 8601)' };
  let dtEnd = icsFmtDate(endRaw);
  if (!dtEnd) {
    const fallback = new Date(new Date(startRaw).valueOf() + 60 * 60 * 1000);
    dtEnd = icsFmtDate(fallback.toISOString());
  }
  if (!dtEnd) return { ok: false, error: 'invalid `end` (expected ISO 8601)' };
  const description = String(args?.description || '').slice(0, 2000);
  const location    = String(args?.location    || '').slice(0, 200);
  const attendees   = Array.isArray(args?.attendees) ? args.attendees.slice(0, 50) : [];
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
  if (location)    lines.push(`LOCATION:${icsEscape(location)}`);
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
  // Schema advertises `payload` as a JSON string (Gemini's OpenAI-compat
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
      zapierId:     parsed ? (parsed.id || parsed.request_id || null) : null,
      response:     parsed || (txt ? txt.slice(0, 500) : null),
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
      fullName:   j.full_name,
      description: j.description || null,
      homepage:   j.homepage || null,
      url:        j.html_url,
      stars:      j.stargazers_count,
      forks:      j.forks_count,
      watchers:   j.subscribers_count,
      openIssues: j.open_issues_count,
      language:   j.language || null,
      license:    j.license ? (j.license.spdx_id || j.license.name || null) : null,
      topics:     Array.isArray(j.topics) ? j.topics.slice(0, 20) : [],
      archived:   !!j.archived,
      fork:       !!j.fork,
      defaultBranch: j.default_branch,
      createdAt:  j.created_at,
      pushedAt:   j.pushed_at,
      updatedAt:  j.updated_at,
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
      homepage:    (pkg && pkg.homepage) || null,
      license:     (pkg && pkg.license) || j.license || null,
      repository:  pkg && pkg.repository ? (pkg.repository.url || pkg.repository) : null,
      keywords:    Array.isArray(pkg && pkg.keywords) ? pkg.keywords.slice(0, 20) : [],
      weeklyDownloads: weekly,
      modified:    j.time && j.time.modified ? j.time.modified : null,
      versions:    Array.isArray(Object.keys(j.versions || {}))
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
      homepage:   info.home_page || (info.project_urls && info.project_urls.Homepage) || null,
      author:     info.author || null,
      authorEmail: info.author_email || null,
      license:    info.license || null,
      requiresPython: info.requires_python || null,
      yanked:     !!(info.yanked),
      releases:   Array.isArray(Object.keys(j.releases || {}))
        ? Object.keys(j.releases || {}).slice(-10)
        : [],
      projectUrls: info.project_urls || null,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ──────────────────────────────────────────────────────────────────
// Dispatch

// F11 — OpenAI image generation. Returns a short-lived URL pointing at
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
    case 'calculate':         return toolCalculate(a);
    case 'unit_convert':      return toolUnitConvert(a);
    case 'get_moon_phase':    return toolGetMoonPhase(a);
    // ── radio / streaming ──
    case 'play_radio':        return toolPlayRadio(a);
    // ── weather / feeds ──
    case 'get_weather':       return toolGetWeather(a);
    case 'get_forecast':      return toolGetForecast(a);
    case 'get_air_quality':   return toolGetAirQuality(a);
    case 'get_news':          return toolGetNews(a);
    case 'get_crypto_price':  return toolGetCryptoPrice(a);
    case 'get_stock_price':   return toolGetStockPrice(a);
    case 'get_forex':         return toolGetForex(a);
    case 'currency_convert':  return toolCurrencyConvert(a);
    case 'get_earthquakes':   return toolGetEarthquakes(a);
    case 'get_sun_times':     return toolGetSunTimes(a);
    // ── geo ──
    case 'geocode':           return toolGeocode(a);
    case 'reverse_geocode':   return toolReverseGeocode(a);
    case 'get_route':         return toolGetRoute(a);
    case 'nearby_places':     return toolNearbyPlaces(a);
    case 'get_elevation':     return toolGetElevation(a);
    case 'get_timezone':      return toolGetTimezone(a);
    // ── web / search ──
    case 'web_search':        return toolWebSearch(a);
    case 'search_academic':   return toolSearchAcademic(a);
    case 'search_github':     return toolSearchGithub(a);
    case 'search_stackoverflow': return toolSearchStackoverflow(a);
    case 'fetch_url':         return toolFetchUrl(a);
    case 'rss_read':          return toolRssRead(a);
    // ── knowledge ──
    case 'wikipedia_search':  return toolWikipediaSearch(a);
    case 'dictionary':        return toolDictionary(a);
    // ── translation ──
    case 'translate':         return toolTranslate(a);
    // ── groq-powered coding + plan_task REMOVED — Gemini Live handles these ──
    // ── PR B — documents + OCR ──
    case 'read_pdf':          return toolReadPdf(a);
    case 'read_docx':         return toolReadDocx(a);
    case 'ocr_image':         return toolOcrImage(a);
    case 'ocr_passport':      return toolOcrPassport(a);
    // ── PR D — communications + automations + package info ──
    case 'send_email':            return toolSendEmail(a);
    case 'send_sms':              return toolSendSms(a);
    case 'create_calendar_ics':   return toolCreateCalendarIcs(a);
    case 'zapier_trigger':        return toolZapierTrigger(a);
    case 'github_repo_info':      return toolGithubRepoInfo(a);
    case 'npm_package_info':      return toolNpmPackageInfo(a);
    case 'pypi_package_info':     return toolPypiPackageInfo(a);
    // ── PR C — sandbox + regex + user-intern ──
    case 'run_regex':         return toolRunRegex(a);
    case 'run_code':          return toolRunCode(a);
    case 'get_my_location':   return toolGetMyLocation(a, ctx);
    case 'get_my_credits':    return toolGetMyCredits(a, ctx);
    case 'get_my_usage':      return toolGetMyUsage(a, ctx);
    case 'get_my_profile':    return toolGetMyProfile(a, ctx);
    // ── F11 — image generation (gpt-image-1) ──
    case 'generate_image':    return toolGenerateImage(a);
    // ── PR 8/N — Memory of Actions (read-only self-reflection) ──
    case 'get_action_history': return toolGetActionHistory(a, ctx);
    // ── Silent vision auto-learn — write durable observations ──
    case 'learn_from_observation': return toolLearnFromObservation(a, ctx);
    default:                  return null; // signal "not handled here"
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
async function toolLearnFromObservation(args, ctx) {
  const userId = ctx?.user?.id;
  if (!userId) {
    // Guests: silently succeed so the model doesn't loop / apologize.
    return { ok: true, signed_in: false, persisted: 0 };
  }
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
  'github_repo_info', 'npm_package_info', 'pypi_package_info',
  // F11 — image generation
  'generate_image',
  // PR 8/N — Memory of Actions. Read-only self-reflection: returns the
  // caller's own recent tool invocations (from action_history) so
  // Kelion can check "did I already email that?" before re-running.
  // Returns `{ ok:false, signed_in:false }` for guests.
  'get_action_history',
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
  toolNpmPackageInfo,
  toolPypiPackageInfo,
  // F11 — image generation
  toolGenerateImage,
  // PR 8/N — Memory of Actions
  toolGetActionHistory,
  // Silent auto-learn — observations from camera persisted to memory_items
  toolLearnFromObservation,
  // Faza A — global live radio search (radio-browser.info, ~50k stations)
  toolPlayRadio,
};
