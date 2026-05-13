'use strict';

const { findById, getUsageToday, incrementUsage } = require('../db');
const rawPlans = require('../../config/plans.json');

// Plan catalogue loaded from server/config/plans.json. Prices live in Stripe
// Dashboard; each paid plan's `priceEnv` names the env variable that holds
// its Stripe Price ID (price_...). Daily limits and feature lists are
// app-level metadata and stay here because Stripe does not model them.
const SUBSCRIPTION_PLANS = Object.freeze(
  Object.fromEntries(
    Object.entries(rawPlans)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, plan]) => [key, Object.freeze({ ...plan })])
  )
);

/**
 * Middleware pentru verificarea subscription-ului.
 * Verifică dacă utilizatorul are quota disponibilă.
 */
function checkSubscription(requiredPlan = 'free') {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;

      const user = await findById(userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const tier = user.subscription_tier || 'free';
      const plan = SUBSCRIPTION_PLANS[tier];
      const required = SUBSCRIPTION_PLANS[requiredPlan];

      if (!plan || !required) {
        return res.status(500).json({ error: 'Invalid subscription plan' });
      }

      const tierOrder = ['free', 'basic', 'premium', 'enterprise'];
      const userTierIndex = tierOrder.indexOf(tier);
      const requiredTierIndex = tierOrder.indexOf(requiredPlan);

      if (userTierIndex < requiredTierIndex) {
        return res.status(403).json({
          error: 'Subscription upgrade required',
          currentPlan: tier,
          requiredPlan: requiredPlan,
        });
      }

      const usageToday = await getUsageToday(userId);

      if (plan.dailyLimit !== null && usageToday >= plan.dailyLimit) {
        return res.status(429).json({
          error: 'Daily limit exceeded',
          dailyLimit: plan.dailyLimit,
          usageToday: usageToday,
          upgradeTo: tierOrder[userTierIndex + 1] || 'enterprise',
        });
      }

      req.subscription = {
        tier,
        plan,
        usageToday,
        dailyLimit: plan.dailyLimit,
      };

      next();
    } catch (err) {
      console.error('[checkSubscription] Error:', err.message);
      res.status(500).json({ error: 'Subscription check failed' });
    }
  };
}

// Return the Stripe Price ID configured for a plan, or null for free/missing.
function getStripePriceId(planId) {
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan || !plan.priceEnv) return null;
  return process.env[plan.priceEnv] || null;
}

// Public plan catalogue for the UI. Includes the plan metadata plus the
// configured Stripe Price ID when available so the client can route users
// straight to checkout without another round-trip.
function getPlans() {
  return Object.values(SUBSCRIPTION_PLANS).map(plan => ({
    ...plan,
    stripePriceId: plan.priceEnv ? (process.env[plan.priceEnv] || null) : null,
  }));
}

module.exports = {
  checkSubscription,
  getPlans,
  getStripePriceId,
  SUBSCRIPTION_PLANS,
};
