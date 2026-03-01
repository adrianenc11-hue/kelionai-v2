// ═══════════════════════════════════════════════════════════════
// KelionAI — Health Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();

// GET /api/health
router.get('/', (req, res) => {
    const { brain, supabase, supabaseAdmin } = req.app.locals;
    const diag = brain ? brain.getDiagnostics() : { status: 'no-brain', conversations: 0 };
    res.json({
        status: 'ok', version: '2.4.0', timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        brain: diag.status,
        conversations: diag.conversations,
        services: {
            ai_claude: !!process.env.ANTHROPIC_API_KEY, ai_gpt4o: !!process.env.OPENAI_API_KEY,
            ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
            tts: !!process.env.ELEVENLABS_API_KEY, stt_groq: !!process.env.GROQ_API_KEY,
            stt_openai: !!process.env.OPENAI_API_KEY, vision: !!process.env.ANTHROPIC_API_KEY,
            search_perplexity: !!process.env.PERPLEXITY_API_KEY, search_tavily: !!process.env.TAVILY_API_KEY,
            search_serper: !!process.env.SERPER_API_KEY, search_ddg: true, weather: true,
            images: !!process.env.TOGETHER_API_KEY, maps: !!process.env.GOOGLE_MAPS_KEY,
            payments: !!process.env.STRIPE_SECRET_KEY, stripe_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
            session_secret: !!process.env.SESSION_SECRET, referral_secret: !!process.env.REFERRAL_SECRET,
            sentry: !!process.env.SENTRY_DSN,
            auth: !!supabase, database: !!supabaseAdmin,
            whatsapp: !!(process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN),
            whatsapp_phone: !!(process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID),
            telegram: !!process.env.TELEGRAM_BOT_TOKEN,
            messenger: !!process.env.MESSENGER_PAGE_TOKEN,
            facebook_page: !!process.env.FACEBOOK_PAGE_TOKEN,
            instagram: !!process.env.INSTAGRAM_TOKEN,
            trading_binance: !!process.env.BINANCE_API_KEY,
            trading_mode: process.env.BINANCE_API_KEY ? (process.env.BINANCE_TESTNET === 'true' ? 'TESTNET' : 'LIVE') : 'PAPER',
        }
    });
});

module.exports = router;

