/**
 * Audit M6 — handoff double-start guard.
 *
 * KelionStage's auto-fallback runs in two effects on consecutive
 * commits:
 *
 *   (1) transport status === 'error' on the outgoing provider →
 *       snapshot `turns`, stash them in `pendingFallbackTurnsRef`,
 *       set `pendingFallbackRef`, flip `liveProvider`.
 *   (2) `liveProvider` changed → read the snapshot and call
 *       `activeHook.start({ priorTurns })` on the incoming provider.
 *
 * Between those two commits the user can physically tap the
 * Kelion button or trigger the wake-word. That queues another
 * `start()` on the same hook. The hook's `startInFlightRef` lock
 * rejects concurrent starts, so one of them wins and the other is
 * silently dropped. Without the guard here:
 *
 *   (a) If the user's tap wins, effect (2) fires AFTER it and
 *       calls `start({ priorTurns })`. The hook rejects the call
 *       because a session is already opening, `pendingFallbackTurnsRef`
 *       is reset to `[]` before the guard check, and the handoff
 *       context is LOST — Kelion re-greets on the new provider.
 *       (This is the bug the user flagged as M6.)
 *
 *   (b) If the user's tap loses (handoff wins), the user presses
 *       again; the hook now accepts a second start() with empty
 *       `priorTurns`. The second call `close()`s the first ws as
 *       part of its normal cleanup, tearing down the handoff
 *       session mid-connect, again losing context.
 *
 * The fix is small and pure: before effect (2) touches the hook,
 * ask whether the hook is already busy (`isBusy()` — a snapshot
 * of `startInFlightRef` + the live-transport ref). If it is,
 * the user has already started a fresh session — we SKIP the
 * handoff start entirely and let their fresh session greet
 * cleanly. The prior turns are preserved in React state on the
 * outgoing hook (not wiped) and remain visible in the chat
 * transcript for the user's own reference; we simply do not
 * inject them into the new provider's persona.
 *
 * This module exposes one pure function so the rule can be
 * exercised with plain Jest — the hook's WebSocket/RTCPeerConnection
 * machinery does not have to spin up.
 */

/**
 * @typedef {Object} HandoffDecisionInput
 * @property {boolean} pending
 *   The `pendingFallbackRef.current` flag set by effect (1). False
 *   means effect (2) has nothing to do.
 * @property {boolean} hookBusy
 *   Result of `activeHook.isBusy()`. True when `startInFlightRef`
 *   is set, or when the live transport (ws/pc) is not CLOSED.
 *   A busy hook means another caller — almost certainly a user
 *   tap/wake-word — has already taken ownership of the new
 *   session; we must not trample it.
 * @property {number} priorTurnCount
 *   How many entries are in the snapshot. Used only for
 *   observability: zero turns means there is nothing to hand off,
 *   so skipping has no cost.
 */

/**
 * @typedef {Object} HandoffDecision
 * @property {'start' | 'skip-not-pending' | 'skip-busy' | 'skip-empty'} action
 *   What effect (2) should do. `start` = call
 *   `activeHook.start({ priorTurns })`. `skip-*` = do nothing.
 * @property {string} reason
 *   A short human-readable explanation suitable for
 *   `console.warn` so operators can see the call was a no-op.
 */

/**
 * Decide whether to proceed with a handoff start call. Pure —
 * no refs, no side effects.
 *
 * @param {HandoffDecisionInput} input
 * @returns {HandoffDecision}
 */
export function decideHandoff(input) {
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
    // The important case — user's manual start is already running
    // on the new provider. Do NOT double-call start().
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
    // Effect (1) fires even when the outgoing hook had no turns
    // yet (e.g. transport died during the first mic warmup). No
    // point spinning up a new session here — let the user tap
    // themselves when they are ready.
    return {
      action: 'skip-empty',
      reason: 'no prior turns to carry over — auto-fallback handoff is a no-op',
    };
  }
  return { action: 'start', reason: 'handoff accepted' };
}
