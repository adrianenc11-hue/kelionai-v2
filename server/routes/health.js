// ═══════════════════════════════════════════════════════════════
// KelionAI — Health Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();
const { version } = require('../../package.json');
const crypto = require('crypto');

// ── Admin auth check (same logic as server/index.js) ──
function healthAdminAuth(req, res, next) {
  const secret = (process.env.ADMIN_SECRET_KEY || '').trim();
  const headerSecret = (req.headers['x-admin-secret'] || '').trim();
  if (!secret || !headerSecret) return res.status(404).json({ error: 'Not found' });
  try {
    const sBuf = Buffer.from(secret);
    const hBuf = Buffer.from(headerSecret);
    if (sBuf.length === hBuf.length && crypto.timingSafeEqual(sBuf, hBuf)) return next();
  } catch (err) {
    logger.debug({ component: 'Health', err: err.message }, 'Admin secret comparison failed');
  }
  return res.status(404).json({ error: 'Not found' });
}

// GET /api/health
router.get('/', (req, res) => {
  const { brain } = req.app.locals;
  const diag = brain ? brain.getDiagnostics() : { status: 'no-brain', conversations: 0 };
  res.json({
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    brain: diag.status,
  });
});

// GET /api/health/services — detailed service status (admin only)
router.get('/services', healthAdminAuth, (req, res) => {
  const { brain, supabase, supabaseAdmin } = req.app.locals;
  const diag = brain ? brain.getDiagnostics() : { status: 'no-brain', conversations: 0 };
  res.json({
    status: 'ok',
    version,
    uptime: process.uptime(),
    brain: diag.status,
    conversations: diag.conversations,
    services: {
      ai_gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      ai_gpt4o: !!process.env.OPENAI_API_KEY,
      ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
      tts: !!process.env.ELEVENLABS_API_KEY,
      stt_groq: !!process.env.GROQ_API_KEY,
      stt_openai: !!process.env.OPENAI_API_KEY,
      vision: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      search_perplexity: !!process.env.PERPLEXITY_API_KEY,
      search_tavily: !!process.env.TAVILY_API_KEY,
      search_serper: !!process.env.SERPER_API_KEY,
      search_ddg: true,
      weather: true,
      images: !!process.env.TOGETHER_API_KEY,
      maps: !!process.env.GOOGLE_MAPS_KEY,
      payments: !!process.env.STRIPE_SECRET_KEY,
      stripe_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      session_secret: !!process.env.SESSION_SECRET,
      referral_secret: !!process.env.REFERRAL_SECRET,
      sentry: !!process.env.SENTRY_DSN,
      auth: !!supabase,
      database: !!supabaseAdmin,
    },
  });
});

// GET /api/health/brain-debug — Raw brain error state (admin only)
router.get('/brain-debug', healthAdminAuth, (req, res) => {
  const { brain } = req.app.locals;
  if (!brain) return res.status(503).json({ error: 'no brain' });
  const diag = brain.getDiagnostics();
  res.json({
    uptime: process.uptime(),
    conversations: brain.conversationCount,
    toolErrors: brain.toolErrors,
    errorLog: brain.errorLog.slice(-10),
    status: diag.status,
    degradedTools: diag.degradedTools || diag.failedTools,
    recentErrorCount: diag.recentErrors,
  });
});

// GET /api/health/test-tables — Test all 28 Supabase tables (admin only)
router.get('/test-tables', healthAdminAuth, async (req, res) => {
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
  let passed = 0;
  let failed = 0;

  for (const table of TABLES) {
    try {
      const { error, count } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });

      if (error) {
        failed++;
        results.push({
          table,
          status: 'ERROR',
          error: error.message,
          code: error.code,
          hint: error.hint || null,
        });
      } else {
        passed++;
        results.push({ table, status: 'OK', rowCount: count || 0 });
      }
    } catch (e) {
      failed++;
      results.push({ table, status: 'CRASH', error: e.message });
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
    errors: results.filter((r) => r.status !== 'OK'),
  });
});

// GET /api/health/brain-test — Test brain.think() (admin only)
router.get('/brain-test', healthAdminAuth, async (req, res) => {
  const { brain } = req.app.locals;
  if (!brain) return res.status(503).json({ error: 'no brain' });
  const steps = [];
  try {
    steps.push('start');
    const result = await brain.think('Test: what is 2+2?', 'kira', [], 'ro', null, null, {});
    steps.push('think_done');
    const reply = result.enrichedMessage || result.reply || '';
    const failed = reply.includes('Test: what is 2+2') || !reply || reply.length < 5;
    res.json({
      success: !failed,
      reply: reply.substring(0, 300),
      agent: result.agent?.name || result.agent || 'none',
      toolsUsed: result.toolsUsed || [],
      emotion: result.emotion || 'none',
      thinkTime: result.thinkTime || 0,
      steps,
    });
  } catch (e) {
    steps.push('error: ' + e.message);
    res.status(500).json({ success: false, error: e.message, steps });
  }
});

// GET /api/health/memory-debug — Test memory load (admin only)
router.get('/memory-debug', healthAdminAuth, async (req, res) => {
  const { brain } = req.app.locals;
  if (!brain) return res.status(503).json({ error: 'no brain' });
  const testUserId =
    'guest_' +
    (req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'test');
  try {
    const [textMem, facts] = await Promise.all([
      brain.loadMemory(testUserId, 'text', 5),
      brain.loadFacts(testUserId, 5),
    ]);
    // Also check what userId brain would receive
    const allMem = await brain.loadMemory(null, 'text', 5);
    res.json({
      testUserId,
      reqIp: req.ip,
      textMemories: textMem?.length || 0,
      textSample: (textMem || [])
        .slice(0, 2)
        .map((m) => ({ content: (m.content || '').substring(0, 100), user_id: m.user_id })),
      facts: facts?.length || 0,
      nullUserMem: allMem?.length || 0,
    });
  } catch (e) {
    logger.error({ component: 'Health', err: e.message }, 'memory-debug error');
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
