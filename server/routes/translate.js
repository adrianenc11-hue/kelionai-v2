// ═══════════════════════════════════════════════════════════
// KelionAI — Translate API (lightweight, no brain)
// Uses Gemini flash for fast translation
// ═══════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const logger = require('../logger');
const rateLimit = require('express-rate-limit');

const translateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 translations per minute
  message: { error: 'Too many translation requests' },
});

// POST /api/translate
// Body: { text, targetLang, sourceLang? }
// Returns: { translated, detectedLang, targetLang }
router.post('/translate', translateLimiter, async (req, res) => {
  try {
    const { text, targetLang = 'ro', sourceLang } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Get user for Supabase save
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    let user = null;
    try {
      user = await getUserFromToken(req);
    } catch (_e) {
      /* guest */
    }

    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(503).json({ error: 'Translation service unavailable' });
    }

    const MODELS = require('../config/models');
    const model = MODELS.GEMINI_CHAT;

    const prompt = sourceLang
      ? `Translate from ${sourceLang} to ${targetLang}. ONLY the translation, nothing else:\n${text}`
      : `Translate to ${targetLang}. Return ONLY "LANG:xx|translation text" where xx=detected ISO language code. Nothing else:\n${text}`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 256,
            temperature: 0.05,
          },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!r.ok) {
      const err = await r.text();
      logger.warn({ component: 'Translate', err }, 'Gemini translate failed');
      return res.status(502).json({ error: 'Translation failed' });
    }

    const data = await r.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!raw) {
      return res.status(502).json({ error: 'Empty translation result' });
    }

    // If we asked for auto-detect format: LANG:xx|text
    if (!sourceLang) {
      const pipeIdx = raw.indexOf('|');
      let detectedLang = 'unknown';
      let translated = raw;
      if (pipeIdx > 0 && pipeIdx < 8 && raw.startsWith('LANG:')) {
        detectedLang = raw.substring(5, pipeIdx).trim().toLowerCase();
        translated = raw.substring(pipeIdx + 1).trim();
      }

      // Save to Supabase
      if (supabaseAdmin && user?.id) {
        supabaseAdmin
          .from('brain_memory')
          .insert({
            user_id: user.id,
            memory_type: 'translation',
            content: `[${detectedLang}→${targetLang}] ${translated}`,
            context: { original: text, target: targetLang, detected: detectedLang },
            importance: 2,
          })
          .then(() => {})
          .catch(() => {});
      }

      return res.json({ translated, detectedLang, targetLang });
    }

    // Direct translation (sourceLang provided)
    // ── Save to Supabase (per user) ──
    if (supabaseAdmin && user?.id) {
      supabaseAdmin
        .from('brain_memory')
        .insert({
          user_id: user.id,
          memory_type: 'translation',
          content: `[${targetLang}] ${raw}`,
          context: { original: text, target: targetLang, translated: raw },
          importance: 2,
        })
        .then(() => {})
        .catch(() => {});
    }

    res.json({
      translated: raw,
      detectedLang: sourceLang || 'unknown',
      targetLang,
    });
  } catch (e) {
    logger.error({ component: 'Translate', err: e.message }, 'Translation error');
    res.status(500).json({ error: 'Translation error' });
  }
});

module.exports = router;
