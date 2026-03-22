// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN CORTEX v2.0
// Central orchestrator: keeps ALL AIs alive with permanent roles.
// FULL PIPELINE: Monitor → Test → Repair → Verify → Deploy
//
// ┌─────────────────────────────────────────────────────────────┐
// │  GROQ (Llama 4 Scout)  │ ⚡ Gardian — Health Monitor      │
// │  CLAUDE (Sonnet 4)     │ 🩺 Chirurg — Self-Heal + Repair  │
// │  GEMINI (2.5 Flash)    │ 🔍 Cercetător — Search + Verify  │
// │  GPT-5.4               │ 🛠️ Constructor — Tools + Final   │
// │  DEEPSEEK (R1)         │ 🔢 Analist — Math + Logic + Code │
// │  CORTEX                │ 🧠 Dispecer — Orchestrator       │
// └─────────────────────────────────────────────────────────────┘
//
// 7 PERMANENT LOOPS:
// 1. Health Pulse (2min) — ping each AI
// 2. Schema Monitor (5min) — validate Supabase tables/columns
// 3. Learning Sync (10min) — feed Kira knowledge from DB
// 4. Error Digest (15min) — Groq summarizes errors
// 5. Test Runner (30min) — run Jest, detect failures
// 6. Repair Router — allocate AI to fix failures
// 7. Post-Deploy Check — health check after git push
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { MODELS } = require('./config/models');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// AI AGENT REGISTRY — Each AI has a permanent role
// ═══════════════════════════════════════════════════════════════
const AI_AGENTS = {
  groq: {
    name: 'Groq (Llama 4 Scout)',
    role: 'GARDIAN',
    emoji: '⚡',
    duties: ['Health monitoring', 'Error digest', 'Fast triage', 'Planning'],
    status: 'sleeping', // sleeping | active | error
    lastPing: null,
    errorCount: 0,
    keyEnv: 'GROQ_API_KEY',
    model: () => MODELS?.GROQ_PRIMARY || 'meta-llama/llama-4-scout-17b-16e-instruct',
  },
  claude: {
    name: 'Claude (Sonnet 4)',
    role: 'CHIRURG',
    emoji: '🩺',
    duties: ['Self-heal primary', 'Code repair', 'Deep reasoning', 'Quality verification'],
    status: 'sleeping',
    lastPing: null,
    errorCount: 0,
    keyEnv: 'ANTHROPIC_API_KEY',
    model: () => MODELS?.CLAUDE || 'claude-sonnet-4-20250514',
  },
  gemini: {
    name: 'Gemini (2.5 Flash)',
    role: 'CERCETĂTOR',
    emoji: '🔍',
    duties: ['Web search grounding', 'Quality gate', 'Fact verification', 'Schema analysis'],
    status: 'sleeping',
    lastPing: null,
    errorCount: 0,
    keyEnv: 'GOOGLE_AI_KEY',
    model: () => MODELS?.GEMINI_CHAT || 'gemini-2.5-flash',
  },
  gpt: {
    name: 'GPT-5.4',
    role: 'CONSTRUCTOR',
    emoji: '🛠️',
    duties: ['Tool calling', 'Final response builder', 'Image generation', 'Complex orchestration'],
    status: 'sleeping',
    lastPing: null,
    errorCount: 0,
    keyEnv: 'OPENAI_API_KEY',
    model: () => MODELS?.OPENAI_CHAT || 'gpt-5.4',
  },
  deepseek: {
    name: 'DeepSeek (R1)',
    role: 'ANALIST',
    emoji: '🔢',
    duties: ['Math/logic', 'Code analysis', 'Algorithm design', 'Technical diagnosis'],
    status: 'sleeping',
    lastPing: null,
    errorCount: 0,
    keyEnv: 'DEEPSEEK_API_KEY',
    model: () => MODELS?.DEEPSEEK || 'deepseek-reasoner',
  },
};

// ═══════════════════════════════════════════════════════════════
// SUPABASE SCHEMA — Expected tables and columns
// If the brain writes to a table/column, it MUST be listed here.
// ═══════════════════════════════════════════════════════════════
const EXPECTED_SCHEMA = {
  brain_memory: {
    required: ['id', 'user_id', 'content', 'memory_type', 'importance', 'created_at'],
    optional: ['context', 'media_url', 'expires_at', 'metadata'],
  },
  learned_facts: {
    required: ['id', 'user_id', 'fact', 'created_at'],
    optional: ['source', 'confidence', 'category'],
  },
  conversations: {
    required: ['id', 'user_id', 'title', 'created_at'],
    optional: ['avatar', 'updated_at', 'metadata'],
  },
  messages: {
    required: ['id', 'conversation_id', 'role', 'content', 'created_at'],
    optional: ['metadata'],
  },
  users: {
    required: ['id', 'email', 'created_at'],
    optional: ['plan', 'display_name', 'avatar_url', 'last_login'],
  },
  page_views: {
    required: ['id', 'path', 'created_at'],
    optional: ['fingerprint', 'referrer', 'browser', 'device', 'os', 'country', 'duration_seconds', 'photo'],
  },
  ai_costs: {
    required: ['id', 'provider', 'tokens_in', 'tokens_out', 'cost_usd', 'created_at'],
    optional: ['model', 'user_id', 'endpoint'],
  },
  messenger_messages: {
    required: ['id', 'sender_id', 'role', 'content', 'created_at'],
    optional: [],
  },
  telegram_messages: {
    required: ['id', 'chat_id', 'role', 'content', 'created_at'],
    optional: [],
  },
};

// ═══════════════════════════════════════════════════════════════
// CORTEX CLASS — The Brain's Central Orchestrator
// ═══════════════════════════════════════════════════════════════
class BrainCortex {
  constructor(supabaseAdmin, brain) {
    this.supabase = supabaseAdmin;
    this.brain = brain;
    this.agents = { ...AI_AGENTS };
    this.schemaIssues = [];
    this.learningCache = [];
    this.lastSchemaCheck = null;
    this.lastLearningSync = null;
    this.lastHealthPulse = null;
    this.lastTestRun = null;
    this.lastTestResult = null;
    this.lastRepair = null;
    this.lastDeploy = null;
    this.repairHistory = []; // { timestamp, failures, aiUsed, fixed, deployed }
    this.startTime = Date.now();
    this._intervals = [];
    this._repairCooldown = 10 * 60 * 1000; // 10min between repairs
    this._lastRepairTime = 0;
  }

  // ─── START — Activate all 7 permanent loops ─────────────
  start() {
    logger.info({ component: 'Cortex' }, '🧠 BRAIN CORTEX v2.0 starting — activating all AI agents...');

    // Wake up all agents (check API keys)
    this._wakeAgents();

    // LOOP 1: Health Pulse — every 2 minutes
    this._intervals.push(setInterval(() => this._healthPulse().catch(e =>
      logger.warn({ component: 'Cortex', err: e.message }, 'Health pulse error')
    ), 2 * 60 * 1000));

    // LOOP 2: Schema Monitor — every 5 minutes
    this._intervals.push(setInterval(() => this._schemaMonitor().catch(e =>
      logger.warn({ component: 'Cortex', err: e.message }, 'Schema monitor error')
    ), 5 * 60 * 1000));

    // LOOP 3: Learning Sync — every 10 minutes
    this._intervals.push(setInterval(() => this._learningSync().catch(e =>
      logger.warn({ component: 'Cortex', err: e.message }, 'Learning sync error')
    ), 10 * 60 * 1000));

    // LOOP 4: Error Digest — every 15 minutes
    this._intervals.push(setInterval(() => this._errorDigest().catch(e =>
      logger.warn({ component: 'Cortex', err: e.message }, 'Error digest error')
    ), 15 * 60 * 1000));

    // LOOP 5: Test Runner — every 30 minutes
    this._intervals.push(setInterval(() => this._testRunner().catch(e =>
      logger.warn({ component: 'Cortex', err: e.message }, 'Test runner error')
    ), 30 * 60 * 1000));

    // Run immediately on startup (staggered to avoid spike)
    setTimeout(() => this._healthPulse().catch(() => {}), 5000);
    setTimeout(() => this._schemaMonitor().catch(() => {}), 10000);
    setTimeout(() => this._learningSync().catch(() => {}), 15000);
    setTimeout(() => this._testRunner().catch(() => {}), 60000); // tests after 1min

    logger.info({ component: 'Cortex' }, '🧠 CORTEX ONLINE — 7 permanent loops activated');
  }

  // ─── WAKE AGENTS — Check which AIs are available ─────────
  _wakeAgents() {
    const alive = [];
    const dead = [];
    for (const [id, agent] of Object.entries(this.agents)) {
      const key = process.env[agent.keyEnv];
      if (key && key.length > 5) {
        agent.status = 'active';
        agent.lastPing = Date.now();
        alive.push(`${agent.emoji} ${agent.name} [${agent.role}]`);
      } else {
        agent.status = 'error';
        dead.push(`❌ ${agent.name} — missing ${agent.keyEnv}`);
      }
    }
    logger.info({ component: 'Cortex', alive: alive.length, dead: dead.length },
      `🧠 Agents: ${alive.length} active, ${dead.length} missing\n  ${alive.join('\n  ')}`);
    if (dead.length > 0) {
      logger.warn({ component: 'Cortex' }, `Missing agents:\n  ${dead.join('\n  ')}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 1: HEALTH PULSE — Verify each AI is responsive
  // ═══════════════════════════════════════════════════════════
  async _healthPulse() {
    const results = {};
    for (const [id, agent] of Object.entries(this.agents)) {
      if (agent.status === 'error' && !process.env[agent.keyEnv]) continue;

      try {
        const start = Date.now();
        const alive = await this._pingAgent(id);
        const ms = Date.now() - start;
        if (alive) {
          agent.status = 'active';
          agent.lastPing = Date.now();
          agent.errorCount = 0;
          results[id] = { ok: true, ms };
        } else {
          agent.errorCount++;
          if (agent.errorCount >= 3) agent.status = 'error';
          results[id] = { ok: false, errors: agent.errorCount };
        }
      } catch (e) {
        agent.errorCount++;
        if (agent.errorCount >= 3) agent.status = 'error';
        results[id] = { ok: false, error: e.message };
      }
    }

    this.lastHealthPulse = Date.now();
    const activeCount = Object.values(this.agents).filter(a => a.status === 'active').length;
    logger.info({ component: 'Cortex', active: activeCount, total: Object.keys(this.agents).length },
      `💓 Health pulse: ${activeCount}/${Object.keys(this.agents).length} AI agents active`);
  }

  async _pingAgent(agentId) {
    const key = process.env[this.agents[agentId].keyEnv];
    if (!key) return false;

    switch (agentId) {
      case 'groq': {
        const r = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return r.ok;
      }
      case 'claude': {
        // Claude doesn't have a /models endpoint, just check key exists
        return key.startsWith('sk-ant-');
      }
      case 'gemini': {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { signal: AbortSignal.timeout(5000) }
        );
        return r.ok;
      }
      case 'gpt': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return r.ok;
      }
      case 'deepseek': {
        return key.length > 10; // DeepSeek doesn't have a free /models endpoint
      }
      default:
        return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 2: SCHEMA MONITOR — Validate Supabase tables/columns
  // ═══════════════════════════════════════════════════════════
  async _schemaMonitor() {
    if (!this.supabase) return;
    const issues = [];

    for (const [table, schema] of Object.entries(EXPECTED_SCHEMA)) {
      try {
        // Try to select required columns — if any missing, Supabase returns error
        const cols = schema.required.join(', ');
        const { data, error } = await this.supabase
          .from(table)
          .select(cols)
          .limit(1);

        if (error) {
          if (error.message.includes('does not exist') || error.code === '42P01') {
            issues.push({ table, type: 'TABLE_MISSING', message: `Table '${table}' does not exist` });
          } else if (error.message.includes('column')) {
            // Extract missing column name from error
            const colMatch = error.message.match(/column[s]?\s+"?(\w+)"?\s+/i);
            issues.push({
              table,
              type: 'COLUMN_MISSING',
              message: error.message,
              column: colMatch ? colMatch[1] : 'unknown',
            });
          } else {
            issues.push({ table, type: 'QUERY_ERROR', message: error.message });
          }
        }
      } catch (e) {
        issues.push({ table, type: 'CONNECTION_ERROR', message: e.message });
      }
    }

    this.schemaIssues = issues;
    this.lastSchemaCheck = Date.now();

    if (issues.length > 0) {
      logger.warn({ component: 'Cortex-Schema', issues: issues.length },
        `⚠️ Schema issues found:\n${issues.map(i => `  ❌ ${i.table}: ${i.type} — ${i.message}`).join('\n')}`);

      // Save to brain_memory for visibility
      if (this.supabase) {
        try {
          await this.supabase.from('brain_memory').insert({
            user_id: 'system',
            memory_type: 'fact',
            content: `[SCHEMA_ALERT] ${issues.length} issues: ${issues.map(i => `${i.table}:${i.type}`).join(', ')}`,
            importance: 9,
            context: { type: 'schema_monitor', issues, timestamp: new Date().toISOString() },
          });
        } catch (_) { /* ignore if brain_memory itself is broken */ }
      }
    } else {
      logger.info({ component: 'Cortex-Schema', tables: Object.keys(EXPECTED_SCHEMA).length },
        `✅ Schema OK — all ${Object.keys(EXPECTED_SCHEMA).length} tables verified`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 3: LEARNING SYNC — Feed Kira knowledge from DB
  // Loads golden_knowledge + write_lesson + conversation learnings
  // and injects into brain's hot memory for instant access.
  // ═══════════════════════════════════════════════════════════
  async _learningSync() {
    if (!this.supabase || !this.brain) return;

    try {
      // 1. Load golden knowledge
      const { data: golden, error: gErr } = await this.supabase
        .from('brain_memory')
        .select('id, content, context, importance, created_at')
        .in('memory_type', ['fact', 'text'])
        .gte('importance', 7)
        .order('created_at', { ascending: false })
        .limit(100);

      // 2. Load write lessons (self-analysis results)
      const { data: lessons, error: lErr } = await this.supabase
        .from('brain_memory')
        .select('id, content, context, created_at')
        .in('memory_type', ['fact', 'text'])
        .like('content', '%LECȚIE%')
        .order('created_at', { ascending: false })
        .limit(50);

      // 3. Load learned conversation patterns
      const { data: learned, error: leErr } = await this.supabase
        .from('brain_memory')
        .select('id, content, context, created_at')
        .in('memory_type', ['fact', 'text'])
        .like('content', '%LEARNED%')
        .order('created_at', { ascending: false })
        .limit(50);

      // Combine all knowledge
      const allKnowledge = [
        ...(golden || []).map(k => ({ ...k, source: 'golden' })),
        ...(lessons || []).map(k => ({ ...k, source: 'lesson' })),
        ...(learned || []).map(k => ({ ...k, source: 'conversation' })),
      ];

      // Inject into brain's golden knowledge cache
      if (this.brain._goldenKnowledge) {
        let newCount = 0;
        for (const item of allKnowledge) {
          if (!this.brain._goldenKnowledge.has(item.id)) {
            this.brain._goldenKnowledge.set(item.id, {
              content: item.content,
              metadata: item.context || {},
              accessCount: 0,
              source: item.source,
            });
            newCount++;
          }
        }

        // Cap at 500 items (remove oldest by accessCount)
        if (this.brain._goldenKnowledge.size > 500) {
          const sorted = [...this.brain._goldenKnowledge.entries()]
            .sort((a, b) => a[1].accessCount - b[1].accessCount);
          const toRemove = sorted.slice(0, sorted.length - 500);
          for (const [id] of toRemove) {
            this.brain._goldenKnowledge.delete(id);
          }
        }

        this.learningCache = allKnowledge;
        this.lastLearningSync = Date.now();

        logger.info({
          component: 'Cortex-Learning',
          total: this.brain._goldenKnowledge.size,
          new: newCount,
          golden: (golden || []).length,
          lessons: (lessons || []).length,
          learned: (learned || []).length,
        }, `📚 Learning sync: ${this.brain._goldenKnowledge.size} items in Kira's memory (${newCount} new)`);
      }
    } catch (e) {
      logger.warn({ component: 'Cortex-Learning', err: e.message }, 'Learning sync failed');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 4: ERROR DIGEST — Groq summarizes recent errors
  // ═══════════════════════════════════════════════════════════
  async _errorDigest() {
    if (!this.brain || !this.brain.errorLog) return;

    const recentErrors = this.brain.errorLog.filter(e => Date.now() - e.time < 15 * 60 * 1000);
    if (recentErrors.length === 0) return;

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return;

    try {
      const errSummary = recentErrors
        .slice(-10)
        .map(e => `[${e.tool}] ${e.msg}`)
        .join('\n');

      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: MODELS?.GROQ_PRIMARY || 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 300,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: `Ești GARDIANUL sistemului KelionAI. Rezumă aceste erori recente în 3-5 puncte:\n\n${errSummary}\n\nFormat: bullet points, scurt, acționabil.`,
          }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (r.ok) {
        const d = await r.json();
        const digest = d.choices?.[0]?.message?.content;
        if (digest) {
          logger.info({ component: 'Cortex-Digest', errors: recentErrors.length },
            `⚡ Error digest (${recentErrors.length} errors):\n${digest}`);

          // Save digest to brain_memory
          if (this.supabase) {
            await this.supabase.from('brain_memory').insert({
              user_id: 'system',
              memory_type: 'fact',
              content: `[ERROR_DIGEST] ${digest}`,
              importance: 8,
              context: { type: 'error_digest', errorCount: recentErrors.length, timestamp: new Date().toISOString() },
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      logger.warn({ component: 'Cortex-Digest', err: e.message }, 'Error digest failed');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 5: TEST RUNNER — Run Jest every 30 min
  // If tests fail → send to Repair Router
  // ═══════════════════════════════════════════════════════════
  async _testRunner() {
    logger.info({ component: 'Cortex-Tests' }, '🧪 Running tests...');
    this.lastTestRun = Date.now();

    try {
      const output = execSync('npx jest --forceExit --bail --json 2>&1', {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
      });

      // Parse Jest JSON output
      let result;
      try {
        const jsonMatch = output.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
        result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (_) { result = null; }

      if (result) {
        const passed = result.numPassedTests || 0;
        const failed = result.numFailedTests || 0;
        const total = result.numTotalTests || 0;

        this.lastTestResult = { passed, failed, total, timestamp: Date.now() };

        // Save to Supabase
        if (this.supabase) {
          await this.supabase.from('brain_memory').insert({
            user_id: 'system',
            memory_type: 'fact',
            content: `[TEST_RESULT] ${passed}/${total} passed, ${failed} failed`,
            importance: failed > 0 ? 9 : 5,
            context: { type: 'test_result', passed, failed, total, timestamp: new Date().toISOString() },
          }).catch(() => {});
        }

        if (failed > 0) {
          logger.warn({ component: 'Cortex-Tests', passed, failed, total },
            `❌ ${failed} tests FAILED — sending to Repair Router`);

          // Extract failure details
          const failures = (result.testResults || [])
            .filter(t => t.status === 'failed')
            .map(t => ({
              file: t.name,
              errors: (t.message || '').substring(0, 500),
            }));

          // Send to repair router (respecting cooldown)
          if (Date.now() - this._lastRepairTime > this._repairCooldown) {
            await this._repairRouter(failures);
          } else {
            logger.info({ component: 'Cortex-Tests' }, '⏳ Repair cooldown active, skipping auto-repair');
          }
        } else {
          logger.info({ component: 'Cortex-Tests', passed, total },
            `✅ All ${total} tests passed`);
        }
      } else {
        // Non-JSON output — tests probably passed or had warnings
        this.lastTestResult = { passed: -1, failed: 0, total: -1, raw: true, timestamp: Date.now() };
        logger.info({ component: 'Cortex-Tests' }, '🧪 Tests completed (non-JSON output)');
      }
    } catch (e) {
      // Jest exits with code 1 on failures
      const output = ((e.stdout || '') + (e.stderr || '')).substring(0, 3000);
      this.lastTestResult = { passed: 0, failed: 1, total: 1, error: true, timestamp: Date.now() };

      logger.warn({ component: 'Cortex-Tests' }, `❌ Tests failed: ${output.substring(0, 200)}`);

      // Try to extract failure info and send to repair
      if (Date.now() - this._lastRepairTime > this._repairCooldown) {
        const failures = [{ file: 'unknown', errors: output.substring(0, 1000) }];
        await this._repairRouter(failures).catch(() => {});
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 6: REPAIR ROUTER — Allocate AI to fix test failures
  //
  // ROUTING LOGIC:
  //   Syntax/Code error → Claude Sonnet 4 (best at code)
  //   Simple/Quick fix  → Groq Llama 4 (fastest, free)
  //   Math/Algorithm    → DeepSeek R1 (best at logic)
  // ═══════════════════════════════════════════════════════════
  async _repairRouter(failures) {
    if (!failures || failures.length === 0) return;
    this._lastRepairTime = Date.now();

    logger.info({ component: 'Cortex-Repair', failures: failures.length },
      `🩺 Repair Router: ${failures.length} failures to fix`);

    for (const failure of failures.slice(0, 3)) { // Max 3 files per cycle
      try {
        // 1. Read source file
        let sourceCode = '';
        let sourceFile = failure.file;
        if (sourceFile && fs.existsSync(sourceFile)) {
          sourceCode = fs.readFileSync(sourceFile, 'utf8');
        } else {
          // Try to extract file from error message
          const fileMatch = (failure.errors || '').match(/(?:server|app)\/[\w\-\/]+\.js/i);
          if (fileMatch) {
            sourceFile = path.resolve(process.cwd(), fileMatch[0]);
            if (fs.existsSync(sourceFile)) {
              sourceCode = fs.readFileSync(sourceFile, 'utf8');
            }
          }
        }

        if (!sourceCode) {
          logger.warn({ component: 'Cortex-Repair' }, `Cannot read source for: ${sourceFile}`);
          continue;
        }

        // 2. Classify error type → choose AI
        const errLower = (failure.errors || '').toLowerCase();
        let aiChoice = 'claude'; // default: best at code
        if (errLower.includes('timeout') || errLower.includes('undefined') || errLower.includes('is not a function')) {
          aiChoice = 'groq'; // simple fix — fast
        } else if (errLower.includes('algorithm') || errLower.includes('math') || errLower.includes('NaN') || errLower.includes('calculation')) {
          aiChoice = 'deepseek'; // math/logic
        }

        const agent = this.agents[aiChoice];
        if (agent.status !== 'active') {
          // Fallback to any active agent
          aiChoice = Object.entries(this.agents).find(([_, a]) => a.status === 'active')?.[0] || null;
          if (!aiChoice) {
            logger.error({ component: 'Cortex-Repair' }, 'No active AI for repair');
            continue;
          }
        }

        logger.info({ component: 'Cortex-Repair', ai: aiChoice, file: sourceFile },
          `${this.agents[aiChoice].emoji} Allocating ${this.agents[aiChoice].name} to fix ${path.basename(sourceFile)}`);

        // 3. Ask AI for fix
        const prompt = `You are KelionAI's REPAIR AI. A test has failed and you must fix the code.

TEST ERROR:
${failure.errors}

SOURCE FILE: ${sourceFile}
CODE (first 5000 chars):
\`\`\`javascript
${sourceCode.substring(0, 5000)}
\`\`\`

GENERATE A FIX. Return ONLY JSON:
{
  "diagnosis": "Root cause",
  "search": "EXACT text to find in the file",
  "replace": "Replacement text",
  "confidence": 0.0-1.0
}`;

        const fixResponse = await this._callAI(aiChoice, prompt);
        if (!fixResponse) continue;

        // 4. Parse fix
        let fix;
        try {
          const jsonMatch = fixResponse.match(/\{[\s\S]*\}/);
          fix = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch (_) { fix = null; }

        if (!fix || !fix.search || !fix.replace || (fix.confidence || 0) < 0.6) {
          logger.warn({ component: 'Cortex-Repair', confidence: fix?.confidence },
            'Fix rejected: low confidence or invalid format');
          continue;
        }

        // 5. Apply fix
        const backup = sourceCode;
        if (!sourceCode.includes(fix.search)) {
          logger.warn({ component: 'Cortex-Repair' }, 'Search text not found in source — skipping');
          continue;
        }

        const newCode = sourceCode.replace(fix.search, fix.replace);
        fs.writeFileSync(sourceFile, newCode, 'utf8');

        // 6. Syntax check
        if (sourceFile.endsWith('.js')) {
          try {
            execSync(`node --check "${sourceFile}"`, { timeout: 5000 });
          } catch (syntaxErr) {
            logger.warn({ component: 'Cortex-Repair' }, '🔄 ROLLBACK: Syntax error in fix');
            fs.writeFileSync(sourceFile, backup, 'utf8');
            this._logRepair(failure, aiChoice, false, 'Syntax error in fix');
            continue;
          }
        }

        // 7. Re-run tests to verify fix
        logger.info({ component: 'Cortex-Repair' }, '🧪 Re-running tests after fix...');
        let testsPass = false;
        try {
          execSync('npx jest --forceExit --bail --silent 2>&1', {
            cwd: process.cwd(),
            timeout: 60000,
            encoding: 'utf8',
          });
          testsPass = true;
        } catch (_) {
          testsPass = false;
        }

        if (!testsPass) {
          logger.warn({ component: 'Cortex-Repair' }, '🔄 ROLLBACK: Tests still fail after fix');
          fs.writeFileSync(sourceFile, backup, 'utf8');
          this._logRepair(failure, aiChoice, false, 'Tests still fail');

          // Save as proposal for admin review
          if (this.supabase) {
            await this.supabase.from('brain_memory').insert({
              user_id: 'system',
              memory_type: 'fact',
              content: `[REPAIR_PROPOSAL] ${path.basename(sourceFile)}: ${fix.diagnosis}\nSearch: ${fix.search.substring(0, 200)}\nReplace: ${fix.replace.substring(0, 200)}`,
              importance: 8,
              context: { type: 'repair_proposal', file: sourceFile, fix, ai: aiChoice, timestamp: new Date().toISOString() },
            }).catch(() => {});
          }
          continue;
        }

        // 8. Tests pass! → Git commit + push → deploy
        logger.info({ component: 'Cortex-Repair' }, '✅ Tests pass after fix — deploying...');
        try {
          execSync(
            `git add "${sourceFile}" && git commit -m "🩺 Cortex AutoRepair: ${path.basename(sourceFile)} — ${fix.diagnosis.substring(0, 50)}" && git push`,
            { cwd: process.cwd(), timeout: 30000, encoding: 'utf8' }
          );
          this._logRepair(failure, aiChoice, true, 'Fixed + deployed');
          this.lastDeploy = Date.now();

          // 9. Post-deploy health check (after 2min for Railway rebuild)
          setTimeout(() => this._postDeployCheck().catch(() => {}), 2 * 60 * 1000);

          logger.info({ component: 'Cortex-Repair' },
            `🚀 DEPLOYED: ${path.basename(sourceFile)} fixed by ${this.agents[aiChoice].name}`);
        } catch (gitErr) {
          logger.error({ component: 'Cortex-Repair', err: gitErr.message }, 'Git push failed');
          this._logRepair(failure, aiChoice, false, 'Git push failed');
        }
      } catch (e) {
        logger.error({ component: 'Cortex-Repair', err: e.message }, 'Repair failed');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOOP 7: POST-DEPLOY HEALTH CHECK
  // After git push, verify the live server is healthy
  // ═══════════════════════════════════════════════════════════
  async _postDeployCheck() {
    const liveUrl = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.LIVE_URL;
    if (!liveUrl) {
      logger.info({ component: 'Cortex-Deploy' }, 'No LIVE_URL configured — skipping post-deploy check');
      return;
    }

    const healthUrl = liveUrl.startsWith('http') ? `${liveUrl}/api/health` : `https://${liveUrl}/api/health`;

    try {
      const r = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        logger.info({ component: 'Cortex-Deploy', status: r.status },
          `✅ Post-deploy health OK: ${healthUrl}`);

        if (this.supabase) {
          await this.supabase.from('brain_memory').insert({
            user_id: 'system',
            memory_type: 'fact',
            content: `[DEPLOY_OK] Health check passed after deploy`,
            importance: 6,
            context: { type: 'deploy_check', url: healthUrl, status: 'ok', timestamp: new Date().toISOString() },
          }).catch(() => {});
        }
      } else {
        logger.error({ component: 'Cortex-Deploy', status: r.status },
          `❌ Post-deploy FAIL: ${healthUrl} returned ${r.status}`);

        // Try git revert
        try {
          execSync('git revert HEAD --no-edit && git push', {
            cwd: process.cwd(), timeout: 30000, encoding: 'utf8',
          });
          logger.info({ component: 'Cortex-Deploy' }, '🔄 Git revert + re-deploy triggered');
        } catch (revertErr) {
          logger.error({ component: 'Cortex-Deploy', err: revertErr.message }, 'Git revert failed');
        }

        if (this.supabase) {
          await this.supabase.from('brain_memory').insert({
            user_id: 'system',
            memory_type: 'fact',
            content: `[DEPLOY_FAIL] Health check failed after deploy — reverted`,
            importance: 10,
            context: { type: 'deploy_check', url: healthUrl, status: 'fail', timestamp: new Date().toISOString() },
          }).catch(() => {});
        }
      }
    } catch (e) {
      logger.error({ component: 'Cortex-Deploy', err: e.message }, 'Post-deploy health check failed');
    }
  }

  // ─── HELPER: Call any AI agent ─────────────────────────────
  async _callAI(agentId, prompt) {
    const key = process.env[this.agents[agentId]?.keyEnv];
    if (!key) return null;

    try {
      switch (agentId) {
        case 'claude': {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: this.agents.claude.model(),
              max_tokens: 2048,
              temperature: 0.2,
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.content?.[0]?.text || null;
        }
        case 'groq': {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: this.agents.groq.model(),
              max_tokens: 2048,
              temperature: 0.2,
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.choices?.[0]?.message?.content || null;
        }
        case 'deepseek': {
          const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: this.agents.deepseek.model(),
              max_tokens: 2048,
              temperature: 0.2,
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.choices?.[0]?.message?.content || null;
        }
        default:
          return null;
      }
    } catch (e) {
      logger.warn({ component: 'Cortex-AI', agent: agentId, err: e.message }, 'AI call failed');
      return null;
    }
  }

  // ─── HELPER: Log repair result ────────────────────────────
  _logRepair(failure, aiUsed, success, note) {
    const entry = {
      timestamp: new Date().toISOString(),
      file: failure.file,
      ai: aiUsed,
      aiName: this.agents[aiUsed]?.name || aiUsed,
      success,
      note,
    };
    this.repairHistory.push(entry);
    if (this.repairHistory.length > 50) this.repairHistory.shift();
    this.lastRepair = entry;

    if (this.supabase) {
      this.supabase.from('brain_memory').insert({
        user_id: 'system',
        memory_type: 'fact',
        content: `[REPAIR_LOG] ${success ? '✅' : '❌'} ${path.basename(failure.file || 'unknown')} by ${entry.aiName}: ${note}`,
        importance: success ? 7 : 8,
        context: { type: 'repair_log', ...entry },
      }).catch(() => {});
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STATUS — Get cortex status for admin/health endpoint
  // ═══════════════════════════════════════════════════════════
  getStatus() {
    const agents = {};
    for (const [id, agent] of Object.entries(this.agents)) {
      agents[id] = {
        name: agent.name,
        role: agent.role,
        emoji: agent.emoji,
        duties: agent.duties,
        status: agent.status,
        lastPing: agent.lastPing ? new Date(agent.lastPing).toISOString() : null,
        errorCount: agent.errorCount,
        hasKey: !!process.env[agent.keyEnv],
      };
    }

    return {
      cortexVersion: '2.0',
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      agents,
      activeAgents: Object.values(this.agents).filter(a => a.status === 'active').length,
      totalAgents: Object.keys(this.agents).length,
      loops: 7,
      schema: {
        lastCheck: this.lastSchemaCheck ? new Date(this.lastSchemaCheck).toISOString() : null,
        issues: this.schemaIssues.length,
        tablesMonitored: Object.keys(EXPECTED_SCHEMA).length,
      },
      learning: {
        lastSync: this.lastLearningSync ? new Date(this.lastLearningSync).toISOString() : null,
        itemsInCache: this.learningCache.length,
        goldenKnowledgeSize: this.brain?._goldenKnowledge?.size || 0,
      },
      tests: {
        lastRun: this.lastTestRun ? new Date(this.lastTestRun).toISOString() : null,
        lastResult: this.lastTestResult,
      },
      repair: {
        lastRepair: this.lastRepair,
        historyCount: this.repairHistory.length,
        cooldownActive: (Date.now() - this._lastRepairTime) < this._repairCooldown,
      },
      deploy: {
        lastDeploy: this.lastDeploy ? new Date(this.lastDeploy).toISOString() : null,
      },
      lastHealthPulse: this.lastHealthPulse ? new Date(this.lastHealthPulse).toISOString() : null,
    };
  }

  // ─── STOP — Clean shutdown ───────────────────────────────
  stop() {
    for (const interval of this._intervals) {
      clearInterval(interval);
    }
    this._intervals = [];
    logger.info({ component: 'Cortex' }, '🧠 Brain Cortex stopped');
  }
}

module.exports = { BrainCortex, AI_AGENTS, EXPECTED_SCHEMA };
