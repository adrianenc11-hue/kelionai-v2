'use strict';

const { findById, getUsageToday, incrementUsage } = require('../db');

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

      // Admins bypass all quotas + tier gating. Adrian's requirement:
      // "admin are tot nelimitat" — regardless of plan, daily limit, or
      // required tier, admin requests pass through untouched.
      const defaultAdmins = ['adrianenc11@gmail.com'];
      const extraAdmins = (process.env.ADMIN_EMAILS || '')
        .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      const allAdmins = [...new Set([...defaultAdmins, ...extraAdmins])];
      const isAdmin = user.role === 'admin'
        || (user.email && allAdmins.includes(String(user.email).toLowerCase()));
      if (isAdmin) {
        req.subscription = {
          tier: 'admin',
          plan: { id: 'admin', name: 'Admin', dailyLimit: null },
          usageToday: 0,
          dailyLimit: null,
          isAdmin: true,
        };
        return next();
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
