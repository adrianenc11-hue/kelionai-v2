'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');

// ── Pricing plans definition ──
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    nameRo: 'Gratuit',
    price: { monthly: 0, annual: 0 },
    credits: 100,
    features: {
      en: ['100 AI credits/month', 'Kelion & Kira avatars', 'Basic chat', 'Voice input', 'Weather info'],
      ro: ['100 credite AI/lună', 'Avataruri Kelion & Kira', 'Chat de bază', 'Input vocal', 'Informații meteo'],
    },
    stripePriceId: { monthly: null, annual: null },
    popular: false,
    color: '#6366f1',
  },
  {
    id: 'pro',
    name: 'Pro',
    nameRo: 'Pro',
    price: { monthly: 9.99, annual: 7.99 },
    credits: 2000,
    features: {
      en: ['2000 AI credits/month', 'All avatars + voice cloning', 'Web search', 'Code assistant', 'Vision AI', 'Priority support'],
      ro: ['2000 credite AI/lună', 'Toate avatarurile + clonare vocală', 'Căutare web', 'Asistent cod', 'Vision AI', 'Suport prioritar'],
    },
    stripePriceId: {
      monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || null,
      annual:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID  || null,
    },
    popular: true,
    color: '#8b5cf6',
  },
  {
    id: 'premium',
    name: 'Premium',
    nameRo: 'Premium',
    price: { monthly: 24.99, annual: 19.99 },
    credits: 10000,
    features: {
      en: ['10000 AI credits/month', 'Everything in Pro', 'Referral bonuses', 'Workspace AI', 'API access', 'Dedicated support'],
      ro: ['10000 credite AI/lună', 'Tot din Pro', 'Bonusuri referral', 'Workspace AI', 'Acces API', 'Suport dedicat'],
    },
    stripePriceId: {
      monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || null,
      annual:  process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID  || null,
    },
    popular: false,
    color: '#f59e0b',
  },
];

// ─── GET / — Root alias → returnează toate planurile ───
router.get('/', (req, res) => {
  try {
    const lang = req.query.lang || 'en';
    const plans = PLANS.map(p => ({
      id: p.id,
      name: lang === 'ro' ? p.nameRo : p.name,
      price: p.price,
      credits: p.credits,
      features: lang === 'ro' ? p.features.ro : p.features.en,
      popular: p.popular,
      color: p.color,
      hasStripe: !!(p.stripePriceId.monthly || p.stripePriceId.annual),
    }));
    return res.json({ plans });
  } catch (e) {
    logger.error({ component: 'Pricing', err: e.message }, 'GET / failed');
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ─── GET /plans — Return all pricing plans ───
router.get('/plans', (req, res) => {
  try {
    const lang = req.query.lang || 'en';
    const plans = PLANS.map(p => ({
      id: p.id,
      name: lang === 'ro' ? p.nameRo : p.name,
      price: p.price,
      credits: p.credits,
      features: lang === 'ro' ? p.features.ro : p.features.en,
      popular: p.popular,
      color: p.color,
      hasStripe: !!(p.stripePriceId.monthly || p.stripePriceId.annual),
    }));
    return res.json({ plans });
  } catch (e) {
    logger.error({ component: 'Pricing', err: e.message }, 'GET /plans failed');
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ─── GET /current — Get current user's plan ───
router.get('/current', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    if (!getUserFromToken || !supabaseAdmin) {
      return res.json({ plan: 'free', credits: 0, renewsAt: null });
    }

    let user = null;
    try { user = await getUserFromToken(req); } catch (_) {}
    if (!user) return res.json({ plan: 'free', credits: 0, renewsAt: null });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('plan, credits, plan_expires_at')
      .eq('id', user.id)
      .single();

    return res.json({
      plan: profile?.plan || 'free',
      credits: profile?.credits || 0,
      renewsAt: profile?.plan_expires_at || null,
    });
  } catch (e) {
    logger.warn({ component: 'Pricing', err: e.message }, 'GET /current failed');
    return res.json({ plan: 'free', credits: 0, renewsAt: null });
  }
});

module.exports = router;