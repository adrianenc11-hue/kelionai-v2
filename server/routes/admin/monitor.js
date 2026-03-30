'use strict';
const { APP_NAME: _APP_NAME } = require('../../config/app');
// ═══════════════════════════════════════════════════════════════
// Admin Sub-Router: System Monitoring & Health
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('../../logger');
const router = express.Router();

// ── Ring buffer for monitor snapshots ──
const _monitorHistory = [];
const MONITOR_MAX = 48;

async function collectMonitorSnapshot(supabaseAdmin, brain) {
  try {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const services = {
      database: !!supabaseAdmin,
      brain: !!brain,
      gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      stripe: !!process.env.STRIPE_SECRET_KEY,
    };

    const snapshot = {
      timestamp: new Date().toISOString(),
      health: {
        score: Object.values(services).filter((v) => v).length * 25,
        memory_mb: +(mem.rss / 1024 / 1024).toFixed(1),
        uptime_hours: +(uptime / 3600).toFixed(2),
        services,
        errors: brain?.recentErrors || 0,
      },
      data: {},
    };

    _monitorHistory.push(snapshot);
    if (_monitorHistory.length > MONITOR_MAX) _monitorHistory.shift();

    if (supabaseAdmin) {
      try {
        await supabaseAdmin.from('system_monitor').insert({
          snapshot: JSON.stringify(snapshot),
          health_score: snapshot.health.score,
          created_at: snapshot.timestamp,
        });

        const { count } = await supabaseAdmin.from('system_monitor').select('*', { count: 'exact', head: true });
        if (count && count > 200) {
          const { data: old } = await supabaseAdmin
            .from('system_monitor')
            .select('id')
            .order('created_at', { ascending: true })
            .limit(count - 200);
          if (old && old.length > 0) {
            await supabaseAdmin
              .from('system_monitor')
              .delete()
              .in(
                'id',
                old.map((r) => r.id)
              );
          }
        }
      } catch (err) {
        logger.debug({ component: 'Monitor', err: err.message }, 'Old monitor records cleanup failed');
      }
    }

    logger.info({ component: 'Monitor', score: snapshot.health.score }, '📊 Auto-monitor snapshot saved');
    return snapshot;
  } catch (e) {
    logger.warn({ component: 'Monitor', err: e.message }, 'Monitor snapshot failed');
    return null;
  }
}

// ── Lazy auto-monitor start ──
let _monitorInterval = null;
let _monitorStarted = false;

function ensureMonitorStarted(req) {
  if (_monitorStarted) return;
  _monitorStarted = true;
  const { supabaseAdmin, brain } = req.app.locals;
  collectMonitorSnapshot(supabaseAdmin, brain).catch(() => {});
  _monitorInterval = setInterval(
    async () => {
      try {
        await collectMonitorSnapshot(supabaseAdmin, brain);
      } catch (err) {
        logger.debug({ component: 'Monitor', err: err.message }, 'Auto-monitor snapshot failed');
      }
    },
    30 * 60 * 1000
  );
  logger.info({ component: 'Monitor' }, '📊 Auto-monitor started — snapshots every 30 min');
}

router.use((req, _res, next) => {
  ensureMonitorStarted(req);
  next();
});

// ── GET /brain-health — Brain status ──
router.get('/brain-health', (req, res) => {
  try {
    const brain = req.app?.locals?.brain;
    if (!brain) {
      return res.json({
        status: 'unavailable',
        message: 'Brain instance nu este inițializat',
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

    const hasMonitor = !!brain.autonomousMonitor?.getStatus;
    const monitorStatus = hasMonitor ? brain.autonomousMonitor.getStatus() : { status: 'not-available' };
    const hasLearningStore = !!brain.learningStore?.circuitBreakers;
    const circuitBreakers = hasLearningStore
      ? Object.entries(brain.learningStore.circuitBreakers)
          .filter(([_, cb]) => cb?.open)
          .map(([tool, cb]) => ({ tool, failures: cb?.failures || 0 }))
      : [];

    res.json({
      status: brain.recentErrors > 5 ? 'degraded' : 'healthy',
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

// ── GET /health-check — Full system health check ──
router.get('/health-check', async (req, res) => {
  try {
    const { brain, supabaseAdmin } = req.app.locals;
    let score = 100;
    const recommendations = [];
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const fmtMB = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

    let dbConnected = false;
    const tables = {};
    const tableNames = [
      'profiles',
      'conversations',
      'messages',
      'ai_costs',
      'page_views',
      'subscriptions',
      'admin_codes',
    ];
    if (supabaseAdmin) {
      try {
        for (const t of tableNames) {
          try {
            const { count, error } = await supabaseAdmin.from(t).select('*', { count: 'exact', head: true });
            tables[t] = error ? { ok: false, error: error.message } : { ok: true, count: count || 0 };
          } catch (e) {
            tables[t] = { ok: false, error: e.message };
          }
        }
        dbConnected = true;
      } catch (err) {
        logger.debug({ component: 'Monitor', err: err.message }, 'DB connection check failed');
        dbConnected = false;
      }
    }
    if (!dbConnected) {
      score -= 30;
      recommendations.push('Database not connected');
    }

    const brainStatus = brain ? (brain.recentErrors > 5 ? 'degraded' : 'healthy') : 'unavailable';
    if (brainStatus === 'degraded') {
      score -= 15;
      recommendations.push('Brain has recent errors');
    }
    if (brainStatus === 'unavailable') {
      score -= 20;
      recommendations.push('Brain not available');
    }

    const services = {};
    const svcChecks = {
      database: !!supabaseAdmin,
      brain: !!brain,
      gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      stripe: !!process.env.STRIPE_SECRET_KEY,
    };
    for (const [k, v] of Object.entries(svcChecks)) {
      services[k] = { label: k.charAt(0).toUpperCase() + k.slice(1), active: v };
      if (!v && k !== 'stripe') {
        score -= 5;
        recommendations.push(`${k} not configured`);
      }
    }

    const auth = { authAvailable: !!supabaseAdmin, supabaseAdminInitialized: !!supabaseAdmin };
    const security = {
      httpsRedirect: !!process.env.RAILWAY_PUBLIC_DOMAIN,
      adminSecretConfigured: !!(process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET),
    };
    if (!security.adminSecretConfigured) {
      score -= 5;
      recommendations.push('No ADMIN_SECRET set');
    }

    const payments = {
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
      priceProConfigured: !!process.env.STRIPE_PRICE_PRO,
      pricePremiumConfigured: !!process.env.STRIPE_PRICE_PREMIUM,
      activeSubscribers: null,
    };
    if (supabaseAdmin) {
      try {
        const { count } = await supabaseAdmin
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active');
        payments.activeSubscribers = count || 0;
      } catch (e) {
        logger.warn({ component: 'Admin', err: e.message }, 'Subscription count query failed');
      }
    }

    if (brain && typeof brain.think === 'function') {
      try {
        const diagnosticPrompt = `Ești sistemul de monitorizare ${_APP_NAME}. Analizează rapid:
- Uptime: ${Math.floor(uptime)}s, Memorie RSS: ${fmtMB(mem.rss)}, Heap: ${fmtMB(mem.heapUsed)}/${fmtMB(mem.heapTotal)}
- DB conectat: ${dbConnected}, Tabele ok: ${Object.values(tables).filter((t) => t.ok).length}/${Object.keys(tables).length}
- Brain status: ${brainStatus}, Erori recente: ${brain.recentErrors || 0}
Răspunde în maxim 3 recomandări scurte.`;
        const brainResult = await Promise.race([
          brain.think(diagnosticPrompt, 'kelion', [], 'ro'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ]);
        if (brainResult?.enrichedMessage) {
          const brainRecs = brainResult.enrichedMessage
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 3);
          recommendations.push(...brainRecs.map((r) => '🧠 ' + r.replace(/^[-•*\d.)\s]+/, '').trim()));
        }
      } catch (err) {
        logger.debug({ component: 'Monitor', err: err.message }, 'Brain diagnostic timed out');
      }
    }

    const errors = { recentCount: brain?.recentErrors || 0, degradedTools: brain?.degradedTools || [] };
    if (errors.recentCount > 0) score -= Math.min(10, errors.recentCount);
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    res.json({
      score: Math.max(0, score),
      grade,
      server: {
        version: require('../../package.json').version || '1.0.0',
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
      errors,
      recommendations,
    });
  } catch (e) {
    logger.error({ component: 'Admin', err: e.message }, 'Health check failed');
    res.status(500).json({ error: e.message, score: 0, grade: 'F' });
  }
});

// ── GET /monitor — Brain-analyzed current status ──
router.get('/monitor', async (req, res) => {
  try {
    const { supabaseAdmin, brain } = req.app.locals;
    const current = await collectMonitorSnapshot(supabaseAdmin, brain);

    let history = [];
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from('system_monitor')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(48);
        history = (data || []).map((r) => {
          try {
            return JSON.parse(r.snapshot);
          } catch (err) {
            logger.debug({ component: 'Monitor', err: err.message }, 'Monitor snapshot JSON parse failed');
            return r;
          }
        });
      } catch (err) {
        logger.debug({ component: 'Monitor', err: err.message }, 'Monitor history query failed, using in-memory');
        history = _monitorHistory;
      }
    } else {
      history = _monitorHistory;
    }

    let brainAnalysis = null;
    if (brain && typeof brain.think === 'function') {
      try {
        const historyTrend =
          history.length > 1
            ? `Ultimele ${history.length} snapshot-uri: score-uri health = [${history
                .slice(0, 5)
                .map((h) => h.health?.score)
                .join(', ')}]`
            : 'Fără istoric suficient';
        const analysisPrompt = `Ești sistemul de monitorizare ${_APP_NAME}. Analizează REAL și ONEST:
STARE CURENTĂ: Health Score: ${current?.health?.score || 0}/100, Memorie: ${current?.health?.memory_mb}MB, Uptime: ${current?.health?.uptime_hours}h, Erori recente: ${current?.health?.errors}
TREND: ${historyTrend}
Răspunde STRICT în format JSON: {"status":"HEALTHY|WARNING|CRITICAL","summary":"...","recommendations":["max 3"],"risk_level":"LOW|MEDIUM|HIGH","data_quality":"REAL|MIXED|FAKE"}`;
        const brainResult = await Promise.race([
          brain.think(analysisPrompt, 'kelion-monitor', [], 'ro'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        if (brainResult?.enrichedMessage) {
          const jsonMatch = brainResult.enrichedMessage.match(/\{[\s\S]*\}/);
          brainAnalysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: brainResult.enrichedMessage };
        }
      } catch (e) {
        brainAnalysis = { error: e.message, status: 'ANALYSIS_FAILED' };
      }
    } else {
      brainAnalysis = { error: 'Brain not available', status: 'NO_BRAIN' };
    }

    res.json({
      current,
      brainAnalysis,
      historyCount: history.length,
      recentHistory: history.slice(0, 10),
      autoMonitor: { enabled: true, interval: '30 minutes', nextRun: _monitorInterval ? 'Active' : 'Not started' },
    });
  } catch (e) {
    logger.error({ component: 'Monitor', err: e.message }, 'Monitor route failed');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /monitor/history — Full monitoring history ──
router.get('/monitor/history', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ history: _monitorHistory, source: 'memory' });
    const { data, error } = await supabaseAdmin
      .from('system_monitor')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.json({ history: _monitorHistory, source: 'memory', dbError: error.message });
    res.json({ history: data || [], source: 'database', totalEntries: (data || []).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /test-tables — Test all Supabase tables ──
router.get('/test-tables', async (req, res) => {
  const { supabaseAdmin } = req.app.locals;
  if (!supabaseAdmin) return res.status(503).json({ error: 'No Supabase connection' });

  const TABLES = [
    'conversations',
    'messages',
    'user_preferences',
    'api_keys',
    'admin_logs',
    'profiles',
    'media_history',
    'cookie_consents',
    'metrics_snapshots',
    'ai_costs',
    'page_views',
    'subscriptions',
    'referrals',
    'admin_codes',
    'brain_memory',
    'learned_facts',
  ];

  const results = [];
  let passed = 0,
    failed = 0;

  for (const table of TABLES) {
    try {
      const { error, count } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        failed++;
        results.push({ table, status: '❌ ERROR', error: error.message, code: error.code, hint: error.hint || null });
      } else {
        passed++;
        results.push({ table, status: '✅ OK', rowCount: count || 0 });
      }
    } catch (e) {
      failed++;
      results.push({ table, status: '💥 CRASH', error: e.message });
    }
  }

  res.json({
    summary: { total: TABLES.length, passed, failed, allOk: failed === 0, testedAt: new Date().toISOString() },
    results,
    errors: results.filter((r) => r.status !== '✅ OK'),
  });
});

module.exports = router;
