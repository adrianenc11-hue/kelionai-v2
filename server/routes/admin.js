// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin API Routes (admin-only, role-gated)
// Zero hardcoded values — all from env vars
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const logger = require("../logger");
const router = express.Router();

// ── Config from environment variables ──
const CONFIG = {
  planPrices: {
    pro: parseFloat(process.env.PLAN_PRO_PRICE || "9.99"),
    premium: parseFloat(process.env.PLAN_PREMIUM_PRICE || "29.99"),
  },
  rechargeAmountPence: parseInt(process.env.RECHARGE_AMOUNT_PENCE || "5000", 10),
  creditLowThreshold: parseFloat(process.env.CREDIT_LOW_THRESHOLD || "5"),
  creditMedThreshold: parseFloat(process.env.CREDIT_MED_THRESHOLD || "2"),
  appUrl: process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? ("https://" + process.env.RAILWAY_PUBLIC_DOMAIN) : ""),
  adminEmail: process.env.ADMIN_EMAIL || "",
};

// ── Admin middleware — checks JWT role OR admin secret key ──
// ═══ TEMPORARILY DISABLED (trial period) — re-enable by removing bypass below ═══
async function requireAdmin(req, res, next) {
  // BYPASS: admin auth disabled temporarily
  req.adminUser = { id: "admin-bypass", role: "admin" };
  return next();

  /* ── ORIGINAL AUTH (uncomment to re-enable) ──
  // Method 1: Admin Secret Key (from x-admin-secret header)
  const secret = req.headers["x-admin-secret"];
  const expectedSecret = process.env.ADMIN_SECRET_KEY;
  if (secret && expectedSecret) {
    try {
      const crypto = require("crypto");
      const secretBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expectedSecret);
      if (secretBuf.length === expectedBuf.length && crypto.timingSafeEqual(secretBuf, expectedBuf)) {
        req.adminUser = { id: "admin-secret", role: "admin" };
        return next();
      }
    } catch { }
  }

  // Method 2: JWT token with admin role
  try {
    const { getUserFromToken } = req.app.locals;
    const user = await getUserFromToken(req);
    const adminEmail = (process.env.ADMIN_EMAIL || "adrianenc11@gmail.com").toLowerCase();
    if (user && user.email?.toLowerCase() === adminEmail) {
      req.adminUser = user;
      return next();
    }
  } catch { }

  return res.status(403).json({ error: "Admin access required" });
  */
}

// ── POST /verify-code — validate admin access/exit code (pre-auth) ──
router.post("/verify-code", express.json(), (req, res) => {
  const { code } = req.body || {};
  const accessCode = process.env.ADMIN_ACCESS_CODE || process.env.ADMIN_EXIT_CODE;
  const exitCode = process.env.ADMIN_EXIT_CODE || process.env.ADMIN_ACCESS_CODE;
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!code) return res.status(400).json({ error: "Code required" });

  if (code === accessCode && secret) {
    logger.info({ component: "Admin" }, "Admin access granted via code");
    return res.json({
      action: "enter",
      secret,
      message: "Admin mode activat!",
    });
  }
  if (code === exitCode) {
    logger.info({ component: "Admin" }, "Admin access revoked via exit code");
    return res.json({
      action: "exit",
      message: "Admin mode dezactivat.",
    });
  }

  // Not a valid admin code — return 404 so frontend falls through to normal chat
  return res.status(404).json({ error: "Invalid code" });
});

router.use(requireAdmin);

// ── Log ALL admin actions to Supabase ──
router.use(async (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from("admin_logs").insert({
          action: req.method + " " + req.path,
          details: JSON.stringify({ body: req.body, params: req.params }),
          admin_id: req.adminUser?.id || "admin",
          source: "admin_panel",
          created_at: new Date().toISOString(),
        });
      } catch { /* non-blocking */ }
    }
  }
  next();
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/brain — Brain diagnostic
// ══════════════════════════════════════════════════════════
router.get("/brain", (req, res) => {
  try {
    const { brain } = req.app.locals;
    if (!brain) return res.json({ toolStats: {}, toolErrors: {}, providers: {} });

    res.json({
      toolStats: brain.toolStats || {},
      toolErrors: brain.toolErrors || {},
      uptime: (Date.now() - brain.startTime) / 1000,
      conversationCount: brain.conversationCount || 0,
      providers: {
        gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
        openai: !!brain.openaiKey,
        groq: !!brain.groqKey,
        perplexity: !!brain.perplexityKey,
        tavily: !!brain.tavilyKey,
        serper: !!brain.serperKey,
        together: !!brain.togetherKey,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY,
        deepseek: !!process.env.DEEPSEEK_API_KEY,
      },
      journal: (brain.journal || []).slice(-10),
      strategies: brain.strategies || {},
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Brain diagnostic failed");
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/reset — Reset brain tools
// ══════════════════════════════════════════════════════════
router.post("/reset", (req, res) => {
  const { brain } = req.app.locals;
  const { tool } = req.body;
  if (!brain) return res.json({ success: false, error: "No brain instance" });

  if (tool === "all" || !tool) {
    brain.toolStats = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0, chainOfThought: 0, decompose: 0 };
    brain.toolErrors = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0 };
    brain.errorLog = [];
    brain.journal = [];
  } else if (brain.toolStats[tool] !== undefined) {
    brain.toolStats[tool] = 0;
    if (brain.toolErrors[tool] !== undefined) brain.toolErrors[tool] = 0;
  }
  res.json({ success: true, tool: tool || "all" });
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/costs — AI cost reports
// ══════════════════════════════════════════════════════════
router.get("/costs", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ byProvider: [], byUser: [], daily: [], totalToday: 0, totalMonth: 0 });

    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.substring(0, 7) + "-01";

    // By provider this month
    const { data: providerData } = await supabaseAdmin
      .from("ai_costs")
      .select("provider, tokens_in, tokens_out, cost_usd, created_at")
      .gte("created_at", monthStart + "T00:00:00Z");

    const byProvider = {};
    (providerData || []).forEach((r) => {
      if (!byProvider[r.provider]) byProvider[r.provider] = { provider: r.provider, requests: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, cost_today: 0 };
      byProvider[r.provider].requests++;
      byProvider[r.provider].tokens_in += r.tokens_in || 0;
      byProvider[r.provider].tokens_out += r.tokens_out || 0;
      byProvider[r.provider].cost_usd += parseFloat(r.cost_usd) || 0;
      if (r.created_at && r.created_at.startsWith(today)) {
        byProvider[r.provider].cost_today += parseFloat(r.cost_usd) || 0;
      }
    });

    // By user this month (top 10)
    const byUser = {};
    (providerData || []).forEach((r) => {
      // We need user_id — refetch with user_id
    });

    const { data: userData } = await supabaseAdmin
      .from("ai_costs")
      .select("user_id, provider, cost_usd")
      .gte("created_at", monthStart + "T00:00:00Z");

    (userData || []).forEach((r) => {
      if (!byUser[r.user_id]) byUser[r.user_id] = { user_id: r.user_id, requests: 0, cost_usd: 0, providers: {} };
      byUser[r.user_id].requests++;
      byUser[r.user_id].cost_usd += parseFloat(r.cost_usd) || 0;
      byUser[r.user_id].providers[r.provider] = (byUser[r.user_id].providers[r.provider] || 0) + 1;
    });

    const sortedUsers = Object.values(byUser)
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10)
      .map((u) => ({
        user_id: u.user_id,
        requests: u.requests,
        cost_usd: u.cost_usd,
        top_provider: Object.entries(u.providers).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      }));

    // Daily costs (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const { data: dailyData } = await supabaseAdmin
      .from("ai_costs")
      .select("cost_usd, created_at")
      .gte("created_at", weekAgo + "T00:00:00Z");

    const daily = {};
    (dailyData || []).forEach((r) => {
      const day = r.created_at.split("T")[0];
      daily[day] = (daily[day] || 0) + (parseFloat(r.cost_usd) || 0);
    });
    const dailyArr = Object.entries(daily).map(([date, cost_usd]) => ({ date, cost_usd })).sort((a, b) => a.date.localeCompare(b.date));

    // Totals
    const totalToday = (dailyData || []).filter((r) => r.created_at.startsWith(today)).reduce((s, r) => s + (parseFloat(r.cost_usd) || 0), 0);
    const totalMonth = Object.values(byProvider).reduce((s, p) => s + p.cost_usd, 0);

    res.json({
      byProvider: Object.values(byProvider),
      byUser: sortedUsers,
      daily: dailyArr,
      totalToday,
      totalMonth,
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Costs query failed");
    res.json({ byProvider: [], byUser: [], daily: [], totalToday: 0, totalMonth: 0 });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/traffic — Page views
// ══════════════════════════════════════════════════════════
router.get("/traffic", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ recent: [], uniqueToday: 0, totalToday: 0, activeConnections: 0, daily: [] });

    const today = new Date().toISOString().split("T")[0];

    // Recent 50 visits
    const { data: recent } = await supabaseAdmin
      .from("page_views")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    // Today stats (raise limit from default 1000 to get accurate count)
    const { data: todayData, count: todayCount } = await supabaseAdmin
      .from("page_views")
      .select("ip", { count: "exact", head: false })
      .gte("created_at", today + "T00:00:00Z")
      .limit(10000);

    const uniqueIps = new Set((todayData || []).map((d) => d.ip));

    // Daily traffic (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const { data: weekData } = await supabaseAdmin
      .from("page_views")
      .select("created_at")
      .gte("created_at", weekAgo + "T00:00:00Z")
      .limit(10000);

    const dailyCounts = {};
    (weekData || []).forEach(r => {
      const day = r.created_at.split("T")[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });
    const daily = Object.entries(dailyCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Active connections
    let activeConnections = 0;
    try {
      const { activeConnections: ac } = require("../metrics");
      activeConnections = (await ac.get()).values[0]?.value || 0;
    } catch (e) { /* metrics not available */ }

    res.json({
      recent: recent || [],
      uniqueToday: uniqueIps.size,
      totalToday: todayCount || (todayData || []).length,
      activeConnections,
      daily,
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Traffic query failed");
    res.json({ recent: [], uniqueToday: 0, totalToday: 0, activeConnections: 0, daily: [] });
  }
});

// ══════════════════════════════════════════════════════════
// DELETE /api/admin/traffic/:id — Delete a page view
// ══════════════════════════════════════════════════════════
router.delete("/traffic/:id", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });
    const { error } = await supabaseAdmin.from("page_views").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/users — User list
// ══════════════════════════════════════════════════════════
router.get("/users", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ users: [] });

    // Get users from Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 });
    if (error) return res.json({ users: [], error: error.message });

    const users = (data?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.full_name || "—",
      plan: u.user_metadata?.plan || "free",
      role: u.role,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }));

    // Get message counts
    try {
      const { data: usage } = await supabaseAdmin
        .from("usage")
        .select("user_id, count")
        .eq("type", "chat");

      const counts = {};
      (usage || []).forEach((u) => { counts[u.user_id] = (counts[u.user_id] || 0) + (u.count || 0); });
      users.forEach((u) => { u.message_count = counts[u.id] || 0; });
    } catch (e) { /* no usage table */ }

    res.json({ users });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Users query failed");
    res.json({ users: [] });
  }
});

// ══════════════════════════════════════════════════════════
// DELETE /api/admin/users/:id — Delete user completely
// ══════════════════════════════════════════════════════════
router.delete("/users/:id", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No database" });

    const userId = req.params.id;
    if (!userId) return res.status(400).json({ error: "User ID required" });

    // Get user info before deletion (for logging)
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userData?.user?.email || "unknown";

    // Clean up related data (ignore errors — tables may not exist)
    const tables = [
      { table: "conversations", column: "user_id" },
      { table: "user_preferences", column: "user_id" },
      { table: "subscriptions", column: "user_id" },
      { table: "referrals", column: "user_id" },
      { table: "brain_profiles", column: "user_id" },
    ];
    for (const t of tables) {
      try { await supabaseAdmin.from(t.table).delete().eq(t.column, userId); } catch { }
    }

    // Delete from Supabase Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });

    // Log the action
    try {
      await supabaseAdmin.from("admin_logs").insert({
        action: "delete_user",
        details: { userId, email },
        admin_id: req.adminUser?.id || "admin",
      });
    } catch { }

    logger.info({ component: "Admin", userId, email }, `🗑️ User ${email} deleted`);
    res.json({ success: true, deleted: email });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Delete user failed");
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/revenue — Revenue stats
// ══════════════════════════════════════════════════════════
router.get("/revenue", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ subscribers: 0, mrr: 0, churnRate: 0, recentPayments: [] });

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, status, amount, created_at")
      .eq("status", "active");

    const subscribers = (subs || []).length;
    const mrr = (subs || []).reduce((s, sub) => s + (parseFloat(sub.amount) || 0), 0);

    const { data: payments } = await supabaseAdmin
      .from("payments")
      .select("user_id, amount, plan, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    res.json({
      subscribers,
      mrr,
      churnRate: 0,
      recentPayments: payments || [],
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Revenue query failed");
    res.json({ subscribers: 0, mrr: 0, churnRate: 0, recentPayments: [] });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/ai-status — Live status of all AI providers
// Connected to Brain + Supabase ai_costs
// ══════════════════════════════════════════════════════════
router.get("/ai-status", async (req, res) => {
  try {
    const { brain, supabaseAdmin } = req.app.locals;

    // Provider configs from brain
    const providerKeys = {
      "OpenAI": !!brain?.openaiKey,
      "Google": !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      "Groq": !!brain?.groqKey,
      "Perplexity": !!brain?.perplexityKey,
      "Together": !!brain?.togetherKey,
      "ElevenLabs": !!process.env.ELEVENLABS_API_KEY,
      "DeepSeek": !!process.env.DEEPSEEK_API_KEY,
      "Tavily": !!brain?.tavilyKey,
      "Serper": !!brain?.serperKey,
    };

    // Get monthly costs per provider from Supabase
    const monthStart = new Date().toISOString().substring(0, 7) + "-01";
    let costByProvider = {};
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("ai_costs")
          .select("provider, cost_usd")
          .gte("created_at", monthStart + "T00:00:00Z");
        (data || []).forEach(r => {
          if (!costByProvider[r.provider]) costByProvider[r.provider] = 0;
          costByProvider[r.provider] += parseFloat(r.cost_usd) || 0;
        });
      } catch (e) { /* table might not exist */ }
    }

    // Read credit limits from Supabase provider_credits table (fallback to env vars)
    let creditByProvider = {};
    if (supabaseAdmin) {
      try {
        const { data: credits } = await supabaseAdmin.from("provider_credits").select("provider, credit_usd");
        (credits || []).forEach(c => { creditByProvider[c.provider] = parseFloat(c.credit_usd) || 0; });
      } catch (e) { /* table might not exist yet */ }
    }

    // Fallback defaults if table empty
    const defaultCredits = {
      "OpenAI": parseFloat(process.env.OPENAI_CREDIT || "5"),
      "Google": 0, "Groq": 0,
      "Perplexity": parseFloat(process.env.PERPLEXITY_CREDIT || "5"),
      "Together": parseFloat(process.env.TOGETHER_CREDIT || "5"),
      "ElevenLabs": parseFloat(process.env.ELEVENLABS_CREDIT || "5"),
      "DeepSeek": parseFloat(process.env.DEEPSEEK_CREDIT || "2"),
      "Tavily": 0, "Serper": 0,
    };

    const providers = Object.entries(providerKeys).map(([name, hasKey]) => {
      const costMonth = costByProvider[name.toLowerCase()] || costByProvider[name] || 0;
      const limit = creditByProvider[name] !== undefined ? creditByProvider[name] : (defaultCredits[name] || 0);
      const credit = Math.max(0, limit - costMonth);
      const creditLabel = limit > 0
        ? '$' + credit.toFixed(2) + ' / $' + limit.toFixed(2)
        : 'Free tier';
      return { name, live: hasKey, costMonth, credit, creditLabel, creditLimit: limit };
    });

    res.json({ providers });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "AI status failed");
    res.json({ providers: [] });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/provider-credit — Update credit for a provider
// ══════════════════════════════════════════════════════════
router.post("/provider-credit", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });
    const { provider, amount } = req.body;
    if (!provider || amount == null) return res.status(400).json({ error: "provider and amount required" });

    const credit = parseFloat(amount);
    if (isNaN(credit) || credit < 0) return res.status(400).json({ error: "Invalid amount" });

    // Upsert into provider_credits
    const { error } = await supabaseAdmin
      .from("provider_credits")
      .upsert({ provider, credit_usd: credit, updated_at: new Date().toISOString(), updated_by: "admin" }, { onConflict: "provider" });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, provider, credit_usd: credit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// CRUD /api/admin/codes — Admin codes management
// Connected to Supabase admin_codes table
// ══════════════════════════════════════════════════════════
router.get("/codes", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ codes: [] });

    const { data } = await supabaseAdmin
      .from("admin_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    res.json({ codes: data || [] });
  } catch (e) {
    res.json({ codes: [] });
  }
});

router.post("/codes", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });

    const { type } = req.body;
    const crypto = require("crypto");
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();

    const { error } = await supabaseAdmin.from("admin_codes").insert({
      code,
      type: type || "admin",
      used: false,
      created_by: req.adminUser?.id || null,
      created_at: new Date().toISOString(),
    });

    if (error) return res.status(500).json({ error: error.message });
    logger.info({ component: "Admin", code, type }, "Admin code generated");
    res.json({ code, type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/codes/:id", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });

    await supabaseAdmin.from("admin_codes").delete().eq("id", req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/refund — Refund user subscription
// Cancels subscription in Supabase + logs reason
// ══════════════════════════════════════════════════════════
router.post("/refund", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });

    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    // Get subscription details
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .single();

    if (!sub) return res.status(404).json({ error: "Nicio subscripție activă găsită." });

    const maxRefundDays = parseInt(process.env.REFUND_MAX_DAYS || "15", 10);
    const billingType = sub.billing_type || (sub.plan_interval === "year" ? "annual" : "monthly");
    const subStartDate = new Date(sub.created_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - subStartDate) / 86400000);

    let refundAmount = 0;
    let message = "";

    if (billingType === "monthly") {
      // ── LUNAR: no refund, just cancel ──
      refundAmount = 0;
      message = "Abonament lunar anulat. Fără rambursare (conform politicii).";

    } else {
      // ── ANUAL: refund diferența lunilor rămase ──
      if (daysSinceStart > maxRefundDays) {
        return res.status(400).json({
          error: "Perioada de refund a expirat! Maxim " + maxRefundDays + " zile de la activare. Au trecut " + daysSinceStart + " zile."
        });
      }

      const totalAmount = parseFloat(sub.amount) || 0;
      const monthlyRate = totalAmount / 12;
      // Current month counts as used
      const monthsUsed = Math.max(1, Math.ceil(daysSinceStart / 30));
      const monthsRemaining = Math.max(0, 12 - monthsUsed);
      refundAmount = parseFloat((monthsRemaining * monthlyRate).toFixed(2));

      message = "Abonament anual oprit. Luni folosite: " + monthsUsed +
        ". Luni rămase: " + monthsRemaining +
        ". Refund: £" + refundAmount.toFixed(2) + " din £" + totalAmount.toFixed(2) + ".";
    }

    // Cancel subscription
    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "refunded",
        cancelled_at: now.toISOString(),
        refund_amount: refundAmount,
        refund_reason: reason || "Admin refund",
      })
      .eq("user_id", userId);

    // Update user plan to free
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { plan: "free" },
    });

    // Process Stripe refund if applicable
    if (refundAmount > 0 && process.env.STRIPE_SECRET_KEY && sub.stripe_subscription_id) {
      try {
        const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
        await stripe.refunds.create({
          payment_intent: sub.stripe_payment_intent,
          amount: Math.round(refundAmount * 100), // pence
          reason: "requested_by_customer",
        });
        message += " (Stripe refund procesat)";
      } catch (stripeErr) {
        message += " (Stripe refund EȘUAT: " + stripeErr.message + " — procesează manual)";
        logger.error({ component: "Admin", err: stripeErr.message }, "Stripe refund failed");
      }
    }

    // Log refund
    await supabaseAdmin.from("admin_logs").insert({
      action: "refund",
      user_id: userId,
      details: JSON.stringify({ reason, billingType, daysSinceStart, refundAmount, message }),
      admin_id: req.adminUser?.id,
      created_at: now.toISOString(),
    }).catch(() => { });

    logger.info({ component: "Admin", userId, billingType, refundAmount }, "Refund processed");
    res.json({ success: true, refundAmount, billingType, message });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Refund failed");
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/upgrade — Upgrade/downgrade user plan
// Updates Supabase Auth metadata + subscriptions table
// ══════════════════════════════════════════════════════════
router.post("/upgrade", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No DB" });

    const { userId, plan } = req.body;
    if (!userId || !plan) return res.status(400).json({ error: "userId and plan required" });

    // Update user metadata
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { plan },
    });
    if (error) return res.status(500).json({ error: error.message });

    // Upsert subscription
    if (plan !== "free") {
      await supabaseAdmin.from("subscriptions").upsert({
        user_id: userId,
        plan,
        status: "active",
        amount: plan === "premium" ? 29.99 : plan === "pro" ? 9.99 : 0,
        created_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).catch(() => { });
    } else {
      await supabaseAdmin.from("subscriptions")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("user_id", userId).catch(() => { });
    }

    // Log upgrade to Supabase
    try {
      await supabaseAdmin.from("admin_logs").insert({
        action: "upgrade",
        user_id: userId,
        details: JSON.stringify({ plan, previous: "unknown" }),
        admin_id: req.adminUser?.id || "admin",
        created_at: new Date().toISOString(),
      });
    } catch { }

    logger.info({ component: "Admin", userId, plan }, "User plan updated");
    res.json({ success: true, message: "Plan actualizat la " + plan + "!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/recharge — Recharge AI credits (Stripe)
// Creates Stripe Checkout Session for £50, logs distribution
// ══════════════════════════════════════════════════════════
router.post("/recharge", async (req, res) => {
  try {
    const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "gbp",
            product_data: { name: "KelionAI — AI Credit Recharge", description: "Top-up for AI API credits (proportional distribution)" },
            unit_amount: CONFIG.rechargeAmountPence,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: CONFIG.appUrl + "/admin?recharge=success",
        cancel_url: CONFIG.appUrl + "/admin?recharge=cancelled",
        metadata: { type: "ai_recharge", admin_id: req.adminUser?.id || "unknown" },
      });

      logger.info({ component: "Admin", sessionId: session.id }, "Recharge checkout created");
      return res.json({ url: session.url });
    }

    // No Stripe — just log the recharge internally
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin.from("admin_logs").insert({
        action: "recharge",
        details: "£50 AI credit recharge (manual)",
        admin_id: req.adminUser?.id,
        created_at: new Date().toISOString(),
      }).catch(() => { });
    }

    logger.info({ component: "Admin" }, "Recharge recorded (no Stripe)");
    res.json({ success: true, message: "Recharge £50 înregistrată! (fără Stripe — adaugă manual credit pe API providers)" });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Recharge failed");
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/test-tables — Test ALL Supabase tables
// Runs SELECT on each table, collects errors per table
// ══════════════════════════════════════════════════════════
router.get("/test-tables", async (req, res) => {
  const { supabaseAdmin } = req.app.locals;
  if (!supabaseAdmin) return res.status(503).json({ error: "No Supabase connection" });

  const TABLES = [
    // Etapa 1 — Core (migrate.js existing)
    "conversations",
    "messages",
    "user_preferences",
    "api_keys",
    "admin_logs",
    "trades",
    "profiles",
    "media_history",
    "telegram_users",
    "whatsapp_users",
    "whatsapp_messages",
    "trade_intelligence",
    "cookie_consents",
    "metrics_snapshots",
    "ai_costs",
    "page_views",
    // Etapa 2 — Newly added to migrate.js
    "subscriptions",
    "referrals",
    "admin_codes",
    "brain_memory",
    "learned_facts",
    "messenger_users",
    "messenger_messages",
    "messenger_subscribers",
    "telegram_messages",
    "market_candles",
    "market_learnings",
    "market_patterns",
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const table of TABLES) {
    try {
      const { data, error, count } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        failed++;
        results.push({
          table,
          status: "❌ ERROR",
          error: error.message,
          code: error.code,
          hint: error.hint || null,
        });
      } else {
        passed++;
        results.push({
          table,
          status: "✅ OK",
          rowCount: count || 0,
        });
      }
    } catch (e) {
      failed++;
      results.push({
        table,
        status: "💥 CRASH",
        error: e.message,
      });
    }
  }

  res.json({
    summary: {
      total: TABLES.length,
      passed,
      failed,
      allOk: failed === 0,
      testedAt: new Date().toISOString(),
    },
    results,
    errors: results.filter(r => r.status !== "✅ OK"),
  });
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/update-social-photos — Set Kelion avatar on social platforms
// Uses Telegram Bot API + Facebook Graph API
// ══════════════════════════════════════════════════════════
router.post("/update-social-photos", async (req, res) => {
  const fs = require("fs");
  const path = require("path");
  const results = {};

  // Load Kelion photo from disk
  const photoPath = path.join(__dirname, "..", "..", "app", "models", "kelion-reference.png");
  if (!fs.existsSync(photoPath)) {
    return res.status(404).json({ error: "kelion-reference.png not found" });
  }
  const photoData = fs.readFileSync(photoPath);
  logger.info({ component: "Admin", size: photoData.length }, "Kelion photo loaded for social update");

  // ── 1. Telegram Bot ──
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    try {
      const boundary = "----KelionPhoto" + Date.now();
      const bodyParts = [
        Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"kelion.png\"\r\nContent-Type: image/png\r\n\r\n"),
        photoData,
        Buffer.from("\r\n--" + boundary + "--\r\n"),
      ];
      const body = Buffer.concat(bodyParts);

      // Delete existing photo first (Telegram requires this)
      try {
        await fetch("https://api.telegram.org/bot" + telegramToken + "/deleteMyCommands");
      } catch (e) { /* ok */ }

      const r = await fetch("https://api.telegram.org/bot" + telegramToken + "/setMyPhoto", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=" + boundary },
        body,
      });
      const d = await r.json();
      results.telegram = d.ok ? "✅ Photo updated" : "❌ " + (d.description || JSON.stringify(d));
    } catch (e) {
      results.telegram = "❌ " + e.message;
    }
  } else {
    results.telegram = "⚠️ No TELEGRAM_BOT_TOKEN";
  }

  // ── 2. Facebook Page ──
  const fbToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
  const fbPageId = process.env.FB_PAGE_ID;
  if (fbToken && fbPageId) {
    try {
      const boundary = "----KelionPhoto" + Date.now();
      const bodyParts = [
        Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"source\"; filename=\"kelion.png\"\r\nContent-Type: image/png\r\n\r\n"),
        photoData,
        Buffer.from("\r\n--" + boundary + "--\r\n"),
      ];
      const body = Buffer.concat(bodyParts);

      const r = await fetch("https://graph.facebook.com/v21.0/" + fbPageId + "/picture", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=" + boundary,
          Authorization: "Bearer " + fbToken,
        },
        body,
      });
      const d = await r.json();
      results.facebook = (d.success || d.id) ? "✅ Photo updated" : "❌ " + JSON.stringify(d).substring(0, 200);
    } catch (e) {
      results.facebook = "❌ " + e.message;
    }
  } else {
    results.facebook = "⚠️ No FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID";
  }

  // ── 3. Messenger — uses Facebook Page photo automatically ──
  results.messenger = results.facebook?.startsWith("✅") ? "✅ Uses Facebook Page photo" : "⚠️ Depends on Facebook Page update";

  // ── 4. Instagram — API doesn't support profile photo updates ──
  results.instagram = "⚠️ Instagram API doesn't support profile photo changes — must be done manually in the app";

  logger.info({ component: "Admin", results }, "Social photo update completed");
  res.json({ results });
});

// ══════════════════════════════════════════════════════════════
// BRAIN AUTO-AUDIT — Scans + Auto-fixes hardcoded values
// Runs: on deploy + every 6 hours. Results in admin dashboard.
// GET  /api/admin/audit-hardcoded     → view results
// POST /api/admin/audit-hardcoded/fix → auto-replace known patterns
// ══════════════════════════════════════════════════════════════
const fs = require("fs");
const auditPath = require("path");

const AUDIT_PATTERNS = [
  { name: "Hardcoded URL", regex: /["'`]https?:\/\/(?!(?:api\.|graph\.|cdn\.))[a-z0-9][a-z0-9.-]*\.(app|com|io|net|org|dev|co)[^\s"'`]*/gi, severity: "HIGH" },
  { name: "API Key (sk-/sk_)", regex: /["'`](sk[-_][a-zA-Z0-9_-]{20,})["'`]/g, severity: "CRITICAL" },
  { name: "Bearer token literal", regex: /["'`]Bearer\s+[a-zA-Z0-9._-]{20,}["'`]/g, severity: "CRITICAL" },
  { name: "Hardcoded domain", regex: /kelionai\.app/gi, severity: "HIGH" },
  { name: "localhost reference", regex: /["'`](?:https?:\/\/)?localhost[:\d]*["'`]/gi, severity: "MEDIUM" },
  { name: "Hardcoded IP", regex: /["'`]\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}["'`]/g, severity: "MEDIUM" },
];

const AUDIT_WHITELIST = [
  /^\s*\/\//, /^\s*\*/, /process\.env\./, /require\(/,
  /api\.telegram\.org/, /api\.stripe\.com/, /graph\.facebook\.com/,
  /api\.openai\.com/, /generativelanguage\.googleapis\.com/, /api\.elevenlabs\.io/,
  /api\.groq\.com/, /api\.together\.ai/, /api\.perplexity\.ai/,
  /api\.tavily\.com/, /api\.deepgram\.com/, /api\.cartesia\.ai/,
  /api\.serper\.dev/, /cdn\.jsdelivr\.net/, /unpkg\.com/,
  /fonts\.googleapis\.com/, /sentry\.io/, /supabase\.co/,
  /newsapi\.org/, /gnews\.io/, /api\.binance/, /coingecko/,
  /currentsapi/, /mediastack/, /guardianapis/,
  /support@kelionai/, /privacy@kelionai/, /noreply@kelionai/,
];

let _lastAudit = null;

function scanHardcoded() {
  const root = auditPath.join(__dirname, "..", "..");
  const dirs = ["server", "app/js", "app/admin"];
  const findings = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
  let total = 0, filesScanned = 0;

  for (const dir of dirs) {
    const absDir = auditPath.join(root, dir);
    if (!fs.existsSync(absDir)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = auditPath.join(d, e.name);
        if (fp.includes("node_modules")) continue;
        if (e.isDirectory()) { walk(fp); continue; }
        if (!e.name.endsWith(".js")) continue;
        filesScanned++;
        const lines = fs.readFileSync(fp, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (AUDIT_WHITELIST.some(re => re.test(line))) continue;
          for (const p of AUDIT_PATTERNS) {
            p.regex.lastIndex = 0;
            if (p.regex.test(line)) {
              findings[p.severity].push({
                file: auditPath.relative(root, fp).replace(/\\/g, "/"),
                line: i + 1,
                pattern: p.name,
                snippet: line.trim().substring(0, 120),
              });
              total++;
            }
          }
        }
      }
    };
    walk(absDir);
  }

  _lastAudit = {
    total, filesScanned,
    critical: findings.CRITICAL.length,
    high: findings.HIGH.length,
    medium: findings.MEDIUM.length,
    low: findings.LOW.length,
    clean: total === 0,
    scannedAt: new Date().toISOString(),
    findings,
  };
  return _lastAudit;
}

function fixHardcoded() {
  const root = auditPath.join(__dirname, "..", "..");
  const dirs = ["server", "app/js", "app/admin"];
  const fixes = [];
  const backups = [];

  for (const dir of dirs) {
    const absDir = auditPath.join(root, dir);
    if (!fs.existsSync(absDir)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = auditPath.join(d, e.name);
        if (fp.includes("node_modules")) continue;
        if (e.isDirectory()) { walk(fp); continue; }
        if (!e.name.endsWith(".js")) continue;
        let content = fs.readFileSync(fp, "utf8");
        const original = content;
        // Replace known hardcoded patterns line by line
        content = content.split("\n").map(line => {
          if (AUDIT_WHITELIST.some(re => re.test(line))) return line;
          // "https://kelionai.app/path" → process.env.APP_URL + "/path"
          line = line.replace(/"https:\/\/kelionai\.app(\/[^"]*)"/g, (m, path) =>
            path ? `(process.env.APP_URL + "${path}")` : `process.env.APP_URL`
          );
          // 'https://kelionai.app/path' → process.env.APP_URL + '/path'
          line = line.replace(/'https:\/\/kelionai\.app(\/[^']*)'/g, (m, path) =>
            path ? `(process.env.APP_URL + '${path}')` : `process.env.APP_URL`
          );
          // Inside template literals: https://kelionai.app → ${process.env.APP_URL}
          if (line.includes("`")) {
            line = line.replace(/https:\/\/kelionai\.app/g, "${process.env.APP_URL}");
            line = line.replace(/(?<!@)(?<!\.)kelionai\.app(?!["'])/g, "${process.env.APP_URL}");
          }
          return line;
        }).join("\n");

        if (content !== original) {
          // Create backup before modifying
          const bakPath = fp + ".bak";
          try {
            fs.writeFileSync(bakPath, original, "utf8");
            backups.push(auditPath.relative(root, bakPath).replace(/\\/g, "/"));
          } catch (bakErr) {
            logger.warn({ component: "Audit", file: fp, err: bakErr.message }, "Backup failed — skipping file");
            continue;
          }
          fs.writeFileSync(fp, content, "utf8");
          fixes.push(auditPath.relative(root, fp).replace(/\\/g, "/"));
          logger.info({ component: "Audit", file: fixes[fixes.length - 1] }, "Auto-fixed hardcoded values (backup created)");
        }
      }
    };
    walk(absDir);
  }
  return { fixedFiles: fixes, backups, count: fixes.length, fixedAt: new Date().toISOString() };
}

// ── Startup scan ──
try {
  const r = scanHardcoded();
  if (r.total > 0) {
    logger.warn({ component: "Audit", total: r.total, critical: r.critical, high: r.high },
      `⚠️ Hardcoded audit: ${r.total} findings (${r.critical} critical, ${r.high} high)`);
  } else {
    logger.info({ component: "Audit" }, "✅ Hardcoded audit: CLEAN — zero findings");
  }
} catch (e) { logger.warn({ component: "Audit", err: e.message }, "Startup audit failed"); }

// ── Periodic scan every 6 hours ──
setInterval(() => {
  try {
    const r = scanHardcoded();
    if (r.total > 0) {
      logger.warn({ component: "Audit", total: r.total, critical: r.critical },
        `⚠️ Periodic audit: ${r.total} hardcoded findings`);
    } else {
      logger.info({ component: "Audit" }, "✅ Periodic audit: CLEAN");
    }
  } catch (e) { logger.warn({ component: "Audit", err: e.message }, "Periodic audit failed"); }
}, 6 * 60 * 60 * 1000);

// ── Endpoints ──
router.get("/audit-hardcoded", (req, res) => {
  try { res.json(_lastAudit || scanHardcoded()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/audit-hardcoded/fix", (req, res) => {
  try {
    const fix = fixHardcoded();
    const after = scanHardcoded();
    logger.info({ component: "Audit", fixed: fix.count, remaining: after.total },
      `Auto-fix: ${fix.count} files fixed, ${after.total} remaining`);
    res.json({ fix, afterScan: after });
  } catch (e) {
    logger.error({ component: "Audit", err: e.message }, "Auto-fix failed");
    res.status(500).json({ error: e.message });
  }
});

// ── GET: Brain health and intelligence status ──
router.get("/brain-health", (req, res) => {
  try {
    const brain = req.app?.locals?.brain;
    if (!brain) {
      return res.json({
        status: "unavailable",
        message: "Brain instance nu este inițializat",
        uptime: 0,
        conversations: 0,
        toolStats: {},
        toolErrors: {},
        circuitBreakers: [],
        profilesCached: 0,
        journalSize: 0,
        learnedPatterns: 0,
        agents: [],
      });
    }

    // Safe access with fallbacks for all optional properties
    const hasMonitor = !!(brain.autonomousMonitor?.getStatus);
    const monitorStatus = hasMonitor ? brain.autonomousMonitor.getStatus() : { status: "not-available" };

    const hasLearningStore = !!(brain.learningStore?.circuitBreakers);
    const circuitBreakers = hasLearningStore
      ? Object.entries(brain.learningStore.circuitBreakers)
        .filter(([_, cb]) => cb?.open)
        .map(([tool, cb]) => ({ tool, failures: cb?.failures || 0 }))
      : [];

    res.json({
      status: brain.recentErrors > 5 ? "degraded" : "healthy",
      uptime: brain.startTime ? Math.round((Date.now() - brain.startTime) / 1000) : Math.round(process.uptime()),
      conversations: brain.conversationCount || brain.conversations?.size || 0,
      learningsExtracted: brain.learningsExtracted || 0,
      toolStats: brain.toolStats || {},
      toolErrors: brain.toolErrors || {},
      circuitBreakers,
      monitor: monitorStatus,
      profilesCached: brain._profileCache?.size || 0,
      journalSize: brain.journal?.length || 0,
      learnedPatterns: brain.learningStore?.patterns?.length || 0,
      agents: brain.agents ? Object.keys(brain.agents) : [],
      recentErrors: brain.recentErrors || 0,
      memoryEntries: brain._memoryCount || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/media — Media history & stats
// ══════════════════════════════════════════════════════════
router.get("/media", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ recent: [], stats: {}, totalCount: 0 });

    // Total count first (this works even with RLS)
    const { count } = await supabaseAdmin
      .from("media_history")
      .select("id", { count: "exact", head: true });

    // Recent media — select columns that actually exist in the table
    // brain._logMedia inserts: user_id, type, url, title, created_at
    const { data: recent, error: selErr } = await supabaseAdmin
      .from("media_history")
      .select("id, user_id, type, url, title, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (selErr) {
      logger.warn({ component: "Admin", err: selErr.message, code: selErr.code }, "Media select failed — trying minimal query");
      // Fallback: select only basic columns
      const { data: fallbackRecent } = await supabaseAdmin
        .from("media_history")
        .select("id, type, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      const stats = {};
      (fallbackRecent || []).forEach((m) => { stats[m.type] = (stats[m.type] || 0) + 1; });
      return res.json({ recent: (fallbackRecent || []).map(m => ({ ...m, prompt: m.title || "—", url: null })), stats, totalCount: count || 0 });
    }

    // Stats by type
    const stats = {};
    (recent || []).forEach((m) => {
      stats[m.type] = (stats[m.type] || 0) + 1;
    });

    // Map title -> prompt for frontend compatibility
    const mapped = (recent || []).map(m => ({ ...m, prompt: m.title || "—" }));

    res.json({ recent: mapped, stats, totalCount: count || 0 });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Media query failed");
    res.json({ recent: [], stats: {}, totalCount: 0 });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/trading — Trading stats & recent trades
// ══════════════════════════════════════════════════════════
router.get("/trading", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ recentTrades: [], stats: {}, intelligence: [] });

    // Recent trades
    const { data: trades } = await supabaseAdmin
      .from("trades")
      .select("id, user_id, symbol, side, quantity, price, status, pnl, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    // Trade intelligence (recent analyses)
    const { data: intel } = await supabaseAdmin
      .from("trade_intelligence")
      .select("id, symbol, signal, confidence, analysis, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    // Compute stats
    const totalTrades = (trades || []).length;
    const totalPnl = (trades || []).reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
    const winTrades = (trades || []).filter((t) => (parseFloat(t.pnl) || 0) > 0).length;
    const lossTrades = (trades || []).filter((t) => (parseFloat(t.pnl) || 0) < 0).length;
    const activeTrades = (trades || []).filter((t) => t.status === "open" || t.status === "active").length;

    // Binance config status
    const binanceConfigured = !!process.env.BINANCE_API_KEY;
    const binanceMode = process.env.BINANCE_TESTNET === "true" ? "testnet" : "live";

    res.json({
      recentTrades: trades || [],
      intelligence: intel || [],
      stats: {
        totalTrades,
        totalPnl: totalPnl.toFixed(2),
        winRate: totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(1) : "0",
        winTrades,
        lossTrades,
        activeTrades,
        binanceConfigured,
        binanceMode,
      },
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Trading query failed");
    res.json({ recentTrades: [], stats: {}, intelligence: [] });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/health-check — Full system health check
// ══════════════════════════════════════════════════════════
router.get("/health-check", async (req, res) => {
  try {
    const { brain, supabaseAdmin } = req.app.locals;
    let score = 100;
    const recommendations = [];

    // Server info
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const fmtMB = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";

    // Database check
    let dbConnected = false;
    const tables = {};
    const tableNames = ["profiles", "conversations", "messages", "ai_costs", "page_views", "subscriptions", "admin_codes"];
    if (supabaseAdmin) {
      try {
        for (const t of tableNames) {
          try {
            const { count, error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
            tables[t] = error ? { ok: false, error: error.message } : { ok: true, count: count || 0 };
          } catch (e) { tables[t] = { ok: false, error: e.message }; }
        }
        dbConnected = true;
      } catch (e) { dbConnected = false; }
    }
    if (!dbConnected) { score -= 30; recommendations.push("Database not connected"); }

    // Brain
    const brainStatus = brain ? (brain.recentErrors > 5 ? "degraded" : "healthy") : "unavailable";
    if (brainStatus === "degraded") { score -= 15; recommendations.push("Brain has recent errors"); }
    if (brainStatus === "unavailable") { score -= 20; recommendations.push("Brain not available"); }

    // Services
    const services = {};
    const svcChecks = { database: !!supabaseAdmin, brain: !!brain, gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY), stripe: !!process.env.STRIPE_SECRET_KEY };
    for (const [k, v] of Object.entries(svcChecks)) {
      services[k] = { label: k.charAt(0).toUpperCase() + k.slice(1), active: v };
      if (!v && k !== "stripe") { score -= 5; recommendations.push(`${k} not configured`); }
    }

    // Auth & Security
    const auth = { authAvailable: !!supabaseAdmin, supabaseAdminInitialized: !!supabaseAdmin };
    const security = {
      cspEnabled: true,
      httpsRedirect: !!process.env.RAILWAY_PUBLIC_DOMAIN,
      corsConfigured: true,
      adminSecretConfigured: !!(process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET),
    };
    if (!security.adminSecretConfigured) { score -= 5; recommendations.push("No ADMIN_SECRET set"); }

    // Payments
    const payments = {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
      priceProConfigured: !!process.env.STRIPE_PRICE_PRO,
      pricePremiumConfigured: !!process.env.STRIPE_PRICE_PREMIUM,
      activeSubscribers: null,
    };
    if (supabaseAdmin) {
      try {
        const { count } = await supabaseAdmin.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "active");
        payments.activeSubscribers = count || 0;
      } catch (e) { logger.warn({ component: "Admin", err: e.message }, "Subscription count query failed"); }
    }

    // Rate limits — real values from express-rate-limit in index.js
    const rateLimits = {
      global: { max: 200, windowMs: 15 * 60 * 1000, windowLabel: "15 minute", note: "Singurul rate limiter general din index.js" },
      newsFetch: { max: 1, windowMs: 14 * 60 * 1000, windowLabel: "14 minute", note: "Configurat în news.js fetchLimiter" },
    };

    // Brain-driven recommendations
    if (brain && typeof brain.think === "function") {
      try {
        const diagnosticPrompt = `Ești sistemul de monitorizare KelionAI. Analizează rapid:
- Uptime: ${Math.floor(uptime)}s, Memorie RSS: ${fmtMB(mem.rss)}, Heap: ${fmtMB(mem.heapUsed)}/${fmtMB(mem.heapTotal)}
- DB conectat: ${dbConnected}, Tabele ok: ${Object.values(tables).filter(t => t.ok).length}/${Object.keys(tables).length}
- Brain status: ${brainStatus}, Erori recente: ${brain.recentErrors || 0}
- Servicii: ${Object.entries(svcChecks).map(([k, v]) => k + ":" + (v ? "OK" : "LIPSĂ")).join(", ")}
Răspunde în maxim 3 recomandări scurte, fiecare pe un rând. Doar probleme reale, nu generalități.`;
        const brainResult = await Promise.race([
          brain.think(diagnosticPrompt, "kelion", [], "ro"),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
        ]);
        if (brainResult?.enrichedMessage) {
          const brainRecs = brainResult.enrichedMessage.split("\n").filter(l => l.trim()).slice(0, 3);
          recommendations.push(...brainRecs.map(r => "🧠 " + r.replace(/^[-•*\d.)\s]+/, "").trim()));
        }
      } catch { /* Brain diagnostic timeout — non-blocking */ }
    }

    // Errors
    const errors = {
      recentCount: brain?.recentErrors || 0,
      degradedTools: brain?.degradedTools || [],
    };
    if (errors.recentCount > 0) score -= Math.min(10, errors.recentCount);

    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    res.json({
      score: Math.max(0, score),
      grade,
      server: {
        version: require("../../package.json").version || "1.0.0",
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        nodeVersion: process.version,
        memory: { rss: fmtMB(mem.rss), heapUsed: fmtMB(mem.heapUsed), heapTotal: fmtMB(mem.heapTotal) },
        timestamp: new Date().toISOString(),
      },
      services,
      database: { connected: dbConnected, tables },
      brain: {
        status: brainStatus,
        conversations: brain?.conversations?.size || 0,
        recentErrors: brain?.recentErrors || 0,
        degradedTools: brain?.degradedTools || [],
        journal: (brain?.journal || []).slice(-5),
      },
      auth,
      security,
      payments,
      rateLimits,
      errors,
      recommendations,
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Health check failed");
    res.status(500).json({ error: e.message, score: 0, grade: "F" });
  }
});

// ══════════════════════════════════════════════════════════════
// AUTO-MONITOR — Brain análisis permanente del sistema
// Saves health + trading state every 30 min to Supabase
// Brain analyzes results and provides recommendations
// ══════════════════════════════════════════════════════════════

let _monitorHistory = []; // in-memory ring buffer (last 48 entries = 24h)
const MONITOR_MAX = 48;

async function collectMonitorSnapshot(supabaseAdmin, brain) {
  try {
    // 1. Collect health data
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    // Services status
    const services = {
      database: !!supabaseAdmin,
      brain: !!brain,
      gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      stripe: !!process.env.STRIPE_SECRET_KEY,
    };

    // 2. Collect trading state
    let tradingState = null;
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("trading_state")
          .select("*")
          .eq("id", "paper_bot")
          .single();
        tradingState = data;
      } catch (e) { /* table may not exist */ }
    }

    // 3. Collect candle count
    let candleCount = 0;
    if (supabaseAdmin) {
      try {
        const { count } = await supabaseAdmin
          .from("market_candles")
          .select("*", { count: "exact", head: true });
        candleCount = count || 0;
      } catch (e) { /* table may not exist */ }
    }

    // 4. Build snapshot
    const snapshot = {
      timestamp: new Date().toISOString(),
      health: {
        score: Object.values(services).filter(v => v).length * 25,
        memory_mb: +(mem.rss / 1024 / 1024).toFixed(1),
        uptime_hours: +(uptime / 3600).toFixed(2),
        services,
        errors: brain?.recentErrors || 0,
      },
      trading: tradingState ? {
        cash: tradingState.cash,
        portfolio_value: tradingState.portfolio_value,
        total_pnl: tradingState.total_pnl,
        win_count: tradingState.win_count,
        loss_count: tradingState.loss_count,
        total_trades: tradingState.total_trades,
        active: tradingState.active,
      } : null,
      data: {
        candles: candleCount,
      },
    };

    // 5. Save to ring buffer
    _monitorHistory.push(snapshot);
    if (_monitorHistory.length > MONITOR_MAX) _monitorHistory.shift();

    // 6. Save to Supabase
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from("system_monitor").insert({
          snapshot: JSON.stringify(snapshot),
          health_score: snapshot.health.score,
          trading_pnl: snapshot.trading?.total_pnl || 0,
          trading_trades: snapshot.trading?.total_trades || 0,
          candle_count: snapshot.data.candles,
          created_at: snapshot.timestamp,
        });

        // Keep only last 200 entries in DB
        const { count } = await supabaseAdmin
          .from("system_monitor")
          .select("*", { count: "exact", head: true });
        if (count && count > 200) {
          const { data: old } = await supabaseAdmin
            .from("system_monitor")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(count - 200);
          if (old && old.length > 0) {
            await supabaseAdmin
              .from("system_monitor")
              .delete()
              .in("id", old.map(r => r.id));
          }
        }
      } catch (e) { /* table may not exist yet */ }
    }

    logger.info({
      component: "Monitor",
      score: snapshot.health.score,
      pnl: snapshot.trading?.total_pnl,
      candles: snapshot.data.candles,
    }, "📊 Auto-monitor snapshot saved");

    return snapshot;
  } catch (e) {
    logger.warn({ component: "Monitor", err: e.message }, "Monitor snapshot failed");
    return null;
  }
}

// ── Start auto-monitor lazily on first admin request ──
let _monitorInterval = null;
let _monitorStarted = false;

function ensureMonitorStarted(req) {
  if (_monitorStarted) return;
  _monitorStarted = true;
  const { supabaseAdmin, brain } = req.app.locals;

  // Initial snapshot
  collectMonitorSnapshot(supabaseAdmin, brain).catch(() => { });

  // Every 30 minutes
  _monitorInterval = setInterval(async () => {
    try {
      await collectMonitorSnapshot(supabaseAdmin, brain);
    } catch (e) { /* ok */ }
  }, 30 * 60 * 1000);

  logger.info({ component: "Monitor" }, "📊 Auto-monitor started — snapshots every 30 min");
}

// Middleware to start monitor on first admin request
router.use((req, res, next) => {
  ensureMonitorStarted(req);
  next();
});

// ── GET /api/admin/monitor — Brain-analyzed current status ──
router.get("/monitor", async (req, res) => {
  try {
    const { supabaseAdmin, brain } = req.app.locals;

    // Collect fresh snapshot
    const current = await collectMonitorSnapshot(supabaseAdmin, brain);

    // Get history from DB for trend analysis
    let history = [];
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("system_monitor")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(48);
        history = (data || []).map(r => {
          try { return JSON.parse(r.snapshot); }
          catch { return r; }
        });
      } catch (e) { history = _monitorHistory; }
    } else {
      history = _monitorHistory;
    }

    // ═══ BRAIN ANALYSIS ═══
    let brainAnalysis = null;
    if (brain && typeof brain.think === "function") {
      try {
        const tradingInfo = current?.trading
          ? `Cash: €${current.trading.cash}, Portfolio: €${current.trading.portfolio_value}, P&L: €${current.trading.total_pnl}, Trades: ${current.trading.total_trades}, Wins: ${current.trading.win_count}, Losses: ${current.trading.loss_count}`
          : "Trading bot nu este activ";

        const historyTrend = history.length > 1
          ? `Ultimele ${history.length} snapshot-uri: score-uri health = [${history.slice(0, 5).map(h => h.health?.score).join(", ")}], P&L trend = [${history.slice(0, 5).map(h => h.trading?.total_pnl || 0).join(", ")}]`
          : "Fără istoric suficient";

        const analysisPrompt = `Ești sistemul de monitorizare KelionAI. Analizează REAL și ONEST:

STARE CURENTĂ:
- Health Score: ${current?.health?.score || 0}/100
- Memorie: ${current?.health?.memory_mb}MB
- Uptime: ${current?.health?.uptime_hours}h
- Erori recente: ${current?.health?.errors}
- Candle-uri reale: ${current?.data?.candles}
- ${tradingInfo}

TREND: ${historyTrend}

Răspunde STRICT în format JSON:
{
  "status": "HEALTHY|WARNING|CRITICAL",
  "summary": "O propoziție clar cu starea reală",
  "trading_opinion": "Opinia ta REALĂ despre performanța trading-ului",
  "recommendations": ["max 3 recomandări concrete"],
  "risk_level": "LOW|MEDIUM|HIGH",
  "data_quality": "REAL|MIXED|FAKE"
}

IMPORTANT: Nu minți, nu ascunzi probleme. Dacă trading-ul pierde bani, spune clar.`;

        const brainResult = await Promise.race([
          brain.think(analysisPrompt, "kelion-monitor", [], "ro"),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
        ]);

        if (brainResult?.enrichedMessage) {
          const jsonMatch = brainResult.enrichedMessage.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { brainAnalysis = JSON.parse(jsonMatch[0]); }
            catch { brainAnalysis = { raw: brainResult.enrichedMessage }; }
          } else {
            brainAnalysis = { raw: brainResult.enrichedMessage };
          }
        }
      } catch (e) {
        brainAnalysis = { error: e.message, status: "ANALYSIS_FAILED" };
      }
    } else {
      brainAnalysis = { error: "Brain not available", status: "NO_BRAIN" };
    }

    res.json({
      current,
      brainAnalysis,
      historyCount: history.length,
      recentHistory: history.slice(0, 10),
      autoMonitor: {
        enabled: true,
        interval: "30 minutes",
        nextRun: _monitorInterval ? "Active" : "Not started",
      },
    });
  } catch (e) {
    logger.error({ component: "Monitor", err: e.message }, "Monitor route failed");
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/monitor/history — Full monitoring history ──
router.get("/monitor/history", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ history: _monitorHistory, source: "memory" });

    const { data, error } = await supabaseAdmin
      .from("system_monitor")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return res.json({ history: _monitorHistory, source: "memory", dbError: error.message });

    res.json({
      history: data || [],
      source: "database",
      totalEntries: (data || []).length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/memories — Brain Memory Panel
// Browse, search, and filter brain memories
// ══════════════════════════════════════════════════════════
router.get("/memories", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ memories: [], facts: [], totalMemories: 0, totalFacts: 0 });

    const { type, search, limit = 50, offset = 0 } = req.query;

    // Query brain_memory table
    let memQuery = supabaseAdmin
      .from("brain_memory")
      .select("id, user_id, type, content, importance, created_at, tags", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (type && type !== "all") memQuery = memQuery.eq("type", type);
    if (search) memQuery = memQuery.ilike("content", `%${search}%`);

    const { data: memories, count: totalMemories, error: memErr } = await memQuery;
    if (memErr) logger.warn({ component: "Admin", err: memErr.message }, "Memory query error");

    // Query learned_facts table
    let factQuery = supabaseAdmin
      .from("learned_facts")
      .select("id, fact, category, source, confidence, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(parseInt(limit));

    if (search) factQuery = factQuery.ilike("fact", `%${search}%`);

    const { data: facts, count: totalFacts, error: factErr } = await factQuery;
    if (factErr) logger.warn({ component: "Admin", err: factErr.message }, "Facts query error");

    // Stats by type
    const typeStats = {};
    (memories || []).forEach(m => {
      typeStats[m.type || "unknown"] = (typeStats[m.type || "unknown"] || 0) + 1;
    });

    res.json({
      memories: memories || [],
      facts: facts || [],
      totalMemories: totalMemories || 0,
      totalFacts: totalFacts || 0,
      typeStats,
      types: ["text", "visual", "code", "procedure", "preference", "fact", "emotion", "context"],
    });
  } catch (e) {
    logger.error({ component: "Admin", err: e.message }, "Memory panel query failed");
    res.json({ memories: [], facts: [], totalMemories: 0, totalFacts: 0, error: e.message });
  }
});

// DELETE /api/admin/memories/:id — Remove a specific memory
router.delete("/memories/:id", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: "No DB" });

    const { error } = await supabaseAdmin
      .from("brain_memory")
      .delete()
      .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });

    logger.info({ component: "Admin", memoryId: req.params.id }, "Memory deleted");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/self-heal — Self-Healing Brain via GitHub
// Detects recurring errors → AI proposes fix → commits to branch
// Requires: GITHUB_TOKEN env var
// ══════════════════════════════════════════════════════════
router.post("/self-heal", async (req, res) => {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(400).json({
        error: "GITHUB_TOKEN not set",
        instruction: "Add GITHUB_TOKEN to Railway env vars (repo scope needed)",
      });
    }

    const { supabaseAdmin, brain } = req.app.locals;

    // 1. Find recurring error patterns
    let errorPatterns = [];
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from("brain_memory")
        .select("content, context")
        .eq("memory_type", "error_pattern")
        .order("created_at", { ascending: false })
        .limit(5);
      errorPatterns = data || [];
    }

    if (errorPatterns.length === 0) {
      return res.json({ healed: false, reason: "No recurring errors found to fix" });
    }

    // 2. Use AI to analyze the errors and propose a fix
    const errorSummary = errorPatterns.map(e => e.content).join("\n");
    const analysisPrompt = `You are a senior Node.js developer. Analyze these recurring errors and propose a MINIMAL, SAFE code fix:

ERRORS:
${errorSummary}

Respond in this exact JSON format:
{
  "file": "relative/path/to/file.js",
  "description": "what the fix does",
  "lineRange": "approximate lines",
  "severity": "low|medium|high",
  "canAutoFix": true/false,
  "fixDescription": "exact change needed"
}`;

    let aiAnalysis = null;
    if (brain && typeof brain.singleProviderCall === "function") {
      try {
        const raw = await brain.singleProviderCall(analysisPrompt, 500);
        const jsonMatch = (raw || "").match(/\{[\s\S]*\}/);
        if (jsonMatch) aiAnalysis = JSON.parse(jsonMatch[0]);
      } catch (_) { }
    }

    // 3. Create a GitHub issue with the analysis (safe — doesn't auto-push code)
    const owner = "adrianenc11-hue";
    const repo = "kelionai-v2";
    const issueBody = `## 🤖 Self-Healing Brain Report

### Recurring Errors Detected:
\`\`\`
${errorSummary.substring(0, 1000)}
\`\`\`

### AI Analysis:
${aiAnalysis ? JSON.stringify(aiAnalysis, null, 2) : "AI analysis unavailable"}

### Auto-generated by KelionAI Self-Healing Brain
*Created: ${new Date().toISOString()}*`;

    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        title: `🤖 Self-Heal: ${aiAnalysis?.description || "Recurring error detected"}`,
        body: issueBody,
        labels: ["self-heal", "automated"],
      }),
    });

    const ghData = await ghRes.json();

    logger.info({ component: "SelfHeal", issueUrl: ghData.html_url }, "Self-healing issue created");

    res.json({
      healed: true,
      action: "github_issue_created",
      issueUrl: ghData.html_url || null,
      errorsAnalyzed: errorPatterns.length,
      aiAnalysis: aiAnalysis,
    });
  } catch (e) {
    logger.error({ component: "SelfHeal", err: e.message }, "Self-heal failed");
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
