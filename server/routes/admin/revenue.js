// ═══════════════════════════════════════════════════════════════
// Admin Sub-Router: Revenue & Payments
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('../../logger');
const router = express.Router();

const CONFIG = {
  rechargeAmountPence: parseInt(process.env.RECHARGE_AMOUNT_PENCE, 10) || 5000,
  appUrl:
    process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : ''),
};

// ── GET /revenue — Revenue stats ──
router.get('/', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ subscribers: 0, mrr: 0, recentPayments: [] });

    const { data: subs } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, plan, status, amount, created_at')
      .eq('status', 'active');

    const subscribers = (subs || []).length;
    const mrr = (subs || []).reduce((s, sub) => s + (parseFloat(sub.amount) || 0), 0);

    const { data: payments } = await supabaseAdmin
      .from('payments')
      .select('user_id, amount, plan, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ subscribers, mrr, recentPayments: payments || [] });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Revenue query failed');
    res.json({ subscribers: 0, mrr: 0, recentPayments: [] });
  }
});

// ── POST /refund — Refund user subscription ──
router.post('/refund', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!sub) return res.status(404).json({ error: 'Nicio subscripție activă găsită.' });

    const maxRefundDays = parseInt(process.env.REFUND_MAX_DAYS || '15', 10);
    const billingType = sub.billing_type || (sub.plan_interval === 'year' ? 'annual' : 'monthly');
    const subStartDate = new Date(sub.created_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - subStartDate) / 86400000);

    let refundAmount = 0;
    let message = '';

    if (billingType === 'monthly') {
      refundAmount = 0;
      message = 'Abonament lunar anulat. Fără rambursare (conform politicii).';
    } else {
      if (daysSinceStart > maxRefundDays) {
        return res.status(400).json({
          error:
            'Perioada de refund a expirat! Maxim ' + maxRefundDays + ' zile. Au trecut ' + daysSinceStart + ' zile.',
        });
      }
      const totalAmount = parseFloat(sub.amount) || 0;
      const monthlyRate = totalAmount / 12;
      const monthsUsed = Math.max(1, Math.ceil(daysSinceStart / 30));
      const monthsRemaining = Math.max(0, 12 - monthsUsed);
      refundAmount = parseFloat((monthsRemaining * monthlyRate).toFixed(2));
      message = 'Abonament anual oprit. Luni folosite: ' + monthsUsed + '. Refund: £' + refundAmount.toFixed(2) + '.';
    }

    await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'refunded',
        cancelled_at: now.toISOString(),
        refund_amount: refundAmount,
        refund_reason: reason || 'Admin refund',
      })
      .eq('user_id', userId);

    await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { plan: 'free' } });

    if (refundAmount > 0 && process.env.STRIPE_SECRET_KEY && sub.stripe_subscription_id && sub.stripe_payment_intent) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.refunds.create({
          payment_intent: sub.stripe_payment_intent,
          amount: Math.round(refundAmount * 100),
          reason: 'requested_by_customer',
        });
        message += ' (Stripe refund procesat)';
      } catch (stripeErr) {
        message += ' (Stripe refund EȘUAT: ' + stripeErr.message + ')';
        logger.error({ component: 'Admin', err: stripeErr.message }, 'Stripe refund failed');
      }
    }

    await supabaseAdmin
      .from('admin_logs')
      .insert({
        action: 'refund',
        user_id: userId,
        details: JSON.stringify({ reason, billingType, daysSinceStart, refundAmount, message }),
        admin_id: req.adminUser?.id,
        created_at: now.toISOString(),
      })
      .catch(() => {});

    logger.info({ component: 'Admin', userId, billingType, refundAmount }, 'Refund processed');
    res.json({ success: true, refundAmount, billingType, message });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Refund failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /recharge — Recharge AI credits ──
router.post('/recharge', async (req, res) => {
  try {
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: { name: (require('../../config/app').APP_NAME + ' — AI Credit Recharge'), description: 'Top-up for AI API credits' },
              unit_amount: CONFIG.rechargeAmountPence,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: CONFIG.appUrl + '/admin?recharge=success',
        cancel_url: CONFIG.appUrl + '/admin?recharge=cancelled',
        metadata: { type: 'ai_recharge', admin_id: req.adminUser?.id || 'unknown' },
      });

      logger.info({ component: 'Admin', sessionId: session.id }, 'Recharge checkout created');
      return res.json({ url: session.url });
    }

    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('admin_logs')
        .insert({
          action: 'recharge',
          details: '£50 AI credit recharge (manual)',
          admin_id: req.adminUser?.id,
          created_at: new Date().toISOString(),
        })
        .catch(() => {});
    }

    logger.info({ component: 'Admin' }, 'Recharge recorded (no Stripe)');
    res.json({ success: true, message: 'Recharge £50 înregistrată! (fără Stripe)' });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Recharge failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
