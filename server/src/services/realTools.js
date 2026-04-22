'use strict';

/**
 * Real, deterministic tool executors for Kelion.
 *
 * All four tools call free public APIs (no key required) so they work
 * out of the box on prod without adding any paid dependency:
 *
 *   - calculate     → mathjs (local, offline)
 *   - get_weather   → Open-Meteo (free, no key)
 *   - web_search    → DuckDuckGo Instant Answer (free, no key)
 *   - translate     → LibreTranslate (public instance, no key)
 *
 * Each executor returns a small JSON-safe object that the LLM can read
 * back on the second streaming pass. Every error path is caught and
 * returned as `{ ok: false, error }` — the chat stream never throws.
 *
 * If paid keys are later added (SERPER_API_KEY, DEEPL_API_KEY, etc.)
 * the respective executor prefers them automatically — no code change
 * needed elsewhere.
 */

const { evaluate } = require('mathjs');

// Small helper so every fetch has a hard deadline — voice/text chat
// stream expects the tool result within a couple of seconds, not 30s.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────
// calculate

function toolCalculate({ expression }) {
  const expr = (expression || '').toString().trim();
  if (!expr) return { ok: false, error: 'missing expression' };
  if (expr.length > 500) return { ok: false, error: 'expression too long (max 500 chars)' };
  try {
    const value = evaluate(expr);
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

async function toolGetWeather({ city, lat, lon, days }) {
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
    const n = Math.max(1, Math.min(7, Number.parseInt(days, 10) || 1));
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
// web_search

async function toolWebSearch({ query, limit }) {
  const q = (query || '').toString().trim();
  if (!q) return { ok: false, error: 'missing query' };
  const n = Math.max(1, Math.min(10, Number.parseInt(limit, 10) || 5));

  // Serper.dev preferred if key present — richer results with URLs. Falls
  // back to DuckDuckGo Instant Answer (free, no key) otherwise.
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
    re: /\b(translate|in translation|how do you say|translate (?:this|that|to|into)|traduc(?:e|eți)|cum se spune pe|tradu|traducere)\b/i,
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
// Dispatch

async function executeRealTool(name, args) {
  switch (name) {
    case 'calculate':   return toolCalculate(args || {});
    case 'get_weather': return toolGetWeather(args || {});
    case 'web_search':  return toolWebSearch(args || {});
    case 'translate':   return toolTranslate(args || {});
    default:            return null; // signal "not handled here"
  }
}

module.exports = {
  executeRealTool,
  pickForcedTool,
  toolCalculate,
  toolGetWeather,
  toolWebSearch,
  toolTranslate,
};
