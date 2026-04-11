'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { PLANS } = require('../config/plans');
const { updateStripeCustomerId, findByStripeCustomerId, updateSubscription } = require('../db');
const config = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// Lazy-initialise Stripe only when the key is available
// ---------------------------------------------------------------------------
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // Require lazily so tests don't fail when the package is not installed
  // and the key isn't set.
  const Stripe = require('stripe');
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

// ---------------------------------------------------------------------------
// POST /api/payments/create-checkout-session
// ---------------------------------------------------------------------------
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({
      error: 'Payment processing coming soon',
      message: 'Stripe integration is not yet configured.',
    });
  }

  const { planId } = req.body;
  const plan = PLANS[planId];
  if (!plan || plan.price === 0) {
    return res.status(400).json({ error: 'Invalid or free planId' });
  }

  try {
    const user = req.user;

    // Create or retrieve Stripe customer
    let stripeCustomerId = user.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email });
      stripeCustomerId = customer.id;
      updateStripeCustomerId(user.id, stripeCustomerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            unit_amount: Math.round(plan.price * 100),
            product_data: { name: plan.name },
          },
        },
      ],
      success_url: `${config.appBaseUrl}/?payment=success`,
      cancel_url:  `${config.appBaseUrl}/?payment=cancelled`,
      metadata: { userId: user.id, planId },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[payments] create-checkout-session error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/payments/webhook
// ---------------------------------------------------------------------------
// Note: this route requires a raw body — see index.js for the body parser setup.
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook endpoint not configured' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[payments] webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, planId } = session.metadata || {};
        if (userId && planId) {
          updateSubscription(userId, {
            subscription_tier:       planId,
            subscription_status:     'active',
            subscription_expires_at: null,
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const user = findByStripeCustomerId(subscription.customer);
        if (user) {
          updateSubscription(user.id, {
            subscription_tier:       'free',
            subscription_status:     'cancelled',
            subscription_expires_at: null,
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const user = findByStripeCustomerId(invoice.customer);
        if (user) {
          updateSubscription(user.id, {
            subscription_tier:       user.subscription_tier,
            subscription_status:     'expired',
            subscription_expires_at: null,
          });
        }
        break;
      }
      default:
        // Unhandled event type — no action needed
        break;
    }
  } catch (err) {
    console.error('[payments] webhook handler error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  return res.json({ received: true });
});

// ---------------------------------------------------------------------------
// GET /api/payments/history
// ---------------------------------------------------------------------------
router.get('/history', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe || !req.user.stripe_customer_id) {
    return res.json({ payments: [] });
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: req.user.stripe_customer_id,
      limit: 24,
    });

    const payments = invoices.data.map((inv) => ({
      id:        inv.id,
      amount:    inv.amount_paid / 100,
      currency:  inv.currency,
      status:    inv.status,
      date:      new Date(inv.created * 1000).toISOString(),
      pdf:       inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    }));

    return res.json({ payments });
  } catch (err) {
    console.error('[payments] history error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

module.exports = router;
