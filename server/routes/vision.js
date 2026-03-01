// ═══════════════════════════════════════════════════════════════
// KelionAI — Vision Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, visionSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');

const router = express.Router();

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many API requests. Please wait 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

// POST /api/vision — Claude Vision analysis
router.post('/', apiLimiter, validate(visionSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const { image, avatar = 'kelion', language = 'ro' } = req.body;
        if (!image || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Vision unavailable' });

        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'vision', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Vision limit reached. Upgrade to Pro for more.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const LANGS = { ro: 'română', en: 'English' };
        const prompt = `You are the EYES of a person. Describe EXACTLY what you see with MAXIMUM PRECISION.
People: age, gender, clothing (exact colors), expression, gestures, what they hold.
Objects: each object, color, size, position.
Text: read ANY visible text.
Hazards: obstacles, steps → "CAUTION:"
Answer in ${LANGS[language] || 'English'}, concise but detailed.`;
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514', max_tokens: 1024,
                messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: prompt }] }]
            })
        });
        const d = await r.json();
        incrementUsage(user?.id, 'vision', supabaseAdmin).catch(() => { });
        res.json({ description: d.content?.[0]?.text || 'Could not analyze.', avatar, engine: 'Claude' });
    } catch (e) { res.status(500).json({ error: 'Vision error' }); }
});

module.exports = router;
