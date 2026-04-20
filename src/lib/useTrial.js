// Guest trial status hook.
//
// Drives the top-right "Free trial · MM:SS" HUD. Source of truth is the
// server: GET /api/trial/status returns whether the trial applies to
// this request (guests only — signed-in / admin users get
// `applicable: false`), whether the 15-min window has been stamped
// (i.e. the countdown has started), and how much time is left.
//
// We poll on mount and every 10 s while the HUD is active, plus on
// demand (`refresh()`) right after the user performs a gated action
// (sends a chat message, presses Tap-to-talk). That way the timer
// kicks in immediately on first action without relying on client-side
// clocks to guess when the server stamped.
//
// Between polls we locally tick down `remainingMs` at 1 Hz so the HUD
// looks live. A single setInterval per mount is fine — no expensive
// re-renders happen outside the HUD itself.
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 10_000;
const TICK_MS = 1_000;

/**
 * @param {object} opts
 * @param {boolean} opts.signedIn — when true we skip polling entirely and
 *   collapse the HUD. The server returns `applicable: false` in this case
 *   anyway; this flag is just a latency hedge so the HUD disappears the
 *   moment the user finishes signing in without waiting for the next poll.
 */
export function useTrial({ signedIn } = {}) {
  const [state, setState] = useState({
    applicable: false,
    allowed:    true,
    remainingMs: 0,
    windowMs:    15 * 60 * 1000,
    stamped:     false,
    loaded:      false,
  });
  const lastFetchAtRef = useRef(0);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/trial/status', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) return;
      const data = await r.json();
      lastFetchAtRef.current = Date.now();
      setState({
        applicable:   !!data.applicable,
        allowed:      !!data.allowed,
        remainingMs:  Math.max(0, Number(data.remainingMs) || 0),
        windowMs:     Math.max(1, Number(data.windowMs) || 15 * 60 * 1000),
        stamped:      !!data.stamped,
        loaded:       true,
      });
    } catch (_) {
      // Network errors are non-fatal — we just leave the previous state
      // in place and try again on the next tick.
    }
  }, []);

  // Poll on mount + every POLL_MS while not signed in. When the user
  // signs in we flush local state to `applicable: false` immediately
  // and stop polling.
  useEffect(() => {
    if (signedIn) {
      setState((s) => ({ ...s, applicable: false, stamped: false, loaded: true }));
      return undefined;
    }
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(id);
  }, [signedIn, fetchStatus]);

  // 1 Hz local tick for smooth countdown UI. We decrement `remainingMs`
  // based on elapsed wall-clock since the last server poll, so we don't
  // drift across tab-sleeps.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!state.applicable || !state.stamped || !state.allowed) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [state.applicable, state.stamped, state.allowed]);
  void tick;

  const now = Date.now();
  const elapsedSincePoll = Math.max(0, now - lastFetchAtRef.current);
  const effectiveRemainingMs = state.stamped
    ? Math.max(0, state.remainingMs - elapsedSincePoll)
    : state.remainingMs;

  return {
    applicable: state.applicable,
    allowed:    state.allowed,
    stamped:    state.stamped,
    remainingMs: effectiveRemainingMs,
    windowMs:   state.windowMs,
    loaded:     state.loaded,
    // Call this after any gated action (chat send, Tap-to-talk) so
    // the UI reflects the freshly-stamped window without waiting for
    // the next 10-second poll.
    refresh:    fetchStatus,
  };
}
