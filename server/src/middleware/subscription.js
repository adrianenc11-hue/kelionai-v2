'use strict';

const { getDb } = require('../db');

/**
 * Subscription tiers with daily limits.
 * null = unlimited
 */
const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    dailyLimit: 15, // 15 minutes per day
    features: ['Basic voice chat', 'Standard avatars'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    dailyLimit: 60, // 60 minutes per day
    features: ['Extended voice chat', 'All avatars', 'Priority support'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    dailyLimit: 180, // 3 hours per day
    features: ['Unlimited voice chat', 'Custom avatars', 'Advanced features', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    dailyLimit: null, // unlimited
    features: ['Everything in Premium', 'Custom integrations', 'Dedicated support'],
  },
};

/**
 * Middleware pentru verificarea subscription-ului.
 * Verifică dacă utilizatorul are quota disponibilă.
 */
async function checkSubscription(requiredPlan = 'free') {
  return async (req, res, next) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(500).json({ error: 'Database not initialized' });
      }

      const userId = req.user.id;
      
      // Get user subscription
      const user = await db.get('SELECT subscription_tier, usage_today, usage_reset_date FROM users WHERE id = ?', [userId]);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const tier = user.subscription_tier || 'free';
      const plan = SUBSCRIPTION_PLANS[tier];
      const required = SUBSCRIPTION_PLANS[requiredPlan];

      if (!plan || !required) {
        return res.status(500).json({ error: 'Invalid subscription plan' });
      }

      // Check if tier is sufficient
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

      // Check daily limit
      const today = new Date().toDateString();
      let usageToday = user.usage_today || 0;

      // Reset usage if new day
      if (user.usage_reset_date !== today) {
        await db.run('UPDATE users SET usage_today = 0, usage_reset_date = ? WHERE id = ?', [today, userId]);
        usageToday = 0;
      }

      // If limit is null, it's unlimited
      if (plan.dailyLimit !== null && usageToday >= plan.dailyLimit) {
        return res.status(429).json({
          error: 'Daily limit exceeded',
          dailyLimit: plan.dailyLimit,
          usageToday: usageToday,
          upgradeTo: tierOrder[userTierIndex + 1] || 'enterprise',
        });
      }

      // Attach subscription info to request
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
