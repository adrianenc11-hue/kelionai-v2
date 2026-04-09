'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { findAll, findById, updateSubscription } = require('../db');
const { VALID_TIERS, VALID_STATUSES } = require('../config/plans');

const router = Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------
router.get('/users', (_req, res) => {
  const users = findAll();
  res.json({ users });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id
// ---------------------------------------------------------------------------
router.get('/users/:id', (req, res) => {
  const user = findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/subscription
// ---------------------------------------------------------------------------
router.put('/users/:id/subscription', (req, res) => {
  const { subscription_tier, subscription_status, subscription_expires_at } = req.body;

  if (subscription_tier && !VALID_TIERS.includes(subscription_tier)) {
    return res.status(400).json({ error: `Invalid tier. Valid values: ${VALID_TIERS.join(', ')}` });
  }
  if (subscription_status && !VALID_STATUSES.includes(subscription_status)) {
    return res.status(400).json({ error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}` });
  }

  const existing = findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const updated = updateSubscription(req.params.id, {
    subscription_tier:       subscription_tier       || existing.subscription_tier,
    subscription_status:     subscription_status     || existing.subscription_status,
    subscription_expires_at: subscription_expires_at !== undefined
      ? subscription_expires_at
      : existing.subscription_expires_at,
  });

  res.json(updated);
});

module.exports = router;
