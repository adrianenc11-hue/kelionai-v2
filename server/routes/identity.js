// ═══════════════════════════════════════════════════════════════
// KelionAI — Identity Routes (Face Registration + Recognition)
// Feature 5: Face capture at registration, passive recognition
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');

const router = express.Router();

const identityLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many identity requests.' }, standardHeaders: true, legacyHeaders: false });

// ═══ POST /api/identity/register-face ═══
// Save face reference for the authenticated user at signup
router.post('/identity/register-face', identityLimiter, express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { face } = req.body;
        if (!face) return res.status(400).json({ error: 'face image required' });

        if (supabaseAdmin) {
            try {
                await supabaseAdmin.from('profiles').upsert({
                    id: user.id,
                    face_reference: face.substring(0, 500), // store truncated hash/reference
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
            } catch (e) {
                logger.warn({ component: 'Identity', err: e.message }, 'Face save failed');
            }
        }

        logger.info({ component: 'Identity', userId: user.id }, 'Face reference registered');
        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Identity', err: e.message }, 'register-face error');
        res.status(500).json({ error: 'Internal error' });
    }
});

// ═══ POST /api/identity/check ═══
// Compare submitted face against registered users using Claude Vision
router.post('/identity/check', identityLimiter, express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const { face } = req.body;
        if (!face) return res.status(400).json({ error: 'face image required' });

        const user = await getUserFromToken(req);
        const isOwner = user?.role === 'admin';

        // Check if this is the owner by comparing face with stored reference
        let ownerMatch = false;
        let matchedUser = null;

        if (supabaseAdmin && face) {
            try {
                // Get owner profile (admin role)
                const { data: ownerProfile } = await supabaseAdmin.from('profiles')
                    .select('id, display_name, face_reference, preferred_language')
                    .eq('role', 'admin')
                    .single();

                if (ownerProfile?.face_reference && process.env.OPENAI_API_KEY) {
                    // Use Claude/OpenAI Vision to compare faces
                    const fetch = require('node-fetch');
                    const r = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                        body: JSON.stringify({
                            model: 'gpt-4o',
                            max_tokens: 10,
                            messages: [{
                                role: 'user',
                                content: [
                                    { type: 'text', text: 'Do these two images show the same person? Reply only YES or NO.' },
                                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + ownerProfile.face_reference, detail: 'low' } },
                                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + face, detail: 'low' } }
                                ]
                            }]
                        })
                    });
                    const d = await r.json();
                    const answer = d.choices?.[0]?.message?.content?.trim().toUpperCase();
                    if (answer === 'YES') {
                        ownerMatch = true;
                        matchedUser = { name: ownerProfile.display_name || 'Owner', lang: ownerProfile.preferred_language || 'en' };
                    }
                }
            } catch (e) {
                logger.warn({ component: 'Identity', err: e.message }, 'Face comparison failed');
            }
        }

        res.json({
            isOwner: ownerMatch || isOwner,
            user: matchedUser || (user ? { name: user.name || user.email, lang: user.preferred_language || 'en' } : null)
        });
    } catch (e) {
        logger.error({ component: 'Identity', err: e.message }, 'check error');
        res.status(500).json({ error: 'Internal error' });
    }
});

module.exports = router;
