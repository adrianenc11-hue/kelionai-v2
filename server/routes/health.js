// ═══════════════════════════════════════════════════════════════
// KelionAI — Health Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();

// GET /api/health
router.get('/', (req, res) => {
    const { brain, supabase, supabaseAdmin } = req.app.locals;
    const diag = brain.getDiagnostics();
    res.json({
        status: 'ok', version: '2.3.0', timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        brain: diag.status,
        conversations: diag.conversations,
        services: {
            ai_claude: !!process.env.ANTHROPIC_API_KEY, ai_gpt4o: !!process.env.OPENAI_API_KEY,
            ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
            tts: !!process.env.ELEVENLABS_API_KEY, stt: true, vision: !!process.env.ANTHROPIC_API_KEY,
            search_perplexity: !!process.env.PERPLEXITY_API_KEY, search_tavily: !!process.env.TAVILY_API_KEY,
            search_serper: !!process.env.SERPER_API_KEY, search_ddg: true, weather: true,
            images: !!process.env.TOGETHER_API_KEY,
            payments: !!process.env.STRIPE_SECRET_KEY,
            auth: !!supabase, database: !!supabaseAdmin
        }
    });
});

module.exports = router;
