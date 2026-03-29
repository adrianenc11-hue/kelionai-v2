// ═══════════════════════════════════════════════════════════════
// KelionAI — Refund Policy & Request Routes (/api/refund/*)
//
// POLITICI REFUND (conform cerințelor):
//   LUNAR:  Nu se face refund (niciodată)
//   ANUAL:  - Luna curentă NU se rambursează
//           - Rămân 11 luni → refund proporțional
//           - După 2 luni PLINE de utilizare → refund NU se mai face
//
// Endpoints:
//   GET  /eligibility        — verifică dacă userul e eligibil pentru refund
//   POST /request            — trimite cerere de refund
//   GET  /requests           — admin: lista cereri
//   PUT  /requests/:id       — admin: aprobă/respinge
// ═══════════════════════════════════════════════════════════════
'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const logger    = require('../logger');
const { sendEmail } = require('../mailer');

const router = express.Router();

const refundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many refund requests. Try again later.' },
});

// ── Helper: require authenticated user ──
async function requireUser(req, res) {
  const { getUserFromToken } = req.app.locals;
  try {
    const user = await getUserFromToken(req);
    if (!user) { res.status(401).json({ error: 'Authentication required' }); return null; }
    return user;
  } catch (err) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
}

// ── Helper: require admin ──
async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  const adminEmail = process.env.ADMIN_EMAIL || '';
  if (user.email !== adminEmail && user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return user;
}

// ─────────────────────────────────────────────────────────────
// GET /api/refund/policy — Public: returnează politica de refund
// ─────────────────────────────────────────────────────────────
router.get('/policy', (req, res) => {
  return res.json({
    policy: {
      monthly: {
        eligible: false,
        description: 'Abonamentele lunare nu sunt eligibile pentru ramburs.',
        details: 'Poți anula oricând pentru a nu fi facturat luna viitoare.',
      },
      annual: {
        eligible: true,
        conditions: [
          'Luna curentă (în curs) nu se rambursează.',
          'Rambursul este disponibil în primele 2 luni de utilizare.',
          'După 2 luni pline de utilizare, rambursul nu mai este disponibil.',
          'Suma rambursată = luni rămase × (preț anual / 12).',
        ],
        window: '2 luni de la data abonării',
        processingTime: '3-5 zile lucrătoare pentru aprobare, 5-10 zile pentru procesare Stripe',
      },
    },
    contact: 'support@kelionai.com',
    lastUpdated: '2026-01-01',
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/refund/eligibility — Check if user can request refund
// ─────────────────────────────────────────────────────────────
router.get('/eligibility', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const eligibility = await checkRefundEligibility(user.id, supabaseAdmin);
    return res.json(eligibility);
  } catch (err) {
    logger.error({ component: 'Refund', err: err.message }, 'GET /eligibility failed');
    return res.status(500).json({ error: 'Failed to check eligibility' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/refund/request — Submit a refund request
// ─────────────────────────────────────────────────────────────
router.post('/request', refundLimiter, async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { reason } = req.body;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a reason (minimum 10 characters)' });
    }

    // Check eligibility first
    const eligibility = await checkRefundEligibility(user.id, supabaseAdmin);
    if (!eligibility.eligible) {
      return res.status(400).json({
        error: eligibility.reason,
        eligible: false,
        policy: eligibility.policy,
      });
    }

    // Check for existing pending request
    const { data: existing } = await supabaseAdmin
      .from('refund_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .single();

    if (existing) {
      return res.status(409).json({ error: 'You already have a pending refund request.' });
    }

    // Calculate refund amount
    const refundAmount = eligibility.refundAmountUsd || 0;

    // Insert request
    const { data: request, error: insertErr } = await supabaseAdmin
      .from('refund_requests')
      .insert({
        user_id:            user.id,
        email:              user.email,
        plan:               eligibility.plan,
        billing_cycle:      eligibility.billingCycle,
        subscription_start: eligibility.subscriptionStart,
        months_used:        eligibility.monthsUsed,
        refund_amount_usd:  refundAmount,
        reason:             reason.trim(),
        status:             'pending',
        stripe_customer_id: eligibility.stripeCustomerId,
        stripe_sub_id:      eligibility.stripeSubId,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Notify admin
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await sendEmail({
        to:      adminEmail,
        subject: `🔔 Cerere refund nouă — ${user.email} (${eligibility.plan} ${eligibility.billingCycle})`,
        html:    buildAdminRefundEmail(user.email, eligibility, reason, refundAmount, request.id),
      }).catch(() => {});
    }

    // Confirm to user
    await sendEmail({
      to:      user.email,
      subject: '📋 Cererea ta de ramburs a fost primită — KelionAI',
      html:    buildUserRefundConfirmEmail(user.email, eligibility, refundAmount, request.id),
    }).catch(() => {});

    logger.info({ component: 'Refund', userId: user.id, requestId: request.id, amount: refundAmount }, 'Refund request submitted');
    return res.json({
      success:    true,
      requestId:  request.id,
      refundAmount,
      message:    `Cererea ta de ramburs de $${refundAmount.toFixed(2)} a fost înregistrată. Vei primi un răspuns în 3-5 zile lucrătoare.`,
    });
  } catch (err) {
    logger.error({ component: 'Refund', err: err.message }, 'POST /request failed');
    return res.status(500).json({ error: 'Failed to submit refund request' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/refund/requests — Admin: list all refund requests
// ─────────────────────────────────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { supabaseAdmin } = req.app.locals;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('refund_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) query = query.eq('status', status);

    const { data: requests, error } = await query;
    if (error) throw error;

    const { count } = await supabaseAdmin
      .from('refund_requests')
      .select('id', { count: 'exact', head: true });

    return res.json({ requests: requests || [], total: count || 0 });
  } catch (err) {
    logger.error({ component: 'Refund', err: err.message }, 'GET /requests failed');
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/refund/requests/:id — Admin: approve or reject
// ─────────────────────────────────────────────────────────────
router.put('/requests/:id', async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { action, adminNote } = req.body; // action: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    const { supabaseAdmin } = req.app.locals;

    const { data: request } = await supabaseAdmin
      .from('refund_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request already processed' });
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      // Process Stripe refund if configured
      let stripeRefundId = null;
      if (process.env.STRIPE_SECRET_KEY && request.stripe_customer_id && request.refund_amount_usd > 0) {
        try {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          // Find the latest invoice/charge for this customer
          const charges = await stripe.charges.list({ customer: request.stripe_customer_id, limit: 5 });
          const latestCharge = charges.data.find(c => c.paid && !c.refunded);
          if (latestCharge) {
            const refundAmountCents = Math.round(request.refund_amount_usd * 100);
            const stripeRefund = await stripe.refunds.create({
              charge: latestCharge.id,
              amount: Math.min(refundAmountCents, latestCharge.amount),
              reason: 'requested_by_customer',
              metadata: { refund_request_id: id, user_id: request.user_id },
            });
            stripeRefundId = stripeRefund.id;
            logger.info({ component: 'Refund', stripeRefundId, amount: request.refund_amount_usd }, 'Stripe refund processed');
          }
        } catch (stripeErr) {
          logger.error({ component: 'Refund', err: stripeErr.message }, 'Stripe refund failed');
          return res.status(500).json({ error: 'Stripe refund failed: ' + stripeErr.message });
        }
      }

      // Update request
      await supabaseAdmin.from('refund_requests').update({
        status:           'approved',
        admin_note:       adminNote || null,
        stripe_refund_id: stripeRefundId,
        processed_at:     now,
        processed_by:     admin.id,
        updated_at:       now,
      }).eq('id', id);

      // Downgrade subscription to free
      await supabaseAdmin.from('subscriptions').update({
        plan:       'free',
        status:     'canceled',
        updated_at: now,
      }).eq('user_id', request.user_id);

      // Notify user
      await sendEmail({
        to:      request.email,
        subject: '✅ Cererea ta de ramburs a fost aprobată — KelionAI',
        html:    buildUserRefundApprovedEmail(request.email, request.refund_amount_usd, stripeRefundId),
      }).catch(() => {});

      logger.info({ component: 'Refund', requestId: id, adminId: admin.id }, 'Refund approved');
      return res.json({ success: true, action: 'approved', stripeRefundId });

    } else {
      // Reject
      await supabaseAdmin.from('refund_requests').update({
        status:       'rejected',
        admin_note:   adminNote || null,
        processed_at: now,
        processed_by: admin.id,
        updated_at:   now,
      }).eq('id', id);

      await sendEmail({
        to:      request.email,
        subject: '❌ Cererea ta de ramburs a fost respinsă — KelionAI',
        html:    buildUserRefundRejectedEmail(request.email, adminNote),
      }).catch(() => {});

      logger.info({ component: 'Refund', requestId: id, adminId: admin.id }, 'Refund rejected');
      return res.json({ success: true, action: 'rejected' });
    }
  } catch (err) {
    logger.error({ component: 'Refund', err: err.message }, 'PUT /requests/:id failed');
    return res.status(500).json({ error: 'Failed to process request' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CORE LOGIC: checkRefundEligibility
// ═══════════════════════════════════════════════════════════════
async function checkRefundEligibility(userId, supabaseAdmin) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, billing_cycle, status, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id, created_at')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return { eligible: false, reason: 'No active subscription found.', policy: 'no_subscription' };
  }

  if (sub.plan === 'free' || sub.status === 'canceled') {
    return { eligible: false, reason: 'No paid subscription to refund.', policy: 'no_paid_plan' };
  }

  const billingCycle = sub.billing_cycle || 'monthly';

  // ── LUNAR: NICIODATĂ refund ──
  if (billingCycle === 'monthly') {
    return {
      eligible:     false,
      reason:       'Abonamentele lunare nu sunt eligibile pentru ramburs conform politicii noastre.',
      policy:       'monthly_no_refund',
      plan:         sub.plan,
      billingCycle,
      policyDetails: 'Abonamentele lunare nu beneficiază de politica de ramburs. Poți anula oricând pentru a nu fi facturat luna viitoare.',
    };
  }

  // ── ANUAL: logică complexă ──
  if (billingCycle === 'annual') {
    const subStart = new Date(sub.current_period_start || sub.created_at);
    const now      = new Date();

    // Câte luni pline s-au scurs de la start
    const msElapsed   = now - subStart;
    const daysElapsed = msElapsed / 86400000;
    const monthsUsed  = Math.floor(daysElapsed / 30); // luni pline complete

    // Regula 1: Luna curentă (< 1 lună plină) — nu se rambursează
    // Regula 2: După 2 luni pline — nu se mai face refund
    if (monthsUsed >= 2) {
      return {
        eligible:     false,
        reason:       'Au trecut mai mult de 2 luni de utilizare. Conform politicii, rambursul nu mai este disponibil după 2 luni pline.',
        policy:       'annual_2months_exceeded',
        plan:         sub.plan,
        billingCycle,
        monthsUsed,
        policyDetails: 'Politica anuală: ramburs disponibil în primele 2 luni. Luna curentă nu se rambursează.',
      };
    }

    // Luni rămase = 12 - luna curentă (nu se rambursează) - luni deja folosite
    // Luna curentă = monthsUsed (indexat de la 0, deci luna 0 = prima lună)
    // Ramburs = lunile rămase după luna curentă
    const currentMonthIndex = monthsUsed; // 0 = prima lună, 1 = a doua lună
    const monthsRefundable  = 12 - currentMonthIndex - 1; // excludem luna curentă

    if (monthsRefundable <= 0) {
      return {
        eligible:     false,
        reason:       'Nu mai sunt luni rambursabile.',
        policy:       'annual_no_months_left',
        plan:         sub.plan,
        billingCycle,
        monthsUsed,
      };
    }

    // Calculăm suma de rambursat
    const { PLAN_CONFIG } = require('../config/app');
    const planCfg = PLAN_CONFIG[sub.plan] || {};
    const annualPrice = planCfg.price_annual || 0;
    const pricePerMonth = annualPrice / 12;
    const refundAmountUsd = parseFloat((pricePerMonth * monthsRefundable).toFixed(2));

    return {
      eligible:          true,
      plan:              sub.plan,
      billingCycle,
      monthsUsed,
      monthsRefundable,
      currentMonthIndex,
      refundAmountUsd,
      annualPrice,
      pricePerMonth,
      subscriptionStart: subStart.toISOString(),
      stripeCustomerId:  sub.stripe_customer_id,
      stripeSubId:       sub.stripe_subscription_id,
      policy:            'annual_eligible',
      policyDetails:     `Luna curentă (luna ${currentMonthIndex + 1}) nu se rambursează. Ramburs pentru ${monthsRefundable} luni rămase: $${refundAmountUsd.toFixed(2)}.`,
    };
  }

  return { eligible: false, reason: 'Billing cycle unknown.', policy: 'unknown' };
}

// ── Email templates ──
function buildAdminRefundEmail(email, eligibility, reason, amount, requestId) {
  return `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:24px;border-radius:12px">
  <h2 style="color:#f87171">🔔 Cerere Refund Nouă</h2>
  <p><strong>User:</strong> ${email}</p>
  <p><strong>Plan:</strong> ${eligibility.plan} (${eligibility.billingCycle})</p>
  <p><strong>Luni folosite:</strong> ${eligibility.monthsUsed || 0}</p>
  <p><strong>Luni rambursabile:</strong> ${eligibility.monthsRefundable || 0}</p>
  <p><strong>Sumă refund:</strong> <span style="color:#22d3ee;font-size:1.2rem">$${amount.toFixed(2)}</span></p>
  <p><strong>Motiv:</strong> ${reason}</p>
  <p><strong>Request ID:</strong> <code>${requestId}</code></p>
  <p style="color:#94a3b8;font-size:0.85rem">Aprobă sau respinge din panoul admin → Secțiunea Refunds.</p>
</div>`;
}

function buildUserRefundConfirmEmail(email, eligibility, amount, requestId) {
  return `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:24px;border-radius:12px">
  <h2 style="color:#22d3ee">📋 Cererea ta de ramburs a fost primită</h2>
  <p>Am primit cererea ta de ramburs pentru abonamentul <strong>${eligibility.plan} anual</strong>.</p>
  <div style="background:#0f172a;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0"><strong>Sumă solicitată:</strong> $${amount.toFixed(2)}</p>
    <p style="margin:4px 0"><strong>Luni rambursabile:</strong> ${eligibility.monthsRefundable}</p>
    <p style="margin:4px 0"><strong>ID cerere:</strong> <code>${requestId}</code></p>
  </div>
  <p>Vei primi un răspuns în <strong>3-5 zile lucrătoare</strong>.</p>
  <p style="color:#94a3b8;font-size:0.85rem">Dacă ai întrebări: <a href="mailto:support@kelionai.com" style="color:#6366f1">support@kelionai.com</a></p>
</div>`;
}

function buildUserRefundApprovedEmail(email, amount, stripeRefundId) {
  return `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:24px;border-radius:12px">
  <h2 style="color:#22c55e">✅ Rambursul tău a fost aprobat!</h2>
  <p>Cererea ta de ramburs a fost aprobată și procesată.</p>
  <div style="background:#0f172a;border-radius:8px;padding:16px;margin:16px 0">
    <p style="margin:4px 0"><strong>Sumă rambursată:</strong> <span style="color:#22d3ee;font-size:1.2rem">$${amount.toFixed(2)}</span></p>
    ${stripeRefundId ? `<p style="margin:4px 0"><strong>ID Stripe:</strong> <code>${stripeRefundId}</code></p>` : ''}
  </div>
  <p>Suma va apărea pe cardul tău în <strong>5-10 zile lucrătoare</strong>.</p>
  <p>Abonamentul tău a fost anulat. Poți reveni oricând!</p>
</div>`;
}

function buildUserRefundRejectedEmail(email, adminNote) {
  return `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;background:#1e293b;color:#e2e8f0;padding:24px;border-radius:12px">
  <h2 style="color:#f87171">❌ Cererea de ramburs a fost respinsă</h2>
  <p>Din păcate, cererea ta de ramburs nu poate fi procesată.</p>
  ${adminNote ? `<div style="background:#0f172a;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:0"><strong>Motiv:</strong> ${adminNote}</p></div>` : ''}
  <p>Dacă crezi că este o eroare, contactează-ne la <a href="mailto:support@kelionai.com" style="color:#6366f1">support@kelionai.com</a>.</p>
</div>`;
}

module.exports = router;
module.exports.checkRefundEligibility = checkRefundEligibility;