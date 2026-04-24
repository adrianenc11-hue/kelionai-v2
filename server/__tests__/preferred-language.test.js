'use strict';

// F8 — preferred-language unit tests.
//
// Coverage:
//   - utils/language.js normalizer + Accept-Language parser + memory-fact
//     formatter (pure functions, no DB).
//   - db/index.js setPreferredLanguage/getPreferredLanguage against a
//     shared in-memory SQLite backed by the mockDb helper.
//   - routes/auth.js /auth/me/language GET + PUT wired through
//     requireAuth (JWT in Authorization header).
//
// We explicitly do not test the Google OAuth callback path here — it
// shares the same `seedPreferredLanguageOnLogin` helper as the email/
// password flow, which IS covered, and stubbing Google's full HTTP dance
// would more than double the file for no extra coverage.

const path = require('path');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const {
  normalizeLanguage,
  parseAcceptLanguage,
  memoryFactForLanguage,
  SUPPORTED_SHORT,
  LABELS,
} = require('../src/utils/language');

// ────────────────────────────── Pure utilities ───────────────────────

describe('utils/language — normalizeLanguage', () => {
  test('collapses region subtags to the primary tag', () => {
    expect(normalizeLanguage('ro-RO')).toBe('ro');
    expect(normalizeLanguage('en-US')).toBe('en');
    expect(normalizeLanguage('zh_Hant')).toBe('zh');
    expect(normalizeLanguage('PT-BR')).toBe('pt');
  });

  test('accepts already-short tags', () => {
    expect(normalizeLanguage('ro')).toBe('ro');
    expect(normalizeLanguage('EN')).toBe('en');
  });

  test('accepts full English names', () => {
    expect(normalizeLanguage('Romanian')).toBe('ro');
    expect(normalizeLanguage('french')).toBe('fr');
    expect(normalizeLanguage('GERMAN')).toBe('de');
  });

  test('returns null on unsupported / empty input', () => {
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
    expect(normalizeLanguage('klingon')).toBeNull();
    expect(normalizeLanguage('xx-YY')).toBeNull();
  });

  test('whitelist stays in sync with labels map', () => {
    for (const tag of Object.keys(LABELS)) {
      expect(SUPPORTED_SHORT.has(tag)).toBe(true);
    }
  });
});

describe('utils/language — parseAcceptLanguage', () => {
  test('returns highest-quality supported tag', () => {
    expect(parseAcceptLanguage('ro-RO,ro;q=0.9,en;q=0.8,fr;q=0.7')).toBe('ro');
    expect(parseAcceptLanguage('fr;q=0.7,en;q=0.8')).toBe('en');
    expect(parseAcceptLanguage('de-DE, de;q=0.9, *;q=0.1')).toBe('de');
  });

  test('skips unsupported tags and falls through to supported ones', () => {
    expect(parseAcceptLanguage('klingon,ro;q=0.5')).toBe('ro');
  });

  test('returns null on empty / non-string / no-support input', () => {
    expect(parseAcceptLanguage('')).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
    expect(parseAcceptLanguage(42)).toBeNull();
    expect(parseAcceptLanguage('klingon,dothraki')).toBeNull();
  });

  test('treats missing q as q=1 (wins over explicit lower q)', () => {
    expect(parseAcceptLanguage('en;q=0.5,ro')).toBe('ro');
  });
});

describe('utils/language — memoryFactForLanguage', () => {
  test('emits a persona-ready line for supported tags', () => {
    const line = memoryFactForLanguage('ro');
    expect(line).toContain('Romanian');
    expect(line).toContain('(ro)');
    expect(line.toLowerCase()).toContain('greet');
  });

  test('returns null for unsupported input', () => {
    expect(memoryFactForLanguage('klingon')).toBeNull();
    expect(memoryFactForLanguage('')).toBeNull();
  });
});

// ────────────────────────────── DB helpers ───────────────────────────

describe('db helpers — setPreferredLanguage / getPreferredLanguage', () => {
  let db;
  let setPreferredLanguage;
  let getPreferredLanguage;
  let listMemoryItems;
  let createUser;

  beforeAll(async () => {
    // Force an isolated in-memory SQLite for the whole file so we don't
    // step on the real /data/kelion.db or any Postgres config.
    delete process.env.DATABASE_URL;
    process.env.DB_PATH = ':memory:';
    // Reset module registry so initDb picks up the new env.
    jest.resetModules();
    const mod = require('../src/db');
    db = await mod.initDb();
    ({
      setPreferredLanguage,
      getPreferredLanguage,
      listMemoryItems,
      createUser,
    } = mod);
  });

  test('persists tag + seeds deduped locale memory item', async () => {
    const u = await createUser({
      google_id: 'g1',
      email: 'pl-1@test.dev',
      name: 'PL One',
      picture: null,
    });
    const userId = u.id;

    await setPreferredLanguage(userId, 'ro', 'Preferred language: Romanian (ro). Greet in Romanian.');
    expect(await getPreferredLanguage(userId)).toBe('ro');

    const items = await listMemoryItems(userId, 10);
    const locales = items.filter((i) => i.kind === 'locale');
    expect(locales).toHaveLength(1);
    expect(locales[0].fact).toContain('Romanian');
  });

  test('overwriting the language replaces the old locale memory row', async () => {
    const u = await createUser({
      google_id: 'g2',
      email: 'pl-2@test.dev',
      name: 'PL Two',
      picture: null,
    });
    const userId = u.id;

    await setPreferredLanguage(userId, 'ro', 'Preferred language: Romanian (ro).');
    await setPreferredLanguage(userId, 'fr', 'Preferred language: French (fr).');

    expect(await getPreferredLanguage(userId)).toBe('fr');
    const items = await listMemoryItems(userId, 10);
    const locales = items.filter((i) => i.kind === 'locale');
    expect(locales).toHaveLength(1);
    expect(locales[0].fact).toContain('French');
    expect(locales[0].fact).not.toContain('Romanian');
  });

  test('missing userId / tag → no-op', async () => {
    const res1 = await setPreferredLanguage(null, 'ro');
    const res2 = await setPreferredLanguage(1, '');
    expect(res1).toBeNull();
    expect(res2).toBeNull();
    expect(await getPreferredLanguage(null)).toBeNull();
  });
});

// ────────────────────────────── REST endpoints ───────────────────────

describe('GET / PUT /auth/me/language', () => {
  let app;
  let userId;
  let token;
  let createUser;
  let setPreferredLanguage;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.DB_PATH = ':memory:';
    process.env.JWT_SECRET = 'f8-test-secret';
    jest.resetModules();

    const dbMod = require('../src/db');
    await dbMod.initDb();
    ({ createUser, setPreferredLanguage } = dbMod);

    const user = await createUser({
      google_id: 'ghttp',
      email: 'http-user@test.dev',
      name: 'HTTP User',
      picture: null,
    });
    userId = user.id;
    // sign a token that requireAuth will accept
    const config = require('../src/config');
    token = jwt.sign(
      { sub: userId, email: 'http-user@test.dev', name: 'HTTP User' },
      config.jwt.secret
    );

    const authRouter = require('../src/routes/auth');
    app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
  });

  test('GET without token → 401', async () => {
    const r = await request(app).get('/auth/me/language');
    expect(r.status).toBe(401);
  });

  test('GET with no stored value falls back to Accept-Language', async () => {
    const r = await request(app)
      .get('/auth/me/language')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'fr-FR,fr;q=0.9,en;q=0.5');
    expect(r.status).toBe(200);
    expect(r.body.language).toBe('fr');
    expect(r.body.source).toBe('header');
  });

  test('GET with no stored value and no Accept-Language → default en', async () => {
    const r = await request(app)
      .get('/auth/me/language')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.language).toBe('en');
    expect(r.body.source).toBe('default');
  });

  test('PUT with supported short tag updates the column', async () => {
    const r = await request(app)
      .put('/auth/me/language')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'ro' });
    expect(r.status).toBe(200);
    expect(r.body.language).toBe('ro');

    const getR = await request(app)
      .get('/auth/me/language')
      .set('Authorization', `Bearer ${token}`);
    expect(getR.body).toEqual({ language: 'ro', source: 'stored' });
  });

  test('PUT accepts "ro-RO" / "Romanian" / "RO" equivalently', async () => {
    for (const variant of ['ro-RO', 'Romanian', 'RO', 'ro']) {
      const r = await request(app)
        .put('/auth/me/language')
        .set('Authorization', `Bearer ${token}`)
        .send({ language: variant });
      expect(r.status).toBe(200);
      expect(r.body.language).toBe('ro');
    }
  });

  test('PUT rejects unsupported language with 400', async () => {
    const r = await request(app)
      .put('/auth/me/language')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'klingon' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unsupported/i);
  });

  test('PUT without token → 401', async () => {
    const r = await request(app).put('/auth/me/language').send({ language: 'ro' });
    expect(r.status).toBe(401);
  });
});
