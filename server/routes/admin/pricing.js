// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Pricing Routes (/api/admin/pricing/*)
// GET  /        — view current pricing config
// POST /update  — update plan prices (env-based, runtime override)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger  = require('../../logger');
const router  = express.Router();

// Runtime overrides (in-memory, reset on restart — use Railway env for persistence)
const _overrides = {};

// ─── GET / — Return current pricing config ───
router.get('/', (req, res) => {
  try {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price_monthly: 0,
        price_annual: 0,
        credits: 100,
        stripe_monthly: process.env.STRIPE_FREE_MONTHLY_PRICE_ID || null,
        stripe_annual:  process.env.STRIPE_FREE_ANNUAL_PRICE_ID  || null,
        ..._overrides['free'],
      },
      {
        id: 'pro',
        name: 'Pro',
        price_monthly: parseFloat(process.env.PLAN_PRO_PRICE_MONTHLY  || '9.99'),
        price_annual:  parseFloat(process.env.PLAN_PRO_PRICE_ANNUAL   || '7.99'),
        credits: parseInt(process.env.PLAN_PRO_CREDITS || '2000', 10),
        stripe_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || null,
        stripe_annual:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID  || null,
        ..._overrides['pro'],
      },
      {
        id: 'premium',
        name: 'Premium',
        price_monthly: parseFloat(process.env.PLAN_PREMIUM_PRICE_MONTHLY || '24.99'),
        price_annual:  parseFloat(process.env.PLAN_PREMIUM_PRICE_ANNUAL  || '19.99'),
        credits: parseInt(process.env.PLAN_PREMIUM_CREDITS || '10000', 10),
        stripe_monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || null,
        stripe_annual:  process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID  || null,
        ..._overrides['premium'],
      },
    ];

    const stripeConfigured = !!(process.env.STRIPE_SECRET_KEY);
    const stripeWebhook    = !!(process.env.STRIPE_WEBHOOK_SECRET);

    res.json({
      plans,
      stripe: {
        configured: stripeConfigured,
        webhookConfigured: stripeWebhook,
        publicKey: process.env.STRIPE_PUBLISHABLE_KEY ? '***configured***' : null,
        mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'test',
      },
      note: 'To persist changes, update Railway environment variables.',
    });
  } catch (e) {
    logger.error({ component: 'AdminPricing', err: e.message }, 'GET /admin/pricing failed');
    res.status(500).json({ error: 'Failed to fetch pricing config' });
  }
});

// ─── POST /update — Runtime override for a plan (non-persistent) ───
router.post('/update', (req, res) => {
  try {
    const { planId, price_monthly, price_annual, credits } = req.body;
    if (!planId || !['free', 'pro', 'premium'].includes(planId)) {
      return res.status(400).json({ error: 'Invalid planId. Must be free, pro, or premium.' });
    }

    _overrides[planId] = _overrides[planId] || {};
    if (price_monthly !== undefined) _overrides[planId].price_monthly = parseFloat(price_monthly);
    if (price_annual  !== undefined) _overrides[planId].price_annual  = parseFloat(price_annual);
    if (credits       !== undefined) _overrides[planId].credits       = parseInt(credits, 10);

    logger.info({ component: 'AdminPricing', planId, override: _overrides[planId] }, 'Pricing override applied');
    res.json({ ok: true, planId, override: _overrides[planId], note: 'Runtime only — update Railway env vars to persist.' });
  } catch (e) {
    logger.error({ component: 'AdminPricing', err: e.message }, 'POST /admin/pricing/update failed');
    res.status(500).json({ error: 'Failed to update pricing' });
  }
});

module.exports = router;