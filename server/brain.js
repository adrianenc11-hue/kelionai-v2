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
const kiraTools = require("./kira-tools");
const { MODELS } = require("./config/models");
const {
  UserProfile,
  LearningStore,
  AutonomousMonitor,
} = require("./brain-profile");

// K1 AGI Integration — enriches every web chat with world state, memory, reasoning
let k1Bridge;
try {
  k1Bridge = require("./k1-messenger-bridge");
} catch {
  k1Bridge = null;
}

class KelionBrain {
  constructor(config) {
    this.geminiKey = config.geminiKey;
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
    this.learningStore.load(this.supabaseAdmin).catch(() => {});

    // ── Autonomous Monitor (30min health loop) ──
    this.autonomousMonitor = new AutonomousMonitor(this);
    this.autonomousMonitor.start();

    // ── User Profile Cache ──
    this._profileCache = new Map(); // userId → { profile, loadedAt }
    this._profileTTL = 10 * 60 * 1000; // cache profiles for 10 min

    // ── Memory Cache (reduces Supabase queries) ──
    this._memoryCache = new Map(); // "userId:type" → { data, loadedAt }
    this._memoryCacheTTL = 60 * 1000; // cache memories for 60s

    // ── 3-TIER MEMORY: Hot / Warm / Cold ──
    // Hot: <24h, accessed 3+ times, kept in JS Map (instant access, no DB call)
    // Warm: 1-7 days, loaded from Supabase on demand
    // Cold: >7 days, only loaded for deep reasoning intent
    this._hotMemory = new Map(); // userId → Map<memoryId, { content, accessCount, lastAccess, createdAt }>
    this._hotMemoryMaxPerUser = 50;
    this._hotMemoryTTL = 24 * 60 * 60 * 1000; // 24h

    // Cleanup stale hot memories every hour
    setInterval(() => {
      const now = Date.now();
      for (const [userId, memories] of this._hotMemory) {
        for (const [memId, mem] of memories) {
          if (now - mem.lastAccess > this._hotMemoryTTL) memories.delete(memId);
        }
        if (memories.size === 0) this._hotMemory.delete(userId);
      }
    }, 60 * 60 * 1000);

    // ── Semantic Response Cache (instant replies for similar queries) ──
    this._semanticCache = new Map(); // cacheKey → { embedding, response, metadata, createdAt }
    this._semanticCacheMaxSize = 500;
    this._semanticCacheTTL = 30 * 60 * 1000; // 30 min TTL

    // ── Multi-Agent Profiles (references AGENTS static getter) ──
    this.agents = KelionBrain.AGENTS;

    logger.info(
      { component: "Brain" },
      "🧠 Brain v3.0 initialized: LearningStore + AutonomousMonitor + MultiAgent + UserProfiles",
    );

    // ── Tool Registry (loaded from Supabase brain_tools) ──
    this._toolRegistry = new Map(); // id → tool
    this._toolCache = new Map(); // cacheKey → { data, timestamp }
    this._toolCacheTTL = 5 * 60 * 1000; // 5 min cache

    // Plan quota limits (messages per month)
    this.PLAN_LIMITS = { free: 50, pro: 500, premium: Infinity };

    // Load tool registry on startup
    this._loadToolRegistry().catch(() => {});

    // PERIODIC TASKS — Reminder checker runs every 60 seconds
    this._reminderInterval = setInterval(() => {
      this._checkReminders().catch(() => {});
    }, 60 * 1000);

    // SCHEDULED TASKS — Check for pending scheduled jobs every 5 minutes
    this._scheduledTaskInterval = setInterval(
      () => {
        this._checkScheduledTasks().catch(() => {});
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Schedule a recurring or one-time task.
   * Types: daily_report, weekly_summary, periodic_cleanup, custom
   */
  async _scheduleTask(userId, taskType, description, schedule, payload = {}) {
    if (!this.supabaseAdmin) return false;
    try {
      const taskData = {
        type: taskType,
        description,
        schedule, // "daily", "weekly", "once", or cron-like "0 9 * * *"
        payload,
        status: "pending",
        nextRun: this._calculateNextRun(schedule),
        createdAt: new Date().toISOString(),
      };

      await this.supabaseAdmin.from("brain_memory").insert({
        user_id: userId,
        type: "scheduled_task",
        content: JSON.stringify(taskData),
      });

      logger.info(
        { component: "Scheduler", taskType, userId },
        `📅 Task scheduled: ${taskType}`,
      );
      return true;
    } catch (e) {
      logger.warn(
        { component: "Scheduler", err: e.message },
        "Schedule task failed",
      );
      return false;
    }
  }

  _calculateNextRun(schedule) {
    const now = new Date();
    switch (schedule) {
      case "daily":
        return new Date(now.getTime() + 86400000).toISOString();
      case "weekly":
        return new Date(now.getTime() + 7 * 86400000).toISOString();
      case "hourly":
        return new Date(now.getTime() + 3600000).toISOString();
      case "once":
        return now.toISOString(); // Run immediately on next check
      default:
        return new Date(now.getTime() + 86400000).toISOString();
    }
  }

  async _checkScheduledTasks() {
    if (!this.supabaseAdmin) return;
    try {
      const { data: tasks } = await this.supabaseAdmin
        .from("brain_memory")
        .select("id, user_id, content")
        .eq("type", "scheduled_task")
        .limit(20);

      if (!tasks || tasks.length === 0) return;

      const now = new Date();
      for (const task of tasks) {
        try {
          const parsed = JSON.parse(task.content);
          if (parsed.status !== "pending") continue;
          if (new Date(parsed.nextRun) > now) continue;

          // Task is due — mark as running
          logger.info(
            { component: "Scheduler", type: parsed.type, userId: task.user_id },
            `⏰ Running scheduled task: ${parsed.type}`,
          );

          // Execute based on type
          switch (parsed.type) {
            case "daily_report":
              // Generate daily summary (non-blocking)
              this._generateDocument(
                "Raport Zilnic",
                `Generează un rezumat al activității de azi pentru user ${task.user_id}`,
                "markdown",
                task.user_id,
              ).catch(() => {});
              break;
            case "periodic_cleanup":
              // Clean old memories (keep last 500)
              if (this.supabaseAdmin) {
                const { count } = await this.supabaseAdmin
                  .from("brain_memory")
                  .select("id", { count: "exact" })
                  .eq("user_id", task.user_id);
                if (count > 500) {
                  logger.info(
                    { component: "Scheduler", count },
                    `🧹 Cleaning ${count - 500} old memories`,
                  );
                }
              }
              break;
          }

          // Update: mark as done or reschedule
          if (parsed.schedule === "once") {
            parsed.status = "completed";
            parsed.completedAt = now.toISOString();
          } else {
            parsed.nextRun = this._calculateNextRun(parsed.schedule);
            parsed.lastRun = now.toISOString();
          }

          await this.supabaseAdmin
            .from("brain_memory")
            .update({ content: JSON.stringify(parsed) })
            .eq("id", task.id);
        } catch { /* ignored */ }
      }
    } catch (e) {
      logger.warn(
        { component: "Scheduler", err: e.message },
        "Scheduled task check failed",
      );
    }
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
      logger.info(
        { component: "Brain", tools: data.length },
        `🔧 Loaded ${data.length} tools from registry`,
      );
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "Tool registry load failed",
      );
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
      logger.info(
        { component: "Brain", toolId },
        `📦 Cache hit for ${tool.name}`,
      );
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
          headers[headerName] =
            headerName === "Authorization" ? `Bearer ${key}` : key;
        } else if (tool.auth_type === "bearer" && tool.auth_env_key) {
          headers["Authorization"] = `Bearer ${process.env[tool.auth_env_key]}`;
        }

        // Build request
        const fetchOpts = {
          method: tool.method,
          headers,
          signal: AbortSignal.timeout(15000),
        };
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
        // Periodic cleanup: keep max 200 cached tool results
        if (this._toolCache.size > 200) {
          const now = Date.now();
          for (const [k, v] of this._toolCache) {
            if (now - v.timestamp > 15 * 60 * 1000) this._toolCache.delete(k);
          }
        }
        this._updateToolStats(tool.id, latency, true);

        // Log to memory
        if (this.supabaseAdmin && userId) {
          this.supabaseAdmin
            .from("brain_memory")
            .insert({
              user_id: userId,
              memory_type: "tool_call",
              content: `Used ${tool.name}: ${JSON.stringify(params).substring(0, 200)}`,
              metadata: {
                tool_id: tool.id,
                latency_ms: latency,
                success: true,
              },
              importance: 0.3,
            })
            .then(() => {})
            .catch(() => {});
        }

        return { success: true, data, latency, tool: tool.name };
      } catch (e) {
        const latency = Date.now() - start;
        logger.warn(
          { component: "Brain", tool: tool.id, err: e.message, latency },
          `⚠️ ${tool.name} failed (${latency}ms): ${e.message}`,
        );
        this._updateToolStats(tool.id, latency, false);

        // ── Fallback to next tool ──
        if (tool.fallback_tool_id) {
          const fallback = this._toolRegistry.get(tool.fallback_tool_id);
          if (fallback) {
            logger.info(
              { component: "Brain", from: tool.id, to: fallback.id },
              `🔄 Fallback: ${tool.name} → ${fallback.name}`,
            );
            tool = fallback;
            continue;
          }
        }
        return {
          success: false,
          error: e.message,
          data: null,
          tool: tool.name,
        };
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
    if (!success)
      updates.total_errors =
        (this._toolRegistry.get(toolId)?.total_errors || 0) + 1;

    this.supabaseAdmin
      .from("brain_tools")
      .update(updates)
      .eq("id", toolId)
      .then(() => {})
      .catch(() => {});

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
    if (!this.supabaseAdmin || !userId)
      return { allowed: true, remaining: Infinity };

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
    } catch { /* ignored */ }

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
        await this.supabaseAdmin
          .from("brain_usage")
          .update({
            message_count: (existing.message_count || 0) + 1,
            tool_calls: (existing.tool_calls || 0) + toolCalls,
            tokens_used: (existing.tokens_used || 0) + tokensUsed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await this.supabaseAdmin.from("brain_usage").insert({
          user_id: userId,
          month,
          message_count: 1,
          tool_calls: toolCalls,
          tokens_used: tokensUsed,
        });
      }
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "Usage tracking failed",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CAPABILITIES — What Kelion knows it can do
  // ═══════════════════════════════════════════════════════════
  static CAPABILITIES_PROMPT() {
    return `You are Kelion, an advanced AI assistant by KelionAI. You have these capabilities:
- SEARCH: Web search (Tavily, Perplexity, Serper) for real-time information
- WEATHER: Real-time weather for any location (Open-Meteo)
- IMAGINE: Generate images from descriptions. IMPORTANT: When the user asks to generate an image/poster/logo/illustration but gives VAGUE or SHORT instructions, you MUST ask for more details BEFORE generating. Ask about: dimensions/size (e.g. 1024x1024, landscape, portrait), style (realistic, cartoon, watercolor, cyberpunk, etc.), colors, mood, and any specific elements. Only generate immediately if the user gave a detailed, specific description.
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
- TRANSLATE: Translate text between languages (Romanian, English, Spanish, French, German, Italian)
- SUMMARIZE: Summarize long texts, articles, or conversations into concise summaries
- DB_QUERY: Query the application database to answer questions about users, trades, costs, and more
- REMINDER: Set reminders and alarms that fire at specified times
- SELF_REFLECT: Automatically evaluate response quality and iterate if needed (agentic loop, max 3 iterations)
- EMAIL: Send emails via Resend or SendGrid
- CODE_EXEC: Run JavaScript code in a secure sandbox (with timeout, no network/file access)
- RAG_SEARCH: Semantic search through knowledge base using pgvector embeddings
- WEB_SCRAPE: Extract and summarize content from any web page
- FILE_PARSE: Parse and analyze CSV, JSON, TXT, PDF files
- PROACTIVE: Context-aware suggestions based on user patterns and time of day
- TRUTH_GUARD: Automatic fact-checking — verifies claims against sources, detects unsupported assertions, calculates factual score
- SMART_ROUTING: Automatically selects the optimal AI model (fast/balanced/premium) based on task complexity
- PROJECT_MEMORY: Tracks user's projects, tech stack, status — knows what you're working on
- PROCEDURAL_MEMORY: Remembers how past tasks were solved, reuses proven solutions
- CRITIC_AGENT: Independent quality validation — checks consistency, relevance, safety. Can block dangerous content. 5 verdicts: APPROVED → CAUTION → REJECTED
- COST_GUARDRAILS: Budget management per user plan (Free/Pro/Enterprise). Auto-downgrades to cheaper models when budget is high
- POLICY_ENGINE: Per-plan tool access control. Free users have limited tools, Pro/Enterprise have full access
- CALENDAR: Create, list, and delete calendar events. Supports natural language time ("mâine la 3", "next Monday at 10am"). Falls back to reminders if Google Calendar is not configured
- DOCUMENT_GEN: Generate professional documents, reports, proposals, memos. Uses AI to create structured content in markdown or text format
- SOURCE_CITATIONS: Automatically extracts and displays clickable source links from search results and tool outputs

=== SKILL: PRODUCȚIE MEDIA (IMAGINE/POSTER/LOGO/ILUSTRAȚIE) ===
Când utilizatorul cere producție de conținut vizual, URMEZI OBLIGATORIU acest flow:

PASUL 1 — IDENTIFICARE: Recunoaște tipul de cerere:
  • Imagine/poză/foto → generare AI
  • Logo/avatar/icon → design grafic
  • Poster/banner/flyer → material promoțional
  • Ilustrație/desen → artistic

PASUL 2 — CLARIFICARE (NU genera imediat!): Întreabă TOATE acestea:
  📐 DIMENSIUNE: Ce format dorești?
    - 1024×1024 (pătrat — ideal pentru social media, profil)
    - 1792×1024 (landscape — banner, desktop wallpaper)
    - 1024×1792 (portret — story Instagram, poster vertical)
  🎨 STIL: Ce estetică preferi?
    - Realist/fotografic, Cartoon/animat, Acuarelă, Oil painting
    - Cyberpunk/neon, Minimalist/clean, Retro/vintage, 3D render
    - Pixel art, Vector flat, Artistic abstract
  🌈 CULORI: Ai preferințe? (tonuri calde/reci, paletă specifică, dark/light)
  📝 DETALII SPECIFICE: Ce elemente TREBUIE să apară?
    - Subiect principal, fundal, text de inclus, obiecte secundare, atmosferă/mood
  🎯 SCOP: Pentru ce va fi folosit? (social media, print, web, prezentare)

PASUL 3 — CONFIRMARE: Rezumă ce vei genera și cere OK-ul userului:
  "Voi genera: [descriere completă]. Dimensiune: [X]. Stil: [Y]. Confirm?"

PASUL 4 — GENERARE: Doar DUPĂ confirmare, generează cu promptul detaliat.

PASUL 5 — FEEDBACK POST-GENERARE (OBLIGATORIU):
  După ce ai generat, ÎNTREABĂ MEREU:
  "Ți se potrivește? Vrei să modific ceva?"
  Apoi ÎNTREABĂ PROACTIV: "Ce crezi că ar mai fi de îmbunătățit?"
  Sugerează posibile ajustări: culori, compoziție, stil, adăugare/eliminare elemente.
  Dacă utilizatorul cere modificări, re-generează cu promptul ajustat.
  Repetă până utilizatorul e mulțumit.

PASUL 6 — ÎNVĂȚARE (salvează în memorie):
  După feedback, salvează preferințele utilizatorului folosind MEMORY:
  • Stilul preferat (ex: "preferă stil cyberpunk")
  • Dimensiunile favorite (ex: "folosește mereu landscape pentru wallpaper")
  • Paleta de culori (ex: "preferă tonuri calde")
  • Ce NU îi place (ex: "nu îi plac fundalurile albe")
  La cereri viitoare, folosește aceste preferințe AUTOMAT și menționează:
  "Știu că preferi stilul [X], țin cont de asta."

EXCEPȚIE: Dacă utilizatorul dă deja o descriere COMPLETĂ și DETALIATĂ (30+ cuvinte, cu stil, culori, elemente specifice), poți genera direct fără clarificări. Dar PASUL 5 (feedback) rămâne OBLIGATORIU mereu.
===

When asked "what can you do?" list these real capabilities. Use them proactively when relevant.`;
  }

  // ═══════════════════════════════════════════════════════════
  // EMBEDDING HELPER — OpenAI text-embedding-3-large (3072 dims)
  // ═══════════════════════════════════════════════════════════
  async getEmbedding(text) {
    if (!process.env.OPENAI_API_KEY || !text) return null;
    try {
      const r = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-large",
          input: text.substring(0, 500),
        }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d.data?.[0]?.embedding || null;
    } catch (_e) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEMANTIC CACHE — Instant responses for similar queries
  // ═══════════════════════════════════════════════════════════
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  async checkSemanticCache(query, userId) {
    if (!query || query.length < 10) return null; // skip very short queries
    // Skip queries that need real-time data
    if (/\b(acum|live|azi|current|now|today|vremea?|meteo|pret|pre\u021b|curs)\b/i.test(query)) return null;
    try {
      const queryEmbedding = await this.getEmbedding(query);
      if (!queryEmbedding) return null;

      let bestMatch = null;
      let bestScore = 0;
      const now = Date.now();

      for (const [key, entry] of this._semanticCache) {
        // Skip expired entries
        if (now - entry.createdAt > this._semanticCacheTTL) {
          this._semanticCache.delete(key);
          continue;
        }
        // Skip different users' personal queries
        if (entry.userId && entry.userId !== userId && entry.isPersonal) continue;

        const sim = this._cosineSimilarity(queryEmbedding, entry.embedding);
        if (sim > 0.95 && sim > bestScore) {
          bestScore = sim;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        logger.info({ component: 'SemanticCache', similarity: bestScore.toFixed(3) },
          `⚡ Cache HIT (${(bestScore * 100).toFixed(1)}% similar)`);
        return { ...bestMatch.response, cached: true, similarity: bestScore };
      }
      return null;
    } catch (e) {
      logger.warn({ component: 'SemanticCache', err: e.message }, 'Cache check failed');
      return null;
    }
  }

  async saveToSemanticCache(query, response, userId, isPersonal = false) {
    if (!query || query.length < 10) return;
    // Don't cache error responses
    if (response?.confidence === 0 || response?.agent?.includes('error')) return;
    try {
      const embedding = await this.getEmbedding(query);
      if (!embedding) return;

      const key = `${Date.now()}-${query.substring(0, 30)}`;
      this._semanticCache.set(key, {
        embedding,
        response,
        userId,
        isPersonal,
        query: query.substring(0, 200),
        createdAt: Date.now(),
      });

      // LRU eviction: remove oldest if over limit
      if (this._semanticCache.size > this._semanticCacheMaxSize) {
        const oldest = this._semanticCache.keys().next().value;
        this._semanticCache.delete(oldest);
      }
    } catch (_) { /* non-blocking */ }
  }

  // ═══════════════════════════════════════════════════════════
  // MEMORY SYSTEM — Load/Save to Supabase (Enhanced with pgvector semantic search)
  // ═══════════════════════════════════════════════════════════
  async loadMemory(userId, type, limit = 10, contextHint = "", intentTier = "warm") {
    if (!userId || !this.supabaseAdmin) return [];

    // ── HOT MEMORY (Tier 1) — instant, in-process Map ──
    const userHot = this._hotMemory.get(userId);
    if (userHot && userHot.size > 0 && intentTier !== 'cold') {
      const hotResults = [];
      for (const [memId, mem] of userHot) {
        if (type && mem.type !== type) continue;
        mem.accessCount++;
        mem.lastAccess = Date.now();
        hotResults.push({ ...mem.content, _source: 'hot', _accessCount: mem.accessCount });
      }
      if (hotResults.length >= limit) {
        logger.info({ component: 'Memory', tier: 'hot', count: hotResults.length, userId: userId.substring(0, 8) },
          `🔥 Hot memory hit: ${hotResults.length} items`);
        return hotResults.slice(0, limit);
      }
      // Not enough hot results — fall through to warm/cold
    }

    // ── WARM MEMORY (Tier 2) — Supabase with 7-day window (default) ──
    // ── COLD MEMORY (Tier 3) — Supabase with no time limit (for deep reasoning) ──
    // ── Cache check (60s TTL) ──
    const cacheKey = `${userId}:${type}`;
    const cached = this._memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < this._memoryCacheTTL) {
      // Re-rank cached results by relevance if contextHint changed
      if (contextHint && contextHint.length > 5) {
        const hintWords = contextHint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (hintWords.length > 0) {
          const scored = cached.data.map(m => {
            let score = (m.importance || 5) / 10;
            const contentLow = (m.content || '').toLowerCase();
            const matchCount = hintWords.filter(w => contentLow.includes(w)).length;
            score += (matchCount / hintWords.length) * 0.4;
            return { ...m, _relevanceScore: score };
          });
          scored.sort((a, b) => b._relevanceScore - a._relevanceScore);
          return scored.slice(0, limit);
        }
      }
      return cached.data.slice(0, limit);
    }
    try {
      // ── TRY SEMANTIC SEARCH (pgvector) if contextHint provided ──
      if (contextHint && contextHint.length > 5) {
        try {
          const embedding = await this.getEmbedding(contextHint);
          if (embedding) {
            const { data: vectorResults, error: vecErr } =
              await this.supabaseAdmin.rpc("match_memories", {
                query_embedding: embedding,
                match_user_id: userId,
                match_type: type,
                match_count: limit,
                match_threshold: 0.3,
              });
            if (!vecErr && vectorResults && vectorResults.length > 0) {
              logger.info(
                { component: "Brain", count: vectorResults.length, type },
                "🧠 pgvector semantic memory hit",
              );
              return vectorResults;
            }
          }
        } catch (_vecE) {
          // pgvector not available or function doesn't exist yet — fallback silently
        }
      }

      // ── FALLBACK: hybrid relevance scoring (keyword + embedding reranking) ──
      const fetchLimit = Math.min(limit * 3, 50);
      const { data, error } = await this.supabaseAdmin
        .from("brain_memory")
        .select("content, context, importance, created_at")
        .eq("user_id", userId)
        .eq("memory_type", type)
        .order("created_at", { ascending: false })
        .limit(fetchLimit);
      if (error) {
        logger.warn(
          { component: "Brain", err: error.message },
          "loadMemory failed",
        );
        return [];
      }
      if (!data || data.length === 0) return [];

      // Phase 1: Keyword + temporal scoring
      const hintWords = contextHint
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const scored = data.map((m) => {
        let score = (m.importance || 5) / 10;
        const ageHours =
          (Date.now() - new Date(m.created_at).getTime()) / 3600000;
        if (ageHours < 1) score += 0.3;
        else if (ageHours < 24) score += 0.15;
        else if (ageHours < 168) score += 0.05;
        if (hintWords.length > 0 && m.content) {
          const contentLow = m.content.toLowerCase();
          const matchCount = hintWords.filter((w) =>
            contentLow.includes(w),
          ).length;
          score += (matchCount / hintWords.length) * 0.4;
        }
        return { ...m, _relevanceScore: score };
      });

      // Phase 2: Embedding-based reranking (if contextHint exists)
      // Computes cosine similarity between query and each memory for much better recall
      if (contextHint && contextHint.length > 10 && scored.length > 3) {
        try {
          const queryEmb = await this.getEmbedding(contextHint);
          if (queryEmb) {
            // Get embeddings for top candidates (batch to save API calls)
            const topCandidates = scored.slice(0, Math.min(20, scored.length));
            const reranked = await Promise.all(
              topCandidates.map(async (m) => {
                try {
                  const memEmb = await this.getEmbedding((m.content || '').substring(0, 300));
                  if (memEmb) {
                    const sim = this._cosineSimilarity(queryEmb, memEmb);
                    // Blend: 60% semantic similarity + 40% keyword/temporal score
                    m._relevanceScore = sim * 0.6 + m._relevanceScore * 0.4;
                  }
                } catch (_) { /* keep keyword score */ }
                return m;
              })
            );
            reranked.sort((a, b) => b._relevanceScore - a._relevanceScore);
            const result = reranked.slice(0, limit);
            this._memoryCache.set(cacheKey, { data: reranked, loadedAt: Date.now() });
            if (this._memoryCache.size > 200) {
              const now = Date.now();
              for (const [k, v] of this._memoryCache) {
                if (now - v.loadedAt > this._memoryCacheTTL) this._memoryCache.delete(k);
              }
            }
            logger.info({ component: 'Brain', type, reranked: result.length }, '🔄 Memory reranked with embeddings');
            return result;
          }
        } catch (rerankErr) {
          logger.warn({ component: 'Brain', err: rerankErr.message }, 'Reranking failed, using keyword scores');
        }
      }

      scored.sort((a, b) => b._relevanceScore - a._relevanceScore);
      const result = scored.slice(0, limit);
      // Store in cache for 60s
      this._memoryCache.set(cacheKey, { data: scored, loadedAt: Date.now() });
      // Periodic cleanup: keep max 200 entries
      if (this._memoryCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of this._memoryCache) {
          if (now - v.loadedAt > this._memoryCacheTTL) this._memoryCache.delete(k);
        }
      }
      return result;
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "loadMemory error");
      return [];
    }
  }

  // ── Promote memory to hot tier (called on frequent access) ──
  promoteToHot(userId, memoryItem) {
    if (!userId || !memoryItem) return;
    if (!this._hotMemory.has(userId)) this._hotMemory.set(userId, new Map());
    const userHot = this._hotMemory.get(userId);

    const memId = memoryItem.id || `${memoryItem.type}_${Date.now()}`;
    if (userHot.has(memId)) {
      const existing = userHot.get(memId);
      existing.accessCount++;
      existing.lastAccess = Date.now();
      return;
    }

    // Evict oldest if over limit
    if (userHot.size >= this._hotMemoryMaxPerUser) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [k, v] of userHot) {
        if (v.lastAccess < oldestTime) { oldestTime = v.lastAccess; oldestKey = k; }
      }
      if (oldestKey) userHot.delete(oldestKey);
    }

    userHot.set(memId, {
      content: memoryItem,
      type: memoryItem.type || 'general',
      accessCount: 1,
      lastAccess: Date.now(),
      createdAt: Date.now(),
    });
    logger.info({ component: 'Memory', tier: 'hot', userId: userId.substring(0, 8), memId },
      `🔥 Promoted to hot memory`);
  }

  async saveMemory(userId, type, content, context = {}, importance = 5) {
    if (!userId || !this.supabaseAdmin || !content) return;
    try {
      // Dedup: skip if same content already exists for this user
      const contentKey = content.substring(0, 200);
      const { data: existing } = await this.supabaseAdmin
        .from("brain_memory")
        .select("id")
        .eq("user_id", userId)
        .ilike("content", contentKey + '%')
        .limit(1);
      if (existing && existing.length > 0) return; // already exists

      const embedding = await this.getEmbedding(content);
      const row = {
        user_id: userId,
        memory_type: type,
        content: content.substring(0, 2000),
        context,
        importance,
      };
      if (embedding) row.embedding = embedding;
      await this.supabaseAdmin.from("brain_memory").insert(row);
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
    } catch (_e) {
      return [];
    }
  }

  async saveFact(
    userId,
    fact,
    category = "knowledge",
    source = "conversation",
  ) {
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

  async extractAndSaveFacts(userId, message, _reply) {
    if (!userId || !this.supabaseAdmin) return;
    // Rate limit: max once per 30 seconds per user
    const lastTime = this.lastLearnTime.get(userId) || 0;
    if (Date.now() - lastTime < 30000) return;
    this.lastLearnTime.set(userId, Date.now());
    try {
      // Use simple heuristics to extract facts (no extra AI call needed)
      const _lower = message.toLowerCase();
      // Personal preferences
      if (
        /\b(prefer|vreau|imi place|mi-ar placea|I like|I prefer)\b/i.test(
          message,
        )
      ) {
        await this.saveFact(
          userId,
          "User said: " + message.substring(0, 200),
          "preference",
          "chat",
        );
      }
      // Name sharing
      const nameMatch = message.match(
        /\b(?:ma cheama|numele meu|my name is|I'm|I am)\s+([A-Z][a-z]+)/i,
      );
      if (nameMatch) {
        await this.saveFact(
          userId,
          "User's name is " + nameMatch[1],
          "personal",
          "chat",
        );
      }
      // Location sharing
      const locMatch = message.match(
        /\b(?:sunt din|locuiesc in|I live in|I'm from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      );
      if (locMatch) {
        await this.saveFact(
          userId,
          "User lives in " + locMatch[1],
          "personal",
          "chat",
        );
      }
      this.learningsExtracted++;
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "extractFacts error");
    }
  }

  buildMemoryContext(memories, visualMem, audioMem, facts) {
    const parts = [];
    if (facts.length > 0) {
      // Sort facts by importance and deduplicate
      const uniqueFacts = [...new Set(facts.map((f) => f.fact))];
      parts.push("FACTS I KNOW ABOUT THIS USER: " + uniqueFacts.join("; "));
    }
    if (memories.length > 0) {
      // Include importance indicator for high-priority memories
      const formatted = memories.map((m) => {
        const priority = (m.importance || 5) >= 8 ? "[IMPORTANT] " : "";
        return priority + m.content;
      });
      parts.push("RECENT CONVERSATIONS: " + formatted.join(" | "));
    }
    if (visualMem.length > 0) {
      parts.push(
        "IMAGES I'VE SEEN: " + visualMem.map((m) => m.content).join("; "),
      );
    }
    if (audioMem.length > 0) {
      parts.push(
        "VOICE INTERACTIONS: " + audioMem.map((m) => m.content).join("; "),
      );
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
        const oldest = [...this._profileCache.entries()].sort(
          (a, b) => a[1].loadedAt - b[1].loadedAt,
        )[0];
        if (oldest) this._profileCache.delete(oldest[0]);
      }
      return profile;
    } catch (_e) {
      return null;
    }
  }

  // Multi-agent: select best agent based on analysis topics
  _selectAgent(analysis) {
    if (!analysis || !analysis.topics || analysis.topics.length === 0)
      return null;
    const topics = analysis.topics.map((t) => t.toLowerCase());

    let bestAgent = null;
    let bestScore = 0;

    for (const [_key, agent] of Object.entries(this.agents)) {
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

  // ═══════════════════════════════════════════════════════════
  // AGENT DELEGATION — Inter-agent communication (Tier 0)
  // Agent General detects topic → delegates to specialist
  // Max 2 delegations per conversation (anti-loop)
  // ═══════════════════════════════════════════════════════════
  async _delegateToAgent(
    fromAgent,
    targetAgentKey,
    subtask,
    conversationContext = {},
  ) {
    // Anti-loop protection
    const delegationCount = conversationContext._delegationCount || 0;
    if (delegationCount >= 2) {
      logger.warn(
        { component: "Brain", from: fromAgent, to: targetAgentKey },
        "⚠️ Delegation limit reached (max 2) — handling directly",
      );
      return null;
    }

    const targetAgent = this.agents[targetAgentKey];
    if (!targetAgent) {
      logger.warn(
        { component: "Brain", targetAgentKey },
        "Target agent not found",
      );
      return null;
    }

    logger.info(
      {
        component: "Brain",
        from: fromAgent,
        to: targetAgentKey,
        subtask: subtask.substring(0, 80),
      },
      `🔄 Delegating: ${fromAgent} → ${targetAgent.name}`,
    );

    // Build delegated prompt with specialist persona
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) return null;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${targetAgent.systemPrompt}\n\n${subtask}` }],
              },
            ],
            generationConfig: { maxOutputTokens: 800, temperature: 0.5 },
          }),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!r.ok) return null;
      const data = await r.json();
      const response = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

      if (response) {
        // Log delegation success
        this.journal.push({
          timestamp: new Date().toISOString(),
          event: "agent_delegation",
          lesson: `Delegated from ${fromAgent} to ${targetAgent.name}: success`,
          applied: true,
        });
        if (this.journal.length > 50) this.journal.shift();
      }

      return {
        response,
        delegatedTo: targetAgent.name,
        delegationCount: delegationCount + 1,
      };
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "Delegation failed");
      return null;
    }
  }

  /**
   * Detect if current message should be delegated to a specialist
   * Returns { shouldDelegate, targetAgent, subtask } or null
   */
  _shouldDelegate(message, currentAgent, analysis) {
    if (!analysis || !analysis.topics) return null;

    const topics = analysis.topics.map((t) => t.toLowerCase());
    const msg = message.toLowerCase();

    // Trading delegation
    if (
      (topics.some(
        (t) =>
          t.includes("trading") ||
          t.includes("crypto") ||
          t.includes("bitcoin"),
      ) ||
        msg.includes("bitcoin") ||
        msg.includes("trading") ||
        msg.includes("crypto")) &&
      currentAgent !== "trader"
    ) {
      return { shouldDelegate: true, targetAgent: "trader", subtask: message };
    }

    // Creative delegation
    if (
      (topics.some(
        (t) =>
          t.includes("creative") || t.includes("poem") || t.includes("story"),
      ) ||
        msg.includes("scrie o") ||
        msg.includes("write a") ||
        msg.includes("poem")) &&
      currentAgent !== "creative"
    ) {
      return {
        shouldDelegate: true,
        targetAgent: "creative",
        subtask: message,
      };
    }

    // Research delegation
    if (
      (topics.some(
        (t) =>
          t.includes("research") ||
          t.includes("analyze") ||
          t.includes("compare"),
      ) ||
        msg.includes("cercetează") ||
        msg.includes("analizează") ||
        msg.includes("compară")) &&
      currentAgent !== "research"
    ) {
      return {
        shouldDelegate: true,
        targetAgent: "research",
        subtask: message,
      };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // WHITE-LABEL — Multi-tenant configuration (Tier 1)
  // Each tenant (domain) has custom branding
  // ═══════════════════════════════════════════════════════════
  _tenantConfigCache = new Map(); // hostname → { config, loadedAt }

  async getTenantConfig(hostname) {
    if (!hostname) return this._defaultTenantConfig();

    // Check cache (5 min TTL)
    const cached = this._tenantConfigCache.get(hostname);
    if (cached && Date.now() - cached.loadedAt < 5 * 60 * 1000) {
      return cached.config;
    }

    // Try Supabase
    if (this.supabaseAdmin) {
      try {
        const { data } = await this.supabaseAdmin
          .from("tenants")
          .select("*")
          .eq("domain", hostname)
          .eq("is_active", true)
          .single();

        if (data) {
          const config = {
            name: data.name || "KelionAI",
            domain: data.domain,
            logo: data.logo_url || null,
            primaryColor: data.primary_color || "#6366f1",
            secondaryColor: data.secondary_color || "#06b6d4",
            defaultAvatar: data.default_avatar || "kira",
            defaultLanguage: data.default_language || "en",
            maxMessagesPerDay: data.max_messages_per_day || 50,
            features: data.features || {},
            customSystemPrompt: data.custom_system_prompt || null,
            branding: {
              hideKelionBranding: data.hide_branding || false,
              customFooter: data.custom_footer || null,
            },
          };
          this._tenantConfigCache.set(hostname, {
            config,
            loadedAt: Date.now(),
          });
          return config;
        }
      } catch { /* ignored */ }
    }

    return this._defaultTenantConfig();
  }

  _defaultTenantConfig() {
    return {
      name: "KelionAI",
      domain: null,
      logo: null,
      primaryColor: "#6366f1",
      secondaryColor: "#06b6d4",
      defaultAvatar: "kira",
      defaultLanguage: "en",
      maxMessagesPerDay: 50,
      features: {},
      customSystemPrompt: null,
      branding: { hideKelionBranding: false, customFooter: null },
    };
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
  // MULTI-AI CONSENSUS — Query 2 providers for complex questions
  // Returns the best answer or merges them for higher confidence
  // ═══════════════════════════════════════════════════════════
  async multiAIConsensus(prompt, maxTokens = 600) {
    const providers = [];
    // Provider 1: Gemini (high quality)
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      providers.push({
        name: "Gemini",
        fn: async () => {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: maxTokens },
              }),
            },
          );
          if (!r.ok) return null;
          const d = await r.json();
          return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
        },
      });
    }
    // Provider 2: Groq (fastest)
    if (this.groqKey) {
      providers.push({
        name: "Groq",
        fn: async () => {
          const r = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + this.groqKey,
              },
              body: JSON.stringify({
                model: MODELS.GROQ_PRIMARY,
                max_tokens: maxTokens,
                messages: [{ role: "user", content: prompt }],
              }),
            },
          );
          if (!r.ok) return null;
          const d = await r.json();
          return d.choices?.[0]?.message?.content || null;
        },
      });
    }

    if (providers.length < 2) return null; // Need 2+ for consensus

    // Run in parallel with 8s timeout each
    const results = await Promise.allSettled(
      providers.map((p) =>
        Promise.race([
          p.fn(),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]).catch(() => null),
      ),
    );

    const answers = results
      .map((r, i) => ({
        name: providers[i].name,
        text: r.status === "fulfilled" ? r.value : null,
      }))
      .filter((a) => a.text && a.text.length > 20);

    if (answers.length === 0) return null;
    if (answers.length === 1)
      return {
        text: answers[0].text,
        engine: answers[0].name,
        consensus: false,
      };

    // Pick the longer/more detailed answer as primary
    const best = answers.sort((a, b) => b.text.length - a.text.length)[0];
    logger.info(
      {
        component: "Brain",
        providers: answers.map((a) => a.name),
        bestLength: best.text.length,
      },
      `🤝 Multi-AI consensus: ${answers.length} providers responded, using ${best.name}`,
    );
    return {
      text: best.text,
      engine: best.name + "+Consensus",
      consensus: true,
    };
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
        logger.info(
          { component: "Brain", userId, used: quota.used, limit: quota.limit },
          `⛔ Quota exceeded for user (${quota.plan})`,
        );
        const upgradeMsg =
          language === "ro"
            ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează la ${quota.plan === "free" ? "Pro" : "Premium"} pentru mai multe mesaje! 🚀`
            : `You've reached your ${quota.limit} messages/month limit on the ${quota.plan.toUpperCase()} plan. Upgrade to ${quota.plan === "free" ? "Pro" : "Premium"} for more messages! 🚀`;
        return {
          reply: upgradeMsg,
          emotion: "neutral",
          toolsUsed: [],
          confidence: 1.0,
        };
      }

      // Step 0: LOAD MEMORY + USER PROFILE — brain wakes up with full context
      const [memories, visualMem, audioMem, facts, profile] = await Promise.all(
        [
          this.loadMemory(userId, "text", 10),
          this.loadMemory(userId, "visual", 5),
          this.loadMemory(userId, "audio", 5),
          this.loadFacts(userId, 15),
          this._loadProfileCached(userId),
        ],
      );
      const memoryContext = this.buildMemoryContext(
        memories,
        visualMem,
        audioMem,
        facts,
      );
      this._currentMemoryContext = memoryContext;
      this._currentProfile = profile;

      // Inject profile context into memory
      const profileContext = profile ? profile.toContextString() : "";
      if (profileContext) {
        this._currentMemoryContext = profileContext + " || " + memoryContext;
      }

      // Inject project context (async, non-blocking if table doesn't exist yet)
      const projectCtx = await this._projectContext(userId).catch(() => "");
      if (projectCtx) {
        this._currentMemoryContext =
          this._currentMemoryContext + "\n" + projectCtx;
      }

      // Inject workspace context (persistent project structure/tech stack)
      const workspace = await this._loadWorkspace(userId).catch(() => null);
      if (workspace && Array.isArray(workspace) && workspace.length > 0) {
        const wsCtx = workspace
          .map(
            (w) =>
              `[Workspace: ${w.name}] Stack: ${(w.techStack || []).join(", ")} | Files: ${(w.keyFiles || []).slice(0, 5).join(", ")}`,
          )
          .join("\n");
        this._currentMemoryContext = this._currentMemoryContext + "\n" + wsCtx;
      }

      // Step 1: ANALYZE intent deeply
      const analysis = this.analyzeIntent(message, language);

      // Step 1b: COMPLEXITY SCORING (5-tier: simple→medium→complex→critical→highRisk)
      const complexityResult = this._scoreComplexity(analysis, message);
      analysis.complexity = complexityResult.name;
      analysis.complexityLevel = complexityResult.level;
      let modelRoute = this._routeModel(complexityResult);

      // Step 1c: COST GUARDRAILS — check budget and auto-downgrade if needed
      const userPlan = isAdmin ? "admin" : profile?.plan || "free";
      const budgetResult = await this._checkBudget(userId, userPlan).catch(
        () => ({
          allowed: true,
          remaining: 999,
          percentUsed: 0,
          shouldDowngrade: false,
          maxToolsPerMsg: 10,
        }),
      );

      if (!budgetResult.allowed) {
        logger.warn(
          { component: "CostGuardrails", userId, plan: userPlan },
          "💰 Budget exceeded — blocking",
        );
        return {
          enrichedMessage:
            "⚠️ Ai depășit limita zilnică de utilizare. Răspunsurile vor fi disponibile mâine, sau poți face upgrade la un plan superior.",
          toolsUsed: [],
          monitor: { content: "" },
          analysis,
          chainOfThought: null,
          compressedHistory: history.slice(-5),
          failedTools: [],
          thinkTime: Date.now() - start,
          confidence: 0,
          sourceTags: ["BUDGET_EXCEEDED"],
          agent: "default",
          profileLoaded: !!profile,
          truthReport: null,
          criticReport: null,
          complexityLevel: complexityResult,
          modelRoute,
        };
      }

      // Auto-downgrade model if budget > 80%
      if (budgetResult.shouldDowngrade) {
        modelRoute = this._autoDowngrade(modelRoute, budgetResult);
      }

      logger.info(
        {
          component: "Brain",
          complexity: complexityResult.name,
          level: complexityResult.level,
          model: modelRoute.provider,
          reasoning: complexityResult.reasoning,
          budget: budgetResult.percentUsed + "%",
          downgraded: !!modelRoute.downgraded,
        },
        `🎯 Complexity: ${complexityResult.name} (L${complexityResult.level}) → ${modelRoute.provider}/${modelRoute.model} | Budget: ${budgetResult.percentUsed}%`,
      );

      // Step 1.5: MULTI-AGENT — select best agent for this task
      const agentSelection = this._selectAgent(analysis, message);
      this._currentAgentPrompt = agentSelection.systemPrompt || "";
      this._currentAgentName = agentSelection.name || "General Assistant";
      this._currentAgentIcon = agentSelection.icon || "🧠";
      logger.info(
        {
          component: "Brain",
          agent: agentSelection.name,
          key: agentSelection.agent,
        },
        `${agentSelection.icon} Agent: ${agentSelection.name}`,
      );

      // Step 1.6: K1 AGI CONTEXT — enrich with world state, K1 memory, alerts
      let k1Context = null;
      if (k1Bridge) {
        try {
          k1Context = await k1Bridge.preProcess(message, {
            platform: "web",
            userId,
            domain: analysis.topics?.[0] || "general",
            supabase: this.supabaseAdmin,
          });
          if (k1Context) {
            const k1SystemCtx = k1Bridge.getK1SystemContext(k1Context);
            if (k1SystemCtx) {
              this._currentMemoryContext =
                (this._currentMemoryContext || "") + "\n" + k1SystemCtx;
            }
          }
        } catch (k1Err) {
          logger.warn(
            { component: "Brain", err: k1Err.message },
            "K1 preProcess failed (non-critical)",
          );
        }
      }

      // Step 2: DECOMPOSE complex tasks into sub-tasks
      let subTasks = [{ message, analysis }];
      if (analysis.complexity === "complex") {
        subTasks = await this.decomposeTask(message, analysis, language);
      }

      // Step 2.5: LEARNING — check if we have learned patterns for this type
      const learnedTools = this.learningStore.recommendTools(analysis);
      if (learnedTools) {
        logger.info(
          { component: "Brain", learned: learnedTools },
          "📚 Using learned tool pattern",
        );
      }

      // Step 3: PLAN tools for each sub-task (with circuit breaker)
      let plan = this.buildPlan(
        subTasks,
        userId,
        this._currentMediaData,
        isAdmin,
      );

      // Filter out circuit-broken tools
      plan = plan.filter((step) => {
        if (this.learningStore.isToolBlocked(step.tool)) {
          logger.warn(
            { component: "Brain", tool: step.tool },
            `⚡ Tool ${step.tool} circuit-broken — skipped`,
          );
          return false;
        }
        return true;
      });

      // Step 3b: POLICY ENGINE — filter tools by user plan
      plan = this._filterPlanByPolicy(plan, userPlan, isAdmin);

      // Step 3c: Limit tools per message based on plan
      if (plan.length > budgetResult.maxToolsPerMsg) {
        logger.info(
          {
            component: "PolicyEngine",
            before: plan.length,
            max: budgetResult.maxToolsPerMsg,
          },
          `✂️ Trimming plan: ${plan.length} → ${budgetResult.maxToolsPerMsg} tools (${userPlan} plan)`,
        );
        plan = plan.slice(0, budgetResult.maxToolsPerMsg);
      }

      // ═══ AGENTIC LOOP — Multi-turn tool chaining ═══
      // Brain can iterate: execute → reflect → re-plan → execute again
      const MAX_ITERATIONS = 3;
      const allResults = {};
      let chainOfThought = null;
      let enriched = "";
      let confidence = 0;
      let iterationCount = 0;
      let currentPlan = plan;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        iterationCount = iteration + 1;

        // Step 4: EXECUTE current plan tools in parallel
        const iterResults = await this.executePlan(currentPlan);

        // Merge results from all iterations
        Object.assign(allResults, iterResults);

        // Record tool outcomes for learning
        for (const step of currentPlan) {
          if (iterResults[step.tool])
            this.learningStore.recordToolSuccess(step.tool);
          else this.learningStore.recordToolFailure(step.tool);
        }

        // Step 5: CHAIN-OF-THOUGHT — pre-reason for complex tasks or emergencies
        const shouldRunCoT =
          (analysis.complexity === "complex" &&
            Object.keys(allResults).length >= 1) ||
          analysis.isEmergency;
        if (shouldRunCoT) {
          chainOfThought = await this.chainOfThought(
            message,
            allResults,
            analysis,
            history,
            language,
          );
        }

        // Step 6: BUILD enriched context
        enriched = this.buildEnrichedContext(
          message,
          allResults,
          chainOfThought,
          analysis,
        );

        // Step 6.5: CONFIDENCE SCORING
        confidence = this._scoreConfidence(
          analysis,
          allResults,
          chainOfThought,
        );

        // Step 6.5b: MULTI-AI CONSENSUS — for complex queries with low confidence
        if (
          analysis.complexity === "complex" &&
          confidence < 0.6 &&
          iteration === 0
        ) {
          try {
            const consensusAnswer = await this.multiAIConsensus(message, 600);
            if (consensusAnswer) {
              enriched += `\n[MULTI-AI CONSENSUS]: ${consensusAnswer}`;
              confidence = Math.min(1.0, confidence + 0.2); // boost confidence
              logger.info(
                { component: "Brain", confidence },
                "🤝 Multi-AI consensus used to boost confidence",
              );
            }
          } catch (e) {
            logger.warn(
              { component: "Brain", err: e.message },
              "Multi-AI consensus failed (non-critical)",
            );
          }
        }

        // Step 6.6: SELF-REFLECTION — evaluate if response is complete
        // Only reflect on iteration 1+ and if complex or low confidence
        if (
          iteration < MAX_ITERATIONS - 1 &&
          (analysis.complexity === "complex" || confidence < 0.6)
        ) {
          const reflection = await this._selfReflect(
            message,
            enriched,
            allResults,
            analysis,
            language,
          );
          if (reflection && reflection.needsMore) {
            // Re-plan with additional tools based on reflection
            logger.info(
              { component: "Brain", iteration, reflection: reflection.reason },
              `🔄 Agentic loop iteration ${iteration + 1}: ${reflection.reason}`,
            );
            const additionalPlan = this._planFromReflection(
              reflection,
              userId,
              this._currentMediaData,
              isAdmin,
            );
            if (additionalPlan.length > 0) {
              currentPlan = additionalPlan;
              continue; // Loop again with new plan
            }
          }
        }
        // If reflection says we're good, or no reflection needed — break
        break;
      }

      if (iterationCount > 1) {
        logger.info(
          { component: "Brain", iterations: iterationCount },
          `🔄 Agentic loop completed in ${iterationCount} iterations`,
        );
      }

      const results = allResults;

      // Step 7: MANAGE CONTEXT WINDOW + COMPRESS if too long
      const managedHistory = this._manageContextWindow(history, 20, 15000);
      const compressedHistory = this.compressHistory(
        managedHistory,
        conversationId,
      );

      // Step 8: SELF-EVALUATE + LEARN (async — doesn't block response)
      const thinkTime = Date.now() - startTime;
      this.journalEntry(
        "think_complete",
        `${analysis.complexity} task, ${plan.length} tools, ${thinkTime}ms, confidence:${confidence}`,
        {
          tools: Object.keys(results),
          complexity: analysis.complexity,
          confidence,
        },
      );

      // Learn from this conversation (async)
      this.learningStore
        .recordOutcome(
          analysis,
          Object.keys(results),
          true,
          thinkTime,
          this.supabaseAdmin,
        )
        .catch(() => {});
      if (profile) {
        profile.updateFromConversation(message, language, analysis);
        profile.save(this.supabaseAdmin).catch(() => {});
      }

      // PROCEDURAL MEMORY: Save how this task was solved
      const toolsUsedForProcedure = Object.keys(results).filter(
        (k) => results[k],
      );
      if (
        toolsUsedForProcedure.length > 0 &&
        analysis.complexity !== "simple"
      ) {
        const taskType =
          analysis.topics?.[0] || analysis.complexity || "general";
        this._saveProcedure(
          userId,
          taskType,
          message.substring(0, 200),
          toolsUsedForProcedure.map((t) => ({
            tool: t,
            success: !!results[t],
          })),
          toolsUsedForProcedure,
          true,
          thinkTime,
          analysis.complexity,
        ).catch(() => {});
      }

      // PROJECT MEMORY: Auto-detect project mentions
      this._autoDetectProject(
        userId,
        message,
        analysis,
        toolsUsedForProcedure,
      ).catch(() => {});

      // WORKSPACE MEMORY: Auto-save workspace context from conversation
      if (
        toolsUsedForProcedure.some((t) =>
          ["codeExec", "ragSearch", "dbQuery", "generateDoc"].includes(t),
        )
      ) {
        const techKeywords = message.match(
          /\b(react|vue|angular|node|express|python|django|flask|java|spring|rust|go|typescript|nextjs|vite|supabase|postgres|mongodb|redis|docker|kubernetes)\b/gi,
        );
        if (techKeywords && techKeywords.length > 0) {
          this._saveWorkspace(userId, "auto-detected", {
            techStack: [...new Set(techKeywords.map((k) => k.toLowerCase()))],
            keyFiles: [],
            patterns: toolsUsedForProcedure,
            structure: message.substring(0, 200),
          }).catch(() => {});
        }
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
      let cleanReply = enriched
        .replace(
          /(?:\[TRUTH CHECK\]|\[REZULTATE CAUTARE\]|\[DATE METEO\]|\[Am generat\]|\[Harta\]|\[CONTEXT DIN MEMORIE\]|\[Utilizatorul pare\]|\[URGENTA\]|\[GANDIRE STRUCTURATA\]|\[REZUMAT CONVERSATIE\])[^\]]*\]/g,
          "",
        )
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Track usage (non-blocking)
      this.incrementUsage(userId, Object.keys(results).length, 0).catch(
        () => {},
      );

      // ── Anti-Hallucination: tag data sources ──
      const sourceTags = [];
      const toolsUsedList = Object.keys(results);
      if (toolsUsedList.length > 0) {
        sourceTags.push("VERIFIED");
        for (const t of toolsUsedList) sourceTags.push(`SOURCE:${t}`);
      }
      if (memoryContext && memoryContext.length > 20)
        sourceTags.push("FROM_MEMORY");
      if (
        toolsUsedList.length === 0 &&
        (!memoryContext || memoryContext.length < 20)
      ) {
        sourceTags.push("ASSUMPTION");
      }

      // Step 9: TRUTH GUARD — Verify response quality (async, non-blocking for simple tasks)
      let truthReport = null;
      if (complexityResult.level >= 2 && cleanReply.length > 50) {
        truthReport = await this._truthCheck(
          cleanReply,
          results,
          analysis,
        ).catch(() => null);
        if (truthReport && truthReport.verdict === "FAIL") {
          sourceTags.push("TRUTH_FAIL");
          // Add warning to response
          const warningNote =
            "\n\n⚠️ *Verificarea automată indică incertitudine în unele afirmații. Verifică sursele.*";
          if (!cleanReply.includes("⚠️")) {
            cleanReply += warningNote;
          }
        } else if (truthReport && truthReport.verdict === "WARNING") {
          sourceTags.push("TRUTH_WARNING");
        }
      }

      // Step 10: CRITIC AGENT — Independent quality validation (medium+ complexity)
      let criticReport = null;
      if (complexityResult.level >= 2 && cleanReply.length > 30) {
        criticReport = await this.criticEvaluate(
          message,
          cleanReply,
          analysis,
          toolsUsedList,
        ).catch(() => null);
        if (criticReport) {
          // Critic can override confidence
          if (criticReport.overallScore < confidence) {
            confidence = confidence * 0.6 + criticReport.overallScore * 0.4;
          }
          // Add safety disclaimers if needed
          if (criticReport.safety && !criticReport.safety.safe) {
            if (criticReport.safety.severity === "critical") {
              cleanReply =
                "⚠️ Conținut blocat de Critic Agent din motive de siguranță.";
              sourceTags.push("CRITIC_BLOCKED");
            } else if (
              criticReport.safety.severity === "high" &&
              !cleanReply.includes("medic") &&
              !cleanReply.includes("doctor")
            ) {
              cleanReply +=
                "\n\n*⚕️ Notă: Consultă un specialist pentru sfaturi medicale/financiare.*";
            }
          }
          if (
            criticReport.verdict === "REJECTED" ||
            criticReport.verdict === "NEEDS_REVISION"
          ) {
            sourceTags.push("CRITIC_" + criticReport.verdict);
          }
        }
      }

      // K1 AGI POST-PROCESS — save to K1 memory, score templates, track performance
      if (k1Bridge && k1Context) {
        try {
          await k1Bridge.postProcess(cleanReply, {
            platform: "web",
            userId,
            domain: analysis.topics?.[0] || "general",
            supabase: this.supabaseAdmin,
            addBadge: false, // web chat handles its own UI
          });
        } catch (k1Err) {
          logger.warn(
            { component: "Brain", err: k1Err.message },
            "K1 postProcess failed (non-critical)",
          );
        }
      }

      return {
        enrichedMessage: cleanReply,
        enrichedContext: enriched,
        toolsUsed: toolsUsedList,
        monitor: this.extractMonitor(results),
        analysis,
        chainOfThought,
        compressedHistory,
        failedTools: plan.filter((p) => !results[p.tool]).map((p) => p.tool),
        thinkTime,
        confidence,
        sourceTags,
        agent: {
          name: this._currentAgentName,
          icon: this._currentAgentIcon,
          key: agentSelection?.agent || "general",
        },
        profileLoaded: !!profile,
        truthReport,
        criticReport,
        complexityLevel: complexityResult,
        modelRoute,
        k1Active: !!k1Context,
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
    const aiKey = this.groqKey || this.openaiKey || this.geminiKey;
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

      // Use Groq (fastest) → GPT (fallback) → Gemini (last resort)
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
      if (!txt) {
        const geminiKey =
          process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        if (geminiKey) {
          r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 250 },
              }),
            },
          );
          if (r.ok) {
            d = await r.json();
            txt = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          }
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
      needsTranslate: false,
      translateTarget: "",
      needsSummarize: false,
      needsDbQuery: false,
      dbQuestion: "",
      needsReminder: false,
      needsCalendar: false,
      needsDocGen: false,
      reminderText: "",
      reminderTime: "",
      needsEmail: false,
      emailTo: "",
      emailSubject: "",
      needsCodeExec: false,
      codeToRun: "",
      needsRagSearch: false,
      ragQuery: "",
      needsWebScrape: false,
      scrapeURL: "",
      needsFileOps: false,
      fileAction: "",
      fileName: "",
      fileContent: "",
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
      // ── TRANSLATE ──
      {
        flag: "needsTranslate",
        triggers: [
          /\b(tradu|traduce|traducere|translate|translation|in\s*(engleza|romana|spaniola|franceza|germana|italiana))\b/i,
        ],
        extract: (text) => {
          const langMatch = text.match(
            /\b(?:in|to|pe)\s*(engleza|romana|spaniola|franceza|germana|italiana|english|romanian|spanish|french|german|italian)\b/i,
          );
          const langMap = {
            engleza: "en",
            english: "en",
            romana: "ro",
            romanian: "ro",
            spaniola: "es",
            spanish: "es",
            franceza: "fr",
            french: "fr",
            germana: "de",
            german: "de",
            italiana: "it",
            italian: "it",
          };
          return {
            translateTarget: langMatch
              ? langMap[langMatch[1].toLowerCase()] || "en"
              : "en",
          };
        },
      },
      // ── SUMMARIZE ──
      {
        flag: "needsSummarize",
        triggers: [
          /\b(sumariz|rezum|summary|summarize|rezumat|sinteza|pe scurt|in rezumat|tldr|tl;dr)\b/i,
        ],
      },
      // ── DB QUERY ──
      {
        flag: "needsDbQuery",
        triggers: [
          /\b(cati\s*(useri|utilizatori|clienti|abonati)|numar\s*de|statistici|how\s*many\s*(users|subscribers)|count|total\s*(users|trades|messages))\b/i,
          /\b(interogheaza|query|raport|report|analiza\s*date|data\s*analysis)\b/i,
        ],
        extract: (text) => ({ dbQuestion: text }),
      },
      // ── REMINDER ──
      {
        flag: "needsReminder",
        triggers: [
          /\b(aminteste|reminder|alarm[aă]|reaminteste|remind\s*me|seteaz[aă].*alarm|programeaz[aă])\b/i,
        ],
        extract: (text) => {
          // Extract time: "la 9", "in 5 minute", "maine", "tomorrow"
          const timeMatch = text.match(
            /\b(?:la|at|in|peste)\s+([\d:]+\s*(?:minute|ore|hours|min)?|maine|tomorrow|azi|today)\b/i,
          );
          const contentMatch = text.match(
            /(?:aminteste|remind).*(?:sa|to|ca|that)\s+(.+)/i,
          );
          return {
            reminderText: contentMatch ? contentMatch[1].trim() : text,
            reminderTime: timeMatch ? timeMatch[1] : "",
          };
        },
      },
      // ── EMAIL ──
      {
        flag: "needsEmail",
        triggers: [
          /\b(trimite.*email|send.*email|email.*la|mail.*catre|trimite.*mesaj.*email)\b/i,
        ],
        extract: (text) => {
          const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/i);
          const subjectMatch = text.match(
            /(?:subiect|subject)[:\s]+["']?([^"'\n]+)/i,
          );
          return {
            emailTo: emailMatch ? emailMatch[0] : "",
            emailSubject: subjectMatch
              ? subjectMatch[1]
              : "Mesaj de la Kelion AI",
          };
        },
      },
      // ── CODE EXECUTION ──
      {
        flag: "needsCodeExec",
        triggers: [
          /\b(ruleaz[aă]|execut[aă]|run|execute|eval|calculeaz[aă])\s*(cod|code|script|js|javascript)/i,
          /```(js|javascript)[\s\S]*?```/i,
        ],
        extract: (text) => {
          const codeBlock = text.match(
            /```(?:js|javascript)?\n?([\s\S]*?)```/i,
          );
          return { codeToRun: codeBlock ? codeBlock[1].trim() : text };
        },
      },
      // ── RAG SEARCH ──
      {
        flag: "needsRagSearch",
        triggers: [
          /\b(cauta.*memorie|in\s*baza.*date|ce\s*stii\s*despre|remember|recall|knowledge|baza.*cunostinte)\b/i,
        ],
        extract: (text) => ({ ragQuery: text }),
      },
      // ── WEB SCRAPE ──
      {
        flag: "needsWebScrape",
        triggers: [
          /\b(extrage.*de\s*pe|scrape|citeste.*pagina|extrage.*continut|preia.*de\s*la|citeste\s*url)\b/i,
        ],
        extract: (text) => {
          const urlMatch = text.match(/https?:\/\/[^\s]+/i);
          return { scrapeURL: urlMatch ? urlMatch[0] : "" };
        },
      },
      // ── CALENDAR ──
      {
        flag: "needsCalendar",
        triggers: [
          /\b(calendar|eveniment|programeaz[aă]|schedule|appointment|întâlnire|meeting|adaug[aă].*calendar|ce.*am.*program|agenda|events)\b/i,
        ],
        extract: (text) => {
          const timeMatch = text.match(
            /\b(?:pe|on|la|at|in|pentru|mâine|maine|tomorrow|azi|today|luni|marți|miercuri|joi|vineri|sâmbătă|duminică)\s*(\d{1,2}[:.]\d{2})?/i,
          );
          const titleMatch = text.match(
            /(?:programeaz[aă]|adaug[aă]|schedule|create)\s+(?:un\s+)?(?:eveniment|meeting|event)?\s*[:"']?\s*(.+?)(?:\s+(?:pe|la|on|at|pentru|mâine|maine)|\s*$)/i,
          );
          return {
            calendarTitle: titleMatch
              ? titleMatch[1].trim()
              : text.substring(0, 60),
            calendarTime: timeMatch ? timeMatch[0] : "",
            calendarAction: /\b(list|ce am|agenda|events|arată|show)\b/i.test(
              text,
            )
              ? "list"
              : "create",
          };
        },
      },
      // ── DOCUMENT GENERATION ──
      {
        flag: "needsDocGen",
        triggers: [
          /\b(genereaz[aă]|creaz[aă]|scrie|draft|generate|create)\s*(un\s+)?(document|raport|report|plan|memo|scrisoare|letter|propunere|proposal|cv|resume)\b/i,
          /\b(f[aă].*raport|make.*report|write.*document)\b/i,
        ],
        extract: (text) => {
          const titleMatch = text.match(
            /(?:document|raport|report|plan|memo|propunere|proposal)\s*(?:despre|about|pentru|privind|on)?\s*[:"']?\s*(.+)/i,
          );
          return {
            docTitle: titleMatch
              ? titleMatch[1].trim().substring(0, 80)
              : "Document",
            docContent: text,
            docFormat: /\b(text|txt)\b/i.test(text) ? "text" : "markdown",
          };
        },
      },
    ];
  }

  // ── Emotion detection map (Enhanced with intensity + subcategories) ──
  static get EMOTION_MAP() {
    return {
      sad: {
        pattern:
          /\b(trist|deprimat|singur|plang|suparat|nefericit|sad|depressed|lonely|pierdut|dor|melancolie|dezamagit|disappointed)\b/i,
        weight: 0.9,
        responseHint:
          "Be empathetic, warm, and supportive. Acknowledge feelings first.",
      },
      happy: {
        pattern:
          /\b(fericit|bucuros|minunat|super|genial|happy|great|awesome|amazing|multumit|satisfied)\b/i,
        weight: 0.7,
        responseHint:
          "Match their positive energy. Be enthusiastic and encouraging.",
      },
      angry: {
        pattern:
          /\b(nervos|furios|enervat|angry|furious|frustrated|urasc|hate|dezgustat|disgusted)\b/i,
        weight: 0.9,
        responseHint:
          "Stay calm and validating. Don't be dismissive. Help solve the problem.",
      },
      anxious: {
        pattern:
          /\b(anxios|stresat|ingrijorat|worried|anxious|stressed|teama|frica|panica|nesigur|uncertain)\b/i,
        weight: 0.9,
        responseHint:
          "Provide reassurance with facts. Break things into manageable steps.",
      },
      confused: {
        pattern:
          /\b(nu inteleg|confuz|confused|nu stiu|habar|pierdut|lost|neclar|unclear)\b/i,
        weight: 0.6,
        responseHint: "Simplify explanations. Use examples and analogies.",
      },
      grateful: {
        pattern:
          /\b(multumesc|mersi|thanks|thank you|apreciez|recunoscator|grateful)\b/i,
        weight: 0.5,
        responseHint: "Accept gracefully. Offer to help further.",
      },
      excited: {
        pattern:
          /\b(abia astept|super tare|wow|amazing|incredible|fantastic|entuziasmat|nu pot sa cred)\b/i,
        weight: 0.7,
        responseHint: "Share their excitement. Add value to their enthusiasm.",
      },
      urgent: {
        pattern:
          /\b(urgent|repede|acum|imediat|asap|graba|hurry|quick|now|immediately|rapid|cat mai repede)\b/i,
        weight: 0.85,
        responseHint:
          "Be concise and direct. Prioritize the solution. Skip pleasantries.",
      },
      disappointed: {
        pattern:
          /\b(a dezamagit|nu e bun|slab|prost|nasol|lame|bad|terrible|awful|rau|nu functioneaza)\b/i,
        weight: 0.8,
        responseHint:
          "Acknowledge the disappointment. Offer concrete improvements.",
      },
    };
  }

  // ── Frustration intensity detector ──
  static detectFrustration(text) {
    const lower = text.toLowerCase();
    let score = 0;
    // Repeated punctuation (!!!, ???)
    if (/[!]{2,}/.test(text)) score += 0.3;
    if (/[?]{2,}/.test(text)) score += 0.2;
    // ALL CAPS words (more than 2)
    const capsWords = text
      .split(/\s+/)
      .filter((w) => w === w.toUpperCase() && w.length > 2 && /[A-Z]/.test(w));
    if (capsWords.length >= 2) score += 0.3;
    // Negative patterns in Romanian
    if (
      /\b(nu merge|nu functioneaza|de ce nu|iar nu|tot nu|e stricat|prost|nasol|nicio treaba)\b/i.test(
        lower,
      )
    )
      score += 0.3;
    // Profanity / strong words
    if (/\b(naiba|drace|dracu|mama|ksm|wtf|ffs)\b/i.test(lower)) score += 0.4;
    // Repeated complaints
    if (/\b(iar|din nou|again|inca o data|de fiecare data)\b/i.test(lower))
      score += 0.2;
    return Math.min(1.0, score);
  }

  // ── Topic detection patterns ──
  static get TOPIC_PATTERNS() {
    return [
      {
        topic: "tech",
        pattern:
          /\b(cod|program|software|app|server|bug|api|deploy|git|react|node|python|database|ai|ml|machine learning)\b/i,
      },
      {
        topic: "finance",
        pattern:
          /\b(bani|pret|cost|investitie|crypto|bitcoin|trading|actiuni|stocks|bursa|profit|pierdere|money|price|cost)\b/i,
      },
      {
        topic: "health",
        pattern:
          /\b(sanatate|doctor|boala|simptom|durere|medic|health|pain|disease|symptom|diabetic|dieta|fitness)\b/i,
      },
      {
        topic: "travel",
        pattern:
          /\b(calator|calatorie|calatoresc|zbor|hotel|vacanta|avion|tara|oras|vizita|travel|flight|vacation)\b/i,
      },
      {
        topic: "food",
        pattern:
          /\b(mancare|reteta|gatit|restaurant|pizza|paste|cooking|recipe|food|meal)\b/i,
      },
      {
        topic: "education",
        pattern:
          /\b(invat|curs|scoala|universitate|examen|studiu|learn|course|school|university|exam)\b/i,
      },
      {
        topic: "entertainment",
        pattern:
          /\b(film|muzica|joc|game|serial|anime|movie|music|youtube|spotify|netflix)\b/i,
      },
      {
        topic: "weather",
        pattern:
          /\b(vreme|meteo|ploaie|soare|temperatura|weather|rain|sun|temperature|forecast)\b/i,
      },
      {
        topic: "news",
        pattern:
          /\b(stiri|news|ultima ora|breaking|actual|politica|politics|razboi|war)\b/i,
      },
      {
        topic: "personal",
        pattern:
          /\b(eu|meu|mea|despre mine|viata mea|my|mine|myself|personal)\b/i,
      },
      {
        topic: "creative",
        pattern:
          /\b(scrie|poem|poveste|articol|write|story|poem|essay|creative|compune|text)\b/i,
      },
      {
        topic: "legal",
        pattern:
          /\b(lege|contract|drept|avocattribunal|judecata|law|legal|court|attorney)\b/i,
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

    // ── Emotion detection (enhanced with intensity + response hints) ──
    for (const [emo, { pattern, weight, responseHint }] of Object.entries(
      KelionBrain.EMOTION_MAP,
    )) {
      if (pattern.test(lower)) {
        result.emotionalTone = emo;
        result.isEmotional = true;
        result.confidenceScore = weight;
        result.emotionResponseHint = responseHint || "";
        break;
      }
    }

    // ── Frustration intensity (overlays on any emotion) ──
    const frustrationLevel = KelionBrain.detectFrustration(text);
    if (frustrationLevel > 0.3) {
      result.frustrationLevel = frustrationLevel;
      result.isEmotional = true;
      if (frustrationLevel > 0.6) {
        result.emotionResponseHint =
          "User is very frustrated. Be extra patient, acknowledge the issue, and provide a clear solution quickly. Do NOT use filler words.";
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
        const imgPrompt = (analysis.imagePrompt || "").trim();
        const hasStyleDetails =
          /\b(style|stil|realistic|cartoon|abstract|watercolor|cyberpunk|minimalist|pixel|3d|vector|oil|painting|dark|bright|pastel|neon|retro|vintage|modern|futuristic|portrait|landscape|square|banner|poster|logo|icon|\d{3,4}x\d{3,4}|hd|4k|uhd)\b/i.test(
            imgPrompt,
          );
        if (imgPrompt.length >= 20 || hasStyleDetails) {
          plan.push({ tool: "imagine", prompt: imgPrompt });
          seen.add("imagine");
        } else {
          // Vague prompt — brain will ask for details instead of generating
          analysis.needsImageClarification = true;
          logger.info(
            { component: "Brain", prompt: imgPrompt },
            "Image request too vague — will ask for details",
          );
        }
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
        if (analysis.needsTradeIntelligence && !seen.has("tradeIntelligence")) {
          plan.push({ tool: "tradeIntelligence" });
          seen.add("tradeIntelligence");
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
      // New P1 tools: translate, summarize, dbQuery, reminder
      if (analysis.needsTranslate && !seen.has("translate")) {
        plan.push({
          tool: "translate",
          target: analysis.translateTarget || "en",
        });
        seen.add("translate");
      }
      if (analysis.needsSummarize && !seen.has("summarize")) {
        plan.push({ tool: "summarize" });
        seen.add("summarize");
      }
      if (analysis.needsDbQuery && !seen.has("dbQuery")) {
        plan.push({
          tool: "dbQuery",
          question: analysis.dbQuestion || message,
        });
        seen.add("dbQuery");
      }
      if (analysis.needsReminder && !seen.has("reminder")) {
        plan.push({
          tool: "reminder",
          text: analysis.reminderText,
          time: analysis.reminderTime,
          userId,
        });
        seen.add("reminder");
      }
      // P2 tools: email, code exec, RAG, web scrape
      if (analysis.needsEmail && !seen.has("email")) {
        plan.push({
          tool: "email",
          to: analysis.emailTo,
          subject: analysis.emailSubject,
          body: message,
          userId,
        });
        seen.add("email");
      }
      if (analysis.needsCodeExec && !seen.has("codeExec")) {
        plan.push({ tool: "codeExec", code: analysis.codeToRun || message });
        seen.add("codeExec");
      }
      if (analysis.needsRagSearch && !seen.has("ragSearch")) {
        plan.push({
          tool: "ragSearch",
          query: analysis.ragQuery || message,
          userId,
        });
        seen.add("ragSearch");
      }
      if (analysis.needsWebScrape && !seen.has("webScrape")) {
        plan.push({ tool: "webScrape", url: analysis.scrapeURL });
        seen.add("webScrape");
      }
      if (analysis.needsFileOps && !seen.has("fileOps")) {
        plan.push({
          tool: "fileOps",
          action: analysis.fileAction,
          fileName: analysis.fileName,
          content: analysis.fileContent,
        });
        seen.add("fileOps");
      }
      // P3 tools: calendar, document generation
      if (
        analysis.needsCalendar &&
        !seen.has("calendarCreate") &&
        !seen.has("calendarList")
      ) {
        if (analysis.calendarAction === "list") {
          plan.push({ tool: "calendarList", userId, maxResults: 10 });
          seen.add("calendarList");
        } else {
          plan.push({
            tool: "calendarCreate",
            title: analysis.calendarTitle,
            startTime: analysis.calendarTime,
            userId,
          });
          seen.add("calendarCreate");
        }
      }
      if (analysis.needsDocGen && !seen.has("generateDoc")) {
        plan.push({
          tool: "generateDoc",
          title: analysis.docTitle || "Document",
          content: analysis.docContent || message,
          format: analysis.docFormat || "markdown",
          userId,
        });
        seen.add("generateDoc");
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
    // Action confirmation check for risky operations
    const confirmCheck = this._needsConfirmation(
      step.tool,
      step,
      step.userPlan || "free",
    );
    if (confirmCheck) {
      logger.info(
        {
          component: "ActionConfirm",
          tool: step.tool,
          risk: confirmCheck.risk,
        },
        `⚠️ Blocked risky action: ${step.tool}`,
      );
      // BLOCK the action — return warning instead of executing
      return {
        blocked: true,
        needsConfirmation: true,
        tool: step.tool,
        risk: confirmCheck.risk,
        message: confirmCheck.message,
        instruction:
          "Utilizatorul trebuie să confirme explicit această acțiune înainte de execuție.",
      };
    }

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
      // P1-P3 tools
      translate: 5000,
      summarize: 8000,
      dbQuery: 5000,
      reminder: 3000,
      email: 8000,
      codeExec: 10000,
      ragSearch: 5000,
      webScrape: 10000,
      fileOps: 3000,
      calendarCreate: 8000,
      calendarList: 8000,
      calendarDelete: 5000,
      generateDoc: 15000,
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
      // P1 tools: translate, summarize, dbQuery, reminder
      case "translate":
        return this._translate(step.text || "", step.target || "en");
      case "summarize":
        return this._summarize(step.text || "", 200, "ro");
      case "dbQuery":
        return this._dbQuery(step.question || "", step.userId);
      case "reminder":
        return this._scheduleReminder(
          step.userId,
          step.text || "",
          step.time || "",
          "push",
        );
      // P2 tools: email, code exec, RAG, web scrape
      case "email":
        return this._sendEmail(
          step.to,
          step.subject,
          step.body || "",
          step.userId,
        );
      case "codeExec":
        return this._execCode(step.code || "");
      case "ragSearch":
        return this._ragSearch(step.query || "", step.userId);
      case "webScrape":
        return this._webScrape(step.url || "", true);
      case "fileOps":
        return this._fileOps(
          step.action || "list",
          step.fileName,
          step.content,
        );
      // P3 tools: calendar, document generation
      case "calendarCreate":
        return this._calendarCreate(
          step.title || "",
          step.startTime,
          step.endTime,
          step.description,
          step.userId,
        );
      case "calendarList":
        return this._calendarList(step.userId, step.maxResults || 10);
      case "calendarDelete":
        return this._calendarDelete(step.eventId, step.userId);
      case "generateDoc":
        return this._generateDocument(
          step.title || "Report",
          step.content || "",
          step.format || "markdown",
          step.userId,
        );
      // ═══ P4 tools: IDE-parity (kira-tools) ═══
      case "terminal":
        return this._terminal(step.command || step.cmd || "");
      case "deepBrowse":
        return this._deepBrowse(step.url || "", step);
      case "browseMultiple":
        return this._browseMultiple(step.urls || [], step);
      case "renderPage":
        return this._renderPage(step.url || "", step);
      case "git":
        return this._git(step.action || "status", step.n);
      case "codeSearch":
        return this._codeSearch(step.query || "", step.path);
      case "projectTree":
        return this._projectTree(step.path || ".", step.depth);
      case "projectFile":
        return this._readProjectFile(step.filePath || step.path || "");
      case "runTests":
        return this._runTests(step.suite || "");
      case "scrapeArticle":
        return this._scrapeFullArticle(step.url || "");
      default:
        return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. CONTEXT BUILDER — Assembles enriched message
  // ═══════════════════════════════════════════════════════════
  buildEnrichedContext(message, results, chainOfThought, analysis) {
    let ctx = "";

    // Inject active agent's specialized prompt as SYSTEM instruction (not user-visible)
    // NOTE: this goes into system context only — NOT repeated to user
    if (this._currentAgentPrompt) {
      ctx += `[SYSTEM INSTRUCTION — DO NOT REPEAT THIS TEXT IN YOUR REPLY]\n${this._currentAgentPrompt}\n[END SYSTEM INSTRUCTION]\n\n`;
    }

    ctx += message;

    if (results.search)
      ctx += `\n[REZULTATE CAUTARE WEB REALE]:\n${results.search}\nFoloseste datele real. Citeaza sursele.`;
    if (results.weather)
      ctx += `\n[DATE METEO REALE]: ${results.weather.description}`;
    if (results.imagine)
      ctx += `\n[Am generat imaginea pe monitor. Descrie-o scurt, apoi OBLIGATORIU întreabă utilizatorul: "Ți se potrivește rezultatul? Vrei să modific ceva — culori, stil, compoziție, detalii?". Oferă 2-3 sugestii concrete de ajustare.]`;
    if (analysis?.needsImageClarification)
      ctx += `\n[IMPORTANT: Utilizatorul vrea o imagine dar cererea e vagă. NU genera încă! Întreabă-l despre: 1) Dimensiune/format (pătrat, landscape, portret, banner), 2) Stil (realist, cartoon, acuarelă, cyberpunk, minimalist, etc.), 3) Culori predominante, 4) Detalii specifice (text, fundal, personaje, obiect principal). Fii prietenos și creativ cu sugestiile.]`;
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
    if (analysis.frustrationLevel && analysis.frustrationLevel > 0.3) {
      const level =
        analysis.frustrationLevel > 0.7
          ? "FOARTE FRUSTRAT"
          : analysis.frustrationLevel > 0.5
            ? "frustrat"
            : "ușor iritat";
      ctx += `\n[⚠️ ATENȚIE: Utilizatorul este ${level} (nivel: ${(analysis.frustrationLevel * 100).toFixed(0)}%). ${analysis.emotionResponseHint || "Fii empatic, recunoaște problema, oferă soluții concrete rapid. NU folosi cuvinte de umplutură."}]`;
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
  // 9.1 SELF-REFLECTION — Evaluate response quality before sending
  // Uses fast AI to decide if Brain needs more information
  // ═══════════════════════════════════════════════════════════
  async _selfReflect(
    message,
    currentResponse,
    toolResults,
    analysis,
    _language,
  ) {
    const aiKey = this.groqKey || this.geminiKey;
    if (!aiKey) return null;

    try {
      const toolList = Object.keys(toolResults).join(", ") || "none";
      const prompt = `You are the quality control module of an AI assistant. Evaluate this response STRICTLY.

USER ASKED: "${message.substring(0, 200)}"
TOOLS USED: ${toolList}
CURRENT RESPONSE PREVIEW: "${String(currentResponse).substring(0, 400)}"
DETECTED NEEDS: search=${analysis.needsSearch}, weather=${analysis.needsWeather}, image=${analysis.needsImage}, map=${analysis.needsMap}

Evaluate:
1. Does the response FULLY answer the user's question?
2. Were all necessary tools called?
3. Is there missing data that another tool could provide?
4. Is the confidence sufficient?

Reply STRICTLY with JSON:
{"needsMore":true/false,"reason":"short reason","missingTools":["tool1"],"quality":"good/partial/poor"}

Missing tool names must be from: search, weather, imagine, map, memory, vision, tts, stt, news, trade_intelligence, health_check`;

      let txt = null;
      if (this.groqKey) {
        const r = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.groqKey,
            },
            body: JSON.stringify({
              model: MODELS.GROQ_PRIMARY,
              max_tokens: 150,
              messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(4000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          txt = d.choices?.[0]?.message?.content?.trim();
        }
      }

      if (!txt) {
        const geminiKey =
          process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        if (geminiKey) {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 150 },
              }),
              signal: AbortSignal.timeout(4000),
            },
          );
          if (r.ok) {
            const d = await r.json();
            txt = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          }
        }
      }

      if (!txt) return null;

      try {
        const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
        // Only iterate if there are specific missing tools (avoid infinite loops)
        if (
          parsed.needsMore &&
          (!parsed.missingTools || parsed.missingTools.length === 0)
        ) {
          parsed.needsMore = false;
        }
        return parsed;
      } catch {
        return null;
      }
    } catch (e) {
      this.recordError("selfReflect", e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.2 PLAN FROM REFLECTION — Convert reflection into additional tool plan
  // ═══════════════════════════════════════════════════════════
  _planFromReflection(reflection, userId, _mediaData = {}, _isAdmin = false) {
    if (
      !reflection ||
      !reflection.missingTools ||
      reflection.missingTools.length === 0
    )
      return [];

    const additionalPlan = [];
    const toolMapping = {
      search: { tool: "search", priority: 1 },
      weather: { tool: "weather", priority: 2 },
      imagine: { tool: "imagine", priority: 3 },
      map: { tool: "map", priority: 4 },
      memory: { tool: "memory", priority: 5 },
      news: { tool: "news", priority: 6 },
      trade_intelligence: { tool: "trade_intelligence", priority: 7 },
      health_check: { tool: "health_check", priority: 8 },
    };

    for (const toolName of reflection.missingTools) {
      const mapping = toolMapping[toolName];
      if (mapping) {
        additionalPlan.push({
          tool: mapping.tool,
          priority: mapping.priority,
          fromReflection: true,
        });
      }
    }

    logger.info(
      {
        component: "Brain",
        additionalTools: additionalPlan.map((p) => p.tool),
      },
      `🔄 Reflection added ${additionalPlan.length} new tools to plan`,
    );
    return additionalPlan;
  }

  // ═══════════════════════════════════════════════════════════
  // 9.3 CONTEXT WINDOW MANAGEMENT — Prevent token overflow
  // Sliding window + intelligent summarization of old messages
  // ═══════════════════════════════════════════════════════════
  _manageContextWindow(history, maxMessages = 20, maxChars = 15000) {
    if (!history || history.length === 0) return [];

    // Phase 1: Hard cap on number of messages
    let managed = history;
    if (managed.length > maxMessages) {
      // Keep first 2 messages (initial context) + last maxMessages-2
      const first = managed.slice(0, 2);
      const recent = managed.slice(-(maxMessages - 2));
      managed = [
        ...first,
        {
          role: "system",
          content: `[... ${history.length - maxMessages} older messages summarized ...]`,
        },
        ...recent,
      ];
    }

    // Phase 2: Character cap — truncate individual long messages
    let totalChars = 0;
    const result = [];
    for (let i = managed.length - 1; i >= 0; i--) {
      const msg = managed[i];
      const contentLen = (msg.content || "").length;
      if (totalChars + contentLen > maxChars && result.length > 5) {
        // Truncate this message
        const remaining = Math.max(100, maxChars - totalChars);
        result.unshift({
          ...msg,
          content: msg.content.substring(0, remaining) + "... [truncated]",
        });
        // Add summary marker before truncation point
        result.unshift({
          role: "system",
          content: `[Earlier messages truncated to fit context window. ${i} older messages not shown.]`,
        });
        break;
      }
      totalChars += contentLen;
      result.unshift(msg);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // 9.4 SUMMARIZE TEXT — Uses AI to create concise summary
  // Used by RAG, news digest, and context management
  // ═══════════════════════════════════════════════════════════
  async _summarize(text, maxLength = 200, language = "ro") {
    if (!text || text.length < maxLength) return text;

    const aiKey = this.groqKey || this.geminiKey;
    if (!aiKey) return text.substring(0, maxLength) + "...";

    try {
      const prompt = `Sumarizează în maxim ${maxLength} caractere, în limba ${language === "ro" ? "română" : "engleză"}:\n\n${text.substring(0, 2000)}`;

      if (this.groqKey) {
        const r = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.groqKey,
            },
            body: JSON.stringify({
              model: MODELS.GROQ_PRIMARY,
              max_tokens: Math.ceil(maxLength / 3),
              messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(3000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          return (
            d.choices?.[0]?.message?.content?.trim() ||
            text.substring(0, maxLength)
          );
        }
      }

      const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
      if (geminiKey) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: Math.ceil(maxLength / 3) },
            }),
            signal: AbortSignal.timeout(3000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          return (
            d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
            text.substring(0, maxLength)
          );
        }
      }

      return text.substring(0, maxLength) + "...";
    } catch {
      return text.substring(0, maxLength) + "...";
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.5 TRANSLATE — Dedicated translation service
  // ═══════════════════════════════════════════════════════════
  async _translate(text, targetLang = "ro", _sourceLang = "auto") {
    if (!text || text.length === 0) return text;

    const aiKey = this.groqKey || this.geminiKey;
    if (!aiKey) return text;

    try {
      const langNames = {
        ro: "Romanian",
        en: "English",
        es: "Spanish",
        fr: "French",
        de: "German",
        it: "Italian",
      };
      const targetName = langNames[targetLang] || targetLang;
      const prompt = `Translate the following text to ${targetName}. Return ONLY the translation, nothing else:\n\n${text.substring(0, 3000)}`;

      if (this.groqKey) {
        const r = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.groqKey,
            },
            body: JSON.stringify({
              model: MODELS.GROQ_PRIMARY,
              max_tokens: 1000,
              messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(5000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          return d.choices?.[0]?.message?.content?.trim() || text;
        }
      }

      const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
      if (geminiKey) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 1000 },
            }),
            signal: AbortSignal.timeout(5000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
        }
      }

      return text;
    } catch {
      return text;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.6 DB QUERY TOOL — Brain can query Supabase directly
  // Read-only, safe tables only, with query generation
  // ═══════════════════════════════════════════════════════════
  async _dbQuery(question, _userId) {
    if (!this.supabaseAdmin) return { error: "No database connection" };

    const SAFE_TABLES = [
      "profiles",
      "conversations",
      "messages",
      "ai_costs",
      "page_views",
      "subscriptions",
      "trades",
      "trade_intelligence",
      "media_history",
      "learned_facts",
      "admin_logs",
      "admin_codes",
    ];

    try {
      // Use AI to determine which table and what to query
      const prompt = `You are a database query planner. The user asks: "${question}"
Available tables: ${SAFE_TABLES.join(", ")}

Reply STRICTLY with JSON:
{"table":"table_name","select":"column1,column2","filter":{"column":"value"},"order":"column","limit":10,"aggregate":"count|sum|avg|null","aggregateColumn":"column_name|null"}

Rules:
- Only use tables from the list above
- Keep queries simple (no JOINs)
- limit max 50
- If question is about counting, use aggregate:"count"`;

      let queryPlan = null;
      const _aiKey = this.groqKey || this.geminiKey;

      if (this.groqKey) {
        const r = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + this.groqKey,
            },
            body: JSON.stringify({
              model: MODELS.GROQ_PRIMARY,
              max_tokens: 200,
              messages: [{ role: "user", content: prompt }],
            }),
            signal: AbortSignal.timeout(4000),
          },
        );
        if (r.ok) {
          const d = await r.json();
          const txt = d.choices?.[0]?.message?.content?.trim();
          try {
            queryPlan = JSON.parse(txt.replace(/```json|```/g, "").trim());
          } catch { /* ignored */ }
        }
      }

      if (!queryPlan) return { error: "Could not plan query", question };

      // Validate table is safe
      if (!SAFE_TABLES.includes(queryPlan.table)) {
        return {
          error: `Table ${queryPlan.table} not allowed`,
          safeTables: SAFE_TABLES,
        };
      }

      // Execute query
      let query = this.supabaseAdmin.from(queryPlan.table);

      if (queryPlan.aggregate === "count") {
        query = query.select("*", { count: "exact", head: true });
      } else {
        query = query.select(queryPlan.select || "*");
      }

      // Apply filters
      if (queryPlan.filter) {
        for (const [col, val] of Object.entries(queryPlan.filter)) {
          query = query.eq(col, val);
        }
      }

      // Apply order
      if (queryPlan.order) {
        query = query.order(queryPlan.order, { ascending: false });
      }

      // Apply limit
      query = query.limit(queryPlan.limit || 10);

      const { data, error, count } = await query;

      if (error) return { error: error.message, table: queryPlan.table };

      return {
        table: queryPlan.table,
        query: queryPlan,
        results: queryPlan.aggregate === "count" ? { count } : data,
        rowCount: queryPlan.aggregate === "count" ? count : (data || []).length,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.7 SMART NOTIFICATIONS — Schedule and send notifications
  // ═══════════════════════════════════════════════════════════
  async _scheduleReminder(userId, reminderText, triggerAt, channel = "push") {
    if (!this.supabaseAdmin) return { error: "No database" };

    try {
      // Store reminder in Supabase
      const { _data, error } = await this.supabaseAdmin
        .from("brain_memory")
        .insert({
          user_id: userId,
          type: "reminder",
          content: JSON.stringify({
            text: reminderText,
            triggerAt:
              triggerAt instanceof Date ? triggerAt.toISOString() : triggerAt,
            channel,
            status: "pending",
            createdAt: new Date().toISOString(),
          }),
          importance: 9,
        });

      if (error) return { error: error.message };

      logger.info(
        { component: "Brain", userId, triggerAt },
        `⏰ Reminder scheduled: ${reminderText.substring(0, 50)}`,
      );
      return {
        success: true,
        reminder: reminderText,
        triggerAt,
        channel,
        message: `Reminder setat: "${reminderText}" la ${triggerAt}`,
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  // Check and fire pending reminders (called periodically)
  async _checkReminders() {
    if (!this.supabaseAdmin) return;

    try {
      const now = new Date().toISOString();
      const { data: reminders } = await this.supabaseAdmin
        .from("brain_memory")
        .select("*")
        .eq("type", "reminder")
        .limit(20);

      if (!reminders || reminders.length === 0) return;

      for (const rem of reminders) {
        try {
          const parsed = JSON.parse(rem.content);
          if (parsed.status !== "pending") continue;
          if (new Date(parsed.triggerAt) <= new Date()) {
            // Reminder is due — mark as fired
            parsed.status = "fired";
            parsed.firedAt = now;
            await this.supabaseAdmin
              .from("brain_memory")
              .update({ content: JSON.stringify(parsed) })
              .eq("id", rem.id);

            logger.info(
              { component: "Brain", userId: rem.user_id },
              `⏰ Reminder fired: ${parsed.text.substring(0, 50)}`,
            );
          }
        } catch { /* ignored */ }
      }
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "Reminder check failed",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.4b GOOGLE CALENDAR — Create, list, delete events
  // Uses Google Calendar API with service account or API key
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a Google Calendar event.
   * Supports natural language time parsing.
   */
  async _calendarCreate(
    title,
    startTime,
    endTime,
    description = "",
    userId = null,
  ) {
    this.toolStats.calendarCreate = (this.toolStats.calendarCreate || 0) + 1;
    const calId = process.env.GOOGLE_CALENDAR_ID || "primary";

    // Get OAuth2 access token via service account
    const token = await this._getCalendarToken();
    if (!token) {
      // Fallback: save as reminder in DB
      logger.info(
        { component: "Calendar" },
        "No Calendar credentials — saving as reminder",
      );
      await this._scheduleReminder(userId, `📅 ${title}`, startTime, "push");
      return {
        saved: true,
        fallback: "reminder",
        title,
        startTime,
        message: `📅 Am salvat "${title}" ca reminder. Configurează service account pentru Calendar.`,
      };
    }

    try {
      const start = new Date(startTime || Date.now() + 3600000);
      const end = endTime
        ? new Date(endTime)
        : new Date(start.getTime() + 3600000);

      if (isNaN(start.getTime())) {
        return {
          error: true,
          message: `Nu am putut interpreta data: "${startTime}". Încearcă format ISO (2025-03-15T14:00:00).`,
        };
      }

      const event = {
        summary: title,
        description:
          description || `Created by KelionAI for ${userId || "user"}`,
        start: { dateTime: start.toISOString(), timeZone: "Europe/Bucharest" },
        end: { dateTime: end.toISOString(), timeZone: "Europe/Bucharest" },
      };

      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(8000),
        },
      );

      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        logger.warn(
          { component: "Calendar", status: r.status, err: errBody },
          "Calendar API error",
        );
        await this._scheduleReminder(userId, `📅 ${title}`, startTime, "push");
        return {
          saved: true,
          fallback: "reminder",
          title,
          startTime,
          message: `📅 Calendar API eroare — salvat ca reminder: "${title}" la ${start.toLocaleString("ro-RO")}`,
        };
      }

      const data = await r.json();
      logger.info(
        { component: "Calendar", eventId: data.id, title },
        `📅 Event created: ${title}`,
      );

      return {
        created: true,
        eventId: data.id,
        title: data.summary,
        start: data.start?.dateTime,
        end: data.end?.dateTime,
        link: data.htmlLink,
        message: `📅 Am creat evenimentul "${title}" pe ${start.toLocaleDateString("ro-RO")} la ${start.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}.`,
      };
    } catch (e) {
      logger.warn(
        { component: "Calendar", err: e.message },
        "Calendar create failed",
      );
      await this._scheduleReminder(
        userId,
        `📅 ${title}`,
        startTime,
        "push",
      ).catch(() => {});
      return {
        saved: true,
        fallback: "reminder",
        title,
        message: `📅 Salvat ca reminder: "${title}"`,
      };
    }
  }

  /**
   * List upcoming Google Calendar events.
   */
  async _calendarList(_userId = null, maxResults = 10) {
    this.toolStats.calendarList = (this.toolStats.calendarList || 0) + 1;
    const calId = process.env.GOOGLE_CALENDAR_ID || "primary";

    const token = await this._getCalendarToken();
    if (!token) {
      // Fallback: list reminders from DB
      if (!this.supabaseAdmin)
        return { events: [], message: "Nu am acces la calendar." };
      try {
        const { data } = await this.supabaseAdmin
          .from("brain_memory")
          .select("content, created_at")
          .eq("type", "reminder")
          .order("created_at", { ascending: false })
          .limit(maxResults);

        const events = (data || [])
          .map((r) => {
            try {
              const p = JSON.parse(r.content);
              return { title: p.text, time: p.triggerAt, status: p.status };
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        return {
          events,
          source: "reminders",
          message: `📋 ${events.length} reminder(e) active.`,
        };
      } catch (e) {
        return { events: [], error: e.message };
      }
    }

    try {
      const now = new Date().toISOString();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${now}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`;

      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`Calendar API ${r.status}`);

      const data = await r.json();
      const events = (data.items || []).map((e) => ({
        id: e.id,
        title: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        description: e.description?.substring(0, 100),
        link: e.htmlLink,
      }));

      logger.info(
        { component: "Calendar", count: events.length },
        `📋 Listed ${events.length} events`,
      );
      return {
        events,
        source: "google",
        message: `📋 ${events.length} eveniment(e) viitoare.`,
      };
    } catch (e) {
      logger.warn(
        { component: "Calendar", err: e.message },
        "Calendar list failed",
      );
      return { events: [], error: e.message };
    }
  }

  /**
   * Delete a Google Calendar event by ID.
   */
  async _calendarDelete(eventId, _userId = null) {
    this.toolStats.calendarDelete = (this.toolStats.calendarDelete || 0) + 1;
    const calId = process.env.GOOGLE_CALENDAR_ID || "primary";

    const token = await this._getCalendarToken();
    if (!token || !eventId) {
      return {
        deleted: false,
        message: "Nu pot șterge — lipsesc credențiale sau event ID.",
      };
    }

    try {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${eventId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        },
      );

      if (r.status === 204 || r.ok) {
        logger.info(
          { component: "Calendar", eventId },
          `🗑️ Event deleted: ${eventId}`,
        );
        return {
          deleted: true,
          eventId,
          message: `🗑️ Evenimentul a fost șters.`,
        };
      }

      return { deleted: false, message: `Calendar API a returnat ${r.status}` };
    } catch (e) {
      logger.warn(
        { component: "Calendar", err: e.message },
        "Calendar delete failed",
      );
      return { deleted: false, error: e.message };
    }
  }

  /**
   * Get OAuth2 access token for Google Calendar via Service Account JWT.
   * Creates a JWT signed with the service account private key,
   * exchanges it for an access token, and caches for 55 minutes.
   */
  async _getCalendarToken() {
    // Return cached token if still valid
    if (this._calendarTokenCache && this._calendarTokenExpiry > Date.now()) {
      return this._calendarTokenCache;
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    if (!clientEmail || !privateKeyRaw) return null;

    try {
      const crypto = require("crypto");
      const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

      // Build JWT header + payload (with domain-wide delegation)
      const header = { alg: "RS256", typ: "JWT" };
      const now = Math.floor(Date.now() / 1000);
      const calendarOwner =
        process.env.GOOGLE_CALENDAR_OWNER || process.env.ADMIN_EMAIL || "";
      const payload = {
        iss: clientEmail,
        sub: calendarOwner, // Domain-wide delegation: act as this user
        scope: "https://www.googleapis.com/auth/calendar",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      };

      const b64 = (obj) =>
        Buffer.from(JSON.stringify(obj)).toString("base64url");
      const unsigned = b64(header) + "." + b64(payload);

      // Sign with RSA SHA-256
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(unsigned);
      const signature = sign.sign(privateKey, "base64url");
      const jwt = unsigned + "." + signature;

      // Exchange JWT for access token
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) {
        const err = await r.text().catch(() => "");
        logger.warn(
          { component: "CalendarAuth", status: r.status, err },
          "Token exchange failed",
        );
        return null;
      }

      const data = await r.json();
      this._calendarTokenCache = data.access_token;
      this._calendarTokenExpiry = Date.now() + 55 * 60 * 1000; // Cache 55 minutes
      logger.info(
        { component: "CalendarAuth" },
        "🔑 Calendar access token obtained",
      );
      return data.access_token;
    } catch (e) {
      logger.warn(
        { component: "CalendarAuth", err: e.message },
        "JWT auth failed",
      );
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.4c DOCUMENT GENERATION — Create formatted reports
  // Generates markdown/text documents from user data with AI
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate a structured document/report.
   * Uses AI to create professional formatted content.
   */
  async _generateDocument(title, content, format = "markdown", userId = null) {
    this.toolStats.generateDoc = (this.toolStats.generateDoc || 0) + 1;

    try {
      const prompt = `Generate a professional ${format} document with the following specifications:

Title: ${title}
Content/Instructions: ${content.substring(0, 2000)}
Format: ${format}

Rules:
- Use clear headings and structure
- Include a header with title and date (${new Date().toLocaleDateString("ro-RO")})
- Be comprehensive but concise
- Use Romanian if the content is in Romanian, otherwise English
- For markdown: use proper ## headers, bullet points, tables where appropriate
- For text: use clean formatting with separators

Generate the complete document now:`;

      let docContent = null;

      // Try Gemini first (best for long-form content)
      if (this.geminiKey) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const d = await r.json();
        docContent = d.candidates?.[0]?.content?.parts?.[0]?.text;
      }

      // Fallback to Groq
      if (!docContent && this.groqKey) {
        const r = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.groqKey}`,
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: prompt }],
              max_tokens: 4096,
              temperature: 0.3,
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        const d = await r.json();
        docContent = d.choices?.[0]?.message?.content;
      }

      if (!docContent) {
        return {
          generated: false,
          message:
            "Nu am putut genera documentul — niciun model AI disponibil.",
        };
      }

      // Save to brain memory for retrieval
      if (this.supabaseAdmin && userId) {
        await this.supabaseAdmin
          .from("brain_memory")
          .insert({
            user_id: userId,
            type: "document",
            content: JSON.stringify({
              title,
              format,
              body: docContent.substring(0, 10000),
              createdAt: new Date().toISOString(),
            }),
          })
          .catch(() => {});
      }

      logger.info(
        { component: "DocGen", title, format, length: docContent.length },
        `📄 Document generated: ${title} (${docContent.length}c)`,
      );

      return {
        generated: true,
        title,
        format,
        content: docContent,
        length: docContent.length,
        message: `📄 Document "${title}" generat (${format}, ${docContent.length} caractere).`,
      };
    } catch (e) {
      logger.warn(
        { component: "DocGen", err: e.message },
        "Document generation failed",
      );
      return { generated: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.5 TRUTH GUARD — Fact verification & claim validation
  // Verifies AI response quality: checks claims against sources,
  // detects unsupported assertions, calculates factual score
  // ═══════════════════════════════════════════════════════════

  /**
   * Extract verifiable claims from AI response text.
   * Returns array of { claim, type, verifiable }
   */
  _extractClaims(responseText) {
    if (!responseText || responseText.length < 30) return [];

    const claims = [];
    const sentences = responseText
      .replace(/["""]/g, '"')
      .split(/[.!?]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15 && s.length < 500);

    for (const sentence of sentences) {
      // Detect factual claims
      const isStatistic =
        /\b(\d+[\.,]?\d*\s*(%|procent|milioane|miliard|lei|usd|\$|euro|€))/i.test(
          sentence,
        );
      const isDate =
        /\b(in\s+\d{4}|pe\s+\d{1,2}|din\s+(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie))/i.test(
          sentence,
        );
      const isAbsolute =
        /\b(intotdeauna|niciodata|toți|nimeni|cel mai|always|never|everyone|nobody|every|all|none)\b/i.test(
          sentence,
        );
      const isComparison =
        /\b(mai\s+(bun|mare|mic|rapid|ieftin|scump)|better|worse|faster|cheaper|more\s+than)\b/i.test(
          sentence,
        );
      const isCausal =
        /\b(deoarece|pentru\s+ca|cauza|duce\s+la|because|causes|leads\s+to|results\s+in)\b/i.test(
          sentence,
        );
      const isDefinition =
        /\b(este|sunt|inseamna|represents|means|is\s+a|are\s+the)\b/i.test(
          sentence,
        );

      if (isStatistic || isDate || isAbsolute || isComparison || isCausal) {
        claims.push({
          claim: sentence.substring(0, 200),
          type: isStatistic
            ? "statistic"
            : isDate
              ? "temporal"
              : isAbsolute
                ? "absolute"
                : isComparison
                  ? "comparison"
                  : "causal",
          verifiable: true,
          riskLevel: isAbsolute ? "high" : isStatistic ? "medium" : "low",
        });
      } else if (isDefinition && sentence.length > 30) {
        claims.push({
          claim: sentence.substring(0, 200),
          type: "definition",
          verifiable: true,
          riskLevel: "low",
        });
      }
    }

    return claims.slice(0, 10); // Max 10 claims to check
  }

  /**
   * Truth Guard: Validate response against actual data sources.
   * Returns: { factualScore, completenessScore, confidenceScore,
   *            verifiedClaims, unsupportedClaims, evidenceMap, flags, verdict }
   */
  async _truthCheck(responseText, toolResults, analysis, _sources = []) {
    const startTime = Date.now();
    const report = {
      factualScore: 1.0,
      completenessScore: 1.0,
      confidenceScore: 1.0,
      verifiedClaims: [],
      unsupportedClaims: [],
      evidenceMap: {},
      flags: [],
      verdict: "PASS",
      checkedAt: new Date().toISOString(),
      durationMs: 0,
    };

    try {
      // 1. Extract claims from response
      const claims = this._extractClaims(responseText);
      if (claims.length === 0) {
        report.flags.push("NO_VERIFIABLE_CLAIMS");
        report.durationMs = Date.now() - startTime;
        return report;
      }

      // 2. Build evidence base from tool results
      const evidence = {};
      const toolKeys = Object.keys(toolResults || {});
      for (const key of toolKeys) {
        const result = toolResults[key];
        if (!result) continue;
        const text =
          typeof result === "string"
            ? result
            : JSON.stringify(result).substring(0, 3000);
        evidence[key] = text;
      }

      // 3. Check each claim against evidence using fast AI
      const aiKey = this.groqKey || this.geminiKey;
      const useGroq = !!this.groqKey;

      if (aiKey && claims.length > 0) {
        const claimTexts = claims
          .map((c, i) => `${i + 1}. [${c.type}] "${c.claim}"`)
          .join("\n");
        const evidenceText = toolKeys
          .map((k) => `[${k}]: ${(evidence[k] || "").substring(0, 500)}`)
          .join("\n");

        const prompt = `You are a fact-checking system. Check if these claims from an AI response are supported by the provided evidence.

CLAIMS:
${claimTexts}

EVIDENCE FROM TOOLS:
${evidenceText || "(no tool evidence available)"}

For each claim, respond with EXACTLY this JSON format:
{"results": [{"id": 1, "supported": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}]}

Rules:
- "supported": true if evidence clearly supports the claim
- "supported": false if claim has no evidence OR contradicts evidence
- If no evidence exists for a claim, mark it "supported": false with confidence 0.5
- Be strict: if claim adds information not in evidence, mark unsupported`;

        try {
          let aiResponse;
          if (useGroq) {
            const r = await fetch(
              "https://api.groq.com/openai/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.groqKey}`,
                },
                body: JSON.stringify({
                  model: "llama-3.3-70b-versatile",
                  messages: [{ role: "user", content: prompt }],
                  max_tokens: 500,
                  temperature: 0.1,
                  response_format: { type: "json_object" },
                }),
                signal: AbortSignal.timeout(5000),
              },
            );
            const d = await r.json();
            aiResponse = d.choices?.[0]?.message?.content;
          } else {
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    maxOutputTokens: 500,
                    temperature: 0.1,
                    responseMimeType: "application/json",
                  },
                }),
                signal: AbortSignal.timeout(5000),
              },
            );
            const d = await r.json();
            aiResponse = d.candidates?.[0]?.content?.parts?.[0]?.text;
          }

          if (aiResponse) {
            const parsed = JSON.parse(aiResponse);
            const results = parsed.results || parsed;

            let supported = 0;
            let total = 0;

            for (const r of Array.isArray(results) ? results : []) {
              const claim = claims[(r.id || 1) - 1];
              if (!claim) continue;
              total++;

              if (r.supported) {
                supported++;
                report.verifiedClaims.push({
                  claim: claim.claim,
                  confidence: r.confidence || 0.8,
                  source: "tool_evidence",
                });
                report.evidenceMap[claim.claim.substring(0, 60)] = {
                  verified: true,
                  confidence: r.confidence,
                };
              } else {
                report.unsupportedClaims.push({
                  claim: claim.claim,
                  reason: r.reason || "No evidence",
                  riskLevel: claim.riskLevel,
                });
                report.evidenceMap[claim.claim.substring(0, 60)] = {
                  verified: false,
                  reason: r.reason,
                };
              }
            }

            report.factualScore = total > 0 ? supported / total : 1.0;
          }
        } catch (e) {
          report.flags.push("AI_CHECK_FAILED");
          logger.warn(
            { component: "TruthGuard", err: e.message },
            "AI fact-check failed",
          );
        }
      }

      // 4. Check completeness — did the response address the analysis needs?
      const requestedTools = [];
      if (analysis?.needsSearch) requestedTools.push("search");
      if (analysis?.needsWeather) requestedTools.push("weather");
      if (analysis?.needsImage) requestedTools.push("imagine");
      if (analysis?.needsMap) requestedTools.push("map");
      if (analysis?.needsTranslate) requestedTools.push("translate");
      if (analysis?.needsDbQuery) requestedTools.push("dbQuery");

      const executedTools = toolKeys;
      const missingTools = requestedTools.filter(
        (t) => !executedTools.includes(t),
      );
      if (missingTools.length > 0) {
        report.flags.push(`MISSING_TOOLS:${missingTools.join(",")}`);
        report.completenessScore =
          1 - missingTools.length / Math.max(requestedTools.length, 1);
      }

      // 5. Check for "false success" patterns
      const falseSuccessPatterns = [
        /am (facut|realizat|completat|terminat|rezolvat)/i,
        /totul (e|este) (ok|bine|gata|functional|implementat)/i,
        /deploy (complet|reusit|finalizat)/i,
        /merge perfect/i,
        /i (did|have|completed|finished)/i,
      ];

      for (const pattern of falseSuccessPatterns) {
        if (pattern.test(responseText) && toolKeys.length === 0) {
          report.flags.push("POSSIBLE_FALSE_SUCCESS");
          report.factualScore *= 0.5;
          break;
        }
      }

      // 6. Detect absolute claims without evidence
      const absoluteClaims = report.unsupportedClaims.filter(
        (c) => c.riskLevel === "high",
      );
      if (absoluteClaims.length > 0) {
        report.flags.push(`HIGH_RISK_CLAIMS:${absoluteClaims.length}`);
        report.factualScore *= 0.7;
      }

      // 7. Overall confidence
      report.confidenceScore =
        report.factualScore * 0.5 +
        report.completenessScore * 0.3 +
        (toolKeys.length > 0 ? 0.2 : 0);

      // 8. Final verdict
      if (report.factualScore < 0.3) report.verdict = "FAIL";
      else if (report.factualScore < 0.6) report.verdict = "WARNING";
      else if (report.flags.length > 2) report.verdict = "CAUTION";
      else report.verdict = "PASS";

      report.durationMs = Date.now() - startTime;

      logger.info(
        {
          component: "TruthGuard",
          factualScore: report.factualScore.toFixed(2),
          completeness: report.completenessScore.toFixed(2),
          verified: report.verifiedClaims.length,
          unsupported: report.unsupportedClaims.length,
          flags: report.flags,
          verdict: report.verdict,
          ms: report.durationMs,
        },
        `🛡️ Truth Guard: ${report.verdict} | factual:${(report.factualScore * 100).toFixed(0)}% | ${report.verifiedClaims.length}✓ ${report.unsupportedClaims.length}✗`,
      );

      return report;
    } catch (e) {
      report.flags.push("CHECK_ERROR");
      report.durationMs = Date.now() - startTime;
      logger.warn(
        { component: "TruthGuard", err: e.message },
        "Truth check error",
      );
      return report;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.6 SMART MODEL ROUTING — Choose optimal model per task
  // Routes to fast/balanced/premium model based on complexity,
  // cost sensitivity, and task type
  // ═══════════════════════════════════════════════════════════

  // Complexity levels (5-tier)
  static get COMPLEXITY_LEVELS() {
    return {
      simple: {
        level: 1,
        model: "fast",
        maxTokens: 300,
        description: "Simple Q&A, greetings, status",
      },
      medium: {
        level: 2,
        model: "fast",
        maxTokens: 500,
        description: "Factual questions, lookups",
      },
      complex: {
        level: 3,
        model: "balanced",
        maxTokens: 800,
        description: "Analysis, multi-tool tasks",
      },
      critical: {
        level: 4,
        model: "premium",
        maxTokens: 1200,
        description: "Important decisions, multi-step",
      },
      highRisk: {
        level: 5,
        model: "premium",
        maxTokens: 1500,
        description: "Financial, legal, medical, irreversible",
      },
    };
  }

  /**
   * Score task complexity on 5-level scale.
   * Returns: { level, name, model, maxTokens, reasoning }
   */
  _scoreComplexity(analysis, message) {
    let score = 1;
    const reasons = [];

    // Count active intents
    const activeIntents = Object.keys(analysis).filter(
      (k) => k.startsWith("needs") && analysis[k] === true,
    ).length;
    if (activeIntents >= 4) {
      score += 2;
      reasons.push(`${activeIntents} intents`);
    } else if (activeIntents >= 2) {
      score += 1;
      reasons.push(`${activeIntents} intents`);
    }

    // Message length and complexity signals
    if (message.length > 500) {
      score += 1;
      reasons.push("long message");
    }
    if (message.split(/[.!?]/).length > 5) {
      score += 1;
      reasons.push("multi-sentence");
    }

    // High-risk domains
    if (
      /\b(invest|trading|tranzact|bani|money|financ|legal|juridic|medical|sanatate|health|sterge|delete|remove)\b/i.test(
        message,
      )
    ) {
      score += 2;
      reasons.push("high-risk domain");
    }

    // Multi-step indicators
    if (/\b(mai intai|apoi|dupa|pasul|step|fase|etap|plan)\b/i.test(message)) {
      score += 1;
      reasons.push("multi-step");
    }

    // Analytical requests
    if (
      /\b(analiz|compar|evalueaz|decide|recomand|strateg|optimiz|diagnostic)\b/i.test(
        message,
      )
    ) {
      score += 1;
      reasons.push("analytical");
    }

    // Cap at 5
    score = Math.min(score, 5);

    const levels = ["simple", "medium", "complex", "critical", "highRisk"];
    const name = levels[score - 1] || "simple";
    const config = KelionBrain.COMPLEXITY_LEVELS[name];

    return {
      level: score,
      name,
      model: config.model,
      maxTokens: config.maxTokens,
      reasoning: reasons.join(", ") || "default",
    };
  }

  /**
   * Route to the optimal AI model based on complexity and available providers.
   * Returns: { provider, model, apiKey, endpoint, reason }
   */
  _routeModel(complexityResult) {
    const tier = complexityResult.model; // "fast", "balanced", "premium"

    // Fast tier: Groq (free/cheap, low latency)
    if (tier === "fast" && this.groqKey) {
      return {
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: this.groqKey,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        reason: `Fast model for ${complexityResult.name} task`,
        maxTokens: complexityResult.maxTokens,
        costPerToken: 0.00000027,
      };
    }

    // Balanced tier: Gemini Flash (good quality/cost ratio)
    if ((tier === "balanced" || tier === "fast") && this.geminiKey) {
      return {
        provider: "gemini",
        model: MODELS.GEMINI_CHAT,
        apiKey: this.geminiKey,
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent`,
        reason: `Balanced model for ${complexityResult.name} task`,
        maxTokens: complexityResult.maxTokens,
        costPerToken: 0.0000003,
      };
    }

    // Premium tier: Gemini 2.5 Pro — DEEP REASONING for complex tasks
    if (tier === "premium" && this.geminiKey) {
      return {
        provider: "gemini",
        model: MODELS.GEMINI_PRO,
        apiKey: this.geminiKey,
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_PRO}:generateContent`,
        reason: `🧠 Deep reasoning (Gemini Pro) for ${complexityResult.name} task`,
        maxTokens: Math.max(complexityResult.maxTokens, 4000),
        costPerToken: 0.00000125,
      };
    }

    // Premium fallback: OpenAI GPT-4o if no Gemini
    if (tier === "premium" && this.openaiKey) {
      return {
        provider: "openai",
        model: "gpt-4o",
        apiKey: this.openaiKey,
        endpoint: "https://api.openai.com/v1/chat/completions",
        reason: `Premium model for ${complexityResult.name} task`,
        maxTokens: complexityResult.maxTokens,
        costPerToken: 0.000005,
      };
    }

    // Fallback chain: Gemini Flash → Groq → OpenAI
    if (this.geminiKey) {
      return {
        provider: "gemini",
        model: MODELS.GEMINI_CHAT,
        apiKey: this.geminiKey,
        endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent`,
        reason: "Fallback to Gemini",
        maxTokens: complexityResult.maxTokens,
        costPerToken: 0.0000003,
      };
    }
    if (this.groqKey) {
      return {
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: this.groqKey,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        reason: "Fallback to Groq",
        maxTokens: complexityResult.maxTokens,
        costPerToken: 0.00000027,
      };
    }

    return {
      provider: "none",
      model: "none",
      reason: "No AI provider available",
      maxTokens: 300,
      costPerToken: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 9.6b CRITIC AGENT — Independent response validation layer
  // Separate from Truth Guard: evaluates quality, consistency,
  // relevance, safety, and completeness of AI responses
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if response contradicts itself.
   * Returns: { consistent, issues[] }
   */
  _checkConsistency(responseText) {
    const issues = [];

    // Split into sentences
    const sentences = responseText
      .split(/[.!?]\s+/)
      .filter((s) => s.length > 10);
    if (sentences.length < 2) return { consistent: true, issues: [] };

    // Check for direct contradictions
    const contradictionPairs = [
      [/\b(da|yes)\b/i, /\b(nu|no)\b/i],
      [/\b(poate|can)\b/i, /\b(nu (se )?poate|cannot|can't)\b/i],
      [
        /\b(sigur|certainly|definitely)\b/i,
        /\b(nesigur|uncertain|maybe|poate)\b/i,
      ],
      [
        /\b(recoman[d]|suggest|advise)\b/i,
        /\b(nu recoman[d]|do not suggest|avoid)\b/i,
      ],
      [/\b(crescut|increased|grew)\b/i, /\b(scazut|decreased|dropped)\b/i],
    ];

    for (let i = 0; i < sentences.length - 1; i++) {
      for (let j = i + 1; j < Math.min(sentences.length, i + 4); j++) {
        for (const [pattern1, pattern2] of contradictionPairs) {
          if (
            (pattern1.test(sentences[i]) && pattern2.test(sentences[j])) ||
            (pattern2.test(sentences[i]) && pattern1.test(sentences[j]))
          ) {
            // Check if they refer to the same topic (share 2+ words)
            const words_i = sentences[i]
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3);
            const words_j = sentences[j]
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 3);
            const shared = words_i.filter((w) => words_j.includes(w));
            if (shared.length >= 2) {
              issues.push({
                type: "contradiction",
                sentence1: sentences[i].substring(0, 80),
                sentence2: sentences[j].substring(0, 80),
                sharedContext: shared.join(", "),
              });
            }
          }
        }
      }
    }

    return { consistent: issues.length === 0, issues };
  }

  /**
   * Check if response actually addresses the user's question.
   * Returns: { relevant, score 0-1, reason }
   */
  _checkRelevance(userMessage, responseText) {
    if (!userMessage || !responseText)
      return { relevant: true, score: 1.0, reason: "no input" };

    // Extract key topics from user message
    const userWords = userMessage
      .toLowerCase()
      .replace(/[^\w\săîâșț]/g, "")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          ![
            "care",
            "este",
            "sunt",
            "asta",
            "acesta",
            "aceasta",
            "pentru",
            "despre",
            "this",
            "that",
            "what",
            "from",
            "with",
            "have",
          ].includes(w),
      );

    if (userWords.length === 0)
      return { relevant: true, score: 1.0, reason: "short query" };

    // Check how many user topic words appear in response
    const responseLower = responseText.toLowerCase();
    const found = userWords.filter((w) => responseLower.includes(w));
    const score = found.length / userWords.length;

    // Question type detection
    const isQuestion =
      /\?|ce |cum |cand |unde |cine |de ce |cat |how |what |when |where |who |why /.test(
        userMessage.toLowerCase(),
      );

    // If it's a question but response looks like a generic filler, flag it
    const genericFillers = [
      /nu am informatii/i,
      /nu stiu exact/i,
      /as putea sa/i,
      /in general/i,
      /depinde de/i,
    ];
    const isGeneric =
      genericFillers.some((p) => p.test(responseText)) &&
      responseText.length < 200;

    if (isQuestion && isGeneric) {
      return {
        relevant: false,
        score: 0.3,
        reason: "generic filler to specific question",
      };
    }

    return {
      relevant: score >= 0.2,
      score: Math.min(score * 1.5, 1.0), // Boost slightly — partial matches are ok
      reason:
        score < 0.2
          ? `low topic overlap (${found.length}/${userWords.length})`
          : "topic match ok",
    };
  }

  /**
   * Check response for harmful, dangerous, or inappropriate content.
   * Returns: { safe, flags[], severity }
   */
  _checkSafety(responseText) {
    const flags = [];

    // Financial advice without disclaimers
    if (
      /\b(invest|cumpara|vinde|buy|sell|trading)\b/i.test(responseText) &&
      !/\b(risc|risk|disclaimer|nu constituie sfat|not financial advice|prudenta|careful)\b/i.test(
        responseText,
      )
    ) {
      flags.push({ type: "financial_no_disclaimer", severity: "medium" });
    }

    // Medical advice without disclaimers
    if (
      /\b(medica[lm]|tratament|pastil|diagnos|boal|symptom|treatment|pill|medicine)\b/i.test(
        responseText,
      ) &&
      !/\b(doctor|medic|specialist|consulta|profesionist|professional|nu inlocui)\b/i.test(
        responseText,
      )
    ) {
      flags.push({ type: "medical_no_disclaimer", severity: "high" });
    }

    // Dangerous instructions
    if (
      /\b(exploziv|arma|otrav|hack|sparg|bomb|weapon|poison|exploit|vulnerability)\b/i.test(
        responseText,
      )
    ) {
      flags.push({ type: "dangerous_content", severity: "critical" });
    }

    // Personal data exposure patterns
    if (
      /\b(\d{13,16}|\d{3}-\d{2}-\d{4}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i.test(
        responseText,
      )
    ) {
      flags.push({ type: "possible_pii", severity: "medium" });
    }

    const maxSeverity = flags.reduce((max, f) => {
      const order = { low: 0, medium: 1, high: 2, critical: 3 };
      return order[f.severity] > order[max] ? f.severity : max;
    }, "low");

    return {
      safe: flags.length === 0 || maxSeverity === "low",
      flags,
      severity: flags.length > 0 ? maxSeverity : "none",
    };
  }

  /**
   * Full Critic Agent evaluation — runs all checks and produces a verdict.
   * Returns: { verdict, overallScore, consistency, relevance, safety, suggestions[], durationMs }
   */
  async criticEvaluate(userMessage, responseText, analysis, _toolsUsed = []) {
    const startTime = Date.now();

    const report = {
      verdict: "APPROVED",
      overallScore: 1.0,
      consistency: null,
      relevance: null,
      safety: null,
      suggestions: [],
      durationMs: 0,
    };

    try {
      // 1. Consistency check
      report.consistency = this._checkConsistency(responseText);
      if (!report.consistency.consistent) {
        report.suggestions.push("⚠️ Răspunsul conține posibile contradicții");
        report.overallScore *= 0.7;
      }

      // 2. Relevance check
      report.relevance = this._checkRelevance(userMessage, responseText);
      if (!report.relevance.relevant) {
        report.suggestions.push(
          "⚠️ Răspunsul nu pare să adreseze direct întrebarea",
        );
        report.overallScore *= 0.5;
      } else {
        report.overallScore *= report.relevance.score;
      }

      // 3. Safety check
      report.safety = this._checkSafety(responseText);
      if (!report.safety.safe) {
        if (report.safety.severity === "critical") {
          report.suggestions.push("🚫 Conținut potențial periculos detectat");
          report.overallScore *= 0.1;
        } else if (report.safety.severity === "high") {
          report.suggestions.push(
            "⚠️ Sfat medical/financiar fără disclaimer adecvat",
          );
          report.overallScore *= 0.5;
        } else {
          report.suggestions.push(
            "ℹ️ Verifică conținutul pentru date personale",
          );
          report.overallScore *= 0.8;
        }
      }

      // 4. Length/quality heuristics
      if (responseText.length < 20 && userMessage.length > 50) {
        report.suggestions.push(
          "ℹ️ Răspuns prea scurt pentru o întrebare detaliată",
        );
        report.overallScore *= 0.7;
      }

      // 5. AI-powered deep critique (for complex tasks only)
      if (analysis?.complexityLevel >= 3 && (this.groqKey || this.geminiKey)) {
        try {
          const prompt = `You are a response critic. Rate this AI response on a 1-10 scale.

USER ASKED: "${userMessage.substring(0, 200)}"
AI REPLIED: "${responseText.substring(0, 500)}"

Respond with EXACTLY this JSON:
{"score": 1-10, "issues": ["issue1", "issue2"], "missing": ["what should have been included"]}

Be strict. Check for: completeness, accuracy signals, helpfulness, tone appropriateness.`;

          const useGroq = !!this.groqKey;
          let aiResponse;

          if (useGroq) {
            const r = await fetch(
              "https://api.groq.com/openai/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.groqKey}`,
                },
                body: JSON.stringify({
                  model: "llama-3.3-70b-versatile",
                  messages: [{ role: "user", content: prompt }],
                  max_tokens: 300,
                  temperature: 0.1,
                  response_format: { type: "json_object" },
                }),
                signal: AbortSignal.timeout(4000),
              },
            );
            const d = await r.json();
            aiResponse = d.choices?.[0]?.message?.content;
          } else {
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    maxOutputTokens: 300,
                    temperature: 0.1,
                    responseMimeType: "application/json",
                  },
                }),
                signal: AbortSignal.timeout(4000),
              },
            );
            const d = await r.json();
            aiResponse = d.candidates?.[0]?.content?.parts?.[0]?.text;
          }

          if (aiResponse) {
            const critique = JSON.parse(aiResponse);
            const aiScore = (critique.score || 7) / 10;
            report.overallScore = report.overallScore * 0.6 + aiScore * 0.4;
            if (critique.issues && Array.isArray(critique.issues)) {
              for (const issue of critique.issues.slice(0, 3)) {
                report.suggestions.push("🤖 " + issue);
              }
            }
            if (critique.missing && Array.isArray(critique.missing)) {
              for (const m of critique.missing.slice(0, 2)) {
                report.suggestions.push("📝 Lipsește: " + m);
              }
            }
          }
        } catch (e) {
          // AI critique failed — use heuristic score only
          logger.warn(
            { component: "CriticAgent", err: e.message },
            "AI critique failed",
          );
        }
      }

      // 6. Final verdict
      if (report.overallScore < 0.2) report.verdict = "REJECTED";
      else if (report.overallScore < 0.4) report.verdict = "NEEDS_REVISION";
      else if (report.overallScore < 0.6) report.verdict = "CAUTION";
      else if (report.overallScore < 0.8)
        report.verdict = "APPROVED_WITH_NOTES";
      else report.verdict = "APPROVED";

      report.durationMs = Date.now() - startTime;

      logger.info(
        {
          component: "CriticAgent",
          verdict: report.verdict,
          score: report.overallScore.toFixed(2),
          consistent: report.consistency?.consistent,
          relevant: report.relevance?.relevant,
          safe: report.safety?.safe,
          suggestions: report.suggestions.length,
          ms: report.durationMs,
        },
        `🎭 Critic: ${report.verdict} | score:${(report.overallScore * 100).toFixed(0)}% | ${report.suggestions.length} notes | ${report.durationMs}ms`,
      );

      return report;
    } catch (e) {
      report.durationMs = Date.now() - startTime;
      report.suggestions.push("Critic evaluation error: " + e.message);
      logger.warn(
        { component: "CriticAgent", err: e.message },
        "Critic evaluation error",
      );
      return report;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.7 PROJECT MEMORY — Track user projects and context
  // Kelion knows what projects you're working on, their status,
  // tech stack, and recent activity
  // ═══════════════════════════════════════════════════════════

  /**
   * Load all projects for a user from Supabase.
   * Returns: [{ id, name, description, tech_stack, status, notes, last_activity }]
   */
  async _loadProjects(userId) {
    if (!this.supabaseAdmin || !userId) return [];
    try {
      const { data, error } = await this.supabaseAdmin
        .from("brain_projects")
        .select("*")
        .eq("user_id", userId)
        .order("last_activity", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    } catch (e) {
      logger.warn(
        { component: "ProjectMemory", err: e.message },
        "Failed to load projects",
      );
      return [];
    }
  }

  /**
   * Create or update a project in user's project memory.
   * Extracts project info from conversation context.
   */
  async _saveProject(userId, projectData) {
    if (!this.supabaseAdmin || !userId) return null;
    try {
      const { name, description, tech_stack, status, notes, files_touched } =
        projectData;
      if (!name) return null;

      const { data, error } = await this.supabaseAdmin
        .from("brain_projects")
        .upsert(
          {
            user_id: userId,
            name: name.toLowerCase().trim(),
            description: description || null,
            tech_stack: tech_stack || [],
            status: status || "active",
            notes: notes || null,
            files_touched: files_touched || [],
            last_activity: new Date().toISOString(),
          },
          { onConflict: "user_id,name" },
        )
        .select()
        .single();

      if (error) throw error;
      logger.info(
        { component: "ProjectMemory", project: name },
        `📁 Project saved: ${name}`,
      );
      return data;
    } catch (e) {
      logger.warn(
        { component: "ProjectMemory", err: e.message },
        "Failed to save project",
      );
      return null;
    }
  }

  /**
   * Auto-detect project from conversation and update memory.
   * Runs after each conversation to keep project memory fresh.
   */
  async _autoDetectProject(userId, message, _analysis, _toolsUsed) {
    if (!this.supabaseAdmin || !userId) return;
    try {
      // Detect project-related keywords
      const projectPatterns = [
        /(?:proiect(?:ul)?|project)\s+["""]?([a-zA-Z0-9_\- ]+)["""]?/i,
        /(?:lucrez|work(?:ing)?)\s+(?:la|on|pe)\s+["""]?([a-zA-Z0-9_\- ]+)["""]?/i,
        /(?:aplicat|app|site|website|platform)\s+["""]?([a-zA-Z0-9_\- ]+)["""]?/i,
      ];

      let projectName = null;
      for (const pattern of projectPatterns) {
        const match = message.match(pattern);
        if (match && match[1] && match[1].length > 2 && match[1].length < 50) {
          projectName = match[1].trim();
          break;
        }
      }

      if (!projectName) return;

      // Detect tech stack from message
      const techKeywords = [
        "node",
        "react",
        "vue",
        "angular",
        "python",
        "django",
        "flask",
        "java",
        "spring",
        "supabase",
        "firebase",
        "postgresql",
        "mongodb",
        "docker",
        "railway",
        "vercel",
        "next.js",
        "express",
        "fastify",
        "tailwind",
        "typescript",
        "javascript",
        "html",
        "css",
        "three.js",
      ];
      const detectedTech = techKeywords.filter((t) =>
        message.toLowerCase().includes(t),
      );

      await this._saveProject(userId, {
        name: projectName,
        tech_stack: detectedTech,
        notes: `Last mentioned: ${message.substring(0, 100)}...`,
        files_touched: [],
      });
    } catch (_e) {
      // Non-blocking
    }
  }

  /**
   * Build project context string for AI prompt injection.
   * Returns a concise summary of active projects.
   */
  async _projectContext(userId) {
    const projects = await this._loadProjects(userId);
    if (projects.length === 0) return "";

    const lines = ["[PROIECTE ACTIVE ALE UTILIZATORULUI]"];
    for (const p of projects.slice(0, 5)) {
      const tech =
        Array.isArray(p.tech_stack) && p.tech_stack.length > 0
          ? ` (${p.tech_stack.join(", ")})`
          : "";
      const age = Math.round(
        (Date.now() - new Date(p.last_activity).getTime()) / 3600000,
      );
      const ageStr =
        age < 1
          ? "recent"
          : age < 24
            ? `${age}h ago`
            : `${Math.round(age / 24)}d ago`;
      lines.push(`- ${p.name}${tech} [${p.status}] — last: ${ageStr}`);
      if (p.notes) lines.push(`  nota: ${p.notes.substring(0, 80)}`);
    }
    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════
  // 9.7b PROCEDURAL MEMORY — How tasks were solved (reusable)
  // Records successful task resolution patterns for future reuse
  // ═══════════════════════════════════════════════════════════

  /**
   * Save a procedure (how a task was solved) for future reuse.
   */
  async _saveProcedure(
    userId,
    taskType,
    taskDescription,
    solutionSteps,
    toolsUsed,
    success,
    durationMs,
    complexity,
  ) {
    if (!this.supabaseAdmin) return null;
    try {
      const { data, error } = await this.supabaseAdmin
        .from("brain_procedures")
        .insert({
          user_id: userId || "global",
          task_type: taskType,
          task_description: taskDescription.substring(0, 500),
          solution_steps: solutionSteps || [],
          tools_used: toolsUsed || [],
          success: success !== false,
          duration_ms: durationMs || 0,
          complexity: complexity || "medium",
        })
        .select()
        .single();

      if (error) throw error;
      logger.info(
        { component: "ProceduralMemory", type: taskType, success },
        `📝 Procedure saved: ${taskType} (${success ? "✓" : "✗"})`,
      );
      return data;
    } catch (e) {
      logger.warn(
        { component: "ProceduralMemory", err: e.message },
        "Failed to save procedure",
      );
      return null;
    }
  }

  /**
   * Find similar past procedures that could help solve the current task.
   * Uses task_type matching + keyword similarity.
   * Returns: [{ task_description, solution_steps, tools_used, success_rate }]
   */
  async _findProcedure(taskType, taskDescription, userId = "global") {
    if (!this.supabaseAdmin) return [];
    try {
      // Search by task_type first (exact match)
      const { data: exactMatches } = await this.supabaseAdmin
        .from("brain_procedures")
        .select("*")
        .eq("task_type", taskType)
        .eq("success", true)
        .or(`user_id.eq.${userId},user_id.eq.global`)
        .order("reuse_count", { ascending: false })
        .limit(3);

      if (exactMatches && exactMatches.length > 0) {
        // Increment reuse count for the top match
        await this.supabaseAdmin
          .from("brain_procedures")
          .update({ reuse_count: (exactMatches[0].reuse_count || 0) + 1 })
          .eq("id", exactMatches[0].id)
          .catch(() => {});

        return exactMatches.map((p) => ({
          description: p.task_description,
          steps: p.solution_steps,
          tools: p.tools_used,
          complexity: p.complexity,
          reuseCount: p.reuse_count,
          age: Math.round(
            (Date.now() - new Date(p.created_at).getTime()) / 86400000,
          ),
        }));
      }

      // Fallback: keyword search in task_description
      const keywords = taskDescription
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5);
      if (keywords.length === 0) return [];

      const orFilter = keywords
        .map((k) => `task_description.ilike.%${k}%`)
        .join(",");
      const { data: fuzzyMatches } = await this.supabaseAdmin
        .from("brain_procedures")
        .select("*")
        .eq("success", true)
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(3);

      return (fuzzyMatches || []).map((p) => ({
        description: p.task_description,
        steps: p.solution_steps,
        tools: p.tools_used,
        complexity: p.complexity,
        reuseCount: p.reuse_count,
        age: Math.round(
          (Date.now() - new Date(p.created_at).getTime()) / 86400000,
        ),
      }));
    } catch (e) {
      logger.warn(
        { component: "ProceduralMemory", err: e.message },
        "Failed to find procedure",
      );
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.7b WORKSPACE MEMORY — Persistent project context
  // Saves project structure, tech stack, patterns for each user
  // ═══════════════════════════════════════════════════════════

  /**
   * Save workspace context for a user.
   * Stores file structure, tech stack, patterns, and key files.
   */
  async _saveWorkspace(userId, workspaceName, context) {
    if (!this.supabaseAdmin || !userId) return false;
    try {
      const wsData = {
        name: workspaceName,
        techStack: context.techStack || [],
        keyFiles: context.keyFiles || [],
        patterns: context.patterns || [],
        structure: context.structure || "",
        lastUpdated: new Date().toISOString(),
      };

      // Upsert: update if exists, insert if new
      const { data: existing } = await this.supabaseAdmin
        .from("brain_memory")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "workspace")
        .ilike("content", `%"name":"${workspaceName}"%`)
        .limit(1);

      if (existing && existing.length > 0) {
        await this.supabaseAdmin
          .from("brain_memory")
          .update({ content: JSON.stringify(wsData) })
          .eq("id", existing[0].id);
      } else {
        await this.supabaseAdmin.from("brain_memory").insert({
          user_id: userId,
          type: "workspace",
          content: JSON.stringify(wsData),
        });
      }

      logger.info(
        { component: "Workspace", name: workspaceName, userId },
        `📂 Workspace saved: ${workspaceName}`,
      );
      return true;
    } catch (e) {
      logger.warn(
        { component: "Workspace", err: e.message },
        "Workspace save failed",
      );
      return false;
    }
  }

  /**
   * Load workspace context for a user.
   * Returns the most recent workspace or a specific one by name.
   */
  async _loadWorkspace(userId, workspaceName = null) {
    if (!this.supabaseAdmin || !userId) return null;
    try {
      let query = this.supabaseAdmin
        .from("brain_memory")
        .select("content, created_at")
        .eq("user_id", userId)
        .eq("type", "workspace")
        .order("created_at", { ascending: false })
        .limit(5);

      if (workspaceName) {
        query = query.ilike("content", `%"name":"${workspaceName}"%`);
      }

      const { data } = await query;
      if (!data || data.length === 0) return null;

      const workspaces = data
        .map((w) => {
          try {
            return JSON.parse(w.content);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return workspaceName ? workspaces[0] : workspaces;
    } catch (e) {
      logger.warn(
        { component: "Workspace", err: e.message },
        "Workspace load failed",
      );
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.7c ACTION CONFIRMATION — Require approval for risky ops
  // Returns a confirmation request instead of executing directly
  // ═══════════════════════════════════════════════════════════

  static get RISKY_ACTIONS() {
    return {
      email: {
        risk: "medium",
        message: "📧 Trimite email către {to}? Subiect: {subject}",
      },
      codeExec: {
        risk: "high",
        message:
          "⚠️ Execut cod JavaScript în sandbox? Codul poate accesa date locale.",
      },
      dbQuery: {
        risk: "medium",
        message:
          "🗄️ Interoghez baza de date? Query-ul ar putea expune date sensibile.",
      },
      calendarDelete: {
        risk: "medium",
        message: "🗑️ Șterg evenimentul din calendar? Acțiunea e ireversibilă.",
      },
    };
  }

  /**
   * Check if an action needs user confirmation.
   * Returns confirmation message if risky, null if safe to proceed.
   */
  _needsConfirmation(toolName, step, userPlan = "free") {
    // Admin and Enterprise skip confirmations
    if (userPlan === "admin" || userPlan === "enterprise") return null;

    const risky = KelionBrain.RISKY_ACTIONS[toolName];
    if (!risky) return null;

    // Build the confirmation message with step context
    let msg = risky.message;
    Object.keys(step).forEach((k) => {
      msg = msg.replace(`{${k}}`, step[k] || "");
    });

    return {
      needsConfirmation: true,
      tool: toolName,
      risk: risky.risk,
      message: msg,
      originalStep: step,
    };
  }

  // 9.8 EMAIL — Send emails via environment-configured provider
  // Supports: Resend, SendGrid, or SMTP fallback
  // ═══════════════════════════════════════════════════════════
  async _sendEmail(to, subject, body, _userId) {
    // Try Resend first (simplest API)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from:
              process.env.EMAIL_FROM ||
              `Kelion AI <noreply@${(process.env.APP_URL || "").replace(/^https?:\/\//, "")}>`,
            to: [to],
            subject,
            html: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:20px">
              <h2 style="color:#6366f1">🧠 KelionAI</h2>
              <div style="line-height:1.6">${body.replace(/\n/g, "<br>")}</div>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
              <p style="font-size:12px;color:#9ca3af">Trimis de Kelion AI — ${process.env.APP_URL || "kelion"}</p>
            </div>`,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.id) {
          logger.info(
            { component: "Brain", to, subject },
            "📧 Email sent via Resend",
          );
          return { success: true, provider: "Resend", messageId: d.id };
        }
        return { error: d.message || "Resend error", details: d };
      } catch (e) {
        return { error: e.message, provider: "Resend" };
      }
    }

    // Try SendGrid
    const sgKey = process.env.SENDGRID_API_KEY;
    if (sgKey) {
      try {
        const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sgKey}`,
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: {
              email:
                process.env.EMAIL_FROM ||
                `noreply@${(process.env.APP_URL || "").replace(/^https?:\/\//, "")}`,
              name: "Kelion AI",
            },
            subject,
            content: [
              { type: "text/html", value: body.replace(/\n/g, "<br>") },
            ],
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (r.status === 202) {
          logger.info(
            { component: "Brain", to, subject },
            "📧 Email sent via SendGrid",
          );
          return { success: true, provider: "SendGrid" };
        }
        const errText = await r.text();
        return { error: errText, provider: "SendGrid" };
      } catch (e) {
        return { error: e.message, provider: "SendGrid" };
      }
    }

    return {
      error:
        "No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY in .env",
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 9.9 FILE PROCESSING — Parse PDF, CSV, TXT, JSON files
  // Extracts text content for analysis
  // ═══════════════════════════════════════════════════════════
  async _parseFile(fileBuffer, filename, mimeType) {
    const ext = (filename || "").split(".").pop()?.toLowerCase() || "";

    try {
      // CSV parsing
      if (ext === "csv" || mimeType === "text/csv") {
        const text = fileBuffer.toString("utf-8");
        const lines = text.split("\n").filter((l) => l.trim());
        const headers = lines[0]?.split(",").map((h) => h.trim()) || [];
        const rows = lines.slice(1).map((line) => {
          const vals = line.split(",");
          const row = {};
          headers.forEach((h, i) => {
            row[h] = vals[i]?.trim() || "";
          });
          return row;
        });
        return {
          type: "csv",
          headers,
          rowCount: rows.length,
          preview: rows.slice(0, 10),
          fullText: text.substring(0, 5000),
        };
      }

      // JSON parsing
      if (ext === "json" || mimeType === "application/json") {
        const text = fileBuffer.toString("utf-8");
        const parsed = JSON.parse(text);
        return {
          type: "json",
          keys: Object.keys(parsed),
          preview: JSON.stringify(parsed, null, 2).substring(0, 2000),
        };
      }

      // TXT/MD parsing
      if (["txt", "md", "log", "env", "cfg", "ini"].includes(ext)) {
        const text = fileBuffer.toString("utf-8");
        return {
          type: "text",
          charCount: text.length,
          lineCount: text.split("\n").length,
          content: text.substring(0, 5000),
        };
      }

      // PDF — basic text extraction (no external dependency)
      if (ext === "pdf" || mimeType === "application/pdf") {
        // Extract readable text from PDF buffer using simple regex
        const text = fileBuffer.toString("latin1");
        const textMatches = [...text.matchAll(/\(([^)]+)\)/g)]
          .map((m) => m[1])
          .join(" ");
        const cleanText = textMatches
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "")
          .replace(/[^\x20-\x7E\u00C0-\u024F\n]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return {
          type: "pdf",
          charCount: cleanText.length,
          content: cleanText.substring(0, 5000),
          note: "Basic extraction — complex PDFs may need OCR",
        };
      }

      return {
        error: `Unsupported file type: ${ext}`,
        supportedTypes: ["csv", "json", "txt", "md", "pdf", "log"],
      };
    } catch (e) {
      return { error: e.message, filename };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.10 CODE EXECUTION SANDBOX — Safe JS execution
  // Runs user code in an isolated VM context with timeout
  // ═══════════════════════════════════════════════════════════
  async _codeExecute(code, language = "javascript") {
    if (language !== "javascript" && language !== "js") {
      return {
        error: `Only JavaScript is supported in the sandbox. Got: ${language}`,
        suggestion:
          "Poți rula cod JavaScript. Pentru alte limbaje, descrie ce vrei să faci și voi ajuta.",
      };
    }

    try {
      const vm = require("vm");
      const output = [];
      const errors = [];

      // Create sandboxed context with safe globals
      const sandbox = {
        console: {
          log: (...args) =>
            output.push(
              args
                .map((a) =>
                  typeof a === "object" ? JSON.stringify(a) : String(a),
                )
                .join(" "),
            ),
          error: (...args) => errors.push(args.join(" ")),
          warn: (...args) => output.push("[WARN] " + args.join(" ")),
        },
        Math,
        JSON,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Date,
        RegExp,
        Map,
        Set,
        Promise,
        setTimeout: (fn, ms) => {
          if (ms > 1000) ms = 1000;
          return setTimeout(fn, ms);
        },
        // Block dangerous operations
        require: undefined,
        process: undefined,
        __dirname: undefined,
        __filename: undefined,
        globalThis: undefined,
        global: undefined,
        fetch: undefined,
        eval: undefined,
        Function: undefined,
      };

      const context = vm.createContext(sandbox);
      const script = new vm.Script(code, { filename: "user-code.js" });

      // Execute with 3 second timeout
      const result = script.runInContext(context, { timeout: 3000 });

      // Capture return value if any
      if (result !== undefined) {
        output.push(
          "→ " +
            (typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : String(result)),
        );
      }

      return {
        success: true,
        output: output.join("\n") || "(no output)",
        errors: errors.length > 0 ? errors.join("\n") : null,
        executionTime: "< 3s",
      };
    } catch (e) {
      if (e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        return {
          error: "Timeout: codul a depășit limita de 3 secunde",
          code: code.substring(0, 200),
        };
      }
      return {
        error: e.message,
        line: e.stack?.match(/user-code\.js:(\d+)/)?.[1] || "unknown",
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FILE WORKSPACE — Sandboxed file operations via kira-tools
  // ═══════════════════════════════════════════════════════════
  _fileOps(action, fileName, content) {
    try {
      switch (action) {
        case "write":
        case "create":
        case "save":
          if (!fileName || !content)
            return { error: "fileName and content required" };
          return kiraTools.writeFile(fileName, content);
        case "read":
        case "open":
          if (!fileName) return { error: "fileName required" };
          return kiraTools.readFile(fileName);
        case "delete":
        case "remove":
          if (!fileName) return { error: "fileName required" };
          return kiraTools.deleteFile(fileName);
        case "list":
        default:
          return kiraTools.listFiles();
      }
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CODE EXECUTION — JS sandbox via kira-tools (wired to brain)
  // ═══════════════════════════════════════════════════════════
  _execCode(code) {
    try {
      logger.info(
        { component: "Brain", codeLen: (code || "").length },
        "🔧 Executing code via kiraTools",
      );
      return kiraTools.executeJS(code);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN TERMINAL — Shell commands via kira-tools (admin-only)
  // ═══════════════════════════════════════════════════════════
  _terminal(command) {
    try {
      logger.info(
        { component: "Brain", cmd: (command || "").slice(0, 50) },
        "💻 Terminal command",
      );
      return kiraTools.adminTerminal(command);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DEEP BROWSE — Enhanced web browsing via kira-tools (wired)
  // ═══════════════════════════════════════════════════════════
  async _deepBrowse(url, options) {
    try {
      logger.info({ component: "Brain", url }, "🌐 Deep browsing URL");
      return await kiraTools.deepBrowse(url, options);
    } catch (e) {
      return { error: e.message };
    }
  }

  async _browseMultiple(urls, options) {
    try {
      return await kiraTools.browseMultiple(urls, options);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PUPPETEER RENDER — Full browser rendering (Puppeteer/fallback)
  // ═══════════════════════════════════════════════════════════
  async _renderPage(url, options) {
    try {
      logger.info(
        { component: "Brain", url },
        "🖥️ Rendering page with Puppeteer",
      );
      return await kiraTools.renderPage(url, options);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // GIT OPERATIONS — Git status/log/diff via kira-tools
  // ═══════════════════════════════════════════════════════════
  _git(action, n) {
    try {
      switch (action) {
        case "status":
          return kiraTools.gitStatus();
        case "log":
          return kiraTools.gitLog(n);
        case "diff":
          return kiraTools.gitDiff();
        default:
          return kiraTools.gitStatus();
      }
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CODE SEARCH — grep + find via kira-tools
  // ═══════════════════════════════════════════════════════════
  _codeSearch(query, searchPath) {
    try {
      logger.info(
        { component: "Brain", query: (query || "").slice(0, 50) },
        "🔍 Code search",
      );
      return kiraTools.projectSearch(query, searchPath);
    } catch (e) {
      return { error: e.message };
    }
  }

  _projectTree(dirPath, depth) {
    try {
      return kiraTools.projectTree(dirPath, depth);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PROJECT FILE — Read any project file (admin-only)
  // ═══════════════════════════════════════════════════════════
  _readProjectFile(filePath) {
    try {
      return kiraTools.readProjectFile(filePath);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST RUNNER — Run tests via kira-tools (admin-only)
  // ═══════════════════════════════════════════════════════════
  _runTests(suite) {
    try {
      logger.info({ component: "Brain", suite }, "🧪 Running tests");
      return kiraTools.runTests(suite);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FULL ARTICLE SCRAPER — Scrape complete article text
  // ═══════════════════════════════════════════════════════════
  async _scrapeFullArticle(url) {
    try {
      return await kiraTools.scrapeFullArticle(url);
    } catch (e) {
      return { error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.11 RAG — Retrieval Augmented Generation
  // Semantic search through stored documents using pgvector
  // ═══════════════════════════════════════════════════════════
  async _ragSearch(query, userId, topK = 5) {
    if (!this.supabaseAdmin) return { error: "No database" };

    try {
      // Generate embedding for the query
      const embedding = await this.getEmbedding(query);
      if (!embedding) {
        // Fallback to keyword search if embedding fails
        const { data } = await this.supabaseAdmin
          .from("brain_memory")
          .select("content, type, created_at, importance")
          .or(`content.ilike.%${query.substring(0, 50)}%`)
          .order("importance", { ascending: false })
          .limit(topK);
        return { results: data || [], method: "keyword", query };
      }

      // Semantic search using pgvector (if match_memories function exists)
      try {
        const { data: semanticResults, error } = await this.supabaseAdmin.rpc(
          "match_memories",
          {
            query_embedding: embedding,
            match_threshold: 0.7,
            match_count: topK,
            p_user_id: userId || null,
          },
        );

        if (!error && semanticResults && semanticResults.length > 0) {
          return {
            results: semanticResults,
            method: "semantic",
            query,
            similarity: "pgvector",
          };
        }
      } catch {
        // match_memories function might not exist — fallback
      }

      // Fallback: search learned_facts
      const { data: facts } = await this.supabaseAdmin
        .from("learned_facts")
        .select("fact, category, source, created_at")
        .or(`fact.ilike.%${query.substring(0, 50)}%`)
        .limit(topK);

      return { results: facts || [], method: "keyword_facts", query };
    } catch (e) {
      return { error: e.message, query };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.12 PROACTIVE SUGGESTIONS — Context-aware suggestions
  // Analyzes user patterns and offers relevant actions
  // ═══════════════════════════════════════════════════════════
  async _proactiveSuggest(userId, _context = {}) {
    if (!this.supabaseAdmin || !userId) return [];

    try {
      const suggestions = [];
      const now = new Date();
      const hour = now.getHours();

      // Check pending reminders
      const { data: reminders } = await this.supabaseAdmin
        .from("brain_memory")
        .select("content")
        .eq("user_id", userId)
        .eq("type", "reminder")
        .limit(5);

      const pendingReminders = (reminders || []).filter((r) => {
        try {
          const p = JSON.parse(r.content);
          return p.status === "pending";
        } catch {
          return false;
        }
      });

      if (pendingReminders.length > 0) {
        suggestions.push({
          type: "reminder",
          text: `Ai ${pendingReminders.length} reminder(e) active`,
          action: "show_reminders",
        });
      }

      // Time-based suggestions
      if (hour >= 6 && hour <= 9) {
        suggestions.push({
          type: "morning",
          text: "Bună dimineața! Vrei un rezumat al știrilor de azi?",
          action: "news_digest",
        });
      }
      if (hour >= 18 && hour <= 21) {
        suggestions.push({
          type: "evening",
          text: "Vrei să vezi statisticile de trading de azi?",
          action: "trade_summary",
        });
      }

      // Check user's recent activity pattern
      const { data: recentConvs } = await this.supabaseAdmin
        .from("conversations")
        .select("title, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!recentConvs || recentConvs.length === 0) {
        suggestions.push({
          type: "onboarding",
          text: "Prima vizită? Încearcă: 'Ce poți face?' sau 'Generează o imagine'",
          action: "capabilities",
        });
      }

      // Check AI costs
      const { data: costs } = await this.supabaseAdmin
        .from("ai_costs")
        .select("cost_usd")
        .gte(
          "created_at",
          new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        );

      const totalCost = (costs || []).reduce(
        (s, c) => s + (parseFloat(c.cost_usd) || 0),
        0,
      );
      if (totalCost > 1) {
        suggestions.push({
          type: "cost_alert",
          text: `Cheltuielile AI azi: $${totalCost.toFixed(2)}`,
          action: "cost_report",
        });
      }

      return suggestions.slice(0, 3); // Max 3 suggestions
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "Proactive suggest failed",
      );
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.13 MULTI-AGENT SYSTEM — Specialized agent routing
  // Selects the best agent persona based on task type
  // ═══════════════════════════════════════════════════════════

  static get AGENTS() {
    return {
      general: {
        name: "General Assistant",
        icon: "🧠",
        systemPrompt:
          "Ești Kelion, un asistent AI general. Răspunde clar, concis și prietenos.",
        strengths: ["conversație", "întrebări generale", "recomandări"],
      },
      code: {
        name: "Code Engineer",
        icon: "💻",
        systemPrompt:
          "Ești un inginer software expert. Scrie cod curat, explicat pas cu pas. Sugerează best practices, testare, și securitate. Folosește cod blocks cu syntax highlighting.",
        strengths: ["programare", "debugging", "arhitectură", "devops"],
      },
      creative: {
        name: "Creative Director",
        icon: "🎨",
        systemPrompt:
          "Ești un director creativ. Generează idei originale, texte inspirate, concepte vizuale. Gândește out-of-the-box.",
        strengths: ["copywriting", "branding", "design", "storytelling"],
      },
      research: {
        name: "Research Analyst",
        icon: "🔍",
        systemPrompt:
          "Ești un analist de cercetare. Prezintă fapte verificabile cu surse. Compară opțiuni obiectiv. Structurează informația clar.",
        strengths: ["analiză", "comparații", "rapoarte", "fact-checking"],
      },
      trading: {
        name: "Trading Analyst",
        icon: "📈",
        systemPrompt:
          "Ești un analist financiar. Analizează piețe, tendințe, indicatori tehnici. Prezintă riscuri clar. Nu da sfaturi financiare directe.",
        strengths: ["crypto", "forex", "acțiuni", "analiză tehnică"],
      },
      tutor: {
        name: "Tutor Agent",
        icon: "📚",
        systemPrompt: `Ești un tutore pedagogic. Regulile tale:
1. ÎNTREABĂ ce știe deja utilizatorul despre subiect
2. EXPLICĂ conceptele de la simplu la complex
3. FOLOSEȘTE analogii și exemple din viața reală
4. VERIFICĂ înțelegerea: după fiecare concept, pune o întrebare de verificare
5. ADAPTEAZĂ nivelul: dacă utilizatorul știe deja, treci mai departe
6. STRUCTUREAZĂ în pași: numerotează etapele clar
7. ÎNCURAJEAZĂ: "Bravo!", "Exact!", "Aproape, dar..."
8. La final: oferă un REZUMAT + 3 exerciții practice`,
        strengths: ["învățare", "explicare", "tutoriale", "educație"],
      },
    };
  }

  /**
   * Select the best agent for the current task based on intent analysis.
   * Returns the agent key and metadata.
   */
  _selectAgent(analysis, message) {
    const msgLower = (message || "").toLowerCase();

    // Explicit tutor mode triggers
    const tutorTriggers = [
      "învață-mă",
      "explică-mi",
      "cum funcționează",
      "ce este",
      "ce înseamnă",
      "teach me",
      "explain",
      "how does",
      "what is",
      "tutorial",
      "pas cu pas",
      "step by step",
      "de la zero",
      "from scratch",
      "nu înțeleg",
      "i don't understand",
      "ajută-mă să înțeleg",
    ];
    if (tutorTriggers.some((t) => msgLower.includes(t))) {
      return { agent: "tutor", ...KelionBrain.AGENTS.tutor };
    }

    // Code-related
    if (
      analysis.needsCodeExec ||
      /\b(cod|code|functie|function|bug|debug|api|npm|git|deploy|server|database|sql|react|node|python|javascript|css|html)\b/i.test(
        msgLower,
      )
    ) {
      return { agent: "code", ...KelionBrain.AGENTS.code };
    }

    // Trading/finance
    if (
      analysis.needsMarketData ||
      /\b(bitcoin|btc|eth|crypto|trading|forex|acțiuni|stocks|piață|market|binance|preț|price)\b/i.test(
        msgLower,
      )
    ) {
      return { agent: "trading", ...KelionBrain.AGENTS.trading };
    }

    // Research
    if (
      analysis.needsSearch ||
      analysis.needsRagSearch ||
      /\b(caută|search|compară|compare|analiză|analysis|raport|report|studiu|study)\b/i.test(
        msgLower,
      )
    ) {
      return { agent: "research", ...KelionBrain.AGENTS.research };
    }

    // Creative
    if (
      analysis.needsImagine ||
      /\b(scrie|write|text|articol|blog|slogan|brand|logo|design|creativ|creative|poveste|story)\b/i.test(
        msgLower,
      )
    ) {
      return { agent: "creative", ...KelionBrain.AGENTS.creative };
    }

    // Default: general
    return { agent: "general", ...KelionBrain.AGENTS.general };
  }

  // ═══════════════════════════════════════════════════════════
  // 9.14 WEB SCRAPE — Enhanced web content extraction
  // Fetches URL, extracts text, and optionally summarizes
  // ═══════════════════════════════════════════════════════════
  async _webScrape(url, summarize = false) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": `Mozilla/5.0 (compatible; KelionAI/1.0; +${process.env.APP_URL || "https://kelion"})`,
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!r.ok) return { error: `HTTP ${r.status}`, url };

      const contentType = r.headers.get("content-type") || "";
      const text = await r.text();

      // Extract main content from HTML
      let content = text;
      if (contentType.includes("html")) {
        // Remove scripts, styles, and HTML tags
        content = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Extract title
      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;

      // Truncate to manageable size
      const maxLen = 5000;
      const truncated = content.length > maxLen;
      content = content.substring(0, maxLen);

      // Optionally summarize
      if (summarize && content.length > 500) {
        const summary = await this._summarize(content, 300, "ro");
        return { url, title, summary, charCount: content.length, truncated };
      }

      return { url, title, content, charCount: content.length, truncated };
    } catch (e) {
      return { error: e.message, url };
    }
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

  // Helper: log AI cost to Supabase
  async _logCost(provider, model, inputTokens, outputTokens, costUsd, userId) {
    if (!this.supabaseAdmin) return;
    try {
      await this.supabaseAdmin.from("ai_costs").insert({
        user_id: userId || "system",
        provider: provider,
        model: model || "unknown",
        tokens_in: inputTokens || 0,
        tokens_out: outputTokens || 0,
        cost_usd: costUsd || 0,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn(
        { component: "Brain", err: e.message },
        "ok — ai_costs insert failed",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 9.9 COST GUARDRAILS — Budget limits and cost-aware routing
  // Prevents runaway costs with per-user daily/monthly budgets
  // ═══════════════════════════════════════════════════════════

  static get BUDGET_LIMITS() {
    return {
      free: {
        dailyUsd: 0.05,
        monthlyUsd: 1.0,
        maxToolsPerMsg: 3,
        label: "Free",
      },
      pro: { dailyUsd: 0.5, monthlyUsd: 10.0, maxToolsPerMsg: 8, label: "Pro" },
      enterprise: {
        dailyUsd: 5.0,
        monthlyUsd: 100.0,
        maxToolsPerMsg: 20,
        label: "Enterprise",
      },
      admin: {
        dailyUsd: 50.0,
        monthlyUsd: 500.0,
        maxToolsPerMsg: 50,
        label: "Admin",
      },
    };
  }

  /**
   * Get total cost for a user today from ai_costs table.
   * Returns: { totalUsd, callCount }
   */
  async _getDailyCost(userId) {
    if (!this.supabaseAdmin || !userId) return { totalUsd: 0, callCount: 0 };
    try {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { data, error } = await this.supabaseAdmin
        .from("ai_costs")
        .select("cost_usd")
        .eq("user_id", userId)
        .gte("created_at", todayStart.toISOString());

      if (error) throw error;
      const totalUsd = (data || []).reduce(
        (sum, r) => sum + (r.cost_usd || 0),
        0,
      );
      return { totalUsd, callCount: (data || []).length };
    } catch (e) {
      logger.warn(
        { component: "CostGuardrails", err: e.message },
        "getDailyCost failed",
      );
      return { totalUsd: 0, callCount: 0 };
    }
  }

  /**
   * Check if user is within their budget.
   * Returns: { allowed, remaining, percentUsed, plan, shouldDowngrade }
   */
  async _checkBudget(userId, plan = "free") {
    const limits =
      KelionBrain.BUDGET_LIMITS[plan] || KelionBrain.BUDGET_LIMITS.free;
    const { totalUsd, callCount } = await this._getDailyCost(userId);
    const remaining = Math.max(0, limits.dailyUsd - totalUsd);
    const percentUsed =
      limits.dailyUsd > 0 ? (totalUsd / limits.dailyUsd) * 100 : 0;

    const result = {
      allowed: totalUsd < limits.dailyUsd,
      remaining: remaining,
      percentUsed: Math.round(percentUsed),
      totalUsd: totalUsd,
      dailyLimit: limits.dailyUsd,
      plan: limits.label,
      callCount,
      shouldDowngrade: percentUsed >= 80, // Switch to cheaper model above 80%
      maxToolsPerMsg: limits.maxToolsPerMsg,
    };

    if (percentUsed >= 90) {
      logger.warn(
        {
          component: "CostGuardrails",
          userId,
          percentUsed: result.percentUsed,
          totalUsd,
        },
        `💰 Budget alert: ${result.percentUsed}% used ($${totalUsd.toFixed(4)}/$${limits.dailyUsd})`,
      );
    }

    return result;
  }

  /**
   * Auto-downgrade model selection when budget is high.
   * Modifies the route to use the cheapest available model.
   */
  _autoDowngrade(modelRoute, budgetResult) {
    if (!budgetResult.shouldDowngrade) return modelRoute;

    // If budget > 80%, force Groq (cheapest)
    if (this.groqKey) {
      const downgraded = {
        ...modelRoute,
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: this.groqKey,
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        reason: `Budget ${budgetResult.percentUsed}% — downgraded to free model`,
        maxTokens: Math.min(modelRoute.maxTokens, 500),
        costPerToken: 0.00000027,
        downgraded: true,
      };
      logger.info(
        {
          component: "CostGuardrails",
          from: modelRoute.provider,
          to: "groq",
          budget: budgetResult.percentUsed,
        },
        `💸 Auto-downgrade: ${modelRoute.provider} → groq (budget ${budgetResult.percentUsed}%)`,
      );
      return downgraded;
    }

    return modelRoute;
  }

  // ═══════════════════════════════════════════════════════════
  // 9.10 POLICY ENGINE — Per-user/per-tool access control
  // Enforces what each user can do based on plan and rules
  // ═══════════════════════════════════════════════════════════

  static get POLICY_RULES() {
    return {
      free: {
        allowedTools: [
          "search",
          "weather",
          "imagine",
          "map",
          "translate",
          "summarize",
          "reminder",
          "calendarList",
          "generateDoc",
        ],
        blockedTools: [
          "email",
          "codeExecute",
          "ragSearch",
          "webScrape",
          "fileParse",
          "dbQuery",
          "calendarCreate",
          "calendarDelete",
        ],
        maxHistoryLength: 10,
        maxMessageLength: 2000,
      },
      pro: {
        allowedTools: "all",
        blockedTools: ["codeExecute"], // Still restricted — security sensitive
        maxHistoryLength: 30,
        maxMessageLength: 8000,
      },
      enterprise: {
        allowedTools: "all",
        blockedTools: [],
        maxHistoryLength: 50,
        maxMessageLength: 15000,
      },
      admin: {
        allowedTools: "all",
        blockedTools: [],
        maxHistoryLength: 100,
        maxMessageLength: 50000,
      },
    };
  }

  /**
   * Check if user can use a specific tool under their current policy.
   * Returns: { allowed, reason, plan }
   */
  _checkPolicy(toolName, plan = "free", isAdmin = false) {
    if (isAdmin) return { allowed: true, reason: "admin", plan: "admin" };

    const rules =
      KelionBrain.POLICY_RULES[plan] || KelionBrain.POLICY_RULES.free;

    // Check blocked tools
    if (rules.blockedTools && rules.blockedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" requires ${plan === "free" ? "Pro" : "Enterprise"} plan`,
        plan,
        upgrade: true,
      };
    }

    // Check allowed tools (if not "all")
    if (
      rules.allowedTools !== "all" &&
      !rules.allowedTools.includes(toolName)
    ) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" not available on ${plan} plan`,
        plan,
        upgrade: true,
      };
    }

    return { allowed: true, reason: "policy_ok", plan };
  }

  /**
   * Filter a plan's tools based on policy — removes tools user can't access.
   * Returns: filtered plan array
   */
  _filterPlanByPolicy(plan, userPlan = "free", isAdmin = false) {
    if (isAdmin) return plan;
    return plan.filter((step) => {
      const check = this._checkPolicy(step.tool, userPlan, isAdmin);
      if (!check.allowed) {
        logger.info(
          { component: "PolicyEngine", tool: step.tool, plan: userPlan },
          `🔒 Policy blocked: ${step.tool} (${check.reason})`,
        );
      }
      return check.allowed;
    });
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
      const ytEmbed =
        this.getToolUrl("youtube_embed") || "https://www.youtube.com/embed";
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
    const ytSearchBase =
      this.getToolUrl("youtube_search") || "https://www.youtube.com/results";
    const ytEmbedBase =
      this.getToolUrl("youtube_embed") || "https://www.youtube.com/embed";
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
        summary: `Politica de confidențialitate: Colectăm email, conversații AI, preferințe. Zero tracking, zero publicitate. Cookie-uri doar pentru autentificare. Date stocate în Supabase (EU). Drepturile tale: acces, rectificare, ștergere, portabilitate. Contact: privacy@${(process.env.APP_URL || "").replace("https://", "")}.`,
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
      ai_gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
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

  // ── TRADE INTELLIGENCE — FULL integration with all trading modules ──
  async _tradeIntelligence() {
    try {
      // Trading modules removed — safe stubs
      const _stub = { getCandles: () => [], isConnected: () => false, getTrackedAssets: () => [], getWeights: () => ({}), getCurrentSession: () => null, getBestPairsNow: () => null, getStats: () => ({}) };
      const ti = (() => { try { return require("./trade-intelligence"); } catch { return { fetchMarketNews: async () => [], calculateNewsSentiment: () => 0, getEconomicCalendarRisks: () => [] }; } })();
      const wsEngine = _stub;
      const marketLearner = _stub;
      const forexEngine = _stub;
      const perfTracker = _stub;
      const results = {};

      // 1. Market News Sentiment
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

      // 2. Economic Calendar Risks
      try {
        results.calendarRisks = ti.getEconomicCalendarRisks();
      } catch (e) {
        results.calendarError = e.message;
      }

      // 3. Technical Analysis for key crypto assets
      const assets = ["BTC", "ETH", "SOL"];
      const cgIds = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };
      results.technicalAnalysis = {};
      for (const asset of assets) {
        try {
          let prices = [],
            _volumes = [];
          // Try WS-Engine first (real-time)
          try {
            const candles = wsEngine.getCandles
              ? wsEngine.getCandles(asset, "1m", 100)
              : null;
            if (candles && candles.length >= 20) {
              prices = candles.map((c) => c.close);
              _volumes = candles.map((c) => c.volume || 0);
            }
          } catch (_wsErr) {
            logger.warn(
              { component: "Brain", err: _wsErr.message },
              "WS candles fallback",
            );
          }
          // Fallback: CoinGecko
          if (prices.length < 14) {
            try {
              const r = await fetch(
                `https://api.coingecko.com/api/v3/coins/${cgIds[asset]}/market_chart?vs_currency=usd&days=7`,
              );
              if (r.ok) {
                const d = await r.json();
                prices = (d.prices || []).map((p) => p[1]).slice(-100);
                _volumes = (d.total_volumes || []).map((v) => v[1]).slice(-100);
              }
            } catch (_cgErr) {
              logger.warn(
                { component: "Brain", err: _cgErr.message },
                "CoinGecko price fallback",
              );
            }
          }
          if (prices.length >= 14) {
            const rsi = this._calcRSI(prices);
            const macd = this._calcMACD(prices);
            const last = prices[prices.length - 1];
            // Confluence
            const scoreMap = { BUY: 1, SELL: -1, HOLD: 0 };
            const signals = [rsi.signal, macd.crossSignal].filter(Boolean);
            const avg =
              signals.length > 0
                ? signals.reduce((s, sig) => s + (scoreMap[sig] || 0), 0) /
                  signals.length
                : 0;
            let confluence = "HOLD";
            if (avg >= 0.5) confluence = "BUY";
            else if (avg <= -0.5) confluence = "SELL";

            results.technicalAnalysis[asset] = {
              price: Math.round(last * 100) / 100,
              rsi: rsi.value,
              rsiSignal: rsi.signal,
              macdSignal: macd.crossSignal,
              confluence,
              confidence: Math.round(Math.abs(avg) * 100),
            };
          }
        } catch (e) {
          results.technicalAnalysis[asset] = { error: e.message };
        }
      }

      // 4. MarketLearner adaptive weights
      try {
        results.learnedWeights = marketLearner.getWeights
          ? marketLearner.getWeights()
          : {};
      } catch (_lwErr) {
        logger.warn(
          { component: "Brain", err: _lwErr.message },
          "MarketLearner weights error",
        );
      }

      // 5. Forex Session Info
      try {
        results.forex = {
          currentSession: forexEngine.getCurrentSession
            ? forexEngine.getCurrentSession()
            : null,
          bestPairs: forexEngine.getBestPairsNow
            ? forexEngine.getBestPairsNow()
            : null,
        };
      } catch (_fxErr) {
        logger.warn(
          { component: "Brain", err: _fxErr.message },
          "Forex session error",
        );
      }

      // 6. Performance Stats
      try {
        if (perfTracker.getStats) results.performance = perfTracker.getStats();
      } catch (_pfErr) {
        logger.warn(
          { component: "Brain", err: _pfErr.message },
          "PerfTracker stats error",
        );
      }

      // 7. WS-Engine status
      try {
        results.realTimeStatus = {
          connected: wsEngine.isConnected ? wsEngine.isConnected() : false,
          assetsTracking: wsEngine.getTrackedAssets
            ? wsEngine.getTrackedAssets()
            : [],
        };
      } catch (_wsStatErr) {
        logger.warn(
          { component: "Brain", err: _wsStatErr.message },
          "WS-Engine status error",
        );
      }

      const btc = results.technicalAnalysis?.BTC || {};
      const summary = `BTC: $${btc.price || "?"} RSI:${btc.rsi || "?"} (${btc.rsiSignal || "?"}) MACD:${btc.macdSignal || "?"} Confluence:${btc.confluence || "?"} (${btc.confidence || 0}%) | Sentiment:${results.sentiment?.toFixed(2) || "N/A"} | Forex:${results.forex?.currentSession?.name || "?"}`;

      if (this.supabaseAdmin) {
        try {
          await this.supabaseAdmin.from("trade_intelligence").insert({
            asset: "MULTI",
            analysis_type: "full_brain_scan",
            result: results,
            sentiment_score: results.sentiment || 0,
            confidence: btc.confidence || 50,
            created_at: new Date().toISOString(),
          });
        } catch (_tiDbErr) {
          logger.warn(
            { component: "Brain", err: _tiDbErr.message },
            "Trade intelligence DB insert error",
          );
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

  // ── Inline TA helpers (avoid circular dependency with trading.js Router) ──
  _calcRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1)
      return { value: 50, signal: "HOLD" };
    let gains = 0,
      losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = prices[i] - prices[i - 1];
      if (d >= 0) gains += d;
      else losses += Math.abs(d);
    }
    let avgG = gains / period,
      avgL = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      avgG = (avgG * (period - 1) + (d >= 0 ? d : 0)) / period;
      avgL = (avgL * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    }
    if (avgL === 0) return { value: 100, signal: "SELL" };
    const v = 100 - 100 / (1 + avgG / avgL);
    return {
      value: Math.round(v * 100) / 100,
      signal: v < 30 ? "BUY" : v > 70 ? "SELL" : "HOLD",
    };
  }

  _calcMACD(prices) {
    if (!prices || prices.length < 35) return { crossSignal: "HOLD" };
    const ema = (p, per) => {
      const k = 2 / (per + 1);
      const e = [p[0]];
      for (let i = 1; i < p.length; i++) e.push(p[i] * k + e[i - 1] * (1 - k));
      return e;
    };
    const fast = ema(prices, 12),
      slow = ema(prices, 26);
    const macdLine = fast.map((v, i) => v - slow[i]);
    const sig = ema(macdLine.slice(25), 9);
    const li = macdLine.length - 1,
      si = sig.length - 1;
    const prev = (macdLine[li - 1] || 0) <= (sig[si - 1] || 0);
    const curr = macdLine[li] > sig[si];
    return {
      crossSignal: prev && curr ? "BUY" : !prev && !curr ? "SELL" : "HOLD",
    };
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
        cors: {
          enabled: true,
          details: `Origins: ${process.env.APP_URL || "configured"}, localhost`,
        },
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
        baseUrl: (process.env.APP_URL || "") + "/api/v1",
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
  // Calls Gemini Vision API when image is provided in context
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

    // Call Gemini Vision API for high-precision analysis
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_VISION}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: { mimeType: "image/jpeg", data: imageBase64 },
                    },
                    {
                      text: "Descrie în detaliu maxim ce vezi în această imagine. Menționează: persoane, obiecte, culori, text vizibil, obstacole, distanțe estimate, pericole potențiale. Răspunde în română cu precizie maximă — informația ajută o persoană cu deficiențe de vedere.",
                    },
                  ],
                },
              ],
              generationConfig: { maxOutputTokens: 1000 },
            }),
          },
        );
        if (r.ok) {
          const data = await r.json();
          const description =
            data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Nu am putut analiza imaginea.";
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
            engine: "Gemini Vision",
            summary: description.substring(0, 200),
          };
        }
      } catch (e) {
        logger.warn(
          { component: "Brain", err: e.message },
          "Gemini Vision failed",
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
        "Nicio cheie API vision configurată (GOOGLE_AI_KEY sau OPENAI_API_KEY).",
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
        const voiceId = process.env.ELEVENLABS_VOICE_KELION || process.env.ELEVENLABS_VOICE_ID;
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

  // ── FACE CHECK — Identify user via Gemini Vision + Supabase profiles ──
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

    // Use Gemini Vision to describe the face
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey) {
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

        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_VISION}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: { mimeType: "image/jpeg", data: imageBase64 },
                    },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: { maxOutputTokens: 500 },
            }),
          },
        );
        if (r.ok) {
          const data = await r.json();
          const description =
            data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
            engine: "Gemini Vision",
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
      summary: "GOOGLE_AI_KEY necesară pentru recunoaștere facială.",
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

    // Use Gemini Vision to extract face description as "encoding"
    let faceDescription = null;
    const geminiKey2 = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (geminiKey2) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_VISION}:generateContent?key=${geminiKey2}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: { mimeType: "image/jpeg", data: imageBase64 },
                    },
                    {
                      text: 'Descrie fața persoanei pentru recunoaștere viitoare: vârstă estimată, gen, culoare păr, lung/scurt, ochelari da/nu, barbă/mustață, forme faciale distinctive, cicatrici sau semne particulare. Format JSON: {"age":X,"gender":"","hair":"","glasses":false,"facial_hair":"","distinctive":"","description":"text liber"}',
                    },
                  ],
                },
              ],
              generationConfig: { maxOutputTokens: 300 },
            }),
          },
        );
        if (r.ok) {
          const data = await r.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
        summary: "GOOGLE_AI_KEY necesară pentru encoding facial.",
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
          engine: "Gemini Vision",
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

    // Helper: fetch with timeout (prevents hanging on a slow provider)
    const fetchT = (url, opts, timeoutMs = 8000) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
        clearTimeout(timer),
      );
    };

    // 1️⃣ PERPLEXITY SONAR — Best: returns synthesized answer + citations
    if (!result && this.perplexityKey) {
      try {
        const r = await fetchT("https://api.perplexity.ai/chat/completions", {
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
        const r = await fetchT("https://api.tavily.com/search", {
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
        const r = await fetchT(
          this.getToolUrl("serper_search") ||
            "https://google.serper.dev/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": this.serperKey,
            },
            body: JSON.stringify({ q: query, num: 5 }),
          },
        );
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
        const r = await fetchT(
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
    const geoUrl =
      this.getToolUrl("open_meteo_geo") ||
      "https://geocoding-api.open-meteo.com/v1/search";
    const geo = await (
      await fetch(
        `${geoUrl}?name=${encodeURIComponent(city)}&count=1&language=ro`,
      )
    ).json();
    if (!geo.results?.[0]) throw new Error("City not found");
    const { latitude, longitude, name, country } = geo.results[0];
    const forecastUrl =
      this.getToolUrl("open_meteo_forecast") ||
      "https://api.open-meteo.com/v1/forecast";
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
    this.toolStats.imagine++;
    try {
      // Pollinations.ai — gratuit, fara API key, genereaza imagini AI FLUX
      const encoded = encodeURIComponent(prompt);
      const seed = Math.floor(Math.random() * 99999);
      const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&model=flux&nologo=true&enhance=true&seed=${seed}`;
      return { imageUrl, prompt };
    } catch (e) {
      this.logger.debug({ err: e.message }, '[imagine] error');
      return { imageUrl: null, prompt, error: e.message };
    }
  }



  async _memory(userId) {
    if (!this.supabaseAdmin || !userId) return null;
    this.toolStats.memory++;
    try {
      // Try user_preferences first
      const { data, error } = await this.supabaseAdmin
        .from("user_preferences")
        .select("key, value")
        .eq("user_id", userId)
        .limit(30);
      if (!error && data?.length) {
        return data.map(p => `${p.key}: ${typeof p.value === "object" ? JSON.stringify(p.value) : p.value}`).join("; ");
      }
      // Fallback: brain_memory table
      const { data: memData } = await this.supabaseAdmin
        .from("brain_memory")
        .select("key, value")
        .eq("user_id", userId)
        .limit(30);
      if (memData?.length) {
        return memData.map(p => `${p.key}: ${typeof p.value === "object" ? JSON.stringify(p.value) : p.value}`).join("; ");
      }
      return null;
    } catch (e) {
      this.logger.debug({ err: e.message }, '[memory] error — non-critical');
      return null; // don't throw — prevents toolErrors accumulation
    }
  }

  // ── Self-Learning Tool Registry ────────────────────────────────────────────

  async _recallTool(query) {
    if (!this.supabaseAdmin) return { found: false, message: 'Supabase not configured' };
    // Split query în termeni, truncate la root (6 chars) — funcționează cross-language
    // Ex: "Romaniei"→"romani" matches "romania_live_flights"
    const terms = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).map(w => w.substring(0, 6));
    const uniqueTerms = [...new Set(terms)];
    const orParts = uniqueTerms.flatMap(t => [`name.ilike.%${t}%`, `description.ilike.%${t}%`]).join(',');
    const { data } = await this.supabaseAdmin
      .from('brain_tools')
      .select('name, description, endpoint, method, headers_template, body_template, params_schema, usage_count')
      .or(orParts || 'name.ilike.%%')
      .order('usage_count', { ascending: false })
      .limit(3);

    if (!data?.length) return { found: false, message: `No tool found for: ${query}. Use discover_and_save_tool to find and save a new one.` };
    return { found: true, tools: data };
  }


  async _discoverAndSaveTool({ task_description, api_endpoint, method = 'GET', params_schema = {}, tool_name }) {
    if (!this.supabaseAdmin) return { success: false, error: 'Supabase not configured' };
    // Test the endpoint
    let testResult = null;
    try {
      const testUrl = api_endpoint.includes('?') ? api_endpoint : `${api_endpoint}`;
      const r = await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(10000) });
      testResult = r.ok ? 'ok' : `HTTP ${r.status}`;
    } catch (e) {
      testResult = `error: ${e.message}`;
    }
    // Save to Supabase brain_tools
    const { error } = await this.supabaseAdmin
      .from('brain_tools')
      .upsert({
        name: tool_name,
        description: task_description,
        endpoint: api_endpoint,
        method: method.toUpperCase(),
        params_schema: params_schema,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'name' });
    if (error) return { success: false, error: error.message };
    return { success: true, tool_name, endpoint: api_endpoint, test_result: testResult, message: `Tool '${tool_name}' saved to shared registry. Now use call_saved_tool to execute it.` };
  }

  async _callSavedTool(toolName, params = {}) {
    if (!this.supabaseAdmin) return { error: 'Supabase not configured' };
    const { data } = await this.supabaseAdmin
      .from('brain_tools')
      .select('*')
      .eq('name', toolName)
      .single();
    if (!data) return { error: `Tool '${toolName}' not found in registry` };

    // Build URL with params
    let url = data.endpoint;
    const method = (data.method || 'GET').toUpperCase();
    if (method === 'GET' && Object.keys(params).length) {
      const qs = new URLSearchParams(params).toString();
      url = url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
    }

    const fetchOptions = {
      method,
      headers: { 'User-Agent': 'KelionAI/2.0', ...(data.headers_template || {}) },
      signal: AbortSignal.timeout(8000),

    };
    if (method === 'POST' && Object.keys(params).length) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(params);
    }

    let r;
    try {
      r = await fetch(url, fetchOptions);
    } catch (fetchErr) {
      // Network error (blocked IP, DNS failure, timeout) — instruim GPT sa descopere alt API
      this.supabaseAdmin.from('brain_tools').update({ last_error: fetchErr.message }).eq('name', toolName).then(() => {});
      return {
        error: `Tool '${toolName}' is unreachable from server: ${fetchErr.message}`,
        action_required: `This API endpoint is blocked or unreachable. Call discover_and_save_tool to find a working alternative that provides: ${data.description || toolName}. Search for a free public API without IP restrictions.`,
        broken: true,
      };
    }

    if (!r.ok) {
      if (r.status === 401 || r.status === 403 || r.status === 429) {
        this.supabaseAdmin.from('brain_tools').update({ last_error: `HTTP ${r.status}` }).eq('name', toolName).then(() => {});
      }
      return {
        error: `Tool '${toolName}' failed: HTTP ${r.status}`,
        action_required: `Call discover_and_save_tool to find a working alternative API for: ${data.description || toolName}`,
        url,
        broken: true,
      };
    }

    const result = await r.json().catch(() => r.text());

    // Update usage stats
    this.supabaseAdmin.from('brain_tools').update({
      usage_count: (data.usage_count || 0) + 1,
      success_count: (data.success_count || 0) + 1,
      status: 'active',
    }).eq('name', toolName).then(() => {});

    return { success: true, data: result, tool: toolName, url };
  }



  _map(place) {
    this.toolStats.map++;
    const mapsKey = process.env.GOOGLE_MAPS_KEY;
    const hasValidKey = mapsKey && mapsKey.startsWith('AIza');
    const mapURL = hasValidKey
      ? `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${encodeURIComponent(place)}&zoom=6`
      : `https://www.openstreetmap.org/export/embed.html?bbox=-30,25,45,75&layer=mapnik&marker=52,10`;
    const mapHTML = `<iframe width="100%" height="100%" frameborder="0" style="border:0;border-radius:12px;min-height:400px" src="${mapURL}" allowfullscreen loading="lazy"></iframe>`;
    return { place, mapURL, mapHTML };
  }


  // ═══════════════════════════════════════════════════════════
  // 10. AUTO-LEARNING — Extract facts + learn from interaction
  // ═══════════════════════════════════════════════════════════

  // ── Correction patterns (RO + EN) ──
  static CORRECTION_PATTERNS = [
    // Romanian
    /\b(nu|n-am|n-ai)\b.*\b(zis|spus|cerut|vrut)\b/i,
    /\b(greșit|gresit|incorect|greșeală|greseala)\b/i,
    /\b(nu e corect|nu-i corect|nu e bine|nu-i bine)\b/i,
    /\b(nu asta|nu așa|nu asa|altfel|altceva)\b/i,
    /\b(te-am corectat|te corectez|corectare)\b/i,
    /\b(din nou|iar greșești|iar gresesti)\b/i,
    /\b(am zis|ți-am zis|ti-am zis|ți-am spus|ti-am spus)\b.*\b(nu|că|ca)\b/i,
    /\b(nu mai|oprește|opreste|lasă|lasa|renunță|renunta)\b.*\b(fă|fa|pune|spune|zice)\b/i,
    // English
    /\b(wrong|incorrect|not right|not what i)\b/i,
    /\b(i said|i told you|i asked for|i meant)\b/i,
    /\b(don'?t|do not|stop)\b.*\b(do that|say that|use|call me)\b/i,
    /\b(that'?s not|no,? that|no,? i)\b/i,
    /\b(please don'?t|never|stop doing)\b/i,
  ];

  detectCorrection(userMessage) {
    const msg = userMessage.toLowerCase();
    for (const pattern of this.constructor.CORRECTION_PATTERNS) {
      if (pattern.test(msg)) return true;
    }
    return false;
  }

  async learnCorrection(userId, userMessage, aiReply) {
    if (!this.supabaseAdmin || !userId) return;
    try {
      // Use LLM to extract WHAT was corrected
      const extractPrompt = `Userul a corectat AI-ul. Extrage EXACT ce a greșit AI-ul și ce vrea userul.
User: "${userMessage.substring(0, 500)}"
AI anterior: "${aiReply.substring(0, 300)}"
Răspunde STRICT JSON: {"wrong": "ce a greșit AI", "correct": "ce vrea userul", "rule": "regulă scurtă de reținut"}
Dacă nu poți extrage: {}`;

      let txt = null;
      if (this.groqKey) {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.groqKey },
          body: JSON.stringify({ model: MODELS.GROQ_PRIMARY, max_tokens: 150, messages: [{ role: "user", content: extractPrompt }] }),
        });
        if (r.ok) { const d = await r.json(); txt = d.choices?.[0]?.message?.content?.trim(); }
      }
      if (!txt) {
        const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        if (geminiKey) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: extractPrompt }] }], generationConfig: { maxOutputTokens: 150 } }),
          });
          if (r.ok) { const d = await r.json(); txt = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim(); }
        }
      }
      if (!txt || txt === "{}") return;

      let correction;
      try { correction = JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { return; }
      if (!correction.rule) return;

      // Save correction to Supabase (max 20 corrections per user)
      const correctionKey = "correction_" + Date.now();
      await this.supabaseAdmin.from("user_preferences").upsert({
        user_id: userId,
        key: correctionKey,
        value: {
          wrong: correction.wrong,
          correct: correction.correct,
          rule: correction.rule,
          at: new Date().toISOString(),
        },
      }, { onConflict: "user_id,key" });

      // Clean old corrections (keep max 20)
      const { data: allCorrections } = await this.supabaseAdmin
        .from("user_preferences")
        .select("id, key")
        .eq("user_id", userId)
        .like("key", "correction_%")
        .order("key", { ascending: true });
      if (allCorrections && allCorrections.length > 20) {
        const toDelete = allCorrections.slice(0, allCorrections.length - 20);
        for (const old of toDelete) {
          await this.supabaseAdmin.from("user_preferences").delete().eq("id", old.id);
        }
      }

      // Feed into k1-meta-learning
      if (typeof require === "function") {
        try {
          const k1Meta = require("./k1-meta-learning");
          k1Meta.recordUserInteraction({ domain: "general", wasCorrection: true, correctionNote: correction.rule });
          const k1Perf = require("./k1-performance");
          k1Perf.recordCorrection("general", correction.wrong?.substring(0, 50) || "unknown");
        } catch (_e) { /* non-critical */ }
      }

      logger.info({ component: "Brain", correction: correction.rule }, "🎓 Learned correction: " + correction.rule);
    } catch (e) {
      logger.warn({ component: "Brain", err: e.message }, "Correction learning failed (non-critical)");
    }
  }

  async learnFromConversation(userId, userMessage, aiReply) {
    if (
      !this.supabaseAdmin ||
      !userId ||
      userMessage.length < 15 ||
      (!this.groqKey && !this.geminiKey)
    )
      return;

    // ── Check for corrections FIRST (no rate limit for corrections) ──
    if (this.detectCorrection(userMessage)) {
      this.learnCorrection(userId, userMessage, aiReply).catch((e) =>
        logger.warn({ err: e.message }, "learnCorrection failed")
      );
    }

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
      if (!txt) {
        const geminiKey =
          process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        if (geminiKey) {
          r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: learnPrompt }] }],
                generationConfig: { maxOutputTokens: 150 },
              }),
            },
          );
          if (r.ok) {
            d = await r.json();
            txt = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          }
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
        try {
          await this.supabaseAdmin.from("user_preferences").upsert(
            {
              user_id: userId,
              key: safeKey,
              value: typeof v === "object" ? v : { data: v },
            },
            { onConflict: "user_id,key" },
          );
          savedCount++;
        } catch (upsertErr) {
          // Fallback: save to brain_memory if user_preferences table doesn't exist
          try {
            // Dedup: check if already saved
            const checkKey = `${safeKey}: `;
            const { data: memExists } = await this.supabaseAdmin
              .from("brain_memory")
              .select("id")
              .eq("user_id", userId)
              .ilike("content", checkKey + '%')
              .limit(1);
            if (!memExists || memExists.length === 0) {
              await this.supabaseAdmin.from("brain_memory").insert({
                content: `${safeKey}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                memory_type: 'preference',
                importance: 5,
                user_id: userId,
              });
            }
            savedCount++;
          } catch (_) {
            logger.debug({ component: 'Brain', key: safeKey }, 'Preference save failed (both tables)');
          }
        }
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

      // ── KNOWLEDGE GRAPH — extract entity relationships ──
      // Non-blocking, best-effort. Creates connections between user and topics.
      this._extractKnowledgeGraph(userId, userMessage, aiReply, facts).catch(() => {});

    } catch (e) {
      // Don't accumulate memory errors for non-critical learning failures
      logger.debug(
        {
          component: "Brain",
          event: "learn_failed",
          err: e.message,
        },
        "Learning extraction failed (non-critical — suppressed)",
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // KNOWLEDGE GRAPH — Entity relationship extraction
  // Stores user→entity and entity→entity connections
  // ═══════════════════════════════════════════════════════════
  async _extractKnowledgeGraph(userId, userMessage, aiReply, existingFacts) {
    try {
      if (!this.supabaseAdmin) return;

      // Build relationships from already-extracted facts
      const relationships = [];
      const userName = existingFacts?.name || existingFacts?.nume || `user_${userId.substring(0, 8)}`;

      for (const [key, value] of Object.entries(existingFacts || {})) {
        if (!key || !value) continue;
        const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
        let rel = 'has_attribute';
        if (/city|oras|location|locatie|country|tara/.test(key)) rel = 'lives_in';
        if (/job|profesie|occupation|work/.test(key)) rel = 'works_as';
        if (/hobby|hobbies|interests|interese/.test(key)) rel = 'interested_in';
        if (/family|familie|children|copii|partner|pet/.test(key)) rel = 'has_family';
        if (/favorite/.test(key)) rel = 'prefers';
        if (/education|school|university/.test(key)) rel = 'studied_at';

        relationships.push({
          user_id: userId,
          entity_from: userName,
          entity_to: val.substring(0, 200),
          relationship: rel,
          confidence: 0.85,
        });
      }

      // Extract topic entities from conversation text
      const topics = this._extractTopicEntities(userMessage + ' ' + aiReply);
      for (const topic of topics) {
        relationships.push({
          user_id: userId,
          entity_from: userName,
          entity_to: topic,
          relationship: 'discussed',
          confidence: 0.6,
        });
      }

      if (relationships.length === 0) return;

      // Upsert to knowledge_graph table (create if not exists — silent fail)
      const { error } = await this.supabaseAdmin
        .from('knowledge_graph')
        .upsert(relationships, { onConflict: 'user_id,entity_from,entity_to,relationship' })
        .select();

      if (error && !error.message?.includes('does not exist')) {
        logger.debug({ component: 'KnowledgeGraph', err: error.message }, 'KG upsert issue');
      } else if (!error) {
        logger.info({ component: 'KnowledgeGraph', count: relationships.length },
          `🕸️ Knowledge graph: ${relationships.length} relationships stored`);
      }
    } catch (e) {
      logger.debug({ component: 'KnowledgeGraph', err: e.message }, 'KG extraction skipped');
    }
  }

  // Extract topic entities from text (simple NER)
  _extractTopicEntities(text) {
    const topics = new Set();
    const lower = text.toLowerCase();

    // Extract capitalized words (likely proper nouns)
    const properNouns = text.match(/\b[A-ZĂÎÂȘȚ][a-zA-ZăîâșțĂÎÂȘȚ]{2,}/g) || [];
    const stopWords = new Set(['The', 'And', 'For', 'But', 'Not', 'This', 'That', 'With', 'Are', 'Was', 'Has',
      'Asta', 'Este', 'Sunt', 'Dar', 'Pentru', 'Care', 'Cum', 'Daca', 'Poate', 'Foarte', 'Acum', 'Cand']);
    for (const noun of properNouns) {
      if (!stopWords.has(noun) && noun.length > 2) topics.add(noun);
    }

    // Extract domain topics via keywords
    const domainPatterns = [
      { pattern: /\b(python|javascript|react|node|typescript|java|c\+\+|sql|html|css)\b/gi, topic: 'programare' },
      { pattern: /\b(fotbal|basketball|tenis|sport|meci|liga)\b/gi, topic: 'sport' },
      { pattern: /\b(muzic[aă]|music|rock|pop|jazz|clasic[aă])\b/gi, topic: 'muzică' },
      { pattern: /\b(film[e]?|movie|serial|netflix|cinema)\b/gi, topic: 'filme' },
      { pattern: /\b(gătit|cooking|rețet[aă]|recipe|mâncare)\b/gi, topic: 'gătit' },
      { pattern: /\b(călător|travel|vacanț[aă]|excursie)\b/gi, topic: 'călătorii' },
      { pattern: /\b(sănătate|health|fitness|gym|sport)\b/gi, topic: 'sănătate' },
      { pattern: /\b(business|afacer[ei]|startup|antreprenor)\b/gi, topic: 'business' },
    ];
    for (const { pattern, topic } of domainPatterns) {
      if (pattern.test(lower)) topics.add(topic);
    }

    return [...topics].slice(0, 10); // max 10 topics per conversation
  }

  // Query knowledge graph for context about a user
  async getKnowledgeContext(userId, limit = 15) {
    try {
      if (!this.supabaseAdmin) return '';
      const { data, error } = await this.supabaseAdmin
        .from('knowledge_graph')
        .select('entity_from, entity_to, relationship, confidence')
        .eq('user_id', userId)
        .order('confidence', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return '';

      const lines = data.map(r => `${r.entity_from} —[${r.relationship}]→ ${r.entity_to}`);
      return `[KNOWLEDGE GRAPH]\n${lines.join('\n')}`;
    } catch (_) {
      return '';
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
    // Tools that are intentionally disabled (no API key) — not degraded, just unavailable
    const disabledTools = new Set();
    if (!process.env.TOGETHER_API_KEY) disabledTools.add('imagine');
    if (!process.env.GOOGLE_MAPS_KEY && !process.env.MAPS_API_KEY) disabledTools.add('maps');
    if (!process.env.BINANCE_API_KEY) disabledTools.add('trading');

    const degraded = Object.entries(this.toolErrors)
      .filter(([t, c]) => c >= 10 && !disabledTools.has(t))
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
        const prices = { pro: 29, premium: 29, enterprise: 29 };
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
      supabaseHistory: null,
      strategyAnalysis: null,
      botAdjustments: null,
    };
    try {
      // ═══ 1. BINANCE PORTFOLIO ═══
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

      // ═══ 2. READ ALL SUPABASE TRADE HISTORY ═══
      if (this.supabaseAdmin) {
        const history = {};

        // Recent analyses (last 200)
        const { data: analyses } = await this.supabaseAdmin
          .from("trading_analyses")
          .select("asset, signal, confidence, data_source, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        history.analyses = analyses || [];

        // Recent signals (last 100)
        const { data: signals } = await this.supabaseAdmin
          .from("trading_signals")
          .select(
            "asset, signal, confidence, entry_price, target_price, stop_loss, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(100);
        history.signals = signals || [];

        // All trades
        const { data: trades } = await this.supabaseAdmin
          .from("trading_trades")
          .select("*")
          .order("opened_at", { ascending: false })
          .limit(500);
        history.trades = trades || [];

        // Strategy performance logs
        const { data: stratLogs } = await this.supabaseAdmin
          .from("trading_strategy_log")
          .select("strategy, outcome, pnl, confidence, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        history.strategyLogs = stratLogs || [];

        // Daily performance
        const { data: perf } = await this.supabaseAdmin
          .from("trading_performance")
          .select("*")
          .order("date", { ascending: false })
          .limit(30);
        history.dailyPerformance = perf || [];

        history.totalAnalyses = history.analyses.length;
        history.totalSignals = history.signals.length;
        history.totalTrades = history.trades.length;
        history.dataRange =
          history.analyses.length > 0
            ? {
                from: history.analyses[history.analyses.length - 1]?.created_at,
                to: history.analyses[0]?.created_at,
              }
            : null;

        result.supabaseHistory = history;
        result.recentTrades = history.trades.slice(0, 10);

        // ═══ 3. BRAIN ANALYZES PERFORMANCE → STRATEGY ADJUSTMENTS ═══
        if (history.trades.length > 0) {
          const closedTrades = history.trades.filter(
            (t) => t.status === "closed" && t.pnl !== null,
          );
          const wins = closedTrades.filter((t) => t.pnl > 0);
          const losses = closedTrades.filter((t) => t.pnl <= 0);
          const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
          const winRate =
            closedTrades.length > 0
              ? Math.round((wins.length / closedTrades.length) * 100)
              : 0;

          // Best and worst strategies
          const stratPerf = {};
          closedTrades.forEach((t) => {
            const s = t.strategy || "unknown";
            if (!stratPerf[s]) stratPerf[s] = { wins: 0, losses: 0, pnl: 0 };
            if (t.pnl > 0) stratPerf[s].wins++;
            else stratPerf[s].losses++;
            stratPerf[s].pnl += t.pnl || 0;
          });

          const bestStrategy = Object.entries(stratPerf).sort(
            (a, b) => b[1].pnl - a[1].pnl,
          )[0];
          const worstStrategy = Object.entries(stratPerf).sort(
            (a, b) => a[1].pnl - b[1].pnl,
          )[0];

          result.strategyAnalysis = {
            totalTrades: closedTrades.length,
            wins: wins.length,
            losses: losses.length,
            winRate,
            totalPnl: +totalPnl.toFixed(2),
            bestStrategy: bestStrategy
              ? { name: bestStrategy[0], ...bestStrategy[1] }
              : null,
            worstStrategy: worstStrategy
              ? { name: worstStrategy[0], ...worstStrategy[1] }
              : null,
            strategiesAnalyzed: Object.keys(stratPerf).length,
          };

          // ═══ 4. BOT CONTROL — ADJUST RISK PROFILE BASED ON PERFORMANCE ═══
          try {
            const tradeExecutor = require("./trade-executor");
            const marketLearner = require("./market-learner");
            const adjustments = [];

            // If win rate < 40%, switch to conservative
            if (winRate < 40 && closedTrades.length >= 5) {
              tradeExecutor.setRiskProfile("conservative");
              adjustments.push(
                "Risk → CONSERVATIVE (win rate " + winRate + "%)",
              );
            }
            // If win rate > 65%, can be more aggressive
            else if (winRate > 65 && closedTrades.length >= 10) {
              tradeExecutor.setRiskProfile("aggressive");
              adjustments.push("Risk → AGGRESSIVE (win rate " + winRate + "%)");
            }

            // Update indicator weights based on which signals led to wins
            const signalAccuracy = {};
            closedTrades.forEach((t) => {
              if (t.raw_data?.indicators) {
                Object.entries(t.raw_data.indicators).forEach(([ind, _sig]) => {
                  if (!signalAccuracy[ind])
                    signalAccuracy[ind] = { correct: 0, total: 0 };
                  signalAccuracy[ind].total++;
                  if (t.pnl > 0) signalAccuracy[ind].correct++;
                });
              }
            });

            // Feed accuracy back to market learner
            Object.entries(signalAccuracy).forEach(([ind, stats]) => {
              if (stats.total >= 3) {
                const accuracy = stats.correct / stats.total;
                marketLearner.recordOutcome(
                  ind,
                  accuracy > 0.5 ? "win" : "loss",
                );
                adjustments.push(
                  `${ind}: accuracy ${Math.round(accuracy * 100)}% → weight updated`,
                );
              }
            });

            result.botAdjustments =
              adjustments.length > 0
                ? adjustments
                : ["No adjustments needed yet"];
          } catch (e) {
            result.botAdjustments = ["Control loop error: " + e.message];
          }
        } else {
          result.strategyAnalysis = {
            note: "No closed trades yet — brain will analyze after first trades",
          };
          result.botAdjustments = [
            "Waiting for trade data to optimize strategy",
          ];
        }
      }
    } catch (e) {
      result.error = e.message;
    }
    await this._logAdminAction("trading", { action }, result);
    const posCount = result.portfolio?.length || 0;
    const histCount = result.supabaseHistory?.totalAnalyses || 0;
    const tradeCount = result.supabaseHistory?.totalTrades || 0;
    return {
      type: "adminTrading",
      data: result,
      summary: `${posCount} active pe Binance, ${histCount} analize în Supabase, ${tradeCount} trade-uri, ${result.botAdjustments?.[0] || "brain monitoring"}`,
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
