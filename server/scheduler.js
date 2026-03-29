// ═══════════════════════════════════════════════════════════════
// KelionAI — Scheduler
// Periodic tasks: credit checks, AI health
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

// Lazy imports to avoid circular deps at startup
let _alertsModule   = null;
let _supabaseAdmin  = null;

function _getAlerts() {
  if (!_alertsModule) _alertsModule = require('./alerts');
  return _alertsModule;
}

// ── Scheduler state ──
const _timers   = new Map();
let   _started  = false;

// ─────────────────────────────────────────────────────────────
// TASK: Credit Check
// Runs every 30 minutes, checks users with low credits
// ─────────────────────────────────────────────────────────────
async function runCreditCheck() {
  if (!_supabaseAdmin) return;
  const alerts = _getAlerts();

  try {
    logger.debug({ component: 'Scheduler', task: 'credit-check' }, 'Running credit check...');

    // Query users with low credits (< 10) who haven't been alerted recently
    const { data: lowCreditUsers, error } = await _supabaseAdmin
      .from('users')
      .select('id, email, credits, plan')
      .lt('credits', 10)
      .order('credits', { ascending: true })
      .limit(50);

    if (error) {
      logger.warn({ component: 'Scheduler', err: error.message }, 'Credit check DB error');
      return;
    }

    if (!lowCreditUsers?.length) return;

    logger.info({ component: 'Scheduler', count: lowCreditUsers.length }, 'Low credit users found');

    for (const user of lowCreditUsers) {
      try {
        await alerts.alertCreditLow({
          userId:      user.id,
          email:       user.email,
          creditsLeft: user.credits ?? 0,
          plan:        user.plan || 'free',
          threshold:   10,
        });
      } catch (_e) { /* non-fatal per user */ }
    }
  } catch (e) {
    logger.warn({ component: 'Scheduler', task: 'credit-check', err: e.message }, 'Credit check failed');
  }
}

// ─────────────────────────────────────────────────────────────
// TASK: AI Provider Health Check
// Runs every 15 minutes, checks circuit breaker states
// ─────────────────────────────────────────────────────────────
async function runAIHealthCheck() {
  const alerts = _getAlerts();

  try {
    // Check circuit breaker states if available
    let scalability = null;
    try { scalability = require('./scalability'); } catch (_e) { return; }

    const providers = ['openai', 'anthropic', 'groq', 'deepseek', 'gemini'];
    for (const provider of providers) {
      try {
        const allowed = scalability.circuitAllow(provider);
        if (!allowed) {
          await alerts.alertAIStatus({
            provider,
            status:    'down',
            errorRate: 1.0,
            lastError: 'Circuit breaker open — too many failures',
          });
        }
      } catch (_e) { /* provider not tracked */ }
    }
  } catch (e) {
    logger.debug({ component: 'Scheduler', task: 'ai-health', err: e.message }, 'AI health check skipped');
  }
}

// ─────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────
function start(supabaseAdmin) {
  if (_started) {
    logger.warn({ component: 'Scheduler' }, 'Scheduler already started — skipping');
    return;
  }

  _supabaseAdmin = supabaseAdmin;
  _started       = true;

  logger.info({ component: 'Scheduler' }, '⏰ Scheduler starting...');

  // ── Credit Check: every 30 minutes ──
  const CREDIT_INTERVAL = parseInt(process.env.CREDIT_CHECK_INTERVAL_MS || String(30 * 60 * 1000));
  const creditTimer = setInterval(() => runCreditCheck(), CREDIT_INTERVAL);
  creditTimer.unref();
  _timers.set('credit', creditTimer);

  // ── AI Health: every 15 minutes ──
  const AI_HEALTH_INTERVAL = parseInt(process.env.AI_HEALTH_INTERVAL_MS || String(15 * 60 * 1000));
  const aiTimer = setInterval(() => runAIHealthCheck(), AI_HEALTH_INTERVAL);
  aiTimer.unref();
  _timers.set('ai-health', aiTimer);

  logger.info({
    component: 'Scheduler',
    creditEvery:   `${CREDIT_INTERVAL / 60000}min`,
    aiHealthEvery: `${AI_HEALTH_INTERVAL / 60000}min`,
  }, '✅ Scheduler started');
}

function stop() {
  for (const [name, timer] of _timers) {
    clearInterval(timer);
    clearTimeout(timer);
    logger.debug({ component: 'Scheduler', timer: name }, 'Timer stopped');
  }
  _timers.clear();
  _started = false;
  logger.info({ component: 'Scheduler' }, 'Scheduler stopped');
}

function getStatus() {
  return {
    started:  _started,
    timers:   Array.from(_timers.keys()),
    hasDB:    !!_supabaseAdmin,
  };
}

// ── Manual trigger (for admin API) ──
async function triggerCreditCheck() {
  return runCreditCheck();
}

module.exports = { start, stop, getStatus, triggerCreditCheck };