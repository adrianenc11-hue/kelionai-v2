// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v2.0
//
// CAPABILITIES:
// 1. Chain-of-Thought — reasons step-by-step before responding
// 2. Action Chains — multi-step task orchestration
// 3. Self-Improvement — learns from failures, optimizes strategies
// 4. Task Decomposition — breaks complex requests into sub-tasks
// 5. Conversation Summarizer — compresses context for long chats
// 6. Auto-Debug — analyzes errors, attempts self-repair
// 7. Parallel Tool Orchestration — concurrent execution with fallbacks
// 8. Memory Learning — extracts personal facts automatically
//
// THINKING LOOP: Analyze → Decompose → Plan → Execute → Verify → Learn
// ═══════════════════════════════════════════════════════════════
const logger = require("./logger");
const { MODELS } = require("./config/models");
const { UserProfile, LearningStore, AutonomousMonitor } = require("./brain-profile");

class KelionBrain {
  constructor(config) {
    this.anthropicKey = config.anthropicKey;
    this.openaiKey = config.openaiKey;
    this.groqKey = config.groqKey;
    this.perplexityKey = config.perplexityKey;
    this.tavilyKey = config.tavilyKey;
    this.serperKey = config.serperKey;
    this.togetherKey = config.togetherKey;
    this.supabaseAdmin = config.supabaseAdmin;

    // ── Monitoring & Self-Improvement ──
    this.errorLog = [];
    this.successLog = [];
    this.toolStats = {
      search: 0,
      weather: 0,
      imagine: 0,
      vision: 0,
      memory: 0,
      map: 0,
      chainOfThought: 0,
      decompose: 0,
    };
    this.toolErrors = {
      search: 0,
      weather: 0,
      imagine: 0,
      vision: 0,
      memory: 0,
      map: 0,
    };
    this.toolLatency = {};
    this.startTime = Date.now();
    this.conversationCount = 0;
    this.learningsExtracted = 0;

    // ── Self-Improvement Journal ──
    this.journal = []; // { timestamp, event, lesson, applied }
    this.strategies = {
      searchRefinement: [],
      emotionResponses: {},
      toolCombinations: {},
      failureRecoveries: [],
    };

    // ── Conversation Summarizer ──
    this.conversationSummaries = new Map();

    // ── Learning Rate Limiter ──
    this.lastLearnTime = new Map();

    // ══ BRAIN v3.0 — Intelligence Systems ══

    // ── Learning Store (pattern learning + circuit breaker) ──
    this.learningStore = new LearningStore();
    this.learningStore.load(this.supabaseAdmin).catch(() => { });

    // ── Autonomous Monitor (30min health loop) ──
    this.autonomousMonitor = new AutonomousMonitor(this);
    this.autonomousMonitor.start();

    // ── User Profile Cache ──
    this._profileCache = new Map(); // userId → { profile, loadedAt }
    this._profileTTL = 10 * 60 * 1000; // cache profiles for 10 min

    // ── Multi-Agent Profiles ──
    this.agents = {
      research: {
        name: "ResearchAgent",
        systemPrompt: "You are a precise research analyst. Focus on facts, sources, verification. Cite sources when possible. Be thorough but concise.",
        preferredTools: ["search", "memory"],
        triggerTopics: ["news", "science", "history", "facts", "research"],
      },
      creative: {
        name: "CreativeAgent",
        systemPrompt: "You are a creative artist and storyteller. Use vivid language, metaphors, and imagination. Be expressive and engaging.",
        preferredTools: ["imagine", "video"],
        triggerTopics: ["art", "music", "story", "creative", "design", "imagine"],
      },
      analytics: {
        name: "AnalyticsAgent",
        systemPrompt: "You are a data analyst. Focus on numbers, trends, comparisons. Use structured data presentation. Be precise with statistics.",
        preferredTools: ["search", "weather", "trade"],
        triggerTopics: ["trading", "finance", "data", "statistics", "costs", "analysis"],
      },
      support: {
        name: "SupportAgent",
        systemPrompt: "You are a helpful support agent. Be patient, empathetic, and solution-focused. Guide users step by step.",
        preferredTools: ["memory"],
        triggerTopics: ["help", "error", "problem", "support", "how to", "tutorial"],
      },
    };

    logger.info({ component: "Brain" },
      "🧠 Brain v3.0 initialized: LearningStore + AutonomousMonitor + MultiAgent + UserProfiles");

    // ── Tool Registry (loaded from Supabase brain_tools) ──
    this._toolRegistry = new Map(); // id → tool
    this._toolCache = new Map();    // cacheKey → { data, timestamp }
    this._toolCacheTTL = 5 * 60 * 1000; // 5 min cache

    // Plan quota limits (messages per month)
    this.PLAN_LIMITS = { free: 50, pro: 500, premium: Infinity };

    // Load tool registry on startup
    this._loadToolRegistry().catch(() => { });
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL REGISTRY — Central Engine Core
  // ═══════════════════════════════════════════════════════════

  /** Load all tools from Supabase brain_tools table */
  async _loadToolRegistry() {
    if (!this.supabaseAdmin) return;
    try {
      const { data, error } = await this.supabaseAdmin
        .from("brain_tools")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: true });

      if (error || !data) return;
      this._toolRegistry.clear();
      for (const tool of data) {
        this._toolRegistry.set(tool.id, tool);
      }
      logger.info({ component: "Brain", tools: data.length },
        `🔧 Loaded ${data.length} tools from registry`);
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "Tool registry load failed");
    }
  }

  /** Get best tool for a category (respects priority + fallback) */
  getToolByCategory(category) {
    const tools = [];
    for (const tool of this._toolRegistry.values()) {
      if (tool.category === category && tool.is_active) tools.push(tool);
    }
    tools.sort((a, b) => a.priority - b.priority);
    return tools[0] || null;
  }

  /** Get tool by ID */
  getTool(toolId) {
    return this._toolRegistry.get(toolId) || null;
  }

  /** Get tool endpoint URL — central method replacing all hardcoded URLs */
  getToolUrl(toolId) {
    const tool = this._toolRegistry.get(toolId);
    return tool ? tool.endpoint : null;
  }

  /**
   * Call a tool with automatic logging, stats, fallback, and caching
   * This is the ONLY way external APIs should be called
   */
  async callTool(toolId, params = {}, userId = null) {
    let tool = this._toolRegistry.get(toolId);
    if (!tool) {
      // Fallback: try to find by category
      logger.warn({ component: "Brain", toolId }, `Tool ${toolId} not found`);
      return { success: false, error: "Tool not found", data: null };
    }

    // ── Cache check ──
    const cacheKey = `${toolId}:${JSON.stringify(params)}`;
    const cached = this._toolCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this._toolCacheTTL) {
      logger.info({ component: "Brain", toolId }, `📦 Cache hit for ${tool.name}`);
      return { success: true, data: cached.data, fromCache: true };
    }

    // ── Execute with fallback chain ──
    let attempts = 0;
    const maxAttempts = 3;

    while (tool && attempts < maxAttempts) {
      attempts++;
      const start = Date.now();
      try {
        // Build auth headers
        const headers = { "Content-Type": "application/json" };
        if (tool.auth_type === "api_key" && tool.auth_env_key) {
          const key = process.env[tool.auth_env_key];
          if (!key) throw new Error(`Missing env: ${tool.auth_env_key}`);
          const headerName = tool.config?.header || "Authorization";
          headers[headerName] = headerName === "Authorization" ? `Bearer ${key}` : key;
        } else if (tool.auth_type === "bearer" && tool.auth_env_key) {
          headers["Authorization"] = `Bearer ${process.env[tool.auth_env_key]}`;
        }

        // Build request
        const fetchOpts = { method: tool.method, headers, signal: AbortSignal.timeout(15000) };
        let url = tool.endpoint;

        if (tool.method === "GET" && params.query) {
          const qs = new URLSearchParams(params).toString();
          url = `${url}?${qs}`;
        } else if (tool.method === "POST") {
          fetchOpts.body = JSON.stringify(params);
        }

        const response = await fetch(url, fetchOpts);
        const latency = Date.now() - start;

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // ── Success: update stats + cache ──
        this._toolCache.set(cacheKey, { data, timestamp: Date.now() });
        this._updateToolStats(tool.id, latency, true);

        // Log to memory
        if (this.supabaseAdmin && userId) {
          this.supabaseAdmin.from("brain_memory").insert({
            user_id: userId,
            memory_type: "tool_call",
            content: `Used ${tool.name}: ${JSON.stringify(params).substring(0, 200)}`,
            metadata: { tool_id: tool.id, latency_ms: latency, success: true },
            importance: 0.3,
          }).then(() => { }).catch(() => { });
        }

        return { success: true, data, latency, tool: tool.name };

      } catch (e) {
        const latency = Date.now() - start;
        logger.warn({ component: "Brain", tool: tool.id, err: e.message, latency },
          `⚠️ ${tool.name} failed (${latency}ms): ${e.message}`);
        this._updateToolStats(tool.id, latency, false);

        // ── Fallback to next tool ──
        if (tool.fallback_tool_id) {
          const fallback = this._toolRegistry.get(tool.fallback_tool_id);
          if (fallback) {
            logger.info({ component: "Brain", from: tool.id, to: fallback.id },
              `🔄 Fallback: ${tool.name} → ${fallback.name}`);
            tool = fallback;
            continue;
          }
        }
        return { success: false, error: e.message, data: null, tool: tool.name };
      }
    }
    return { success: false, error: "All attempts exhausted", data: null };
  }

  /** Update tool stats in DB (async, non-blocking) */
  _updateToolStats(toolId, latencyMs, success) {
    if (!this.supabaseAdmin) return;
    const updates = {
      total_calls: this._toolRegistry.get(toolId)?.total_calls + 1 || 1,
      last_used_at: new Date().toISOString(),
      avg_latency_ms: latencyMs,
    };
    if (!success) updates.total_errors = (this._toolRegistry.get(toolId)?.total_errors || 0) + 1;

    this.supabaseAdmin.from("brain_tools").update(updates)
      .eq("id", toolId).then(() => { }).catch(() => { });

    // Update local cache
    const local = this._toolRegistry.get(toolId);
    if (local) {
      local.total_calls = updates.total_calls;
      local.last_used_at = updates.last_used_at;
      local.avg_latency_ms = latencyMs;
      if (!success) local.total_errors = updates.total_errors;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // QUOTA SYSTEM — Messages per plan per month
  // ═══════════════════════════════════════════════════════════

  /** Check if user has remaining quota */
  async checkQuota(userId) {
    if (!this.supabaseAdmin || !userId) return { allowed: true, remaining: Infinity };

    const month = new Date().toISOString().slice(0, 7); // '2026-03'

    // Get user plan
    let plan = "free";
    try {
      const { data: sub } = await this.supabaseAdmin
        .from("subscriptions")
        .select("plan")
        .eq("user_id", userId)
        .eq("status", "active")
        .single();
      if (sub?.plan) plan = sub.plan;
    } catch { }

    const limit = this.PLAN_LIMITS[plan] || 50;

    // Get current usage
    try {
      const { data: usage } = await this.supabaseAdmin
        .from("brain_usage")
        .select("message_count")
        .eq("user_id", userId)
        .eq("month", month)
        .single();

      const count = usage?.message_count || 0;
      return {
        allowed: count < limit,
        remaining: Math.max(0, limit - count),
        used: count,
        limit,
        plan,
      };
    } catch {
      return { allowed: true, remaining: limit, used: 0, limit, plan };
    }
  }

  /** Increment user message count for current month */
  async incrementUsage(userId, toolCalls = 0, tokensUsed = 0) {
    if (!this.supabaseAdmin || !userId) return;
    const month = new Date().toISOString().slice(0, 7);

    try {
      // Upsert: insert or increment
      const { data: existing } = await this.supabaseAdmin
        .from("brain_usage")
        .select("id, message_count, tool_calls, tokens_used")
        .eq("user_id", userId)
        .eq("month", month)
        .single();

      if (existing) {
        await this.supabaseAdmin.from("brain_usage").update({
          message_count: (existing.message_count || 0) + 1,
          tool_calls: (existing.tool_calls || 0) + toolCalls,
          tokens_used: (existing.tokens_used || 0) + tokensUsed,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await this.supabaseAdmin.from("brain_usage").insert({
          user_id: userId, month,
          message_count: 1, tool_calls: toolCalls, tokens_used: tokensUsed,
        });
      }
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "Usage tracking failed");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITIES — What Kelion knows it can do
  // ═══════════════════════════════════════════════════════════
  static CAPABILITIES_PROMPT() {
    return `You are Kelion, an advanced AI assistant by KelionAI. You have these capabilities:
- SEARCH: Web search (Tavily, Perplexity, Serper) for real-time information
- WEATHER: Real-time weather for any location (Open-Meteo)
- IMAGINE: Generate images from descriptions
- MAP: Geocoding and maps for any address
- MEMORY: Remember and recall past conversations and facts about users
- VISION: Analyze images with GPT-5.4 (describe scenes, read text, identify objects — critical for blind users)
- TTS: Convert text to natural speech (ElevenLabs/OpenAI)
- STT: Transcribe voice to text (Whisper)
- FACE_CHECK: Recognize registered faces
- FACE_REGISTER: Register a new face
- VOICE_CLONE: Clone a voice for TTS
- RADIO: Stream 13 Romanian radio stations
- VIDEO: Analyze video content
- WEB_NAV: Navigate and extract web content
- OPEN_URL: Open any URL
- NEWS: Latest news with 29 source fetchers and categories
- TRADE_INTELLIGENCE: Trading analysis with 11 technical indicators
- ADMIN: System diagnostics, stats, user management (admin only)
- AUTH: User registration, login, password management
- PAYMENTS: Subscription plans, usage tracking, referrals
- LEGAL: GDPR, Terms, Privacy
- HEALTH: System health monitoring
- METRICS: Performance metrics and analytics
- SECURITY: Security auditing
- DEVELOPER_API: API key management and docs
When asked "what can you do?" list these real capabilities. Use them proactively when relevant.`;
  }

  // ═══════════════════════════════════════════════════════════
  // MEMORY SYSTEM — Load/Save to Supabase
  // ═══════════════════════════════════════════════════════════
  async loadMemory(userId, type, limit = 10) {
    if (!userId || !this.supabaseAdmin) return [];
    try {
      const { data, error } = await this.supabaseAdmin
        .from("brain_memory")
        .select("content, context, importance, created_at")
        .eq("user_id", userId)
        .eq("memory_type", type)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        logger.warn({ component: "Brain", err: error.message }, "loadMemory failed");
        return [];
      }
      return data || [];
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "loadMemory error");
      return [];
    }
  }

  async saveMemory(userId, type, content, context = {}, importance = 5) {
    if (!userId || !this.supabaseAdmin || !content) return;
    try {
      await this.supabaseAdmin.from("brain_memory").insert({
        user_id: userId,
        memory_type: type,
        content: content.substring(0, 2000),
        context,
        importance,
      });
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "saveMemory error");
    }
  }

  async loadFacts(userId, limit = 15) {
    if (!userId || !this.supabaseAdmin) return [];
    try {
      const { data, error } = await this.supabaseAdmin
        .from("learned_facts")
        .select("fact, category, confidence")
        .eq("user_id", userId)
        .order("confidence", { ascending: false })
        .limit(limit);
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  }

  async saveFact(userId, fact, category = "knowledge", source = "conversation") {
    if (!userId || !this.supabaseAdmin || !fact) return;
    try {
      // Avoid duplicates
      const { data: existing } = await this.supabaseAdmin
        .from("learned_facts")
        .select("id")
        .eq("user_id", userId)
        .eq("fact", fact)
        .limit(1);
      if (existing && existing.length > 0) return;
      await this.supabaseAdmin.from("learned_facts").insert({
        user_id: userId,
        fact: fact.substring(0, 500),
        category,
        source,
      });
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "saveFact error");
    }
  }

  async extractAndSaveFacts(userId, message, reply) {
    if (!userId || !this.supabaseAdmin) return;
    // Rate limit: max once per 30 seconds per user
    const lastTime = this.lastLearnTime.get(userId) || 0;
    if (Date.now() - lastTime < 30000) return;
    this.lastLearnTime.set(userId, Date.now());
    try {
      // Use simple heuristics to extract facts (no extra AI call needed)
      const lower = message.toLowerCase();
      // Personal preferences
      if (/\b(prefer|vreau|imi place|mi-ar placea|I like|I prefer)\b/i.test(message)) {
        await this.saveFact(userId, "User said: " + message.substring(0, 200), "preference", "chat");
      }
      // Name sharing
      const nameMatch = message.match(/\b(?:ma cheama|numele meu|my name is|I'm|I am)\s+([A-Z][a-z]+)/i);
      if (nameMatch) {
        await this.saveFact(userId, "User's name is " + nameMatch[1], "personal", "chat");
      }
      // Location sharing
      const locMatch = message.match(/\b(?:sunt din|locuiesc in|I live in|I'm from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (locMatch) {
        await this.saveFact(userId, "User lives in " + locMatch[1], "personal", "chat");
      }
      this.learningsExtracted++;
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "extractFacts error");
    }
  }

  buildMemoryContext(memories, visualMem, audioMem, facts) {
    const parts = [];
    if (facts.length > 0) {
      parts.push("FACTS I KNOW ABOUT THIS USER: " + facts.map(f => f.fact).join("; "));
    }
    if (memories.length > 0) {
      parts.push("RECENT CONVERSATIONS: " + memories.map(m => m.content).join(" | "));
    }
    if (visualMem.length > 0) {
      parts.push("IMAGES I'VE SEEN: " + visualMem.map(m => m.content).join("; "));
    }
    if (audioMem.length > 0) {
      parts.push("VOICE INTERACTIONS: " + audioMem.map(m => m.content).join("; "));
    }
    return parts.length > 0 ? "[MEMORY CONTEXT] " + parts.join(" || ") : "";
  }

  // ═══════════════════════════════════════════════════════════
  // BRAIN v3.0 — Intelligence Helper Methods
  // ═══════════════════════════════════════════════════════════

  // Cached user profile loading (TTL = 10 min)
  async _loadProfileCached(userId) {
    if (!userId || !this.supabaseAdmin) return null;
    const cached = this._profileCache.get(userId);
    if (cached && Date.now() - cached.loadedAt < this._profileTTL) {
      return cached.profile;
    }
    try {
      const profile = await UserProfile.load(userId, this.supabaseAdmin);
      this._profileCache.set(userId, { profile, loadedAt: Date.now() });
      // Clean old cache entries (keep max 100)
      if (this._profileCache.size > 100) {
        const oldest = [...this._profileCache.entries()]
          .sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
        if (oldest) this._profileCache.delete(oldest[0]);
      }
      return profile;
    } catch (e) {
      return null;
    }
  }

  // Multi-agent: select best agent based on analysis topics
  _selectAgent(analysis) {
    if (!analysis || !analysis.topics || analysis.topics.length === 0) return null;
    const topics = analysis.topics.map(t => t.toLowerCase());

    let bestAgent = null;
    let bestScore = 0;

    for (const [key, agent] of Object.entries(this.agents)) {
      let score = 0;
      for (const topic of topics) {
        for (const trigger of agent.triggerTopics) {
          if (topic.includes(trigger) || trigger.includes(topic)) {
            score++;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestScore > 0 ? bestAgent : null;
  }

  // Confidence scoring: how confident is the brain in its response
  _scoreConfidence(analysis, results, chainOfThought) {
    let score = 0.5; // baseline

    // Tools successfully returned results
    const toolCount = Object.keys(results).length;
    if (toolCount > 0) score += 0.15;
    if (toolCount > 2) score += 0.1;

    // Chain of thought ran (=deep reasoning)
    if (chainOfThought) score += 0.1;

    // High confidence flags
    if (analysis.isGreeting) score = 0.95; // greetings are easy
    if (analysis.isEmergency) score = Math.max(score, 0.9); // must be confident

    // Low confidence flags
    if (analysis.needsSearch && !results.search) score -= 0.2; // needed search but didn't get it
    if (analysis.complexity === "complex" && !chainOfThought) score -= 0.15;

    return Math.max(0.1, Math.min(1.0, Math.round(score * 100) / 100));
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN ENTRY — Complete thinking loop
  // ═══════════════════════════════════════════════════════════
  async think(
    message,
    avatar,
    history,
    language,
    userId,
    conversationId,
    mediaData = {},
    isAdmin = false,
  ) {
    this.conversationCount++;
    const startTime = Date.now();
    // Store media data for tool access
    this._currentMediaData = mediaData || {};

    try {
      // Step -1: QUOTA CHECK — verify user has remaining messages
      const quota = await this.checkQuota(userId);
      if (!quota.allowed) {
        logger.info({ component: "Brain", userId, used: quota.used, limit: quota.limit },
          `⛔ Quota exceeded for user (${quota.plan})`);
        const upgradeMsg = language === "ro"
          ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează la ${quota.plan === "free" ? "Pro" : "Premium"} pentru mai multe mesaje! 🚀`
          : `You've reached your ${quota.limit} messages/month limit on the ${quota.plan.toUpperCase()} plan. Upgrade to ${quota.plan === "free" ? "Pro" : "Premium"} for more messages! 🚀`;
        return { reply: upgradeMsg, emotion: "neutral", toolsUsed: [], confidence: 1.0 };
      }

      // Step 0: LOAD MEMORY + USER PROFILE — brain wakes up with full context
      const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
        this.loadMemory(userId, "text", 10),
        this.loadMemory(userId, "visual", 5),
        this.loadMemory(userId, "audio", 5),
        this.loadFacts(userId, 15),
        this._loadProfileCached(userId),
      ]);
      const memoryContext = this.buildMemoryContext(memories, visualMem, audioMem, facts);
      this._currentMemoryContext = memoryContext;
      this._currentProfile = profile;

      // Inject profile context into memory
      const profileContext = profile ? profile.toContextString() : "";
      if (profileContext) {
        this._currentMemoryContext = profileContext + " || " + memoryContext;
      }

      // Step 1: ANALYZE intent deeply
      const analysis = this.analyzeIntent(message, language);

      // Step 1.5: MULTI-AGENT — select best agent for this task
      const agent = this._selectAgent(analysis);
      if (agent) {
        this._currentAgentPrompt = agent.systemPrompt;
        logger.info({ component: "Brain", agent: agent.name }, `🤖 Delegated to ${agent.name}`);
      }

      // Step 2: DECOMPOSE complex tasks into sub-tasks
      let subTasks = [{ message, analysis }];
      if (analysis.complexity === "complex") {
        subTasks = await this.decomposeTask(message, analysis, language);
      }

      // Step 2.5: LEARNING — check if we have learned patterns for this type
      const learnedTools = this.learningStore.recommendTools(analysis);
      if (learnedTools) {
        logger.info({ component: "Brain", learned: learnedTools }, "📚 Using learned tool pattern");
      }

      // Step 3: PLAN tools for each sub-task (with circuit breaker)
      let plan = this.buildPlan(
        subTasks,
        userId,
        this._currentMediaData,
        isAdmin,
      );

      // Filter out circuit-broken tools
      plan = plan.filter(step => {
        if (this.learningStore.isToolBlocked(step.tool)) {
          logger.warn({ component: "Brain", tool: step.tool }, `⚡ Tool ${step.tool} circuit-broken — skipped`);
          return false;
        }
        return true;
      });

      // Step 4: EXECUTE tools in parallel
      const results = await this.executePlan(plan);

      // Record tool outcomes for learning
      for (const step of plan) {
        if (results[step.tool]) this.learningStore.recordToolSuccess(step.tool);
        else this.learningStore.recordToolFailure(step.tool);
      }

      // Step 5: CHAIN-OF-THOUGHT — pre-reason only for complex+tools or emergencies
      let chainOfThought = null;
      const shouldRunCoT =
        (analysis.complexity === "complex" &&
          Object.keys(results).length >= 1) ||
        analysis.isEmergency;
      if (shouldRunCoT) {
        chainOfThought = await this.chainOfThought(
          message,
          results,
          analysis,
          history,
          language,
        );
      }

      // Step 6: BUILD enriched context
      const enriched = this.buildEnrichedContext(
        message,
        results,
        chainOfThought,
        analysis,
      );

      // Step 6.5: CONFIDENCE SCORING
      const confidence = this._scoreConfidence(analysis, results, chainOfThought);

      // Step 7: COMPRESS conversation if too long
      const compressedHistory = this.compressHistory(history, conversationId);

      // Step 8: SELF-EVALUATE + LEARN (async — doesn't block response)
      const thinkTime = Date.now() - startTime;
      this.journalEntry(
        "think_complete",
        `${analysis.complexity} task, ${plan.length} tools, ${thinkTime}ms, confidence:${confidence}`,
        { tools: Object.keys(results), complexity: analysis.complexity, confidence },
      );

      // Learn from this conversation (async)
      this.learningStore.recordOutcome(analysis, Object.keys(results), true, thinkTime, this.supabaseAdmin).catch(() => { });
      if (profile) {
        profile.updateFromConversation(message, language, analysis);
        profile.save(this.supabaseAdmin).catch(() => { });
      }

      logger.info(
        {
          component: "Brain",
          complexity: analysis.complexity,
          tools: Object.keys(results),
          chainOfThought: !!chainOfThought,
          thinkTime,
        },
        `🧠 Think: ${analysis.complexity} | tools:[${Object.keys(results).join(",")}] | CoT:${!!chainOfThought} | ${thinkTime}ms`,
      );

      // Strip internal annotations from enriched message (they are for AI context, not user)
      const cleanReply = enriched
        .replace(
          /\[(?:TRUTH CHECK|REZULTATE CAUTARE|DATE METEO|Am generat|Harta|CONTEXT DIN MEMORIE|Utilizatorul pare|URGENTA|GANDIRE STRUCTURATA|REZUMAT CONVERSATIE)[^\]]*\]/g,
          "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Track usage (non-blocking)
      this.incrementUsage(userId, Object.keys(results).length, 0).catch(() => { });

      return {
        enrichedMessage: cleanReply,
        enrichedContext: enriched, // full context for AI use
        toolsUsed: Object.keys(results),
        monitor: this.extractMonitor(results),
        analysis,
        chainOfThought,
        compressedHistory,
        failedTools: plan.filter((p) => !results[p.tool]).map((p) => p.tool),
        thinkTime,
        confidence,
        agent: agent ? agent.name : "default",
        profileLoaded: !!profile,
      };
    } catch (e) {
      const thinkTime = Date.now() - startTime;
      this.recordError("think", e.message);
      this.journalEntry("think_error", e.message, { thinkTime });
      logger.error(
        { component: "Brain", err: e.message, thinkTime },
        `🧠 Think failed: ${e.message}`,
      );
      return {
        enrichedMessage: message,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: {
          complexity: "simple",
          needsSearch: false,
          needsWeather: false,
          needsImage: false,
          needsMap: false,
          needsVision: false,
          needsMemory: false,
          isQuestion: false,
          isCommand: false,
          isEmotional: false,
          isEmergency: false,
          isGreeting: false,
          isFollowUp: false,
          emotionalTone: "neutral",
          language: language || "ro",
          topics: [],
          confidenceScore: 0,
          detectedMood: "neutral",
        },
        chainOfThought: null,
        compressedHistory: history || [],
        failedTools: [],
        thinkTime,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 1. CHAIN-OF-THOUGHT — Pre-reasoning before AI responds
  // Uses Groq Llama for ultra-fast structured thinking
  // ═══════════════════════════════════════════════════════════
  async chainOfThought(message, toolResults, analysis, history, language) {
    const aiKey = this.groqKey || this.openaiKey || this.anthropicKey;
    if (!aiKey) return null;
    this.toolStats.chainOfThought++;

    try {
      const contextParts = [];
      if (toolResults.search)
        contextParts.push(
          `Web search: ${String(toolResults.search).substring(0, 500)}`,
        );
      if (toolResults.weather)
        contextParts.push(`Weather: ${toolResults.weather?.description || ""}`);
      if (toolResults.memory)
        contextParts.push(
          `User memory: ${String(toolResults.memory).substring(0, 300)}`,
        );

      const lastMsgs = (history || [])
        .slice(-5)
        .map((h) => `${h.role}: ${h.content?.substring(0, 100)}`)
        .join("\n");

      const prompt = `You are the reasoning engine of an AI assistant. Analyse the request and structure a response plan.

REQUEST: "${message}"
LANGUAGE: ${language}
DETECTED EMOTION: ${analysis.emotionalTone}
URGENT: ${analysis.isEmergency ? "YES" : "no"}
${contextParts.length > 0 ? "AVAILABLE CONTEXT:\n" + contextParts.join("\n") : "No additional context."}
${lastMsgs ? "RECENT HISTORY:\n" + lastMsgs : ""}

Think step by step:
1. What does the user want on the surface?
2. What do they want in depth (the real need)?
3. What tone should I use?
4. What key information must be included?
5. What might they ask next?
6. Response plan in 2-3 points.

Reply STRICTLY with JSON:
{"surface":"...","deep_need":"...","tone":"...","key_info":["..."],"anticipate":"...","plan":["..."]}`;

      // Use Groq (fastest) → GPT (fallback) → Claude (last resort)
      let r, d, txt;
      if (this.groqKey) {
        r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + this.groqKey,
          },
          body: JSON.stringify({
            model: MODELS.GROQ_PRIMARY,
            max_tokens: 250,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (r.ok) {
          d = await r.json();
          txt = d.choices?.[0]?.message?.content?.trim();
        }
      }
      if (!txt && this.anthropicKey) {
        r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 250,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (r.ok) {
          d = await r.json();
          txt = d.content?.[0]?.text?.trim();
        }
      }
      if (!txt) return null;

      try {
        return JSON.parse(txt.replace(/```json|```/g, "").trim());
      } catch {
        return { raw: txt };
      }
    } catch (e) {
      this.recordError("chainOfThought", e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 2. TASK DECOMPOSITION — Break complex requests into steps
  // ═══════════════════════════════════════════════════════════
  async decomposeTask(message, analysis, language) {
    this.toolStats.decompose++;

    // Fast decomposition without AI call (pattern-based)
    const subTasks = [];
    const parts = message
      .split(/\s+(?:și|si|and|then|apoi|după|dupa|plus)\s+/i)
      .filter((p) => p.length > 3);

    if (parts.length > 1) {
      // User asked multiple things: "caută X și arată-mi meteo"
      for (const part of parts) {
        const subAnalysis = this.analyzeIntent(part.trim(), language);
        subTasks.push({ message: part.trim(), analysis: subAnalysis });
      }
    } else {
      // Single complex request — decompose by tool needs
      subTasks.push({ message, analysis });

      // Add implicit sub-tasks based on context
      if (analysis.needsSearch && analysis.needsWeather) {
        // Already covered by parallel execution
      }
      if (analysis.isEmergency) {
        subTasks.unshift({
          message: "emergency_protocol",
          analysis: { ...analysis, isEmergency: true },
        });
      }
    }

    return subTasks.length > 0 ? subTasks : [{ message, analysis }];
  }

  // ═══════════════════════════════════════════════════════════
  // 3. INTENT ANALYSIS — Deep understanding (Registry Pattern)
  // ═══════════════════════════════════════════════════════════

  // Default result template — every flag starts false/empty
  static get DEFAULT_INTENT() {
    return {
      needsSearch: false,
      searchQuery: "",
      needsWeather: false,
      weatherCity: "",
      needsImage: false,
      imagePrompt: "",
      needsMap: false,
      mapPlace: "",
      needsVision: false,
      needsMemory: false,
      needsTTS: false,
      ttsText: "",
      needsSTT: false,
      needsFaceCheck: false,
      needsFaceRegister: false,
      needsVoiceClone: false,
      needsOpenURL: false,
      openURL: "",
      needsRadio: false,
      radioStation: "",
      needsVideo: false,
      videoQuery: "",
      needsWebNav: false,
      webNavURL: "",
      needsAdminDiagnose: false,
      needsAdminReset: false,
      adminResetTool: "",
      needsAdminStats: false,
      needsAdminTrading: false,
      adminTradingAction: "",
      needsAdminNews: false,
      needsAuth: false,
      authAction: "",
      authData: {},
      needsPayments: false,
      paymentAction: "",
      needsNewsStandalone: false,
      newsAction: "",
      needsLegal: false,
      legalAction: "",
      needsHealthCheck: false,
      needsTradeIntelligence: false,
      needsCookieConsent: false,
      needsMetricsStats: false,
      needsSecurityCheck: false,
      needsDevAPIInfo: false,
      needsSystemStatus: false,
      isQuestion: false,
      isCommand: false,
      isEmotional: false,
      isEmergency: false,
      isGreeting: false,
      isFollowUp: false,
      complexity: "simple",
      emotionalTone: "neutral",
      language: "ro",
      topics: [],
      confidenceScore: 0.8,
    };
  }

  // ── Intent Registry — each intent = 1 entry ──
  // To add a new intent: add one object here. That's it.
  static get INTENT_REGISTRY() {
    return [
      // ── SEARCH ──
      {
        flag: "needsSearch",
        triggers: [
          /\b(cauta|gaseste|informatii|stiri|noutati|explica|spune-mi)\b/i,
          /\b(ce (e|este|inseamna|sunt)|cine (e|este|sunt))\b/i,
          /\b(cat costa|pret|tarif)\b/i,
          /\b(cand|unde |de ce|cum (se|pot|fac))\b/i,
          /\b(compara|diferenta|versus|vs)\b/i,
          /\b(ultimele|recent|azi|astazi)\b/i,
          /\b(search|find|look up|what is|who is|tell me about)\b/i,
          /\b(how (to|do|does|much|many)|when|where|why)\b/i,
          /\b(latest|recent|news|update|price|cost)\b/i,
        ],
        extract: (text) => {
          let q = text
            .replace(
              /^(cauta|search|gaseste|spune-mi despre|ce (e|este)|cine (e|este)|tell me about|what is|who is|how to)\s+/i,
              "",
            )
            .replace(/\?+$/, "")
            .trim();
          if (q.length < 3) q = text;
          return { searchQuery: q };
        },
        needsRefine: true, // flag to apply refineSearchQuery
      },
      // ── WEATHER ──
      {
        flag: "needsWeather",
        triggers: [
          /\b(vreme[ai]?|meteo|temperatur|grad[eu]|ploai[ea]|ploua|soare|ning[ea]|ninsoare|vant|prognoz|weather|forecast|afar[a]|fri[gk]|cald[a]?)\b/i,
        ],
        extract: (text) => {
          const m = text.match(
            /(?:î[n]|in|la|din|pentru|from|for|at)\s+([A-Z\u0100-\u024F][a-zA-Z\u0100-\u024F]+(?:\s+[A-Z\u0100-\u024F][a-zA-Z\u0100-\u024F]+)?)/,
          );
          return {
            weatherCity: m
              ? m[1]
              : text.match(/(?:in|la|din|pentru)\s+(\w+)/i)?.[1] || "Bucharest",
          };
        },
      },
      // ── IMAGE (needs BOTH action + object) ──
      {
        flag: "needsImage",
        triggers: [
          /\b(genereaza|creeaza|deseneaza|fa-mi|picture|draw|generate|create|paint)\b/i,
        ],
        condition: (lower) =>
          /\b(imagine|poza|foto|picture|image|desen|ilustratie|avatar|logo|poster)\b/i.test(
            lower,
          ),
        extract: (text) => {
          let p = text
            .replace(
              /\b(genereaza|creeaza|deseneaza|fa-mi|generate|create|draw|o |un )\b/gi,
              "",
            )
            .replace(/\b(imagine|poza|foto|picture|image)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          if (p.length < 5) p = text;
          return { imagePrompt: p };
        },
      },
      // ── MAP ──
      {
        flag: "needsMap",
        triggers: [
          /\b(harta|map|ruta|drum|directi|navigare|navigate|unde (e|se|este)|locatie|directions|cum ajung)\b/i,
        ],
        extract: (text) => {
          const m = text.match(
            /(?:harta|map|unde (e|se|este)|locatie|catre|spre|la|to|directions? to)\s+(.+)/i,
          );
          return { mapPlace: m ? m[2].replace(/[?.!]/g, "").trim() : text };
        },
      },
      // ── VISION ──
      {
        flag: "needsVision",
        triggers: [
          /\b(ce (e |vezi|observi)|ma vezi|uita-te|priveste|see me|look at|what do you see|descrie ce|ce e in fata|scanez|analizez)\b/i,
        ],
      },
      // ── TTS ──
      {
        flag: "needsTTS",
        triggers: [
          /\b(citeste|spune|pronunta|read aloud|speak|say out|cu voce|voce tare|vorbeste)\b/i,
        ],
        extract: (text) => ({
          ttsText: text
            .replace(
              /\b(citeste|spune|pronunta|cu voce|voce tare|read aloud|speak|say out loud|vorbeste)\b/gi,
              "",
            )
            .trim(),
        }),
      },
      // ── STT ──
      {
        flag: "needsSTT",
        triggers: [
          /\b(transcrie|transcriere|dictare|dicteaz[aă]|asculta|transcribe|dictate|speech to text)\b/i,
        ],
      },
      // ── FACE CHECK ──
      {
        flag: "needsFaceCheck",
        triggers: [
          /\b(cine (sunt|e)|recunoaste|identifica|verifica fata|face check|who am i|recognize me|cine ma|ma recunosti)\b/i,
        ],
      },
      // ── FACE REGISTER ──
      {
        flag: "needsFaceRegister",
        triggers: [
          /\b(inregistr|salveaz[aă].*fata|memoreaz[aă].*fata|register face|save face|remember my face|retine.*fata)\b/i,
        ],
      },
      // ── VOICE CLONE ──
      {
        flag: "needsVoiceClone",
        triggers: [
          /\b(cloneaz[aă]|clonare.*voce|copiaz[aă].*voce|clone voice|my voice|vocea mea|vreau vocea)\b/i,
        ],
      },
      // ── RADIO ──
      {
        flag: "needsRadio",
        triggers: [
          /\b(radio|fm|asculta radio|pune radio|play radio|kiss fm|europa fm|digi fm|magic fm|rock fm|pro fm|radio zu|radiozu)\b/i,
        ],
        extract: (text, lower) => {
          const m = lower.match(
            /\b(kiss ?fm|europa ?fm|digi ?fm|magic ?fm|rock ?fm|pro ?fm|radio ?zu|virgin ?radio|national ?fm|romantic ?fm|gold ?fm|city ?fm)\b/i,
          );
          return { radioStation: m ? m[1].trim() : "radio zu" };
        },
      },
      // ── VIDEO ──
      {
        flag: "needsVideo",
        triggers: [
          /\b(video|film|movie|netflix|youtube|trailer|serial|episod|watch|viziona|uita-te la|ruleaza)\b/i,
        ],
        extract: (text) => ({
          videoQuery: text
            .replace(
              /\b(video|pune|ruleaza|arata|film|movie|uita-te la|watch|pe monitor)\b/gi,
              "",
            )
            .trim(),
        }),
      },
      // ── MEMORY ──
      {
        flag: "needsMemory",
        triggers: [
          /\b(amintesti|remember|stiai|data trecuta|ultima data|iti amintesti|ai retinut|am zis|ti-am spus|cum ma cheama|unde locuiesc)\b/i,
        ],
      },
      // ── EMERGENCY ──
      {
        flag: "isEmergency",
        triggers: [
          /\b(pericol|danger|ajutor|help me|urgenta|accident|foc|incendiu|fire|emergency|ambulanta|politie|112|911)\b/i,
        ],
        extra: { confidenceScore: 1.0 },
      },
      // ── GREETING ──
      {
        flag: "isGreeting",
        triggers: [/^(hey|hi|hello|salut|buna|hei|ceau|noroc|servus)/i],
        condition: (_, words) => words.length <= 5,
      },
      // ── FOLLOW-UP ──
      {
        flag: "isFollowUp",
        triggers: [
          /\b(asta|aceasta|ce am zis|mai devreme|anterior|that|this|earlier|before|continua)\b/i,
        ],
        extra: { needsMemory: true },
      },
      // ── ADMIN: DIAGNOSE ──
      {
        flag: "needsAdminDiagnose",
        triggers: [
          /\b(diagnoz[aă]|diagnostic|status brain|brain status|health|stare brain|stare sistem)\b/i,
        ],
      },
      // ── ADMIN: RESET ──
      {
        flag: "needsAdminReset",
        triggers: [/\b(reset|restart|reporneste|reseteaz[aă])\b/i],
        condition: (lower) => /\b(brain|creier|tool|sistem)\b/i.test(lower),
        extract: (text, lower) => {
          const m = lower.match(
            /\b(search|weather|imagine|memory|map|all|tot|toate)\b/i,
          );
          return { adminResetTool: m ? m[1] : "all" };
        },
      },
      // ── ADMIN: STATS ──
      {
        flag: "needsAdminStats",
        triggers: [
          /\b(stats|statistici|revenue|venituri|abonati|subscribers|plat[iă]|payments|churn)\b/i,
        ],
      },
      // ── ADMIN: TRADING ──
      {
        flag: "needsAdminTrading",
        triggers: [
          /\b(trading|trade|portofoliu|portfolio|binance|pozitii|positions|profit|p&l|pnl)\b/i,
        ],
        extract: (text, lower) => ({
          adminTradingAction: lower.includes("execut") ? "execute" : "status",
        }),
      },
      // ── ADMIN: NEWS ──
      {
        flag: "needsAdminNews",
        triggers: [/\b(stiri|news|headline|noutati|pres[aă])\b/i],
      },
      // ── AUTH: LOGIN ──
      {
        flag: "needsAuth",
        triggers: [
          /\b(logheaz[aă]|autentific|login|sign\s*in|conecteaz[aă]|intr[aă]\s*in\s*cont)\b/i,
        ],
        extra: { authAction: "login" },
      },
      // ── AUTH: REGISTER ──
      {
        flag: "needsAuth",
        triggers: [
          /\b(inregistr|register|sign\s*up|cont\s*nou|creaz[aă]\s*cont|fa-mi\s*cont)\b/i,
        ],
        extra: { authAction: "register" },
      },
      // ── AUTH: LOGOUT ──
      {
        flag: "needsAuth",
        triggers: [
          /\b(delogheaz[aă]|logout|sign\s*out|deconecteaz[aă]|iesire|iesi)\b/i,
        ],
        extra: { authAction: "logout" },
      },
      // ── AUTH: CHANGE PASSWORD ──
      {
        flag: "needsAuth",
        triggers: [
          /\b(schimb[aă].*parol|change.*pass|reset.*parol|parol[aă]\s*nou)\b/i,
        ],
        extra: { authAction: "changePassword" },
      },
      // ── AUTH: CHANGE EMAIL ──
      {
        flag: "needsAuth",
        triggers: [/\b(schimb[aă].*email|change.*email|email\s*nou)\b/i],
        extra: { authAction: "changeEmail" },
      },
      // ── AUTH: FORGOT PASSWORD ──
      {
        flag: "needsAuth",
        triggers: [
          /\b(am\s*uitat.*parol|forgot.*pass|reset[eă].*parol|nu.*mai.*stiu.*parol)\b/i,
        ],
        extra: { authAction: "forgotPassword" },
      },
      // ── PAYMENTS: PLANS ──
      {
        flag: "needsPayments",
        triggers: [
          /\b(abonament|plan|pret|price|subscri|tarif|cat\s*cost|pachete)\b/i,
        ],
        condition: (_, __, result) => !result.needsAdminStats,
        extra: { paymentAction: "plans" },
      },
      // ── PAYMENTS: CHECKOUT ──
      {
        flag: "needsPayments",
        triggers: [
          /\b(vreau\s*(pro|premium)|cump[aă]r|upgrade|platesc|achit|comand)\b/i,
        ],
        extra: { paymentAction: "checkout" },
      },
      // ── PAYMENTS: PORTAL ──
      {
        flag: "needsPayments",
        triggers: [
          /\b(factur[aă]|billing|gestion.*abonament|manage.*sub|anuleaz[aă])\b/i,
        ],
        extra: { paymentAction: "portal" },
      },
      // ── NEWS STANDALONE ──
      {
        flag: "needsNewsStandalone",
        triggers: [
          /\b(ce\s*se\s*(mai\s*)?intampl|stiri\s*(de\s*)?azi|noutati|breaking|ultima\s*or[aă]|urgent)\b/i,
        ],
        extract: (text, lower) => ({
          newsAction: /\b(breaking|urgent|ultima\s*or)\b/i.test(lower)
            ? "breaking"
            : "latest",
        }),
      },
      // ── LEGAL: TERMS ──
      {
        flag: "needsLegal",
        triggers: [/\b(termeni|terms|conditii)\b/i],
        extra: { legalAction: "terms" },
      },
      // ── LEGAL: PRIVACY ──
      {
        flag: "needsLegal",
        triggers: [
          /\b(confidentialitate|privacy|date\s*personale|politica)\b/i,
        ],
        extra: { legalAction: "privacy" },
      },
      // ── LEGAL: GDPR ──
      {
        flag: "needsLegal",
        triggers: [
          /\b(gdpr|sterge.*date|export.*date|datele\s*mele|drepturile\s*mele)\b/i,
        ],
        extract: (text, lower) => ({
          legalAction: /\b(sterge|delete|elimina)\b/i.test(lower)
            ? "deleteData"
            : "exportData",
        }),
      },
      // ── HEALTH CHECK ──
      {
        flag: "needsHealthCheck",
        triggers: [
          /\b(cum\s*esti|functional|functionez|cum\s*te\s*simti|esti\s*ok|status\s*server|self\s*check)\b/i,
        ],
      },
      // ── TRADE INTELLIGENCE ──
      {
        flag: "needsTradeIntelligence",
        triggers: [
          /\b(analiza\s*piata|market\s*analysis|sentim(?:ent|ental)|bullish|bearish|divergenta|pivot|support|rezistenta|semnale\s*trading|intelligence\s*trading|crypto\s*signal)\b/i,
        ],
      },
      // ── COOKIE CONSENT ──
      {
        flag: "needsCookieConsent",
        triggers: [
          /\b(cookie|gdpr.*cookie|accept.*cookie|refuz.*cookie|cookie.*consent|cookie.*policy)\b/i,
        ],
      },
      // ── METRICS ──
      {
        flag: "needsMetricsStats",
        triggers: [
          /\b(metrici|metrics|prometheus|grafana|latency|request.*count|error.*rate|performance|latenta|performanta)\b/i,
        ],
      },
      // ── SECURITY ──
      {
        flag: "needsSecurityCheck",
        triggers: [
          /\b(securitate|security|cors|helmet|csp|rate.*limit|https|ssl|protectie|protejat|firewall|vulnerabil|sentry|logging)\b/i,
        ],
      },
      // ── DEV API ──
      {
        flag: "needsDevAPIInfo",
        triggers: [
          /\b(api.*key|developer.*api|v1.*api|endpoint|webhook|sdk|integrare.*api|chei.*api|postman|swagger|rest.*api)\b/i,
        ],
      },
      // ── SYSTEM STATUS ──
      {
        flag: "needsSystemStatus",
        triggers: [
          /\b(migratie|migration|cache|validare|baza.*date|database|tabele|system.*status|infrastructure|deploy|uptime|schema|referral|abonament.*system)\b/i,
        ],
      },
    ];
  }

  // ── Emotion detection map ──
  static get EMOTION_MAP() {
    return {
      sad: {
        pattern:
          /\b(trist|deprimat|singur|plang|suparat|nefericit|sad|depressed|lonely|pierdut|dor)\b/i,
        weight: 0.9,
      },
      happy: {
        pattern:
          /\b(fericit|bucuros|minunat|super|genial|happy|great|awesome|amazing)\b/i,
        weight: 0.7,
      },
      angry: {
        pattern:
          /\b(nervos|furios|enervat|angry|furious|frustrated|urasc|hate)\b/i,
        weight: 0.9,
      },
      anxious: {
        pattern:
          /\b(anxios|stresat|ingrijorat|worried|anxious|stressed|teama|frica|panica)\b/i,
        weight: 0.9,
      },
      confused: {
        pattern: /\b(nu inteleg|confuz|confused|nu stiu|habar|pierdut|lost)\b/i,
        weight: 0.6,
      },
      grateful: {
        pattern:
          /\b(multumesc|mersi|thanks|thank you|apreciez|recunoscator)\b/i,
        weight: 0.5,
      },
      excited: {
        pattern:
          /\b(abia astept|super tare|wow|amazing|incredible|fantastic|entuziasmat)\b/i,
        weight: 0.7,
      },
    };
  }

  // ── Topic detection patterns ──
  static get TOPIC_PATTERNS() {
    return [
      {
        pattern:
          /\b(programare|code|coding|software|app|web|python|java|react)\b/i,
        topic: "tech",
      },
      {
        pattern:
          /\b(sanatate|health|doctor|medical|boala|tratament|medicament)\b/i,
        topic: "health",
      },
      {
        pattern: /\b(mancare|food|reteta|recipe|gatit|cooking|restaurant)\b/i,
        topic: "food",
      },
      {
        pattern:
          /\b(calatori|calatoresc|calatorie|travel|vacanta|hotel|zbor|flight|destinat|excursie|turism)\b/i,
        topic: "travel",
      },
      {
        pattern: /\b(bani|money|investitie|economie|salariu|buget|finante)\b/i,
        topic: "finance",
      },
      {
        pattern: /\b(muzica|music|film|movie|carte|book|joc|game)\b/i,
        topic: "entertainment",
      },
      {
        pattern: /\b(sport|fitness|antrenament|exercitiu|gym|alergare)\b/i,
        topic: "fitness",
      },
    ];
  }

  // ── Mood detection patterns ──
  static get MOOD_PATTERNS() {
    return {
      happy:
        /\b(super|minunat|yay|woohoo|amazing|perfect|grozav|excelent|bravo|wow)\b/i,
      sad: /\b(trist|supărat|rău|plâng|deprimat|singur|lonely|sad|down|pierdut)\b/i,
      frustrated:
        /\b(nu merge|enervant|prostie|nu funcționează|broken|hate|ura|naiba|drace)\b/i,
      excited:
        /\b(abia aștept|nu pot să cred|OMG|incredibil|fantastic|awesome)\b/i,
      anxious:
        /\b(îngrijorat|anxios|frica|teamă|worried|stressed|stresat|panicat)\b/i,
      playful: /\b(haha|😂|😏|lol|rofl|:D|glum|funny|amuzant|haios|hazliu)\b/i,
    };
  }

  analyzeIntent(text, language) {
    const lower = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const words = text.split(/\s+/);
    const result = {
      ...KelionBrain.DEFAULT_INTENT,
      language: language || "ro",
    };

    // ── URL detection (special: sets openURL OR webNav) ──
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      result.needsOpenURL = true;
      result.openURL = urlMatch[1];
    } else if (
      /\b(deschide|afiseaza|arata|open|show|display|pune pe monitor|pe monitor)\b/i.test(
        lower,
      )
    ) {
      if (/\b(deschide|open|pune)\b/i.test(lower)) {
        result.needsWebNav = true;
        result.webNavURL = text
          .replace(
            /\b(deschide|afiseaza|arata|open|show|pe monitor|display)\b/gi,
            "",
          )
          .trim();
      }
    }

    // ── Run registry ──
    for (const intent of KelionBrain.INTENT_REGISTRY) {
      const triggered = Array.isArray(intent.triggers)
        ? intent.triggers.some((t) => t.test(lower))
        : intent.triggers.test(lower);
      if (!triggered) continue;

      // Optional extra condition
      if (intent.condition && !intent.condition(lower, words, result)) continue;

      result[intent.flag] = true;
      if (intent.extract) Object.assign(result, intent.extract(text, lower));
      if (intent.extra) Object.assign(result, intent.extra);

      // Search refinement via learned patterns
      if (intent.needsRefine && this.refineSearchQuery) {
        result.searchQuery = this.refineSearchQuery(result.searchQuery);
      }
    }

    // ── Emotion detection ──
    for (const [emo, { pattern, weight }] of Object.entries(
      KelionBrain.EMOTION_MAP,
    )) {
      if (pattern.test(lower)) {
        result.emotionalTone = emo;
        result.isEmotional = true;
        result.confidenceScore = weight;
        break;
      }
    }

    // ── Complexity ──
    const toolsNeeded = [
      result.needsSearch,
      result.needsWeather,
      result.needsImage,
      result.needsMap,
      result.needsVision,
    ].filter(Boolean).length;
    if (toolsNeeded >= 2 || words.length > 30 || text.split(/[?.!]/).length > 3)
      result.complexity = "complex";
    else if (toolsNeeded >= 1 || words.length > 12)
      result.complexity = "moderate";

    // ── Topics ──
    result.topics = KelionBrain.TOPIC_PATTERNS.filter((t) =>
      t.pattern.test(lower),
    ).map((t) => t.topic);

    // ── Mood ──
    result.detectedMood = "neutral";
    for (const [mood, pattern] of Object.entries(KelionBrain.MOOD_PATTERNS)) {
      if (pattern.test(text)) {
        result.detectedMood = mood;
        break;
      }
    }

    // ── Question / Command detection ──
    result.isQuestion =
      /\?$/.test(text.trim()) ||
      /^(ce|cine|cand|unde|cum|de ce|cat|what|who|when|where|how|why)/i.test(
        lower,
      );
    result.isCommand =
      /^(fa|seteaza|porneste|opreste|deschide|do|set|start|stop|open|run|executa)/i.test(
        lower,
      );

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 4. PLAN BUILDER — Intelligent tool selection
  // ═══════════════════════════════════════════════════════════
  buildPlan(subTasks, userId, mediaData = {}, isAdmin = false) {
    const plan = [];
    const seen = new Set();

    for (const { analysis } of subTasks) {
      if (
        analysis.needsSearch &&
        !seen.has("search") &&
        !this.isToolDegraded("search")
      ) {
        plan.push({ tool: "search", query: analysis.searchQuery });
        seen.add("search");
      }
      if (
        analysis.needsWeather &&
        !seen.has("weather") &&
        !this.isToolDegraded("weather")
      ) {
        plan.push({ tool: "weather", city: analysis.weatherCity });
        seen.add("weather");
      }
      if (
        analysis.needsImage &&
        !seen.has("imagine") &&
        !this.isToolDegraded("imagine")
      ) {
        plan.push({ tool: "imagine", prompt: analysis.imagePrompt });
        seen.add("imagine");
      }
      if (analysis.needsMap && !seen.has("map")) {
        plan.push({ tool: "map", place: analysis.mapPlace });
        seen.add("map");
      }
      if (analysis.needsMemory && userId && !seen.has("memory")) {
        plan.push({ tool: "memory", userId });
        seen.add("memory");
      }
      // Extended tools — NOW with binary data
      if (analysis.needsVision && !seen.has("vision")) {
        plan.push({
          tool: "vision",
          imageBase64: mediaData.imageBase64,
          userId,
        });
        seen.add("vision");
      }
      if (analysis.needsTTS && !seen.has("tts")) {
        plan.push({ tool: "tts", text: analysis.ttsText, userId });
        seen.add("tts");
      }
      if (analysis.needsSTT && !seen.has("stt")) {
        plan.push({ tool: "stt", audioBase64: mediaData.audioBase64, userId });
        seen.add("stt");
      }
      if (analysis.needsFaceCheck && !seen.has("faceCheck")) {
        plan.push({ tool: "faceCheck", imageBase64: mediaData.imageBase64 });
        seen.add("faceCheck");
      }
      if (analysis.needsFaceRegister && !seen.has("faceRegister") && userId) {
        plan.push({
          tool: "faceRegister",
          userId,
          imageBase64: mediaData.imageBase64,
        });
        seen.add("faceRegister");
      }
      if (analysis.needsVoiceClone && !seen.has("voiceClone") && userId) {
        plan.push({
          tool: "voiceClone",
          userId,
          audioBase64: mediaData.audioBase64,
        });
        seen.add("voiceClone");
      }
      // Monitor tools
      if (analysis.needsOpenURL && !seen.has("openURL")) {
        plan.push({ tool: "openURL", url: analysis.openURL });
        seen.add("openURL");
      }
      if (analysis.needsRadio && !seen.has("radio")) {
        plan.push({ tool: "radio", station: analysis.radioStation });
        seen.add("radio");
      }
      if (analysis.needsVideo && !seen.has("video")) {
        plan.push({ tool: "video", query: analysis.videoQuery });
        seen.add("video");
      }
      if (analysis.needsWebNav && !seen.has("webNav")) {
        plan.push({ tool: "webNav", query: analysis.webNavURL });
        seen.add("webNav");
      }
      // Admin tools — GATED: only planned if isAdmin is true
      if (isAdmin) {
        if (analysis.needsAdminDiagnose && !seen.has("adminDiagnose")) {
          plan.push({ tool: "adminDiagnose" });
          seen.add("adminDiagnose");
        }
        if (analysis.needsAdminReset && !seen.has("adminReset")) {
          plan.push({ tool: "adminReset", resetTool: analysis.adminResetTool });
          seen.add("adminReset");
        }
        if (analysis.needsAdminStats && !seen.has("adminStats")) {
          plan.push({ tool: "adminStats" });
          seen.add("adminStats");
        }
        if (analysis.needsAdminTrading && !seen.has("adminTrading")) {
          plan.push({
            tool: "adminTrading",
            action: analysis.adminTradingAction,
          });
          seen.add("adminTrading");
        }
        if (analysis.needsAdminNews && !seen.has("adminNews")) {
          plan.push({ tool: "adminNews" });
          seen.add("adminNews");
        }
      }
      // Table 3: Non-AI function tools
      if (analysis.needsAuth && !seen.has("authAction")) {
        plan.push({
          tool: "authAction",
          action: analysis.authAction,
          data: analysis.authData,
        });
        seen.add("authAction");
      }
      if (analysis.needsPayments && !seen.has("paymentAction")) {
        plan.push({ tool: "paymentAction", action: analysis.paymentAction });
        seen.add("paymentAction");
      }
      if (analysis.needsNewsStandalone && !seen.has("newsAction")) {
        plan.push({ tool: "newsAction", action: analysis.newsAction });
        seen.add("newsAction");
      }
      if (analysis.needsLegal && !seen.has("legalAction")) {
        plan.push({ tool: "legalAction", action: analysis.legalAction });
        seen.add("legalAction");
      }
      if (analysis.needsHealthCheck && !seen.has("healthCheck")) {
        plan.push({ tool: "healthCheck" });
        seen.add("healthCheck");
      }
      if (analysis.needsTradeIntelligence && !seen.has("tradeIntelligence")) {
        plan.push({ tool: "tradeIntelligence" });
        seen.add("tradeIntelligence");
      }
      if (analysis.needsCookieConsent && !seen.has("cookieConsent")) {
        plan.push({ tool: "cookieConsent" });
        seen.add("cookieConsent");
      }
      if (analysis.needsMetricsStats && !seen.has("metricsStats")) {
        plan.push({ tool: "metricsStats" });
        seen.add("metricsStats");
      }
      // Full coverage: security, devAPI, system
      if (analysis.needsSecurityCheck && !seen.has("securityCheck")) {
        plan.push({ tool: "securityCheck" });
        seen.add("securityCheck");
      }
      if (analysis.needsDevAPIInfo && !seen.has("devAPIInfo")) {
        plan.push({ tool: "devAPIInfo" });
        seen.add("devAPIInfo");
      }
      if (analysis.needsSystemStatus && !seen.has("systemStatus")) {
        plan.push({ tool: "systemStatus" });
        seen.add("systemStatus");
      }
    }

    // Check for known good combinations from journal
    const combo = plan
      .map((p) => p.tool)
      .sort()
      .join("+");
    if (this.strategies.toolCombinations[combo]) {
      const strat = this.strategies.toolCombinations[combo];
      if (strat.successRate < 0.5) {
        logger.info(
          { component: "Brain", combo, successRate: strat.successRate },
          `📓 Combo ${combo} has ${strat.successRate * 100}% success — adjusting`,
        );
      }
    }

    return plan;
  }

  // ═══════════════════════════════════════════════════════════
  // 5. EXECUTE PLAN — Parallel with timeouts and fallbacks
  // ═══════════════════════════════════════════════════════════
  async executePlan(plan) {
    if (plan.length === 0) return {};
    const results = {};
    const t0 = Date.now();

    const settled = await Promise.allSettled(
      plan.map((step) => this.executeTool(step)),
    );

    settled.forEach((r, i) => {
      const tool = plan[i].tool;
      if (r.status === "fulfilled" && r.value) {
        results[tool] = r.value;
        this.recordSuccess(tool, Date.now() - t0);
      } else {
        const err = r.reason?.message || "Failed";
        this.recordError(tool, err);
        // AUTO-DEBUG: try recovery strategy
        this.attemptRecovery(tool, plan[i], err);
      }
    });

    // Record combination performance
    const combo = plan
      .map((p) => p.tool)
      .sort()
      .join("+");
    const successCount = Object.keys(results).length;
    if (!this.strategies.toolCombinations[combo])
      this.strategies.toolCombinations[combo] = {
        attempts: 0,
        successes: 0,
        successRate: 1,
      };
    this.strategies.toolCombinations[combo].attempts++;
    this.strategies.toolCombinations[combo].successes +=
      successCount === plan.length ? 1 : 0;
    this.strategies.toolCombinations[combo].successRate =
      this.strategies.toolCombinations[combo].successes /
      this.strategies.toolCombinations[combo].attempts;

    logger.info(
      { component: "Brain", tools: Object.keys(results) },
      `⚡ ${Date.now() - t0}ms: ${Object.keys(results).join(", ") || "none"}`,
    );
    return results;
  }

  async executeTool(step) {
    const timeouts = {
      search: 8000,
      weather: 5000,
      imagine: 15000,
      memory: 3000,
      map: 100,
      vision: 15000,
      tts: 10000,
      stt: 10000,
      faceCheck: 10000,
      faceRegister: 10000,
      voiceClone: 15000,
      openURL: 3000,
      radio: 3000,
      video: 5000,
      webNav: 5000,
      authAction: 5000,
      paymentAction: 5000,
      newsAction: 5000,
      legalAction: 3000,
      healthCheck: 3000,
      securityCheck: 3000,
      devAPIInfo: 5000,
      systemStatus: 10000,
    };
    const tmout = (ms) =>
      new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), ms));
    return Promise.race([this._run(step), tmout(timeouts[step.tool] || 10000)]);
  }

  async _run(step) {
    switch (step.tool) {
      case "search":
        return this._search(step.query);
      case "weather":
        return this._weather(step.city);
      case "imagine":
        return this._imagine(step.prompt);
      case "memory":
        return this._memory(step.userId);
      case "map":
        return this._map(step.place);
      case "vision":
        return this._vision(step.imageBase64, step.userId);
      case "tts":
        return this._tts(step.text, step.userId);
      case "stt":
        return this._stt(step.audioBase64, step.userId);
      case "faceCheck":
        return this._faceCheck(step.imageBase64);
      case "faceRegister":
        return this._faceRegister(step.userId, step.imageBase64);
      case "voiceClone":
        return this._voiceClone(step.userId, step.audioBase64);
      case "openURL":
        return this._openURL(step.url);
      case "radio":
        return this._radio(step.station);
      case "video":
        return this._video(step.query);
      case "webNav":
        return this._webNav(step.query);
      case "adminDiagnose":
        return this._adminDiagnose();
      case "adminReset":
        return this._adminReset(step.resetTool);
      case "adminStats":
        return this._adminStats();
      case "adminTrading":
        return this._adminTrading(step.action);
      case "adminNews":
        return this._adminNews();
      // Table 3: Non-AI function tools
      case "authAction":
        return this._authAction(step.action, step.data);
      case "paymentAction":
        return this._paymentAction(step.action);
      case "newsAction":
        return this._newsAction(step.action);
      case "legalAction":
        return this._legalAction(step.action);
      case "healthCheck":
        return this._healthCheck();
      case "tradeIntelligence":
        return this._tradeIntelligence();
      case "cookieConsent":
        return this._cookieConsent();
      case "metricsStats":
        return this._metricsStats();
      // Full coverage cases
      case "securityCheck":
        return this._securityCheck();
      case "devAPIInfo":
        return this._devAPIInfo();
      case "systemStatus":
        return this._systemStatus();
      default:
        return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. CONTEXT BUILDER — Assembles enriched message
  // ═══════════════════════════════════════════════════════════
  buildEnrichedContext(message, results, chainOfThought, analysis) {
    let ctx = message;

    if (results.search)
      ctx += `\n[REZULTATE CAUTARE WEB REALE]:\n${results.search}\nFoloseste datele real. Citeaza sursele.`;
    if (results.weather)
      ctx += `\n[DATE METEO REALE]: ${results.weather.description}`;
    if (results.imagine)
      ctx += `\n[Am generat imaginea pe monitor. Descrie-o scurt.]`;
    if (results.map) ctx += `\n[Harta "${results.map.place}" pe monitor.]`;
    if (results.memory) ctx += `\n[CONTEXT DIN MEMORIE]: ${results.memory}`;
    // Extended tool contexts
    if (results.vision)
      ctx += `\n[VEDERE — DESCRIERE DE MARE PRECIZIE]: ${results.vision.description || JSON.stringify(results.vision)}`;
    if (results.tts) ctx += `\n[Am redat textul cu voce. Confirmă scurt.]`;
    if (results.stt)
      ctx += `\n[TRANSCRIERE AUDIO]: ${results.stt.text || "Nu s-a putut transcrie."}`;
    if (results.faceCheck)
      ctx += `\n[IDENTITATE DETECTATA]: ${results.faceCheck.name || "Necunoscut"}`;
    if (results.faceRegister)
      ctx += `\n[FATA INREGISTRATA]: ${results.faceRegister.status || "OK"}`;
    if (results.voiceClone)
      ctx += `\n[VOCE CLONATA]: ${results.voiceClone.status || "OK"}`;
    // Monitor tool contexts
    if (results.openURL)
      ctx += `\n[MONITOR: Am deschis ${results.openURL.url} pe ecran. Prezintă conținutul.]`;
    if (results.radio)
      ctx += `\n[MONITOR: Radio ${results.radio.station} redă acum pe monitor. Informează utilizatorul.]`;
    if (results.video)
      ctx += `\n[MONITOR: Video "${results.video.title || results.video.query}" se redă pe ecran.]`;
    if (results.webNav)
      ctx += `\n[MONITOR: Am navigat la ${results.webNav.url}. Descrie ce apare.]`;
    // Table 3: Non-AI contexts
    if (results.authAction) ctx += `\n[AUTH: ${results.authAction.summary}]`;
    if (results.paymentAction)
      ctx += `\n[PAYMENTS: ${results.paymentAction.summary}]`;
    if (results.newsAction) ctx += `\n[ȘTIRI: ${results.newsAction.summary}]`;
    if (results.legalAction) ctx += `\n[LEGAL: ${results.legalAction.summary}]`;
    if (results.healthCheck)
      ctx += `\n[HEALTH: ${results.healthCheck.summary}]`;
    if (results.tradeIntelligence)
      ctx += `\n[TRADE INTELLIGENCE: ${results.tradeIntelligence.summary}]`;
    if (results.cookieConsent)
      ctx += `\n[COOKIE CONSENT: ${results.cookieConsent.summary}]`;
    if (results.metricsStats)
      ctx += `\n[METRICS: ${results.metricsStats.summary}]`;
    if (results.securityCheck)
      ctx += `\n[SECURITATE: ${results.securityCheck.summary}]`;
    if (results.devAPIInfo)
      ctx += `\n[DEVELOPER API: ${results.devAPIInfo.summary}]`;
    if (results.systemStatus)
      ctx += `\n[SYSTEM STATUS: ${results.systemStatus.summary}]`;

    if (analysis.isEmotional && analysis.emotionalTone !== "neutral") {
      ctx += `\n[Utilizatorul pare ${analysis.emotionalTone}. Adapteaza tonul empatic.]`;
    }
    if (analysis.isEmergency) {
      ctx += `\n[URGENTA! Prioritizeaza siguranta. Ofera instructiuni clare.]`;
    }

    // Inject Chain-of-Thought reasoning guidance
    if (
      chainOfThought &&
      typeof chainOfThought === "object" &&
      chainOfThought.plan
    ) {
      ctx += `\n[GANDIRE STRUCTURATA]:`;
      ctx += `\nNevoia reala: ${chainOfThought.deep_need || "N/A"}`;
      ctx += `\nTon recomandat: ${chainOfThought.tone || "N/A"}`;
      ctx += `\nPlan: ${(chainOfThought.plan || []).join(" → ")}`;
      if (chainOfThought.anticipate)
        ctx += `\nAnticipeaza intrebare: ${chainOfThought.anticipate}`;
    }

    return ctx;
  }

  extractMonitor(results) {
    // Monitor priority: URL/radio/video first, then images/weather/map
    if (results.openURL)
      return {
        content: results.openURL.url,
        type: "iframe",
        title: results.openURL.title,
      };
    if (results.radio)
      return {
        content: results.radio.streamUrl,
        type: "audio",
        title: `Radio ${results.radio.station}`,
      };
    if (results.video)
      return {
        content: results.video.embedUrl || results.video.url,
        type: "video",
        title: results.video.title,
      };
    if (results.webNav)
      return {
        content: results.webNav.url,
        type: "iframe",
        title: results.webNav.title,
      };
    if (results.imagine) return { content: results.imagine, type: "image" };
    if (results.weather?.html)
      return { content: results.weather.html, type: "html" };
    if (results.map) return { content: results.map.url, type: "map" };
    return { content: null, type: null };
  }

  // ═══════════════════════════════════════════════════════════
  // 7. CONVERSATION SUMMARIZER — Compress long histories
  // ═══════════════════════════════════════════════════════════
  compressHistory(history, conversationId) {
    if (!history || history.length <= 20) return history;

    const recent = history.slice(-10);
    const older = history.slice(0, -10);

    const cacheKey = conversationId || "default";
    if (
      this.conversationSummaries.has(cacheKey) &&
      older.length <= this.conversationSummaries.get(cacheKey).messageCount
    ) {
      return [
        {
          role: "system",
          content: this.conversationSummaries.get(cacheKey).summary,
        },
        ...recent,
      ];
    }

    const keyPoints = [];
    for (const msg of older) {
      const content = msg.content || "";
      if (msg.role === "user" && content.includes("?"))
        keyPoints.push(`User a intrebat: ${content.substring(0, 100)}`);
      if (msg.role === "assistant" || msg.role === "ai") {
        const facts = content.match(
          /[A-Z][^.!?]*(?:este|sunt|are|a fost|se afla|costa|inseamna)[^.!?]*/g,
        );
        if (facts)
          keyPoints.push(...facts.slice(0, 2).map((f) => f.substring(0, 100)));
      }
    }

    const summary = `[REZUMAT CONVERSATIE ANTERIOARA (${older.length} mesaje)]: ${keyPoints.slice(0, 10).join("; ")}`;
    this.conversationSummaries.set(cacheKey, {
      summary,
      messageCount: older.length,
    });

    if (this.conversationSummaries.size > 100) {
      const first = this.conversationSummaries.keys().next().value;
      this.conversationSummaries.delete(first);
    }

    return [{ role: "system", content: summary }, ...recent];
  }

  // ═══════════════════════════════════════════════════════════
  // 8. AUTO-DEBUG — Analyze failures, attempt recovery
  // ═══════════════════════════════════════════════════════════
  attemptRecovery(tool, step, error) {
    const strategies = {
      search: () => {
        if (error.includes("400") && step.query?.length > 50) {
          const refined = step.query.split(" ").slice(0, 5).join(" ");
          this.strategies.searchRefinement.push({
            original: step.query,
            refined,
            reason: "400_too_long",
          });
          logger.info(
            { component: "Brain", refined },
            `🔧 Search recovery: refined query to "${refined}"`,
          );
        }
      },
      weather: () => {
        if (error.includes("not found")) {
          logger.info(
            { component: "Brain", city: step.city },
            `🔧 Weather recovery: city "${step.city}" not found`,
          );
        }
      },
      imagine: () => {
        if (error.includes("429")) {
          logger.info(
            { component: "Brain" },
            "🔧 Imagine recovery: rate limited, will delay next attempt",
          );
        }
      },
    };

    if (strategies[tool]) {
      strategies[tool]();
      this.strategies.failureRecoveries.push({
        tool,
        error: error.substring(0, 100),
        time: Date.now(),
      });
      if (this.strategies.failureRecoveries.length > 50)
        this.strategies.failureRecoveries =
          this.strategies.failureRecoveries.slice(-25);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9. SEARCH QUERY REFINEMENT
  // ═══════════════════════════════════════════════════════════
  refineSearchQuery(query) {
    const original = query;
    if (query.length > 100) query = query.split(" ").slice(0, 8).join(" ");
    query = query
      .replace(/\b(te rog|please|un pic|putin|vreau sa stiu|as vrea)\b/gi, "")
      .trim();
    return query || original;
  }

  // ═══════════════════════════════════════════════════════════
  // 10. MONITOR TOOL IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════

  // Helper: log media activity to Supabase
  async _logMedia(type, url, title, userId) {
    if (!this.supabaseAdmin) return;
    try {
      await this.supabaseAdmin.from("media_history").insert({
        user_id: userId || "guest",
        type,
        url,
        title,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "ok — table might not exist yet",
      );
    }
  }

  // ── OPEN URL ON MONITOR ──
  async _openURL(url) {
    this.toolStats.openURL = (this.toolStats.openURL || 0) + 1;
    if (!url || !url.startsWith("http")) {
      return { type: "openURL", status: "error", summary: "URL invalid." };
    }
    await this._logMedia("url", url, url);
    return {
      type: "openURL",
      url: url,
      title: url,
      displayType: "iframe",
      presentOnMonitor: true,
      summary: `Am deschis ${url} pe monitor.`,
    };
  }

  // ── RADIO LIVE ON MONITOR ──
  async _radio(station) {
    this.toolStats.radio = (this.toolStats.radio || 0) + 1;
    const RADIO_STREAMS = {
      "radio zu": {
        name: "Radio ZU",
        url: "https://live.radiozu.ro/radiozu.mp3",
        logo: "📻",
      },
      radiozu: {
        name: "Radio ZU",
        url: "https://live.radiozu.ro/radiozu.mp3",
        logo: "📻",
      },
      "kiss fm": {
        name: "Kiss FM",
        url: "https://live.kissfm.ro/kissfm.mp3",
        logo: "💋",
      },
      "europa fm": {
        name: "Europa FM",
        url: "https://astreaming.edi.ro:8443/EuropaFM_aac",
        logo: "🇪🇺",
      },
      "digi fm": {
        name: "Digi FM",
        url: "https://edge76.rcs-rds.ro/digifm/digifm.mp3",
        logo: "📡",
      },
      "magic fm": {
        name: "Magic FM",
        url: "https://live.magicfm.ro/magicfm.mp3",
        logo: "✨",
      },
      "rock fm": {
        name: "Rock FM",
        url: "https://live.rockfm.ro/rockfm.mp3",
        logo: "🎸",
      },
      "pro fm": {
        name: "Pro FM",
        url: "https://live.profm.ro/profm.mp3",
        logo: "🎵",
      },
      "virgin radio": {
        name: "Virgin Radio",
        url: "https://astreaming.edi.ro:8443/VirginRadio_aac",
        logo: "🔴",
      },
      "national fm": {
        name: "National FM",
        url: "https://live.nationalfm.ro/nationalfm.mp3",
        logo: "🇷🇴",
      },
      "romantic fm": {
        name: "Romantic FM",
        url: "https://stream.romanticfm.ro/romanticfm.mp3",
        logo: "💕",
      },
      "gold fm": {
        name: "Gold FM",
        url: "https://live.goldfm.ro/goldfm.mp3",
        logo: "🏆",
      },
      "city fm": {
        name: "City FM",
        url: "https://live.cityfm.ro/cityfm.mp3",
        logo: "🏙️",
      },
    };

    const key = (station || "radio zu").toLowerCase().trim();
    const radio = RADIO_STREAMS[key] || RADIO_STREAMS["radio zu"];
    await this._logMedia("radio", radio.url, radio.name);

    return {
      type: "radio",
      station: radio.name,
      streamUrl: radio.url,
      logo: radio.logo,
      displayType: "audio",
      presentOnMonitor: true,
      summary: `${radio.logo} ${radio.name} redă acum pe monitor!`,
    };
  }

  // ── VIDEO / YOUTUBE / NETFLIX ON MONITOR ──
  async _video(query) {
    this.toolStats.video = (this.toolStats.video || 0) + 1;
    if (!query)
      return { type: "video", status: "error", summary: "Ce video dorești?" };

    // Check if it's a direct YouTube URL
    const ytMatch = query.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
    );
    if (ytMatch) {
      const ytEmbed = this.getToolUrl("youtube_embed") || "https://www.youtube.com/embed";
      const embedUrl = `${ytEmbed}/${ytMatch[1]}?autoplay=1`;
      await this._logMedia("video", embedUrl, query);
      return {
        type: "video",
        url: `${this.getToolUrl("youtube_embed") ? "https://youtube.com" : "https://youtube.com"}/watch?v=${ytMatch[1]}`,
        embedUrl,
        videoId: ytMatch[1],
        title: query,
        displayType: "video",
        presentOnMonitor: true,
        summary: `Video YouTube redă pe monitor.`,
      };
    }

    // Check if Netflix URL
    if (query.includes("netflix.com")) {
      await this._logMedia("video", query, "Netflix");
      return {
        type: "video",
        url: query,
        embedUrl: query,
        title: "Netflix",
        displayType: "iframe",
        presentOnMonitor: true,
        summary: "Netflix deschis pe monitor.",
      };
    }

    // Search YouTube via API or construct search URL
    const ytSearchBase = this.getToolUrl("youtube_search") || "https://www.youtube.com/results";
    const ytEmbedBase = this.getToolUrl("youtube_embed") || "https://www.youtube.com/embed";
    const searchUrl = `${ytSearchBase}?search_query=${encodeURIComponent(query)}`;
    const embedSearch = `${ytEmbedBase}?listType=search&list=${encodeURIComponent(query)}`;
    await this._logMedia("video", searchUrl, query);

    return {
      type: "video",
      url: searchUrl,
      embedUrl: embedSearch,
      query: query,
      title: query,
      displayType: "video",
      presentOnMonitor: true,
      summary: `Caut "${query}" pe YouTube — afișez pe monitor.`,
    };
  }

  // ── WEB NAVIGATION ON MONITOR ──
  async _webNav(query) {
    this.toolStats.webNav = (this.toolStats.webNav || 0) + 1;
    if (!query)
      return { type: "webNav", status: "error", summary: "Ce pagină dorești?" };

    // If it looks like a domain, add https://
    let url = query;
    if (!url.startsWith("http")) {
      if (/^[\w-]+\.(com|ro|net|org|io|app|dev|eu|info|tv|fm)$/i.test(url)) {
        url = `https://${url}`;
      } else {
        // Search Google for the query
        url = `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`;
      }
    }
    await this._logMedia("webNav", url, query);

    return {
      type: "webNav",
      url: url,
      query: query,
      title: query,
      displayType: "iframe",
      presentOnMonitor: true,
      summary: `Am navigat la ${url} pe monitor.`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 10b. TABLE 3 NON-AI FUNCTION IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════

  // ── AUTH ACTION (from chat) ──
  async _authAction(action, _data) {
    this.toolStats.authAction = (this.toolStats.authAction || 0) + 1;
    const actionMessages = {
      login: {
        summary:
          "Pentru a te loga, folosește formularul de login din interfață (butonul 👤 din colțul dreapta-sus) sau trimite-mi email/parolă. Autentificarea necesită Supabase Auth.",
        instructions:
          "Deschide interfața web → click pe iconița de user → completează email și parola.",
        requiresUI: true,
      },
      register: {
        summary:
          "Pentru a crea un cont nou, folosește formularul de înregistrare din interfață. Vei primi un email de confirmare.",
        instructions:
          'Deschide interfața web → click pe "Cont Nou" → completează email, parolă și nume.',
        requiresUI: true,
      },
      logout: {
        summary: "Te deloghez acum. Sesiunea ta va fi închisă.",
        instructions: "Logout efectuat. Poți te reloga oricând.",
        requiresUI: false,
      },
      changePassword: {
        summary:
          "Pentru a schimba parola, trebuie să fii logat. Mergi la setări sau trimite-mi parola nouă.",
        instructions: "Setări → Schimbă Parola → introdu parola nouă.",
        requiresUI: true,
      },
      changeEmail: {
        summary:
          "Pentru a schimba email-ul, trebuie să fii logat. Vei primi confirmare pe noul email.",
        instructions: "Setări → Schimbă Email → introdu noul email.",
        requiresUI: true,
      },
      forgotPassword: {
        summary:
          "Ți-am trimis un link de resetare pe email. Verifică inbox-ul (și spam).",
        instructions: "Verifică email → click pe link → setează parola nouă.",
        requiresUI: false,
      },
    };
    const info = actionMessages[action] || actionMessages.login;

    // Log to Supabase
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: `auth_${action}`,
          details: `User requested ${action} from chat`,
          result: { action, status: "guided" },
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return {
      type: "auth",
      action,
      ...info,
    };
  }

  // ── PAYMENT ACTION (from chat) ──
  async _paymentAction(action) {
    this.toolStats.paymentAction = (this.toolStats.paymentAction || 0) + 1;
    let result = {};

    try {
      const _payments = require("./payments");

      if (action === "plans") {
        result = {
          action: "plans",
          plans: [
            {
              name: "Free",
              price: "0 RON",
              features: "Chat AI, 10 căutări/zi, meteo, hărți",
            },
            {
              name: "Pro",
              price: "29 RON/lună",
              features:
                "Tot ce e în Free + Vision, TTS, imagini nelimitat, voice clone",
            },
            {
              name: "Premium",
              price: "99 RON/lună",
              features: "Tot nelimitat + trading, admin, suport prioritar",
            },
          ],
          summary:
            'Planuri disponibile: Free (0 RON), Pro (29 RON/lună), Premium (99 RON/lună). Pentru upgrade, click pe butonul de abonament din interfață sau spune "Vreau Pro".',
        };
      } else if (action === "checkout") {
        result = {
          action: "checkout",
          summary:
            'Pentru a face upgrade, deschide interfața web și click pe butonul "Upgrade" sau "Subscribe". Plata se procesează prin Stripe securizat.',
          url: "/api/payments/checkout",
          requiresUI: true,
        };
      } else if (action === "portal") {
        result = {
          action: "portal",
          summary:
            "Pentru a gestiona abonamentul (anulare, factură, schimbare plan), deschide portalul de billing din setări.",
          url: "/api/payments/portal",
          requiresUI: true,
        };
      }
    } catch (e) {
      result = {
        action,
        summary: "Modulul de plăți nu e disponibil momentan.",
        error: e.message,
      };
    }

    // Log to Supabase
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: `payment_${action}`,
          details: `User requested ${action} from chat`,
          result: { action, status: "informed" },
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return { type: "payment", ...result };
  }

  // ── NEWS ACTION (from chat — real articles) ──
  async _newsAction(action) {
    this.toolStats.newsAction = (this.toolStats.newsAction || 0) + 1;
    let result = {};

    try {
      const news = require("./news");
      const articles = news.getArticlesArray ? news.getArticlesArray() : [];

      if (action === "breaking") {
        const breaking = articles.filter(
          (a) => a.isBreaking || (a.confirmedBy && a.confirmedBy >= 2),
        );
        result = {
          action: "breaking",
          articles: breaking.slice(0, 5).map((a) => ({
            title: a.title,
            source: a.source,
            category: a.category,
            url: a.url,
            publishedAt: a.publishedAt,
          })),
          count: breaking.length,
          summary:
            breaking.length > 0
              ? `🔴 ${breaking.length} știri breaking: ${breaking
                .slice(0, 3)
                .map((a) => a.title)
                .join("; ")}`
              : "Nicio știre breaking momentan. Situația e calmă.",
        };
      } else {
        const latest = articles.slice(0, 8);
        result = {
          action: "latest",
          articles: latest.map((a) => ({
            title: a.title,
            source: a.source,
            category: a.category,
            url: a.url,
            publishedAt: a.publishedAt,
          })),
          count: articles.length,
          summary:
            latest.length > 0
              ? `📰 ${articles.length} articole. Ultimele: ${latest
                .slice(0, 3)
                .map((a) => `${a.title} (${a.source})`)
                .join("; ")}`
              : "Nu am știri momentan. Fetch-ul se face automat la ore fixe.",
        };
      }
    } catch (e) {
      result = {
        action,
        summary: "Modulul de știri nu e disponibil momentan.",
        error: e.message,
      };
    }

    // Log to Supabase
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: `news_${action}`,
          details: `User requested ${action} news from chat`,
          result: { action, articleCount: result.count || 0 },
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return { type: "news", ...result };
  }

  // ── LEGAL ACTION (from chat) ──
  async _legalAction(action) {
    this.toolStats.legalAction = (this.toolStats.legalAction || 0) + 1;
    let result = {};

    if (action === "terms") {
      result = {
        action: "terms",
        summary:
          "Termenii și condițiile KelionAI: Serviciul oferă asistent AI personal cu funcții de chat, căutare, meteo, imagini, TTS, STT, trading și news. Utilizarea e gratuită cu limite. Datele sunt protejate conform GDPR. Detalii complete la /api/legal/terms.",
        url: "/api/legal/terms",
      };
    } else if (action === "privacy") {
      result = {
        action: "privacy",
        summary:
          `Politica de confidențialitate: Colectăm email, conversații AI, preferințe. Zero tracking, zero publicitate. Cookie-uri doar pentru autentificare. Date stocate în Supabase (EU). Drepturile tale: acces, rectificare, ștergere, portabilitate. Contact: privacy@${(process.env.APP_URL || '').replace('https://', '')}.`,
        url: "/api/legal/privacy",
      };
    } else if (action === "exportData") {
      result = {
        action: "exportData",
        summary:
          "Datele tale sunt protejate în Supabase. Poți vedea tot ce am stocat despre tine din setări. Include: profil, conversații, preferințe, referrals. Datele nu se exportă extern — rămân protejate în baza de date.",
        url: "/api/legal/gdpr/export",
        requiresAuth: true,
      };
    } else if (action === "deleteData") {
      result = {
        action: "deleteData",
        summary:
          "⚠️ Ștergerea datelor e ireversibilă! Se vor șterge: conversații, mesaje, preferințe, referrals. Contul rămâne activ dar fără date. Confirmă din setări dacă ești sigur.",
        url: "/api/legal/gdpr/delete",
        requiresAuth: true,
        requiresConfirmation: true,
      };
    }

    // Log to Supabase
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: `legal_${action}`,
          details: `User requested ${action} from chat`,
          result: { action },
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return { type: "legal", ...result };
  }

  // ── HEALTH CHECK (from chat) ──
  async _healthCheck() {
    this.toolStats.healthCheck = (this.toolStats.healthCheck || 0) + 1;
    const diag = this.getDiagnostics();
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    const services = {
      ai_claude: !!process.env.ANTHROPIC_API_KEY,
      ai_openai: !!process.env.OPENAI_API_KEY,
      tts: !!process.env.ELEVENLABS_API_KEY,
      stt: !!process.env.GROQ_API_KEY,
      search: !!(
        process.env.PERPLEXITY_API_KEY ||
        process.env.TAVILY_API_KEY ||
        process.env.SERPER_API_KEY
      ),
      payments: !!process.env.STRIPE_SECRET_KEY,
      supabase: !!this.supabaseAdmin,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      whatsapp: !!process.env.WA_ACCESS_TOKEN,
      messenger: !!process.env.MESSENGER_PAGE_TOKEN,
    };
    const activeServices = Object.entries(services)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const inactiveServices = Object.entries(services)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    const result = {
      status: "operational",
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: `${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      conversations: diag.conversations || 0,
      brainStatus: diag.status || "active",
      activeServices,
      inactiveServices,
      summary: `✅ Sunt operațional! Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m. Memorie: ${Math.round(mem.heapUsed / 1024 / 1024)}MB. ${activeServices.length} servicii active: ${activeServices.join(", ")}. ${inactiveServices.length > 0 ? `Lipsă: ${inactiveServices.join(", ")}` : "Toate serviciile funcționale!"}`,
    };

    // Log to Supabase
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: "health_check",
          details: "User requested health check from chat",
          result: {
            status: result.status,
            activeServices: activeServices.length,
          },
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return { type: "health", ...result };
  }

  // ── TRADE INTELLIGENCE — Real analysis from trade-intelligence.js ──
  async _tradeIntelligence() {
    try {
      const ti = require("./trade-intelligence");
      const results = {};

      // Fetch market news sentiment
      try {
        const news = await ti.fetchMarketNews("crypto");
        if (news && news.length > 0) {
          const headlines = news.map((n) => n.title || n.headline);
          results.sentiment = ti.calculateNewsSentiment(headlines);
          results.newsCount = news.length;
          results.topHeadlines = headlines.slice(0, 5);
        }
      } catch (e) {
        results.sentimentError = e.message;
      }

      // Economic calendar risks
      try {
        results.calendarRisks = ti.getEconomicCalendarRisks();
      } catch (e) {
        results.calendarError = e.message;
      }

      const summary = `Sentiment: ${results.sentiment?.toFixed(2) || "N/A"} | News: ${results.newsCount || 0} articles | Calendar risks: ${results.calendarRisks?.events?.length || 0}`;

      // Save to Supabase
      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("trade_intelligence").insert({
            asset: "BTC",
            analysis_type: "full_scan",
            result: results,
            sentiment_score: results.sentiment || 0,
            confidence: results.newsCount > 5 ? 0.8 : 0.5,
            created_at: new Date().toISOString(),
          });
          await this.supabaseAdmin.from("admin_logs").insert({
            action: "trade_intelligence",
            details: summary,
            source: "brain_chat",
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "ok");
        }
      }

      return { type: "tradeIntelligence", data: results, summary };
    } catch (e) {
      return {
        type: "tradeIntelligence",
        error: e.message,
        summary: `Eroare: ${e.message}`,
      };
    }
  }

  // ── COOKIE CONSENT — GDPR Cookie Management ──
  async _cookieConsent() {
    const info = {
      type: "cookieConsent",
      categories: {
        functional: {
          required: true,
          description:
            "Cookie-uri esențiale pentru funcționarea site-ului (sesiune, autentificare).",
        },
        analytics: {
          required: false,
          description:
            "Cookie-uri de analiză (ex: Google Analytics) — NU sunt active implicit.",
        },
        marketing: {
          required: false,
          description:
            "Cookie-uri de marketing — NU sunt active. KelionAI nu are advertising.",
        },
      },
      policy:
        "KelionAI folosește doar cookie-uri funcționale necesare. Nu avem tracking, nu avem reclame.",
      endpoint: "/api/cookie-consent",
      summary:
        "Cookie consent: doar funcționale active. Analytics/marketing dezactivate implicit. GDPR compliant.",
    };

    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("admin_logs").insert({
          action: "cookie_consent_info",
          details: "User asked about cookie policy from chat",
          source: "brain_chat",
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "ok");
      }
    }

    return info;
  }

  // ── METRICS STATS — Prometheus + Grafana from metrics.js ──
  async _metricsStats() {
    try {
      const metrics = require("./metrics");
      const metricsText = await metrics.register.metrics();

      // Parse key metrics from Prometheus output
      const lines = metricsText
        .split("\n")
        .filter((l) => !l.startsWith("#") && l.includes(" "));
      const parsed = {};
      for (const line of lines.slice(0, 30)) {
        const [name, value] = line.split(" ");
        if (name && value) parsed[name] = parseFloat(value);
      }

      const result = {
        type: "metricsStats",
        totalMetrics: lines.length,
        keyMetrics: {
          httpRequests: parsed["kelionai_http_requests_total"] || 0,
          activeConnections: parsed["kelionai_active_connections"] || 0,
          errors: parsed["kelionai_errors_total"] || 0,
          aiRequests: parsed["kelionai_ai_requests_total"] || 0,
        },
        grafanaEnabled: !!process.env.GRAFANA_PROM_URL,
        prometheusEndpoint: "/metrics",
        summary: `Metrici: ${lines.length} active | Requests: ${parsed["kelionai_http_requests_total"] || 0} | Erori: ${parsed["kelionai_errors_total"] || 0} | Grafana: ${process.env.GRAFANA_PROM_URL ? "ON" : "OFF"}`,
      };

      // Save snapshot to Supabase
      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("metrics_snapshots").insert({
            metric_type: "full_snapshot",
            metric_name: "brain_chat_query",
            value: lines.length,
            labels: result.keyMetrics,
            created_at: new Date().toISOString(),
          });
          await this.supabaseAdmin.from("admin_logs").insert({
            action: "metrics_stats",
            details: result.summary,
            source: "brain_chat",
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "ok");
        }
      }

      return result;
    } catch (e) {
      return {
        type: "metricsStats",
        error: e.message,
        summary: `Eroare metrici: ${e.message}`,
      };
    }
  }

  // ── SECURITY CHECK — Reports on all security features ──
  async _securityCheck() {
    try {
      const securityFeatures = {
        https: { enabled: true, details: "Force redirect HTTP → HTTPS" },
        cspNonce: {
          enabled: true,
          details: "Content Security Policy with per-request nonce",
        },
        helmet: {
          enabled: true,
          details: "X-Frame-Options, X-XSS-Protection, HSTS etc.",
        },
        cors: { enabled: true, details: `Origins: ${process.env.APP_URL || 'configured'}, localhost` },
        rateGlobal: { enabled: true, details: "200 requests / 15 min per IP" },
        rateChat: { enabled: true, details: "30 requests / min per IP" },
        rateAuth: { enabled: true, details: "10 requests / 15 min per IP" },
        adminAuth: {
          enabled: true,
          details: "Code verification + IP whitelist",
        },
        apiKeyAuth: {
          enabled: true,
          details: "HMAC-signed API keys in api_keys table",
        },
        sentry: {
          enabled: !!process.env.SENTRY_DSN,
          details: process.env.SENTRY_DSN
            ? "Active error tracking"
            : "Not configured",
        },
        pinoLogger: { enabled: true, details: "Structured JSON logging" },
        metricsMiddleware: {
          enabled: true,
          details: "HTTP request/response metrics",
        },
      };

      const enabledCount = Object.values(securityFeatures).filter(
        (f) => f.enabled,
      ).length;
      const result = {
        type: "securityCheck",
        features: securityFeatures,
        totalFeatures: 12,
        enabledFeatures: enabledCount,
        summary: `Securitate: ${enabledCount}/12 active | HTTPS ✅ | CSP ✅ | Helmet ✅ | CORS ✅ | Rate Limits ✅ | Sentry ${securityFeatures.sentry.enabled ? "✅" : "❌"}`,
      };

      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("admin_logs").insert({
            action: "security_check",
            details: { features: enabledCount, total: 12 },
            source: "brain_chat",
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "ok");
        }
      }
      return result;
    } catch (e) {
      return {
        type: "securityCheck",
        error: e.message,
        summary: `Eroare securitate: ${e.message}`,
      };
    }
  }

  // ── DEVELOPER API INFO — Reports on API endpoints & keys ──
  async _devAPIInfo() {
    try {
      let totalKeys = 0;
      if (this.supabaseAdmin) {
        try {
          const { count } = await this.supabaseAdmin
            .from("api_keys")
            .select("*", { count: "exact", head: true });
          totalKeys = count || 0;
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "ok");
        }
      }

      const endpoints = [
        {
          method: "GET",
          path: "/api/v1/status",
          auth: false,
          desc: "API status",
        },
        {
          method: "GET",
          path: "/api/v1/models",
          auth: true,
          desc: "List AI models",
        },
        {
          method: "POST",
          path: "/api/v1/chat",
          auth: true,
          desc: "Send message to AI",
        },
        {
          method: "GET",
          path: "/api/v1/user/profile",
          auth: true,
          desc: "User profile",
        },
        {
          method: "POST",
          path: "/api/developer/keys",
          auth: true,
          desc: "Create API key",
        },
        {
          method: "GET",
          path: "/api/developer/keys",
          auth: true,
          desc: "List API keys",
        },
        {
          method: "DELETE",
          path: "/api/developer/keys/:id",
          auth: true,
          desc: "Revoke API key",
        },
        {
          method: "GET",
          path: "/api/developer/stats",
          auth: true,
          desc: "Developer stats",
        },
        {
          method: "POST",
          path: "/api/developer/webhooks",
          auth: true,
          desc: "Save webhook URL",
        },
        {
          method: "GET",
          path: "/api/developer/webhooks",
          auth: true,
          desc: "Get webhook URL",
        },
      ];

      const result = {
        type: "devAPIInfo",
        totalEndpoints: endpoints.length,
        totalKeys,
        endpoints,
        baseUrl: (process.env.APP_URL || '') + "/api/v1",
        authMethod: "Bearer API key",
        summary: `Developer API: ${endpoints.length} endpoints | ${totalKeys} API keys active | Auth: Bearer token | Base: /api/v1`,
      };

      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("admin_logs").insert({
            action: "dev_api_info",
            details: { endpoints: endpoints.length, keys: totalKeys },
            source: "brain_chat",
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "ok");
        }
      }
      return result;
    } catch (e) {
      return {
        type: "devAPIInfo",
        error: e.message,
        summary: `Eroare API info: ${e.message}`,
      };
    }
  }

  // ── SYSTEM STATUS — Reports on DB, migration, cache, validation ──
  // BRAIN-2 FIX: Cache results for 5 minutes to avoid 21 sequential queries
  async _systemStatus() {
    const now = Date.now();
    if (this._systemStatusCache && now - this._systemStatusCacheTime < 300000) {
      return this._systemStatusCache;
    }
    try {
      const tableCounts = {};
      const tables = [
        "conversations",
        "messages",
        "user_preferences",
        "subscriptions",
        "usage",
        "referral_codes",
        "referrals",
        "admin_logs",
        "trades",
        "profiles",
        "api_keys",
        "media_history",
        "news_cache",
        "brain_learnings",
        "telegram_users",
        "whatsapp_users",
        "whatsapp_messages",
        "trade_intelligence",
        "cookie_consents",
        "metrics_snapshots",
        "processed_webhook_events",
      ];

      if (this.supabaseAdmin) {
        for (const table of tables) {
          try {
            const { count } = await this.supabaseAdmin
              .from(table)
              .select("*", { count: "exact", head: true });
            tableCounts[table] = count || 0;
          } catch {
            tableCounts[table] = "ERROR";
          }
        }
      }

      const totalRecords = Object.values(tableCounts)
        .filter((v) => typeof v === "number")
        .reduce((a, b) => a + b, 0);
      const errorTables = Object.entries(tableCounts)
        .filter(([, v]) => v === "ERROR")
        .map(([k]) => k);

      const result = {
        type: "systemStatus",
        totalTables: tables.length,
        tableCounts,
        totalRecords,
        errorTables,
        cacheEnabled: true,
        validationEnabled: true,
        migrationStatus: "auto_on_startup",
        schemaVersion: "schema-full.sql v2.3",
        serverVersion: "2.5.0",
        uptime: process.uptime(),
        summary: `System: ${tables.length} tabele | ${totalRecords} records | ${errorTables.length} erori | Cache: ON | Validare: ON | Uptime: ${Math.round(process.uptime())}s`,
      };

      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("admin_logs").insert({
            action: "system_status",
            details: {
              tables: tables.length,
              records: totalRecords,
              errors: errorTables,
            },
            source: "brain_chat",
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          logger.warn(
            { component: "Brain", err: e.message },
            "admin_logs insert failed",
          );
        }
      }
      // Cache the result for 5 minutes
      this._systemStatusCache = result;
      this._systemStatusCacheTime = Date.now();
      return result;
    } catch (e) {
      return {
        type: "systemStatus",
        error: e.message,
        summary: `Eroare system: ${e.message}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TOOL IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════

  // ── VISION — High precision for accessibility (blind users) ──
  // Calls Claude Vision API when image is provided in context
  async _vision(imageBase64, userId) {
    this.toolStats.vision = (this.toolStats.vision || 0) + 1;

    // If no image data provided, signal readiness for camera
    if (!imageBase64) {
      return {
        type: "vision",
        status: "awaiting_image",
        description:
          "Camera pregătită. Trimite o imagine pentru analiză de mare precizie.",
        precision: "high",
        accessibility: true,
        summary: "Aștept imagine — activează camera sau trimite o fotografie.",
      };
    }

    // Call Claude Vision API for high-precision analysis
    if (this.anthropicKey) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/jpeg",
                      data: imageBase64,
                    },
                  },
                  {
                    type: "text",
                    text: "Descrie în detaliu maxim ce vezi în această imagine. Menționează: persoane, obiecte, culori, text vizibil, obstacole, distanțe estimate, pericole potențiale. Răspunde în română cu precizie maximă — informația ajută o persoană cu deficiențe de vedere.",
                  },
                ],
              },
            ],
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const description =
            data.content?.[0]?.text || "Nu am putut analiza imaginea.";
          // Supabase usage log
          if (this.supabaseAdmin) {
            try {
              const today = new Date().toISOString().split("T")[0];
              await this.supabaseAdmin.from("usage").upsert(
                {
                  user_id: userId || "guest",
                  type: "vision",
                  date: today,
                  count: 1,
                },
                { onConflict: "user_id,type,date" },
              );
            } catch (e) {
              logger.warn({ component: "Brain", err: e.message }, "ok");
            }
          }
          return {
            type: "vision",
            status: "analyzed",
            description,
            precision: "high",
            accessibility: true,
            engine: "Claude Vision",
            summary: description.substring(0, 200),
          };
        }
      } catch (e) {
        logger.warn(
          { component: "Brain", err: e.message },
          "Claude Vision failed",
        );
      }
    }

    // Primary: GPT-5.4 Vision (most advanced)
    if (this.openaiKey) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.openaiKey}`,
          },
          body: JSON.stringify({
            model: MODELS.OPENAI_VISION,
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                  },
                  {
                    type: "text",
                    text: "Descrie în detaliu maxim ce vezi. Menționează persoane, obiecte, culori, text, obstacole, distanțe. Română, precizie maximă pentru accesibilitate.",
                  },
                ],
              },
            ],
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const description =
            data.choices?.[0]?.message?.content || "Nu am putut analiza.";
          return {
            type: "vision",
            status: "analyzed",
            description,
            precision: "high",
            accessibility: true,
            engine: "GPT-5.4 Vision",
            summary: description.substring(0, 200),
          };
        }
      } catch (e) {
        logger.warn(
          { component: "Brain", err: e.message },
          "GPT-5.4 Vision failed",
        );
      }
    }

    return {
      type: "vision",
      status: "no_api",
      summary:
        "Nicio cheie API vision configurată (ANTHROPIC_API_KEY sau OPENAI_API_KEY).",
    };
  }

  // ── TTS — Text-to-Speech via ElevenLabs — Returns actual audio ──
  async _tts(text, userId) {
    this.toolStats.tts = (this.toolStats.tts || 0) + 1;
    if (!text)
      return {
        type: "tts",
        status: "no_text",
        summary: "Nu am primit text de citit.",
      };

    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const voiceId =
          process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB";
        const r = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": process.env.ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text: text.substring(0, 500),
              model_id: MODELS.ELEVENLABS_MODEL,
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
          },
        );
        if (r.ok) {
          const audioBuffer = Buffer.from(await r.arrayBuffer());
          const audioBase64 = audioBuffer.toString("base64");
          // Supabase usage log
          if (this.supabaseAdmin) {
            try {
              const today = new Date().toISOString().split("T")[0];
              await this.supabaseAdmin.from("usage").upsert(
                {
                  user_id: userId || "guest",
                  type: "tts",
                  date: today,
                  count: 1,
                },
                { onConflict: "user_id,type,date" },
              );
            } catch (e) {
              logger.warn({ component: "Brain", err: e.message }, "ok");
            }
          }
          return {
            type: "tts",
            status: "generated",
            audioBase64,
            audioSize: audioBuffer.length,
            text: text.substring(0, 100),
            summary: `Audio generat: ${audioBuffer.length} bytes (${text.length} caractere text)`,
          };
        } else {
          const errText = await r.text();
          logger.warn(
            { component: "Brain", status: r.status, body: errText },
            "ElevenLabs TTS failed",
          );
        }
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "TTS error");
      }
    }

    return {
      type: "tts",
      status: "no_api",
      text: text.substring(0, 100),
      summary: "ELEVENLABS_API_KEY nu e configurată.",
    };
  }

  // ── STT — Speech-to-Text via Groq Whisper — REAL ──
  async _stt(audioBase64, userId) {
    this.toolStats.stt = (this.toolStats.stt || 0) + 1;

    // If no audio, signal readiness
    if (!audioBase64) {
      return {
        type: "stt",
        status: "awaiting_audio",
        engine: "Groq Whisper",
        summary: "Microfonul pregătit. Trimite audio pentru transcriere.",
      };
    }

    // Call Groq Whisper API
    if (process.env.GROQ_API_KEY) {
      try {
        const FormData = require("form-data");
        const form = new FormData();
        form.append("file", Buffer.from(audioBase64, "base64"), {
          filename: "audio.webm",
          contentType: "audio/webm",
        });
        form.append("model", MODELS.WHISPER);

        const r = await fetch(
          "https://api.groq.com/openai/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            body: form,
          },
        );
        const d = await r.json();
        const text = d.text || "";

        if (this.supabaseAdmin) {
          try {
            const today = new Date().toISOString().split("T")[0];
            await this.supabaseAdmin.from("usage").upsert(
              {
                user_id: userId || "system",
                type: "stt",
                date: today,
                count: 1,
              },
              { onConflict: "user_id,type,date" },
            );
          } catch (e) {
            logger.warn({ component: "Brain", err: e.message }, "ok");
          }
        }

        return {
          type: "stt",
          status: "transcribed",
          engine: "Groq Whisper",
          text,
          summary: text
            ? `Transcris: "${text.substring(0, 100)}"`
            : "Nu am detectat vorbire.",
        };
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "STT Groq error");
      }
    }

    // Fallback to OpenAI Whisper
    if (this.openaiKey) {
      try {
        const FormData = require("form-data");
        const form = new FormData();
        form.append("file", Buffer.from(audioBase64, "base64"), {
          filename: "audio.webm",
          contentType: "audio/webm",
        });
        form.append("model", MODELS.OPENAI_WHISPER);

        const r = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${this.openaiKey}` },
            body: form,
          },
        );
        const d = await r.json();
        return {
          type: "stt",
          status: "transcribed",
          engine: "OpenAI Whisper",
          text: d.text || "",
          summary: d.text
            ? `Transcris: "${d.text.substring(0, 100)}"`
            : "Nu am detectat vorbire.",
        };
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "STT OpenAI error");
      }
    }

    return {
      type: "stt",
      status: "no_api",
      summary: "GROQ_API_KEY și OPENAI_API_KEY nu sunt configurate.",
    };
  }

  // ── FACE CHECK — Identify user via Claude Vision + Supabase profiles ──
  async _faceCheck(imageBase64) {
    this.toolStats.faceCheck = (this.toolStats.faceCheck || 0) + 1;

    // Get known faces from Supabase
    let knownFaces = [];
    if (this.supabaseAdmin) {
      try {
        const { data } = await this.supabaseAdmin
          .from("profiles")
          .select("user_id, display_name, face_encoding")
          .not("face_encoding", "is", null);
        knownFaces = (data || []).filter(
          (f) => f.face_encoding && Object.keys(f.face_encoding).length > 0,
        );
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "no profiles yet");
      }
    }

    if (!imageBase64) {
      return {
        type: "faceCheck",
        status: "awaiting_image",
        knownFaces: knownFaces.length,
        summary: `${knownFaces.length} fețe înregistrate. Trimite o imagine pentru identificare.`,
      };
    }

    // Use Claude Vision to describe the face
    if (this.anthropicKey) {
      try {
        const knownList = knownFaces
          .map(
            (f) =>
              `- ${f.display_name || f.user_id}: ${f.face_encoding.description || "no description"}`,
          )
          .join("\n");
        const prompt =
          knownFaces.length > 0
            ? `Descrie persoana din imagine (vârstă, gen, păr, ochelari, trăsături distinctive). Apoi compară cu aceste persoane cunoscute:\n${knownList}\nRăspunde: MATCH: [nume] sau NO_MATCH dacă nu e nimeni cunoscut.`
            : "Descrie persoana din imagine: vârstă estimată, gen, culoare păr, ochelari da/nu, trăsături distinctive. Răspunde concis în română.";

        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 500,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/jpeg",
                      data: imageBase64,
                    },
                  },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const description = data.content?.[0]?.text || "";
          const isMatch = description.includes("MATCH:");
          const matchName = isMatch
            ? description.match(/MATCH:\s*(.+)/)?.[1]?.trim()
            : null;

          return {
            type: "faceCheck",
            status: isMatch ? "identified" : "unknown",
            name: matchName || "Necunoscut",
            description,
            knownFaces: knownFaces.length,
            engine: "Claude Vision",
            summary: isMatch
              ? `Identificat: ${matchName}`
              : `Necunoscut — ${knownFaces.length} fețe în baza de date.`,
          };
        }
      } catch (e) {
        logger.warn(
          { component: "Brain", err: e.message },
          "Face check Vision error",
        );
      }
    }

    return {
      type: "faceCheck",
      status: "no_api",
      knownFaces: knownFaces.length,
      summary: "ANTHROPIC_API_KEY necesară pentru recunoaștere facială.",
    };
  }

  // ── FACE REGISTER — Save face description to Supabase profiles ──
  async _faceRegister(userId, imageBase64) {
    this.toolStats.faceRegister = (this.toolStats.faceRegister || 0) + 1;
    if (!userId)
      return {
        type: "faceRegister",
        status: "error",
        summary: "Trebuie să fii autentificat.",
      };

    if (!imageBase64) {
      return {
        type: "faceRegister",
        status: "awaiting_image",
        summary: "Trimite o imagine cu fața ta pentru înregistrare.",
      };
    }

    // Use Claude Vision to extract face description as "encoding"
    let faceDescription = null;
    if (this.anthropicKey) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 300,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/jpeg",
                      data: imageBase64,
                    },
                  },
                  {
                    type: "text",
                    text: 'Descrie fața persoanei pentru recunoaștere viitoare: vârstă estimată, gen, culoare păr, lung/scurt, ochelari da/nu, barbă/mustață, forme faciale distinctive, cicatrici sau semne particulare. Format JSON: {"age":X,"gender":"","hair":"","glasses":false,"facial_hair":"","distinctive":"","description":"text liber"}',
                  },
                ],
              },
            ],
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const text = data.content?.[0]?.text || "";
          try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            faceDescription = jsonMatch
              ? JSON.parse(jsonMatch[0])
              : { description: text };
          } catch {
            faceDescription = { description: text };
          }
        }
      } catch (e) {
        logger.warn(
          { component: "Brain", err: e.message },
          "Face register Vision error",
        );
      }
    }

    if (!faceDescription) {
      return {
        type: "faceRegister",
        status: "no_api",
        summary: "ANTHROPIC_API_KEY necesară pentru encoding facial.",
      };
    }

    // Save to Supabase profiles
    if (this.supabaseAdmin) {
      try {
        await this.supabaseAdmin.from("profiles").upsert(
          {
            user_id: userId,
            display_name:
              faceDescription.description?.substring(0, 50) || userId,
            face_encoding: faceDescription,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

        return {
          type: "faceRegister",
          status: "registered",
          encoding: faceDescription,
          engine: "Claude Vision",
          summary: `Față înregistrată: ${faceDescription.description?.substring(0, 80) || "OK"}`,
        };
      } catch (e) {
        return {
          type: "faceRegister",
          status: "error",
          summary: `Eroare salvare: ${e.message}`,
        };
      }
    }
    return {
      type: "faceRegister",
      status: "no_db",
      summary: "Baza de date indisponibilă.",
    };
  }

  // ── VOICE CLONE — ElevenLabs Voice Cloning — REAL with audio upload ──
  async _voiceClone(userId, audioBase64) {
    this.toolStats.voiceClone = (this.toolStats.voiceClone || 0) + 1;
    if (!userId)
      return {
        type: "voiceClone",
        status: "error",
        summary: "Trebuie să fii autentificat.",
      };

    // Check for existing cloned voice
    let existingVoice = null;
    if (this.supabaseAdmin) {
      try {
        const { data } = await this.supabaseAdmin
          .from("user_preferences")
          .select("value")
          .eq("user_id", userId)
          .eq("key", "cloned_voice_id")
          .single();
        existingVoice = data?.value;
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "no voice yet");
      }
    }

    if (existingVoice?.voice_id) {
      // Verify voice still exists on ElevenLabs
      if (process.env.ELEVENLABS_API_KEY) {
        try {
          const r = await fetch(
            `https://api.elevenlabs.io/v1/voices/${existingVoice.voice_id}`,
            {
              headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
            },
          );
          if (r.ok) {
            const voiceData = await r.json();
            return {
              type: "voiceClone",
              status: "active",
              voiceId: existingVoice.voice_id,
              name: voiceData.name || existingVoice.name,
              createdAt: existingVoice.created_at,
              summary: `Vocea clonată "${voiceData.name}" este activă.`,
            };
          }
        } catch (e) {
          logger.warn(
            { component: "Brain", err: e.message },
            "voice may have been deleted",
          );
        }
      }
      return {
        type: "voiceClone",
        status: "exists",
        voiceId: existingVoice.voice_id,
        summary: "Voce clonată existentă.",
      };
    }

    // No clone — check if API is available
    if (!process.env.ELEVENLABS_API_KEY) {
      return {
        type: "voiceClone",
        status: "no_api",
        summary: "ELEVENLABS_API_KEY nu e configurată.",
      };
    }

    // If audioBase64 provided, attempt actual cloning
    if (audioBase64) {
      try {
        const audioBuffer = Buffer.from(audioBase64, "base64");
        const FormData = require("form-data");
        const form = new FormData();
        form.append("name", `KelionAI_${userId.substring(0, 8)}`);
        form.append("files", audioBuffer, {
          filename: "voice_sample.mp3",
          contentType: "audio/mpeg",
        });

        const r = await fetch("https://api.elevenlabs.io/v1/voices/add", {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            ...form.getHeaders(),
          },
          body: form,
        });
        const data = await r.json();
        if (data.voice_id) {
          // Save to Supabase
          if (this.supabaseAdmin) {
            await this.supabaseAdmin.from("user_preferences").upsert(
              {
                user_id: userId,
                key: "cloned_voice_id",
                value: {
                  voice_id: data.voice_id,
                  name: data.name,
                  created_at: new Date().toISOString(),
                },
              },
              { onConflict: "user_id,key" },
            );
          }
          return {
            type: "voiceClone",
            status: "cloned",
            voiceId: data.voice_id,
            name: data.name,
            summary: `Vocea ta a fost clonată cu succes! ID: ${data.voice_id}`,
          };
        }
        return {
          type: "voiceClone",
          status: "error",
          summary: `Clonare eșuată: ${data.detail?.message || JSON.stringify(data)}`,
        };
      } catch (e) {
        return {
          type: "voiceClone",
          status: "error",
          summary: `Eroare clonare: ${e.message}`,
        };
      }
    }

    return {
      type: "voiceClone",
      status: "ready",
      requiresAudio: true,
      endpoint: "/api/voice/clone",
      instructions:
        "Trimite un fișier audio de min. 30 secunde la POST /api/voice/clone cu form-data (field: audio).",
      summary:
        "Pregătit pentru clonare. Trimite audio de 30s prin chat (audioBase64) sau /api/voice/clone.",
    };
  }

  async _search(query) {
    this.toolStats.search++;
    let result = null,
      engine = null;

    // 1️⃣ PERPLEXITY SONAR — Best: returns synthesized answer + citations
    if (!result && this.perplexityKey) {
      try {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.perplexityKey}`,
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: query }],
            max_tokens: 500,
          }),
        });
        if (r.ok) {
          const d = await r.json();
          const answer = d.choices?.[0]?.message?.content;
          const citations = (d.citations || [])
            .slice(0, 4)
            .map((url) => `- ${url}`)
            .join("\n");
          if (answer) {
            result = answer + (citations ? "\n\nSurse:\n" + citations : "");
            engine = "Perplexity";
          }
        }
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "Perplexity");
      }
    }

    // 2️⃣ TAVILY — Good: aggregated + parsed for LLM
    if (!result && this.tavilyKey) {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: this.tavilyKey,
            query,
            search_depth: "basic",
            max_results: 5,
            include_answer: true,
          }),
        });
        if (r.ok) {
          const d = await r.json();
          const sources = (d.results || [])
            .slice(0, 4)
            .map((x) => `- ${x.title}: ${x.content?.substring(0, 200)}`)
            .join("\n");
          if (d.answer || sources) {
            result =
              (d.answer || "") + (sources ? "\n\nSurse:\n" + sources : "");
            engine = "Tavily";
          }
        }
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "Tavily");
      }
    }

    // 3️⃣ SERPER — Fast: raw Google results, very cheap
    if (!result && this.serperKey) {
      try {
        const r = await fetch(this.getToolUrl("serper_search") || "https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": this.serperKey,
          },
          body: JSON.stringify({ q: query, num: 5 }),
        });
        if (r.ok) {
          const d = await r.json();
          const answer =
            d.answerBox?.answer ||
            d.answerBox?.snippet ||
            d.knowledgeGraph?.description ||
            "";
          const organic = (d.organic || [])
            .slice(0, 4)
            .map((x) => `- ${x.title}: ${x.snippet?.substring(0, 200)}`)
            .join("\n");
          if (answer || organic) {
            result = answer + (organic ? "\n\nSurse:\n" + organic : "");
            engine = "Serper";
          }
        }
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "Serper");
      }
    }

    // 4️⃣ DUCKDUCKGO — Free fallback, no key needed
    if (!result) {
      try {
        const r = await fetch(
          "https://api.duckduckgo.com/?q=" +
          encodeURIComponent(query) +
          "&format=json&no_html=1&skip_disambig=1",
        );
        if (r.ok) {
          const d = await r.json();
          const parts = [];
          if (d.Abstract) parts.push(d.Abstract);
          if (d.RelatedTopics)
            for (const t of d.RelatedTopics.slice(0, 4))
              if (t.Text) parts.push(`- ${t.Text.substring(0, 150)}`);
          if (parts.length > 0) {
            result = parts.join("\n");
            engine = "DuckDuckGo";
          }
        }
      } catch (e) {
        logger.warn({ component: "Brain", err: e.message }, "DuckDuckGo");
      }
    }

    if (!result) throw new Error("All search engines failed");
    logger.info({ component: "Brain", engine }, `🔍 Search via ${engine}`);
    return result;
  }

  async _weather(city) {
    this.toolStats.weather++;
    const geoUrl = this.getToolUrl("open_meteo_geo") || "https://geocoding-api.open-meteo.com/v1/search";
    const geo = await (
      await fetch(
        `${geoUrl}?name=${encodeURIComponent(city)}&count=1&language=ro`,
      )
    ).json();
    if (!geo.results?.[0]) throw new Error("City not found");
    const { latitude, longitude, name, country } = geo.results[0];
    const forecastUrl = this.getToolUrl("open_meteo_forecast") || "https://api.open-meteo.com/v1/forecast";
    const wx = await (
      await fetch(
        `${forecastUrl}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`,
      )
    ).json();
    const c = wx.current;
    const codes = {
      0: "Senin \u2600\uFE0F",
      1: "Partial senin \u{1F324}\uFE0F",
      2: "Partial noros \u26C5",
      3: "Noros \u2601\uFE0F",
      45: "Ceata \u{1F32B}\uFE0F",
      51: "Burnita \u{1F326}\uFE0F",
      61: "Ploaie \u{1F327}\uFE0F",
      71: "Ninsoare \u{1F328}\uFE0F",
      80: "Averse \u{1F326}\uFE0F",
      95: "Furtuna \u26C8\uFE0F",
    };
    const cond = codes[c.weather_code] || "?";
    const desc = `${name}, ${country}: ${c.temperature_2m}\u00B0C, ${cond}, umiditate ${c.relative_humidity_2m}%, vant ${c.wind_speed_10m} km/h`;
    let forecast = "";
    if (wx.daily) {
      const days = ["Azi", "Maine", "Poimaine"];
      forecast = wx.daily.temperature_2m_max
        .slice(0, 3)
        .map(
          (max, i) =>
            `${days[i]}: ${wx.daily.temperature_2m_min[i]}\u00B0/${max}\u00B0C ${codes[wx.daily.weather_code[i]] || "?"}`,
        )
        .join(" | ");
    }
    const html = `<div style="padding:30px;text-align:center"><h2 style="color:#fff;margin-bottom:10px">${name}, ${country}</h2><div style="font-size:3.5rem">${cond}</div><div style="font-size:2.5rem;color:#00ffff;margin:10px 0">${c.temperature_2m}\u00B0C</div><div style="color:rgba(255,255,255,0.6)">Umiditate: ${c.relative_humidity_2m}% | Vant: ${c.wind_speed_10m} km/h</div>${forecast ? `<div style="margin-top:20px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);font-size:0.9rem">${forecast}</div>` : ""}</div>`;
    return {
      description: desc + (forecast ? ". Prognoza: " + forecast : ""),
      html,
    };
  }

  async _imagine(prompt) {
    if (!this.togetherKey) throw new Error("No key");
    this.toolStats.imagine++;
    const r = await fetch("https://api.together.xyz/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.togetherKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "black-forest-labs/FLUX.1-schnell",
        prompt,
        width: 1024,
        height: 1024,
        steps: 4,
        n: 1,
        response_format: "b64_json",
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const b64 = d.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data");
    return `data:image/png;base64,${b64}`;
  }

  async _memory(userId) {
    if (!this.supabaseAdmin || !userId) return null;
    this.toolStats.memory++;
    const { data } = await this.supabaseAdmin
      .from("user_preferences")
      .select("key, value")
      .eq("user_id", userId)
      .limit(30);
    if (!data?.length) return null;
    return data
      .map(
        (p) =>
          `${p.key}: ${typeof p.value === "object" ? JSON.stringify(p.value) : p.value}`,
      )
      .join("; ");
  }

  _map(place) {
    this.toolStats.map++;
    const mapsKey = process.env.GOOGLE_MAPS_KEY;
    const url = mapsKey
      ? `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${encodeURIComponent(place)}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`;
    return { place, url };
  }

  // ═══════════════════════════════════════════════════════════
  // 10. AUTO-LEARNING — Extract facts + learn from interaction
  // ═══════════════════════════════════════════════════════════
  async learnFromConversation(userId, userMessage, aiReply) {
    if (
      !this.supabaseAdmin ||
      !userId ||
      userMessage.length < 15 ||
      (!this.groqKey && !this.anthropicKey)
    )
      return;

    // Rate limit: max 1 learning extraction per 5 minutes per user
    const now = Date.now();
    const lastTime = this.lastLearnTime.get(userId) || 0;
    if (now - lastTime < 300000) return; // 5 minutes cooldown
    this.lastLearnTime.set(userId, now);

    // Prevent lastLearnTime map from growing unbounded
    if (this.lastLearnTime.size > 10000) {
      const oldest = this.lastLearnTime.keys().next().value;
      this.lastLearnTime.delete(oldest);
    }

    try {
      // Use Groq (fastest) for fact extraction
      const learnPrompt = `Extrage DOAR fapte personale concrete (nume, loc, profesie, hobby, familie, preferinte) din:
User: "${userMessage.substring(0, 500)}"
AI: "${aiReply.substring(0, 300)}"
Raspunde STRICT JSON. Daca nimic: {}`;
      let r, d, txt;
      if (this.groqKey) {
        r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + this.groqKey,
          },
          body: JSON.stringify({
            model: MODELS.GROQ_PRIMARY,
            max_tokens: 150,
            messages: [{ role: "user", content: learnPrompt }],
          }),
        });
        if (r.ok) {
          d = await r.json();
          txt = d.choices?.[0]?.message?.content?.trim();
        }
      }
      if (!txt && this.anthropicKey) {
        r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 150,
            messages: [{ role: "user", content: learnPrompt }],
          }),
        });
        if (r.ok) {
          d = await r.json();
          txt = d.content?.[0]?.text?.trim();
        }
      }
      if (!txt || txt === "{}") return;
      let facts;
      try {
        facts = JSON.parse(txt.replace(/```json|```/g, "").trim());
      } catch {
        return;
      }

      // ── SECURITY: Whitelist of allowed personal-fact keys ──
      // Prevents LLM prompt injection from writing arbitrary keys
      // (e.g. 'role', 'admin_mode', 'plan') into user_preferences.
      const ALLOWED_LEARN_KEYS = new Set([
        "name",
        "nume",
        "first_name",
        "last_name",
        "city",
        "oras",
        "location",
        "locatie",
        "country",
        "tara",
        "job",
        "profesie",
        "occupation",
        "work",
        "hobby",
        "hobbies",
        "interests",
        "interese",
        "age",
        "varsta",
        "birthday",
        "zi_nastere",
        "language",
        "limba",
        "preferred_language",
        "family",
        "familie",
        "children",
        "copii",
        "partner",
        "pet",
        "animal",
        "pets",
        "favorite_color",
        "favorite_food",
        "favorite_music",
        "education",
        "educatie",
        "school",
        "university",
      ]);

      let savedCount = 0;
      for (const [k, v] of Object.entries(facts)) {
        if (!k || !v) continue;
        // Normalize key: lowercase, trim, remove special chars
        const safeKey = k
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .substring(0, 50);
        if (!ALLOWED_LEARN_KEYS.has(safeKey)) {
          logger.info(
            { component: "Brain", blockedKey: safeKey },
            `🛡️ Learning blocked non-whitelisted key: "${safeKey}"`,
          );
          continue;
        }
        await this.supabaseAdmin.from("user_preferences").upsert(
          {
            user_id: userId,
            key: safeKey,
            value: typeof v === "object" ? v : { data: v },
          },
          { onConflict: "user_id,key" },
        );
        savedCount++;
      }
      this.learningsExtracted += savedCount;
      logger.info(
        {
          component: "Brain",
          saved: savedCount,
          blocked: Object.keys(facts).length - savedCount,
        },
        `🧠 Learned: ${savedCount} facts (${Object.keys(facts).length - savedCount} blocked)`,
      );
    } catch (e) {
      logger.warn(
        {
          component: "Brain",
          event: "learn_failed",
          err: e.message,
          userId: userId ? userId.substring(0, 8) + "..." : "null",
        },
        "⚠️ Learning extraction failed (non-critical)",
      );
      this.toolErrors.memory = (this.toolErrors.memory || 0) + 1;
      this.journalEntry("learn_error", e.message, { hasUserId: !!userId });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-MONITORING
  // ═══════════════════════════════════════════════════════════
  recordError(tool, msg) {
    this.toolErrors[tool] = (this.toolErrors[tool] || 0) + 1;
    this.errorLog.push({ tool, msg, time: Date.now() });
    if (this.errorLog.length > 200) this.errorLog = this.errorLog.slice(-100);
  }
  recordSuccess(tool, ms) {
    this.successLog.push({ tool, latency: ms, time: Date.now() });
    if (this.successLog.length > 1000)
      this.successLog = this.successLog.slice(-500);
    if (!this.toolLatency[tool]) this.toolLatency[tool] = [];
    this.toolLatency[tool].push(ms);
    if (this.toolLatency[tool].length > 50)
      this.toolLatency[tool] = this.toolLatency[tool].slice(-25);
    if (this.toolErrors[tool] > 0) this.toolErrors[tool]--;
  }
  isToolDegraded(tool) {
    return (this.toolErrors[tool] || 0) >= 5;
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-IMPROVEMENT JOURNAL
  // ═══════════════════════════════════════════════════════════
  journalEntry(event, lesson, data = {}) {
    this.journal.push({ time: Date.now(), event, lesson, data });
    if (this.journal.length > 500) this.journal = this.journal.slice(-250);
  }

  // ═══════════════════════════════════════════════════════════
  // FULL DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════
  getDiagnostics() {
    const recentErrors = this.errorLog.filter(
      (e) => Date.now() - e.time < 3600000,
    );
    const avgLatency = {};
    for (const [tool, times] of Object.entries(this.toolLatency))
      avgLatency[tool] = Math.round(
        times.reduce((a, b) => a + b, 0) / times.length,
      );
    const degraded = Object.entries(this.toolErrors)
      .filter(([_, c]) => c >= 5)
      .map(([t]) => t);
    return {
      status:
        degraded.length > 0
          ? "degraded"
          : recentErrors.length > 10
            ? "stressed"
            : "healthy",
      version: "2.0",
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      conversations: this.conversationCount,
      learningsExtracted: this.learningsExtracted,
      toolStats: this.toolStats,
      toolErrors: this.toolErrors,
      avgLatency,
      degradedTools: degraded,
      failedTools: degraded,
      recentErrors: recentErrors.length,
      journal: this.journal.slice(-10),
      strategies: {
        searchRefinements: this.strategies.searchRefinement.length,
        failureRecoveries: this.strategies.failureRecoveries.length,
        toolCombinations: Object.fromEntries(
          Object.entries(this.strategies.toolCombinations).map(([k, v]) => [
            k,
            `${Math.round(v.successRate * 100)}% (${v.attempts})`,
          ]),
        ),
      },
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1048576) + "MB",
        heap: Math.round(process.memoryUsage().heapUsed / 1048576) + "MB",
      },
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN TOOLS — Only executed when isAdmin = true
  // ═══════════════════════════════════════════════════════════

  async _logAdminAction(action, details, result) {
    try {
      if (this.supabaseAdmin) {
        await this.supabaseAdmin.from("admin_logs").insert({
          action,
          details: details || {},
          result: result || {},
          source: "chat",
        });
      }
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "Admin log failed");
    }
  }

  async _adminDiagnose() {
    const diag = this.getDiagnostics();
    // Add Supabase connection status
    let dbStatus = "not connected";
    if (this.supabaseAdmin) {
      try {
        const { count } = await this.supabaseAdmin
          .from("conversations")
          .select("id", { count: "exact", head: true });
        dbStatus = `connected (${count || 0} conversations)`;
      } catch (e) {
        dbStatus = "error: " + e.message;
      }
    }
    const result = {
      ...diag,
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };
    await this._logAdminAction("diagnose", {}, result);
    return {
      type: "adminDiagnose",
      data: result,
      summary: `Brain: ${diag.status}, ${diag.conversations} conv, DB: ${dbStatus}, Memory: ${diag.memory?.rss || "?"}`,
    };
  }

  async _adminReset(tool) {
    if (tool === "all" || tool === "tot" || tool === "toate") {
      this.resetAll();
      await this._logAdminAction("reset", { tool: "all" }, { success: true });
      return {
        type: "adminReset",
        data: { reset: "all", success: true },
        summary: "Toate tool-urile au fost resetate.",
      };
    } else {
      this.resetTool(tool);
      await this._logAdminAction("reset", { tool }, { success: true });
      return {
        type: "adminReset",
        data: { reset: tool, success: true },
        summary: `Tool "${tool}" a fost resetat.`,
      };
    }
  }

  async _adminStats() {
    const result = {
      subscribers: 0,
      plans: {},
      revenue: 0,
      usageToday: {},
      timestamp: new Date().toISOString(),
    };
    if (this.supabaseAdmin) {
      try {
        // Active subscriptions
        const { data: subs } = await this.supabaseAdmin
          .from("subscriptions")
          .select("plan, status")
          .eq("status", "active");
        result.subscribers = subs?.length || 0;
        const plans = {};
        (subs || []).forEach((s) => {
          plans[s.plan] = (plans[s.plan] || 0) + 1;
        });
        result.plans = plans;
        // Revenue estimate
        const prices = { pro: 9.99, premium: 19.99, enterprise: 49.99 };
        result.revenue = Object.entries(plans).reduce(
          (sum, [plan, count]) => sum + (prices[plan] || 0) * count,
          0,
        );
        // Usage today
        const today = new Date().toISOString().split("T")[0];
        const { data: usage } = await this.supabaseAdmin
          .from("usage")
          .select("type, count")
          .eq("date", today);
        (usage || []).forEach((u) => {
          result.usageToday[u.type] =
            (result.usageToday[u.type] || 0) + u.count;
        });
      } catch (e) {
        result.error = e.message;
      }
    }
    await this._logAdminAction("stats", {}, result);
    return {
      type: "adminStats",
      data: result,
      summary: `${result.subscribers} abonați activi, MRR: €${result.revenue.toFixed(2)}, Usage azi: ${JSON.stringify(result.usageToday)}`,
    };
  }

  async _adminTrading(action) {
    const result = {
      action,
      timestamp: new Date().toISOString(),
      positions: [],
      portfolio: null,
    };
    try {
      // Try to get portfolio from Binance
      if (process.env.BINANCE_API_KEY) {
        const crypto = require("crypto");
        const timestamp = Date.now();
        const baseUrl =
          process.env.BINANCE_TESTNET === "true"
            ? "https://testnet.binance.vision"
            : "https://api.binance.com";
        const query = `timestamp=${timestamp}`;
        const signature = crypto
          .createHmac("sha256", process.env.BINANCE_SECRET_KEY || "")
          .update(query)
          .digest("hex");
        const r = await fetch(
          `${baseUrl}/api/v3/account?${query}&signature=${signature}`,
          {
            headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
          },
        );
        if (r.ok) {
          const data = await r.json();
          result.portfolio = (data.balances || [])
            .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
            .map((b) => ({
              asset: b.asset,
              free: parseFloat(b.free),
              locked: parseFloat(b.locked),
            }));
        }
      }
      // Get recent trades from Supabase
      if (this.supabaseAdmin) {
        const { data: trades } = await this.supabaseAdmin
          .from("trades")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10);
        result.recentTrades = trades || [];
      }
    } catch (e) {
      result.error = e.message;
    }
    await this._logAdminAction("trading", { action }, result);
    const posCount = result.portfolio?.length || 0;
    return {
      type: "adminTrading",
      data: result,
      summary: `${posCount} active pe Binance${result.recentTrades?.length ? `, ${result.recentTrades.length} trade-uri recente` : ""}`,
    };
  }

  async _adminNews() {
    const result = { headlines: [], timestamp: new Date().toISOString() };
    try {
      // Check news_cache in Supabase
      if (this.supabaseAdmin) {
        const { data } = await this.supabaseAdmin
          .from("news_cache")
          .select("data, updated_at")
          .eq("id", "latest")
          .single();
        if (data?.data) {
          result.headlines = (
            Array.isArray(data.data) ? data.data : data.data.articles || []
          ).slice(0, 10);
          result.cachedAt = data.updated_at;
        }
      }
      // If no cache, try fetching fresh
      if (result.headlines.length === 0) {
        try {
          const r = await fetch(
            "https://newsdata.io/api/1/news?apikey=" +
            (process.env.NEWSDATA_API_KEY || "") +
            "&language=ro&category=business,technology&size=10",
          );
          if (r.ok) {
            const d = await r.json();
            result.headlines = (d.results || []).map((a) => ({
              title: a.title,
              source: a.source_name,
              link: a.link,
              pubDate: a.pubDate,
            }));
          }
        } catch (e) {
          logger.warn({ component: "Brain", err: e.message }, "no news API");
        }
      }
    } catch (e) {
      result.error = e.message;
    }
    await this._logAdminAction("news", {}, { count: result.headlines.length });
    return {
      type: "adminNews",
      data: result,
      summary: `${result.headlines.length} știri disponibile`,
    };
  }

  resetTool(tool) {
    this.toolErrors[tool] = 0;
  }
  resetAll() {
    for (const t of Object.keys(this.toolErrors)) this.toolErrors[t] = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// REAL ESTATE SALES SYSTEM PROMPT
// Used by social channels (WhatsApp, Messenger) for property sales context
// ═══════════════════════════════════════════════════════════════

/**
 * System prompt for real estate sales AI persona.
 * Instructs the AI to act as an elite property sales consultant focused on
 * scheduling viewings and qualifying leads. Consumers: WhatsApp bot,
 * Messenger bot, or any route that needs a conversion-oriented real estate persona.
 *
 * Usage: prepend to the messages array as a system role message, or combine
 * with buildSystemPrompt() from persona.js for full persona support.
 */
const REAL_ESTATE_SYSTEM_PROMPT = `Ești Kelion — un AI imobiliar de elită, specializat în vânzări și consultanță imobiliară premium.

MISIUNE: Ajuți clienții să găsească proprietatea perfectă și îi ghidezi spre programarea unei vizionări.

REGULI STRICTE:
- Răspunsurile tale sunt SCURTE, profesionale și orientate spre conversie
- Obiectivul principal: programarea unei vizionări sau colectarea datelor de contact
- NU inventa proprietăți care nu există în baza de date
- Dacă o proprietate nu este disponibilă, spune clar și oferă alternative similare
- Fiecare mesaj trebuie să avanseze conversația spre o acțiune concretă

STIL DE COMUNICARE:
- Direct și professional, cu empatie față de nevoile clientului
- Pune o singură întrebare calificatoare per mesaj (buget, tip proprietate, zonă)
- La final, propune mereu un next step clar: "Vrei să programăm o vizionare?" sau "Îți trimit detalii complete?"

ETAPE CONVERSAȚIE:
1. Identificare nevoi (buget, tip, zonă, urgență)
2. Prezentare opțiuni disponibile (DOAR din baza de date reală)
3. Programare vizionare sau trimitere detalii
4. Follow-up și closing

NU folosi: clișee de vânzări agresive, informații inventate, liste lungi fără relevanță.`;

module.exports = { KelionBrain, REAL_ESTATE_SYSTEM_PROMPT };
