// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KelionAI v2.3 â€” PAYMENTS (Stripe Subscriptions)
// Plans: Free â‚¬0, Pro â‚¬29/mo (â‚¬250/year), Premium â‚¬19.99/mo
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const express = require('express');
const logger = require('./logger');
// Lazy-loaded to avoid potential circular dependency at module init time
let referralModule;
function getReferralModule() {
  if (!referralModule) referralModule = require('./referral');
  return referralModule;
}
const router = express.Router();

let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  logger.warn({ component: 'Payments', err: e.message }, 'Stripe not available');
}

// â•â•â• PLAN LIMITS â•â•â•
const PLAN_LIMITS = {
  guest: { chat: 5, search: 3, image: 1, vision: 2, tts: 5, name: 'Guest' },
  free: { chat: 10, search: 5, image: 2, vision: 5, tts: 10, name: 'Free' },
  pro: { chat: 100, search: 50, image: 20, vision: 50, tts: 100, name: 'Pro' },
  premium: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: 'Premium',
  },
  enterprise: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: 'Premium',
  }, // legacy alias
  // â”€â”€ Business Plans â”€â”€
  business_small: {
    chat: 500,
    search: 200,
    image: 50,
    vision: 100,
    tts: 500,
    name: 'Business Small',
    seats: 5,
    apiAccess: true,
  },
  business_medium: {
    chat: 2000,
    search: 1000,
    image: 200,
    vision: 500,
    tts: 2000,
    name: 'Business Medium',
    seats: 25,
    apiAccess: true,
  },
  business_large: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: 'Business Large',
    seats: 100,
    apiAccess: true,
  },
  // â”€â”€ Developer Plans â”€â”€
  developer_free: {
    chat: 50,
    search: 20,
    image: 5,
    vision: 10,
    tts: 20,
    name: 'Developer Free',
    apiCalls: 1000,
    rateLimit: 10,
  },
  developer_pro: {
    chat: 500,
    search: 200,
    image: 50,
    vision: 100,
    tts: 200,
    name: 'Developer Pro',
    apiCalls: 50000,
    rateLimit: 100,
  },
  developer_enterprise: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: 'Developer Enterprise',
    apiCalls: -1,
    rateLimit: 1000,
  },
};

// â•â•â• CHECK USER PLAN & USAGE â•â•â•
async function getUserPlan(userId, supabaseAdmin) {
  if (!userId || !supabaseAdmin) return { plan: 'guest', limits: PLAN_LIMITS.guest };

  try {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status, stripe_subscription_id, current_period_end')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (sub && sub.plan && new Date(sub.current_period_end) > new Date()) {
      return {
        plan: sub.plan,
        limits: PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free,
        subscription: sub,
      };
    }

    return { plan: 'free', limits: PLAN_LIMITS.free };
  } catch {
    return { plan: 'free', limits: PLAN_LIMITS.free };
  }
}

// â•â•â• CHECK USAGE LIMIT â•â•â•
// DISABLED â€” all users have unlimited access for now.
// Re-enable later by uncommenting the original logic below.
async function checkUsage(userId, _type /*, supabaseAdmin */) {
  const plan = userId ? 'unlimited' : 'guest';
  return { allowed: true, plan, remaining: -1 };
  /*
  // â”€â”€ Original limit logic (preserved for future re-activation) â”€â”€
  if (!userId)
    return {
      allowed: true,
      plan: "guest",
      remaining: PLAN_LIMITS.guest[type] || 5,
    };
  const { plan, limits } = await getUserPlan(userId, supabaseAdmin);
  if (limits[type] === -1) return { allowed: true, plan, remaining: -1 };

  if (!supabaseAdmin) return { allowed: true, plan, remaining: limits[type] };

  try {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabaseAdmin
      .from("usage")
      .select("count")
      .eq("user_id", userId || "guest")
      .eq("type", type)
      .eq("date", today)
      .single();

    const used = data?.count || 0;
    const remaining = limits[type] - used;

    return {
      allowed: remaining > 0,
      plan,
      used,
      remaining,
      limit: limits[type],
    };
  } catch {
    return { allowed: true, plan, remaining: limits[type] };
  }
  */
}

// â•â•â• INCREMENT USAGE â•â•â•
async function incrementUsage(userId, type, supabaseAdmin) {
  if (!supabaseAdmin) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const uid = userId || 'guest';

    const { data: existing } = await supabaseAdmin
      .from('usage')
      .select('id, count')
      .eq('user_id', uid)
      .eq('type', type)
      .eq('date', today)
      .single();

    if (existing) {
      await supabaseAdmin
        .from('usage')
        .update({ count: existing.count + 1 })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin.from('usage').insert({ user_id: uid, type, date: today, count: 1 });
    }
  } catch (e) {
    logger.warn({ component: 'Payments', err: e.message }, 'Usage track error');
  }
}

// â•â•â• REFERRAL CODE â•â•â•
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'KEL-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// â•â•â• STRIPE WEBHOOK IDEMPOTENCY â•â•â•
const processedWebhookEvents = new Set();

// â•â•â• ROUTES â•â•â•

// GET /api/payments/plans â€” list available plans
router.get('/plans', (req, res) => {
  const billing = req.query.billing || 'all';
  const allPlans = [
    {
      id: 'free',
      name: 'Free',
      price: 0,
      currency: 'GBP',
      billing: 'monthly',
      limits: PLAN_LIMITS.free,
      features: [
        '10 AI conversations per day',
        '5 web searches per day',
        '2 AI-generated images per day',
        'Basic 3D avatar interaction',
        'Text chat only',
        'Community support',
      ],
    },
    {
      id: 'pro',
      name: 'Pro',
      price: 25,
      currency: 'GBP',
      billing: 'monthly',
      stripePrice: process.env.STRIPE_PRO_PRICE_ID || 'price_1T08tcE0lEIhKK8ivaVhtrhp',
      limits: PLAN_LIMITS.pro,
      features: [
        '100 AI conversations per day',
        '50 web searches per day',
        '20 AI-generated images per day',
        'Voice conversations with avatar',
        'Persistent memory â€” Kelion remembers you',
        'Full conversation history',
        'Weather, news & trading tools',
        'Custom avatar personality',
        'Priority email support',
      ],
    },
    {
      id: 'pro_annual',
      name: 'Pro',
      price: 180,
      monthlyEquivalent: 15,
      savings: 'Save Â£120/year',
      currency: 'GBP',
      billing: 'annual',
      stripePrice: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'price_1T08tcE0lEIhKK8iK6yekEx9',
      limits: PLAN_LIMITS.pro,
      features: [
        '100 AI conversations per day',
        '50 web searches per day',
        '20 AI-generated images per day',
        'Voice conversations with avatar',
        'Persistent memory â€” Kelion remembers you',
        'Full conversation history',
        'Weather, news & trading tools',
        'Custom avatar personality',
        'Priority email support',
      ],
    },
    {
      id: 'developer',
      name: 'Developer',
      price: 800,
      monthlyEquivalent: 66.67,
      currency: 'GBP',
      billing: 'annual',
      stripePrice: process.env.STRIPE_DEVELOPER_PRICE_ID || 'price_1T08tdE0lEIhKK8ipQqEbv8c',
      limits: { chat: -1, search: -1, image: -1, vision: -1, tts: -1, name: 'Developer', seats: 5, apiAccess: true },
      features: [
        '5 team member seats',
        'Unlimited AI conversations',
        'Unlimited web searches & images',
        'Full API access with SDK',
        'Voice & video avatar interaction',
        'Advanced persistent memory & learning',
        'Priority AI processing',
        'Team management dashboard',
        'Dedicated priority support',
        'Custom integrations & webhooks',
      ],
    },
  ];
  let plans = allPlans;
  if (billing === 'monthly') plans = plans.filter((p) => p.billing === 'monthly');
  else if (billing === 'annual') plans = plans.filter((p) => p.billing === 'annual' || p.price === 0);
  res.json({ plans });
});

// GET /api/payments/stripe-prices â€” ADMIN: list all prices from Stripe account
router.get('/stripe-prices', async (req, res) => {
  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== (process.env.ADMIN_SECRET || 'kAI-adm1n-s3cr3t-2026-pr0d'))
      return res.status(403).json({ error: 'Forbidden' });
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

    const prices = await stripe.prices.list({ limit: 50, expand: ['data.product'] });
    const result = prices.data.map((p) => ({
      priceId: p.id,
      product: p.product?.name || p.product,
      amount: p.unit_amount / 100,
      currency: p.currency,
      interval: p.recurring?.interval || 'one_time',
      intervalCount: p.recurring?.interval_count || null,
      active: p.active,
    }));
    res.json({
      prices: result,
      envVars: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'âœ… set' : 'âŒ missing',
        STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID || 'âŒ missing',
        STRIPE_PRO_ANNUAL_PRICE_ID: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'âŒ missing',
        STRIPE_PREMIUM_PRICE_ID: process.env.STRIPE_PREMIUM_PRICE_ID || 'âŒ missing',
        STRIPE_PREMIUM_ANNUAL_PRICE_ID: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID || 'âŒ missing',
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'âœ… set' : 'âŒ missing',
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payments/status â€” current user plan & usage
router.get('/status', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ plan: 'guest', limits: PLAN_LIMITS.guest });

    const planInfo = await getUserPlan(user.id, supabaseAdmin);

    // Get today's usage
    const today = new Date().toISOString().split('T')[0];
    const usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from('usage')
          .select('type, count')
          .eq('user_id', user.id)
          .eq('date', today);
        if (data)
          data.forEach((d) => {
            usage[d.type] = d.count;
          });
      } catch (e) {
        logger.warn({ component: 'Payments', err: e.message }, 'Usage read failed');
      }
    }

    res.json({ ...planInfo, usage });
  } catch {
    res.status(500).json({ error: 'Plan status error' });
  }
});

// POST /api/payments/checkout â€” create Stripe checkout session
router.post('/checkout', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments service unavailable' });

    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { plan, referral_code } = req.body;
    // Normalize plan IDs: enterpriseâ†’pro, support annual variants
    const isAnnual = plan?.endsWith('_annual');
    const basePlan = plan?.replace('_annual', '');
    const normalizedPlan = basePlan === 'enterprise' ? 'pro' : basePlan;
    if (!['pro', 'developer'].includes(normalizedPlan)) return res.status(400).json({ error: 'Invalid plan' });

    // Bug #5: Check if user already has an active subscription
    if (supabaseAdmin) {
      const { data: existingSub } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, stripe_subscription_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();
      if (existingSub && existingSub.stripe_subscription_id) {
        return res.status(400).json({
          error: 'You already have an active subscription. Use the billing portal to change plans.',
          currentPlan: existingSub.plan,
          usePortal: true,
        });
      }
    }

    // Validate referral_code if provided
    let verifiedReferralCode = null;
    if (referral_code) {
      const { verifyReferralCode } = getReferralModule();
      const verification = verifyReferralCode(referral_code);
      if (verification.valid && !verification.isExpired) {
        verifiedReferralCode = referral_code;
      }
    }

    // Select correct Stripe price ID with hardcoded fallbacks
    let priceId;
    if (normalizedPlan === 'pro' && isAnnual) {
      priceId = process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'price_1T08tcE0lEIhKK8iK6yekEx9';
    } else if (normalizedPlan === 'pro') {
      priceId = process.env.STRIPE_PRO_PRICE_ID || 'price_1T08tcE0lEIhKK8ivaVhtrhp';
    } else if (normalizedPlan === 'developer') {
      priceId = process.env.STRIPE_DEVELOPER_PRICE_ID || 'price_1T08tdE0lEIhKK8ipQqEbv8c';
    }
    if (!priceId) return res.status(503).json({ error: 'Prices not configured' });

    // Check if user already has a Stripe customer ID
    let customerId;
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .single();
      customerId = data?.stripe_customer_id;
    }

    const sessionParams = {
      mode: 'subscription',
      // Let Stripe auto-select best payment methods for customer's location
      // Supports: Cards, SEPA, Bancontact, iDEAL, Google Pay, Apple Pay, etc.
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.APP_URL + '/?payment=success',
      cancel_url: process.env.APP_URL + '/?payment=cancel',
      metadata: {
        user_id: user.id,
        plan: normalizedPlan,
        ...(verifiedReferralCode ? { referral_code: verifiedReferralCode } : {}),
      },
      subscription_data: {
        metadata: { user_id: user.id, plan: normalizedPlan },
      },
      // Subscriptions auto-generate invoices â€” enable email receipts in Stripe Dashboard
      // Settings â†’ Emails â†’ "Email customers for successful payments"
      allow_promotion_codes: true,
    };

    if (customerId) sessionParams.customer = customerId;
    else sessionParams.customer_email = user.email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    logger.error(
      {
        component: 'Payments',
        err: e.message,
        stack: e.stack,
        type: e.type,
        code: e.code,
      },
      'Checkout error'
    );
    res.status(500).json({ error: 'Checkout error', detail: e.message });
  }
});

// POST /api/payments/portal â€” Stripe billing portal (manage subscription)
router.post('/portal', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments service unavailable' });

    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { data } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!data?.stripe_customer_id) return res.status(404).json({ error: 'No active subscription found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: process.env.APP_URL + '/',
    });

    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Portal error' });
  }
});

// POST /api/payments/webhook â€” Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!stripe) return res.status(503).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !endpointSecret) {
      logger.warn({ component: 'Payments' }, 'Webhook signature missing');
      return res.status(400).json({ error: 'Webhook signature missing' });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (e) {
      logger.warn({ component: 'Payments', err: e.message }, 'Webhook signature verification failed');
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).send('DB not available');

    // Idempotency check â€” check DB first (survives restarts), then in-memory cache
    if (processedWebhookEvents.has(event.id)) {
      logger.info({ component: 'Payments', eventId: event.id }, 'Duplicate webhook event skipped (cache)');
      return res.json({ received: true });
    }
    // Check persistent DB record
    try {
      const { data: existingEvent } = await supabaseAdmin
        .from('processed_webhook_events')
        .select('event_id')
        .eq('event_id', event.id)
        .single();
      if (existingEvent) {
        logger.info({ component: 'Payments', eventId: event.id }, 'Duplicate webhook event skipped (DB)');
        processedWebhookEvents.add(event.id);
        return res.json({ received: true });
      }
    } catch (e) {
      logger.debug(
        { component: 'Payments', err: e.message },
        'processed_webhook_events check failed (table may not exist yet)'
      );
    }

    processedWebhookEvents.add(event.id);
    // Keep the set bounded to avoid unbounded memory growth (keep last 10000 events)
    if (processedWebhookEvents.size > 10000) {
      const first = processedWebhookEvents.values().next().value;
      processedWebhookEvents.delete(first);
    }
    // Persist to DB for cross-restart idempotency
    try {
      await supabaseAdmin.from('processed_webhook_events').insert({ event_id: event.id, event_type: event.type });
    } catch (e) {
      logger.debug(
        { component: 'Payments', err: e.message },
        'processed_webhook_events insert failed (table may not exist yet)'
      );
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const plan = session.metadata?.plan;
        if (!userId || !plan) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        await supabaseAdmin.from('subscriptions').upsert(
          {
            user_id: userId,
            plan,
            status: 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          },
          { onConflict: 'user_id' }
        );

        logger.info({ component: 'Payments', plan, userId }, `âœ… ${plan} activated for ${userId}`);

        // Apply referral bonus if present
        const referralCode = session.metadata?.referral_code;
        if (referralCode) {
          const { applyReferralBonus } = getReferralModule();
          await applyReferralBonus(referralCode, userId, supabaseAdmin);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        let userId = sub.metadata?.user_id;

        // Fallback: lookup by stripe_subscription_id if metadata missing
        if (!userId) {
          const { data: existingSub } = await supabaseAdmin
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', sub.id)
            .single();
          userId = existingSub?.user_id;
        }
        if (!userId) break;

        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: sub.status === 'active' ? 'active' : 'inactive',
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', sub.id);

        logger.info(
          { component: 'Payments', subId: sub.id, status: sub.status },
          `Updated sub ${sub.id} â†’ ${sub.status}`
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'cancelled', plan: 'free' })
          .eq('stripe_subscription_id', sub.id);

        logger.info({ component: 'Payments', subId: sub.id }, `âŒ Sub cancelled: ${sub.id}`);
        break;
      }

      case 'charge.refunded':
      case 'charge.dispute.created': {
        const charge = event.data.object;
        const customerId = charge.customer;
        if (customerId) {
          await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'cancelled', plan: 'free' })
            .eq('stripe_customer_id', customerId);
          logger.info(
            { component: 'Payments', customerId, type: event.type },
            'Sub cancelled due to refund or dispute'
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          await supabaseAdmin.from('subscriptions').update({ status: 'past_due' }).eq('stripe_subscription_id', subId);
        }
        logger.warn({ component: 'Payments', subId }, `âš ï¸ Payment failed for sub: ${subId}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (e) {
    logger.error({ component: 'Payments', err: e.message }, 'Webhook error');
    res.status(500).send('Webhook error');
  }
});

// â•â•â• DEVELOPER API KEY MANAGEMENT â•â•â•

// POST /api/payments/developer/keys â€” generate a new API key
router.post('/developer/keys', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { name, scopes } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });

    // Check user's developer plan for key limits
    const planInfo = await getUserPlan(user.id, supabaseAdmin);
    const plan = planInfo.plan || 'free';
    const limits = {
      free: 1,
      developer_free: 1,
      developer_pro: 10,
      developer_enterprise: -1,
    };
    const maxKeys = limits[plan] || 1;

    // Count existing active keys
    const { data: existingKeys } = await supabaseAdmin
      .from('developer_keys')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (maxKeys !== -1 && (existingKeys || []).length >= maxKeys) {
      return res.status(403).json({
        error: `Key limit reached (${maxKeys}). Upgrade your developer plan for more keys.`,
        limit: maxKeys,
        current: (existingKeys || []).length,
      });
    }

    // Generate secure API key
    const crypto = require('crypto');
    const keyValue = 'kelion_' + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(keyValue).digest('hex');

    const { data: newKey, error } = await supabaseAdmin
      .from('developer_keys')
      .insert({
        user_id: user.id,
        name: name.substring(0, 50),
        key_hash: keyHash,
        key_prefix: keyValue.substring(0, 12) + '...',
        scopes: scopes || ['chat', 'search', 'image'],
        status: 'active',
        created_at: new Date().toISOString(),
        last_used_at: null,
        usage_count: 0,
      })
      .select('id, name, key_prefix, scopes, status, created_at')
      .single();

    if (error) throw error;

    // Return full key ONLY on creation (never shown again)
    res.json({
      key: keyValue,
      id: newKey.id,
      name: newKey.name,
      prefix: newKey.key_prefix,
      scopes: newKey.scopes,
      warning: 'Save this key now. It will not be shown again.',
    });

    logger.info({ component: 'Developer', userId: user.id }, `ðŸ”‘ New API key created: ${name}`);
  } catch (e) {
    logger.error({ component: 'Developer', err: e.message }, 'Key generation error');
    res.status(500).json({ error: 'Key generation failed' });
  }
});

// GET /api/payments/developer/keys â€” list user's API keys
router.get('/developer/keys', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { data: keys } = await supabaseAdmin
      .from('developer_keys')
      .select('id, name, key_prefix, scopes, status, created_at, last_used_at, usage_count')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    res.json({ keys: keys || [] });
  } catch {
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

// DELETE /api/payments/developer/keys/:id â€” revoke an API key
router.delete('/developer/keys/:id', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { error } = await supabaseAdmin
      .from('developer_keys')
      .update({ status: 'revoked' })
      .eq('id', req.params.id)
      .eq('user_id', user.id);

    if (error) throw error;

    logger.info({ component: 'Developer', userId: user.id }, `ðŸ”‘ API key revoked: ${req.params.id}`);
    res.json({ success: true, message: 'API key revoked successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to revoke key' });
  }
});

// GET /api/payments/usage â€” alias for /status (for frontend compatibility)
router.get('/usage', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ plan: 'guest', limits: PLAN_LIMITS.guest });
    const planInfo = await getUserPlan(user.id, supabaseAdmin);
    const today = new Date().toISOString().split('T')[0];
    const usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from('usage')
          .select('type, count')
          .eq('user_id', user.id)
          .eq('date', today);
        if (data)
          data.forEach((d) => {
            usage[d.type] = d.count;
          });
      } catch {
        /* ignored */
      }
    }
    res.json({ ...planInfo, usage });
  } catch {
    res.status(500).json({ error: 'Usage error' });
  }
});

module.exports = {
  router,
  getUserPlan,
  checkUsage,
  incrementUsage,
  PLAN_LIMITS,
};
