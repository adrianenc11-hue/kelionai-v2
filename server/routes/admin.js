// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const logger = require('../logger');
const { version } = require('../../package.json');

const router = express.Router();

// ═══ ADMIN AUTH MIDDLEWARE ═══
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    const expected = process.env.ADMIN_SECRET_KEY;
    if (!secret || !expected) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const secretBuf = Buffer.from(secret);
        const expectedBuf = Buffer.from(expected);
        if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// GET /api/brain
router.get('/brain', adminAuth, (req, res) => {
    const { brain } = req.app.locals;
    res.json(brain.getDiagnostics());
});

// POST /api/brain/reset
router.post('/brain/reset', adminAuth, (req, res) => {
    const { brain } = req.app.locals;
    const { tool } = req.body;
    if (tool) brain.resetTool(tool);
    else brain.resetAll();
    res.json({ success: true, diagnostics: brain.getDiagnostics() });
});

// GET /api/admin/health-check
router.get('/admin/health-check', adminAuth, async (req, res) => {
    try {
        const { brain, supabase, supabaseAdmin } = req.app.locals;
        logger.info({ component: 'Admin' }, '🏥 Health check performed');
        const recommendations = [];

        const upSec = process.uptime();
        const d0 = Math.floor(upSec / 86400), h0 = Math.floor((upSec % 86400) / 3600);
        const m0 = Math.floor((upSec % 3600) / 60), s0 = Math.floor(upSec % 60);
        const mem = process.memoryUsage();
        const server = {
            version,
            uptime: `${d0}d ${h0}h ${m0}m ${s0}s`,
            uptimeSeconds: Math.round(upSec),
            nodeVersion: process.version,
            memory: {
                rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
            },
            timestamp: new Date().toISOString()
        };

        const services = {
            ai_claude: { label: 'AI Claude', active: !!process.env.ANTHROPIC_API_KEY },
            ai_gpt4o: { label: 'AI GPT-4o', active: !!process.env.OPENAI_API_KEY },
            ai_deepseek: { label: 'AI DeepSeek', active: !!process.env.DEEPSEEK_API_KEY },
            tts_elevenlabs: { label: 'TTS ElevenLabs', active: !!process.env.ELEVENLABS_API_KEY },
            stt_groq: { label: 'STT Groq', active: !!process.env.GROQ_API_KEY },
            search_perplexity: { label: 'Search Perplexity', active: !!process.env.PERPLEXITY_API_KEY },
            search_tavily: { label: 'Search Tavily', active: !!process.env.TAVILY_API_KEY },
            search_serper: { label: 'Search Serper', active: !!process.env.SERPER_API_KEY },
            images_together: { label: 'Image Together', active: !!process.env.TOGETHER_API_KEY },
            payments_stripe: { label: 'Payments Stripe', active: !!process.env.STRIPE_SECRET_KEY },
            stripe_webhook: { label: 'Stripe Webhook', active: !!process.env.STRIPE_WEBHOOK_SECRET },
            monitoring_sentry: { label: 'Error Monitoring Sentry', active: !!process.env.SENTRY_DSN }
        };
        if (!process.env.STRIPE_WEBHOOK_SECRET) recommendations.push('STRIPE_WEBHOOK_SECRET is not configured — webhooks will not be validated');
        if (!process.env.SENTRY_DSN) recommendations.push('SENTRY_DSN is missing — errors are not monitored');
        if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
            recommendations.push('No AI key configured — chat will not work');
        }

        const database = { connected: false, tables: {} };
        if (supabaseAdmin) {
            const tables = ['conversations', 'messages', 'user_preferences', 'subscriptions', 'usage'];
            await Promise.all(tables.map(async (tbl) => {
                try {
                    const { count, error } = await supabaseAdmin.from(tbl).select('id', { count: 'exact', head: true });
                    database.tables[tbl] = error ? { ok: false, error: error.message } : { ok: true, count };
                } catch (e) { database.tables[tbl] = { ok: false, error: e.message }; }
            }));
            database.connected = Object.values(database.tables).some(t => t.ok);
        } else {
            database.error = 'supabaseAdmin client not initialized';
            recommendations.push('Supabase is not configured — database is unavailable');
        }

        const brainDiag = brain.getDiagnostics();
        const degradedTools = brainDiag.degradedTools || Object.entries(brainDiag.toolErrors || {}).filter(([, v]) => v >= 5).map(([k]) => k);
        const brainResult = {
            status: brainDiag.status,
            conversations: brainDiag.conversations,
            toolStats: brainDiag.toolStats,
            toolErrors: brainDiag.toolErrors,
            degradedTools,
            recentErrors: brainDiag.recentErrors,
            avgLatency: brainDiag.avgLatency,
            journal: (brainDiag.journal || []).slice(-5)
        };
        if (brainDiag.status === 'degraded') recommendations.push(`Brain engine is degraded — ${degradedTools.join(', ') || 'some tools'} have errors`);

        const auth = { supabaseInitialized: !!supabase, supabaseAdminInitialized: !!supabaseAdmin, authAvailable: !!supabase };
        if (!supabase) recommendations.push('Supabase anon client is not initialized — authentication is unavailable');

        const paymentsCheck = {
            stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
            webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
            priceProConfigured: !!process.env.STRIPE_PRICE_PRO,
            pricePremiumConfigured: !!process.env.STRIPE_PRICE_PREMIUM,
            activeSubscribers: null
        };
        if (supabaseAdmin && process.env.STRIPE_SECRET_KEY) {
            try {
                const { count } = await supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
                paymentsCheck.activeSubscribers = count;
            } catch (e) { paymentsCheck.subscribersError = e.message; }
        }

        const rateLimits = {
            chat: { max: 20, windowMs: 60000, windowLabel: '1min' },
            auth: { max: 10, windowMs: 900000, windowLabel: '15min' },
            search: { max: 15, windowMs: 60000, windowLabel: '1min' },
            image: { max: 5, windowMs: 60000, windowLabel: '1min' },
            memory: { max: 30, windowMs: 60000, windowLabel: '1min' },
            weather: { max: 10, windowMs: 60000, windowLabel: '1min' },
            api: { max: 20, windowMs: 900000, windowLabel: '15min' },
            global: { max: 200, windowMs: 900000, windowLabel: '15min' }
        };

        const security = {
            cspEnabled: true,
            httpsRedirect: process.env.NODE_ENV === 'production',
            corsConfigured: true,
            adminSecretConfigured: !!process.env.ADMIN_SECRET_KEY
        };
        if (!process.env.ADMIN_SECRET_KEY) recommendations.push('ADMIN_SECRET_KEY is not configured — admin dashboard is not protected');

        const errors = { recentCount: brainDiag.recentErrors || 0, degradedTools };

        let score = 0;
        const activeCount = Object.values(services).filter(s => s.active).length;
        score += Math.floor(activeCount / Object.keys(services).length * 20);
        if (database.connected) score += 20;
        if (brainDiag.status === 'healthy') score += 15;
        if ((brainDiag.recentErrors || 0) === 0) score += 10;
        if (security.cspEnabled && security.adminSecretConfigured) score += 15;
        if (services.ai_claude.active || services.ai_gpt4o.active || services.ai_deepseek.active) score += 20;

        const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

        res.json({ timestamp: new Date().toISOString(), score, grade, server, services, database, brain: brainResult, auth, payments: paymentsCheck, rateLimits, security, errors, recommendations });
    } catch (e) { res.status(500).json({ error: 'Health check error' }); }
});

// GET /api/payments/admin/stats — revenue, active subscribers, churn
router.get('/payments/admin/stats', adminAuth, async (req, res) => {
    try {
        const { supabaseAdmin } = req.app.locals;
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const { PLAN_LIMITS } = require('../payments');
        const PLAN_PRICES = { pro: 9.99, enterprise: 29.99, premium: 19.99 };

        const { data: subs } = await supabaseAdmin
            .from('subscriptions')
            .select('plan, status, current_period_end, updated_at')
            .order('status');

        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const activeSubs = (subs || []).filter(s =>
            s.status === 'active' && s.current_period_end && new Date(s.current_period_end) > now
        );
        const pastDueSubs = (subs || []).filter(s => s.status === 'past_due');
        const recentCancelledSubs = (subs || []).filter(s =>
            s.status === 'cancelled' && s.updated_at && new Date(s.updated_at) >= thirtyDaysAgo
        );

        const planCounts = {};
        activeSubs.forEach(s => { planCounts[s.plan] = (planCounts[s.plan] || 0) + 1; });

        const mrr = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);

        const totalForChurn = activeSubs.length + recentCancelledSubs.length;
        const churnRate = totalForChurn > 0
            ? ((recentCancelledSubs.length / totalForChurn) * 100).toFixed(1)
            : '0.0';

        const today = now.toISOString().split('T')[0];
        const { data: usageData } = await supabaseAdmin.from('usage').select('type, count').eq('date', today);

        const usageTotals = {};
        (usageData || []).forEach(u => { usageTotals[u.type] = (usageTotals[u.type] || 0) + u.count; });

        res.json({
            activeSubscribers: activeSubs.length,
            cancelledLast30Days: recentCancelledSubs.length,
            pastDueSubscribers: pastDueSubs.length,
            planCounts,
            mrr: Math.round(mrr * 100) / 100,
            churnRate: parseFloat(churnRate),
            usageToday: usageTotals,
            timestamp: now.toISOString()
        });
    } catch (e) { res.status(500).json({ error: 'Stats error' }); }
});

module.exports = { router, adminAuth };
