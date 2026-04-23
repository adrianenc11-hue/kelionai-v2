'use strict';

// Dev Studio (DS-1) — workspace CRUD + file I/O tests.
//
// We run against a real in-memory SQLite (same pattern used by
// preferred-language.test.js) rather than mocking the DB, because
// writeStudioFile / deleteStudioFile need the actual round-trip to
// exercise JSON (de)serialization, the unique (user_id, name) index,
// and the byte-accounting that protects the 50 MB / 1 GB caps.
//
// Coverage targets:
//   • Path sanitizer: absolute, traversal, NUL, Windows, empty seg,
//     too-long, non-string → all rejected.
//   • Name sanitizer: empty / whitespace / control chars / too-long.
//   • CRUD: list / create / get / rename / delete, empty-state OK.
//   • Ownership isolation: user B cannot read, write to, rename, or
//     delete user A's workspace or files.
//   • Quotas: per-file (5 MB), per-workspace (50 MB), per-user (1 GB),
//     per-workspace file count (500).
//   • Content semantics: UTF-8 byte counting, overwrite updates size
//     deltas correctly (no double-count, no negative remaining).
//   • Concurrency: serializeStudioWrite keeps two concurrent writes
//     on the same workspace from clobbering each other.
//   • REST surface: all verbs return the documented shape, ownership
//     is enforced at the route layer (404 for not-found AND not-owned),
//     quota violations get 413 with a `code` tag the UI can branch on.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = ':memory:';
delete process.env.DATABASE_URL;

const express = require('express');
const request = require('supertest');

let db;
let dbMod;
let userA;
let userB;

beforeAll(async () => {
  jest.resetModules();
  dbMod = require('../src/db');
  db = await dbMod.initDb();

  userA = await dbMod.createUser({
    google_id: 'ds-a',
    email: 'studio-a@test.dev',
    name: 'Studio A',
    picture: null,
  });
  userB = await dbMod.createUser({
    google_id: 'ds-b',
    email: 'studio-b@test.dev',
    name: 'Studio B',
    picture: null,
  });
});

// Each test that creates workspaces cleans up after itself so we
// don't bleed state across describe blocks — the unique (user_id,
// name) index otherwise rejects the second run of "proj".
afterEach(async () => {
  await db.exec('DELETE FROM studio_workspaces');
});

// ───────────────────────── path / name sanitizers ──────────────────

describe('sanitizeStudioPath', () => {
  const { sanitizeStudioPath } = require('../src/db');

  test('accepts simple file names', () => {
    expect(sanitizeStudioPath('main.py')).toBe('main.py');
    expect(sanitizeStudioPath('src/app.js')).toBe('src/app.js');
    expect(sanitizeStudioPath('deep/nested/dir/file.txt')).toBe('deep/nested/dir/file.txt');
  });
  test('trims leading/trailing whitespace', () => {
    expect(sanitizeStudioPath('  main.py  ')).toBe('main.py');
  });
  test('rejects absolute paths', () => {
    expect(sanitizeStudioPath('/etc/passwd')).toBeNull();
    expect(sanitizeStudioPath('/main.py')).toBeNull();
  });
  test('rejects parent traversal', () => {
    expect(sanitizeStudioPath('../secret')).toBeNull();
    expect(sanitizeStudioPath('src/../../etc/passwd')).toBeNull();
    expect(sanitizeStudioPath('src/..')).toBeNull();
  });
  test('rejects current-dir segments', () => {
    expect(sanitizeStudioPath('./main.py')).toBeNull();
    expect(sanitizeStudioPath('src/./app.js')).toBeNull();
  });
  test('rejects backslashes (Windows / traversal trick)', () => {
    expect(sanitizeStudioPath('src\\app.js')).toBeNull();
  });
  test('rejects NUL and control chars', () => {
    expect(sanitizeStudioPath('main\u0000.py')).toBeNull();
    expect(sanitizeStudioPath('main\n.py')).toBeNull();
    expect(sanitizeStudioPath('main\t.py')).toBeNull();
  });
  test('rejects empty / whitespace-only / empty segments', () => {
    expect(sanitizeStudioPath('')).toBeNull();
    expect(sanitizeStudioPath('   ')).toBeNull();
    expect(sanitizeStudioPath('foo//bar')).toBeNull();
    expect(sanitizeStudioPath('src/')).toBeNull();
  });
  test('rejects non-string input', () => {
    expect(sanitizeStudioPath(null)).toBeNull();
    expect(sanitizeStudioPath(undefined)).toBeNull();
    expect(sanitizeStudioPath(42)).toBeNull();
    expect(sanitizeStudioPath({})).toBeNull();
  });
  test('rejects paths longer than 512 chars', () => {
    expect(sanitizeStudioPath('a'.repeat(513))).toBeNull();
    expect(sanitizeStudioPath('a'.repeat(512))).toBe('a'.repeat(512));
  });
});

describe('sanitizeStudioName', () => {
  const { sanitizeStudioName } = require('../src/db');

  test('accepts typical project names', () => {
    expect(sanitizeStudioName('telegram-bot')).toBe('telegram-bot');
    expect(sanitizeStudioName('Crypto Scraper 2026')).toBe('Crypto Scraper 2026');
  });
  test('trims whitespace', () => {
    expect(sanitizeStudioName('  foo  ')).toBe('foo');
  });
  test('rejects empty / whitespace-only', () => {
    expect(sanitizeStudioName('')).toBeNull();
    expect(sanitizeStudioName('   ')).toBeNull();
  });
  test('rejects control chars', () => {
    expect(sanitizeStudioName('foo\n')).toBeNull();
    expect(sanitizeStudioName('foo\u0000bar')).toBeNull();
  });
  test('rejects too-long names', () => {
    expect(sanitizeStudioName('x'.repeat(121))).toBeNull();
    expect(sanitizeStudioName('x'.repeat(120))).toBe('x'.repeat(120));
  });
  test('rejects non-string', () => {
    expect(sanitizeStudioName(null)).toBeNull();
    expect(sanitizeStudioName(undefined)).toBeNull();
    expect(sanitizeStudioName(42)).toBeNull();
  });
});

// ───────────────────────── workspace CRUD ──────────────────────────

describe('createStudioWorkspace', () => {
  test('creates a new empty workspace', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'proj1');
    expect(ws.id).toBeTruthy();
    expect(ws.user_id).toBe(userA.id);
    expect(ws.name).toBe('proj1');
    expect(ws.files).toEqual({});
    expect(ws.size_bytes).toBe(0);
  });
  test('rejects invalid name', async () => {
    await expect(dbMod.createStudioWorkspace(userA.id, '')).rejects.toThrow(/invalid/);
    await expect(dbMod.createStudioWorkspace(userA.id, '   ')).rejects.toThrow(/invalid/);
    await expect(dbMod.createStudioWorkspace(userA.id, 'x'.repeat(121)))
      .rejects.toThrow(/invalid/);
  });
  test('rejects duplicate name for same user', async () => {
    await dbMod.createStudioWorkspace(userA.id, 'dup');
    await expect(dbMod.createStudioWorkspace(userA.id, 'dup'))
      .rejects.toThrow(/exists/);
  });
  test('allows same name for different users', async () => {
    await dbMod.createStudioWorkspace(userA.id, 'shared');
    const wsB = await dbMod.createStudioWorkspace(userB.id, 'shared');
    expect(wsB.name).toBe('shared');
  });
});

describe('listStudioWorkspaces', () => {
  test('empty state returns []', async () => {
    const rows = await dbMod.listStudioWorkspaces(userA.id);
    expect(rows).toEqual([]);
  });
  test('returns only the caller\'s workspaces', async () => {
    await dbMod.createStudioWorkspace(userA.id, 'a1');
    await dbMod.createStudioWorkspace(userA.id, 'a2');
    await dbMod.createStudioWorkspace(userB.id, 'b1');
    const rowsA = await dbMod.listStudioWorkspaces(userA.id);
    const rowsB = await dbMod.listStudioWorkspaces(userB.id);
    expect(rowsA.map((r) => r.name).sort()).toEqual(['a1', 'a2']);
    expect(rowsB.map((r) => r.name)).toEqual(['b1']);
  });
  test('orders by updated_at DESC', async () => {
    const first  = await dbMod.createStudioWorkspace(userA.id, 'first');
    const second = await dbMod.createStudioWorkspace(userA.id, 'second');
    await new Promise((r) => setTimeout(r, 10));
    await dbMod.writeStudioFile(userA.id, first.id, 'x.py', 'touch');
    const rows = await dbMod.listStudioWorkspaces(userA.id);
    expect(rows[0].id).toBe(first.id); // bumped by write
    expect(rows[1].id).toBe(second.id);
  });
  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await dbMod.createStudioWorkspace(userA.id, `w${i}`);
    }
    const rows = await dbMod.listStudioWorkspaces(userA.id, 2);
    expect(rows).toHaveLength(2);
  });
  test('clamps limit to [1, 500]', async () => {
    for (let i = 0; i < 3; i++) {
      await dbMod.createStudioWorkspace(userA.id, `w${i}`);
    }
    expect((await dbMod.listStudioWorkspaces(userA.id, 0))).toHaveLength(1);
    expect((await dbMod.listStudioWorkspaces(userA.id, -5))).toHaveLength(1);
    expect((await dbMod.listStudioWorkspaces(userA.id, 9999))).toHaveLength(3);
  });
});

describe('getStudioWorkspace', () => {
  test('returns null for unknown id', async () => {
    expect(await dbMod.getStudioWorkspace(userA.id, 99999)).toBeNull();
  });
  test('returns null across owners (isolation)', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'private');
    expect(await dbMod.getStudioWorkspace(userB.id, wsA.id)).toBeNull();
  });
  test('returns parsed files on owner read', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'proj');
    await dbMod.writeStudioFile(userA.id, ws.id, 'main.py', 'print(1)');
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(fresh.files['main.py'].content).toBe('print(1)');
    expect(fresh.size_bytes).toBe(Buffer.byteLength('print(1)'));
  });
});

describe('getStudioWorkspaceByName', () => {
  test('finds by exact name for owner only', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'named');
    expect((await dbMod.getStudioWorkspaceByName(userA.id, 'named')).id).toBe(wsA.id);
    expect(await dbMod.getStudioWorkspaceByName(userB.id, 'named')).toBeNull();
  });
  test('null on missing / invalid name', async () => {
    expect(await dbMod.getStudioWorkspaceByName(userA.id, '')).toBeNull();
    expect(await dbMod.getStudioWorkspaceByName(userA.id, 'nope')).toBeNull();
  });
});

describe('renameStudioWorkspace', () => {
  test('renames for owner', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'old');
    const ok = await dbMod.renameStudioWorkspace(userA.id, ws.id, 'new');
    expect(ok).toBe(true);
    expect((await dbMod.getStudioWorkspace(userA.id, ws.id)).name).toBe('new');
  });
  test('rejects invalid name', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'old');
    await expect(dbMod.renameStudioWorkspace(userA.id, ws.id, ''))
      .rejects.toThrow(/invalid/);
  });
  test('rejects duplicate rename', async () => {
    await dbMod.createStudioWorkspace(userA.id, 'taken');
    const other = await dbMod.createStudioWorkspace(userA.id, 'other');
    await expect(dbMod.renameStudioWorkspace(userA.id, other.id, 'taken'))
      .rejects.toThrow(/exists/);
  });
  test('non-owner cannot rename', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'owned');
    expect(await dbMod.renameStudioWorkspace(userB.id, wsA.id, 'stolen')).toBe(false);
    expect((await dbMod.getStudioWorkspace(userA.id, wsA.id)).name).toBe('owned');
  });
  test('returns false for unknown id', async () => {
    expect(await dbMod.renameStudioWorkspace(userA.id, 99999, 'x')).toBe(false);
  });
});

describe('deleteStudioWorkspace', () => {
  test('deletes for owner', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'gone');
    expect(await dbMod.deleteStudioWorkspace(userA.id, ws.id)).toBe(true);
    expect(await dbMod.getStudioWorkspace(userA.id, ws.id)).toBeNull();
  });
  test('non-owner cannot delete', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'mine');
    expect(await dbMod.deleteStudioWorkspace(userB.id, wsA.id)).toBe(false);
    expect(await dbMod.getStudioWorkspace(userA.id, wsA.id)).not.toBeNull();
  });
  test('returns false for unknown id', async () => {
    expect(await dbMod.deleteStudioWorkspace(userA.id, 99999)).toBe(false);
  });
});

// ───────────────────────── file I/O ────────────────────────────────

describe('writeStudioFile', () => {
  test('writes a new file and returns metadata', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'write');
    const r = await dbMod.writeStudioFile(userA.id, ws.id, 'main.py', 'print(1)');
    expect(r.path).toBe('main.py');
    expect(r.size).toBe(Buffer.byteLength('print(1)'));
    expect(r.workspace_size_bytes).toBe(r.size);
  });
  test('overwrites a file and updates size delta correctly', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'write2');
    await dbMod.writeStudioFile(userA.id, ws.id, 'x.py', 'short');
    const r = await dbMod.writeStudioFile(userA.id, ws.id, 'x.py', 'longer content here');
    expect(r.workspace_size_bytes).toBe(Buffer.byteLength('longer content here'));
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(fresh.size_bytes).toBe(Buffer.byteLength('longer content here'));
  });
  test('counts UTF-8 bytes (not chars)', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'unicode');
    const content = 'héllo 🚀'; // multi-byte
    const r = await dbMod.writeStudioFile(userA.id, ws.id, 'utf8.py', content);
    expect(r.size).toBe(Buffer.byteLength(content, 'utf8'));
    expect(r.size).toBeGreaterThan(content.length);
  });
  test('rejects > 5 MB file with FILE_TOO_BIG', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'big');
    const huge = 'A'.repeat(5 * 1024 * 1024 + 1);
    await expect(dbMod.writeStudioFile(userA.id, ws.id, 'big.txt', huge))
      .rejects.toMatchObject({ studioQuota: 'FILE_TOO_BIG' });
  });
  test('rejects invalid path', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'pathbad');
    await expect(dbMod.writeStudioFile(userA.id, ws.id, '../x', 'y'))
      .rejects.toMatchObject({ studioQuota: 'PATH_INVALID' });
    await expect(dbMod.writeStudioFile(userA.id, ws.id, '/abs', 'y'))
      .rejects.toMatchObject({ studioQuota: 'PATH_INVALID' });
  });
  test('rejects non-string content', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'types');
    await expect(dbMod.writeStudioFile(userA.id, ws.id, 'main.py', null))
      .rejects.toMatchObject({ studioQuota: 'CONTENT_INVALID' });
    await expect(dbMod.writeStudioFile(userA.id, ws.id, 'main.py', 42))
      .rejects.toMatchObject({ studioQuota: 'CONTENT_INVALID' });
  });
  test('returns null for unknown workspace id (no write)', async () => {
    const r = await dbMod.writeStudioFile(userA.id, 99999, 'x.py', 'y');
    expect(r).toBeNull();
  });
  test('returns null across owners (no cross-user write)', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'owned');
    const r = await dbMod.writeStudioFile(userB.id, wsA.id, 'hack.py', 'pwn');
    expect(r).toBeNull();
    // User A's workspace stayed empty.
    const fresh = await dbMod.getStudioWorkspace(userA.id, wsA.id);
    expect(fresh.files).toEqual({});
    expect(fresh.size_bytes).toBe(0);
  });
  test('accepts empty string as valid content', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'empty');
    const r = await dbMod.writeStudioFile(userA.id, ws.id, 'empty.py', '');
    expect(r.size).toBe(0);
    expect(r.workspace_size_bytes).toBe(0);
  });
  test('concurrent writes to the same workspace are serialized', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'race');
    // Fire 10 writes to different paths in parallel. If they weren't
    // serialized, the size_bytes accounting would be wrong because
    // each write reads the old row before the other finishes updating.
    await Promise.all(
      Array.from({ length: 10 }).map((_, i) =>
        dbMod.writeStudioFile(userA.id, ws.id, `file${i}.py`, 'x'.repeat(1000))
      )
    );
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(Object.keys(fresh.files)).toHaveLength(10);
    expect(fresh.size_bytes).toBe(10 * 1000);
  });
});

describe('deleteStudioFile', () => {
  test('deletes and decrements workspace size', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'del');
    await dbMod.writeStudioFile(userA.id, ws.id, 'a.py', 'one');
    await dbMod.writeStudioFile(userA.id, ws.id, 'b.py', 'twotwo');
    const r = await dbMod.deleteStudioFile(userA.id, ws.id, 'b.py');
    expect(r.deleted).toBe(true);
    expect(r.workspace_size_bytes).toBe(Buffer.byteLength('one'));
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(Object.keys(fresh.files)).toEqual(['a.py']);
  });
  test('no-op on missing file returns deleted:false', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'del2');
    const r = await dbMod.deleteStudioFile(userA.id, ws.id, 'nope.py');
    expect(r.deleted).toBe(false);
  });
  test('rejects invalid path', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'del3');
    await expect(dbMod.deleteStudioFile(userA.id, ws.id, '../bad'))
      .rejects.toMatchObject({ studioQuota: 'PATH_INVALID' });
  });
  test('non-owner cannot delete files', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'del4');
    await dbMod.writeStudioFile(userA.id, wsA.id, 'keep.py', 'important');
    const r = await dbMod.deleteStudioFile(userB.id, wsA.id, 'keep.py');
    expect(r).toBeNull();
    const fresh = await dbMod.getStudioWorkspace(userA.id, wsA.id);
    expect(fresh.files['keep.py']).toBeTruthy();
  });
});

describe('readStudioFile', () => {
  test('returns content for owner', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'read');
    await dbMod.writeStudioFile(userA.id, ws.id, 'main.py', 'print(42)');
    const f = await dbMod.readStudioFile(userA.id, ws.id, 'main.py');
    expect(f.content).toBe('print(42)');
    expect(f.path).toBe('main.py');
    expect(f.size).toBe(Buffer.byteLength('print(42)'));
  });
  test('null across owners', async () => {
    const wsA = await dbMod.createStudioWorkspace(userA.id, 'priv');
    await dbMod.writeStudioFile(userA.id, wsA.id, 'secret.py', 'TOKEN=xyz');
    expect(await dbMod.readStudioFile(userB.id, wsA.id, 'secret.py')).toBeNull();
  });
  test('null for invalid path', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'r2');
    expect(await dbMod.readStudioFile(userA.id, ws.id, '../etc/passwd')).toBeNull();
  });
  test('null for unknown file', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'r3');
    expect(await dbMod.readStudioFile(userA.id, ws.id, 'nope.py')).toBeNull();
  });
});

describe('listStudioFiles', () => {
  test('returns sorted tree', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'ls');
    await dbMod.writeStudioFile(userA.id, ws.id, 'b.py', 'b');
    await dbMod.writeStudioFile(userA.id, ws.id, 'a.py', 'a');
    await dbMod.writeStudioFile(userA.id, ws.id, 'src/c.py', 'c');
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    const files = dbMod.listStudioFiles(fresh);
    expect(files.map((f) => f.path)).toEqual(['a.py', 'b.py', 'src/c.py']);
    expect(files[0].size).toBe(1);
  });
  test('empty workspace returns []', async () => {
    const ws = await dbMod.createStudioWorkspace(userA.id, 'empty');
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(dbMod.listStudioFiles(fresh)).toEqual([]);
  });
  test('handles null workspace gracefully', () => {
    expect(dbMod.listStudioFiles(null)).toEqual([]);
    expect(dbMod.listStudioFiles({})).toEqual([]);
  });
});

// ───────────────────────── quotas (integration) ────────────────────

describe('quota enforcement', () => {
  test('WORKSPACE_FULL when sum exceeds 50 MB', async () => {
    // Use a synthetic per-file size well under 5 MB but sum > 50 MB.
    // 11 × 5 MB-1 = ~55 MB; we stop at the first over-limit write.
    const ws = await dbMod.createStudioWorkspace(userA.id, 'big-ws');
    const chunk = 'X'.repeat(5 * 1024 * 1024 - 1024); // ~5 MB
    let wrote = 0;
    let caught = null;
    for (let i = 0; i < 12; i++) {
      try {
        await dbMod.writeStudioFile(userA.id, ws.id, `f${i}.bin`, chunk);
        wrote++;
      } catch (err) {
        caught = err;
        break;
      }
    }
    // We expect to fit ~10 chunks and be blocked on ~#11.
    expect(wrote).toBeGreaterThanOrEqual(9);
    expect(wrote).toBeLessThanOrEqual(11);
    expect(caught && caught.studioQuota).toBe('WORKSPACE_FULL');
    // Workspace size stayed under the cap even after the failed write.
    const fresh = await dbMod.getStudioWorkspace(userA.id, ws.id);
    expect(fresh.size_bytes).toBeLessThanOrEqual(dbMod.MAX_STUDIO_WORKSPACE_BYTES);
  });
});

describe('getUserStudioUsage', () => {
  test('returns 0 for fresh user', async () => {
    const u = await dbMod.getUserStudioUsage(userA.id);
    expect(u.workspaces).toBe(0);
    expect(u.total_bytes).toBe(0);
    expect(u.quota_bytes).toBe(dbMod.MAX_STUDIO_USER_BYTES);
  });
  test('sums across all workspaces', async () => {
    const w1 = await dbMod.createStudioWorkspace(userA.id, 'u1');
    const w2 = await dbMod.createStudioWorkspace(userA.id, 'u2');
    await dbMod.writeStudioFile(userA.id, w1.id, 'a.py', 'hello');
    await dbMod.writeStudioFile(userA.id, w2.id, 'b.py', 'world!');
    const u = await dbMod.getUserStudioUsage(userA.id);
    expect(u.workspaces).toBe(2);
    expect(u.total_bytes).toBe(Buffer.byteLength('hello') + Buffer.byteLength('world!'));
  });
  test('does not include other users', async () => {
    const wsB = await dbMod.createStudioWorkspace(userB.id, 'bu');
    await dbMod.writeStudioFile(userB.id, wsB.id, 'x.py', 'xxxxxxxxxxxxxxx');
    const uA = await dbMod.getUserStudioUsage(userA.id);
    expect(uA.total_bytes).toBe(0);
  });
});

// ───────────────────────── REST endpoints ──────────────────────────

describe('REST /api/studio', () => {
  let app;
  let uidStub;

  beforeAll(() => {
    const studioRouter = require('../src/routes/studio');
    app = express();
    app.use(express.json({ limit: '15mb' }));
    app.use((req, _res, next) => { req.user = { id: uidStub }; next(); });
    app.use('/api/studio', studioRouter);
  });

  beforeEach(() => { uidStub = userA.id; });

  test('GET /usage empty state', async () => {
    const r = await request(app).get('/api/studio/usage');
    expect(r.status).toBe(200);
    expect(r.body.workspaces).toBe(0);
    expect(r.body.total_bytes).toBe(0);
    expect(r.body.limits.file_bytes).toBe(dbMod.MAX_STUDIO_FILE_BYTES);
    expect(r.body.limits.workspace_bytes).toBe(dbMod.MAX_STUDIO_WORKSPACE_BYTES);
    expect(r.body.limits.user_bytes).toBe(dbMod.MAX_STUDIO_USER_BYTES);
  });

  test('POST /workspaces creates', async () => {
    const r = await request(app)
      .post('/api/studio/workspaces')
      .send({ name: 'hello-bot' });
    expect(r.status).toBe(201);
    expect(r.body.workspace.name).toBe('hello-bot');
    expect(r.body.workspace.files).toEqual([]);
    expect(r.body.workspace.size_bytes).toBe(0);
  });

  test('POST /workspaces rejects invalid name with 400 + NAME_INVALID', async () => {
    const r = await request(app)
      .post('/api/studio/workspaces')
      .send({ name: '' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NAME_INVALID');
  });

  test('POST /workspaces returns 409 + NAME_DUP on conflict', async () => {
    await request(app).post('/api/studio/workspaces').send({ name: 'once' });
    const r = await request(app)
      .post('/api/studio/workspaces').send({ name: 'once' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NAME_DUP');
  });

  test('GET /workspaces lists only caller\'s', async () => {
    await request(app).post('/api/studio/workspaces').send({ name: 'mine-1' });
    uidStub = userB.id;
    await request(app).post('/api/studio/workspaces').send({ name: 'mine-2' });
    uidStub = userA.id;
    const r = await request(app).get('/api/studio/workspaces');
    expect(r.status).toBe(200);
    expect(r.body.items.map((x) => x.name)).toEqual(['mine-1']);
  });

  test('GET /workspaces/:id 404 on not-found', async () => {
    const r = await request(app).get('/api/studio/workspaces/99999');
    expect(r.status).toBe(404);
  });

  test('GET /workspaces/:id 400 on non-numeric id', async () => {
    const r = await request(app).get('/api/studio/workspaces/abc');
    expect(r.status).toBe(400);
  });

  test('GET /workspaces/:id 404 for not-owned (no probe leak)', async () => {
    const crA = await request(app)
      .post('/api/studio/workspaces').send({ name: 'owned' });
    const id = crA.body.workspace.id;
    uidStub = userB.id;
    const r = await request(app).get(`/api/studio/workspaces/${id}`);
    expect(r.status).toBe(404);
  });

  test('GET /workspaces/:id returns file tree after writes', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'tree' });
    const id = cr.body.workspace.id;
    await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'main.py', content: 'print(1)' });
    await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'src/util.py', content: 'pass' });
    const r = await request(app).get(`/api/studio/workspaces/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.workspace.files.map((f) => f.path)).toEqual([
      'main.py', 'src/util.py',
    ]);
    expect(r.body.workspace.size_bytes).toBe(
      Buffer.byteLength('print(1)') + Buffer.byteLength('pass')
    );
  });

  test('PATCH /workspaces/:id renames', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'oldname' });
    const r = await request(app)
      .patch(`/api/studio/workspaces/${cr.body.workspace.id}`)
      .send({ name: 'newname' });
    expect(r.status).toBe(200);
    const g = await request(app)
      .get(`/api/studio/workspaces/${cr.body.workspace.id}`);
    expect(g.body.workspace.name).toBe('newname');
  });

  test('PATCH /workspaces/:id 400 on invalid name', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'patchbad' });
    const r = await request(app)
      .patch(`/api/studio/workspaces/${cr.body.workspace.id}`)
      .send({ name: '' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NAME_INVALID');
  });

  test('PATCH /workspaces/:id 404 for non-owner', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'locked' });
    uidStub = userB.id;
    const r = await request(app)
      .patch(`/api/studio/workspaces/${cr.body.workspace.id}`)
      .send({ name: 'stolen' });
    expect(r.status).toBe(404);
  });

  test('DELETE /workspaces/:id removes', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'gone' });
    const r = await request(app)
      .delete(`/api/studio/workspaces/${cr.body.workspace.id}`);
    expect(r.status).toBe(200);
    const g = await request(app)
      .get(`/api/studio/workspaces/${cr.body.workspace.id}`);
    expect(g.status).toBe(404);
  });

  test('DELETE /workspaces/:id 404 for non-owner', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'notyours' });
    uidStub = userB.id;
    const r = await request(app)
      .delete(`/api/studio/workspaces/${cr.body.workspace.id}`);
    expect(r.status).toBe(404);
  });

  test('PUT /file writes, GET /file reads', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'rw' });
    const id = cr.body.workspace.id;
    const w = await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'main.py', content: 'print(42)' });
    expect(w.status).toBe(200);
    expect(w.body.file.size).toBe(Buffer.byteLength('print(42)'));

    const r = await request(app)
      .get(`/api/studio/workspaces/${id}/file`)
      .query({ path: 'main.py' });
    expect(r.status).toBe(200);
    expect(r.body.file.content).toBe('print(42)');
  });

  test('PUT /file 400 on invalid path', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'bp' });
    const r = await request(app)
      .put(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .send({ path: '../x', content: 'y' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PATH_INVALID');
  });

  test('PUT /file 413 on oversize file', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'oversize' });
    const huge = 'A'.repeat(dbMod.MAX_STUDIO_FILE_BYTES + 1);
    const r = await request(app)
      .put(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .send({ path: 'big.txt', content: huge });
    expect(r.status).toBe(413);
    expect(r.body.code).toBe('FILE_TOO_BIG');
    expect(r.body.limit).toBe(dbMod.MAX_STUDIO_FILE_BYTES);
  });

  test('PUT /file 404 for non-owner', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'priv' });
    uidStub = userB.id;
    const r = await request(app)
      .put(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .send({ path: 'main.py', content: 'print()' });
    expect(r.status).toBe(404);
  });

  test('GET /file 404 for unknown file', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'rn' });
    const r = await request(app)
      .get(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .query({ path: 'nope.py' });
    expect(r.status).toBe(404);
  });

  test('GET /file 404 for non-owner', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'privr' });
    const id = cr.body.workspace.id;
    await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'secret.py', content: 'PASSWD=xyz' });
    uidStub = userB.id;
    const r = await request(app)
      .get(`/api/studio/workspaces/${id}/file`)
      .query({ path: 'secret.py' });
    expect(r.status).toBe(404);
  });

  test('DELETE /file removes', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'df' });
    const id = cr.body.workspace.id;
    await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'main.py', content: 'print()' });
    const r = await request(app)
      .delete(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'main.py' });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toBe(true);
    const g = await request(app)
      .get(`/api/studio/workspaces/${id}/file`)
      .query({ path: 'main.py' });
    expect(g.status).toBe(404);
  });

  test('DELETE /file 404 for non-owner', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'prof' });
    const id = cr.body.workspace.id;
    await request(app)
      .put(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'a.py', content: 'x' });
    uidStub = userB.id;
    const r = await request(app)
      .delete(`/api/studio/workspaces/${id}/file`)
      .send({ path: 'a.py' });
    expect(r.status).toBe(404);
  });

  test('DELETE /file 400 on invalid path', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'badp' });
    const r = await request(app)
      .delete(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .send({ path: '../x' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PATH_INVALID');
  });

  test('GET /usage reflects writes', async () => {
    const cr = await request(app)
      .post('/api/studio/workspaces').send({ name: 'uu' });
    await request(app)
      .put(`/api/studio/workspaces/${cr.body.workspace.id}/file`)
      .send({ path: 'main.py', content: 'abcdef' });
    const r = await request(app).get('/api/studio/usage');
    expect(r.body.workspaces).toBe(1);
    expect(r.body.total_bytes).toBe(6);
  });
});
