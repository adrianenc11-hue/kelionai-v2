'use strict';

const { Router } = require('express');
const { getUserById, getAllUsers, updateUser, deleteUser } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = Router();

// All admin routes require authentication AND admin role
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    
    // Sanitize user data
    const sanitized = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      subscription_tier: u.subscription_tier,
      subscription_status: u.subscription_status,
      usage_today: u.usage_today,
      referral_code: u.referral_code,
      created_at: u.created_at,
    }));

    res.json({ users: sanitized, total: sanitized.length });
  } catch (err) {
    console.error('[admin/users] Error:', err.message);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/admin/users/:id
 * Get specific user details
 */
router.get('/users/:id', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      subscription_tier: user.subscription_tier,
      subscription_status: user.subscription_status,
      usage_today: user.usage_today,
      usage_reset_date: user.usage_reset_date,
      referral_code: user.referral_code,
      referred_by: user.referred_by,
      stripe_customer_id: user.stripe_customer_id,
      created_at: user.created_at,
      updated_at: user.updated_at,
    });
  } catch (err) {
    console.error('[admin/users/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PUT /api/admin/users/:id/subscription
 * Update user subscription
 */
router.put('/users/:id/subscription', async (req, res) => {
  try {
    const { id } = req.params;
    const { subscription_tier, subscription_status } = req.body;

    const validTiers = ['free', 'basic', 'premium', 'enterprise'];
    const validStatuses = ['active', 'cancelled', 'past_due', 'trialing'];

    if (subscription_tier && !validTiers.includes(subscription_tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (subscription_status && !validStatuses.includes(subscription_status)) {
      return res.status(400).json({ error: 'Invalid subscription status' });
    }

    const updateData = {};
    if (subscription_tier) updateData.subscription_tier = subscription_tier;
    if (subscription_status) updateData.subscription_status = subscription_status;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updatedUser = await updateUser(id, updateData);

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      subscription_tier: updatedUser.subscription_tier,
      subscription_status: updatedUser.subscription_status,
    });
  } catch (err) {
    console.error('[admin/subscription] Error:', err.message);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * PUT /api/admin/users/:id/role
 * Update user role
 */
router.put('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const updatedUser = await updateUser(id, { role });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
    });
  } catch (err) {
    console.error('[admin/role] Error:', err.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await deleteUser(id);

    res.json({ message: 'User deleted', id });
  } catch (err) {
    console.error('[admin/delete] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
