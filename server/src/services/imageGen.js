'use strict';

/**
 * F11 — OpenAI image generation (gpt-image-1) + short-lived URL serving.
 *
 * The voice model / text chat calls `generate_image(prompt, size?)`. The
 * OpenAI Images API returns a base64 PNG (`b64_json`). Piping the raw
 * base64 payload back through a tool result would:
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

// Accept sizes supported by gpt-image-1 (1024x1024, 1024x1536, 1536x1024,
// or the shortcut `auto`). Reject anything else so we don't surface a
// cryptic OpenAI 400 to the voice model — returning a clean error keeps
// Kelion honest in its reply.
const VALID_SIZES = new Set(['auto', '1024x1024', '1024x1536', '1536x1024']);

/**
 * Generate an image with OpenAI gpt-image-1. Returns `{ ok, id, url,
 * title, prompt, size }` on success, or `{ ok:false, error }` on any
 * failure mode (missing key, moderation block, timeout, upstream error).
 *
 * `publicBase` (optional) is the absolute origin (e.g. `https://host`) so
 * we can return a full URL instead of a path — useful when the caller
 * is a tool executor that hands the URL off to the client for embedding.
 * When omitted we return a relative URL (`/api/generated-images/<id>`)
 * which the same-origin client resolves against its own host.
 */
async function generateImage({ prompt, size, publicBase } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, unavailable: true, error: 'Image generation unavailable: OPENAI_API_KEY is not configured.' };
  }
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
  if (!cleanPrompt) {
    return { ok: false, error: 'Missing prompt for image generation.' };
  }
  const wantedSize = typeof size === 'string' && size ? size : 'auto';
  if (!VALID_SIZES.has(wantedSize)) {
    return { ok: false, error: `Invalid size "${wantedSize}". Use one of: ${[...VALID_SIZES].join(', ')}.` };
  }
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

  // 60 s timeout — gpt-image-1 averages 15-30 s for 1024×1024, pushing
  // higher for portrait/landscape at 1536. Anything past 60 s is almost
  // certainly a stuck connection.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: cleanPrompt,
        size: wantedSize,
        n: 1,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Image generation timed out after 60 s.' };
    }
    return { ok: false, error: `Image generation network error: ${err?.message || err}` };
  }
  clearTimeout(timeout);

  if (!r.ok) {
    let detail = '';
    try {
      const j = await r.json();
      detail = j?.error?.message || '';
    } catch { /* ignore */ }
    // Surface the moderation message specifically — the voice model can
    // then explain to the user what was rejected instead of hallucinating
    // that the image "just didn't load".
    if (r.status === 400 && /safety|policy|moderation/i.test(detail)) {
      return { ok: false, error: `Image rejected by safety system: ${detail}` };
    }
    return { ok: false, error: `Image upstream error ${r.status}: ${detail || 'unknown'}` };
  }

  let payload = null;
  try {
    payload = await r.json();
  } catch {
    return { ok: false, error: 'Image API returned non-JSON payload.' };
  }
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  const b64 = first?.b64_json;
  if (!b64) {
    return { ok: false, error: 'Image API returned no b64_json payload.' };
  }
  let pngBuffer;
  try {
    pngBuffer = Buffer.from(b64, 'base64');
  } catch {
    return { ok: false, error: 'Failed to decode b64 image payload.' };
  }

  const id = cachePut({ pngBuffer, contentType: 'image/png', prompt: cleanPrompt });
  const path = `/api/generated-images/${id}`;
  const url = publicBase ? new URL(path, publicBase).toString() : path;
  return {
    ok: true,
    id,
    url,
    title: cleanPrompt.slice(0, 80),
    prompt: cleanPrompt,
    size: wantedSize,
    model,
  };
}

module.exports = {
  generateImage,
  cacheGet,
  // Exposed for tests only — don't call from production code paths.
  _cache: cache,
};
