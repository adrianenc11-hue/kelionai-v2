'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const { PLAN_CONFIG } = require('../config/app');

// ── Pricing plans — prices/credits from PLAN_CONFIG, display fields here ──
const PLAN_DISPLAY = {
  free: {
    nameRo: 'Gratuit',
    features: {
      en: ['100 AI credits/month', 'Kelion & Kira avatars', 'Basic chat', 'Voice input', 'Weather info'],
      ro: ['100 credite AI/lună', 'Avataruri Kelion & Kira', 'Chat de bază', 'Input vocal', 'Informații meteo'],
    },
    popular: false,
    color: '#6366f1',
  },
  pro: {
    nameRo: 'Pro',
    features: {
      en: ['2000 AI credits/month', 'All avatars + voice cloning', 'Web search', 'Code assistant', 'Vision AI', 'Priority support'],
      ro: ['2000 credite AI/lună', 'Toate avatarurile + clonare vocală', 'Căutare web', 'Asistent cod', 'Vision AI', 'Suport prioritar'],
    },
    popular: true,
    color: '#8b5cf6',
  },
  premium: {
    nameRo: 'Premium',
    features: {
      en: ['10000 AI credits/month', 'Everything in Pro', 'Referral bonuses', 'Workspace AI', 'API access', 'Dedicated support'],
      ro: ['10000 credite AI/lună', 'Tot din Pro', 'Bonusuri referral', 'Workspace AI', 'Acces API', 'Suport dedicat'],
    },
    popular: false,
    color: '#f59e0b',
  },
};

function buildPlans() {
  return ['free', 'pro', 'premium'].map(id => {
    const cfg = PLAN_CONFIG[id];
    const display = PLAN_DISPLAY[id];
    return {
      id,
      name: cfg.name,
      nameRo: display.nameRo,
      price: { monthly: cfg.price_monthly || cfg.price || 0, annual: cfg.price_annual || 0 },
      credits: cfg.limits ? Object.values(cfg.limits).reduce((a, b) => a + (b > 0 ? b : 0), 0) : 0,
      features: display.features,
      stripePriceId: {
        monthly: cfg.stripe_monthly_price_id || null,
        annual:  cfg.stripe_annual_price_id  || null,
      },
      popular: display.popular,
      color: display.color,
    };
  });
}

const PLANS = buildPlans();

// ── Shared handler for plan listing ──
function handleGetPlans(req, res) {
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
    logger.error({ component: 'Pricing', err: e.message }, 'GET plans failed');
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
}

router.get('/', handleGetPlans);
router.get('/plans', handleGetPlans);

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