'use strict';

/**
 * H1 — unit tests for the silent-heartbeat bypass backstop in
 * /api/credits/consume. Before this change, a client that always sent
 * `silent:true` could run a voice session indefinitely without ever
 * paying for a minute. The pure decision helper is now responsible for
 * capping the silent streak + idle window, so we test it directly.
 */

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';

const {
  evaluateConsumeDecision,
  CONSUME_COOLDOWN_MS,
  MAX_SILENT_STREAK,
  MAX_SILENT_WINDOW_MS,
} = require('../src/routes/credits');

const MIN = 60 * 1000;

describe('evaluateConsumeDecision — happy path', () => {
  it('charges on the first non-silent heartbeat (empty state)', () => {
    const decision = evaluateConsumeDecision({}, 1_000_000, false);
    expect(decision.action).toBe('charge');
    expect(decision.nextState.lastBillableAt).toBe(1_000_000);
    expect(decision.nextState.silentStreak).toBe(0);
    expect(decision.nextState.silentSince).toBe(0);
  });

  it('throttles a non-silent heartbeat inside the cooldown', () => {
    const state = { lastBillableAt: 1_000_000, silentStreak: 0, silentSince: 0 };
    const decision = evaluateConsumeDecision(state, 1_020_000, false);
    expect(decision.action).toBe('throttle');
    expect(decision.retryAfterMs).toBe(CONSUME_COOLDOWN_MS - 20_000);
    expect(decision.nextState).toEqual(state);
  });

  it('charges again once the cooldown elapses', () => {
    const state = { lastBillableAt: 1_000_000, silentStreak: 0, silentSince: 0 };
    const decision = evaluateConsumeDecision(state, 1_000_000 + CONSUME_COOLDOWN_MS, false);
    expect(decision.action).toBe('charge');
    expect(decision.nextState.silentStreak).toBe(0);
  });
});

describe('evaluateConsumeDecision — silent-streak backstop (H1)', () => {
  it('grants the first silent heartbeat for free', () => {
    const decision = evaluateConsumeDecision({}, 1_000_000, true);
    expect(decision.action).toBe('silent');
    expect(decision.nextState.silentStreak).toBe(1);
    expect(decision.nextState.silentSince).toBe(1_000_000);
    expect(decision.nextState.lastBillableAt).toBe(0);
  });

  it('grants up to MAX_SILENT_STREAK consecutive silent heartbeats', () => {
    let state = { lastBillableAt: 1_000_000, silentStreak: 0, silentSince: 0 };
    for (let i = 1; i <= MAX_SILENT_STREAK; i += 1) {
      const now = 1_000_000 + i * MIN;
      const decision = evaluateConsumeDecision(state, now, true);
      expect(decision.action).toBe('silent');
      expect(decision.nextState.silentStreak).toBe(i);
      state = decision.nextState;
    }
  });

  it('forces a debit on the (MAX_SILENT_STREAK+1)-th consecutive silent heartbeat', () => {
    // Seed state so the next silent request is the one past the cap.
    const state = {
      lastBillableAt: 1_000_000,
      silentStreak: MAX_SILENT_STREAK,
      silentSince: 1_000_000 + MIN,
    };
    const now = 1_000_000 + (MAX_SILENT_STREAK + 1) * MIN; // well past cooldown
    const decision = evaluateConsumeDecision(state, now, true);
    expect(decision.action).toBe('charge_forced');
    expect(decision.nextState.lastBillableAt).toBe(now);
    expect(decision.nextState.silentStreak).toBe(0);
    expect(decision.nextState.silentSince).toBe(0);
  });

  it('forces a debit when silentSince is older than MAX_SILENT_WINDOW_MS (slow-drip tampering)', () => {
    // A tampered client that paces itself to 1 heartbeat every few
    // minutes so its streak never fills — the wall-clock cap must
    // still force a charge.
    const silentSince = 0 + MIN;
    const state = {
      lastBillableAt: silentSince,
      silentStreak: 1,
      silentSince,
    };
    const now = silentSince + MAX_SILENT_WINDOW_MS + 1_000; // 5 min 1 s after silentSince
    const decision = evaluateConsumeDecision(state, now, true);
    expect(decision.action).toBe('charge_forced');
    expect(decision.nextState.lastBillableAt).toBe(now);
  });

  it('throttles a silent-forced debit if inside cooldown (flood guard)', () => {
    // Tampered client tries to flood with silent=true at 1 Hz after
    // hitting the cap — cooldown still applies.
    const state = {
      lastBillableAt: 1_000_000,
      silentStreak: MAX_SILENT_STREAK,
      silentSince: 1_000_000 - MAX_SILENT_WINDOW_MS,
    };
    const now = 1_000_000 + 10_000; // 10 s after the last billable
    const decision = evaluateConsumeDecision(state, now, true);
    expect(decision.action).toBe('throttle');
    expect(decision.retryAfterMs).toBe(CONSUME_COOLDOWN_MS - 10_000);
    // State must not change on throttle so the streak counters still
    // reflect reality.
    expect(decision.nextState.silentStreak).toBe(MAX_SILENT_STREAK);
  });

  it('resets silent streak + silentSince after a real charge', () => {
    const state = {
      lastBillableAt: 1_000_000,
      silentStreak: 2,
      silentSince: 1_000_000 + 30_000,
    };
    const now = 1_000_000 + CONSUME_COOLDOWN_MS + 1_000;
    const decision = evaluateConsumeDecision(state, now, false);
    expect(decision.action).toBe('charge');
    expect(decision.nextState.silentStreak).toBe(0);
    expect(decision.nextState.silentSince).toBe(0);
    expect(decision.nextState.lastBillableAt).toBe(now);
  });
});

describe('evaluateConsumeDecision — legitimate usage never hits the cap', () => {
  it('a user who alternates speech + silence every minute is never force-charged', () => {
    // Simulated 30-minute session: the user speaks every 2 min (so a
    // silent heartbeat lands between every billable one). With a 50-s
    // cooldown, every other heartbeat charges, and the streak never
    // reaches MAX_SILENT_STREAK because each billable tick resets it.
    let state = {};
    let now = 0;
    let charges = 0;
    let silents = 0;
    let forced = 0;
    for (let i = 0; i < 30; i += 1) {
      now += MIN;
      const silent = i % 2 === 1; // alternating
      const decision = evaluateConsumeDecision(state, now, silent);
      if (decision.action === 'silent')        silents += 1;
      else if (decision.action === 'charge')   charges += 1;
      else if (decision.action === 'charge_forced') forced += 1;
      state = decision.nextState;
    }
    // We expect ~15 real charges, ~15 free silents, 0 forced.
    expect(forced).toBe(0);
    expect(charges).toBeGreaterThanOrEqual(14);
    expect(silents).toBeGreaterThanOrEqual(14);
  });

  it('a user with one long reflective pause gets 3 silents then forced on the 4th', () => {
    // Realistic worst case: user asks a question, then takes 4 min to
    // think. The 4-min pause exceeds the streak cap + window, so the
    // 4th heartbeat forces a debit. This is the intended behaviour —
    // a 4-min pause is far beyond normal conversational silence.
    let state = { lastBillableAt: 0, silentStreak: 0, silentSince: 0 };
    // Initial billable tick at t=60s.
    let d = evaluateConsumeDecision(state, 60_000, false);
    expect(d.action).toBe('charge');
    state = d.nextState;
    // 3 consecutive silent ticks at 2, 3, 4 min — all free.
    for (let i = 2; i <= 4; i += 1) {
      d = evaluateConsumeDecision(state, i * MIN, true);
      expect(d.action).toBe('silent');
      state = d.nextState;
    }
    // 5th tick (still silent) must force debit — streak now 3 ⇒
    // MAX_SILENT_STREAK reached.
    d = evaluateConsumeDecision(state, 5 * MIN, true);
    expect(d.action).toBe('charge_forced');
  });
});

describe('evaluateConsumeDecision — tampering scenario', () => {
  it('a client that always sends silent:true still pays ≈1 min / 5 min', () => {
    // Tampered client pings every 60 s with silent:true always. How
    // many minutes burned in 30 min of real time?
    let state = {};
    let now = 0;
    let freeSilents = 0;
    let forcedCharges = 0;
    for (let i = 0; i < 30; i += 1) {
      now += MIN;
      const d = evaluateConsumeDecision(state, now, true);
      if (d.action === 'silent')        freeSilents   += 1;
      if (d.action === 'charge_forced') forcedCharges += 1;
      state = d.nextState;
    }
    // Over 30 min of tampered pings, the bypass is capped: forced
    // debits must fire at least 5 times (one per ~5-min window) and
    // free silents are bounded. A perfectly-bypassed session under
    // the old code would have been freeSilents=30 / forcedCharges=0.
    expect(forcedCharges).toBeGreaterThanOrEqual(5);
    expect(freeSilents).toBeLessThan(30);
  });
});
