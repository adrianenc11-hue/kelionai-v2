/**
 * Audit H4 — tests for the client-side global error reporter.
 *
 * The reporter normally runs in the browser, but the factory
 * (`installErrorReporter`) is written so its side-effecting deps
 * (target EventTarget, fetch, clock) are injectable. That lets us
 * exercise it from Node + Jest without a DOM.
 *
 * We test on Node's built-in `EventTarget`, fire synthetic
 * `CustomEvent`-shaped objects, and capture POSTs with a stubbed
 * `fetch` spy.
 */

'use strict';

// Ensure the factory runs under a Node context where `window` +
// `navigator` are absent — the reporter has to fall back to the
// injected values for locationHref/userAgent.
const path = require('path');

const reporterPath = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'lib',
  'errorReporter.js',
);

function loadReporter() {
  // The module is an ES module (import/export). Server Jest runs CJS,
  // so we can't `require()` it directly. Instead, read + transpile
  // the two named exports by regex — tiny enough that keeping this
  // test hermetic is worth avoiding babel config churn.
  const fs = require('fs');
  const source = fs.readFileSync(reporterPath, 'utf8');
  // Crude ESM → CJS: replace `export function` with plain `function`
  // and inject a `module.exports` at the bottom.
  const transpiled = source
    .replace(/export function installErrorReporter/g, 'function installErrorReporter')
    .replace(/export const __test/g, 'const __test')
    + '\nmodule.exports = { installErrorReporter, __test };\n';
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function('module', 'exports', 'require', transpiled);
  fn(mod, mod.exports, require);
  return mod.exports;
}

const { installErrorReporter, __test } = loadReporter();

function makeFetchSpy() {
  const calls = [];
  const fn = jest.fn((url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return Promise.resolve({ ok: true, status: 204 });
  });
  fn.calls = calls;
  return fn;
}

function fireUnhandledRejection(target, reason) {
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
}

function fireError(target, payload) {
  target.dispatchEvent(Object.assign(new Event('error'), payload));
}

describe('serializeRejection', () => {
  const { serializeRejection } = __test;

  it('handles Error objects — uses stack when present', () => {
    const err = new Error('boom');
    const out = serializeRejection(err);
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
    expect(out.stack).toMatch(/Error: boom/);
  });

  it('handles plain strings', () => {
    const out = serializeRejection('plain string');
    expect(out.message).toBe('plain string');
    expect(out.stack).toBeNull();
  });

  it('handles null / undefined', () => {
    expect(serializeRejection(null)).toEqual({ message: 'null', stack: null });
    expect(serializeRejection(undefined)).toEqual({ message: 'undefined', stack: null });
  });

  it('handles arbitrary objects via JSON.stringify', () => {
    const out = serializeRejection({ oops: true, code: 42 });
    expect(out.message).toBe('{"oops":true,"code":42}');
    expect(out.stack).toBeNull();
  });

  it('survives circular references without throwing', () => {
    const o = {};
    o.self = o;
    const out = serializeRejection(o);
    expect(typeof out.message).toBe('string');
  });

  it('truncates overlong messages to prevent spam', () => {
    const huge = 'x'.repeat(5000);
    const out = serializeRejection(huge);
    expect(out.message.length).toBeLessThanOrEqual(1100);
    expect(out.message).toMatch(/truncated/);
  });
});

describe('installErrorReporter', () => {
  let target;
  let fetchFn;
  let now;
  let tickMs;

  beforeEach(() => {
    target = new EventTarget();
    fetchFn = makeFetchSpy();
    tickMs = 1_000_000_000; // arbitrary stable start
    now = () => tickMs;
  });

  it('registers handlers + unregisters on uninstall', () => {
    const { stats, uninstall } = installErrorReporter({
      target, fetchFn, now,
    });

    fireUnhandledRejection(target, new Error('oops'));
    expect(stats.reported).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    uninstall();
    fireUnhandledRejection(target, new Error('after uninstall'));
    expect(stats.reported).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('POSTs JSON with expected fields for unhandledrejection', () => {
    installErrorReporter({
      target, fetchFn, now,
      locationHref: 'https://kelion.app/chat',
      userAgent: 'Jest/Test',
    });

    fireUnhandledRejection(target, new Error('promise died'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = fetchFn.calls[0].body;
    expect(body.kind).toBe('unhandledrejection');
    expect(body.message).toBe('promise died');
    expect(typeof body.stack).toBe('string');
    expect(body.url).toBe('https://kelion.app/chat');
    expect(body.userAgent).toBe('Jest/Test');
    expect(body.at).toBe(tickMs);
  });

  it('sends credentials:include + keepalive + content-type', () => {
    installErrorReporter({ target, fetchFn, now });
    fireUnhandledRejection(target, 'x');
    const init = fetchFn.calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.keepalive).toBe(true);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('includes X-CSRF-Token header when csrfToken fn provided', () => {
    installErrorReporter({
      target, fetchFn, now,
      csrfToken: () => 'csrf-abc-123',
    });
    fireUnhandledRejection(target, 'x');
    expect(fetchFn.calls[0].init.headers['X-CSRF-Token']).toBe('csrf-abc-123');
  });

  it('omits CSRF header when csrfToken fn throws', () => {
    installErrorReporter({
      target, fetchFn, now,
      csrfToken: () => { throw new Error('noop'); },
    });
    fireUnhandledRejection(target, 'x');
    expect(fetchFn.calls[0].init.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('rate-limits reports to the configured cap per window', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      rateLimit: 3,
      rateWindowMs: 60_000,
      dedupMs: 0, // disable dedup for this test
    });

    for (let i = 0; i < 10; i++) {
      // unique messages so dedup doesn't kick in
      fireUnhandledRejection(target, new Error(`rej-${i}`));
    }

    expect(stats.reported).toBe(3);
    expect(stats.rateLimited).toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('window slides: after window expires, new reports are allowed', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      rateLimit: 2,
      rateWindowMs: 1000,
      dedupMs: 0,
    });

    fireUnhandledRejection(target, new Error('a'));
    fireUnhandledRejection(target, new Error('b'));
    fireUnhandledRejection(target, new Error('c')); // rate-limited
    expect(stats.reported).toBe(2);

    tickMs += 2000; // advance past the window
    fireUnhandledRejection(target, new Error('d'));
    expect(stats.reported).toBe(3);
  });

  it('dedups identical kind+message within dedup window', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      rateLimit: 100,
      dedupMs: 5000,
    });

    fireUnhandledRejection(target, new Error('dup'));
    fireUnhandledRejection(target, new Error('dup'));
    fireUnhandledRejection(target, new Error('dup'));
    expect(stats.reported).toBe(1);
    expect(stats.dropped).toBe(2);

    // different message escapes dedup
    fireUnhandledRejection(target, new Error('other'));
    expect(stats.reported).toBe(2);

    // advance past dedup window — original message allowed again
    tickMs += 6000;
    fireUnhandledRejection(target, new Error('dup'));
    expect(stats.reported).toBe(3);
  });

  it('catches window.onerror style ErrorEvents + forwards fields', () => {
    const { stats } = installErrorReporter({ target, fetchFn, now });
    fireError(target, {
      message: 'Uncaught TypeError: boom',
      filename: 'https://kelion.app/main.js',
      lineno: 42,
      colno: 7,
      error: Object.assign(new Error('boom'), { stack: 'Error: boom\n    at …' }),
    });
    expect(stats.reported).toBe(1);
    const body = fetchFn.calls[0].body;
    expect(body.kind).toBe('error');
    expect(body.message).toBe('Uncaught TypeError: boom');
    expect(body.filename).toBe('https://kelion.app/main.js');
    expect(body.lineno).toBe(42);
    expect(body.colno).toBe(7);
    expect(body.stack).toMatch(/Error: boom/);
  });

  it('ignores resource-load "Script error." style events (no message + no error)', () => {
    const { stats } = installErrorReporter({ target, fetchFn, now });
    // Fire an error event with no payload at all — typical of
    // cross-origin image/script load failures.
    target.dispatchEvent(new Event('error'));
    expect(stats.reported).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // PR #180 follow-up — cross-origin script failures surface as
  // ev.message === 'Script error.' with ev.error == null. The browser
  // strips file/line/column so the report has zero actionable detail.
  // Our onError filter now rejects that specific shape as well.
  it('ignores cross-origin "Script error." events (message set, error null)', () => {
    const { stats } = installErrorReporter({ target, fetchFn, now });
    fireError(target, { message: 'Script error.', error: null, filename: '', lineno: 0, colno: 0 });
    fireError(target, { message: 'script error', error: null });
    expect(stats.reported).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // Same-origin errors with a real message (but no Error object) are
  // still reported — they carry filename/lineno the developer can act on.
  it('still reports same-origin error events that carry filename + lineno', () => {
    const { stats } = installErrorReporter({ target, fetchFn, now });
    fireError(target, {
      message: 'ReferenceError: foo is not defined',
      error: null,
      filename: 'https://kelion.app/chunk.js',
      lineno: 42,
      colno: 7,
    });
    expect(stats.reported).toBe(1);
    expect(fetchFn.calls[0].body.message).toMatch(/ReferenceError/);
  });

  it('reporter never re-enters on fetch rejection (swallows own errors)', () => {
    const brokenFetch = jest.fn(() => Promise.reject(new Error('network down')));
    const { stats, uninstall } = installErrorReporter({
      target, fetchFn: brokenFetch, now,
    });

    // Should NOT throw, should NOT spam a second POST on its own failure.
    fireUnhandledRejection(target, new Error('first'));
    expect(stats.reported).toBe(1);
    expect(brokenFetch).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it('reporter never re-enters when fetch throws synchronously', () => {
    const throwingFetch = jest.fn(() => { throw new Error('sync throw'); });
    const { stats, uninstall } = installErrorReporter({
      target, fetchFn: throwingFetch, now,
    });

    expect(() => fireUnhandledRejection(target, new Error('x'))).not.toThrow();
    expect(stats.reported).toBe(1);
    expect(throwingFetch).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it('counts as dropped when fetchFn is missing (offline fallback)', () => {
    // `reported` = accepted past the rate-limit + dedup filters.
    // `dropped`  = couldn't actually be sent (no fetch, or dedup).
    // Both are useful for diagnostics — they answer different questions.
    const { stats } = installErrorReporter({ target, fetchFn: null, now });
    fireUnhandledRejection(target, new Error('offline'));
    expect(stats.dropped).toBe(1);
    expect(stats.droppedNoFetch).toBe(1);
    expect(stats.droppedDedup).toBe(0);
    expect(stats.reported).toBe(1);
  });

  // PR #180 follow-up — `stats.dropped` previously conflated dedup-hits
  // and no-fetch failures. Split into two counters so a downstream
  // Prometheus exporter can distinguish them, while keeping `dropped`
  // as the back-compat sum.
  it('splits droppedDedup vs droppedNoFetch while preserving total', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      dedupMs: 5000,
    });
    fireUnhandledRejection(target, new Error('same'));
    fireUnhandledRejection(target, new Error('same'));
    fireUnhandledRejection(target, new Error('same'));
    expect(stats.reported).toBe(1);
    expect(stats.droppedDedup).toBe(2);
    expect(stats.droppedNoFetch).toBe(0);
    expect(stats.dropped).toBe(stats.droppedDedup + stats.droppedNoFetch);
  });

  // PR #180 follow-up — harmonise falsy-value handling. Passing
  // `rateLimit: 0` now means "allow 0 reports per window" (= block all),
  // matching the `dedupMs: 0` = "disable dedup" semantics. Before this
  // change, `0` silently fell back to the 10/60s default because
  // `opts.rateLimit || DEFAULT` coerced it.
  it('accepts rateLimit: 0 as "block all reports" (harmonised with dedupMs)', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      rateLimit: 0,
      rateWindowMs: 60_000,
      dedupMs: 0,
    });
    fireUnhandledRejection(target, new Error('a'));
    fireUnhandledRejection(target, new Error('b'));
    expect(stats.reported).toBe(0);
    expect(stats.rateLimited).toBe(2);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // Non-finite / negative rateLimit values still fall back to the
  // default so a mis-wired caller doesn't accidentally wedge the
  // reporter permanently.
  it('falls back to default when rateLimit is non-finite or negative', () => {
    const { stats } = installErrorReporter({
      target, fetchFn, now,
      rateLimit: -5,
      dedupMs: 0,
    });
    for (let i = 0; i < 12; i++) {
      fireUnhandledRejection(target, new Error(`msg-${i}`));
    }
    // Default cap is 10 per window, so exactly 10 pass.
    expect(stats.reported).toBe(10);
    expect(stats.rateLimited).toBe(2);
  });

  it('returns no-op handle when target is absent (SSR / non-browser)', () => {
    const r = installErrorReporter({ target: null });
    expect(typeof r.uninstall).toBe('function');
    expect(() => r.uninstall()).not.toThrow();
    expect(r.stats.reported).toBe(0);
  });

  it('records lastKind + lastMessage on stats for debugging', () => {
    const { stats } = installErrorReporter({ target, fetchFn, now });
    fireUnhandledRejection(target, new Error('latest'));
    expect(stats.lastKind).toBe('unhandledrejection');
    expect(stats.lastMessage).toBe('latest');
  });
});
