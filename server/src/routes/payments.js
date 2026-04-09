'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/payments/create-checkout-session
// ---------------------------------------------------------------------------
// Stripe-ready stub.  Returns 503 until Stripe keys are configured.
// ---------------------------------------------------------------------------
router.post('/create-checkout-session', requireAuth, (_req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Payment processing coming soon',
      message: 'Stripe integration is not yet configured.',
    });
  }

  // TODO: implement Stripe checkout session creation
  res.status(501).json({ error: 'Not implemented' });
});

// ---------------------------------------------------------------------------
// POST /api/payments/webhook
// ---------------------------------------------------------------------------
// Stripe webhook handler stub.
// ---------------------------------------------------------------------------
router.post('/webhook', (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook endpoint not configured' });
  }

  // TODO: verify Stripe webhook signature and handle events
  res.json({ received: true });
});

// ---------------------------------------------------------------------------
// GET /api/payments/history
// ---------------------------------------------------------------------------
// Returns payment history for the current user (stub).
// ---------------------------------------------------------------------------
router.get('/history', requireAuth, (_req, res) => {
  res.json({
    payments: [],
    message: 'Payment history will be available after Stripe integration.',
  });
});

module.exports = router;
