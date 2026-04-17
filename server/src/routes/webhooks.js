'use strict';

const express = require('express');
const Stripe = require('stripe');
const { updateSubscription, findByStripeCustomerId } = require('../db');

const router = express.Router();

// Stripe requires the raw request body for signature verification. This router
// must be mounted before any JSON body parsing middleware.
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    return res.status(503).send('Webhook not configured');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = parseInt(session.metadata?.userId || session.client_reference_id, 10);
        const planId = session.metadata?.planId;
        if (userId && planId) {
          await updateSubscription(userId, {
            subscription_tier: planId,
            subscription_status: 'active',
            stripe_customer_id: session.customer || null,
          });
          console.log(`[webhook] checkout.session.completed user=${userId} plan=${planId}`);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = await findByStripeCustomerId(sub.customer);
        if (user) {
          const deleted = event.type === 'customer.subscription.deleted';
          const status = deleted ? 'canceled' : (sub.status || 'active');
          // `checkSubscription` middleware (server/src/middleware/subscription.js)
          // gates features off `subscription_tier` alone. A canceled subscription
          // must drop back to the free tier, otherwise the user keeps paid-tier
          // quotas and features even after Stripe stops billing them.
          const update = { subscription_status: status };
          if (deleted) update.subscription_tier = 'free';
          await updateSubscription(user.id, update);
          console.log(`[webhook] ${event.type} user=${user.id} status=${status}${deleted ? ' tier=free' : ''}`);
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const user = inv.customer ? await findByStripeCustomerId(inv.customer) : null;
        if (user) {
          const status = event.type === 'invoice.paid' ? 'active' : 'past_due';
          await updateSubscription(user.id, { subscription_status: status });
          console.log(`[webhook] ${event.type} user=${user.id} status=${status}`);
        }
        break;
      }
      default:
        // Ignore unhandled events but still acknowledge to prevent retries.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[webhook] Handler error:', err.message);
    res.status(500).json({ error: 'Handler failed' });
  }
});

module.exports = router;
