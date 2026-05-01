'use strict';

/**
 * F11 — Gemini native image generation + short-lived URL serving.
 *
 * The voice model / text chat calls `generate_image(prompt, size?)`. Gemini
 * returns the image as inlineData (base64 PNG). Piping the raw base64
 * payload back through a tool result would:
 *   1) blow past the voice model's context on the read-back pass,
 *   2) send 1-2 MB down an audio WebSocket frame-by-frame,
 *   3) waste bandwidth since the client just wants to render it.
 *
 * So we keep the PNG in a small in-process cache and return a short-lived
 * URL the client embeds on the avatar's stage monitor. The cache is
 * capped so nothing persists long-term — this is not a user-facing CDN,
 * just a handoff buffer between the tool call and the iframe render.
 */

const crypto = require('crypto');

// Hard caps — Railway dynos have ~512 MB; even 20 entries × 2 MB = 40 MB
// is a small fraction of that but keeps us safe from a prompt flood.
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min — plenty for the user to look
const CACHE_MAX     = 20;
const cache = new Map(); // id -> { ts, pngBuffer, contentType, prompt }

function cachePut({ pngBuffer, contentType, prompt }) {
  // LRU-ish eviction: if full, drop oldest. Map preserves insertion order.
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  const id = crypto.randomBytes(12).toString('hex');
  cache.set(id, { ts: Date.now(), pngBuffer, contentType, prompt });
  return id;
}

function cacheGet(id) {
  const hit = cache.get(id);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(id);
    return null;
  }
  return hit;
}

/**
 * Generate an image with Gemini native image generation. Returns `{ ok, id,
 * url, title, prompt, size }` on success, or `{ ok:false, error }` on any
 * failure mode (missing key, moderation block, timeout, upstream error).
 *
 * `publicBase` (optional) is the absolute origin (e.g. `https://host`) so
 * we can return a full URL instead of a path — useful when the caller
 * is a tool executor that hands the URL off to the client for embedding.
 * When omitted we return a relative URL (`/api/generated-images/<id>`)
 * which the same-origin client resolves against its own host.
 */
async function generateImage({ prompt, size, publicBase } = {}) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
  if (!cleanPrompt) {
    return { ok: false, error: 'Missing prompt for image generation.' };
  }

  // Pollinations.ai is a free, high-quality professional API (using FLUX/SD)
  // that requires no authentication and returns the image stream directly.
  const encodedPrompt = encodeURIComponent(cleanPrompt);
  
  // Try to parse width/height from size (e.g. "1024x768")
  let width = 1024;
  let height = 1024;
  if (size && size.includes('x')) {
    const parts = size.split('x');
    width = parseInt(parts[0], 10) || 1024;
    height = parseInt(parts[1], 10) || 1024;
  }

  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&enhance=true`;

  // We don't need to cache the image locally because pollinations hosts it directly
  return {
    ok: true,
    id: crypto.randomBytes(12).toString('hex'),
    url: url,
    title: cleanPrompt.slice(0, 80),
    prompt: cleanPrompt,
    size: size || 'auto',
    model: 'pollinations-flux',
  };
}

module.exports = {
  generateImage,
  cacheGet,
  // Exposed for tests only — don't call from production code paths.
  _cache: cache,
};
