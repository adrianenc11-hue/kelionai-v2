// ═══════════════════════════════════════════════════════════════
// KelionAI — Payment Routes (/api/payments/*)
// GET  /plans    — public plan list
// GET  /status   — current user plan + usage (auth required)
// POST /checkout — create Stripe Checkout session (auth required)
// POST /portal   — create Stripe Billing Portal session (auth required)
// ZERO hardcode — totul din server/config/app.js → .env
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../rate-limit-key');
const logger = require('../logger');
const { PLAN_LIMITS, getUserPlan } = require('../payments');
const { PLAN_CONFIG, PAID_PLANS, APP } = require('../config/app');

const router = express.Router();

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests' },
  keyGenerator: rateLimitKey,
});

// ── Construiește lista de planuri pentru frontend din PLAN_CONFIG ──
function buildPlanDefs() {
  return ['free', 'pro', 'premium'].map(id => {
    const plan = PLAN_CONFIG[id];
    if (!plan) return null;

    const def = {
      id:       plan.id,
      name:     plan.name,
      currency: plan.currency,
      limits:   PLAN_LIMITS[id],
      features: plan.features,
    };

    if (id === 'free') {
      def.price = 0;
    } else {
      def.price_monthly = plan.price_monthly;
      def.price_annual   = plan.price_annual;
      // Indică dacă prețul annual e configurat
      def.annual_available = !!plan.stripe_annual_price_id;
    }

    return def;
  }).filter(Boolean);
}

// GET /api/payments/plans — public, no auth
router.get('/plans', (req, res) => {
  res.json({ plans: buildPlanDefs() });
});

// GET /api/payments/status — auth required
router.get('/status', paymentLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = getUserFromToken ? await getUserFromToken(req) : null;

    if (!user) {
      const limits = PLAN_LIMITS.guest;
      return res.json({
        plan: 'guest',
        usage: { chat: 0, search: 0, image: 0, vision: 0, tts: 0 },
        limits: { chat: limits.chat, search: limits.search, image: limits.image },
      });
    }

    const plan = await getUserPlan(user.id, supabaseAdmin);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // Folosaj de azi
    const usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
    if (supabaseAdmin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: rows } = await supabaseAdmin
        .from('usage')
        .select('type, count')
        .eq('user_id', user.id)
        .eq('date', today);
      if (rows) {
        for (const r of rows) {
          if (Object.prototype.hasOwnProperty.call(usage, r.type)) usage[r.type] = r.count;
        }
      }
    }

    res.json({ plan, usage, limits: { chat: limits.chat, search: limits.search, image: limits.image } });
  } catch (err) {
    logger.error({ component: 'Payments', err: err.message }, 'Status error');
    res.status(500).json({ error: 'Failed to load status' });
  }
});

// POST /api/payments/checkout — auth required, creates Stripe Checkout
router.post('/checkout', paymentLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = getUserFromToken ? await getUserFromToken(req) : null;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { plan, billing, referral_code } = req.body;
    if (!plan || !PAID_PLANS.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const isAnnual = billing === 'annual';
    const planCfg = PLAN_CONFIG[plan];

    // Resolve Stripe Price ID din config (fără hardcode)
    const priceId = isAnnual
      ? planCfg?.stripe_annual_price_id
      : planCfg?.stripe_monthly_price_id;

    if (!priceId) {
      return res.status(503).json({ error: 'Price not configured for this plan' });
    }

    // Find or create Stripe customer
    let customerId;
    if (supabaseAdmin) {
      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .single();
      customerId = sub?.stripe_customer_id;
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      if (supabaseAdmin) {
        await supabaseAdmin
          .from('subscriptions')
          .upsert(
            { user_id: user.id, stripe_customer_id: customerId, plan: 'free', status: 'active' },
            { onConflict: 'user_id' }
          );
      }
    }

    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const sessionParams = {
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?payment=success`,
      cancel_url:  `${origin}/?payment=cancel`,
      metadata: { user_id: user.id, plan },
    };

    // Aplică codul de referral dacă există
    if (referral_code && supabaseAdmin) {
      try {
        const { data: ref } = await supabaseAdmin
          .from('referrals')
          .select('id, user_id')
          .eq('code', referral_code)
          .is('used_by', null)
          .single();
        if (ref) {
          sessionParams.metadata.referral_id   = ref.id;
          sessionParams.metadata.referral_code = referral_code;
        }
      } catch (err) {
        logger.warn({ component: 'Payments', err: err.message }, 'Invalid referral code, continuing without it');
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    logger.info({ component: 'Payments', userId: user.id, plan, billing: billing || 'monthly' }, 'Checkout session created');
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ component: 'Payments', err: err.message }, 'Checkout error');
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/portal — auth required, opens Stripe Billing Portal
router.post('/portal', paymentLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = getUserFromToken ? await getUserFromToken(req) : null;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Payments not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    let customerId;
    if (supabaseAdmin) {
      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .single();
      customerId = sub?.stripe_customer_id;
    }

    if (!customerId) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${origin}/`,
    });

    logger.info({ component: 'Payments', userId: user.id }, 'Portal session created');
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ component: 'Payments', err: err.message }, 'Portal error');
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

module.exports = router;