// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — ADMIN ROUTER
// All routes protected by adminAuth middleware in index.js
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('./logger');
const router = express.Router();

const YEAR_IN_MS = 365 * 24 * 60 * 60 * 1000;

// ═══ HELPERS ═══
function safeNull(fn) {
    return fn().catch(() => null);
}

async function getStripeRevenue(stripe) {
    if (!stripe) return { mrr: null, arr: null, total: null };
    try {
        let mrr = 0;
        let hasMore = true;
        let startingAfter;
        while (hasMore) {
            const params = { status: 'active', limit: 100 };
            if (startingAfter) params.starting_after = startingAfter;
            const subs = await stripe.subscriptions.list(params);
            for (const sub of subs.data) {
                for (const item of sub.items.data) {
                    const price = item.price;
                    const amount = (price.unit_amount || 0) / 100;
                    if (price.recurring && price.recurring.interval === 'year') {
                        mrr += amount / 12;
                    } else {
                        mrr += amount;
                    }
                }
            }
            hasMore = subs.has_more;
            if (hasMore && subs.data.length > 0) {
                startingAfter = subs.data[subs.data.length - 1].id;
            }
        }
        mrr = Math.round(mrr * 100) / 100;
        return { mrr, arr: Math.round(mrr * 12 * 100) / 100, total: null };
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'Stripe revenue fetch failed');
        return { mrr: null, arr: null, total: null };
    }
}

// ═══ DASHBOARD ═══
router.get('/dashboard', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    const brain = req.app.locals.brain;

    const today = new Date().toISOString().split('T')[0];

    // Users stats
    const usersTotal = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true });
        return count;
    });
    const usersToday = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', today);
        return count;
    });
    const usersPro = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('plan', 'pro').eq('status', 'active');
        return count;
    });
    const usersPremium = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('plan', 'premium').eq('status', 'active');
        return count;
    });

    // Usage today
    const chatToday = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('usage').select('*', { count: 'exact', head: true }).eq('type', 'chat').eq('date', today);
        return count;
    });
    const ttsToday = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('usage').select('*', { count: 'exact', head: true }).eq('type', 'tts').eq('date', today);
        return count;
    });
    const visionToday = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('usage').select('*', { count: 'exact', head: true }).eq('type', 'vision').eq('date', today);
        return count;
    });

    // Subscriptions
    const subsActive = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
        return count;
    });
    const subsCancelled = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'cancelled');
        return count;
    });

    // Referrals
    const referralCodes = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('referral_codes').select('*', { count: 'exact', head: true });
        return count;
    });
    const referralRedeemed = await safeNull(async () => {
        if (!supabaseAdmin) return null;
        const { count } = await supabaseAdmin.from('referral_codes').select('*', { count: 'exact', head: true }).gt('redeemed_count', 0);
        return count;
    });

    // Revenue
    const revenue = await getStripeRevenue(req.app.locals.stripe);

    // System
    const brainDiag = brain ? brain.getDiagnostics() : null;
    const apiKeys = [
        'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
        'SUPABASE_URL', 'STRIPE_SECRET_KEY', 'TAVILY_API_KEY',
        'SERPER_API_KEY', 'PERPLEXITY_API_KEY'
    ].filter(k => !!process.env[k]).length;

    res.json({
        users: {
            total: usersTotal,
            today: usersToday,
            pro: usersPro,
            premium: usersPremium,
            free: (usersTotal !== null && usersPro !== null && usersPremium !== null)
                ? Math.max(0, usersTotal - usersPro - usersPremium)
                : null,
            guest: null
        },
        revenue,
        usage: { chat_today: chatToday, tts_today: ttsToday, vision_today: visionToday },
        subscriptions: { active: subsActive, cancelled: subsCancelled },
        referrals: { total_codes: referralCodes, redeemed: referralRedeemed },
        system: {
            uptime: process.uptime(),
            brain_status: brainDiag ? brainDiag.status : null,
            api_keys_configured: apiKeys
        },
        generated_at: new Date().toISOString()
    });
});

// ═══ USERS ═══
router.get('/users', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    if (!supabaseAdmin) return res.json({ users: null });
    try {
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, email, full_name, created_at')
            .order('created_at', { ascending: false })
            .limit(200);
        const { data: subs } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id, plan, status')
            .eq('status', 'active');
        const subMap = {};
        if (subs) subs.forEach(s => { subMap[s.user_id] = s.plan; });
        const users = (profiles || []).map(p => ({
            id: p.id,
            email: p.email,
            name: p.full_name,
            plan: subMap[p.id] || 'free',
            joined: p.created_at
        }));
        res.json({ users });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'users fetch failed');
        res.json({ users: null });
    }
});

// ═══ REVENUE ═══
router.get('/revenue', async (req, res) => {
    const revenue = await getStripeRevenue(req.app.locals.stripe);
    res.json(revenue);
});

// ═══ USAGE ═══
router.get('/usage', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    if (!supabaseAdmin) return res.json({ usage: null });
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabaseAdmin
            .from('usage')
            .select('type, count')
            .eq('date', today);
        const byType = {};
        if (data) data.forEach(r => { byType[r.type] = (byType[r.type] || 0) + (r.count || 1); });
        res.json({ date: today, usage: byType });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'usage fetch failed');
        res.json({ usage: null });
    }
});

// ═══ SUBSCRIPTIONS ═══
router.get('/subscriptions', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    if (!supabaseAdmin) return res.json({ subscriptions: null });
    try {
        const { data } = await supabaseAdmin
            .from('subscriptions')
            .select('status, plan');
        const stats = { active: 0, cancelled: 0, trial: 0 };
        const byPlan = {};
        if (data) {
            data.forEach(s => {
                if (s.status === 'active') stats.active++;
                else if (s.status === 'cancelled') stats.cancelled++;
                else if (s.status === 'trialing') stats.trial++;
                if (s.plan) byPlan[s.plan] = (byPlan[s.plan] || 0) + 1;
            });
        }
        res.json({ ...stats, by_plan: byPlan });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'subscriptions fetch failed');
        res.json({ subscriptions: null });
    }
});

// ═══ REFERRALS ═══
router.get('/referrals', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    if (!supabaseAdmin) return res.json({ referrals: null });
    try {
        const { data, count } = await supabaseAdmin
            .from('referral_codes')
            .select('code, redeemed_count, created_at', { count: 'exact' });
        const redeemed = (data || []).filter(r => r.redeemed_count > 0).length;
        const totalRedemptions = (data || []).reduce((sum, r) => sum + (r.redeemed_count || 0), 0);
        res.json({ total_codes: count || 0, codes_redeemed: redeemed, total_redemptions: totalRedemptions });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'referrals fetch failed');
        res.json({ referrals: null });
    }
});

// ═══ BOT STATUS ═══
router.get('/bots/status', async (req, res) => {
    const fbConfigured = !!(process.env.FB_PAGE_ACCESS_TOKEN && process.env.FB_VERIFY_TOKEN);
    res.json({
        messenger: {
            configured: fbConfigured,
            status: fbConfigured ? 'online' : 'not_configured'
        }
    });
});

// ═══ OVERRIDE USER PLAN ═══
router.post('/user/:id/plan', async (req, res) => {
    const supabaseAdmin = req.app.locals.supabaseAdmin;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });
    const { plan } = req.body;
    const validPlans = ['free', 'pro', 'premium'];
    if (!plan || !validPlans.includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan. Must be: free, pro, premium' });
    }
    try {
        const userId = req.params.id;
        if (plan === 'free') {
            await supabaseAdmin.from('subscriptions').update({ status: 'cancelled' }).eq('user_id', userId).eq('status', 'active');
        } else {
            const { error } = await supabaseAdmin.from('subscriptions').upsert({
                user_id: userId,
                plan,
                status: 'active',
                current_period_end: new Date(Date.now() + YEAR_IN_MS).toISOString()
            }, { onConflict: 'user_id' });
            if (error) throw error;
        }
        logger.info({ component: 'Admin' }, `Plan override: user ${userId} → ${plan}`);
        res.json({ success: true, user_id: userId, plan });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'plan override failed');
        res.status(500).json({ error: 'Failed to update plan' });
    }
});

module.exports = router;
