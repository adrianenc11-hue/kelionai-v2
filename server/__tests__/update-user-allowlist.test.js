'use strict';

// Audit C3 — updateUser() is the only write path that interpolates
// column identifiers into UPDATE SQL (SQL parameterisation cannot
// parameterise identifiers). The production call-sites all whitelist
// their keys today, but if any future caller ever forwards `req.body`
// verbatim the helper would become a SQL-injection surface. This test
// pins the allowlist so a careless future change is caught in CI
// before it ships.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
// Run against an in-memory SQLite so the test is hermetic and fast —
// no file IO, no leftover state between test files.
process.env.DB_PATH        = ':memory:';
delete process.env.DATABASE_URL;

const db = require('../src/db');

beforeAll(async () => {
  await db.initDb();
});

describe('updateUser column allowlist', () => {
  let userId;

  beforeEach(async () => {
    const u = await db.createUser({
      google_id: `g-${Math.random().toString(36).slice(2)}`,
      email:     `u_${Math.random().toString(36).slice(2)}@test.com`,
      name:      'Test',
      picture:   null,
    });
    userId = u.id;
  });

  it('accepts whitelisted columns', async () => {
    const out = await db.updateUser(userId, {
      name: 'Renamed',
      role: 'admin',
      preferred_language: 'ro',
    });
    expect(out.name).toBe('Renamed');
    expect(out.role).toBe('admin');
    expect(out.preferred_language).toBe('ro');
  });

  it('rejects unknown columns (SQL-injection guard)', async () => {
    await expect(
      db.updateUser(userId, { 'password_hash; DROP TABLE users; --': 'x' })
    ).rejects.toThrow(/unknown column/i);

    // Columns that exist on the table but are NOT in the allowlist
    // (managed by their own helpers) must also be rejected so admin
    // endpoints cannot sidestep the ledger / passkey flows.
    await expect(
      db.updateUser(userId, { credits_balance_minutes: 9999 })
    ).rejects.toThrow(/unknown column/i);

    await expect(
      db.updateUser(userId, { passkey_credentials: '[]' })
    ).rejects.toThrow(/unknown column/i);

    await expect(
      db.updateUser(userId, { id: 1 })
    ).rejects.toThrow(/unknown column/i);
  });

  it('rejects non-object data', async () => {
    await expect(db.updateUser(userId, null)).rejects.toThrow(/must be an object/i);
    await expect(db.updateUser(userId, 'name=Evil')).rejects.toThrow(/must be an object/i);
  });

  it('is a no-op for an empty object (no SQL emitted)', async () => {
    const before = await db.findById(userId);
    const out = await db.updateUser(userId, {});
    expect(out.id).toBe(before.id);
    expect(out.name).toBe(before.name);
  });

  it('still updates the picture column as a plain whitelisted field', async () => {
    const out = await db.updateUser(userId, { picture: 'https://example.com/p.png' });
    expect(out.picture).toBe('https://example.com/p.png');
  });
});
