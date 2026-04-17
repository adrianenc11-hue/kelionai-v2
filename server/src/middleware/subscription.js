'use strict';

const { findById, getUsageToday, tryIncrementUsage } = require('../db');

/**
 * Subscription tiers with daily limits.
 * null = unlimited
 */
const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: null,
    dailyLimit: 10,
    features: ['Basic voice chat', 'Standard avatars'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 9.99,
    interval: 'month',
    dailyLimit: 60,
    features: ['Extended voice chat', 'All avatars', 'Priority support'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 29.99,
    interval: 'month',
    dailyLimit: 180,
    features: ['Unlimited voice chat', 'Custom avatars', 'Advanced features', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 99.99,
    interval: 'month',
    dailyLimit: null,
    features: ['Everything in Premium', 'Custom integrations', 'Dedicated support'],
  },
};

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

      // Atomic check-and-increment prevents race condition on concurrent requests.
      // Returns false if limit would be exceeded.
      const ok = await tryIncrementUsage(userId, plan.dailyLimit, 1);
      if (!ok) {
        const usageToday = await getUsageToday(userId);
        return res.status(429).json({
          error: 'Daily limit exceeded',
          dailyLimit: plan.dailyLimit,
          usageToday: usageToday,
          upgradeTo: tierOrder[userTierIndex + 1] || 'enterprise',
        });
      }

      const usageAfter = await getUsageToday(userId);
      req.subscription = {
        tier,
        plan,
        usageToday: usageAfter,
        dailyLimit: plan.dailyLimit,
      };

      next();
    } catch (err) {
      console.error('[checkSubscription] Error:', err.message);
      res.status(500).json({ error: 'Subscription check failed' });
    }
  };
}

/**
 * Get available subscription plans.
 */
function getPlans() {
  return Object.values(SUBSCRIPTION_PLANS);
}

module.exports = {
  checkSubscription,
  getPlans,
  SUBSCRIPTION_PLANS,
};
