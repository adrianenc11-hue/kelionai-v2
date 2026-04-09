'use strict';

const { PLANS } = require('../config/plans');
const { getUsageToday, incrementUsage } = require('../db');

/**
 * Express middleware that checks whether the authenticated user has remaining
 * quota for the current day based on their subscription tier.
 *
 * On success, increments the usage counter and calls next().
 * On limit exceeded, responds 429.
 *
 * Must be used after requireAuth.
 */
function checkSubscription(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const tier  = req.user.subscription_tier || 'free';
  const plan  = PLANS[tier] || PLANS.free;
  const limit = plan.dailyLimit;

  // Enterprise = unlimited
  if (limit === Infinity) {
    incrementUsage(req.user.id);
    return next();
  }

  const used = getUsageToday(req.user.id);
  if (used >= limit) {
    return res.status(429).json({
      error: 'Daily usage limit reached',
      limit,
      used,
      tier,
      upgradeUrl: '/pricing',
    });
  }

  incrementUsage(req.user.id);
  return next();
}

module.exports = { checkSubscription };
