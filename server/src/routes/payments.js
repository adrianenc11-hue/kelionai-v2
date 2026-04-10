'use strict';

const express = require('express');
const { Router } = express;
const stripe = require('stripe');
const config = require('../config');
const { findById, updateSubscription } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Initialize Stripe only if secret key is provided
const stripeClient = config.stripe.secretKey ? stripe(config.stripe.secretKey) : null;

// Define subscription plans
const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: ['Limited voice interactions', 'Basic avatar'],
  },
  basic: {
    name: 'Basic',
    price: 999, // $9.99 in cents
    stripeId: 'price_basic_monthly',
    features: ['Unlimited voice interactions', 'Multiple avatars', 'Priority support'],
  },
  premium: {
    name: 'Premium',
    price: 2999, // $29.99 in cents
    stripeId: 'price_premium_monthly',
    features: ['All Basic features', 'Custom avatar', 'Advanced AI models', 'API access'],
  },
  enterprise: {
    name: 'Enterprise',
    price: 9999, // $99.99 in cents
    stripeId: 'price_enterprise_monthly',
    features: ['All Premium features', 'Dedicated support', 'Custom integrations', 'SLA'],
  },
};

/**
 * GET /payments/plans
 * Get all available subscription plans
 */
router.get('/plans', (req, res) => {
  res.json({ plans: SUBSCRIPTION_PLANS });
});

/**
 * POST /payments/create-checkout-session
 * Create a Stripe Checkout session for a subscription
 */
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({
      error: 'Payment processing coming soon',
      message: 'Stripe integration is not yet configured.',
    });
  }

  const { planId } = req.body;
  const userId = req.user.id;

  if (!planId || !SUBSCRIPTION_PLANS[planId]) {
    return res.status(400).json({ error: 'Invalid plan ID' });
  }

  const plan = SUBSCRIPTION_PLANS[planId];

  if (plan.price === 0) {
    // Free plan - no checkout needed
    await updateSubscription(userId, {
      subscription_tier: planId,
      subscription_status: 'active',
      subscription_expires_at: null,
    });
    return res.json({ message: 'Free plan activated', redirectUrl: config.appBaseUrl });
  }

  try {
    const user = await findById(userId);
    let customerId = user.stripe_customer_id;

    // Create or retrieve Stripe customer
    if (!customerId) {
      const customer = await stripeClient.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });
      customerId = customer.id;
      // Save customer ID to DB
      await updateSubscription(userId, {
        subscription_tier: user.subscription_tier,
        subscription_status: user.subscription_status,
        stripe_customer_id: customerId
      });
    }

    // Create checkout session
    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripeId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${config.appBaseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appBaseUrl}/pricing`,
      metadata: {
        userId,
        planId,
      },
    });

    res.json({ sessionId: session.id, clientSecret: session.client_secret });
  } catch (error) {
    console.error('[payments/create-checkout-session] Error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /payments/webhook
 * Handle Stripe webhook events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(
      req.body,
      sig,
      config.stripe.webhookSecret
    );
  } catch (error) {
    console.error('[payments/webhook] Signature verification failed:', error.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, planId } = session.metadata;

        // Update user subscription
        await updateSubscription(userId, {
          subscription_tier: planId,
          subscription_status: 'active',
          subscription_expires_at: null,
        });

        console.log(`[payments/webhook] Subscription activated for user ${userId} (plan: ${planId})`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (userId) {
          const status = subscription.status === 'active' ? 'active' : 'inactive';
          await updateSubscription(userId, {
            subscription_status: status,
          });
          console.log(`[payments/webhook] Subscription updated for user ${userId} (status: ${status})`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (userId) {
          await updateSubscription(userId, {
            subscription_tier: 'free',
            subscription_status: 'inactive',
          });
          console.log(`[payments/webhook] Subscription cancelled for user ${userId}`);
        }
        break;
      }

      default:
        console.log(`[payments/webhook] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[payments/webhook] Error processing webhook:', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /payments/subscription-status
 * Get the current subscription status for the authenticated user
 */
router.get('/subscription-status', requireAuth, (req, res) => {
  const user = await findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    tier: user.subscription_tier,
    status: user.subscription_status,
    expiresAt: user.subscription_expires_at,
    plan: SUBSCRIPTION_PLANS[user.subscription_tier],
  });
});

/**
 * GET /payments/history
 * Returns payment history for the current user
 */
router.get('/history', requireAuth, (req, res) => {
  res.json({
    payments: [],
    message: 'Payment history will be available after Stripe integration is fully configured.',
  });
});

module.exports = router;
