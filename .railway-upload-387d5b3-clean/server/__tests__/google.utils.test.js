'use strict';

/**
 * Tests for Google OAuth utility helpers.
 * These functions are pure / deterministic and don't require a running server.
 */

// Set required env vars before loading config
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';

const { generateState, generatePKCE, buildAuthUrl } = require('../src/utils/google');

describe('generateState()', () => {
  it('returns a 64-character hex string', () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different value each call', () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe('generatePKCE()', () => {
  it('returns codeVerifier and codeChallenge', () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(typeof codeVerifier).toBe('string');
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(typeof codeChallenge).toBe('string');
    expect(codeChallenge.length).toBeGreaterThan(0);
  });

  it('codeVerifier and codeChallenge differ', () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeVerifier).not.toBe(codeChallenge);
  });

  it('returns different pairs each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

describe('buildAuthUrl()', () => {
  it('returns a URL pointing to Google', () => {
    const { codeChallenge } = generatePKCE();
    const url = buildAuthUrl({ state: 'abc123', codeChallenge, mode: 'web' });
    expect(url).toContain('accounts.google.com');
  });

  it('includes required OAuth parameters', () => {
    const { codeChallenge } = generatePKCE();
    const url = buildAuthUrl({ state: 'my-state', codeChallenge, mode: 'web' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('my-state');
    expect(parsed.searchParams.get('code_challenge')).toBe(codeChallenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
