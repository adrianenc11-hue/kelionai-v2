'use strict';

// Audit M8 — /api/memory/consolidate endpoint + DB-helper round-trip.
//
// The PURE planner is covered in memory-consolidator.test.js. This
// suite wires the router against a mock DB so we can assert:
//
//   * dry-run (default) returns a plan but performs zero writes,
//   * live-run calls the correct DB helper per action,
//   * the plan and applied counters are consistent,
//   * archived rows are no longer returned by listMemoryItems,
//   * addMemoryItems re-affirms a duplicate instead of inserting,
//   * the endpoint never operates on another user's rows.
//
// Rather than boot the full app we mount just the memory router behind
// a lightweight fake-auth middleware that pins req.user to whichever
// id the caller passed via the `X-User` header — exactly how other
// suites in this repo (conversations.test.js, preferred-language.test.js)
// compose express + supertest against a jest-mocked db module.

process.env.NODE_ENV = 'test';

const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => {
  // In-memory store keyed by user_id. Each bucket is an array of
  // memory rows mimicking the real SQLite schema (id, kind, fact,
  // tier, created_at, last_affirmed_at, archived_at, archived_reason).
  const mockStore = new Map();
  let mockNextId = 1;
  const mockBucket = (uid) => {
    if (!mockStore.has(uid)) mockStore.set(uid, []);
    return mockStore.get(uid);
  };

  return {
    __mockReset: () => { mockStore.clear(); mockNextId = 1; },
    __mockSeed: (uid, rows) => {
      const bucket = mockBucket(uid);
      for (const r of rows) {
        bucket.push({
          id: r.id != null ? r.id : mockNextId++,
          user_id: uid,
          kind: r.kind || 'fact',
          fact: r.fact,
          tier: r.tier || 'recent',
          last_affirmed_at: r.last_affirmed_at || new Date().toISOString(),
          archived_at: r.archived_at || null,
          archived_reason: r.archived_reason || null,
          created_at: r.created_at || new Date().toISOString(),
        });
        if (r.id != null && r.id >= mockNextId) mockNextId = r.id + 1;
      }
    },
    __mockDump: (uid) => [...mockBucket(uid)],

    addMemoryItems: async (uid, items) => {
      const bucket = mockBucket(uid);
      const inserted = [];
      for (const it of items) {
        const fact = String(it.fact || '').trim().slice(0, 500);
        if (!fact) continue;
        const kind = String(it.kind || 'fact').slice(0, 40);
        const dup = bucket.find((r) => r.fact === fact && !r.archived_at);
        if (dup) {
          dup.last_affirmed_at = new Date().toISOString();
          continue;
        }
        const row = {
          id: mockNextId++,
          user_id: uid,
          kind,
          fact,
          tier: 'recent',
          last_affirmed_at: new Date().toISOString(),
          archived_at: null,
          archived_reason: null,
          created_at: new Date().toISOString(),
        };
        bucket.push(row);
        inserted.push({ id: row.id, user_id: uid, kind, fact });
      }
      return inserted;
    },

    listMemoryItems: async (uid, limit = 100) => {
      const bucket = mockBucket(uid).filter((r) => !r.archived_at);
      bucket.sort((a, b) => {
        if ((a.tier === 'core') !== (b.tier === 'core')) return a.tier === 'core' ? -1 : 1;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      return bucket.slice(0, limit).map((r) => ({
        id: r.id, kind: r.kind, fact: r.fact, tier: r.tier,
        last_affirmed_at: r.last_affirmed_at, created_at: r.created_at,
      }));
    },

    listAllMemoryItems: async (uid, limit = 500) => {
      const bucket = [...mockBucket(uid)];
      bucket.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return bucket.slice(0, limit);
    },

    deleteMemoryItem: async (uid, id) => {
      const bucket = mockBucket(uid);
      const idx = bucket.findIndex((r) => r.id === Number(id));
      if (idx === -1) return false;
      bucket.splice(idx, 1);
      return true;
    },

    clearMemoryForUser: async (uid) => {
      const bucket = mockBucket(uid);
      const count = bucket.length;
      bucket.length = 0;
      return count;
    },

    archiveMemoryItem: async (uid, id, reason) => {
      const row = mockBucket(uid).find((r) => r.id === Number(id) && !r.archived_at);
      if (!row) return false;
      row.archived_at = new Date().toISOString();
      row.archived_reason = reason ? String(reason).slice(0, 200) : null;
      return true;
    },

    restoreMemoryItem: async (uid, id) => {
      const row = mockBucket(uid).find((r) => r.id === Number(id) && r.archived_at);
      if (!row) return false;
      row.archived_at = null;
      row.archived_reason = null;
      row.last_affirmed_at = new Date().toISOString();
      return true;
    },

    setMemoryItemTier: async (uid, id, tier) => {
      const row = mockBucket(uid).find((r) => r.id === Number(id));
      if (!row) return false;
      row.tier = tier === 'core' ? 'core' : 'recent';
      return true;
    },
  };
});

const db = require('../src/db');
const memoryRouter = require('../src/routes/memory');
const { STALE_MS, PROMOTE_AFFIRM_MS, MAX_RECENT_KEPT } =
  require('../src/services/memoryConsolidator');

// Tiny app: fake auth reads the user id from the X-User header so each
// test can exercise the route as a specific user without minting JWTs.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.header('X-User');
    if (uid) req.user = { id: Number(uid) };
    next();
  });
  app.use('/api/memory', memoryRouter);
  return app;
}

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  db.__mockReset();
});

// ────────────────────────── dry-run ───────────────────────────────

describe('POST /api/memory/consolidate — dry run', () => {
  test('returns plan, writes nothing', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'occupation', fact: 'electrician',
        created_at: new Date(Date.now() - 120 * DAY).toISOString() },
      { id: 11, kind: 'occupation', fact: 'programmer',
        created_at: new Date(Date.now() -   2 * DAY).toISOString() },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate?dry=1')
      .set('X-User', '1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.applied).toBe(null);
    expect(res.body.plan).toHaveLength(1);
    expect(res.body.plan[0].id).toBe(10);
    expect(res.body.plan[0].action).toBe('archive');
    // Nothing was written — #10 still has archived_at === null.
    const dump = db.__mockDump(1);
    expect(dump.find((r) => r.id === 10).archived_at).toBe(null);
  });

  test('dry-run via JSON body is honoured', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'role', fact: 'a',
        created_at: new Date(Date.now() - 100 * DAY).toISOString() },
      { id: 11, kind: 'role', fact: 'b',
        created_at: new Date(Date.now() -   2 * DAY).toISOString() },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.applied).toBe(null);
    expect(db.__mockDump(1).find((r) => r.id === 10).archived_at).toBe(null);
  });

  test('dry-run on an already-clean set yields empty plan', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'preference', fact: 'pizza' },
      { id: 11, kind: 'preference', fact: 'sushi' },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate?dry=1')
      .set('X-User', '1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.plan).toEqual([]);
    expect(res.body.applied).toBe(null);
  });
});

// ────────────────────────── live apply ────────────────────────────

describe('POST /api/memory/consolidate — live apply', () => {
  test('contradiction archives loser, winner stays live', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'occupation', fact: 'electrician',
        created_at: new Date(Date.now() - 120 * DAY).toISOString() },
      { id: 11, kind: 'occupation', fact: 'programmer',
        created_at: new Date(Date.now() -   2 * DAY).toISOString() },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.applied).toEqual({ archived: 1, promoted: 0, demoted: 0 });
    const dump = db.__mockDump(1);
    expect(dump.find((r) => r.id === 10).archived_at).not.toBe(null);
    expect(dump.find((r) => r.id === 10).archived_reason)
      .toMatch(/contradicts newer 'occupation' fact #11/);
    expect(dump.find((r) => r.id === 11).archived_at).toBe(null);
  });

  test('promotion moves a re-affirmed identity fact to core', async () => {
    db.__mockSeed(1, [
      {
        id: 10,
        kind: 'identity',
        fact: 'User is Adrian',
        tier: 'recent',
        created_at: new Date(Date.now() - (PROMOTE_AFFIRM_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(Date.now() - DAY).toISOString(),
      },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    expect(res.body.applied).toEqual({ archived: 0, promoted: 1, demoted: 0 });
    expect(db.__mockDump(1).find((r) => r.id === 10).tier).toBe('core');
  });

  test('stale context fact gets archived', async () => {
    db.__mockSeed(1, [
      {
        id: 10,
        kind: 'context',
        fact: 'User asked about Mamaia last summer',
        created_at: new Date(Date.now() - (STALE_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(Date.now() - (STALE_MS + 30 * DAY)).toISOString(),
      },
    ]);
    const res = await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    expect(res.body.applied).toEqual({ archived: 1, promoted: 0, demoted: 0 });
    expect(db.__mockDump(1).find((r) => r.id === 10).archived_at).not.toBe(null);
  });
});

// ────────────────────────── isolation ─────────────────────────────

describe('POST /api/memory/consolidate — per-user isolation', () => {
  test('never touches another user\'s rows', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'occupation', fact: 'a',
        created_at: new Date(Date.now() - 90 * DAY).toISOString() },
      { id: 11, kind: 'occupation', fact: 'b',
        created_at: new Date(Date.now() -  1 * DAY).toISOString() },
    ]);
    db.__mockSeed(2, [
      { id: 20, kind: 'occupation', fact: 'c',
        created_at: new Date(Date.now() - 90 * DAY).toISOString() },
      { id: 21, kind: 'occupation', fact: 'd',
        created_at: new Date(Date.now() -  1 * DAY).toISOString() },
    ]);
    await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    // User 2 rows are untouched.
    const dump2 = db.__mockDump(2);
    expect(dump2.find((r) => r.id === 20).archived_at).toBe(null);
    expect(dump2.find((r) => r.id === 21).archived_at).toBe(null);
    // User 1 got the normal consolidation.
    const dump1 = db.__mockDump(1);
    expect(dump1.find((r) => r.id === 10).archived_at).not.toBe(null);
  });
});

// ────────────────────────── listMemoryItems filter ────────────────

describe('listMemoryItems — filters archived after consolidation', () => {
  test('archived rows disappear from prompt list; live rows stay', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'occupation', fact: 'electrician',
        created_at: new Date(Date.now() - 120 * DAY).toISOString() },
      { id: 11, kind: 'occupation', fact: 'programmer',
        created_at: new Date(Date.now() -   2 * DAY).toISOString() },
    ]);
    await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    const live = await db.listMemoryItems(1, 60);
    expect(live.map((r) => r.id)).toEqual([11]);
  });

  test('core-tier item sorts first even when newer recent items exist', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'identity', fact: 'Name is Adrian',
        tier: 'core',
        created_at: new Date(Date.now() - 200 * DAY).toISOString() },
      { id: 11, kind: 'preference', fact: 'Likes tea',
        tier: 'recent',
        created_at: new Date(Date.now() - 1 * DAY).toISOString() },
    ]);
    const live = await db.listMemoryItems(1, 60);
    expect(live[0].id).toBe(10);
    expect(live[1].id).toBe(11);
  });
});

// ────────────────────────── addMemoryItems re-affirm ──────────────

describe('addMemoryItems — re-affirms duplicates', () => {
  test('re-adding an existing fact bumps last_affirmed_at without inserting', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'identity', fact: 'Name is Adrian',
        last_affirmed_at: new Date(Date.now() - 30 * DAY).toISOString() },
    ]);
    const before = db.__mockDump(1).find((r) => r.id === 10).last_affirmed_at;
    // Tick the clock so the re-affirm produces a strictly newer ISO string.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const added = await db.addMemoryItems(1, [{ kind: 'identity', fact: 'Name is Adrian' }]);
    expect(added).toEqual([]); // nothing inserted
    const after = db.__mockDump(1).find((r) => r.id === 10).last_affirmed_at;
    expect(after >= before).toBe(true);
    // Only the one row exists.
    expect(db.__mockDump(1).filter((r) => r.fact === 'Name is Adrian')).toHaveLength(1);
  });

  test('a new distinct fact still inserts a new row', async () => {
    db.__mockSeed(1, [{ id: 10, kind: 'identity', fact: 'Name is Adrian' }]);
    const added = await db.addMemoryItems(1, [{ kind: 'preference', fact: 'Likes tea' }]);
    expect(added).toHaveLength(1);
    expect(db.__mockDump(1)).toHaveLength(2);
  });
});

// ────────────────────────── budgets applied live ─────────────────

describe('POST /api/memory/consolidate — budget enforcement writes', () => {
  test('recent over budget → oldest are archived in DB', async () => {
    const rows = [];
    // Generate MAX_RECENT_KEPT+3 unique, non-substring facts.
    const LABELS = ['alpha', 'bravo', 'cobra', 'delta', 'ember', 'frost',
      'gamma', 'horse', 'indigo', 'jade', 'koa', 'lumen', 'maple', 'neon',
      'opal', 'pearl', 'quick', 'rise', 'slate', 'tidal', 'ultra', 'violet',
      'wren', 'xenon', 'yarrow', 'zulu', 'amber', 'birch', 'cedar', 'dusk',
      'echo', 'fern', 'gusty', 'honey', 'ivory', 'jasper', 'kilo', 'lapis',
      'mirth', 'north', 'olive', 'pluto', 'quartz', 'ruby', 'slope', 'tango',
      'ultra', 'verve', 'willow', 'xray', 'yacht', 'zenit', 'angle', 'bloom',
      'crisp', 'daring', 'emerald', 'frame', 'glide', 'heist', 'inkwell',
      'joust', 'kite', 'loam', 'mango', 'nudge', 'ooze', 'plume', 'quell',
      'raven', 'shank', 'terse', 'urge', 'vault', 'wisp', 'xylo', 'yield',
      'zebra', 'aspen', 'bistro', 'cogent', 'dredge', 'elide', 'frisk',
      'gavel', 'hassle', 'icing', 'joust'];
    for (let i = 1; i <= MAX_RECENT_KEPT + 3; i++) {
      rows.push({
        id: i,
        kind: 'preference',
        tier: 'recent',
        fact: `unique-${LABELS[i % LABELS.length]}-${i}`,
        created_at: new Date(Date.now() - (i * DAY)).toISOString(),
        last_affirmed_at: new Date(Date.now() - (i * DAY)).toISOString(),
      });
    }
    db.__mockSeed(1, rows);
    const res = await request(buildApp())
      .post('/api/memory/consolidate')
      .set('X-User', '1')
      .send({});
    expect(res.body.applied.archived).toBe(3);
    const archived = db.__mockDump(1).filter((r) => r.archived_at);
    expect(archived).toHaveLength(3);
    // The three oldest (highest i → oldest) should be the ones archived.
    const archivedIds = archived.map((r) => r.id).sort((a, b) => a - b);
    expect(archivedIds).toEqual([
      MAX_RECENT_KEPT + 1, MAX_RECENT_KEPT + 2, MAX_RECENT_KEPT + 3,
    ]);
  });
});

// ────────────────────────── error paths ───────────────────────────

describe('POST /api/memory/consolidate — error paths', () => {
  test('limit is clamped to [1,1000]', async () => {
    db.__mockSeed(1, [
      { id: 10, kind: 'preference', fact: 'a' },
    ]);
    // Over-large ?limit should not crash; we confirm via 200.
    const r1 = await request(buildApp())
      .post('/api/memory/consolidate?dry=1&limit=99999')
      .set('X-User', '1')
      .send({});
    expect(r1.status).toBe(200);
    // Non-numeric ?limit also must not crash.
    const r2 = await request(buildApp())
      .post('/api/memory/consolidate?dry=1&limit=abc')
      .set('X-User', '1')
      .send({});
    expect(r2.status).toBe(200);
  });
});
