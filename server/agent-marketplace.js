/**
 * KelionAI — Agent Marketplace
 * 
 * Users create, publish, and install custom AI agents.
 * Each agent: { name, persona, tools[], model, isPublic, creator }
 * Supabase table: marketplace_agents
 */
"use strict";

const express = require("express");
const logger = require("./logger");
const { MODELS } = require("./config/models");
const router = express.Router();

// ═══ DEFAULT AGENT TEMPLATES ═══
const TEMPLATES = {
  assistant: {
    name: "Custom Assistant",
    persona: "You are a helpful AI assistant. Follow the user's instructions precisely.",
    tools: ["search", "memory", "translate"],
    model: "auto",
    icon: "🤖",
  },
  coder: {
    name: "Code Expert",
    persona: "You are an expert programmer. Write clean, efficient, well-documented code. Explain your reasoning.",
    tools: ["code_exec", "search", "web_scrape"],
    model: "auto",
    icon: "💻",
  },
  researcher: {
    name: "Deep Researcher",
    persona: "You are a thorough researcher. Search multiple sources, cross-reference facts, cite sources. Never fabricate information.",
    tools: ["search", "web_scrape", "rag_search", "truth_guard"],
    model: "auto",
    icon: "🔬",
  },
  creative: {
    name: "Creative Writer",
    persona: "You are a creative writer with a vivid imagination. Write engaging, original content with strong narrative voice.",
    tools: ["imagine", "translate", "document_gen"],
    model: "auto",
    icon: "✍️",
  },
  trader: {
    name: "Trading Analyst",
    persona: "You are a quantitative trading analyst. Analyze markets with technical indicators, provide data-driven insights. Always include risk warnings.",
    tools: ["trade_intelligence", "search", "db_query"],
    model: "auto",
    icon: "📈",
  },
};

// ═══ AVAILABLE TOOLS (for agent builder UI) ═══
const AVAILABLE_TOOLS = [
  { id: "search", name: "Web Search", icon: "🔍" },
  { id: "memory", name: "Memory", icon: "🧠" },
  { id: "imagine", name: "Image Generation", icon: "🎨" },
  { id: "code_exec", name: "Code Execution", icon: "💻" },
  { id: "web_scrape", name: "Web Scraper", icon: "🌐" },
  { id: "translate", name: "Translate", icon: "🌍" },
  { id: "trade_intelligence", name: "Trading", icon: "📈" },
  { id: "weather", name: "Weather", icon: "🌤️" },
  { id: "vision", name: "Vision/Image Analysis", icon: "👁️" },
  { id: "rag_search", name: "Knowledge Base", icon: "📚" },
  { id: "truth_guard", name: "Fact Checker", icon: "✅" },
  { id: "document_gen", name: "Document Generator", icon: "📄" },
  { id: "db_query", name: "Database Query", icon: "🗄️" },
  { id: "email", name: "Email", icon: "📧" },
  { id: "calendar", name: "Calendar", icon: "📅" },
  { id: "reminder", name: "Reminders", icon: "⏰" },
];

// ═══ ROUTES ═══

// GET /api/marketplace/agents — Browse public agents
router.get("/agents", async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ agents: Object.values(TEMPLATES), source: "defaults" });

    const { data, error } = await supabaseAdmin
      .from("marketplace_agents")
      .select("id, name, persona, tools, model, icon, is_public, creator_id, installs, rating, created_at")
      .eq("is_public", true)
      .order("installs", { ascending: false })
      .limit(50);

    if (error || !data) return res.json({ agents: Object.values(TEMPLATES), source: "defaults" });
    res.json({ agents: data, templates: TEMPLATES, source: "marketplace" });
  } catch (e) {
    res.json({ agents: Object.values(TEMPLATES), source: "defaults", error: e.message });
  }
});

// GET /api/marketplace/my-agents — User's created agents
router.get("/my-agents", async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.json({ agents: [] });

    const user = await getUserFromToken(req).catch(() => null);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { data } = await supabaseAdmin
      .from("marketplace_agents")
      .select("*")
      .eq("creator_id", user.id)
      .order("created_at", { ascending: false });

    res.json({ agents: data || [] });
  } catch (e) {
    res.json({ agents: [] });
  }
});

// POST /api/marketplace/agents — Create new agent
router.post("/agents", express.json(), async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No database" });

    const user = await getUserFromToken(req).catch(() => null);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { name, persona, tools, model, icon, isPublic, template } = req.body;

    // Validate
    if (!name || name.length < 2 || name.length > 50) {
      return res.status(400).json({ error: "Name must be 2-50 characters" });
    }
    if (!persona || persona.length < 10 || persona.length > 2000) {
      return res.status(400).json({ error: "Persona must be 10-2000 characters" });
    }

    // Apply template if specified
    let agentData = {};
    if (template && TEMPLATES[template]) {
      agentData = { ...TEMPLATES[template] };
    }

    // Override with user values
    agentData = {
      ...agentData,
      name: name || agentData.name,
      persona: persona || agentData.persona,
      tools: (tools || agentData.tools || []).filter(t => AVAILABLE_TOOLS.some(at => at.id === t)),
      model: model || "auto",
      icon: icon || agentData.icon || "🤖",
      is_public: isPublic === true,
      creator_id: user.id,
      installs: 0,
      rating: 0,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("marketplace_agents")
      .insert(agentData)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    logger.info({ component: "Marketplace", agentId: data.id, name }, `🏪 Agent created: ${name}`);
    res.json({ success: true, agent: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marketplace/agents/:id/install — Install agent for user
router.post("/agents/:id/install", async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No database" });

    const user = await getUserFromToken(req).catch(() => null);
    if (!user) return res.status(401).json({ error: "Login required" });

    const agentId = req.params.id;

    // Get agent
    const { data: agent } = await supabaseAdmin
      .from("marketplace_agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Save install
    await supabaseAdmin.from("user_installed_agents").upsert({
      user_id: user.id,
      agent_id: agentId,
      installed_at: new Date().toISOString(),
    }, { onConflict: "user_id,agent_id" });

    // Increment install count
    await supabaseAdmin
      .from("marketplace_agents")
      .update({ installs: (agent.installs || 0) + 1 })
      .eq("id", agentId);

    logger.info({ component: "Marketplace", agentId, userId: user.id }, "📥 Agent installed");
    res.json({ success: true, agent: agent.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/marketplace/agents/:id — Delete own agent
router.delete("/agents/:id", async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: "No database" });

    const user = await getUserFromToken(req).catch(() => null);
    if (!user) return res.status(401).json({ error: "Login required" });

    const { error } = await supabaseAdmin
      .from("marketplace_agents")
      .delete()
      .eq("id", req.params.id)
      .eq("creator_id", user.id); // Only delete own agents

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/marketplace/tools — Available tools for agent builder
router.get("/tools", (_req, res) => {
  res.json({ tools: AVAILABLE_TOOLS });
});

// GET /api/marketplace/templates — Agent templates
router.get("/templates", (_req, res) => {
  res.json({ templates: TEMPLATES });
});

module.exports = { router, TEMPLATES, AVAILABLE_TOOLS };
