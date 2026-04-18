'use strict';

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/kelion-proactive-test.db';

// Force the scheduler into permissive hours for deterministic tests.
process.env.PROACTIVE_START_HOUR = '0';
process.env.PROACTIVE_END_HOUR   = '24';

jest.mock('../src/db', () => {
  const state = {
    subs: [],      // { id, user_id, endpoint, p256dh, auth_secret, enabled }
    memory: [],    // { id, user_id, kind, fact, created_at }
    proactive: [], // { id, user_id, kind, created_at }
    sent: [],      // ids of subs marked as sent
    disabled: [],  // endpoints disabled
    logs: [],      // logProactive calls
  };
  return {
    __state: state,
    getDb: () => ({
      all: async (sql, params) => {
        if (sql.includes('FROM memory_items')) {
          return state.memory.filter((m) => m.user_id === params[0]);
        }
        return [];
      },
    }),
    listActivePushSubscriptions: async () => state.subs.filter((s) => s.enabled),
    markPushSent: async (id) => { state.sent.push(id); },
    disablePushSubscriptionByEndpoint: async (ep) => { state.disabled.push(ep); },
    logProactive: async (entry) => { state.logs.push(entry); },
    recentProactiveForUser: async (userId, sinceMs) => {
      const since = Date.now() - sinceMs;
      return state.proactive.filter((p) => p.user_id === userId && new Date(p.created_at).getTime() > since);
    },
  };
});

const proactive = require('../src/services/proactive');
const db = require('../src/db');

const mockWebPush = () => {
  const calls = [];
  return {
    calls,
    sendNotification: jest.fn(async (sub, payload) => {
      calls.push({ sub, payload });
    }),
  };
};

beforeEach(() => {
  db.__state.subs = [];
  db.__state.memory = [];
  db.__state.proactive = [];
  db.__state.sent = [];
  db.__state.disabled = [];
  db.__state.logs = [];
});

describe('withinQuietHours', () => {
  it('returns true inside 09-21 default', () => {
    // Override env defaults — reload module with explicit quiet window
    jest.resetModules();
    process.env.PROACTIVE_START_HOUR = '9';
    process.env.PROACTIVE_END_HOUR   = '21';
    const p = require('../src/services/proactive');
    const d10 = new Date('2026-04-17T10:00:00Z');
    const d22 = new Date('2026-04-17T22:00:00Z');
    expect(p.withinQuietHours(d10)).toBe(true);
    expect(p.withinQuietHours(d22)).toBe(false);
    // reset for remaining tests
    jest.resetModules();
    process.env.PROACTIVE_START_HOUR = '0';
    process.env.PROACTIVE_END_HOUR   = '24';
  });
});

describe('composeMessage', () => {
  const { composeMessage } = require('../src/services/proactive');
  it('uses goal template for goals', () => {
    const m = composeMessage({ id: 7, kind: 'goal', fact: 'learn spanish' });
    expect(m.body).toMatch(/nudge on your goal/i);
    expect(m.body).toMatch(/learn spanish/);
    expect(m.reason).toBe('goal:7');
  });
  it('truncates long facts', () => {
    const long = 'x'.repeat(300);
    const m = composeMessage({ id: 1, kind: 'goal', fact: long });
    expect(m.body.length).toBeLessThan(220);
    expect(m.body).toContain('…');
  });
  it('falls back for unknown kinds', () => {
    const m = composeMessage({ id: 2, kind: 'identity', fact: 'name is Adrian' });
    expect(m.reason).toBe('other:2');
  });
});

describe('pickMemoryForUser', () => {
  const { pickMemoryForUser } = require('../src/services/proactive');
  it('prefers goal over preference', async () => {
    db.__state.memory = [
      { id: 1, user_id: 'u1', kind: 'preference', fact: 'likes tea' },
      { id: 2, user_id: 'u1', kind: 'goal',       fact: 'run a marathon' },
    ];
    const picked = await pickMemoryForUser('u1');
    expect(picked.id).toBe(2);
  });
  it('returns null when user has no memory', async () => {
    expect(await pickMemoryForUser('u404')).toBeNull();
  });
});

describe('runOnce', () => {
  const { runOnce } = require('../src/services/proactive');

  it('sends to users with memory + active sub + no recent ping', async () => {
    db.__state.subs = [
      { id: 1, user_id: 'u1', endpoint: 'https://push/x', p256dh: 'p', auth_secret: 'a', enabled: 1 },
    ];
    db.__state.memory = [{ id: 5, user_id: 'u1', kind: 'goal', fact: 'learn piano' }];
    const wp = mockWebPush();
    const report = await runOnce({ webpush: wp });
    expect(report.sent).toBe(1);
    expect(wp.calls.length).toBe(1);
    expect(wp.calls[0].payload).toMatch(/learn piano/);
    expect(db.__state.sent).toEqual([1]);
    expect(db.__state.logs[0].delivered).toBe(true);
  });

  it('skips users who were pinged recently', async () => {
    db.__state.subs = [{ id: 1, user_id: 'u1', endpoint: 'https://push/x', p256dh: 'p', auth_secret: 'a', enabled: 1 }];
    db.__state.memory = [{ id: 1, user_id: 'u1', kind: 'goal', fact: 'f' }];
    db.__state.proactive = [{ id: 9, user_id: 'u1', kind: 'proactive', created_at: new Date().toISOString() }];
    const wp = mockWebPush();
    const report = await runOnce({ webpush: wp });
    expect(report.sent).toBe(0);
    expect(report.skipped_gap).toBe(1);
    expect(wp.sendNotification).not.toHaveBeenCalled();
  });

  it('skips users with no memory', async () => {
    db.__state.subs = [{ id: 1, user_id: 'u1', endpoint: 'https://push/x', p256dh: 'p', auth_secret: 'a', enabled: 1 }];
    const wp = mockWebPush();
    const report = await runOnce({ webpush: wp });
    expect(report.no_memory).toBe(1);
    expect(report.sent).toBe(0);
  });

  it('disables 410/404 subscriptions on delivery failure', async () => {
    db.__state.subs = [{ id: 1, user_id: 'u1', endpoint: 'https://gone/x', p256dh: 'p', auth_secret: 'a', enabled: 1 }];
    db.__state.memory = [{ id: 1, user_id: 'u1', kind: 'goal', fact: 'test' }];
    const wp = {
      sendNotification: jest.fn(async () => {
        const err = new Error('gone'); err.statusCode = 410; throw err;
      }),
    };
    const report = await runOnce({ webpush: wp });
    expect(db.__state.disabled).toContain('https://gone/x');
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(1);
  });

  it('returns quiet-hours skip when outside window', async () => {
    jest.resetModules();
    process.env.PROACTIVE_START_HOUR = '9';
    process.env.PROACTIVE_END_HOUR   = '10';
    const p = require('../src/services/proactive');
    const wp = mockWebPush();
    const report = await p.runOnce({ webpush: wp, now: new Date('2026-04-17T22:00:00Z') });
    expect(report.skipped).toBe('quiet-hours');
    expect(wp.sendNotification).not.toHaveBeenCalled();
    jest.resetModules();
    process.env.PROACTIVE_START_HOUR = '0';
    process.env.PROACTIVE_END_HOUR   = '24';
  });

  it('no webpush instance → skipped no-webpush', async () => {
    const report = await runOnce({});
    expect(report.skipped).toBe('no-webpush');
  });
});
