// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — ADMIN PANEL ROUTER
// INVISIBLE to users — only super_admin role can access
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { supabase } = require('./supabase');
const router = express.Router();

let stripe;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
} catch (e) {
    logger.warn({ component: 'Admin', err: e.message }, 'Stripe not available for admin');
}

// ═══ RATE LIMITER ═══
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many admin requests' },
    standardHeaders: true,
    legacyHeaders: false
});

router.use(adminLimiter);

// ═══ SUPER ADMIN AUTH MIDDLEWARE ═══
async function superAdminAuth(req, res, next) {
    // Option 1: x-admin-secret header (CLI access)
    const secret = req.headers['x-admin-secret'];
    if (secret && secret === process.env.ADMIN_SECRET_KEY) {
        return next();
    }

    // Option 2: Supabase JWT — check super_admin role
    const { supabaseAdmin } = req.app.locals;
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabase) return res.status(401).json({ error: 'Auth unavailable' });

    try {
        const token = h.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

        // Check app_metadata.role === 'super_admin'
        if (user.app_metadata && user.app_metadata.role === 'super_admin') {
            req.adminUser = user;
            return next();
        }

        // Fallback: check user_preferences table
        if (supabaseAdmin) {
            const { data: pref } = await supabaseAdmin
                .from('user_preferences')
                .select('value')
                .eq('user_id', user.id)
                .eq('key', 'role')
                .single();
            if (pref && pref.value === 'super_admin') {
                req.adminUser = user;
                return next();
            }
        }

        return res.status(403).json({ error: 'Forbidden — super_admin only' });
    } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'superAdminAuth error');
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

router.use(superAdminAuth);

// ═══ HELPER: safe query (returns null on error) ═══
async function safeQuery(fn) {
    try { return await fn(); } catch (e) { return null; }
}

// ═══ GET /api/admin/dashboard — main stats ═══
router.get('/dashboard', async (req, res) => {
    const { supabaseAdmin } = req.app.locals;
    const today = new Date().toISOString().split('T')[0];

    // ── Users ──
    let users = 'N/A';
    if (supabaseAdmin) {
        const [totalRes, todayRes, active7Res, freeRes, proRes, premRes] = await Promise.all([
            safeQuery(() => supabaseAdmin.from('users').select('id', { count: 'exact', head: true })),
            safeQuery(() => supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', today)),
            safeQuery(() => supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('last_seen', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())),
            safeQuery(() => supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('plan', 'free').eq('status', 'active')),
            safeQuery(() => supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('plan', 'pro').eq('status', 'active')),
            safeQuery(() => supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('plan', 'premium').eq('status', 'active'))
        ]);
        users = {
            total: totalRes?.count ?? 'N/A',
            today: todayRes?.count ?? 'N/A',
            active_7days: active7Res?.count ?? 'N/A',
            free: freeRes?.count ?? 'N/A',
            pro: proRes?.count ?? 'N/A',
            premium: premRes?.count ?? 'N/A'
        };
    }

    // ── Revenue (Stripe) ──
    let revenue = 'N/A';
    if (stripe) {
        try {
            const startOfDay = Math.floor(new Date(today).getTime() / 1000);
            const [chargesRes, subsRes] = await Promise.all([
                stripe.charges.list({ limit: 100, created: { gte: startOfDay } }),
                stripe.subscriptions.list({ status: 'active', limit: 100 })
            ]);
            const todayRev = chargesRes.data
                .filter(c => c.paid && !c.refunded)
                .reduce((sum, c) => sum + c.amount, 0) / 100;
            const mrr = subsRes.data
                .reduce((sum, s) => {
                    const item = s.items && s.items.data && s.items.data[0];
                    if (!item) return sum;
                    const amount = item.price ? item.price.unit_amount || 0 : 0;
                    const interval = item.price ? item.price.recurring && item.price.recurring.interval : null;
                    if (interval === 'year') return sum + amount / 12;
                    return sum + amount;
                }, 0) / 100;
            revenue = { mrr: Number(mrr.toFixed(2)), today: Number(todayRev.toFixed(2)), active_subscriptions: subsRes.data.length, currency: 'EUR' };
        } catch (e) {
            logger.warn({ component: 'Admin', err: e.message }, 'Stripe revenue error');
            revenue = 'N/A';
        }
    }

    // ── Usage today ──
    let usage = 'N/A';
    if (supabaseAdmin) {
        const types = ['chat', 'tts', 'vision', 'search'];
        const results = await Promise.all(
            types.map(t => safeQuery(() =>
                supabaseAdmin.from('usage').select('count').eq('type', t).eq('date', today)
            ))
        );
        usage = {};
        types.forEach((t, i) => {
            const rows = results[i];
            if (!rows || !rows.data) { usage[`${t}_today`] = 'N/A'; return; }
            usage[`${t}_today`] = rows.data.reduce((s, r) => s + (r.count || 0), 0);
        });
    }

    // ── Conversations ──
    let conversations = 'N/A';
    if (supabaseAdmin) {
        const [totalRes, todayRes] = await Promise.all([
            safeQuery(() => supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true })),
            safeQuery(() => supabaseAdmin.from('conversations').select('id', { count: 'exact', head: true }).gte('created_at', today))
        ]);
        conversations = {
            total: totalRes?.count ?? 'N/A',
            today: todayRes?.count ?? 'N/A'
        };
    }

    // ── Bots ──
    let bots = 'N/A';
    if (supabaseAdmin) {
        const botsData = await safeQuery(() =>
            supabaseAdmin.from('bot_settings').select('name, enabled, last_run')
        );
        if (botsData && botsData.data) {
            bots = {};
            botsData.data.forEach(b => { bots[b.name] = { enabled: b.enabled, lastRun: b.last_run }; });
            ['news', 'trading', 'sports'].forEach(n => {
                if (!bots[n]) bots[n] = { enabled: false, lastRun: null };
            });
        }
    }

    // ── System ──
    const mem = process.memoryUsage();
    const system = {
        uptime: Math.round(process.uptime()),
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
            heap: Math.round(mem.heapUsed / 1024 / 1024) + 'MB'
        },
        nodeVersion: process.version
    };

    res.json({
        users,
        revenue,
        usage,
        conversations,
        bots,
        system,
        timestamp: new Date().toISOString()
    });
});

// ═══ GET /api/admin/users — user list (paginated) ═══
router.get('/users', async (req, res) => {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ users: 'N/A' });

    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;

        const [usersRes, countRes] = await Promise.all([
            supabaseAdmin
                .from('users')
                .select('id, email, created_at, last_seen')
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1),
            supabaseAdmin
                .from('users')
                .select('id', { count: 'exact', head: true })
        ]);

        if (usersRes.error) return res.json({ users: 'N/A' });

        const userIds = (usersRes.data || []).map(u => u.id);
        let subs = [];
        if (userIds.length) {
            const subsRes = await supabaseAdmin
                .from('subscriptions')
                .select('user_id, plan, status')
                .in('user_id', userIds)
                .eq('status', 'active');
            subs = subsRes.data || [];
        }
        const subMap = {};
        subs.forEach(s => { subMap[s.user_id] = s.plan; });

        const users = (usersRes.data || []).map(u => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_seen: u.last_seen,
            plan: subMap[u.id] || 'free'
        }));

        res.json({ users, total: countRes.count ?? 'N/A', page, limit });
    } catch (e) {
        logger.error({ component: 'Admin', err: e.message }, 'Users list error');
        res.json({ users: 'N/A' });
    }
});

// ═══ GET /api/admin/revenue — Stripe revenue live ═══
router.get('/revenue', async (req, res) => {
    if (!stripe) return res.json({ revenue: 'N/A' });

    try {
        const today = new Date().toISOString().split('T')[0];
        const startOfDay = Math.floor(new Date(today).getTime() / 1000);
        const startOfMonth = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);

        const [todayCharges, monthCharges, activeSubs] = await Promise.all([
            stripe.charges.list({ limit: 100, created: { gte: startOfDay } }),
            stripe.charges.list({ limit: 100, created: { gte: startOfMonth } }),
            stripe.subscriptions.list({ status: 'active', limit: 100 })
        ]);

        const todayRev = todayCharges.data
            .filter(c => c.paid && !c.refunded)
            .reduce((sum, c) => sum + c.amount, 0) / 100;
        const monthRev = monthCharges.data
            .filter(c => c.paid && !c.refunded)
            .reduce((sum, c) => sum + c.amount, 0) / 100;
        const mrr = activeSubs.data.reduce((sum, s) => {
            const item = s.items && s.items.data && s.items.data[0];
            if (!item) return sum;
            const amount = item.price ? item.price.unit_amount || 0 : 0;
            const interval = item.price ? item.price.recurring && item.price.recurring.interval : null;
            if (interval === 'year') return sum + amount / 12;
            return sum + amount;
        }, 0) / 100;

        res.json({
            revenue: {
                mrr: Number(mrr.toFixed(2)),
                today: Number(todayRev.toFixed(2)),
                month: Number(monthRev.toFixed(2)),
                active_subscriptions: activeSubs.data.length,
                currency: 'EUR'
            }
        });
    } catch (e) {
        logger.error({ component: 'Admin', err: e.message }, 'Revenue error');
        res.json({ revenue: 'N/A' });
    }
});

// ═══ GET /api/admin/usage — daily usage stats ═══
router.get('/usage', async (req, res) => {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ usage: 'N/A' });

    try {
        const days = Math.min(30, parseInt(req.query.days) || 7);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const { data, error } = await supabaseAdmin
            .from('usage')
            .select('type, date, count')
            .gte('date', since)
            .order('date', { ascending: false });

        if (error) return res.json({ usage: 'N/A' });

        // Aggregate by date + type
        const agg = {};
        (data || []).forEach(row => {
            if (!agg[row.date]) agg[row.date] = {};
            agg[row.date][row.type] = (agg[row.date][row.type] || 0) + row.count;
        });

        res.json({ usage: agg, days });
    } catch (e) {
        logger.error({ component: 'Admin', err: e.message }, 'Usage stats error');
        res.json({ usage: 'N/A' });
    }
});

// ═══ GET /api/admin/bots/status — bot status ═══
router.get('/bots/status', async (req, res) => {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ bots: 'N/A' });

    try {
        const { data, error } = await supabaseAdmin
            .from('bot_settings')
            .select('name, enabled, last_run, config');
        if (error) return res.json({ bots: 'N/A' });

        const bots = {};
        (data || []).forEach(b => { bots[b.name] = { enabled: b.enabled, lastRun: b.last_run, config: b.config }; });
        ['news', 'trading', 'sports'].forEach(n => {
            if (!bots[n]) bots[n] = { enabled: false, lastRun: null };
        });

        res.json({ bots });
    } catch (e) {
        logger.error({ component: 'Admin', err: e.message }, 'Bots status error');
        res.json({ bots: 'N/A' });
    }
});

// ═══ POST /api/admin/bots/toggle — enable/disable a bot ═══
router.post('/bots/toggle', async (req, res) => {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { name, enabled } = req.body;
    if (!name || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'name and enabled (boolean) required' });
    }
    const allowed = ['news', 'trading', 'sports'];
    if (!allowed.includes(name)) {
        return res.status(400).json({ error: `Bot must be one of: ${allowed.join(', ')}` });
    }

    try {
        await supabaseAdmin.from('bot_settings').upsert(
            { name, enabled, updated_at: new Date().toISOString() },
            { onConflict: 'name' }
        );
        logger.info({ component: 'Admin', bot: name, enabled }, `Bot ${name} → ${enabled}`);
        res.json({ success: true, name, enabled });
    } catch (e) {
        logger.error({ component: 'Admin', err: e.message }, 'Bot toggle error');
        res.status(500).json({ error: 'Toggle failed' });
    }
});

// ═══ GET /api/admin/health — all services health check ═══
router.get('/health', async (req, res) => {
    const services = {};

    // Check each API key / service
    services.claude = !!process.env.ANTHROPIC_API_KEY;
    services.openai = !!process.env.OPENAI_API_KEY;
    services.elevenlabs = !!process.env.ELEVENLABS_API_KEY;
    services.tavily = !!process.env.TAVILY_API_KEY;
    services.stripe = !!process.env.STRIPE_SECRET_KEY;
    services.supabase = !!process.env.SUPABASE_URL;
    services.sentry = !!process.env.SENTRY_DSN;

    // Live DB ping
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
        try {
            const start = Date.now();
            await supabaseAdmin.from('users').select('id', { count: 'exact', head: true });
            services.database = { status: 'ok', latency: Date.now() - start };
        } catch (e) {
            services.database = { status: 'error', error: e.message };
        }
    } else {
        services.database = { status: 'unconfigured' };
    }

    // Live Stripe ping
    if (stripe) {
        try {
            const start = Date.now();
            await stripe.balance.retrieve();
            services.stripe_live = { status: 'ok', latency: Date.now() - start };
        } catch (e) {
            services.stripe_live = { status: 'error', error: e.message };
        }
    } else {
        services.stripe_live = { status: 'unconfigured' };
    }

    res.json({ services, timestamp: new Date().toISOString() });
});

module.exports = router;
