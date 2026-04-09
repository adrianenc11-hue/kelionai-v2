'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUsageToday, updateProfile } = require('../db');
const { PLANS } = require('../config/plans');

const router = Router();

// All routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------
router.get('/me', (req, res) => {
  const user = req.user;
  const tier = user.subscription_tier || 'free';
  const plan = PLANS[tier] || PLANS.free;
  const usedToday = getUsageToday(user.id);

  res.json({
    id:                    user.id,
    email:                 user.email,
    name:                  user.name,
    picture:               user.picture,
    avatar_url:            user.avatar_url,
    subscription_tier:     tier,
    subscription_status:   user.subscription_status || 'active',
    subscription_expires_at: user.subscription_expires_at || null,
    stripe_customer_id:    user.stripe_customer_id || null,
    created_at:            user.created_at,
    updated_at:            user.updated_at,
    last_login_at:         user.last_login_at,
    usage: {
      today: usedToday,
      daily_limit: plan.dailyLimit === Infinity ? null : plan.dailyLimit,
    },
  });
});

// ---------------------------------------------------------------------------
// PUT /api/users/me
// ---------------------------------------------------------------------------
router.put('/me', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const updated = updateProfile(req.user.id, { name: name.trim() });
  if (!updated) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id:    updated.id,
    email: updated.email,
    name:  updated.name,
  });
});

module.exports = router;
