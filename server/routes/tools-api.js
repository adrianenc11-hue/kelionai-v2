// ═══════════════════════════════════════════════════════════════
// KelionAI — Search + Weather + Contact + Scan API Routes
// Endpoints called from frontend tools.js, contact-form.js,
// and product-scanner.js
// ZERO hardcode — totul din config/app.js → .env
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { API_ENDPOINTS } = require('../config/models');
const { APP } = require('../config/app');
const { rateLimitKey } = require('../rate-limit-key');

const router = express.Router();

// ─── Rate limiters ───
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many search requests. Wait a minute.' },
  keyGenerator: rateLimitKey,
});
const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many weather requests. Wait a minute.' },
  keyGenerator: rateLimitKey,
});
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many contact requests. Try again later.' },
  keyGenerator: rateLimitKey,
});
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many scan requests. Wait a moment.' },
  keyGenerator: rateLimitKey,
});
const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many image generation requests. Wait a minute.' },
  keyGenerator: rateLimitKey,
});
const weatherGeoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many geo requests.' },
  keyGenerator: rateLimitKey,
});

// ═══════════════════════════════════════════════════════════════
// POST /api/search — Tavily web search
// ═══════════════════════════════════════════════════════════════
router.post('/search', searchLimiter, async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ answer: '', results: [] });

    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query required (min 2 chars)' });
    }

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      return res.json({ answer: 'Search unavailable — Tavily not configured', results: [] });
    }

    const tavilyBase = API_ENDPOINTS.TAVILY || 'https://api.tavily.com';
    const r = await fetch(`${tavilyBase}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify({
        query: query.trim().substring(0, 400),
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!r.ok) {
      logger.warn({ component: 'Search', status: r.status }, 'Tavily search failed');
      return res.json({ answer: '', results: [] });
    }

    const data = await r.json();
    res.json({
      answer:  data.answer  || '',
      results: data.results || [],
    });
  } catch (e) {
    logger.error({ component: 'Search', err: e.message }, 'Search error');
    res.json({ answer: '', results: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/weather — Open-Meteo weather
// ═══════════════════════════════════════════════════════════════
router.post('/weather', weatherLimiter, async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Auth required' });

    const { city, lat, lon } = req.body;
    if (!city && (lat === undefined || lon === undefined)) {
      return res.status(400).json({ error: 'city or lat/lon required' });
    }

    const geoBase     = API_ENDPOINTS.OPEN_METEO_GEO || 'https://geocoding-api.open-meteo.com/v1';
    const weatherBase = API_ENDPOINTS.OPEN_METEO      || 'https://api.open-meteo.com/v1';

    let latitude  = lat;
    let longitude = lon;
    let cityName  = city;

    // Geocoding dacă avem city în loc de coordonate
    if (city && (lat === undefined || lon === undefined)) {
      const geoR = await fetch(
        `${geoBase}/search?name=${encodeURIComponent(city.substring(0, 100))}&count=1&language=en&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!geoR.ok) return res.status(503).json({ error: 'Geocoding unavailable' });
      const geoData = await geoR.json();
      const loc = geoData.results?.[0];
      if (!loc) return res.status(404).json({ error: `City not found: ${city}` });
      latitude  = loc.latitude;
      longitude = loc.longitude;
      cityName  = loc.name;
    }

    const weatherR = await fetch(
      `${weatherBase}/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature` +
      `&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&forecast_days=3&timezone=auto`,
      { signal: AbortSignal.timeout(8000) }
    );

    if (!weatherR.ok) return res.status(503).json({ error: 'Weather service unavailable' });
    const weatherData = await weatherR.json();

    res.json({ city: cityName, ...weatherData });
  } catch (e) {
    logger.error({ component: 'Weather', err: e.message }, 'Weather error');
    res.status(500).json({ error: 'Weather unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/imagine — Image generation (FLUX / DALL-E)
// ═══════════════════════════════════════════════════════════════
router.post('/imagine', imageLimiter, async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Auth required' });

    const { prompt, style } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Prompt required (min 3 chars)' });
    }

    const cleanPrompt = prompt.trim().substring(0, 500);
    const togetherKey = process.env.TOGETHER_API_KEY;
    const openaiKey   = process.env.OPENAI_API_KEY;
    const { MODELS } = require('../config/models');

    // ── Together AI / FLUX (primary — rapid și ieftin) ──
    if (togetherKey) {
      try {
        const togetherBase = API_ENDPOINTS.TOGETHER || 'https://api.together.xyz/v1';
        const r = await fetch(`${togetherBase}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${togetherKey}`,
          },
          body: JSON.stringify({
            model:  MODELS.FLUX,
            prompt: cleanPrompt,
            n:      1,
            width:  1024,
            height: 1024,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (r.ok) {
          const data = await r.json();
          const url = data.data?.[0]?.url || data.data?.[0]?.b64_json;
          if (url) {
            logger.info({ component: 'Imagine', provider: 'Together/FLUX' }, 'Image generated');
            return res.json({ image: url, provider: 'flux' });
          }
        }
      } catch (e) {
        logger.warn({ component: 'Imagine', err: e.message }, 'FLUX failed, trying DALL-E');
      }
    }

    // ── DALL-E fallback ──
    if (openaiKey) {
      const openaiBase = API_ENDPOINTS.OPENAI || 'https://api.openai.com/v1';
      const r = await fetch(`${openaiBase}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model:  MODELS.DALL_E,
          prompt: cleanPrompt,
          n:      1,
          size:   '1024x1024',
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const data = await r.json();
        const url = data.data?.[0]?.url;
        if (url) {
          logger.info({ component: 'Imagine', provider: 'DALL-E' }, 'Image generated');
          return res.json({ image: url, provider: 'dalle' });
        }
      }
    }

    res.status(503).json({ error: 'Image generation unavailable — no API key configured' });
  } catch (e) {
    logger.error({ component: 'Imagine', err: e.message }, 'Image generation error');
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/contact — Contact form
// ═══════════════════════════════════════════════════════════════
router.post('/contact', contactLimiter, async (req, res) => {
  try {
    const { name, email, message, subject } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email and message are required' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const cleanName    = String(name).substring(0, 100).replace(/[<>]/g, '');
    const cleanEmail   = String(email).substring(0, 200);
    const cleanMessage = String(message).substring(0, 2000).replace(/[<>]/g, '');
    const cleanSubject = String(subject || 'Contact Form').substring(0, 200).replace(/[<>]/g, '');

    // Salvăm în Supabase dacă e disponibil
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin.from('contact_messages').insert({
        name:    cleanName,
        email:   cleanEmail,
        subject: cleanSubject,
        message: cleanMessage,
        ip:      req.ip,
        created_at: new Date().toISOString(),
      }).catch(() => {}); // best-effort
    }

    logger.info({ component: 'Contact', email: cleanEmail, subject: cleanSubject }, 'Contact form submitted');
    res.json({ success: true, message: 'Message received. We will respond shortly.' });
  } catch (e) {
    logger.error({ component: 'Contact', err: e.message }, 'Contact form error');
    res.status(500).json({ error: 'Failed to submit contact form' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/scan — Product scanner (OpenFoodFacts + Vision fallback)
// ═══════════════════════════════════════════════════════════════
router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Auth required' });

    const { barcode, image, language = 'ro' } = req.body;

    // ── Barcode lookup via OpenFoodFacts ──
    if (barcode && typeof barcode === 'string' && /^\d{8,14}$/.test(barcode.trim())) {
      const offBase = API_ENDPOINTS.OPENFOODFACTS || 'https://world.openfoodfacts.org';
      try {
        const r = await fetch(
          `${offBase}/api/v0/product/${barcode.trim()}.json`,
          {
            headers: { 'User-Agent': APP.USER_AGENT },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (r.ok) {
          const data = await r.json();
          if (data.status === 1 && data.product) {
            const p = data.product;
            return res.json({
              found:       true,
              source:      'openfoodfacts',
              name:        p.product_name || p.product_name_ro || p.product_name_en || 'Unknown',
              brand:       p.brands       || '',
              ingredients: p.ingredients_text_ro || p.ingredients_text || '',
              allergens:   p.allergens_tags || [],
              nutriscore:  p.nutriscore_grade || null,
              image_url:   p.image_url || null,
              barcode,
            });
          }
        }
      } catch (e) {
        logger.warn({ component: 'Scan', err: e.message }, 'OpenFoodFacts lookup failed');
      }
    }

    // ── Vision fallback — dacă avem imagine ──
    if (image) {
      const openaiKey = process.env.OPENAI_API_KEY;
      const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
      const { MODELS } = require('../config/models');

      const langPrompt = language === 'ro'
        ? 'Identifică produsul din imagine. Răspunde în română cu: Nume produs, Brand, Ingrediente principale, Alergeni, Informații nutriționale. Fii concis.'
        : 'Identify the product in the image. Respond with: Product name, Brand, Main ingredients, Allergens, Nutritional info. Be concise.';

      if (openaiKey) {
        try {
          const openaiBase = API_ENDPOINTS.OPENAI || 'https://api.openai.com/v1';
          const r = await fetch(`${openaiBase}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: MODELS.OPENAI_VISION,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: langPrompt },
                  { type: 'image_url', image_url: { url: image, detail: 'low' } },
                ],
              }],
              max_tokens: 300,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (r.ok) {
            const data = await r.json();
            const text = data.choices?.[0]?.message?.content;
            if (text) return res.json({ found: true, source: 'vision', description: text });
          }
        } catch (e) {
          logger.warn({ component: 'Scan', err: e.message }, 'Vision scan failed');
        }
      }

      if (geminiKey) {
        try {
          const geminiBase = API_ENDPOINTS.GEMINI || 'https://generativelanguage.googleapis.com/v1beta';
          const base64 = image.replace(/^data:image\/\w+;base64,/, '');
          const r = await fetch(
            `${geminiBase}/models/${MODELS.GEMINI_VISION}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: langPrompt },
                    { inline_data: { mime_type: 'image/jpeg', data: base64 } },
                  ],
                }],
                generationConfig: { maxOutputTokens: 300 },
              }),
              signal: AbortSignal.timeout(15000),
            }
          );
          if (r.ok) {
            const data = await r.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return res.json({ found: true, source: 'vision_gemini', description: text });
          }
        } catch (e) {
          logger.warn({ component: 'Scan', err: e.message }, 'Gemini vision scan failed');
        }
      }
    }

    res.json({ found: false, message: 'Product not found' });
  } catch (e) {
    logger.error({ component: 'Scan', err: e.message }, 'Scan error');
    res.status(500).json({ error: 'Scan failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/geo — Geocoding (Open-Meteo)
// ═══════════════════════════════════════════════════════════════
router.get('/geo', weatherGeoLimiter, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return res.status(400).json({ error: 'Query required' });
    }
    const geoBase = API_ENDPOINTS.OPEN_METEO_GEO || 'https://geocoding-api.open-meteo.com/v1';
    const r = await fetch(
      `${geoBase}/search?name=${encodeURIComponent(q.trim().substring(0, 100))}&count=5&language=en&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return res.status(503).json({ error: 'Geocoding unavailable' });
    const data = await r.json();
    res.json({ results: data.results || [] });
  } catch (e) {
    logger.error({ component: 'Geo', err: e.message }, 'Geo error');
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

module.exports = router;