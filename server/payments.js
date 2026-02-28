// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — PAYMENTS (Stripe Subscriptions)
// Plans: Free €0, Pro €9.99/mo, Premium €19.99/mo
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const logger = require('./logger');
const router = express.Router();

let stripe;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
} catch (e) {
    logger.warn({ component: 'Payments', err: e.message }, 'Stripe not available');
}

// ═══ PLAN LIMITS ═══
const PLAN_LIMITS = {
    guest:      { chat: 5,   search: 3,  image: 1,  vision: 2,  tts: 5,   name: 'Guest' },
    free:       { chat: 10,  search: 5,  image: 2,  vision: 5,  tts: 10,  name: 'Free' },
    pro:        { chat: 100, search: 50, image: 20, vision: 50, tts: 100, name: 'Pro' },
    enterprise: { chat: -1,  search: -1, image: -1, vision: -1, tts: -1,  name: 'Enterprise' }, // -1 = unlimited
    premium:    { chat: -1,  search: -1, image: -1, vision: -1, tts: -1,  name: 'Premium' } // legacy alias
};

// ═══ CHECK USER PLAN & USAGE ═══
async function getUserPlan(userId, supabaseAdmin) {
    if (!userId || !supabaseAdmin) return { plan: 'guest', limits: PLAN_LIMITS.guest };
    
    try {
        const { data: sub } = await supabaseAdmin
            .from('subscriptions')
            .select('plan, status, stripe_subscription_id, current_period_end')
            .eq('user_id', userId)
            .eq('status', 'active')
            .single();
        
        if (sub && sub.plan && new Date(sub.current_period_end) > new Date()) {
            return { plan: sub.plan, limits: PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free, subscription: sub };
        }
        
        return { plan: 'free', limits: PLAN_LIMITS.free };
    } catch (e) {
        return { plan: 'free', limits: PLAN_LIMITS.free };
    }
}

// ═══ CHECK USAGE LIMIT ═══
async function checkUsage(userId, type, supabaseAdmin) {
    if (!userId) return { allowed: true, plan: 'free', remaining: 5 };
    const { plan, limits } = await getUserPlan(userId, supabaseAdmin);
    if (limits[type] === -1) return { allowed: true, plan, remaining: -1 }; // unlimited
    
    if (!supabaseAdmin) return { allowed: true, plan, remaining: limits[type] };
    
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabaseAdmin
            .from('usage')
            .select('count')
            .eq('user_id', userId || 'guest')
            .eq('type', type)
            .eq('date', today)
            .single();
        
        const used = data?.count || 0;
        const remaining = limits[type] - used;
        
        return { allowed: remaining > 0, plan, used, remaining, limit: limits[type] };
    } catch (e) {
        return { allowed: true, plan, remaining: limits[type] };
    }
}

// ═══ INCREMENT USAGE ═══
async function incrementUsage(userId, type, supabaseAdmin) {
    if (!supabaseAdmin) return;
    
    try {
        const today = new Date().toISOString().split('T')[0];
        const uid = userId || 'guest';
        
        const { data: existing } = await supabaseAdmin
            .from('usage')
            .select('id, count')
            .eq('user_id', uid)
            .eq('type', type)
            .eq('date', today)
            .single();
        
        if (existing) {
            await supabaseAdmin
                .from('usage')
                .update({ count: existing.count + 1 })
                .eq('id', existing.id);
        } else {
            await supabaseAdmin
                .from('usage')
                .insert({ user_id: uid, type, date: today, count: 1 });
        }
    } catch (e) {
        logger.warn({ component: 'Payments', err: e.message }, 'Usage track error');
    }
}

// ═══ REFERRAL CODE ═══
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'KEL-';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// ═══ ROUTES ═══

// GET /api/payments/plans — list available plans
router.get('/plans', (req, res) => {
    res.json({
        plans: [
            { id: 'free', name: 'Free', price: 0, currency: 'EUR', limits: PLAN_LIMITS.free },
            { id: 'pro', name: 'Pro', price: 9.99, currency: 'EUR', limits: PLAN_LIMITS.pro, features: ['100 chat/zi', '50 căutări/zi', '20 imagini/zi', 'Memorie persistentă', 'Istoric conversații'] },
            { id: 'enterprise', name: 'Enterprise', price: 29.99, currency: 'EUR', limits: PLAN_LIMITS.enterprise, features: ['Nelimitat chat', 'Nelimitat căutări', 'Nelimitat imagini', 'Suport prioritar', 'API access', 'Custom avatar', 'SLA garantat'] }
        ]
    });
});

// GET /api/payments/status — current user plan & usage
router.get('/status', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.json({ plan: 'guest', limits: PLAN_LIMITS.guest });
        
        const planInfo = await getUserPlan(user.id, supabaseAdmin);
        
        // Get today's usage
        const today = new Date().toISOString().split('T')[0];
        let usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
        if (supabaseAdmin) {
            try {
                const { data } = await supabaseAdmin
                    .from('usage')
                    .select('type, count')
                    .eq('user_id', user.id)
                    .eq('date', today);
                if (data) data.forEach(d => { usage[d.type] = d.count; });
            } catch (e) {}
        }
        
        res.json({ ...planInfo, usage });
    } catch (e) {
        res.status(500).json({ error: 'Eroare plan' });
    }
});

// POST /api/payments/checkout — create Stripe checkout session
router.post('/checkout', async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Plăți indisponibile momentan' });
        
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Trebuie să fii autentificat' });
        
        const { plan } = req.body;
        if (!['pro', 'enterprise'].includes(plan)) return res.status(400).json({ error: 'Plan invalid' });
        
        const priceId = plan === 'pro'
            ? (process.env.STRIPE_PRO_PRICE_ID || process.env.STRIPE_PRICE_PRO)
            : (process.env.STRIPE_ENTERPRISE_PRICE_ID || process.env.STRIPE_PRICE_PREMIUM);
        if (!priceId) return res.status(503).json({ error: 'Prețuri neconfigurare' });
        
        // Check if user already has a Stripe customer ID
        let customerId;
        if (supabaseAdmin) {
            const { data } = await supabaseAdmin
                .from('subscriptions')
                .select('stripe_customer_id')
                .eq('user_id', user.id)
                .single();
            customerId = data?.stripe_customer_id;
        }
        
        const sessionParams = {
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: (process.env.APP_URL || 'https://kelionai.app') + '/?payment=success',
            cancel_url: (process.env.APP_URL || 'https://kelionai.app') + '/?payment=cancel',
            metadata: { user_id: user.id, plan },
            subscription_data: { metadata: { user_id: user.id, plan } }
        };
        
        if (customerId) sessionParams.customer = customerId;
        else sessionParams.customer_email = user.email;
        
        const session = await stripe.checkout.sessions.create(sessionParams);
        res.json({ url: session.url, sessionId: session.id });
        
    } catch (e) {
        logger.error({ component: 'Payments', err: e.message }, 'Checkout error');
        res.status(500).json({ error: 'Eroare checkout' });
    }
});

// POST /api/payments/portal — Stripe billing portal (manage subscription)
router.post('/portal', async (req, res) => {
    try {
        if (!stripe) return res.status(503).json({ error: 'Plăți indisponibile' });
        
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });
        
        const { data } = await supabaseAdmin
            .from('subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .single();
        
        if (!data?.stripe_customer_id) return res.status(404).json({ error: 'Nicio subscripție activă' });
        
        const session = await stripe.billingPortal.sessions.create({
            customer: data.stripe_customer_id,
            return_url: (process.env.APP_URL || 'https://kelionai.app') + '/'
        });
        
        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: 'Eroare portal' });
    }
});

// POST /api/payments/webhook — Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        if (!stripe) return res.status(503).send('Stripe not configured');
        
        const sig = req.headers['stripe-signature'];
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!sig || !endpointSecret) {
            logger.warn({ component: 'Payments' }, 'Webhook signature missing');
            return res.status(400).json({ error: 'Webhook signature missing' });
        }

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } catch (e) {
            logger.warn({ component: 'Payments', err: e.message }, 'Webhook signature verification failed');
            return res.status(400).json({ error: 'Webhook signature verification failed' });
        }
        
        const { supabaseAdmin } = req.app.locals;
        if (!supabaseAdmin) return res.status(503).send('DB not available');
        
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.metadata?.user_id;
                const plan = session.metadata?.plan;
                if (!userId || !plan) break;
                
                const subscription = await stripe.subscriptions.retrieve(session.subscription);
                
                await supabaseAdmin.from('subscriptions').upsert({
                    user_id: userId,
                    plan,
                    status: 'active',
                    stripe_customer_id: session.customer,
                    stripe_subscription_id: session.subscription,
                    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                    current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
                }, { onConflict: 'user_id' });
                
                logger.info({ component: 'Payments', plan, userId }, `✅ ${plan} activated for ${userId}`);
                break;
            }
            
            case 'customer.subscription.updated': {
                const sub = event.data.object;
                const userId = sub.metadata?.user_id;
                if (!userId) break;
                
                await supabaseAdmin.from('subscriptions').update({
                    status: sub.status === 'active' ? 'active' : 'inactive',
                    current_period_end: new Date(sub.current_period_end * 1000).toISOString()
                }).eq('stripe_subscription_id', sub.id);
                
                logger.info({ component: 'Payments', subId: sub.id, status: sub.status }, `Updated sub ${sub.id} → ${sub.status}`);
                break;
            }
            
            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                await supabaseAdmin.from('subscriptions')
                    .update({ status: 'cancelled', plan: 'free' })
                    .eq('stripe_subscription_id', sub.id);
                
                logger.info({ component: 'Payments', subId: sub.id }, `❌ Sub cancelled: ${sub.id}`);
                break;
            }
            
            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subId = invoice.subscription;
                if (subId) {
                    await supabaseAdmin.from('subscriptions')
                        .update({ status: 'past_due' })
                        .eq('stripe_subscription_id', subId);
                }
                logger.warn({ component: 'Payments', subId }, `⚠️ Payment failed for sub: ${subId}`);
                break;
            }
        }
        
        res.json({ received: true });
    } catch (e) {
        logger.error({ component: 'Payments', err: e.message }, 'Webhook error');
        res.status(500).send('Webhook error');
    }
});

// POST /api/payments/referral — generate referral code
router.post('/referral', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });
        
        // Check if user already has a referral code
        const { data: existing } = await supabaseAdmin
            .from('referrals')
            .select('code')
            .eq('user_id', user.id)
            .single();
        
        if (existing) return res.json({ code: existing.code });
        
        const code = generateReferralCode();
        await supabaseAdmin.from('referrals').insert({ user_id: user.id, code });
        
        res.json({ code });
    } catch (e) {
        res.status(500).json({ error: 'Eroare referral' });
    }
});

// POST /api/payments/redeem — redeem referral code (7 days Pro for both)
router.post('/redeem', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });
        
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Cod lipsă' });
        
        const { data: referral } = await supabaseAdmin
            .from('referrals')
            .select('user_id, code, redeemed_by')
            .eq('code', code.toUpperCase())
            .single();
        
        if (!referral) return res.status(404).json({ error: 'Cod invalid' });
        if (referral.user_id === user.id) return res.status(400).json({ error: 'Nu poți folosi propriul cod' });
        if (referral.redeemed_by && referral.redeemed_by.includes(user.id)) {
            return res.status(400).json({ error: 'Cod deja folosit' });
        }
        
        const proEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        // Give Pro to redeemer
        await supabaseAdmin.from('subscriptions').upsert({
            user_id: user.id, plan: 'pro', status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: proEnd,
            source: 'referral'
        }, { onConflict: 'user_id' });
        
        // Give Pro to referrer
        await supabaseAdmin.from('subscriptions').upsert({
            user_id: referral.user_id, plan: 'pro', status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: proEnd,
            source: 'referral'
        }, { onConflict: 'user_id' });
        
        // Track redemption
        const redeemed = referral.redeemed_by || [];
        redeemed.push(user.id);
        await supabaseAdmin.from('referrals').update({ redeemed_by: redeemed }).eq('code', code.toUpperCase());
        
        res.json({ success: true, message: '7 zile Pro activate pentru tine și prietenul tău!' });
    } catch (e) {
        res.status(500).json({ error: 'Eroare redeem' });
    }
});

module.exports = { router, getUserPlan, checkUsage, incrementUsage, PLAN_LIMITS };
