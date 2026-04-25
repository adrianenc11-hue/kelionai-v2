/**
 * Audit H4 — client-side global error reporter.
 *
 * Before this module, any uncaught exception or unhandled promise
 * rejection inside the React app (a voice hook throws, a WebAudio
 * graph node rejects, a useEffect cleanup with a bad fetch) died
 * silently in the user's browser. No server telemetry, no user-facing
 * feedback, and the next action from the user often hit an app in a
 * subtly-broken state with no record of why.
 *
 * Policy:
 *   * `window.addEventListener('error')` catches sync exceptions +
 *     resource-load failures (ignored — too much noise on images).
 *   * `window.addEventListener('unhandledrejection')` catches promise
 *     rejections that were never `.catch()`'d.
 *   * Each event is serialized (message + stack + page URL) and POSTed
 *     to `/api/diag/client-error` with `keepalive:true` so it survives
 *     a page unload.
 *   * Rate limit: 10 reports / 60 s / tab. Prevents feedback loops
 *     (if the reporter itself fails, we don't spam).
 *   * Dedup: identical `{ kind, message }` within 5 s is swallowed.
 *   * Reporter errors are swallowed — never let telemetry break the
 *     app it's reporting on.
 *
 * Exposed as `installErrorReporter(opts)` so the entry point
 * (`src/main.jsx`) can call it once. Tests inject a stubbed
 * EventTarget + fetch + clock.
 */

const DEFAULT_ENDPOINT = '/api/diag/client-error';

// Windows larger than this would never be useful and would let an
// attacker DoS the logger with huge stacks.
const MAX_STACK_CHARS = 4000;
const MAX_MESSAGE_CHARS = 1000;

// Rate + dedup windows.
const DEFAULT_RATE_LIMIT = 10;           // max reports per window
const DEFAULT_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_DEDUP_MS = 5 * 1000;        // swallow identical within 5 s

function truncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length <= max ? str : `${str.slice(0, max)}… [truncated]`;
}

/**
 * Serializes a value (Error, string, arbitrary object) into the shape
 * posted to the server. Never throws — returns a safe fallback on any
 * serialization failure.
 */
function serializeRejection(reason) {
  if (reason == null) {
    return { message: String(reason), stack: null };
  }
  if (reason instanceof Error) {
    return {
      message: truncate(reason.message || reason.name || 'Error', MAX_MESSAGE_CHARS),
      stack: truncate(reason.stack || '', MAX_STACK_CHARS) || null,
    };
  }
  if (typeof reason === 'string') {
    return { message: truncate(reason, MAX_MESSAGE_CHARS), stack: null };
  }
  try {
    return {
      message: truncate(JSON.stringify(reason), MAX_MESSAGE_CHARS),
      stack: null,
    };
  } catch {
    return { message: String(reason), stack: null };
  }
}

/**
 * PR #182 follow-up — true when an `ErrorEvent` carries at least one
 * piece of location detail (filename, lineno, colno). Used by the
 * `onError` filter to let rare-but-actionable "Script error." events
 * through while still dropping the opaque cross-origin shape.
 */
function hasLocationDetail(ev) {
  if (!ev) return false;
  const hasFile = typeof ev.filename === 'string' && ev.filename.trim() !== '';
  const hasLine = Number.isFinite(ev.lineno) && ev.lineno > 0;
  const hasCol = Number.isFinite(ev.colno) && ev.colno > 0;
  return hasFile || hasLine || hasCol;
}

/**
 * Builds a body from an `ErrorEvent` (window.onerror).
 */
function serializeErrorEvent(ev) {
  const msg = (ev && ev.message) || (ev && ev.error && ev.error.message) || 'Unknown error';
  const stack = (ev && ev.error && ev.error.stack) || null;
  return {
    message: truncate(msg, MAX_MESSAGE_CHARS),
    stack: stack ? truncate(stack, MAX_STACK_CHARS) : null,
    filename: (ev && ev.filename) || null,
    lineno: (ev && typeof ev.lineno === 'number') ? ev.lineno : null,
    colno: (ev && typeof ev.colno === 'number') ? ev.colno : null,
  };
}

/**
 * Installs handlers on the given target. Returns `{ stats, uninstall }`.
 *
 * Options:
 *   - `target`      — EventTarget (defaults to `window`)
 *   - `fetchFn`     — fetch impl (defaults to `window.fetch.bind(window)`)
 *   - `locationHref`— snapshot of current URL (defaults to `window.location.href`)
 *   - `userAgent`   — snapshot (defaults to `navigator.userAgent`)
 *   - `endpoint`    — server path (defaults to `/api/diag/client-error`)
 *   - `csrfToken`   — optional token emitter to pass via `X-CSRF-Token`
 *                     (function returning string)
 *   - `now`         — time fn (defaults to `Date.now`)
 *   - `rateLimit`   — max reports per window
 *   - `rateWindowMs`— window length
 *   - `dedupMs`     — swallow identical kind+message within this
 */
export function installErrorReporter(opts = {}) {
  const target = opts.target || (typeof window !== 'undefined' ? window : null);
  if (!target) {
    // No window (SSR / Node test). Return a dummy handle so callers
    // don't need to branch.
    return {
      stats: {
        reported: 0,
        dropped: 0,
        droppedDedup: 0,
        droppedNoFetch: 0,
        rateLimited: 0,
        lastKind: null,
        lastMessage: null,
      },
      uninstall() {},
    };
  }

  const fetchFn = opts.fetchFn || (typeof window !== 'undefined' && window.fetch
    ? window.fetch.bind(window) : null);
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const now = opts.now || (() => Date.now());
  // PR #180 follow-up — harmonise falsy-value handling with dedupMs so a
  // future caller who wants to disable rate-limiting with { rateLimit: 0 }
  // isn't silently bumped back to the default. We still treat non-finite
  // / negative numbers as "use default" to avoid wedging the reporter.
  const rateLimit = Number.isFinite(opts.rateLimit) && opts.rateLimit >= 0
    ? opts.rateLimit
    : DEFAULT_RATE_LIMIT;
  // PR #182 follow-up — a sliding-window limiter requires a STRICTLY
  // positive window: `rateWindowMs: 0` would make the cleanup loop
  // (recent[0] <= t - 0 === recent[0] <= t) evict every prior
  // timestamp on each call, silently disabling rate limiting. Only
  // `rateLimit: 0` should be the intentional block-all kill-switch;
  // `rateWindowMs: 0` is a mis-configuration and falls back to the
  // default (same treatment as NaN / Infinity / negative).
  const rateWindowMs = Number.isFinite(opts.rateWindowMs) && opts.rateWindowMs > 0
    ? opts.rateWindowMs
    : DEFAULT_RATE_WINDOW_MS;
  const dedupMs = opts.dedupMs != null ? opts.dedupMs : DEFAULT_DEDUP_MS;
  const csrfToken = opts.csrfToken || null;

  // PR #180 follow-up — split stats.dropped into two distinct buckets so a
  // future Prometheus exporter can tell "we dedup'd an identical error"
  // apart from "we never shipped it because fetch wasn't available". The
  // legacy `dropped` field is preserved as the sum of the two new buckets
  // so existing dashboards don't break.
  const stats = {
    reported: 0,
    dropped: 0,        // = droppedDedup + droppedNoFetch (back-compat)
    droppedDedup: 0,
    droppedNoFetch: 0,
    rateLimited: 0,
    lastKind: null,
    lastMessage: null,
  };

  // Sliding-window timestamps for rate limiting.
  const recent = [];
  // Dedup: Map<`${kind}:${message}`, lastSentAtMs>
  const dedup = new Map();

  const send = (body) => {
    if (!fetchFn) {
      stats.droppedNoFetch += 1;
      stats.dropped += 1;
      return;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (csrfToken) {
        try { const t = csrfToken(); if (t) headers['X-CSRF-Token'] = t; } catch { /* ignore */ }
      }
      // keepalive so the report survives a navigation/unload.
      // credentials:'include' so the kelion.token cookie reaches us
      // (helps attribute errors to a logged-in user).
      const p = fetchFn(endpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(body),
      });
      // Swallow the reporter's own failures — must never recurse.
      if (p && typeof p.then === 'function') {
        p.then(() => {}, () => {});
      }
    } catch {
      // fetch itself throwing synchronously — also swallow.
    }
  };

  const maybeReport = (kind, payload) => {
    const t = now();

    // Rate-limit: drop oldest timestamps outside the window, then check size.
    while (recent.length && recent[0] <= t - rateWindowMs) recent.shift();
    if (recent.length >= rateLimit) {
      stats.rateLimited += 1;
      return;
    }

    const dedupKey = `${kind}:${payload.message}`;
    const prev = dedup.get(dedupKey);
    if (prev != null && t - prev < dedupMs) {
      stats.droppedDedup += 1;
      stats.dropped += 1;
      return;
    }
    dedup.set(dedupKey, t);
    // Cheap GC so the dedup map doesn't grow forever.
    if (dedup.size > 200) {
      for (const [k, v] of dedup) {
        if (t - v > dedupMs) dedup.delete(k);
      }
    }

    recent.push(t);
    stats.reported += 1;
    stats.lastKind = kind;
    stats.lastMessage = payload.message;

    send({
      kind,
      message: payload.message,
      stack: payload.stack || null,
      filename: payload.filename || null,
      lineno: payload.lineno != null ? payload.lineno : null,
      colno: payload.colno != null ? payload.colno : null,
      url: (opts.locationHref)
        || (typeof window !== 'undefined' && window && window.location && window.location.href)
        || null,
      userAgent: (opts.userAgent)
        || (typeof navigator !== 'undefined' && navigator && navigator.userAgent)
        || null,
      at: t,
    });
  };

  const onError = (ev) => {
    // Resource-load failures (e.g. <img src="404.jpg">) surface here
    // with a missing .error and no message. Cross-origin script errors
    // surface as ev.message === 'Script error.' with ev.error == null
    // and no filename/line/column (the browser strips the detail for
    // same-origin-policy reasons) — neither shape is actionable.
    //
    // PR #182 follow-up — only drop "Script error." when it is the
    // opaque cross-origin shape (no filename / lineno / colno). A few
    // browsers / extensions occasionally deliver `ev.message === 'Script
    // error.'` with location detail populated; those are rare but
    // actionable, so don't over-filter.
    if (!ev) return;
    if (ev.error == null && !ev.message) return;
    if (ev.error == null
        && typeof ev.message === 'string'
        && /^script error\.?$/i.test(ev.message)
        && !hasLocationDetail(ev)) return;
    maybeReport('error', serializeErrorEvent(ev));
  };

  const onUnhandledRejection = (ev) => {
    const reason = ev && 'reason' in ev ? ev.reason : ev;
    maybeReport('unhandledrejection', serializeRejection(reason));
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);

  return {
    stats,
    uninstall() {
      target.removeEventListener('error', onError);
      target.removeEventListener('unhandledrejection', onUnhandledRejection);
    },
  };
}

// Named exports for unit tests to reach internals without re-running
// the full install.
export const __test = {
  serializeRejection,
  serializeErrorEvent,
  truncate,
  MAX_STACK_CHARS,
  MAX_MESSAGE_CHARS,
};
