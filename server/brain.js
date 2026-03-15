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
const logger = require('./logger');
const kiraTools = require('./kira-tools');
const { MODELS } = require('./config/models');
const { UserProfile, LearningStore, AutonomousMonitor } = require('./brain-profile');

// K1 AGI Integration — enriches every web chat with world state, memory, reasoning
let k1Bridge;
try {
  k1Bridge = require('./k1-messenger-bridge');
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
    this.learningStore.load(this.supabaseAdmin).catch((err) => {
      console.error(err);
    });

    // ── Autonomous Monitor (30min health loop) ──
    this.autonomousMonitor = new AutonomousMonitor(this);
    this.autonomousMonitor.start();

    // ── User Profile Cache ──
    this._profileCache = new Map(); // userId → { profile, loadedAt }
    this._profileTTL = 10 * 60 * 1000; // cache profiles for 10 min

    // ── Multi-Agent Profiles (references AGENTS static getter) ──
    this.agents = KelionBrain.AGENTS;

    logger.info(
      { component: 'Brain' },
      '🧠 Brain v3.0 initialized: LearningStore + AutonomousMonitor + MultiAgent + UserProfiles'
    );

    // ── Tool Registry (loaded from Supabase brain_tools) ──
    this._toolRegistry = new Map(); // id → tool
    this._toolCache = new Map(); // cacheKey → { data, timestamp }
    this._toolCacheTTL = 5 * 60 * 1000; // 5 min cache

    // Plan quota limits (messages per month)
    this.PLAN_LIMITS = { free: 50, pro: 500, premium: Infinity };

    // Load tool registry on startup
    this._loadToolRegistry().catch((err) => {
      console.error(err);
    });

    // PERIODIC TASKS — Reminder checker runs every 60 seconds
    this._reminderInterval = setInterval(() => {
      this._checkReminders().catch((err) => {
        console.error(err);
      });
    }, 60 * 1000);

    // SCHEDULED TASKS — Check for pending scheduled jobs every 5 minutes
    this._scheduledTaskInterval = setInterval(
      () => {
        this._checkScheduledTasks().catch((err) => {
          console.error(err);
        });
      },
      5 * 60 * 1000
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
        status: 'pending',
        nextRun: this._calculateNextRun(schedule),
        createdAt: new Date().toISOString(),
      };

      await this.supabaseAdmin.from('brain_memory').insert({
        user_id: userId,
        type: 'scheduled_task',
        content: JSON.stringify(taskData),
      });

      logger.info({ component: 'Scheduler', taskType, userId }, `📅 Task scheduled: ${taskType}`);
      return true;
    } catch (e) {
      logger.warn({ component: 'Scheduler', err: e.message }, 'Schedule task failed');
      return false;
    }
  }

  _calculateNextRun(schedule) {
    const now = new Date();
    switch (schedule) {
      case 'daily':
        return new Date(now.getTime() + 86400000).toISOString();
      case 'weekly':
        return new Date(now.getTime() + 7 * 86400000).toISOString();
      case 'hourly':
        return new Date(now.getTime() + 3600000).toISOString();
      case 'once':
        return now.toISOString(); // Run immediately on next check
      default:
        return new Date(now.getTime() + 86400000).toISOString();
    }
  }

  async _checkScheduledTasks() {
    if (!this.supabaseAdmin) return;
    try {
      const { data: tasks } = await this.supabaseAdmin
        .from('brain_memory')
        .select('id, user_id, content')
        .eq('type', 'scheduled_task')
        .limit(20);

      if (!tasks || tasks.length === 0) return;

      const now = new Date();
      for (const task of tasks) {
        try {
          const parsed = JSON.parse(task.content);
          if (parsed.status !== 'pending') continue;
          if (new Date(parsed.nextRun) > now) continue;

          // Task is due — mark as running
          logger.info(
            { component: 'Scheduler', type: parsed.type, userId: task.user_id },
            `⏰ Running scheduled task: ${parsed.type}`
          );

          // Execute based on type
          switch (parsed.type) {
            case 'daily_report':
              // Generate daily summary (non-blocking)
              this._generateDocument(
                'Raport Zilnic',
                `Generează un rezumat al activității de azi pentru user ${task.user_id}`,
                'markdown',
                task.user_id
              ).catch((err) => {
                console.error(err);
              });
              break;
            case 'periodic_cleanup':
              // Clean old memories (keep last 500)
              if (this.supabaseAdmin) {
                const { count } = await this.supabaseAdmin
                  .from('brain_memory')
                  .select('id', { count: 'exact' })
                  .eq('user_id', task.user_id);
                if (count > 500) {
                  logger.info({ component: 'Scheduler', count }, `🧹 Cleaning ${count - 500} old memories`);
                }
              }
              break;
          }

          // Update: mark as done or reschedule
          if (parsed.schedule === 'once') {
            parsed.status = 'completed';
            parsed.completedAt = now.toISOString();
          } else {
            parsed.nextRun = this._calculateNextRun(parsed.schedule);
            parsed.lastRun = now.toISOString();
          }

          await this.supabaseAdmin
            .from('brain_memory')
            .update({ content: JSON.stringify(parsed) })
            .eq('id', task.id);
        } catch {
          /* ignored */
        }
      }
    } catch (e) {
      logger.warn({ component: 'Scheduler', err: e.message }, 'Scheduled task check failed');
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
        .from('brain_tools')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (error || !data) return;
      this._toolRegistry.clear();
      for (const tool of data) {
        this._toolRegistry.set(tool.id, tool);
      }
      logger.info({ component: 'Brain', tools: data.length }, `🔧 Loaded ${data.length} tools from registry`);
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'Tool registry load failed');
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
      logger.warn({ component: 'Brain', toolId }, `Tool ${toolId} not found`);
      return { success: false, error: 'Tool not found', data: null };
    }

    // ── Cache check ──
    const cacheKey = `${toolId}:${JSON.stringify(params)}`;
    const cached = this._toolCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this._toolCacheTTL) {
      logger.info({ component: 'Brain', toolId }, `📦 Cache hit for ${tool.name}`);
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
        const headers = { 'Content-Type': 'application/json' };
        if (tool.auth_type === 'api_key' && tool.auth_env_key) {
          const key = process.env[tool.auth_env_key];
          if (!key) throw new Error(`Missing env: ${tool.auth_env_key}`);
          const headerName = tool.config?.header || 'Authorization';
          headers[headerName] = headerName === 'Authorization' ? `Bearer ${key}` : key;
        } else if (tool.auth_type === 'bearer' && tool.auth_env_key) {
          headers['Authorization'] = `Bearer ${process.env[tool.auth_env_key]}`;
        }

        // Build request
        const fetchOpts = {
          method: tool.method,
          headers,
          signal: AbortSignal.timeout(15000),
        };
        let url = tool.endpoint;

        if (tool.method === 'GET' && params.query) {
          const qs = new URLSearchParams(params).toString();
          url = `${url}?${qs}`;
        } else if (tool.method === 'POST') {
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
          this.supabaseAdmin
            .from('brain_memory')
            .insert({
              user_id: userId,
              memory_type: 'tool_call',
              content: `Used ${tool.name}: ${JSON.stringify(params).substring(0, 200)}`,
              metadata: {
                tool_id: tool.id,
                latency_ms: latency,
                success: true,
              },
              importance: 0.3,
            })
            .then(() => {})
            .catch((err) => {
              console.error(err);
            });
        }

        return { success: true, data, latency, tool: tool.name };
      } catch (e) {
        const latency = Date.now() - start;
        logger.warn(
          { component: 'Brain', tool: tool.id, err: e.message, latency },
          `⚠️ ${tool.name} failed (${latency}ms): ${e.message}`
        );
        this._updateToolStats(tool.id, latency, false);

        // ── Fallback to next tool ──
        if (tool.fallback_tool_id) {
          const fallback = this._toolRegistry.get(tool.fallback_tool_id);
          if (fallback) {
            logger.info(
              { component: 'Brain', from: tool.id, to: fallback.id },
              `🔄 Fallback: ${tool.name} → ${fallback.name}`
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
    return { success: false, error: 'All attempts exhausted', data: null };
  }

  /** Update tool stats in DB (async, non-blocking) */
  _updateToolStats(toolId, latencyMs, success) {
    if (!this.supabaseAdmin) return;
    const existing = this._toolRegistry.get(toolId);
    const oldCalls = existing?.total_calls || 0;
    const oldAvg = existing?.avg_latency_ms || latencyMs;
    const newCalls = oldCalls + 1;
    const newAvg = Math.round((oldAvg * oldCalls + latencyMs) / newCalls);
    const updates = {
      total_calls: newCalls,
      last_used_at: new Date().toISOString(),
      avg_latency_ms: newAvg,
    };
    if (!success) updates.total_errors = (existing?.total_errors || 0) + 1;

    this.supabaseAdmin
      .from('brain_tools')
      .update(updates)
      .eq('id', toolId)
      .then(() => {})
      .catch((err) => {
        console.error(err);
      });

    // Update local cache
    const local = this._toolRegistry.get(toolId);
    if (local) {
      local.total_calls = newCalls;
      local.last_used_at = updates.last_used_at;
      local.avg_latency_ms = newAvg;
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
    let plan = 'free';
    try {
      const { data: sub } = await this.supabaseAdmin
        .from('subscriptions')
        .select('plan')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();
      if (sub?.plan) plan = sub.plan;
    } catch {
      /* ignored */
    }

    const limit = this.PLAN_LIMITS[plan] || 50;

    // Get current usage
    try {
      const { data: usage } = await this.supabaseAdmin
        .from('brain_usage')
        .select('message_count')
        .eq('user_id', userId)
        .eq('month', month)
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
        .from('brain_usage')
        .select('id, message_count, tool_calls, tokens_used')
        .eq('user_id', userId)
        .eq('month', month)
        .single();

      if (existing) {
        await this.supabaseAdmin
          .from('brain_usage')
          .update({
            message_count: (existing.message_count || 0) + 1,
            tool_calls: (existing.tool_calls || 0) + toolCalls,
            tokens_used: (existing.tokens_used || 0) + tokensUsed,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await this.supabaseAdmin.from('brain_usage').insert({
          user_id: userId,
          month,
          message_count: 1,
          tool_calls: toolCalls,
          tokens_used: tokensUsed,
        });
      }
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'Usage tracking failed');
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
  // ═══════════════════════════════════════════════════════════
  // EMBEDDING HELPER — OpenAI text-embedding-3-small (1536 dims)
  // ═══════════════════════════════════════════════════════════
  async getEmbedding(text) {
    if (!process.env.OPENAI_API_KEY || !text) return null;
    try {
      const r = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
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
  // MEMORY SYSTEM — Load/Save to Supabase (Enhanced with pgvector semantic search)
  // ═══════════════════════════════════════════════════════════
  async loadMemory(userId, type, limit = 10, contextHint = '') {
    if (!userId || !this.supabaseAdmin) return [];
    try {
      // ── TRY SEMANTIC SEARCH (pgvector) if contextHint provided ──
      if (contextHint && contextHint.length > 5) {
        try {
          const embedding = await this.getEmbedding(contextHint);
          if (embedding) {
            const { data: vectorResults, error: vecErr } = await this.supabaseAdmin.rpc('match_memories', {
              query_embedding: embedding,
              match_user_id: userId,
              match_type: type,
              match_count: limit,
              match_threshold: 0.3,
            });
            if (!vecErr && vectorResults && vectorResults.length > 0) {
              logger.info({ component: 'Brain', count: vectorResults.length, type }, '🧠 pgvector semantic memory hit');
              return vectorResults;
            }
          }
        } catch (_vecE) {
          // pgvector not available or function doesn't exist yet — fallback silently
        }
      }

      // ── FALLBACK: keyword-based relevance scoring ──
      const fetchLimit = Math.min(limit * 3, 50);
      const { data, error } = await this.supabaseAdmin
        .from('brain_memory')
        .select('content, context, importance, created_at')
        .eq('user_id', userId)
        .eq('memory_type', type)
        .order('created_at', { ascending: false })
        .limit(fetchLimit);
      if (error) {
        logger.warn({ component: 'Brain', err: error.message }, 'loadMemory failed');
        return [];
      }
      if (!data || data.length === 0) return [];

      // Relevance scoring: boost memories that share keywords with current context
      const hintWords = contextHint
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const scored = data.map((m) => {
        let score = (m.importance || 5) / 10;
        const ageHours = (Date.now() - new Date(m.created_at).getTime()) / 3600000;
        if (ageHours < 1) score += 0.3;
        else if (ageHours < 24) score += 0.15;
        else if (ageHours < 168) score += 0.05;
        if (hintWords.length > 0 && m.content) {
          const contentLow = m.content.toLowerCase();
          const matchCount = hintWords.filter((w) => contentLow.includes(w)).length;
          score += (matchCount / hintWords.length) * 0.4;
        }
        return { ...m, _relevanceScore: score };
      });

      scored.sort((a, b) => b._relevanceScore - a._relevanceScore);
      return scored.slice(0, limit);
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'loadMemory error');
      return [];
    }
  }

  async saveMemory(userId, type, content, context = {}, importance = 5) {
    if (!userId || !this.supabaseAdmin || !content) return;
    try {
      // Generate embedding for semantic search (async, non-blocking)
      const embedding = await this.getEmbedding(content);
      const row = {
        user_id: userId,
        memory_type: type,
        content: content.substring(0, 2000),
        context,
        importance,
      };
      if (embedding) row.embedding = embedding;
      await this.supabaseAdmin.from('brain_memory').insert(row);
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'saveMemory error');
    }
  }

  async loadFacts(userId, limit = 15) {
    if (!userId || !this.supabaseAdmin) return [];
    try {
      const { data, error } = await this.supabaseAdmin
        .from('learned_facts')
        .select('fact, category, confidence')
        .eq('user_id', userId)
        .order('confidence', { ascending: false })
        .limit(limit);
      if (error) return [];
      return data || [];
    } catch (_e) {
      return [];
    }
  }

  async saveFact(userId, fact, category = 'knowledge', source = 'conversation') {
    if (!userId || !this.supabaseAdmin || !fact) return;
    try {
      // Avoid duplicates
      const { data: existing } = await this.supabaseAdmin
        .from('learned_facts')
        .select('id')
        .eq('user_id', userId)
        .eq('fact', fact)
        .limit(1);
      if (existing && existing.length > 0) return;
      await this.supabaseAdmin.from('learned_facts').insert({
        user_id: userId,
        fact: fact.substring(0, 500),
        category,
        source,
      });
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'saveFact error');
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
      if (/\b(prefer|vreau|imi place|mi-ar placea|I like|I prefer)\b/i.test(message)) {
        await this.saveFact(userId, 'User said: ' + message.substring(0, 200), 'preference', 'chat');
      }
      // Name sharing
      const nameMatch = message.match(/\b(?:ma cheama|numele meu|my name is|I'm|I am)\s+([A-Z][a-z]+)/i);
      if (nameMatch) {
        await this.saveFact(userId, "User's name is " + nameMatch[1], 'personal', 'chat');
      }
      // Location sharing
      const locMatch = message.match(
        /\b(?:sunt din|locuiesc in|I live in|I'm from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
      );
      if (locMatch) {
        await this.saveFact(userId, 'User lives in ' + locMatch[1], 'personal', 'chat');
      }
      this.learningsExtracted++;
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'extractFacts error');
    }
  }

  buildMemoryContext(memories, visualMem, audioMem, facts) {
    const parts = [];
    if (facts.length > 0) {
      // Sort facts by importance and deduplicate
      const uniqueFacts = [...new Set(facts.map((f) => f.fact))];
      parts.push('FACTS I KNOW ABOUT THIS USER: ' + uniqueFacts.join('; '));
    }
    if (memories.length > 0) {
      // Include importance indicator for high-priority memories
      const formatted = memories.map((m) => {
        const priority = (m.importance || 5) >= 8 ? '[IMPORTANT] ' : '';
        return priority + m.content;
      });
      parts.push('RECENT CONVERSATIONS: ' + formatted.join(' | '));
    }
    if (visualMem.length > 0) {
      parts.push("IMAGES I'VE SEEN: " + visualMem.map((m) => m.content).join('; '));
    }
    if (audioMem.length > 0) {
      parts.push('VOICE INTERACTIONS: ' + audioMem.map((m) => m.content).join('; '));
    }
    return parts.length > 0 ? '[MEMORY CONTEXT] ' + parts.join(' || ') : '';
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
        const oldest = [...this._profileCache.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
        if (oldest) this._profileCache.delete(oldest[0]);
      }
      return profile;
    } catch (_e) {
      return null;
    }
  }

  // Multi-agent: select best agent based on analysis topics
  _selectAgent(analysis) {
    if (!analysis || !analysis.topics || analysis.topics.length === 0) return null;
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
  async _delegateToAgent(fromAgent, targetAgentKey, subtask, conversationContext = {}) {
    // Anti-loop protection
    const delegationCount = conversationContext._delegationCount || 0;
    if (delegationCount >= 2) {
      logger.warn(
        { component: 'Brain', from: fromAgent, to: targetAgentKey },
        '⚠️ Delegation limit reached (max 2) — handling directly'
      );
      return null;
    }

    const targetAgent = this.agents[targetAgentKey];
    if (!targetAgent) {
      logger.warn({ component: 'Brain', targetAgentKey }, 'Target agent not found');
      return null;
    }

    logger.info(
      {
        component: 'Brain',
        from: fromAgent,
        to: targetAgentKey,
        subtask: subtask.substring(0, 80),
      },
      `🔄 Delegating: ${fromAgent} → ${targetAgent.name}`
    );

    // Build delegated prompt with specialist persona
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) return null;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${targetAgent.systemPrompt}\n\n${subtask}` }],
              },
            ],
            generationConfig: { maxOutputTokens: 800, temperature: 0.5 },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!r.ok) return null;
      const data = await r.json();
      const response = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

      if (response) {
        // Log delegation success
        this.journal.push({
          timestamp: new Date().toISOString(),
          event: 'agent_delegation',
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
      logger.warn({ component: 'Brain', err: e.message }, 'Delegation failed');
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
      (topics.some((t) => t.includes('trading') || t.includes('crypto') || t.includes('bitcoin')) ||
        msg.includes('bitcoin') ||
        msg.includes('trading') ||
        msg.includes('crypto')) &&
      currentAgent !== 'trader'
    ) {
      return { shouldDelegate: true, targetAgent: 'trader', subtask: message };
    }

    // Creative delegation
    if (
      (topics.some((t) => t.includes('creative') || t.includes('poem') || t.includes('story')) ||
        msg.includes('scrie o') ||
        msg.includes('write a') ||
        msg.includes('poem')) &&
      currentAgent !== 'creative'
    ) {
      return {
        shouldDelegate: true,
        targetAgent: 'creative',
        subtask: message,
      };
    }

    // Research delegation
    if (
      (topics.some((t) => t.includes('research') || t.includes('analyze') || t.includes('compare')) ||
        msg.includes('cercetează') ||
        msg.includes('analizează') ||
        msg.includes('compară')) &&
      currentAgent !== 'research'
    ) {
      return {
        shouldDelegate: true,
        targetAgent: 'research',
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
          .from('tenants')
          .select('*')
          .eq('domain', hostname)
          .eq('is_active', true)
          .single();

        if (data) {
          const config = {
            name: data.name || 'KelionAI',
            domain: data.domain,
            logo: data.logo_url || null,
            primaryColor: data.primary_color || '#6366f1',
            secondaryColor: data.secondary_color || '#06b6d4',
            defaultAvatar: data.default_avatar || 'kira',
            defaultLanguage: data.default_language || 'en',
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
      } catch {
        /* ignored */
      }
    }

    return this._defaultTenantConfig();
  }

  _defaultTenantConfig() {
    return {
      name: 'KelionAI',
      domain: null,
      logo: null,
      primaryColor: '#6366f1',
      secondaryColor: '#06b6d4',
      defaultAvatar: 'kira',
      defaultLanguage: 'en',
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
    if (analysis.complexity === 'complex' && !chainOfThought) score -= 0.15;

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
        name: 'Gemini',
        fn: async () => {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: maxTokens },
              }),
            }
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
        name: 'Groq',
        fn: async () => {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + this.groqKey,
            },
            body: JSON.stringify({
              model: MODELS.GROQ_PRIMARY,
              max_tokens: maxTokens,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
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
        Promise.race([p.fn(), new Promise((resolve) => setTimeout(() => resolve(null), 8000))]).catch(() => null)
      )
    );

    const answers = results
      .map((r, i) => ({
        name: providers[i].name,
        text: r.status === 'fulfilled' ? r.value : null,
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
        component: 'Brain',
        providers: answers.map((a) => a.name),
        bestLength: best.text.length,
      },
      `🤝 Multi-AI consensus: ${answers.length} providers responded, using ${best.name}`
    );
    return {
      text: best.text,
      engine: best.name + '+Consensus',
      consensus: true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN ENTRY — Complete thinking loop
  // ═══════════════════════════════════════════════════════════
  async think(message, avatar, history, language, userId, conversationId, mediaData = {}, isAdmin = false) {
    this.conversationCount++;
    const startTime = Date.now();
    // Store media data for tool access
    this._currentMediaData = mediaData || {};

    try {
      // Step -1: QUOTA CHECK — verify user has remaining messages
      const quota = await this.checkQuota(userId);
      if (!quota.allowed) {
        logger.info(
          { component: 'Brain', userId, used: quota.used, limit: quota.limit },
          `⛔ Quota exceeded for user (${quota.plan})`
        );
        const upgradeMsg =
          language === 'ro'
            ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează la ${quota.plan === 'free' ? 'Pro' : 'Premium'} pentru mai multe mesaje! 🚀`
            : `You've reached your ${quota.limit} messages/month limit on the ${quota.plan.toUpperCase()} plan. Upgrade to ${quota.plan === 'free' ? 'Pro' : 'Premium'} for more messages! 🚀`;
        return {
          reply: upgradeMsg,
          emotion: 'neutral',
          toolsUsed: [],
          confidence: 1.0,
        };
      }

      // Step 0: LOAD MEMORY + USER PROFILE — brain wakes up with full context
      const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
        this.loadMemory(userId, 'text', 10),
        this.loadMemory(userId, 'visual', 5),
        this.loadMemory(userId, 'audio', 5),
        this.loadFacts(userId, 15),
        this._loadProfileCached(userId),
      ]);
      const memoryContext = this.buildMemoryContext(memories, visualMem, audioMem, facts);
      this._currentMemoryContext = memoryContext;
      this._currentProfile = profile;

      // Inject profile context into memory
      const profileContext = profile ? profile.toContextString() : '';
      if (profileContext) {
        this._currentMemoryContext = profileContext + ' || ' + memoryContext;
      }

      // Inject project context (async, non-blocking if table doesn't exist yet)
      const projectCtx = await this._projectContext(userId).catch(() => '');
      if (projectCtx) {
        this._currentMemoryContext = this._currentMemoryContext + '\n' + projectCtx;
      }

      // Inject workspace context (persistent project structure/tech stack)
      const workspace = await this._loadWorkspace(userId).catch(() => null);
      if (workspace && Array.isArray(workspace) && workspace.length > 0) {
        const wsCtx = workspace
          .map(
            (w) =>
              `[Workspace: ${w.name}] Stack: ${(w.techStack || []).join(', ')} | Files: ${(w.keyFiles || []).slice(0, 5).join(', ')}`
          )
          .join('\n');
        this._currentMemoryContext = this._currentMemoryContext + '\n' + wsCtx;
      }

      // Step 1: ANALYZE intent deeply
      const analysis = this.analyzeIntent(message, language);

      // Step 1b: COMPLEXITY SCORING (5-tier: simple→medium→complex→critical→highRisk)
      const complexityResult = this._scoreComplexity(analysis, message);
      analysis.complexity = complexityResult.name;
      analysis.complexityLevel = complexityResult.level;
      let modelRoute = this._routeModel(complexityResult);

      // Step 1c: COST GUARDRAILS — check budget and auto-downgrade if needed
      const userPlan = isAdmin ? 'admin' : profile?.plan || 'free';
      const budgetResult = await this._checkBudget(userId, userPlan).catch(() => ({
        allowed: true,
        remaining: 999,
        percentUsed: 0,
        shouldDowngrade: false,
        maxToolsPerMsg: 10,
      }));

      if (!budgetResult.allowed) {
        logger.warn({ component: 'CostGuardrails', userId, plan: userPlan }, '💰 Budget exceeded — blocking');
        return {
          enrichedMessage:
            '⚠️ Ai depășit limita zilnică de utilizare. Răspunsurile vor fi disponibile mâine, sau poți face upgrade la un plan superior.',
          toolsUsed: [],
          monitor: { content: '' },
          analysis,
          chainOfThought: null,
          compressedHistory: history.slice(-5),
          failedTools: [],
          thinkTime: Date.now() - start,
          confidence: 0,
          sourceTags: ['BUDGET_EXCEEDED'],
          agent: 'default',
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
          component: 'Brain',
          complexity: complexityResult.name,
          level: complexityResult.level,
          model: modelRoute.provider,
          reasoning: complexityResult.reasoning,
          budget: budgetResult.percentUsed + '%',
          downgraded: !!modelRoute.downgraded,
        },
        `🎯 Complexity: ${complexityResult.name} (L${complexityResult.level}) → ${modelRoute.provider}/${modelRoute.model} | Budget: ${budgetResult.percentUsed}%`
      );

      // Step 1.5: MULTI-AGENT — select best agent for this task
      const agentSelection = this._selectAgent(analysis, message);
      this._currentAgentPrompt = agentSelection.systemPrompt || '';
      this._currentAgentName = agentSelection.name || 'General Assistant';
      this._currentAgentIcon = agentSelection.icon || '🧠';
      logger.info(
        {
          component: 'Brain',
          agent: agentSelection.name,
          key: agentSelection.agent,
        },
        `${agentSelection.icon} Agent: ${agentSelection.name}`
      );

      // Step 1.6: K1 AGI CONTEXT — enrich with world state, K1 memory, alerts
      let k1Context = null;
      if (k1Bridge) {
        try {
          k1Context = await k1Bridge.preProcess(message, {
            platform: 'web',
            userId,
            domain: analysis.topics?.[0] || 'general',
            supabase: this.supabaseAdmin,
          });
          if (k1Context) {
            const k1SystemCtx = k1Bridge.getK1SystemContext(k1Context);
            if (k1SystemCtx) {
              this._currentMemoryContext = (this._currentMemoryContext || '') + '\n' + k1SystemCtx;
            }
          }
        } catch (k1Err) {
          logger.warn({ component: 'Brain', err: k1Err.message }, 'K1 preProcess failed (non-critical)');
        }
      }

      // Step 2: DECOMPOSE complex tasks into sub-tasks
      let subTasks = [{ message, analysis }];
      if (analysis.complexity === 'complex') {
        subTasks = await this.decomposeTask(message, analysis, language);
      }

      // Step 2.5: LEARNING — check if we have learned patterns for this type
      const learnedTools = this.learningStore.recommendTools(analysis);
      if (learnedTools) {
        logger.info({ component: 'Brain', learned: learnedTools }, '📚 Using learned tool pattern');
      }

      // Step 3: PLAN tools for each sub-task (with circuit breaker)
      let plan = this.buildPlan(subTasks, userId, this._currentMediaData, isAdmin);

      // Filter out circuit-broken tools
      plan = plan.filter((step) => {
        if (this.learningStore.isToolBlocked(step.tool)) {
          logger.warn({ component: 'Brain', tool: step.tool }, `⚡ Tool ${step.tool} circuit-broken — skipped`);
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
            component: 'PolicyEngine',
            before: plan.length,
            max: budgetResult.maxToolsPerMsg,
          },
          `✂️ Trimming plan: ${plan.length} → ${budgetResult.maxToolsPerMsg} tools (${userPlan} plan)`
        );
        plan = plan.slice(0, budgetResult.maxToolsPerMsg);
      }

      // ═══ AGENTIC LOOP — Multi-turn tool chaining ═══
      // Brain can iterate: execute → reflect → re-plan → execute again
      const MAX_ITERATIONS = 3;
      const allResults = {};
      let chainOfThought = null;
      let enriched = '';
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
          if (iterResults[step.tool]) this.learningStore.recordToolSuccess(step.tool);
          else this.learningStore.recordToolFailure(step.tool);
        }

        // Step 5: CHAIN-OF-THOUGHT — pre-reason for complex tasks or emergencies
        const shouldRunCoT =
          (analysis.complexity === 'complex' && Object.keys(allResults).length >= 1) || analysis.isEmergency;
        if (shouldRunCoT) {
          chainOfThought = await this.chainOfThought(message, allResults, analysis, history, language);
        }

        // Step 6: BUILD enriched context
        enriched = this.buildEnrichedContext(message, allResults, chainOfThought, analysis);

        // Step 6.5: CONFIDENCE SCORING
        confidence = this._scoreConfidence(analysis, allResults, chainOfThought);

        // Step 6.5b: MULTI-AI CONSENSUS — for complex queries with low confidence
        if (analysis.complexity === 'complex' && confidence < 0.6 && iteration === 0) {
          try {
            const consensusAnswer = await this.multiAIConsensus(message, 600);
            if (consensusAnswer) {
              enriched += `\n[MULTI-AI CONSENSUS]: ${consensusAnswer}`;
              confidence = Math.min(1.0, confidence + 0.2); // boost confidence
              logger.info({ component: 'Brain', confidence }, '🤝 Multi-AI consensus used to boost confidence');
            }
          } catch (e) {
            logger.warn({ component: 'Brain', err: e.message }, 'Multi-AI consensus failed (non-critical)');
          }
        }

        // Step 6.6: SELF-REFLECTION — evaluate if response is complete
        // Only reflect on iteration 1+ and if complex or low confidence
        if (iteration < MAX_ITERATIONS - 1 && (analysis.complexity === 'complex' || confidence < 0.6)) {
          const reflection = await this._selfReflect(message, enriched, allResults, analysis, language);
          if (reflection && reflection.needsMore) {
            // Re-plan with additional tools based on reflection
            logger.info(
              { component: 'Brain', iteration, reflection: reflection.reason },
              `🔄 Agentic loop iteration ${iteration + 1}: ${reflection.reason}`
            );
            const additionalPlan = this._planFromReflection(reflection, userId, this._currentMediaData, isAdmin);
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
          { component: 'Brain', iterations: iterationCount },
          `🔄 Agentic loop completed in ${iterationCount} iterations`
        );
      }

      const results = allResults;

      // Step 7: MANAGE CONTEXT WINDOW + COMPRESS if too long
      const managedHistory = this._manageContextWindow(history, 20, 15000);
      const compressedHistory = this.compressHistory(managedHistory, conversationId);

      // Step 8: SELF-EVALUATE + LEARN (async — doesn't block response)
      const thinkTime = Date.now() - startTime;
      this.journalEntry(
        'think_complete',
        `${analysis.complexity} task, ${plan.length} tools, ${thinkTime}ms, confidence:${confidence}`,
        {
          tools: Object.keys(results),
          complexity: analysis.complexity,
          confidence,
        }
      );

      // Learn from this conversation (async)
      this.learningStore
        .recordOutcome(analysis, Object.keys(results), true, thinkTime, this.supabaseAdmin)
        .catch((err) => {
          console.error(err);
        });
      if (profile) {
        profile.updateFromConversation(message, language, analysis);
        profile.save(this.supabaseAdmin).catch((err) => {
          console.error(err);
        });
      }

      // PROCEDURAL MEMORY: Save how this task was solved
      const toolsUsedForProcedure = Object.keys(results).filter((k) => results[k]);
      if (toolsUsedForProcedure.length > 0 && analysis.complexity !== 'simple') {
        const taskType = analysis.topics?.[0] || analysis.complexity || 'general';
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
          analysis.complexity
        ).catch((err) => {
          console.error(err);
        });
      }

      // PROJECT MEMORY: Auto-detect project mentions
      this._autoDetectProject(userId, message, analysis, toolsUsedForProcedure).catch((err) => {
        console.error(err);
      });

      // WORKSPACE MEMORY: Auto-save workspace context from conversation
      if (toolsUsedForProcedure.some((t) => ['codeExec', 'ragSearch', 'dbQuery', 'generateDoc'].includes(t))) {
        const techKeywords = message.match(
          /\b(react|vue|angular|node|express|python|django|flask|java|spring|rust|go|typescript|nextjs|vite|supabase|postgres|mongodb|redis|docker|kubernetes)\b/gi
        );
        if (techKeywords && techKeywords.length > 0) {
          this._saveWorkspace(userId, 'auto-detected', {
            techStack: [...new Set(techKeywords.map((k) => k.toLowerCase()))],
            keyFiles: [],
            patterns: toolsUsedForProcedure,
            structure: message.substring(0, 200),
          }).catch((err) => {
            console.error(err);
          });
        }
      }

      logger.info(
        {
          component: 'Brain',
          complexity: analysis.complexity,
          tools: Object.keys(results),
          chainOfThought: !!chainOfThought,
          thinkTime,
        },
        `🧠 Think: ${analysis.complexity} | tools:[${Object.keys(results).join(',')}] | CoT:${!!chainOfThought} | ${thinkTime}ms`
      );

      // Strip internal annotations from enriched message (they are for AI context, not user)
      let cleanReply = enriched
        .replace(
          /(?:\[TRUTH CHECK\]|\[REZULTATE CAUTARE\]|\[DATE METEO\]|\[Am generat\]|\[Harta\]|\[CONTEXT DIN MEMORIE\]|\[Utilizatorul pare\]|\[URGENTA\]|\[GANDIRE STRUCTURATA\]|\[REZUMAT CONVERSATIE\])[^\]]*\]/g,
          ''
        )
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Track usage (non-blocking)
      this.incrementUsage(userId, Object.keys(results).length, 0).catch((err) => {
        console.error(err);
      });

      // ── Anti-Hallucination: tag data sources ──
      const sourceTags = [];
      const toolsUsedList = Object.keys(results);
      if (toolsUsedList.length > 0) {
        sourceTags.push('VERIFIED');
        for (const t of toolsUsedList) sourceTags.push(`SOURCE:${t}`);
      }
      if (memoryContext && memoryContext.length > 20) sourceTags.push('FROM_MEMORY');
      if (toolsUsedList.length === 0 && (!memoryContext || memoryContext.length < 20)) {
        sourceTags.push('ASSUMPTION');
      }

      // Step 9: TRUTH GUARD — Verify response quality (async, non-blocking for simple tasks)
      let truthReport = null;
      if (complexityResult.level >= 2 && cleanReply.length > 50) {
        truthReport = await this._truthCheck(cleanReply, results, analysis).catch(() => null);
        if (truthReport && truthReport.verdict === 'FAIL') {
          sourceTags.push('TRUTH_FAIL');
          // Add warning to response
          const warningNote =
            '\n\n⚠️ *Verificarea automată indică incertitudine în unele afirmații. Verifică sursele.*';
          if (!cleanReply.includes('⚠️')) {
            cleanReply += warningNote;
          }
        } else if (truthReport && truthReport.verdict === 'WARNING') {
          sourceTags.push('TRUTH_WARNING');
        }
      }

      // Step 10: CRITIC AGENT — Independent quality validation (medium+ complexity)
      let criticReport = null;
      if (complexityResult.level >= 2 && cleanReply.length > 30) {
        criticReport = await this.criticEvaluate(message, cleanReply, analysis, toolsUsedList).catch(() => null);
        if (criticReport) {
          // Critic can override confidence
          if (criticReport.overallScore < confidence) {
            confidence = confidence * 0.6 + criticReport.overallScore * 0.4;
          }
          // Add safety disclaimers if needed
          if (criticReport.safety && !criticReport.safety.safe) {
            if (criticReport.safety.severity === 'critical') {
              cleanReply = '⚠️ Conținut blocat de Critic Agent din motive de siguranță.';
              sourceTags.push('CRITIC_BLOCKED');
            } else if (
              criticReport.safety.severity === 'high' &&
              !cleanReply.includes('medic') &&
              !cleanReply.includes('doctor')
            ) {
              cleanReply += '\n\n*⚕️ Notă: Consultă un specialist pentru sfaturi medicale/financiare.*';
            }
          }
          if (criticReport.verdict === 'REJECTED' || criticReport.verdict === 'NEEDS_REVISION') {
            sourceTags.push('CRITIC_' + criticReport.verdict);
          }
        }
      }

      // K1 AGI POST-PROCESS — save to K1 memory, score templates, track performance
      if (k1Bridge && k1Context) {
        try {
          await k1Bridge.postProcess(cleanReply, {
            platform: 'web',
            userId,
            domain: analysis.topics?.[0] || 'general',
            supabase: this.supabaseAdmin,
            addBadge: false, // web chat handles its own UI
          });
        } catch (k1Err) {
          logger.warn({ component: 'Brain', err: k1Err.message }, 'K1 postProcess failed (non-critical)');
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
          key: agentSelection?.agent || 'general',
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
      this.recordError('think', e.message);
      this.journalEntry('think_error', e.message, { thinkTime });
      logger.error({ component: 'Brain', err: e.message, thinkTime }, `🧠 Think failed: ${e.message}`);
      return {
        enrichedMessage: message,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: {
          complexity: 'simple',
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
          emotionalTone: 'neutral',
          language: language || 'ro',
          topics: [],
          confidenceScore: 0,
          detectedMood: 'neutral',
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
      if (toolResults.search) contextParts.push(`Web search: ${String(toolResults.search).substring(0, 500)}`);
      if (toolResults.weather) contextParts.push(`Weather: ${toolResults.weather?.description || ''}`);
      if (toolResults.memory) contextParts.push(`User memory: ${String(toolResults.memory).substring(0, 300)}`);

      const lastMsgs = (history || [])
        .slice(-5)
        .map((h) => `${h.role}: ${h.content?.substring(0, 100)}`)
        .join('\n');

      const prompt = `You are the reasoning engine of an AI assistant. Analyse the request and structure a response plan.

REQUEST: "${message}"
LANGUAGE: ${language}
DETECTED EMOTION: ${analysis.emotionalTone}
URGENT: ${analysis.isEmergency ? 'YES' : 'no'}
${contextParts.length > 0 ? 'AVAILABLE CONTEXT:\n' + contextParts.join('\n') : 'No additional context.'}
${lastMsgs ? 'RECENT HISTORY:\n' + lastMsgs : ''}

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
        r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + this.groqKey,
          },
          body: JSON.stringify({
           