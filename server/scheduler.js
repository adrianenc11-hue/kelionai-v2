// ═══════════════════════════════════════════════════════════════
// KelionAI — Scheduler
// Periodic tasks: self-healing scan, API key audit, credit checks
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

// Lazy imports to avoid circular deps at startup
let _healerModule   = null;
let _alertsModule   = null;
let _supabaseAdmin  = null;

function _getHealer() {
  if (!_healerModule) _healerModule = require('./brain-healer');
  return _healerModule;
}

function _getAlerts() {
  if (!_alertsModule) _alertsModule = require('./alerts');
  return _alertsModule;
}

// ── Scheduler state ──
const _timers   = new Map();
let   _started  = false;

// ─────────────────────────────────────────────────────────────
// TASK: Self-Healing Auto-Scan
// Runs every 6 hours, sends email alert if issues found
// ─────────────────────────────────────────────────────────────
async function runHealingScan(triggeredBy = 'scheduler') {
  const healer  = _getHealer();
  const alerts  = _getAlerts();

  try {
    logger.info({ component: 'Scheduler', task: 'healing-scan', triggeredBy }, 'Starting auto healing scan...');

    const scanResult = await healer.scanSystem(_supabaseAdmin);
    const score      = scanResult?.score ?? 100;
    const issues     = scanResult?.stats?.totalIssues ?? 0;
    const critical   = scanResult?.stats?.critical ?? 0;

    logger.info({ component: 'Scheduler', score, issues, critical }, 'Auto scan complete');

    // Auto-heal non-critical issues
    const healed  = [];
    const failed  = [];

    if (issues > 0 && scanResult?.issues?.length > 0) {
      const autoHealable = scanResult.issues.filter(
        iss => iss.severity !== 'critical' && iss.action && iss.autoHeal !== false
      );

      for (const issue of autoHealable.slice(0, 5)) { // max 5 auto-heals per scan
        try {
          await healer.healIssue(issue, _supabaseAdmin, { silent: true });
          healed.push(issue.message || issue.description || issue.action);
          logger.info({ component: 'Scheduler', issue: issue.action }, 'Auto-healed issue');
        } catch (e) {
          failed.push(issue.message || issue.action);
          logger.warn({ component: 'Scheduler', issue: issue.action, err: e.message }, 'Auto-heal failed');
        }
      }
    }

    // Generate AI analysis for critical issues
    let aiAnalysis = null;
    if (critical > 0 || score < 60) {
      try {
        aiAnalysis = await healer.generateAIReport(scanResult);
      } catch (_e) { /* non-fatal */ }
    }

    // Save report to DB
    try {
      await healer.saveScanReport(scanResult, aiAnalysis, _supabaseAdmin);
    } catch (_e) { /* non-fatal */ }

    // Send email alert if there are issues
    await alerts.alertHealingReport({
      scanResult,
      aiAnalysis,
      healed,
      failed,
      triggeredBy,
    });

    return { score, issues, critical, healed: healed.length, failed: failed.length };
  } catch (e) {
    logger.error({ component: 'Scheduler', task: 'healing-scan', err: e.message }, 'Auto scan failed');
    try {
      await _getAlerts().alertCriticalError({
        component: 'Scheduler.HealingScan',
        error: e.message,
        stack: e.stack,
      });
    } catch (_e) { /* non-fatal */ }
    return null;
  }
}

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

  // ── Self-Healing: every 6 hours ──
  const HEALING_INTERVAL = parseInt(process.env.HEALING_INTERVAL_MS || String(6 * 60 * 60 * 1000));
  const healingTimer = setInterval(() => runHealingScan('scheduler'), HEALING_INTERVAL);
  healingTimer.unref(); // Don't block process exit
  _timers.set('healing', healingTimer);

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

  // ── Initial scan after 2 minutes (let server warm up) ──
  const initialTimer = setTimeout(() => runHealingScan('startup'), 2 * 60 * 1000);
  initialTimer.unref();
  _timers.set('initial', initialTimer);

  logger.info({
    component: 'Scheduler',
    healingEvery:  `${HEALING_INTERVAL / 3600000}h`,
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
async function triggerHealingScan() {
  return runHealingScan('manual');
}

async function triggerCreditCheck() {
  return runCreditCheck();
}

module.exports = { start, stop, getStatus, triggerHealingScan, triggerCreditCheck };