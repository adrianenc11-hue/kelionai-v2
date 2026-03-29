// ═══════════════════════════════════════════════════════════════
// KelionAI — Vision Routes (Brain-integrated)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');

const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../rate-limit-key');
const logger = require('../logger');
const { validate, visionSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');
const { MODELS, API_ENDPOINTS } = require('../config/models');

const router = express.Router();

// ═══ TIMEOUT HELPER — prevents hanging on slow/dead APIs ═══
function withTimeout(promise, ms = 10000, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many API requests. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// POST /api/vision — GPT-5.4 Vision (primary) + Gemini (fallback) — BRAIN-POWERED
router.post('/', apiLimiter, validate(visionSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { image, avatar = 'kelion', language = 'ro' } = req.body;
    if (!image) return res.status(503).json({ error: 'Vision unavailable' });

    const user = await getUserFromToken(req);
    const _fingerprint = req.body.fingerprint || req.ip || null;

    // ── Usage quota check ──
    const usageCheck = await checkUsage(user?.id, 'vision', supabaseAdmin, _fingerprint);
    if (usageCheck && !usageCheck.allowed) {
      return res.status(429).json({ error: 'Daily vision limit reached', upgrade: true });
    }

    // Brain-aware prompt — accessibility-first pentru persoane cu deficiențe vizuale
    const LANGS = { ro: 'română', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
    const avatarName = avatar === 'kira' ? 'Kira' : 'Kelion';
    const prompt = `You are ${avatarName}, an AI accessibility assistant. You are the EYES of a visually impaired person.

PRIORITY ORDER (always follow this):
1. HAZARDS FIRST: stairs, curbs, traffic, obstacles, wet floor, broken objects → "ATENȚIE: [hazard specific]"
2. PEOPLE: count, position, gender, age approx, clothing color, expression, direction of movement
3. TEXT: read ALL visible text verbatim (signs, labels, screens, documents)
4. OBJECTS: name, color (exact: "roșu închis" not "roșu"), distance ("la 2 metri", "chiar lângă tine")
5. SPACE: "în dreapta ta", "în față", "în spate", "sus", "jos" — always relative to user

RULES:
- MAX 3 sentences normally, 1 sentence for hazards
- Colors: EXACT (roșu Bordeaux, albastru regal, verde neon) — NOT vague
- Distance: always spatial ("la jumătate de metru", "la 3 pași")
- If path is clear: "Calea este liberă, poți merge înainte"
- If nothing notable: "Nu văd obstacole. Mediu liniștit."
- End ALWAYS with: [EMOTION:concerned/happy/curious/surprised] based on what you see

Answer in ${LANGS[language] || 'English'}.`;

    let description = null;
    let engine = null;

    // PRIMARY: GPT-5.4 Vision
    if (process.env.OPENAI_API_KEY) {
      try {
        const r = await withTimeout(
          fetch(API_ENDPOINTS.OPENAI + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
            },
            body: JSON.stringify({
              model: MODELS.OPENAI_VISION,
              max_tokens: 512,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'high' },
                    },
                    { type: 'text', text: prompt },
                  ],
                },
              ],
            }),
          }),
          25000,
          'vision:GPT-4.1'
        );
        const d = await r.json();
        description = d.choices?.[0]?.message?.content;
        if (description) engine = 'GPT-4.1';
      } catch (e) {
        logger.warn({ component: 'Vision', err: e.message }, 'GPT-5.4 Vision failed');
      }
    }

    // FALLBACK: Gemini Vision
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!description && geminiKey) {
      try {
        const geminiModel = MODELS.GEMINI_VISION;
        const r = await withTimeout(
          fetch(`${API_ENDPOINTS.GEMINI}/models/${geminiModel}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: prompt }],
                },
              ],
              generationConfig: { maxOutputTokens: 1024 },
            }),
          }),
          20000,
          'vision:Gemini'
        );
        const d = await r.json();
        description = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (description) engine = 'Gemini';
      } catch (e) {
        logger.warn({ component: 'Vision', err: e.message }, 'Gemini Vision fallback failed');
      }
    }

    // ═══ BRAIN INTEGRATION — save visual memory + parse emotion ═══
    let emotion = 'neutral';
    if (description) {
      // Parse emotion tag from vision response
      const emotionMatch = description.match(/\[EMOTION:(\w+)\]/i);
      if (emotionMatch) {
        emotion = emotionMatch[1].toLowerCase();
        description = description.replace(/\[EMOTION:\w+\]/gi, '').trim();
      }

      // Save to brain memory so brain remembers what it saw
      if (brain && user?.id) {
        brain
          .saveMemory(user.id, 'visual', 'Am văzut: ' + description.substring(0, 500), {
            avatar,
            language,
            engine,
            emotion,
          })
          .catch((e) => logger.warn({ component: 'Vision', err: e.message }, 'brain.saveMemory failed'));
      }

      // ═══ Direct Supabase save — vision analysis ═══
      if (supabaseAdmin && user?.id) {
        supabaseAdmin
          .from('brain_memory')
          .insert({
            user_id: user.id,
            memory_type: 'visual_analysis',
            content: `[VISION] ${description.substring(0, 500)}`,
            importance: 6,
            metadata: { category: 'vision_result', avatar, language, engine, emotion },
          })
          .then(() => {})
          .catch((err) => logger.error({ component: 'Vision', err: err.message }, 'Memory insert failed'));
      }
    }

    logger.info({ component: 'Vision', engine, emotion, userId: user?.id }, 'Vision analysis complete');

    // ── Increment usage after successful vision ──
    incrementUsage(user?.id, 'vision', supabaseAdmin, _fingerprint).catch(() => {});

    res.json({
      description: description || 'Could not analyze.',
      avatar,
      engine: engine || 'none',
      emotion,
    });
  } catch (e) {
    logger.error({ component: 'Vision', err: e.message }, 'Vision error');
    res.status(500).json({ error: 'Vision error' });
  }
});

module.exports = router;
