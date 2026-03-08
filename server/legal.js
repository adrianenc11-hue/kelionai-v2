// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — LEGAL (GDPR, Terms, Privacy)
// ═══════════════════════════════════════════════════════════════
const logger = require("./logger");
const express = require("express");
const router = express.Router();

// ═══ TERMS OF SERVICE ═══
router.get("/terms", (req, res) => {
  res.json({
    title: "Terms of Service — KelionAI",
    version: "1.0",
    effectiveDate: "2026-03-01",
    sections: [
      {
        title: "1. Service Description",
        content:
          "KelionAI is an AI assistant with accessible 3D avatars offering chat, search, image generation, visual analysis, and weather features. The service is available in Free, Pro (€9.99/month), and Premium (€19.99/month) plans.",
      },
      {
        title: "2. Accounts and Registration",
        content:
          "Full functionality requires creating an account. You are responsible for the security of your credentials. Accounts are personal and non-transferable.",
      },
      {
        title: "3. Acceptable Use",
        content:
          "The service may not be used for: illegal content, harassment, spam, manipulating the AI for harmful purposes, or violating the rights of others.",
      },
      {
        title: "4. Payments and Subscriptions",
        content:
          "Subscriptions are billed monthly through Stripe. You may cancel at any time from the billing portal. Refunds are subject to Stripe's refund policy.",
      },
      {
        title: "5. Limitation of Liability",
        content:
          'KelionAI provides AI-generated information that may contain errors. We do not guarantee accuracy or completeness. The service is provided "as is".',
      },
      {
        title: "6. Intellectual Property",
        content:
          "AI-generated content may be used according to your plan. KelionAI reserves all rights to the platform, codebase, and design.",
      },
      {
        title: "7. Modifications",
        content:
          "We reserve the right to modify these terms. Users will be notified via email 30 days in advance of any changes.",
      },
    ],
  });
});

// ═══ PRIVACY POLICY ═══
router.get("/privacy", (req, res) => {
  res.json({
    title: "Privacy Policy — KelionAI",
    version: "1.0",
    effectiveDate: "2026-03-01",
    sections: [
      {
        title: "1. Data Collected",
        content:
          "We collect: email address, name (optional), AI conversations, preferences, usage data, and payment data processed by Stripe.",
      },
      {
        title: "2. Purpose of Processing",
        content:
          "Service delivery, personalization (AI memory), billing, quality improvement, and service communications.",
      },
      {
        title: "3. Legal Basis (GDPR Art. 6)",
        content:
          "Consent (AI memory), contract performance (service delivery), legitimate interest (quality improvement).",
      },
      {
        title: "4. Data Storage",
        content:
          "Supabase servers (EU) and Railway infrastructure. Conversations are encrypted via TLS in transit and at rest. Payments are handled exclusively by Stripe.",
      },
      {
        title: "5. Data Sharing",
        content:
          "Google/OpenAI (AI processing), ElevenLabs (text-to-speech), Stripe (payments), Supabase (storage). We never sell personal data.",
      },
      {
        title: "6. Your Rights (GDPR)",
        content:
          `Access, rectification, erasure, portability, restriction, and objection. Contact: privacy@${(process.env.APP_URL || '').replace('https://', '')}.`,
      },
      {
        title: "7. Data Retention",
        content:
          "Conversations: retained while account is active + 30 days. Payments: 5 years (tax obligations). On account deletion: data removed within 30 days.",
      },
      {
        title: "8. Cookies",
        content:
          "We use only essential cookies for authentication. Zero tracking or advertising cookies.",
      },
    ],
  });
});

// ═══ COOKIE POLICY ═══
router.get("/cookie-policy", (req, res) => {
  res.json({
    title: "Cookie Policy — KelionAI",
    version: "1.0",
    effectiveDate: "2026-03-01",
    sections: [
      {
        title: "1. What Are Cookies",
        content:
          "Cookies are small text files placed on your device when you visit a website. They help us provide essential functionality, remember your preferences, and improve your experience.",
      },
      {
        title: "2. Cookies We Use",
        content:
          "KelionAI uses only <strong>strictly necessary cookies</strong>: authentication session token (sb-access-token), language preference, theme preference (dark/light), and onboarding status. We do NOT use any advertising, tracking, or analytics cookies.",
      },
      {
        title: "3. Essential Cookies",
        content:
          "<strong>sb-access-token</strong> — Supabase authentication session (expires on logout). <strong>kelion_lang</strong> — Your preferred language (persistent). <strong>kelion_theme</strong> — Dark/light mode preference (persistent). <strong>kelion_onboarded</strong> — Whether you completed onboarding (persistent).",
      },
      {
        title: "4. Third-Party Cookies",
        content:
          "Stripe (payment processing) may place essential cookies during checkout. Google Fonts loads web fonts. No third-party tracking or advertising cookies are used.",
      },
      {
        title: "5. Cookie Consent",
        content:
          "Since we only use strictly necessary cookies (exempt under GDPR Art. 5(3) and ePrivacy Directive), explicit consent is not required. You can still disable cookies in your browser settings, but this may affect functionality.",
      },
      {
        title: "6. Managing Cookies",
        content:
          "You can delete or block cookies through your browser settings. Instructions: Chrome (Settings → Privacy → Cookies), Firefox (Options → Privacy), Safari (Preferences → Privacy). Disabling authentication cookies will require you to log in again.",
      },
      {
        title: "7. Changes to This Policy",
        content:
          "We may update this Cookie Policy. Changes will be posted on this page with an updated effective date.",
      },
      {
        title: "8. Contact",
        content:
          `Questions about cookies? Contact us at privacy@${(process.env.APP_URL || '').replace('https://', '')}.`,
      },
    ],
  });
});

// ═══ GDPR: EXPORT ALL USER DATA ═══
router.get("/gdpr/export", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const [conversations, preferences, subscription, usage, referrals] =
      await Promise.all([
        supabaseAdmin
          .from("conversations")
          .select("id, avatar, title, created_at")
          .eq("user_id", user.id),
        supabaseAdmin
          .from("user_preferences")
          .select("key, value, updated_at")
          .eq("user_id", user.id),
        supabaseAdmin
          .from("subscriptions")
          .select("plan, status, current_period_start, current_period_end")
          .eq("user_id", user.id),
        supabaseAdmin
          .from("usage")
          .select("type, count, date")
          .eq("user_id", user.id),
        supabaseAdmin
          .from("referrals")
          .select("code, created_at")
          .eq("user_id", user.id),
      ]);

    // Get messages for each conversation
    let allMessages = [];
    if (conversations.data?.length) {
      const convIds = conversations.data.map((c) => c.id);
      const { data: msgs } = await supabaseAdmin
        .from("messages")
        .select("conversation_id, role, content, language, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true });
      allMessages = msgs || [];
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      format: "GDPR Data Export — KelionAI",
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || null,
        created: user.created_at,
      },
      conversations: conversations.data || [],
      messages: allMessages,
      preferences: preferences.data || [],
      subscription: subscription.data || [],
      usage: usage.data || [],
      referrals: referrals.data || [],
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="kelionai-export-${user.id}.json"`,
    );
    res.json(exportData);
  } catch (e) {
    logger.error({ component: "Legal", err: e.message }, "GDPR Export");
    res.status(500).json({ error: "Data export error" });
  }
});

// ═══ GDPR: DELETE ALL USER DATA ═══
router.delete("/gdpr/delete", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { confirm } = req.body;
    if (confirm !== "DELETE_MY_DATA") {
      return res.status(400).json({
        error: 'Send { "confirm": "DELETE_MY_DATA" } to confirm',
        warning:
          "This action is IRREVERSIBLE. All conversations, preferences and data will be deleted.",
      });
    }

    // Cancel Stripe subscription if active
    try {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("stripe_subscription_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (sub?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      }
    } catch (e) {
      logger.warn(
        { component: "Legal", err: e.message },
        "subscription might not exist",
      );
    }

    // Delete all user data in order (respecting foreign keys)
    const convIds = [];
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("user_id", user.id);
    if (convs) convs.forEach((c) => convIds.push(c.id));

    if (convIds.length) {
      await supabaseAdmin
        .from("messages")
        .delete()
        .in("conversation_id", convIds);
    }
    await supabaseAdmin.from("conversations").delete().eq("user_id", user.id);
    await supabaseAdmin
      .from("user_preferences")
      .delete()
      .eq("user_id", user.id);
    await supabaseAdmin.from("subscriptions").delete().eq("user_id", user.id);
    await supabaseAdmin.from("usage").delete().eq("user_id", user.id);
    await supabaseAdmin.from("referrals").delete().eq("user_id", user.id);

    logger.info(
      { component: "Legal", userId: user.id },
      `🗑️ All data deleted for user ${user.id}`,
    );
    res.json({
      success: true,
      message: "All data deleted. Your account can be closed from settings.",
    });
  } catch (e) {
    logger.error({ component: "Legal", err: e.message }, "GDPR Delete");
    res.status(500).json({ error: "Data deletion error" });
  }
});

// ═══ GDPR: CONSENT STATUS ═══
router.get("/gdpr/consent", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin) return res.json({ consents: {} });

    const { data } = await supabaseAdmin
      .from("user_preferences")
      .select("key, value")
      .eq("user_id", user.id)
      .like("key", "consent_%");

    const consents = {};
    (data || []).forEach((d) => {
      consents[d.key.replace("consent_", "")] = d.value;
    });

    res.json({ consents });
  } catch {
    res.status(500).json({ error: "Consent error" });
  }
});

// ═══ GDPR: UPDATE CONSENT ═══
router.post("/gdpr/consent", async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!supabaseAdmin)
      return res.status(503).json({ error: "Database unavailable" });

    const { type, granted } = req.body;
    const validTypes = ["memory", "analytics", "marketing"];
    if (!validTypes.includes(type)) {
      return res
        .status(400)
        .json({ error: `Valid types: ${validTypes.join(", ")}` });
    }

    await supabaseAdmin.from("user_preferences").upsert(
      {
        user_id: user.id,
        key: `consent_${type}`,
        value: { granted: !!granted, timestamp: new Date().toISOString() },
      },
      { onConflict: "user_id,key" },
    );

    res.json({ success: true, type, granted: !!granted });
  } catch {
    res.status(500).json({ error: "Consent update error" });
  }
});

module.exports = router;
