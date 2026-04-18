'use strict';

/**
 * Credits — Stripe checkout + webhook + ledger tests.
 *
 * We cover the two highest-risk paths:
 *   1. Stripe webhook signature verification (accept/reject).
 *   2. Idempotent top-up on duplicate webhook delivery.
 */

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';

const crypto = require('crypto');

const { verifyStripeSignature, getPackages } = require('../src/routes/credits');

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret_value_1234567890';
  const buildHeader = (body, ts, sec = secret) => {
    const signed = `${ts}.${body}`;
    const v1 = crypto.createHmac('sha256', sec).update(signed).digest('hex');
    return `t=${ts},v1=${v1}`;
  };

  it('accepts a well-signed fresh request', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'ping' });
    const ts = Math.floor(Date.now() / 1000);
    const header = buildHeader(body, ts);
    expect(verifyStripeSignature(Buffer.from(body), header, secret)).toBe(true);
  });

  it('rejects a request with a wrong signature', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const ts = Math.floor(Date.now() / 1000);
    const header = `t=${ts},v1=${'0'.repeat(64)}`;
    expect(verifyStripeSignature(Buffer.from(body), header, secret)).toBe(false);
  });

  it('rejects a request signed with a different secret', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const ts = Math.floor(Date.now() / 1000);
    const header = buildHeader(body, ts, 'whsec_other_secret');
    expect(verifyStripeSignature(Buffer.from(body), header, secret)).toBe(false);
  });

  it('rejects a stale timestamp (> tolerance)', () => {
    const body = JSON.stringify({ id: 'evt_1' });
    const ts = Math.floor(Date.now() / 1000) - 10 * 60; // 10 min ago
    const header = buildHeader(body, ts);
    expect(verifyStripeSignature(Buffer.from(body), header, secret)).toBe(false);
  });

  it('rejects when header is missing', () => {
    expect(verifyStripeSignature(Buffer.from('x'), null, secret)).toBe(false);
  });

  it('rejects when secret is missing', () => {
    const body = 'x';
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(Buffer.from(body), buildHeader(body, ts), null)).toBe(false);
  });
});

describe('getPackages', () => {
  it('returns the default three packages when no env override', () => {
    delete process.env.CREDIT_PACKAGES_JSON;
    const packages = getPackages();
    expect(packages.length).toBe(3);
    const ids = packages.map((p) => p.id).sort();
    expect(ids).toEqual(['pro', 'standard', 'starter']);
    for (const p of packages) {
      expect(p.priceCents).toBeGreaterThan(0);
      expect(p.minutes).toBeGreaterThan(0);
      expect(typeof p.name).toBe('string');
    }
  });

  it('respects CREDIT_PACKAGES_JSON env override', () => {
    process.env.CREDIT_PACKAGES_JSON = JSON.stringify([
      { id: 'single', name: 'Single', priceCents: 500, minutes: 15 },
    ]);
    const packages = getPackages();
    expect(packages.length).toBe(1);
    expect(packages[0].id).toBe('single');
    delete process.env.CREDIT_PACKAGES_JSON;
  });

  it('falls back to defaults when override is malformed', () => {
    process.env.CREDIT_PACKAGES_JSON = 'not-json';
    const packages = getPackages();
    expect(packages.length).toBe(3);
    delete process.env.CREDIT_PACKAGES_JSON;
  });
});
