// ═══════════════════════════════════════════════════════════════
// KelionAI — Client Config API
// Servește toate URL-urile la frontend — zero hardcode în client
// Toate valorile vin din process.env
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const { APP } = require('../config/app');
const router = express.Router();

// ── URL-uri client — 100% din .env ──
function buildClientUrls() {
  return {
    // ── Media / Streaming ──
    YOUTUBE:       process.env.YOUTUBE_ENDPOINT          || '',
    NETFLIX:       process.env.NETFLIX_URL               || '',
    SPOTIFY:       process.env.SPOTIFY_ENDPOINT          || '',
    TWITCH:        process.env.TWITCH_URL                || '',
    HBO:           process.env.HBO_URL                   || '',
    DISNEY:        process.env.DISNEY_URL                || '',
    PRIMEVIDEO:    process.env.PRIMEVIDEO_URL            || '',
    AMAZON:        process.env.AMAZON_URL                || '',

    // ── Social (opțional — goale dacă nu sunt configurate) ──
    FACEBOOK:      process.env.FACEBOOK_URL              || '',
    INSTAGRAM:     process.env.INSTAGRAM_URL             || '',
    TWITTER:       process.env.TWITTER_URL               || '',
    TIKTOK:        process.env.TIKTOK_URL                || '',
    GOOGLE:        process.env.GOOGLE_URL                || '',
    GMAIL:         process.env.GMAIL_URL                 || '',

    // ── Radio (opțional) ──
    RADIOZU:       process.env.RADIO_RADIOZU_URL         || '',
    KISSFM:        process.env.RADIO_KISSFM_URL          || '',
    DIGIFM:        process.env.RADIO_DIGIFM_URL          || '',
    MAGICFM:       process.env.RADIO_MAGICFM_URL         || '',
    ROCKFM:        process.env.RADIO_ROCKFM_URL          || '',
    PROFM:         process.env.RADIO_PROFM_URL           || '',
    EUROPAFM:      process.env.RADIO_EUROPAFM_URL        || '',
    NATIONALFM:    process.env.RADIO_NATIONALFM_URL      || '',

    // ── Hărți ──
    GOOGLE_MAPS:   process.env.GOOGLE_MAPS_FULL_ENDPOINT || 'https://www.google.com/maps',
    OSM_EMBED:     process.env.OSM_EXPORT_ENDPOINT       || 'https://www.openstreetmap.org/export/embed.html',

    // ── Media Embeds ──
    YOUTUBE_EMBED: process.env.YOUTUBE_EMBED_URL         || 'https://www.youtube-nocookie.com/embed',
    SPOTIFY_EMBED: process.env.SPOTIFY_EMBED_URL         || 'https://open.spotify.com/embed',

    // ── Servicii externe ──
    DICEBEAR:      process.env.DICEBEAR_URL              || 'https://api.dicebear.com/7.x',

    // ── Fonturi Google ──
    GOOGLE_FONTS_CSS:           process.env.GOOGLE_FONTS_CSS           || 'https://fonts.googleapis.com',
    GOOGLE_FONTS_STATIC:        process.env.GOOGLE_FONTS_STATIC        || 'https://fonts.gstatic.com',
    GOOGLE_FONTS_INTER:         process.env.GOOGLE_FONTS_INTER         || 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    GOOGLE_FONTS_INTER_LIGHT:   process.env.GOOGLE_FONTS_INTER_LIGHT   || 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap',
    GOOGLE_FONTS_INTER_BASIC:   process.env.GOOGLE_FONTS_INTER_BASIC   || 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
    GOOGLE_FONTS_INTER_JETBRAINS: process.env.GOOGLE_FONTS_INTER_JETBRAINS || 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',

    // ── CDN Libraries ──
    CDN_TENSORFLOW:  process.env.CDN_TENSORFLOW  || 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    CDN_COCOSSD:     process.env.CDN_COCOSSD     || 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
    CDN_SENTRY_JS:   process.env.CDN_SENTRY_JS   || '',
    CDN_LOGROCKET:   process.env.CDN_LOGROCKET   || '',
    CDN_LEAFLET_CSS: process.env.CDN_LEAFLET_CSS || 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css',
    CDN_LEAFLET_JS:  process.env.CDN_LEAFLET_JS  || 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js',
    CARTO_TILES:     process.env.CARTO_TILES     || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    CARTO_TILE_LAYER: process.env.CARTO_TILE_LAYER || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    OLLAMA_SITE:     process.env.OLLAMA_SITE     || '',
    SVG_NAMESPACE:   process.env.SVG_NAMESPACE   || 'http://www.w3.org/2000/svg',

    // ── App info (pentru frontend) ──
    APP_NAME:      APP.NAME,
    APP_VERSION:   APP.VERSION,
    APP_URL:       APP.URL,
    STUDIO_NAME:   APP.STUDIO_NAME,
    FOUNDER_NAME:  APP.FOUNDER_NAME,
  };
}

router.get('/urls', (req, res) => {
  res.json(buildClientUrls());
});

module.exports = router;