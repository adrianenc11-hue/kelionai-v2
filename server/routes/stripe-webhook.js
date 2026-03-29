// ═══════════════════════════════════════════════════════════════
// KelionAI — Stripe Webhook Handler
// POST /api/stripe/webhook
//
// Events handled:
//   checkout.session.completed   → activate subscription + apply referral bonus
//   customer.subscription.updated → sync plan changes
//   customer.subscription.deleted → downgrade to free
//   invoice.payment_failed        → mark subscription past_due
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger  = require('../logger');
const { applyReferralBonus } = require('../referral');
const { sendEmail } = require('../mailer');

const router = express.Router();

// ── Raw body required for Stripe signature verification ──
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig     = req.headers['stripe-signature'];
    const secret  = process.env.STRIPE_WEBHOOK_SECRET;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let event;

    try {
      if (secret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } else {
        // Dev mode — no signature check
        event = JSON.parse(req.body.toString());
        logger.warn({ component: 'Webhook' }, 'No STRIPE_WEBHOOK_SECRET — skipping signature check (dev only)');
      }
    } catch (err) {
      logger.error({ component: 'Webhook', err: err.message }, 'Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { supabaseAdmin } = req.app.locals;
    const now = new Date().toISOString();

    try {
      switch (event.type) {

        // ─────────────────────────────────────────────────────────
        case 'checkout.session.completed': {
          const session  = event.data.object;
          const userId   = session.metadata?.user_id;
          const plan     = session.metadata?.plan;
          const refCode  = session.metadata?.referral_code;
          const billing  = session.metadata?.billing || 'monthly';
          const custId   = session.customer;
          const subId    = session.subscription;

          if (!userId || !plan || !supabaseAdmin) break;

          // Retrieve subscription from Stripe to get period dates
          let periodEnd = null;
          let periodStart = null;
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            periodStart = new Date(sub.current_period_start * 1000).toISOString();
            periodEnd   = new Date(sub.current_period_end   * 1000).toISOString();
          } catch (_e) {
            // fallback: calculate from now
            periodStart = now;
            const days  = billing === 'annual' ? 365 : 30;
            periodEnd   = new Date(Date.now() + days * 86400000).toISOString();
          }

          // Upsert subscription record
          await supabaseAdmin.from('subscriptions').upsert(
            {
              user_id:              userId,
              plan,
              status:               'active',
              billing_cycle:        billing,
              stripe_customer_id:   custId,
              stripe_subscription_id: subId,
              current_period_start: periodStart,
              current_period_end:   periodEnd,
              updated_at:           now,
            },
            { onConflict: 'user_id' }
          );

          // Apply referral bonus if code was used
          if (refCode) {
            await applyReferralBonus(refCode, userId, supabaseAdmin);
            logger.info({ component: 'Webhook', userId, refCode }, 'Referral bonus applied after checkout');
          }

          // Send welcome email
          try {
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('email, display_name')
              .eq('id', userId)
              .single();
            if (profile?.email) {
              await sendEmail({
                to:      profile.email,
                subject: `✅ Abonamentul tău KelionAI ${plan.toUpperCase()} este activ!`,
                html: buildWelcomeEmail(profile.display_name || profile.email, plan, billing, periodEnd, !!refCode),
              });
            }
          } catch (mailErr) {
            logger.warn({ component: 'Webhook', err: mailErr.message }, 'Welcome email failed (non-fatal)');
          }

          logger.info({ component: 'Webhook', userId, plan, billing }, 'Subscription activated');
          break;
        }

        // ─────────────────────────────────────────────────────────
        case 'customer.subscription.updated': {
          const sub    = event.data.object;
          const custId = sub.customer;
          if (!supabaseAdmin) break;

          const { data: existing } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id, plan, billing_cycle')
            .eq('stripe_customer_id', custId)
            .single();

          if (!existing) break;

          const newPlan   = _stripePlanFromSub(sub);
          const newStatus = sub.status; // active, past_due, canceled, etc.
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

          await supabaseAdmin.from('subscriptions').update({
            plan:                 newPlan || existing.plan,
            status:               newStatus,
            current_period_end:   periodEnd,
            updated_at:           now,
          }).eq('stripe_customer_id', custId);

          logger.info({ component: 'Webhook', custId, newPlan, newStatus }, 'Subscription updated');
          break;
        }

        // ─────────────────────────────────────────────────────────
        case 'customer.subscription.deleted': {
          const sub    = event.data.object;
          const custId = sub.customer;
          if (!supabaseAdmin) break;

          await supabaseAdmin.from('subscriptions').update({
            plan:       'free',
            status:     'canceled',
            updated_at: now,
          }).eq('stripe_customer_id', custId);

          logger.info({ component: 'Webhook', custId }, 'Subscription canceled → downgraded to free');
          break;
        }

        // ─────────────────────────────────────────────────────────
        case 'invoice.payment_failed': {
          const inv    = event.data.object;
          const custId = inv.customer;
          if (!supabaseAdmin) break;

          await supabaseAdmin.from('subscriptions').update({
            status:     'past_due',
            updated_at: now,
          }).eq('stripe_customer_id', custId);

          logger.warn({ component: 'Webhook', custId }, 'Payment failed → past_due');
          break;
        }

        default:
          logger.debug({ component: 'Webhook', type: event.type }, 'Unhandled event (ignored)');
      }

      res.json({ received: true });
    } catch (err) {
      logger.error({ component: 'Webhook', err: err.message, type: event.type }, 'Webhook handler error');
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

// ── Helper: extract plan name from Stripe subscription items ──
function _stripePlanFromSub(sub) {
  try {
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (!priceId) return null;
    const { PLAN_CONFIG } = require('../config/app');
    for (const [planId, cfg] of Object.entries(PLAN_CONFIG)) {
      if (cfg.stripe_monthly_price_id === priceId || cfg.stripe_annual_price_id === priceId) {
        return planId;
      }
    }
    return null;
  } catch (_e) {
    return null;
  }
}

// ── Email template: welcome after payment ──
function buildWelcomeEmail(name, plan, billing, periodEnd, hasReferral) {
  const endDate = periodEnd ? new Date(periodEnd).toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const billingLabel = billing === 'annual' ? 'anual' : 'lunar';
  const bonusNote = hasReferral
    ? '<p style="background:#0f172a;border-left:3px solid #22d3ee;padding:10px 16px;border-radius:4px;color:#22d3ee">🎁 <strong>Bonus referral aplicat!</strong> Ai primit 5 zile gratuite la abonamentul tău.</p>'
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:560px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:1.6rem">🎉 Bun venit la KelionAI ${plan.toUpperCase()}!</h1>
    </div>
    <div style="padding:28px">
      <p>Salut <strong>${name}</strong>,</p>
      <p>Abonamentul tău <strong>${plan.toUpperCase()} (${billingLabel})</strong> este acum activ.</p>
      ${bonusNote}
      <div style="background:#0f172a;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:0.85rem">DETALII ABONAMENT</p>
        <p style="margin:4px 0"><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p style="margin:4px 0"><strong>Facturare:</strong> ${billingLabel}</p>
        <p style="margin:4px 0"><strong>Activ până la:</strong> ${endDate}</p>
      </div>
      <p style="color:#94a3b8;font-size:0.85rem">
        Dacă ai întrebări despre abonament sau dorești un ramburs, 
        contactează-ne la <a href="mailto:support@kelionai.com" style="color:#6366f1">support@kelionai.com</a>.
      </p>
      <div style="text-align:center;margin-top:24px">
        <a href="${process.env.APP_URL || 'https://kelionai.com'}" 
           style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">
          Deschide KelionAI →
        </a>
      </div>
    </div>
    <div style="padding:16px;text-align:center;color:#475569;font-size:0.75rem;border-top:1px solid #334155">
      KelionAI · Politica de ramburs: <a href="${process.env.APP_URL || 'https://kelionai.com'}/refund-policy" style="color:#6366f1">kelionai.com/refund-policy</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;