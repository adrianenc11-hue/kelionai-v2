// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — PAYMENTS (Stripe Subscriptions)
// Plans: Free €0, Pro €29/mo (€250/year), Premium €19.99/mo
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const logger = require("./logger");
// Lazy-loaded to avoid potential circular dependency at module init time
let referralModule;
function getReferralModule() {
  if (!referralModule) referralModule = require("./referral");
  return referralModule;
}
const router = express.Router();

let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  logger.warn(
    { component: "Payments", err: e.message },
    "Stripe not available",
  );
}

// ═══ PLAN LIMITS ═══
const PLAN_LIMITS = {
  guest: { chat: 5, search: 3, image: 1, vision: 2, tts: 5, name: "Guest" },
  free: { chat: 10, search: 5, image: 2, vision: 5, tts: 10, name: "Free" },
  pro: { chat: 100, search: 50, image: 20, vision: 50, tts: 100, name: "Pro" },
  premium: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: "Premium",
  },
  enterprise: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: "Premium",
  }, // legacy alias
  // ── Business Plans ──
  business_small: {
    chat: 500,
    search: 200,
    image: 50,
    vision: 100,
    tts: 500,
    name: "Business Small",
    seats: 5,
    apiAccess: true,
  },
  business_medium: {
    chat: 2000,
    search: 1000,
    image: 200,
    vision: 500,
    tts: 2000,
    name: "Business Medium",
    seats: 25,
    apiAccess: true,
  },
  business_large: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: "Business Large",
    seats: 100,
    apiAccess: true,
  },
  // ── Developer Plans ──
  developer_free: {
    chat: 50,
    search: 20,
    image: 5,
    vision: 10,
    tts: 20,
    name: "Developer Free",
    apiCalls: 1000,
    rateLimit: 10,
  },
  developer_pro: {
    chat: 500,
    search: 200,
    image: 50,
    vision: 100,
    tts: 200,
    name: "Developer Pro",
    apiCalls: 50000,
    rateLimit: 100,
  },
  developer_enterprise: {
    chat: -1,
    search: -1,
    image: -1,
    vision: -1,
    tts: -1,
    name: "Developer Enterprise",
    apiCalls: -1,
    rateLimit: 1000,
  },
};

// ═══ CHECK USER PLAN & USAGE ═══
async function getUserPlan(userId, supabaseAdmin) {
  if (!userId || !supabaseAdmin)
    return { plan: "guest", limits: PLAN_LIMITS.guest };

  try {
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status, stripe_subscription_id, current_period_end")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (sub && sub.plan && new Date(sub.current_period_end) > new Date()) {
      return {
        plan: sub.plan,
        limits: PLAN_LIMITS[sub.plan] || PLAN_LIMITS.free,
        subscription: sub,
      };
    }

    return { plan: "free", limits: PLAN_LIMITS.free };
  } catch {
    return { plan: "free", limits: PLAN_LIMITS.free };
  }
}

// ═══ CHECK USAGE LIMIT ═══
// DISABLED — all users have unlimited access for now.
// Re-enable later by uncommenting the original logic below.
async function checkUsage(userId, _type /*, supabaseAdmin */) {
  const plan = userId ? "unlimited" : "guest";
  return { allowed: true, plan, remaining: -1 };
  /*
  // ── Original limit logic (preserved for future re-activation) ──
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

// ═══ INCREMENT USAGE ═══
async function incrementUsage(userId, type, supabaseAdmin) {
  if (!supabaseAdmin) return;

  try {
    const today = new Date().toISOString().split("T")[0];
    const uid = userId || "guest";

    const { data: existing } = await supabaseAdmin
      .from("usage")
      .select("id, count")
      .eq("user_id", uid)
      .eq("type", type)
      .eq("date", today)
      .single();

    if (existing) {
      await supabaseAdmin
        .from("usage")
        .update({ count: existing.count + 1 })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin
        .from("usage")
        .insert({ user_id: uid, type, date: today, count: 1 });
    }
  } catch (e) {
    logger.warn({ component: "Payments", err: e.message }, "Usage track error");
  }
}

// ═══ REFERRAL CODE ═══
function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "KEL-";
  for (let i = 0; i < 6; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ═══ STRIPE WEBHOOK IDEMPOTENCY ═══
const processedWebhookEvents = new Set();

// ═══ ROUTES ═══

// GET /api/payments/plans — list available plans (monthly + annual)
router.get("/plans", (req, res) => {
  const billing = req.query.billing || "all"; // "monthly" | "annual" | "all"

  const allPlans = [
    // ── FREE ──
    {
      id: "free",
      name: "Free",
      price: 0,
      annualPrice: 0,
      currency: "EUR",
      billing: "monthly",
      limits: PLAN_LIMITS.free,
      features: [
        "10 AI conversations per day",
        "5 web searches per day",
        "2 AI-generated images per day",
        "Basic 3D avatar interaction",
        "Text chat only",
        "Community support",
      ],
    },
    // ── PRO Monthly ──
    {
      id: "pro",
      name: "Pro",
      price: 29,
      currency: "EUR",
      billing: "monthly",
      limits: PLAN_LIMITS.pro,
      features: [
        "100 AI conversations per day",
        "50 web searches per day",
        "20 AI-generated images per day",
        "Voice conversations with avatar",
        "Persistent memory — Kelion remembers you",
        "Full conversation history",
        "Weather, news & trading tools",
        "Custom avatar personality",
        "Priority email support",
      ],
    },
    // ── PRO Annual (save 2 months) ──
    {
      id: "pro_annual",
      name: "Pro",
      price: 200,
      monthlyEquivalent: 16.67,
      savings: "Save €148/year",
      currency: "EUR",
      billing: "annual",
      limits: PLAN_LIMITS.pro,
      features: [
        "100 AI conversations per day",
        "50 web searches per day",
        "20 AI-generated images per day",
        "Voice conversations with avatar",
        "Persistent memory — Kelion remembers you",
        "Full conversation history",
        "Weather, news & trading tools",
        "Custom avatar personality",
        "Priority email support",
      ],
    },
    // ── PREMIUM Monthly ──
    {
      id: "premium",
      name: "Premium",
      price: 19.99,
      currency: "EUR",
      billing: "monthly",
      limits: PLAN_LIMITS.premium,
      features: [
        "Unlimited AI conversations",
        "Unlimited web searches",
        "Unlimited AI-generated images",
        "Voice & video avatar interaction",
        "Advanced persistent memory & learning",
        "Priority AI processing (faster responses)",
        "Real-time trading intelligence",
        "Custom voice cloning",
        "API access for developers",
        "Custom 3D avatar upload",
        "Dedicated priority support",
        "Early access to new features",
      ],
    },
    // ── PREMIUM Annual (save 2 months) ──
    {
      id: "premium_annual",
      name: "Premium",
      price: 199.9,
      monthlyEquivalent: 16.66,
      savings: "Save €39.98/year",
      currency: "EUR",
      billing: "annual",
      limits: PLAN_LIMITS.premium,
      features: [
        "Unlimited AI conversations",
        "Unlimited web searches",
        "Unlimited AI-generated images",
        "Voice & video avatar interaction",
        "Advanced persistent memory & learning",
        "Priority AI processing (faster responses)",
        "Real-time trading intelligence",
        "Custom voice cloning",
        "API access for developers",
        "Custom 3D avatar upload",
        "Dedicated priority support",
        "Early access to new features",
      ],
    },
    // ═══════════════════════════════════════════════════
    // BUSINESS PLANS
    // ═══════════════════════════════════════════════════
    // ── Business Small ──
    {
      id: "business_small",
      name: "Business Small",
      price: 49.99,
      currency: "EUR",
      billing: "monthly",
      category: "business",
      limits: PLAN_LIMITS.business_small,
      features: [
        "Up to 5 team members",
        "500 AI conversations per day",
        "200 web searches per day",
        "Full API access",
        "Team management dashboard",
        "Priority email support",
        "Usage analytics & reporting",
        "Custom AI personality per team",
      ],
    },
    {
      id: "business_small_semi",
      name: "Business Small",
      price: 249.94,
      monthlyEquivalent: 41.66,
      savings: "Save €49.99 (2 months free)",
      currency: "EUR",
      billing: "semiannual",
      category: "business",
      limits: PLAN_LIMITS.business_small,
      features: [
        "Up to 5 team members",
        "500 AI conversations per day",
        "200 web searches per day",
        "Full API access",
        "Team management dashboard",
        "Priority email support",
        "Usage analytics & reporting",
        "Custom AI personality per team",
      ],
    },
    {
      id: "business_small_annual",
      name: "Business Small",
      price: 499.9,
      monthlyEquivalent: 41.66,
      savings: "Save €99.98/year",
      currency: "EUR",
      billing: "annual",
      category: "business",
      limits: PLAN_LIMITS.business_small,
      features: [
        "Up to 5 team members",
        "500 AI conversations per day",
        "200 web searches per day",
        "Full API access",
        "Team management dashboard",
        "Priority email support",
        "Usage analytics & reporting",
        "Custom AI personality per team",
      ],
    },
    // ── Business Medium ──
    {
      id: "business_medium",
      name: "Business Medium",
      price: 149.99,
      currency: "EUR",
      billing: "monthly",
      category: "business",
      limits: PLAN_LIMITS.business_medium,
      features: [
        "Up to 25 team members",
        "2,000 AI conversations per day",
        "1,000 web searches per day",
        "Full API access with higher rate limits",
        "Advanced team management & roles",
        "Priority phone & email support",
        "Custom AI training on your data",
        "Usage analytics & detailed reporting",
        "Single Sign-On (SSO) integration",
        "Dedicated account manager",
      ],
    },
    {
      id: "business_medium_semi",
      name: "Business Medium",
      price: 749.94,
      monthlyEquivalent: 124.99,
      savings: "Save €149.99 (2 months free)",
      currency: "EUR",
      billing: "semiannual",
      category: "business",
      limits: PLAN_LIMITS.business_medium,
      features: [
        "Up to 25 team members",
        "2,000 AI conversations per day",
        "1,000 web searches per day",
        "Full API access with higher rate limits",
        "Advanced team management & roles",
        "Priority phone & email support",
        "Custom AI training on your data",
        "Usage analytics & detailed reporting",
        "Single Sign-On (SSO) integration",
        "Dedicated account manager",
      ],
    },
    {
      id: "business_medium_annual",
      name: "Business Medium",
      price: 1499.9,
      monthlyEquivalent: 124.99,
      savings: "Save €299.98/year",
      currency: "EUR",
      billing: "annual",
      category: "business",
      limits: PLAN_LIMITS.business_medium,
      features: [
        "Up to 25 team members",
        "2,000 AI conversations per day",
        "1,000 web searches per day",
        "Full API access with higher rate limits",
        "Advanced team management & roles",
        "Priority phone & email support",
        "Custom AI training on your data",
        "Usage analytics & detailed reporting",
        "Single Sign-On (SSO) integration",
        "Dedicated account manager",
      ],
    },
    // ── Business Large ──
    {
      id: "business_large",
      name: "Business Large",
      price: 499.99,
      currency: "EUR",
      billing: "monthly",
      category: "business",
      limits: PLAN_LIMITS.business_large,
      features: [
        "Up to 100 team members",
        "Unlimited AI conversations",
        "Unlimited web searches & images",
        "Enterprise API with dedicated infrastructure",
        "Full team management with RBAC",
        "24/7 dedicated support with SLA",
        "Custom AI model fine-tuning",
        "On-premise deployment option",
        "Advanced security & compliance (SOC2)",
        "Custom integrations & webhooks",
        "White-label option available",
        "99.9% uptime SLA guaranteed",
      ],
    },
    {
      id: "business_large_semi",
      name: "Business Large",
      price: 2499.94,
      monthlyEquivalent: 416.66,
      savings: "Save €499.99 (2 months free)",
      currency: "EUR",
      billing: "semiannual",
      category: "business",
      limits: PLAN_LIMITS.business_large,
      features: [
        "Up to 100 team members",
        "Unlimited AI conversations",
        "Unlimited web searches & images",
        "Enterprise API with dedicated infrastructure",
        "Full team management with RBAC",
        "24/7 dedicated support with SLA",
        "Custom AI model fine-tuning",
        "On-premise deployment option",
        "Advanced security & compliance (SOC2)",
        "Custom integrations & webhooks",
        "White-label option available",
        "99.9% uptime SLA guaranteed",
      ],
    },
    {
      id: "business_large_annual",
      name: "Business Large",
      price: 4999.9,
      monthlyEquivalent: 416.66,
      savings: "Save €999.98/year",
      currency: "EUR",
      billing: "annual",
      category: "business",
      limits: PLAN_LIMITS.business_large,
      features: [
        "Up to 100 team members",
        "Unlimited AI conversations",
        "Unlimited web searches & images",
        "Enterprise API with dedicated infrastructure",
        "Full team management with RBAC",
        "24/7 dedicated support with SLA",
        "Custom AI model fine-tuning",
        "On-premise deployment option",
        "Advanced security & compliance (SOC2)",
        "Custom integrations & webhooks",
        "White-label option available",
        "99.9% uptime SLA guaranteed",
      ],
    },
    // ═══════════════════════════════════════════════════
    // DEVELOPER PLANS
    // ═══════════════════════════════════════════════════
    {
      id: "developer_free",
      name: "Developer Free",
      price: 0,
      currency: "EUR",
      billing: "monthly",
      category: "developer",
      limits: PLAN_LIMITS.developer_free,
      features: [
        "1,000 API calls per month",
        "10 requests per second rate limit",
        "REST API access",
        "API key management",
        "Basic documentation & examples",
        "Community support on Discord",
      ],
    },
    {
      id: "developer_pro",
      name: "Developer Pro",
      price: 29.99,
      currency: "EUR",
      billing: "monthly",
      category: "developer",
      limits: PLAN_LIMITS.developer_pro,
      features: [
        "50,000 API calls per month",
        "100 requests per second rate limit",
        "REST & WebSocket API access",
        "Multiple API keys (up to 10)",
        "Full SDK (JavaScript, Python, cURL)",
        "Webhook notifications",
        "Usage dashboard & analytics",
        "Priority developer support",
      ],
    },
    {
      id: "developer_pro_annual",
      name: "Developer Pro",
      price: 299.9,
      monthlyEquivalent: 24.99,
      savings: "Save €59.98/year",
      currency: "EUR",
      billing: "annual",
      category: "developer",
      limits: PLAN_LIMITS.developer_pro,
      features: [
        "50,000 API calls per month",
        "100 requests per second rate limit",
        "REST & WebSocket API access",
        "Multiple API keys (up to 10)",
        "Full SDK (JavaScript, Python, cURL)",
        "Webhook notifications",
        "Usage dashboard & analytics",
        "Priority developer support",
      ],
    },
    {
      id: "developer_enterprise",
      name: "Developer Enterprise",
      price: 199.99,
      currency: "EUR",
      billing: "monthly",
      category: "developer",
      limits: PLAN_LIMITS.developer_enterprise,
      features: [
        "Unlimited API calls",
        "1,000 requests per second rate limit",
        "REST, WebSocket & gRPC API access",
        "Unlimited API keys",
        "Full SDK with enterprise support",
        "Custom model endpoints",
        "Dedicated API infrastructure",
        "24/7 developer support with SLA",
        "Custom webhook integrations",
        "IP whitelisting & advanced security",
      ],
    },
  ];

  // Filter by category and billing period
  const category = req.query.category || "all"; // "personal" | "business" | "developer" | "all"
  let plans = allPlans;

  if (category === "personal") {
    plans = plans.filter((p) => !p.category || p.category === "personal");
  } else if (category === "business") {
    plans = plans.filter((p) => p.category === "business");
  } else if (category === "developer") {
    plans = plans.filter((p) => p.category === "developer");
  }

  if (billing === "monthly") {
    plans = plans.filter((p) => p.billing === "monthly");
  } else if (billing === "annual") {
    plans = plans.filter((p) => p.billing === "annual" || p.price === 0);
  } else if (billing === "semiannual") {
    plans = plans.filter((p) => p.billing === "semiannual" || p.price === 0);
  }

  res.json({ plans });
});

// GET /api/payments/status — current user plan & usage
router.get("/status", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ plan: "guest", limits: PLAN_LIMITS.guest });

    const planInfo = await getUserPlan(user.id, supabaseAdmin);

    // Get today's usage
    const today = new Date().toISOString().split("T")[0];
    const usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("usage")
          .select("type, count")
          .eq("user_id", user.id)
          .eq("date", today);
        if (data)
          data.forEach((d) => {
            usage[d.type] = d.count;
          });
      } catch (e) {
        logger.warn(
          { component: "Payments", err: e.message },
          "Usage read failed",
        );
      }
    }

    res.json({ ...planInfo, usage });
  } catch {
    res.status(500).json({ error: "Plan status error" });
  }
});

// POST /api/payments/checkout — create Stripe checkout session
router.post("/checkout", async (req, res) => {
  try {
    if (!stripe)
      return res.status(503).json({ error: "Payments service unavailable" });

    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user)
      return res.status(401).json({ error: "Authentication required" });

    const { plan, referral_code } = req.body;
    // Normalize plan IDs: enterprise→premium, support annual variants
    const isAnnual = plan?.endsWith("_annual");
    const basePlan = plan?.replace("_annual", "");
    const normalizedPlan = basePlan === "enterprise" ? "premium" : basePlan;
    if (!["pro", "premium"].includes(normalizedPlan))
      return res.status(400).json({ error: "Invalid plan" });

    // Bug #5: Check if user already has an active subscription
    if (supabaseAdmin) {
      const { data: existingSub } = await supabaseAdmin
        .from("subscriptions")
        .select("plan, status, stripe_subscription_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();
      if (existingSub && existingSub.stripe_subscription_id) {
        return res.status(400).json({
          error:
            "You already have an active subscription. Use the billing portal to change plans.",
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

    // Select correct Stripe price ID (monthly vs annual)
    let priceId;
    if (normalizedPlan === "pro" && isAnnual) {
      priceId = process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
    } else if (normalizedPlan === "pro") {
      priceId = process.env.STRIPE_PRO_PRICE_ID || process.env.STRIPE_PRICE_PRO;
    } else if (normalizedPlan === "premium" && isAnnual) {
      priceId = process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID;
    } else {
      priceId =
        process.env.STRIPE_PREMIUM_PRICE_ID ||
        process.env.STRIPE_ENTERPRISE_PRICE_ID ||
        process.env.STRIPE_PRICE_PREMIUM;
    }
    if (!priceId)
      return res.status(503).json({ error: "Prices not configured" });

    // Check if user already has a Stripe customer ID
    let customerId;
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .single();
      customerId = data?.stripe_customer_id;
    }

    const sessionParams = {
      mode: "subscription",
      // Let Stripe auto-select best payment methods for customer's location
      // Supports: Cards, SEPA, Bancontact, iDEAL, Google Pay, Apple Pay, etc.
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.APP_URL + "/?payment=success",
      cancel_url: process.env.APP_URL + "/?payment=cancel",
      metadata: {
        user_id: user.id,
        plan: normalizedPlan,
        ...(verifiedReferralCode
          ? { referral_code: verifiedReferralCode }
          : {}),
      },
      subscription_data: {
        metadata: { user_id: user.id, plan: normalizedPlan },
      },
      // Subscriptions auto-generate invoices — enable email receipts in Stripe Dashboard
      // Settings → Emails → "Email customers for successful payments"
      allow_promotion_codes: true,
    };

    if (customerId) sessionParams.customer = customerId;
    else sessionParams.customer_email = user.email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    logger.error(
      {
        component: "Payments",
        err: e.message,
        stack: e.stack,
        type: e.type,
        code: e.code,
      },
      "Checkout error",
    );
    res.status(500).json({ error: "Checkout error", detail: e.message });
  }
});

// POST /api/payments/portal — Stripe billing portal (manage subscription)
router.post("/portal", async (req, res) => {
  try {
    if (!stripe)
      return res.status(503).json({ error: "Payments service unavailable" });

    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (!data?.stripe_customer_id)
      return res.status(404).json({ error: "No active subscription found" });

    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: process.env.APP_URL + "/",
    });

    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: "Portal error" });
  }
});

// POST /api/payments/webhook — Stripe webhook handler
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) return res.status(503).send("Stripe not configured");

      const sig = req.headers["stripe-signature"];
      const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!sig || !endpointSecret) {
        logger.warn({ component: "Payments" }, "Webhook signature missing");
        return res.status(400).json({ error: "Webhook signature missing" });
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
      } catch (e) {
        logger.warn(
          { component: "Payments", err: e.message },
          "Webhook signature verification failed",
        );
        return res
          .status(400)
          .json({ error: "Webhook signature verification failed" });
      }

      const { supabaseAdmin } = req.app.locals;
      if (!supabaseAdmin) return res.status(503).send("DB not available");

      // Idempotency check — check DB first (survives restarts), then in-memory cache
      if (processedWebhookEvents.has(event.id)) {
        logger.info(
          { component: "Payments", eventId: event.id },
          "Duplicate webhook event skipped (cache)",
        );
        return res.json({ received: true });
      }
      // Check persistent DB record
      try {
        const { data: existingEvent } = await supabaseAdmin
          .from("processed_webhook_events")
          .select("event_id")
          .eq("event_id", event.id)
          .single();
        if (existingEvent) {
          logger.info(
            { component: "Payments", eventId: event.id },
            "Duplicate webhook event skipped (DB)",
          );
          processedWebhookEvents.add(event.id);
          return res.json({ received: true });
        }
      } catch (e) {
        logger.debug(
          { component: "Payments", err: e.message },
          "processed_webhook_events check failed (table may not exist yet)",
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
        await supabaseAdmin
          .from("processed_webhook_events")
          .insert({ event_id: event.id, event_type: event.type });
      } catch (e) {
        logger.debug(
          { component: "Payments", err: e.message },
          "processed_webhook_events insert failed (table may not exist yet)",
        );
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const userId = session.metadata?.user_id;
          const plan = session.metadata?.plan;
          if (!userId || !plan) break;

          const subscription = await stripe.subscriptions.retrieve(
            session.subscription,
          );

          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              plan,
              status: "active",
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              current_period_start: new Date(
                subscription.current_period_start * 1000,
              ).toISOString(),
              current_period_end: new Date(
                subscription.current_period_end * 1000,
              ).toISOString(),
            },
            { onConflict: "user_id" },
          );

          logger.info(
            { component: "Payments", plan, userId },
            `✅ ${plan} activated for ${userId}`,
          );

          // Apply referral bonus if present
          const referralCode = session.metadata?.referral_code;
          if (referralCode) {
            const { applyReferralBonus } = getReferralModule();
            await applyReferralBonus(referralCode, userId, supabaseAdmin);
          }
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object;
          let userId = sub.metadata?.user_id;

          // Fallback: lookup by stripe_subscription_id if metadata missing
          if (!userId) {
            const { data: existingSub } = await supabaseAdmin
              .from("subscriptions")
              .select("user_id")
              .eq("stripe_subscription_id", sub.id)
              .single();
            userId = existingSub?.user_id;
          }
          if (!userId) break;

          await supabaseAdmin
            .from("subscriptions")
            .update({
              status: sub.status === "active" ? "active" : "inactive",
              current_period_end: new Date(
                sub.current_period_end * 1000,
              ).toISOString(),
            })
            .eq("stripe_subscription_id", sub.id);

          logger.info(
            { component: "Payments", subId: sub.id, status: sub.status },
            `Updated sub ${sub.id} → ${sub.status}`,
          );
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object;
          await supabaseAdmin
            .from("subscriptions")
            .update({ status: "cancelled", plan: "free" })
            .eq("stripe_subscription_id", sub.id);

          logger.info(
            { component: "Payments", subId: sub.id },
            `❌ Sub cancelled: ${sub.id}`,
          );
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;
          const subId = invoice.subscription;
          if (subId) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ status: "past_due" })
              .eq("stripe_subscription_id", subId);
          }
          logger.warn(
            { component: "Payments", subId },
            `⚠️ Payment failed for sub: ${subId}`,
          );
          break;
        }
      }

      res.json({ received: true });
    } catch (e) {
      logger.error({ component: "Payments", err: e.message }, "Webhook error");
      res.status(500).send("Webhook error");
    }
  },
);

// POST /api/payments/referral — generate referral code
router.post("/referral", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    // Check if user already has a referral code
    const { data: existing } = await supabaseAdmin
      .from("referrals")
      .select("code")
      .eq("user_id", user.id)
      .single();

    if (existing) return res.json({ code: existing.code });

    const code = generateReferralCode();
    await supabaseAdmin.from("referrals").insert({ user_id: user.id, code });

    res.json({ code });
  } catch {
    res.status(500).json({ error: "Referral error" });
  }
});

// POST /api/payments/redeem — redeem referral code (7 days Pro for both)
router.post("/redeem", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code is required" });

    const { data: referral } = await supabaseAdmin
      .from("referrals")
      .select("user_id, code, redeemed_by")
      .eq("code", code.toUpperCase())
      .single();

    if (!referral) return res.status(404).json({ error: "Invalid code" });
    if (referral.user_id === user.id)
      return res
        .status(400)
        .json({ error: "You cannot use your own referral code" });
    if (referral.redeemed_by && referral.redeemed_by.includes(user.id)) {
      return res.status(400).json({ error: "Code already used" });
    }

    const proEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Give Pro to redeemer
    await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: user.id,
        plan: "pro",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: proEnd,
        source: "referral",
      },
      { onConflict: "user_id" },
    );

    // Give Pro to referrer
    await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: referral.user_id,
        plan: "pro",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: proEnd,
        source: "referral",
      },
      { onConflict: "user_id" },
    );

    // Track redemption
    const redeemed = referral.redeemed_by || [];
    redeemed.push(user.id);
    await supabaseAdmin
      .from("referrals")
      .update({ redeemed_by: redeemed })
      .eq("code", code.toUpperCase());

    res.json({
      success: true,
      message: "7 days Pro activated for you and your friend!",
    });
  } catch {
    res.status(500).json({ error: "Redeem error" });
  }
});

// ═══ DEVELOPER API KEY MANAGEMENT ═══

// POST /api/payments/developer/keys — generate a new API key
router.post("/developer/keys", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user)
      return res.status(401).json({ error: "Authentication required" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { name, scopes } = req.body;
    if (!name) return res.status(400).json({ error: "Key name is required" });

    // Check user's developer plan for key limits
    const planInfo = await getUserPlan(user.id, supabaseAdmin);
    const plan = planInfo.plan || "free";
    const limits = {
      free: 1,
      developer_free: 1,
      developer_pro: 10,
      developer_enterprise: -1,
    };
    const maxKeys = limits[plan] || 1;

    // Count existing active keys
    const { data: existingKeys } = await supabaseAdmin
      .from("developer_keys")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (maxKeys !== -1 && (existingKeys || []).length >= maxKeys) {
      return res.status(403).json({
        error: `Key limit reached (${maxKeys}). Upgrade your developer plan for more keys.`,
        limit: maxKeys,
        current: (existingKeys || []).length,
      });
    }

    // Generate secure API key
    const crypto = require("crypto");
    const keyValue = "kelion_" + crypto.randomBytes(32).toString("hex");
    const keyHash = crypto.createHash("sha256").update(keyValue).digest("hex");

    const { data: newKey, error } = await supabaseAdmin
      .from("developer_keys")
      .insert({
        user_id: user.id,
        name: name.substring(0, 50),
        key_hash: keyHash,
        key_prefix: keyValue.substring(0, 12) + "...",
        scopes: scopes || ["chat", "search", "image"],
        status: "active",
        created_at: new Date().toISOString(),
        last_used_at: null,
        usage_count: 0,
      })
      .select("id, name, key_prefix, scopes, status, created_at")
      .single();

    if (error) throw error;

    // Return full key ONLY on creation (never shown again)
    res.json({
      key: keyValue,
      id: newKey.id,
      name: newKey.name,
      prefix: newKey.key_prefix,
      scopes: newKey.scopes,
      warning: "Save this key now. It will not be shown again.",
    });

    logger.info(
      { component: "Developer", userId: user.id },
      `🔑 New API key created: ${name}`,
    );
  } catch (e) {
    logger.error(
      { component: "Developer", err: e.message },
      "Key generation error",
    );
    res.status(500).json({ error: "Key generation failed" });
  }
});

// GET /api/payments/developer/keys — list user's API keys
router.get("/developer/keys", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user)
      return res.status(401).json({ error: "Authentication required" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { data: keys } = await supabaseAdmin
      .from("developer_keys")
      .select(
        "id, name, key_prefix, scopes, status, created_at, last_used_at, usage_count",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    res.json({ keys: keys || [] });
  } catch {
    res.status(500).json({ error: "Failed to list keys" });
  }
});

// DELETE /api/payments/developer/keys/:id — revoke an API key
router.delete("/developer/keys/:id", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user)
      return res.status(401).json({ error: "Authentication required" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { error } = await supabaseAdmin
      .from("developer_keys")
      .update({ status: "revoked" })
      .eq("id", req.params.id)
      .eq("user_id", user.id);

    if (error) throw error;

    logger.info(
      { component: "Developer", userId: user.id },
      `🔑 API key revoked: ${req.params.id}`,
    );
    res.json({ success: true, message: "API key revoked successfully" });
  } catch {
    res.status(500).json({ error: "Failed to revoke key" });
  }
});

// GET /api/payments/usage — alias for /status (for frontend compatibility)
router.get("/usage", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ plan: "guest", limits: PLAN_LIMITS.guest });
    const planInfo = await getUserPlan(user.id, supabaseAdmin);
    const today = new Date().toISOString().split("T")[0];
    const usage = { chat: 0, search: 0, image: 0, vision: 0, tts: 0 };
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("usage")
          .select("type, count")
          .eq("user_id", user.id)
          .eq("date", today);
        if (data)
          data.forEach((d) => {
            usage[d.type] = d.count;
          });
      } catch { /* ignored */ }
    }
    res.json({ ...planInfo, usage });
  } catch {
    res.status(500).json({ error: "Usage error" });
  }
});

module.exports = {
  router,
  getUserPlan,
  checkUsage,
  incrementUsage,
  PLAN_LIMITS,
};
