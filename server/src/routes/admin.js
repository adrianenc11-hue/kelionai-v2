'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { findAll, findById, updateSubscription, updateRole, sanitizeUser } = require('../db');
const { csrfProtection } = require('../middleware/csrf');
const { VALID_TIERS, VALID_STATUSES } = require('../config/plans');

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/users
router.get('/users', async (_req, res) => {
  const users = await findAll();
  res.json({ users: users.map(sanitizeUser) });
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res) => {
  const user = await findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitizeUser(user));
});

// PUT /api/admin/users/:id/subscription
router.put('/users/:id/subscription', csrfProtection, async (req, res) => {
  const { subscription_tier, subscription_status, subscription_expires_at } = req.body;
  if (subscription_tier && !VALID_TIERS.includes(subscription_tier)) {
    return res.status(400).json({ error: `Invalid tier. Valid values: ${VALID_TIERS.join(', ')}` });
  }
  if (subscription_status && !VALID_STATUSES.includes(subscription_status)) {
    return res.status(400).json({ error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}` });
  }
  const existing = await findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const updated = await updateSubscription(req.params.id, {
    subscription_tier:       subscription_tier       || existing.subscription_tier,
    subscription_status:     subscription_status     || existing.subscription_status,
    subscription_expires_at: subscription_expires_at !== undefined
      ? subscription_expires_at
      : existing.subscription_expires_at,
  });
  res.json(sanitizeUser(updated));
});

// PUT /api/admin/users/:id/role — promote/demote user
router.put('/users/:id/role', csrfProtection, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or user' });
  }
  const existing = await findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const updated = await updateRole(req.params.id, role);
  res.json(sanitizeUser(updated));
});

module.exports = router;
