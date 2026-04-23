'use strict';

// Audit M6 — exercise the pure decision function that guards the
// KelionStage auto-fallback effect from clobbering a session the
// user just manually started. See src/lib/handoffGuard.js for the
// full problem statement.

const { decideHandoff } = require('../../src/lib/handoffGuard');

describe('decideHandoff — M6 auto-fallback guard', () => {
  it('returns start when pending, not busy, and snapshot has turns', () => {
    const d = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: 3 });
    expect(d.action).toBe('start');
    expect(typeof d.reason).toBe('string');
  });

  it('skips when the pending flag was never set (effect 1 did not run)', () => {
    const d = decideHandoff({ pending: false, hookBusy: false, priorTurnCount: 3 });
    expect(d.action).toBe('skip-not-pending');
  });

  it('skips when the incoming hook is busy — the real M6 bug path', () => {
    // This is the exact scenario the audit flagged:
    //   user tapped to talk between effect (1) and effect (2), the
    //   new hook's startInFlightRef is true. Without this guard the
    //   auto-fallback start() would either be silently rejected
    //   (handoff turns lost) or close the user's fresh ws.
    const d = decideHandoff({ pending: true, hookBusy: true, priorTurnCount: 4 });
    expect(d.action).toBe('skip-busy');
    expect(d.reason).toMatch(/already starting|live/i);
  });

  it('skip-busy beats skip-empty — once a user session is live we never handoff', () => {
    // Important ordering: even if the snapshot is empty, if the
    // user is already live we should report skip-busy so
    // operators see the right reason in the console.
    const d = decideHandoff({ pending: true, hookBusy: true, priorTurnCount: 0 });
    expect(d.action).toBe('skip-busy');
  });

  it('skips when the snapshot is empty (transport died before any turns)', () => {
    const d = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: 0 });
    expect(d.action).toBe('skip-empty');
  });

  it('treats missing / nullish input as a safe no-op', () => {
    expect(decideHandoff(undefined).action).toBe('skip-not-pending');
    expect(decideHandoff(null).action).toBe('skip-not-pending');
    expect(decideHandoff({}).action).toBe('skip-not-pending');
  });

  it('coerces truthy/falsy inputs defensively', () => {
    // pending: truthy string becomes true → pending path
    const started = decideHandoff({ pending: 1, hookBusy: 0, priorTurnCount: '2' });
    expect(started.action).toBe('start');

    // hookBusy: truthy non-boolean still flags busy
    const busy = decideHandoff({ pending: true, hookBusy: {}, priorTurnCount: 5 });
    expect(busy.action).toBe('skip-busy');

    // priorTurnCount: NaN and negative both fall through as zero
    const emptyNaN = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: NaN });
    expect(emptyNaN.action).toBe('skip-empty');

    const emptyNeg = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: -1 });
    // -1 is truthy as a Number — the function only cares about
    // zero-vs-nonzero, so a negative value is not "empty". Document
    // the current behaviour so a future refactor thinks twice.
    expect(emptyNeg.action).toBe('start');
  });

  it('always returns an object with action + reason shape', () => {
    // Contract for the caller — used in console.warn.
    const shapes = [
      { pending: true,  hookBusy: false, priorTurnCount: 3 },
      { pending: false, hookBusy: false, priorTurnCount: 3 },
      { pending: true,  hookBusy: true,  priorTurnCount: 3 },
      { pending: true,  hookBusy: false, priorTurnCount: 0 },
    ];
    for (const input of shapes) {
      const d = decideHandoff(input);
      expect(d).toEqual(expect.objectContaining({
        action: expect.any(String),
        reason: expect.any(String),
      }));
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });

  it('is pure — same inputs produce identical outputs', () => {
    const a = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: 5 });
    const b = decideHandoff({ pending: true, hookBusy: false, priorTurnCount: 5 });
    expect(a).toEqual(b);
  });
});
