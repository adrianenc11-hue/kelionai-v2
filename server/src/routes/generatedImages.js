'use strict';

/**
 * F11 — serves PNGs produced by services/imageGen.js. The OpenAI Images
 * API returns a base64 blob; we decode it once, drop it into a 20-entry
 * in-process cache, and hand the client a short-lived URL
 * (`/api/generated-images/<id>`) it can render inside the avatar's
 * stage monitor.
 *
 * Cache is 10-min TTL, 20 max — if the user generates a 21st image the
 * oldest is evicted. If they reload the page later and the cache is
 * cold they'll get a 404; the client falls back to LoremFlickr (kind:
 * `image`, query) and the voice model already apologises on failure.
 */

const { Router } = require('express');
const { cacheGet } = require('../services/imageGen');

const router = Router();

router.get('/:id', (req, res) => {
  const id = String(req.params.id || '').slice(0, 64);
  if (!/^[a-f0-9]{10,64}$/i.test(id)) {
    return res.status(400).json({ error: 'bad id' });
  }
  const hit = cacheGet(id);
  if (!hit) {
    return res.status(404).json({ error: 'image expired or not found' });
  }
  // Cache at the edge for 5 min — shorter than our server TTL so
  // intermediate caches don't keep serving after we've evicted. No
  // Content-Disposition; the client embeds via <img>/<iframe>.
  res.setHeader('Content-Type', hit.contentType || 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(hit.pngBuffer);
});

module.exports = router;
