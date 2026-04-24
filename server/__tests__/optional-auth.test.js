'use strict';

// Unit tests for the admin-identity helpers in middleware/optionalAuth.js
// — the single file /gemini-token and /openai-live-token rely on to tell
// guests, paying users, and admins apart. The tests lock in the F1+F2
// contract from the 2026-04-20 admin audit:
//   • peekSignedInUser never returns null for a JWT that verifies, even
//     when the `sub` isn't a numeric Postgres row id.
//   • isAdminUser returns true when any of JWT role, JWT email, DB role,
//     or DB email identifies an admin — matching requireAdmin so the
//     voice-token endpoints stop disagreeing with the admin dashboard.

jest.mock('../src/db', () => ({
  findById: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { findById } = require('../src/db');
const {
  peekSignedInUser,
  isAdminUser,
  resolveIdentity,
  isAdminEmail,
} = require('../src/middleware/optionalAuth');

function makeReq({ token, bearer } = {}) {
  return {
    cookies: token ? { 'kelion.token': token } : {},
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  };
}

function signJwt(claims) {
  return jwt.sign(claims, config.jwt.secret, { expiresIn: '1h' });
}

beforeEach(() => {
  findById.mockReset();
});

describe('isAdminEmail', () => {
  test('recognizes the hardcoded default admin', () => {
    expect(isAdminEmail('adrianenc11@gmail.com')).toBe(true);
    expect(isAdminEmail('ADRIANENC11@Gmail.com')).toBe(true);
  });
  test('returns false for non-admin email or null', () => {
    expect(isAdminEmail('someone@else.com')).toBe(false);
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
  test('respects ADMIN_EMAILS override', () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'a@b.com, c@d.com';
    try {
      expect(isAdminEmail('a@b.com')).toBe(true);
      expect(isAdminEmail('c@d.com')).toBe(true);
      expect(isAdminEmail('e@f.com')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  });
});

describe('peekSignedInUser', () => {
  test('returns null for request without a token', () => {
    expect(peekSignedInUser(makeReq())).toBeNull();
  });

  test('returns null when JWT signature is bad', () => {
    expect(peekSignedInUser(makeReq({ token: 'garbage.not.jwt' }))).toBeNull();
  });

  test('returns full identity with numeric id for a signed JWT', () => {
    const token = signJwt({
      sub: '42',
      name: 'Adrian',
      email: 'adrianenc11@gmail.com',
      role: 'admin',
    });
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fake';
    try {
      const id = peekSignedInUser(makeReq({ token }));
      expect(id).toEqual({
        id: 42,
        name: 'Adrian',
        email: 'adrianenc11@gmail.com',
        role: 'admin',
        sub: '42',
      });
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  test('F2: stale UUID sub still returns identity, with id=null', () => {
    // Regression for the 2026-04-20 admin 429 loop: before the fix a JWT
    // whose sub was a UUID (from the pre-Postgres schema) was silently
    // dropped, which made the voice endpoints treat Adrian as a guest.
    const token = signJwt({
      sub: 'c81f2e20-97b3-4a2d-9f44-4b5d88b3e8a0',
      name: 'Adrian',
      email: 'adrianenc11@gmail.com',
      role: 'admin',
    });
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fake';
    try {
      const id = peekSignedInUser(makeReq({ token }));
      expect(id).not.toBeNull();
      expect(id.id).toBeNull();
      expect(id.email).toBe('adrianenc11@gmail.com');
      expect(id.role).toBe('admin');
      expect(id.sub).toBe('c81f2e20-97b3-4a2d-9f44-4b5d88b3e8a0');
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  test('accepts Authorization: Bearer header when cookie is absent', () => {
    const token = signJwt({ sub: '7', email: 'someone@user.com' });
    const id = peekSignedInUser(makeReq({ bearer: token }));
    expect(id).not.toBeNull();
    expect(id.email).toBe('someone@user.com');
  });
});

describe('isAdminUser', () => {
  test('returns false for null / undefined', async () => {
    expect(await isAdminUser(null)).toBe(false);
    expect(await isAdminUser(undefined)).toBe(false);
  });

  test('F1: JWT role=admin is honored without a DB round-trip', async () => {
    // Before the fix this returned false unless the DB row existed AND
    // was marked admin, which meant a freshly rebuilt DB would lock the
    // admin out for 7 days (JWT lifetime).
    expect(await isAdminUser({
      id: 42,
      email: 'someone@else.com',
      role: 'admin',
    })).toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  test('F1: JWT email in allowlist beats a non-admin DB row', async () => {
    // Admin identity is email-based; JWT role may be missing if the
    // token was minted before role was added to the JWT claims. We want
    // the email fast-path BEFORE the DB lookup so a stale DB row that
    // has role='user' doesn't demote the admin.
    expect(await isAdminUser({
      id: null,
      email: 'adrianenc11@gmail.com',
      role: null,
    })).toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  test('DB role=admin is honored when JWT has neither role nor admin email', async () => {
    findById.mockResolvedValueOnce({
      id: 99,
      email: 'later-promoted@example.com',
      role: 'admin',
    });
    expect(await isAdminUser({
      id: 99,
      email: 'later-promoted@example.com',
      role: 'user',
    })).toBe(true);
  });

  test('DB email allowlist is honored when DB role is plain user', async () => {
    findById.mockResolvedValueOnce({
      id: 5,
      email: 'adrianenc11@gmail.com',
      role: 'user', // DB never promoted, but email is in allowlist
    });
    // JWT has no role/email claims — simulating a very stale token.
    expect(await isAdminUser({ id: 5, email: null, role: null })).toBe(true);
  });

  test('plain user stays plain user when nothing identifies them as admin', async () => {
    findById.mockResolvedValueOnce({
      id: 7,
      email: 'regular@user.com',
      role: 'user',
    });
    expect(await isAdminUser({
      id: 7,
      email: 'regular@user.com',
      role: 'user',
    })).toBe(false);
  });

  test('DB lookup failure does not block admin identified by email alone', async () => {
    findById.mockRejectedValueOnce(new Error('db down'));
    expect(await isAdminUser({
      id: 42,
      email: 'adrianenc11@gmail.com',
      role: null,
    })).toBe(true);
  });
});

describe('resolveIdentity', () => {
  test('returns { user: null, isAdmin: false } for a guest', async () => {
    const out = await resolveIdentity(makeReq());
    expect(out).toEqual({ user: null, isAdmin: false });
  });

  test('returns admin=true for a stale-sub admin JWT (the 2026-04-20 regression)', async () => {
    const token = signJwt({
      sub: 'c81f2e20-97b3-4a2d-9f44-4b5d88b3e8a0',
      email: 'adrianenc11@gmail.com',
      role: 'admin',
    });
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fake';
    try {
      const out = await resolveIdentity(makeReq({ token }));
      expect(out.user).not.toBeNull();
      expect(out.user.id).toBeNull();
      expect(out.isAdmin).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
