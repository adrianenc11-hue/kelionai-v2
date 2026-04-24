'use strict';

/**
 * Audit M6 — backend/test-runtime twin of src/lib/handoffGuard.js.
 *
 * The frontend module ships as ES module so Vite can consume it
 * directly. Jest runs without a babel/ESM transform and would fail
 * to `require()` that file. Rather than add transform infra, we
 * keep a tiny CJS twin here so the decision logic can be exercised
 * with plain Jest.
 *
 * IF YOU EDIT THE LOGIC, EDIT BOTH FILES. A regression test in
 * server/__tests__/handoff-guard.test.js compares the two by
 * running the same input matrix against this file.
 *
 * See src/lib/handoffGuard.js for the problem statement and full
 * docstrings.
 */

function decideHandoff(input) {
  const pending = !!(input && input.pending);
  const busy    = !!(input && input.hookBusy);
  const count   = Number(input && input.priorTurnCount) || 0;

  if (!pending) {
    return {
      action: 'skip-not-pending',
      reason: 'no pending fallback flag — effect (1) did not fire',
    };
  }
  if (busy) {
    return {
      action: 'skip-busy',
      reason: (
        'incoming hook is already starting or live — user beat the '
        + 'auto-fallback effect; dropping handoff to avoid clobbering '
        + 'the fresh session'
      ),
    };
  }
  if (count === 0) {
    return {
      action: 'skip-empty',
      reason: 'no prior turns to carry over — auto-fallback handoff is a no-op',
    };
  }
  return { action: 'start', reason: 'handoff accepted' };
}

module.exports = { decideHandoff };
