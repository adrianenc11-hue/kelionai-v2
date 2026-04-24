'use strict';

// F1 — visitorLog.extractUserFromToken must read the JWT `sub` claim
// (the standard subject claim that `signAppToken` writes), not `id`.
// The previous implementation read `payload.id`, which silently logged
// every signed-in page load as anonymous and made the admin analytics
// panel report `signedInVisits=0` and `uniqueUsers=0` even with many
// active logged-in users. Regression tests guard both Postgres
// (numeric id column) and SQLite (string id) mode via DATABASE_URL.

jest.mock('../src/db', () => ({
  recordVisitorEvent: jest.fn(async () => {}),
  getUserByEmail: jest.fn(async () => null),
}));

const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { _extractUserFromToken } = require('../src/middleware/visitorLog');

const SECRET = config.jwt && config.jwt.secret;

function fakeReq(cookies) {
  return { cookies: cookies || {} };
}

describe('visitorLog._extractUserFromToken', () => {
  const ORIGINAL_DB_URL = process.env.DATABASE_URL;

  afterEach(() => {
    if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DB_URL;
  });

  test('returns null when no cookie is present', () => {
    expect(_extractUserFromToken(fakeReq({}))).toBeNull();
  });

  test('returns null on malformed token', () => {
    expect(_extractUserFromToken(fakeReq({ 'kelion.token': 'nope' }))).toBeNull();
  });

  test('reads the `sub` claim (SQLite mode keeps string id)', () => {
    delete process.env.DATABASE_URL;
    const token = jwt.sign(
      { sub: 'u-abc-123', email: 'a@example.com', role: 'user' },
      SECRET,
      { expiresIn: '1h' },
    );
    const out = _extractUserFromToken(fakeReq({ 'kelion.token': token }));
    expect(out).toEqual({ id: 'u-abc-123', email: 'a@example.com' });
  });

  test('reads the `sub` claim (Postgres mode coerces to number)', () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const token = jwt.sign(
      { sub: 42, email: 'b@example.com', role: 'user' },
      SECRET,
      { expiresIn: '1h' },
    );
    const out = _extractUserFromToken(fakeReq({ 'kelion.token': token }));
    expect(out).toEqual({ id: 42, email: 'b@example.com' });
  });

  test('Postgres mode drops non-integer sub', () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const token = jwt.sign(
      { sub: 'not-a-number', email: 'c@example.com', role: 'user' },
      SECRET,
      { expiresIn: '1h' },
    );
    const out = _extractUserFromToken(fakeReq({ 'kelion.token': token }));
    expect(out).toEqual({ id: null, email: 'c@example.com' });
  });

  test('falls back to legacy `id` claim when `sub` is missing (SQLite)', () => {
    delete process.env.DATABASE_URL;
    // Hand-sign a payload that only carries `id` (legacy pre-fix token).
    const token = jwt.sign(
      { id: 'legacy-7', email: 'd@example.com', role: 'user' },
      SECRET,
      { expiresIn: '1h' },
    );
    const out = _extractUserFromToken(fakeReq({ 'kelion.token': token }));
    expect(out).toEqual({ id: 'legacy-7', email: 'd@example.com' });
  });
});
