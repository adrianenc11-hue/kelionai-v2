// ═══════════════════════════════════════════════════════════════
// KelionAI — Image Generation Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, imagineSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');

const router = express.Router();

const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many image requests. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });

// POST /api/imagine — Together FLUX image generation
router.post('/', imageLimiter, validate(imagineSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const { prompt } = req.body;
        if (!prompt || !process.env.TOGETHER_API_KEY) return res.status(503).json({ error: 'Image generation unavailable' });

        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'image', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Image limit reached. Upgrade to Pro for more images.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const r = await fetch('https://api.together.xyz/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.TOGETHER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'black-forest-labs/FLUX.1-schnell', prompt, width: 1024, height: 1024, steps: 4, n: 1, response_format: 'b64_json' })
        });
        if (!r.ok) return res.status(503).json({ error: 'Image generation failed' });
        const d = await r.json();
        const b64 = d.data?.[0]?.b64_json;
        if (!b64) return res.status(500).json({ error: 'No data' });
        incrementUsage(user?.id, 'image', supabaseAdmin).catch(() => { });
        res.json({ image: 'data:image/png;base64,' + b64, prompt, engine: 'FLUX' });
    } catch (e) { res.status(500).json({ error: 'Image error' }); }
});

module.exports = router;
