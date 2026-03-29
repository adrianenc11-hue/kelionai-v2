// ═══════════════════════════════════════════════════════════════
// KelionAI — Healer API Routes (/api/admin/healer/*)
// Admin-only: scan, report, heal, skills, history
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger   = require('../logger');
const {
  scanSystem,
  healIssue,
  generateAIReport,
  saveScanReport,
  getRecentReports,
  getSkillsStatus,
} = require('../brain-healer');

// ── requireAdmin middleware (inline fallback) ──
function requireAdmin(req, res, next) {
  // Check session-based admin flag
  if (req.session?.isAdmin) return next();
  // Check header-based secret key
  const secret = req.headers['x-admin-key'] || req.query.adminKey;
  if (secret && secret === process.env.ADMIN_SECRET_KEY) return next();
  // Check if user has admin role in session
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

const router = express.Router();

const healerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many healer requests' },
});

// ── Cache ultimul scan în memorie (evită re-scan rapid) ──
let _lastScan = null;
let _lastScanTime = 0;
const SCAN_CACHE_MS = 30 * 1000; // 30 secunde

// ─────────────────────────────────────────────────────────────
// POST /api/admin/healer/scan — Scanare integrală sistem
// ─────────────────────────────────────────────────────────────
router.post('/scan', healerLimiter, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    const { force = false, withAI = true } = req.body || {};

    // Cache check
    if (!force && _lastScan && (Date.now() - _lastScanTime) < SCAN_CACHE_MS) {
      return res.json({ ..._lastScan, fromCache: true });
    }

    logger.info({ component: 'Healer' }, 'Starting full system scan...');
    const scanResult = await scanSystem(supabaseAdmin);

    // Generate AI analysis
    let aiAnalysis = null;
    if (withAI) {
      try {
        aiAnalysis = await generateAIReport(scanResult);
      } catch (_e) { /* non-fatal */ }
    }

    // Save to DB
    const reportId = await saveScanReport(scanResult, aiAnalysis, supabaseAdmin);

    const response = {
      reportId,
      scan:       scanResult,
      aiAnalysis,
      fromCache:  false,
    };

    _lastScan     = response;
    _lastScanTime = Date.now();

    logger.info({ component: 'Healer', score: scanResult.score, issues: scanResult.stats.totalIssues }, 'Scan complete');
    res.json(response);
  } catch (e) {
    logger.error({ component: 'Healer', err: e.message }, 'Scan failed');
    res.status(500).json({ error: 'Scan failed: ' + e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/healer/status — Quick status (no full scan)
// ─────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    const mem = process.memoryUsage();

    // Quick DB check
    let dbOk = false;
    let dbLatency = -1;
    if (supabaseAdmin) {
      try {
        const start = Date.now();
        await supabaseAdmin.from('profiles').select('id').limit(1);
        dbLatency = Date.now() - start;
        dbOk = true;
      } catch (_e) {}
    }

    // Count active AI providers
    const aiKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_AI_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY'];
    const activeAI = aiKeys.filter(k => !!process.env[k]).length;

    res.json({
      uptime:      Math.round(process.uptime()),
      memoryMB:    Math.round(mem.heapUsed / 1024 / 1024),
      dbOk,
      dbLatencyMs: dbLatency,
      activeAI,
      totalAI:     aiKeys.length,
      lastScanScore: _lastScan?.scan?.score ?? null,
      lastScanAt:    _lastScan?.scan?.timestamp ?? null,
      nodeVersion: process.version,
      env:         process.env.NODE_ENV || 'development',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/healer/heal — Repară o problemă specifică
// Body: { issue: { fix, fixData, severity, message } }
// ─────────────────────────────────────────────────────────────
router.post('/heal', healerLimiter, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    const { issue } = req.body;

    if (!issue || !issue.fix) {
      return res.status(400).json({ error: 'issue.fix required' });
    }

    logger.info({ component: 'Healer', fix: issue.fix }, 'Healing issue...');
    const result = await healIssue(issue, supabaseAdmin);

    // Log heal attempt
    if (supabaseAdmin) {
      await supabaseAdmin.from('heal_jobs').insert({
        fix:       issue.fix,
        issue_json: issue,
        success:   result.success,
        message:   result.message,
        actions:   result.actions,
      }).catch(() => {});
    }

    // Invalidate cache after heal
    _lastScan     = null;
    _lastScanTime = 0;

    res.json(result);
  } catch (e) {
    logger.error({ component: 'Healer', err: e.message }, 'Heal failed');
    res.status(500).json({ error: 'Heal failed: ' + e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/healer/heal-all — Repară toate problemele auto-fixable
// ─────────────────────────────────────────────────────────────
router.post('/heal-all', healerLimiter, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;

    // Get latest scan or run new one
    let scanResult;
    if (_lastScan && (Date.now() - _lastScanTime) < SCAN_CACHE_MS * 2) {
      scanResult = _lastScan.scan;
    } else {
      scanResult = await scanSystem(supabaseAdmin);
    }

    const autoFixable = scanResult.issues.filter(i =>
      ['run_migration', 'prune_memories', 'add_env_to_gitignore'].includes(i.fix)
    );

    const results = [];
    for (const issue of autoFixable) {
      const r = await healIssue(issue, supabaseAdmin);
      results.push({ issue: issue.message, ...r });
    }

    const fixed   = results.filter(r => r.success).length;
    const failed  = results.filter(r => !r.success).length;
    const manual  = scanResult.issues.filter(i =>
      !['run_migration', 'prune_memories', 'add_env_to_gitignore'].includes(i.fix)
    ).length;

    // Invalidate cache
    _lastScan     = null;
    _lastScanTime = 0;

    logger.info({ component: 'Healer', fixed, failed, manual }, 'Heal-all complete');
    res.json({ fixed, failed, manual, results });
  } catch (e) {
    logger.error({ component: 'Healer', err: e.message }, 'Heal-all failed');
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/healer/skills — Lista skill-uri disponibile
// ─────────────────────────────────────────────────────────────
router.get('/skills', async (req, res) => {
  try {
    const skills = getSkillsStatus();
    const active  = skills.filter(s => s.status === 'active').length;
    const partial = skills.filter(s => s.status === 'partial').length;
    const inactive = skills.filter(s => s.status === 'needs_key').length;

    res.json({ skills, summary: { active, partial, inactive, total: skills.length } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/healer/history — Istoricul scanărilor
// ─────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    const reports = await getRecentReports(supabaseAdmin, 20);
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/admin/healer/report/:id — Raport complet după ID
// ─────────────────────────────────────────────────────────────
router.get('/report/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { data, error } = await supabaseAdmin
      .from('scan_reports')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Report not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/healer/chat — Avatar chat pentru healer
// Avatarul analizează raportul și răspunde în limbaj natural
// ─────────────────────────────────────────────────────────────
router.post('/chat', healerLimiter, async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const { supabaseAdmin } = req.app.locals;

    // Get latest scan context
    let scanContext = context;
    if (!scanContext && _lastScan) {
      scanContext = {
        score:    _lastScan.scan.score,
        status:   _lastScan.scan.status,
        issues:   _lastScan.scan.issues.slice(0, 10),
        stats:    _lastScan.scan.stats,
        aiAnalysis: _lastScan.aiAnalysis,
      };
    }

    const systemPrompt = `Ești Kelion, asistentul AI al sistemului KelionAI. Ești specializat în auto-diagnosticare, reparare și dezvoltare a sistemului.

Contextul curent al sistemului:
${scanContext ? JSON.stringify(scanContext, null, 2) : 'Nu există date de scanare. Sugerează rularea unei scanări.'}

Capabilitățile tale:
- Poți analiza rapoarte de sănătate ale sistemului
- Poți explica problemele găsite și cum să le rezolvi
- Poți sugera îmbunătățiri și noi skill-uri
- Poți ghida administratorul prin procesul de reparare
- Poți explica ce face fiecare componentă a sistemului

Răspunde în română, concis, practic și prietenos. Dacă ți se cere să "repari" ceva, explică ce acțiune va fi luată și confirmă.`;

    let reply = 'Nu am putut procesa cererea. Verificați configurația AI.';

    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model:      'claude-3-haiku-20240307',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: message }],
      });
      reply = msg.content[0]?.text || reply;
    } else if (process.env.OPENAI_API_KEY) {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await openai.chat.completions.create({
        model:    'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: message },
        ],
        max_tokens: 1024,
      });
      reply = resp.choices[0].message.content || reply;
    } else if (process.env.GROQ_API_KEY) {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body:    JSON.stringify({
          model:    'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          max_tokens: 1024,
        }),
      });
      const data = await resp.json();
      reply = data.choices?.[0]?.message?.content || reply;
    }

    res.json({ reply, hasContext: !!scanContext });
  } catch (e) {
    logger.error({ component: 'Healer.Chat', err: e.message }, 'Chat failed');
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/healer/scheduler/status — starea scheduler-ului
// ─────────────────────────────────────────────────────────────
router.get('/scheduler/status', requireAdmin, (req, res) => {
  try {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) return res.json({ started: false, message: 'Scheduler not initialized' });
    res.json(scheduler.getStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/healer/scheduler/trigger — declanșează manual scan
// ─────────────────────────────────────────────────────────────
router.post('/scheduler/trigger', requireAdmin, async (req, res) => {
  try {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) return res.status(503).json({ error: 'Scheduler not initialized' });

    logger.info({ component: 'Healer.Scheduler', admin: req.user?.id }, 'Manual healing scan triggered');

    // Răspunde imediat, scan rulează în background
    res.json({ ok: true, message: 'Healing scan triggered — email alert will be sent if issues found.' });

    // Rulează async în background
    scheduler.triggerHealingScan().catch(e => {
      logger.error({ component: 'Healer.Scheduler', err: e.message }, 'Manual scan failed');
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/healer/scheduler/credit-check — verificare manuală credite
// ─────────────────────────────────────────────────────────────
router.post('/scheduler/credit-check', requireAdmin, async (req, res) => {
  try {
    const scheduler = req.app.locals.scheduler;
    if (!scheduler) return res.status(503).json({ error: 'Scheduler not initialized' });

    res.json({ ok: true, message: 'Credit check triggered — alerts will be sent for low-credit users.' });

    scheduler.triggerCreditCheck().catch(e => {
      logger.error({ component: 'Healer.Scheduler', err: e.message }, 'Manual credit check failed');
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/healer/alert/test — trimite email de test admin
// ─────────────────────────────────────────────────────────────
router.post('/alert/test', requireAdmin, async (req, res) => {
  try {
    const alerts = req.app.locals.alerts;
    if (!alerts) return res.status(503).json({ error: 'Alerts module not initialized' });

    const { type = 'healing' } = req.body;

    let result;
    if (type === 'credit') {
      result = await alerts.alertCreditLow({
        userId:      'test-user-id',
        email:       req.body.email || process.env.ADMIN_EMAIL || 'admin@kelionai.com',
        creditsLeft: 3,
        plan:        'free',
        threshold:   10,
      });
    } else if (type === 'ai') {
      result = await alerts.alertAIStatus({
        provider:     'openai',
        status:       'down',
        errorRate:    0.85,
        lastError:    'Test alert — connection timeout',
        affectedUsers: 0,
      });
    } else if (type === 'error') {
      result = await alerts.alertCriticalError({
        component: 'TestComponent',
        error:     'Test critical error alert',
        stack:     'Error: Test\n    at TestComponent (/server/test.js:1:1)',
        context:   { triggeredBy: 'admin', testMode: true },
      });
    } else {
      // Default: healing report test
      result = await alerts.alertHealingReport({
        scanResult: {
          score: 72,
          stats: { totalIssues: 3, critical: 1, high: 1, medium: 1, low: 0 },
          issues: [
            { severity: 'critical', message: 'Test: ANTHROPIC_API_KEY missing', component: 'env', action: 'add_key' },
            { severity: 'high',     message: 'Test: Database connection slow', component: 'database' },
            { severity: 'medium',   message: 'Test: nodemailer not installed', component: 'dependencies' },
          ],
        },
        aiAnalysis: { summary: 'Acesta este un email de test pentru sistemul de alertă KelionAI. Sistemul funcționează corect.' },
        healed:      ['Test: nodemailer installed automatically'],
        failed:      [],
        triggeredBy: 'admin-test',
      });
    }

    res.json({ ok: result?.ok, provider: result?.provider, reason: result?.reason });
  } catch (e) {
    logger.error({ component: 'Healer.Alert', err: e.message }, 'Alert test failed');
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;