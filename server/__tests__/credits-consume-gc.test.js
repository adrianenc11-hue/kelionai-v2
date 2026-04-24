/**
 * Audit H2 — `consumeStateByUser` Map GC.
 *
 * The H1 PR (#177) replaced the old `lastConsumeByUser` Map with a
 * richer `consumeStateByUser` entry per user, but neither Map was
 * ever pruned. Railway restarts every deploy mask the leak in
 * production, but a long-running instance with steady signups would
 * drift upward until OOM.
 *
 * These tests exercise the `gcConsumeState` helper in isolation:
 *   - evicts entries whose newest timestamp is older than TTL
 *   - keeps entries that are still active (either billable or silent)
 *   - returns an accurate eviction count
 *   - handles corrupt / missing fields defensively
 *
 * We deliberately operate on a caller-supplied Map so each test is
 * independent from the module-level state.
 */

const {
  gcConsumeState,
  startConsumeStateGc,
  stopConsumeStateGc,
  CONSUME_STATE_TTL_MS,
  CONSUME_STATE_GC_INTERVAL_MS,
} = require('../src/routes/credits');

describe('gcConsumeState — eviction rules', () => {
  const NOW = 10_000_000; // arbitrary epoch-ish anchor

  it('evicts an entry whose lastBillableAt is older than TTL', () => {
    const map = new Map();
    map.set('user-old', { lastBillableAt: NOW - CONSUME_STATE_TTL_MS - 1, silentStreak: 0, silentSince: 0 });
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(1);
    expect(map.size).toBe(0);
  });

  it('keeps an entry whose lastBillableAt is exactly at the cutoff', () => {
    const map = new Map();
    map.set('user-edge', { lastBillableAt: NOW - CONSUME_STATE_TTL_MS, silentStreak: 0, silentSince: 0 });
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(0);
    expect(map.size).toBe(1);
  });

  it('keeps an entry with a recent silentSince even when lastBillableAt is ancient', () => {
    // This is the "user is in the middle of a silent streak" case —
    // we must NOT evict them or we destroy the backstop counter.
    const map = new Map();
    map.set('user-silent', {
      lastBillableAt: NOW - CONSUME_STATE_TTL_MS - 60_000,
      silentStreak: 2,
      silentSince: NOW - 30_000,
    });
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(0);
    expect(map.has('user-silent')).toBe(true);
  });

  it('evicts an entry whose both timestamps are older than TTL', () => {
    const map = new Map();
    map.set('user-dead', {
      lastBillableAt: NOW - CONSUME_STATE_TTL_MS - 1_000,
      silentStreak: 3,
      silentSince: NOW - CONSUME_STATE_TTL_MS - 5_000,
    });
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(1);
    expect(map.size).toBe(0);
  });

  it('returns the correct count when evicting a mixed set', () => {
    const map = new Map();
    map.set('alive-1', { lastBillableAt: NOW - 1_000, silentStreak: 0, silentSince: 0 });
    map.set('alive-2', { lastBillableAt: NOW - 60_000, silentStreak: 1, silentSince: NOW - 30_000 });
    map.set('dead-1',  { lastBillableAt: NOW - CONSUME_STATE_TTL_MS - 10_000, silentStreak: 0, silentSince: 0 });
    map.set('dead-2',  { lastBillableAt: 0, silentStreak: 2, silentSince: NOW - CONSUME_STATE_TTL_MS - 1 });
    map.set('dead-3',  { lastBillableAt: NOW - CONSUME_STATE_TTL_MS - 1, silentStreak: 0, silentSince: 0 });

    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(3);
    expect(map.size).toBe(2);
    expect(map.has('alive-1')).toBe(true);
    expect(map.has('alive-2')).toBe(true);
    expect(map.has('dead-1')).toBe(false);
    expect(map.has('dead-2')).toBe(false);
    expect(map.has('dead-3')).toBe(false);
  });

  it('handles missing / malformed fields defensively', () => {
    const map = new Map();
    // All of these have a newest timestamp of 0, so they're stale by
    // any positive `now`.
    map.set('bad-1', {});
    map.set('bad-2', { lastBillableAt: null, silentSince: undefined });
    map.set('bad-3', { lastBillableAt: 'oops', silentSince: NaN });
    map.set('bad-4', null);
    map.set('bad-5', undefined);

    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(5);
    expect(map.size).toBe(0);
  });

  it('accepts a caller-supplied TTL override', () => {
    const map = new Map();
    map.set('young', { lastBillableAt: NOW - 2_000, silentStreak: 0, silentSince: 0 });
    map.set('mid',   { lastBillableAt: NOW - 8_000, silentStreak: 0, silentSince: 0 });
    map.set('old',   { lastBillableAt: NOW - 20_000, silentStreak: 0, silentSince: 0 });

    // Custom TTL of 10 s evicts only the 20-s-old entry.
    const removed = gcConsumeState(map, NOW, 10_000);
    expect(removed).toBe(1);
    expect(map.has('young')).toBe(true);
    expect(map.has('mid')).toBe(true);
    expect(map.has('old')).toBe(false);
  });

  it('is a no-op on an empty map', () => {
    const map = new Map();
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(0);
    expect(map.size).toBe(0);
  });

  it('scales to a large map without throwing', () => {
    // 50k entries — faster than Jest's default 5-s timeout.
    const map = new Map();
    for (let i = 0; i < 50_000; i += 1) {
      const alive = i % 2 === 0;
      map.set(`user-${i}`, {
        lastBillableAt: alive ? NOW - 1_000 : NOW - CONSUME_STATE_TTL_MS - 1_000,
        silentStreak: 0,
        silentSince: 0,
      });
    }
    const removed = gcConsumeState(map, NOW);
    expect(removed).toBe(25_000);
    expect(map.size).toBe(25_000);
  });
});

describe('startConsumeStateGc — scheduling', () => {
  it('no-ops under NODE_ENV=test so Jest doesn\'t leak intervals', () => {
    // The module already called startConsumeStateGc() once at import
    // time. Under NODE_ENV=test that call returns null. Calling again
    // here should also return null and not throw.
    const handle = startConsumeStateGc();
    expect(handle).toBeNull();
  });

  it('exposes stopConsumeStateGc as an idempotent no-op in test mode', () => {
    expect(() => stopConsumeStateGc()).not.toThrow();
    expect(() => stopConsumeStateGc()).not.toThrow();
  });

  it('exports sensible constants', () => {
    // Guard against a future refactor accidentally setting these to 0.
    expect(CONSUME_STATE_TTL_MS).toBeGreaterThan(60_000);
    expect(CONSUME_STATE_GC_INTERVAL_MS).toBeGreaterThan(60_000);
    expect(CONSUME_STATE_GC_INTERVAL_MS).toBeLessThan(CONSUME_STATE_TTL_MS);
  });
});
