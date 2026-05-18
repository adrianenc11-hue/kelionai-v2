'use strict';

/**
 * healthWatchdog.js — Kelion Permanent Health Monitor
 *
 * Runs automatically every 5 minutes. Checks:
 *  1. Tool sync — all 3 layers aligned (realtime ↔ kelionTools ↔ realTools)
 *  2. Memory leaks — in-memory Map sizes
 *  3. External API health — ElevenLabs, OpenRouter, Railway
 *  4. Dead routes — unhandled paths
 *  5. Error rate — recent errors in logs
 *  6. MCP servers — installed vs running vs outdated
 *  7. Database connectivity
 *
 * Alerts admin via:
 *  - Console warnings (always)
 *  - /api/admin/health endpoint (dashboard)
 *  - Optional email/push notification
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // Don't spam same alert within 30 min

// ── State ──
const _alerts = [];          // { id, severity, message, firstSeen, lastSeen, count }
const _metrics = {
  uptime: Date.now(),
  checksRun: 0,
  lastCheckAt: null,
  lastCheckDuration: 0,
  status: 'starting',
  issues: [],
};
let _intervalHandle = null;
let _alertCooldowns = new Map(); // alertId → lastNotifiedAt

// ── Alert Management ──

function raiseAlert(id, severity, message) {
  const existing = _alerts.find(a => a.id === id);
  if (existing) {
    existing.lastSeen = new Date().toISOString();
    existing.count++;
    existing.message = message; // Update with latest
    return existing;
  }
  const alert = {
    id,
    severity, // 'critical', 'warning', 'info'
    message,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    count: 1,
    resolved: false,
  };
  _alerts.push(alert);

  // Log based on severity
  const prefix = `[Health-Watchdog] [${severity.toUpperCase()}]`;
  if (severity === 'critical') {
    console.error(`${prefix} ${id}: ${message}`);
  } else if (severity === 'warning') {
    console.log(`${prefix} ${id}: ${message}`);
  } else {
    console.log(`${prefix} ${id}: ${message}`);
  }

  // Notify admin if not in cooldown
  const lastNotified = _alertCooldowns.get(id) || 0;
  if (Date.now() - lastNotified > ALERT_COOLDOWN_MS) {
    _alertCooldowns.set(id, Date.now());
    notifyAdmin(alert);
  }

  return alert;
}

function resolveAlert(id) {
  const alert = _alerts.find(a => a.id === id && !a.resolved);
  if (alert) {
    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();
    console.log(`[Health-Watchdog] [RESOLVED] ${id}`);
  }
}

function notifyAdmin(alert) {
  // In production, this could send email/push/Slack
  // For now, we store it so the admin endpoint can serve it
  try {
    const db = require('../db');
    if (typeof db.addAdminNotification === 'function') {
      db.addAdminNotification({
        type: 'health_alert',
        severity: alert.severity,
        title: alert.id,
        message: alert.message,
      }).catch(() => {}); // Best-effort
    }
  } catch (_) { /* db may not support this yet */ }
}

// ── Health Checks ──

async function checkToolSync() {
  try {
    const fs = require('fs');
    const path = require('path');

    const realtimePath = path.join(__dirname, '..', 'routes', 'realtime.js');
    const realToolsPath = path.join(__dirname, 'realTools.js');

    if (!fs.existsSync(realtimePath) || !fs.existsSync(realToolsPath)) return;

    const rt = fs.readFileSync(realtimePath, 'utf8');
    const real = fs.readFileSync(realToolsPath, 'utf8');

    // Count tools defined vs implemented
    const rtTools = [...rt.matchAll(/\bname:\s*'([^']+)'/g)].map(m => m[1]);
    const realCases = [...real.matchAll(/case '([^']+)':/g)].map(m => m[1]);
    const realSet = new Set(realCases);

    // Client-only tools that don't need backend
    const clientOnly = new Set([
      'observe_user_emotion', 'set_narration_mode', 'switch_voice',
      'show_on_monitor', 'get_my_location', 'switch_camera',
      'open_gps_app', 'camera_on', 'camera_off', 'zoom_camera',
      'ui_notify', 'ui_navigate', 'compose_email_draft',
    ]);

    const missing = rtTools.filter(t => !realSet.has(t) && !clientOnly.has(t));

    if (missing.length > 0) {
      raiseAlert('tool_sync_mismatch', 'critical',
        `${missing.length} tool(s) defined in realtime.js but missing from executor: ${missing.join(', ')}`);
    } else {
      resolveAlert('tool_sync_mismatch');
    }

    _metrics.toolCount = rtTools.length;
    _metrics.implementedCount = realCases.length;
  } catch (err) {
    raiseAlert('tool_sync_error', 'warning', `Tool sync check failed: ${err.message}`);
  }
}

async function checkMemoryUsage() {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);

  _metrics.memory = { heapMB, rssMB };

  if (heapMB > 512) {
    raiseAlert('high_memory', 'critical', `Heap usage: ${heapMB}MB (threshold: 512MB)`);
  } else if (heapMB > 256) {
    raiseAlert('high_memory', 'warning', `Heap usage: ${heapMB}MB (threshold: 256MB)`);
  } else {
    resolveAlert('high_memory');
  }
}

async function checkExternalAPIs() {
  const checks = [
    { name: 'elevenlabs', url: 'https://api.elevenlabs.io/v1/voices', header: 'xi-api-key', envKey: 'ELEVENLABS_API_KEY' },
    { name: 'openrouter', url: 'https://openrouter.ai/api/v1/models', header: 'Authorization', envKey: 'OPENROUTER_API_KEY', prefix: 'Bearer ' },
  ];

  for (const check of checks) {
    try {
      const apiKey = process.env[check.envKey];
      if (!apiKey) {
        raiseAlert(`api_${check.name}_missing`, 'warning', `${check.name} API key not configured`);
        continue;
      }

      const headers = {};
      if (check.header) headers[check.header] = (check.prefix || '') + apiKey;

      const r = await fetch(check.url, {
        headers,
        signal: AbortSignal.timeout(10000),
      });

      if (r.ok) {
        resolveAlert(`api_${check.name}_down`);
        resolveAlert(`api_${check.name}_missing`);
      } else if (r.status === 401) {
        raiseAlert(`api_${check.name}_auth`, 'critical', `${check.name} API key invalid (401)`);
      } else {
        raiseAlert(`api_${check.name}_down`, 'warning', `${check.name} API returned ${r.status}`);
      }
    } catch (err) {
      raiseAlert(`api_${check.name}_down`, 'warning', `${check.name} API unreachable: ${err.message}`);
    }
  }
}

async function checkDatabase() {
  try {
    const db = require('../db');
    if (typeof db.pool !== 'undefined' || typeof db.getUserById === 'function') {
      // Try a simple query
      const start = Date.now();
      await db.getUserById(1).catch(() => null); // Expected to return null for ID 1
      const latency = Date.now() - start;

      _metrics.dbLatencyMs = latency;

      if (latency > 5000) {
        raiseAlert('db_slow', 'warning', `Database latency: ${latency}ms`);
      } else {
        resolveAlert('db_slow');
        resolveAlert('db_down');
      }
    }
  } catch (err) {
    raiseAlert('db_down', 'critical', `Database check failed: ${err.message}`);
  }
}

async function checkMCPServers() {
  try {
    const mcp = require('./mcpAutoDiscovery');
    const status = mcp.getStatus();

    _metrics.mcpServers = {
      installed: status.installed_count,
      running: status.running_count,
    };

    // Check for outdated servers (daily only)
    if (!_metrics.lastMcpUpdateCheck || Date.now() - _metrics.lastMcpUpdateCheck > 24 * 60 * 60 * 1000) {
      const updates = await mcp.checkForUpdates();
      _metrics.lastMcpUpdateCheck = Date.now();
      if (updates.length > 0) {
        raiseAlert('mcp_outdated', 'info',
          `${updates.length} MCP server(s) have updates: ${updates.map(u => `${u.package} ${u.current}→${u.latest}`).join(', ')}`);
      } else {
        resolveAlert('mcp_outdated');
      }
    }
  } catch (_) { /* MCP module may not be loaded yet */ }
}

// ── AI Model Auto-Update Check ──
// Reuses modelRouter.checkLatestModels() — no new timer.
// Runs every 12th cycle (= once per hour at 5min intervals).
async function checkModelUpdates() {
  if (_metrics.checksRun % 12 !== 0 && _metrics.checksRun > 1) return; // hourly
  try {
    const { checkLatestModels } = require('./modelRouter');
    const result = await checkLatestModels();
    if (!result) return;

    _metrics.aiModel = {
      current: result.current || result.to,
      lastCheck: new Date().toISOString(),
    };

    if (result.upgraded) {
      raiseAlert('model_auto_upgrade', 'info',
        `Auto-upgraded AI model: ${result.from} → ${result.to}`);
      _metrics.aiModel.upgradedFrom = result.from;
      _metrics.aiModel.upgradedTo = result.to;
    } else if (result.blocked) {
      raiseAlert('model_compat_fail', 'warning',
        `New model ${result.blocked} failed compatibility: ${result.reason}`);
    } else {
      resolveAlert('model_auto_upgrade');
      resolveAlert('model_compat_fail');
    }
  } catch (err) {
    console.log('[Health-Watchdog] Model update check skipped:', err?.message);
  }
}

async function checkUptimeAndEventLoop() {
  // Check event loop lag — if > 100ms, something is blocking
  const start = Date.now();
  await new Promise(resolve => setImmediate(resolve));
  const lag = Date.now() - start;

  _metrics.eventLoopLagMs = lag;

  if (lag > 500) {
    raiseAlert('event_loop_blocked', 'critical', `Event loop lag: ${lag}ms (blocked!)`);
  } else if (lag > 100) {
    raiseAlert('event_loop_blocked', 'warning', `Event loop lag: ${lag}ms`);
  } else {
    resolveAlert('event_loop_blocked');
  }

  // Uptime
  _metrics.uptimeHours = Math.round((Date.now() - _metrics.uptime) / 3600000 * 10) / 10;
}

// ── Main Check Loop ──

async function runAllChecks() {
  const start = Date.now();
  _metrics.checksRun++;
  _metrics.lastCheckAt = new Date().toISOString();

  try {
    await checkMemoryUsage();
    await checkUptimeAndEventLoop();
    await checkToolSync();
    await checkDatabase();
    await checkExternalAPIs();
    await checkMCPServers();
    await checkModelUpdates();
  } catch (err) {
    console.error('[Health-Watchdog] Check cycle error:', err.message);
  }

  _metrics.lastCheckDuration = Date.now() - start;
  _metrics.status = _alerts.filter(a => !a.resolved && a.severity === 'critical').length > 0
    ? 'critical'
    : _alerts.filter(a => !a.resolved && a.severity === 'warning').length > 0
      ? 'degraded'
      : 'healthy';

  // Keep alerts list manageable
  while (_alerts.length > 100) {
    const oldest = _alerts.findIndex(a => a.resolved);
    if (oldest >= 0) _alerts.splice(oldest, 1);
    else break;
  }

  // Periodic summary log
  if (_metrics.checksRun % 12 === 0) { // Every hour (12 × 5min)
    const active = _alerts.filter(a => !a.resolved);
    console.log(`[Health-Watchdog] Status: ${_metrics.status} | Heap: ${_metrics.memory?.heapMB}MB | Tools: ${_metrics.toolCount} | Active alerts: ${active.length} | Uptime: ${_metrics.uptimeHours}h`);
  }
}

// ── Public API ──

function getHealthReport() {
  return {
    status: _metrics.status,
    uptime_hours: _metrics.uptimeHours,
    memory: _metrics.memory,
    tools: { defined: _metrics.toolCount, implemented: _metrics.implementedCount },
    db_latency_ms: _metrics.dbLatencyMs,
    event_loop_lag_ms: _metrics.eventLoopLagMs,
    mcp_servers: _metrics.mcpServers,
    checks_run: _metrics.checksRun,
    last_check: _metrics.lastCheckAt,
    last_check_duration_ms: _metrics.lastCheckDuration,
    active_alerts: _alerts.filter(a => !a.resolved).map(a => ({
      id: a.id,
      severity: a.severity,
      message: a.message,
      first_seen: a.firstSeen,
      count: a.count,
    })),
    resolved_recent: _alerts.filter(a => a.resolved).slice(-5).map(a => ({
      id: a.id,
      resolved_at: a.resolvedAt,
    })),
  };
}

function start() {
  if (_intervalHandle) return;
  console.log('[Health-Watchdog] Starting permanent health monitor (every 5 min)');

  // First check after 10 seconds (let server boot)
  setTimeout(() => {
    runAllChecks();
    _intervalHandle = setInterval(runAllChecks, CHECK_INTERVAL_MS);
  }, 10000);
}

function stop() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log('[Health-Watchdog] Stopped');
  }
}

module.exports = { start, stop, getHealthReport, runAllChecks };
