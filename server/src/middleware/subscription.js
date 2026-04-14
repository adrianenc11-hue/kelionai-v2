'use strict';
const { PLANS } = require('../config/plans');
const { getUsageToday, incrementUsage } = require('../db');

async function checkSubscription(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const expires = req.user.subscription_expires_at;
  if (expires && new Date(expires) < new Date()) {
    return res.status(403).json({
      error: 'Subscription expired',
      expired_at: expires,
      upgradeUrl: '/pricing',
    });
  }

  const tier  = req.user.subscription_tier || 'free';
  const plan  = PLANS[tier] || PLANS.free;
  const limit = plan.dailyLimit;

  if (limit === Infinity) {
    await incrementUsage(req.user.id);
    return next();
  }

  const used = await getUsageToday(req.user.id);
  if (used >= limit) {
    return res.status(429).json({
      error: 'Daily usage limit reached',
      limit,
      used,
      tier,
      upgradeUrl: '/pricing',
    });
  }
  await incrementUsage(req.user.id);
  return next();
}

module.exports = { checkSubscription };
