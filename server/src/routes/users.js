'use strict';

const { Router } = require('express');
const { getUserById, updateUser, getAllUsers, deleteUser } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { checkSubscription, getPlans } = require('../middleware/subscription');

const router = Router();

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get today's date for usage reset check
    const today = new Date().toDateString();
    const usageToday = user.usage_reset_date === today ? user.usage_today : 0;

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      subscription_tier: user.subscription_tier,
      subscription_status: user.subscription_status,
      usage: {
        today: usageToday,
        resetDate: user.usage_reset_date,
      },
      referral_code: user.referral_code,
      referred_by: user.referred_by,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('[users/me] Error:', err.message);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * PUT /api/users/me
 * Update current user profile
 */
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, picture } = req.body;
    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      updateData.name = name.trim();
    }

    if (picture !== undefined) {
      if (typeof picture !== 'string' || !picture.startsWith('http')) {
        return res.status(400).json({ error: 'Picture must be a valid URL' });
      }
      updateData.picture = picture;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updatedUser = await updateUser(req.user.id, updateData);

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      picture: updatedUser.picture,
    });
  } catch (err) {
    console.error('[users/me PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/users/subscription/plans
 * Get available subscription plans
 */
router.get('/subscription/plans', async (req, res) => {
  try {
    const plans = getPlans();
    res.json({ plans });
  } catch (err) {
    console.error('[subscription/plans] Error:', err.message);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

/**
 * POST /api/users/subscription/upgrade
 * Upgrade subscription (stub - integrate with Stripe)
 */
router.post('/subscription/upgrade', requireAuth, checkSubscription(), async (req, res) => {
  try {
    const { planId } = req.body;
    const validPlans = ['free', 'basic', 'premium', 'enterprise'];

    if (!validPlans.includes(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    // In production: Create Stripe checkout session here
    // For now, just return mock data
    res.json({
      message: 'Subscription upgrade initiated',
      planId,
      checkoutUrl: 'https://checkout.stripe.com/...', // Replace with real Stripe URL
    });
  } catch (err) {
    console.error('[subscription/upgrade] Error:', err.message);
    res.status(500).json({ error: 'Failed to upgrade subscription' });
  }
});

/**
 * GET /api/users/referral/:code
 * Validate referral code
 */
router.get('/referral/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!code || code.length < 6) {
      return res.status(400).json({ error: 'Invalid referral code' });
    }

    const db = require('../db').getDb();
    const referrer = await db.get('SELECT id, email, name FROM users WHERE referral_code = ?', [code]);

    if (!referrer) {
      return res.status(404).json({ error: 'Invalid referral code' });
    }

    res.json({
      valid: true,
      referrer: {
        name: referrer.name,
      },
    });
  } catch (err) {
    console.error('[referral] Error:', err.message);
    res.status(500).json({ error: 'Failed to validate referral code' });
  }
});

module.exports = router;
