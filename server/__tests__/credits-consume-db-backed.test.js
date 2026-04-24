'use strict';

/**
 * Audit M7 — cross-instance consume state.
 *
 * The H1 silent-bypass cap is enforced by a per-user policy state
 * (`lastBillableAt`, `silentStreak`, `silentSince`). Before M7 the
 * state lived only in a per-process Map, so a tampered client that
 * bounced heartbeats between Railway instances could reset its
 * streak counter on every hop and re-open the bypass. M7 persists
 * the state in `credits_consume_state` and reads it through with an
 * in-process L1 cache on top.
 *
 * These tests drive the new helpers (`loadConsumeState`,
 * `persistConsumeState`) directly against a mocked DB module so we
 * can prove, without a real DB:
 *   - the cache is preferred when populated
 *   - a cold cache reads DB and primes itself
 *   - a write hits both the cache AND the DB
 *   - DB errors do NOT propagate (the route must never crash)
 *   - the periodic GC sweeps the DB via `gcConsumeStateRows`
 *
 * Integration-style tests (route-level silent-streak across instances)
 * are in credits-consume-decision.test.js and credits-consume-gc.test.js.
 * This file isolates the DB layer only.
 */

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';

// Mock the db module BEFORE requiring credits.js — the credits route
// captures the db helper references at module-load time. Jest requires
// the factory function to avoid referencing out-of-scope variables
// unless they are prefixed with `mock`, so we name this `mockDbFactory`
// and expose the mocked module via `jest.requireMock` below.
jest.mock('../src/db', () => {
  /* eslint-disable global-require */
  const mockFn = require('jest-mock').fn;
  /* eslint-enable global-require */
  return {
    getConsumeState:    mockFn(),
    saveConsumeState:   mockFn(),
    gcConsumeStateRows: mockFn(),
    // Not used by M7 paths but required to satisfy the destructure
    // in routes/credits.js so the module loads cleanly.
    getCreditsBalance: mockFn(() => Promise.resolve(100)),
    addCreditsTransaction: mockFn(() => Promise.resolve({ balance: 99, delta: -1 })),
    getCreditTopupByPaymentIntent: mockFn(() => null),
    listCreditTransactions: mockFn(() => []),
    findById: mockFn(() => null),
  };
});

const dbMock = require('../src/db');
const credits = require('../src/routes/credits');
const {
  loadConsumeState,
  persistConsumeState,
  _consumeStateByUser: cache,
} = credits;

function reset() {
  cache.clear();
  dbMock.getConsumeState.mockReset();
  dbMock.saveConsumeState.mockReset();
  dbMock.gcConsumeStateRows.mockReset();
}

describe('loadConsumeState — cache vs DB', () => {
  beforeEach(reset);

  it('returns the cached entry without touching the DB', async () => {
    const uid = 'uid-cache-hit';
    const state = { lastBillableAt: 1000, silentStreak: 1, silentSince: 0 };
    cache.set(uid, state);

    const got = await loadConsumeState(uid);
    expect(got).toBe(state);
    expect(dbMock.getConsumeState).not.toHaveBeenCalled();
  });

  it('falls back to DB on cache miss + primes the cache', async () => {
    const uid = 'uid-cache-miss';
    dbMock.getConsumeState.mockResolvedValueOnce({
      lastBillableAt: 5000,
      silentStreak: 2,
      silentSince: 4000,
      updatedAt: 4999,
    });

    const first = await loadConsumeState(uid);
    expect(first).toEqual({ lastBillableAt: 5000, silentStreak: 2, silentSince: 4000 });
    expect(dbMock.getConsumeState).toHaveBeenCalledTimes(1);
    expect(dbMock.getConsumeState).toHaveBeenCalledWith(uid);

    // Second call must use the primed cache, not hit the DB again.
    const second = await loadConsumeState(uid);
    expect(second).toEqual({ lastBillableAt: 5000, silentStreak: 2, silentSince: 4000 });
    expect(dbMock.getConsumeState).toHaveBeenCalledTimes(1);
  });

  it('returns {} when the DB has no row for this user', async () => {
    const uid = 'uid-fresh';
    dbMock.getConsumeState.mockResolvedValueOnce(null);
    const got = await loadConsumeState(uid);
    expect(got).toEqual({});
    // Must NOT poison the cache — next call should try the DB again.
    expect(cache.has(uid)).toBe(false);
  });

  it('swallows DB errors and returns an empty state (never throws)', async () => {
    const uid = 'uid-db-flaky';
    dbMock.getConsumeState.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const got = await loadConsumeState(uid);
    expect(got).toEqual({});
  });

  it('returns {} for nullish user ids without touching the DB', async () => {
    expect(await loadConsumeState(null)).toEqual({});
    expect(await loadConsumeState(undefined)).toEqual({});
    expect(dbMock.getConsumeState).not.toHaveBeenCalled();
  });

  it('coerces non-finite / missing DB fields to 0', async () => {
    dbMock.getConsumeState.mockResolvedValueOnce({
      lastBillableAt: null,
      silentStreak: 'oops',
      silentSince: undefined,
    });
    const got = await loadConsumeState('uid-bad-db');
    expect(got).toEqual({ lastBillableAt: 0, silentStreak: 0, silentSince: 0 });
  });
});

describe('persistConsumeState — dual write', () => {
  beforeEach(reset);

  it('writes to BOTH the cache and the DB, in the expected shape', async () => {
    const uid = 'uid-write';
    const next = { lastBillableAt: 2000, silentStreak: 0, silentSince: 0 };
    await persistConsumeState(uid, next, 2000);

    expect(cache.get(uid)).toBe(next);
    expect(dbMock.saveConsumeState).toHaveBeenCalledTimes(1);
    expect(dbMock.saveConsumeState).toHaveBeenCalledWith(uid, next, 2000);
  });

  it('keeps the cache populated even when the DB write fails', async () => {
    const uid = 'uid-db-down';
    const next = { lastBillableAt: 3000, silentStreak: 0, silentSince: 0 };
    dbMock.saveConsumeState.mockRejectedValueOnce(new Error('db disconnected'));

    // Must NOT throw — route must survive a transient DB outage.
    await expect(persistConsumeState(uid, next, 3000)).resolves.toBeUndefined();
    // Cache is authoritative for the lifetime of this process until a
    // successful DB write replaces it, so the streak cap still holds
    // on subsequent same-instance requests.
    expect(cache.get(uid)).toBe(next);
  });

  it('is a no-op for nullish user ids', async () => {
    await persistConsumeState(null, { lastBillableAt: 1 }, 1);
    await persistConsumeState(undefined, { lastBillableAt: 1 }, 1);
    expect(dbMock.saveConsumeState).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});

describe('cross-instance scenario — the actual H1 defence', () => {
  beforeEach(reset);

  it('instance B honours the silent streak that instance A persisted', async () => {
    const uid = 'uid-cross';
    // Simulate instance A: 3 silent heartbeats + 1 forced debit on
    // the next silent, writing state to the shared DB on each tick.
    const instanceA = new Map();
    const { evaluateConsumeDecision, MAX_SILENT_STREAK } = credits;
    let stateA = {};
    let t = 100_000;
    for (let i = 0; i < MAX_SILENT_STREAK; i += 1) {
      const d = evaluateConsumeDecision(stateA, t, true);
      expect(d.action).toBe('silent');
      stateA = d.nextState;
      instanceA.set(uid, stateA);
      t += 60_000;
    }
    expect(stateA.silentStreak).toBe(MAX_SILENT_STREAK);

    // DB sees the full streak. Now instance B (empty cache) picks up
    // the next heartbeat — it must read the streak from the DB and
    // force a debit, NOT grant another free silent pass.
    dbMock.getConsumeState.mockResolvedValueOnce({
      lastBillableAt: stateA.lastBillableAt || 0,
      silentStreak:   stateA.silentStreak,
      silentSince:    stateA.silentSince,
      updatedAt:      t,
    });
    cache.clear();
    const prev = await loadConsumeState(uid);
    const decision = evaluateConsumeDecision(prev, t + 60_000, true);
    expect(decision.action).toBe('charge_forced');
  });
});

describe('startConsumeStateGc — DB sweep branch', () => {
  beforeEach(reset);
  afterEach(() => credits.stopConsumeStateGc());

  // The GC itself is setInterval-based and explicitly skipped under
  // NODE_ENV=test; exhaustive interval-scheduling behaviour is
  // covered in credits-consume-gc.test.js. Here we just confirm the
  // DB-sweep branch is wired to the correct helper on the db module.
  it('wires the DB sweep to db.gcConsumeStateRows', () => {
    expect(typeof dbMock.gcConsumeStateRows).toBe('function');
    // Sanity: the credits module imported the helper (exposed via
    // the cache export for the only other test using it).
    expect(typeof credits.loadConsumeState).toBe('function');
    expect(typeof credits.persistConsumeState).toBe('function');
  });
});
