'use strict';

/**
 * Audit H3 — server-side global handlers for unhandled promise rejections
 * and uncaught exceptions.
 *
 * Before this module, any `await foo()` inside an Express handler that
 * bubbled an unawaited rejection (e.g. a fetch with no `.catch`, a
 * setTimeout callback that threw, a background job) would trigger a
 * default Node 15+ behaviour: *terminate the process*. Railway would
 * restart within a few seconds, but every in-flight WebSocket (Gemini
 * Live, OpenAI Realtime) would get a mid-sentence disconnect and the
 * user would see a cryptic "reconnecting…" toast.
 *
 * Policy here:
 *
 *   1. `unhandledRejection` → log with the rejection reason + stack,
 *      increment a counter, but **do not exit**. These are almost
 *      always a missing `.catch()` on a promise chain; the rest of the
 *      process is fine and every other connected user should stay up.
 *
 *   2. `uncaughtException` → log + increment counter + exit cleanly.
 *      Node docs are explicit that the process state is undefined
 *      after a synchronous throw escapes; continuing to run risks
 *      leaked file descriptors, DB pool corruption, etc. We prefer a
 *      clean restart (Railway will spin a replacement in < 5 s) over
 *      running in a bad state.
 *
 *   3. `warning` → log once per warning type (first occurrence only)
 *      so `MaxListenersExceededWarning` / memory-leak warnings are
 *      visible without flooding Railway logs.
 *
 * Everything is counted on a small `stats` object so the `/api/diag`
 * endpoint can surface them for dashboards.
 *
 * Exported as a factory so unit tests can install a dedicated handler
 * on a stubbed `process`-like object.
 */

/**
 * @typedef {Object} ProcessHandlerStats
 * @property {number} unhandledRejections
 * @property {number} uncaughtExceptions
 * @property {number} warnings
 * @property {string|null} lastReason   — serialized stack or message
 * @property {number|null} lastAt       — epoch ms of the most recent event
 */

/** Creates a fresh stats object. */
function createStats() {
  return {
    unhandledRejections: 0,
    uncaughtExceptions: 0,
    warnings: 0,
    lastReason: null,
    lastAt: null,
  };
}

/** Normalises any rejection/exception reason into a loggable string. */
function serializeReason(reason) {
  if (reason == null) return String(reason);
  if (reason instanceof Error) {
    return reason.stack || `${reason.name}: ${reason.message}`;
  }
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Installs the handlers on a `process`-like target. Returns a control
 * object with `stats` + an `uninstall()` method (used by tests).
 *
 * Options:
 *   - `logger`            — object with `.warn` and `.error` (defaults to `console`)
 *   - `exitOnException`   — whether to `process.exit(1)` after uncaughtException
 *                           (defaults to true; tests pass false so Jest doesn't die)
 *   - `exit`              — exit fn (defaults to `process.exit`; tests pass a spy)
 *   - `now`               — time fn (defaults to `Date.now`; tests pass a fake)
 *   - `seenWarnings`      — Set of warning `name`s already logged (for dedup)
 */
function installProcessHandlers(target, options = {}) {
  const logger = options.logger || console;
  const exit = options.exit || ((code) => process.exit(code));
  const now = options.now || (() => Date.now());
  const exitOnException = options.exitOnException !== false;
  const seenWarnings = options.seenWarnings || new Set();

  const stats = createStats();

  const onUnhandledRejection = (reason /* , promise */) => {
    stats.unhandledRejections += 1;
    stats.lastReason = serializeReason(reason);
    stats.lastAt = now();
    logger.error(
      '[process] unhandledRejection — continuing to run',
      { count: stats.unhandledRejections, reason: stats.lastReason },
    );
  };

  const onUncaughtException = (err /* , origin */) => {
    stats.uncaughtExceptions += 1;
    stats.lastReason = serializeReason(err);
    stats.lastAt = now();
    logger.error(
      '[process] uncaughtException — exiting for clean restart',
      { count: stats.uncaughtExceptions, reason: stats.lastReason },
    );
    if (exitOnException) {
      // Give a tick for the logger to flush, then exit.
      try { exit(1); } catch { /* swallow — test spy may throw */ }
    }
  };

  const onWarning = (warning) => {
    const name = (warning && warning.name) || 'Warning';
    if (seenWarnings.has(name)) return;
    seenWarnings.add(name);
    stats.warnings += 1;
    logger.warn(
      '[process] warning (first occurrence)',
      { name, message: warning && warning.message },
    );
  };

  target.on('unhandledRejection', onUnhandledRejection);
  target.on('uncaughtException', onUncaughtException);
  target.on('warning', onWarning);

  return {
    stats,
    uninstall() {
      target.removeListener('unhandledRejection', onUnhandledRejection);
      target.removeListener('uncaughtException', onUncaughtException);
      target.removeListener('warning', onWarning);
    },
  };
}

module.exports = {
  installProcessHandlers,
  serializeReason,
  createStats,
};
