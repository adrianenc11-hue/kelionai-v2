#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: payments
 *
 * A real user must be able to:
 *   1. Register an account.
 *   2. Request a checkout session for a real plan.
 *   3. Receive a URL that leads to the real Stripe checkout domain
 *      (checkout.stripe.com), not a mock URL.
 *   4. After payment, /api/subscription/status must return status=active.
 *
 * Until a real Stripe integration exists, this script will fail at step 3.
 * That is the correct behavior: failing loudly is how we know the feature
 * is not yet delivered.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

async function req(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(BASE + path, {
    method, headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: payments\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

(async () => {
  // Step 1 — register
  const email = `accept_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
  const reg = await req('POST', '/auth/local/register', {
    body: { email, password: 'AcceptTest1234!', name: 'Acceptance Payments' },
  });
  if (reg.status !== 201 || !reg.body?.token) {
    return fail('register did not return 201 with JWT', 'status=' + reg.status);
  }
  const token = reg.body.token;

  // Step 2 — request checkout session for basic plan
  const ck = await req('POST', '/api/payments/create-checkout-session', {
    headers: { Authorization: 'Bearer ' + token },
    body: { planId: 'basic' },
  });
  if (ck.status !== 200) {
    return fail('create-checkout-session did not return 200', 'status=' + ck.status + ' body=' + JSON.stringify(ck.body));
  }

  // Step 3 — URL must be a real Stripe checkout URL, not a mock
  const url = ck.body?.url || '';
  if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    return fail('checkout URL is not a real Stripe URL', 'url=' + url);
  }
  if (/\/mock(\/|$|\?)/.test(url)) {
    return fail('checkout URL contains /mock segment', 'url=' + url);
  }

  // Step 4 — without actually paying (no card automation here), we cannot
  // assert an active subscription. A later version of this script will use
  // Stripe's test mode with a webhook to assert status=active. For now, the
  // fact that we got a real Stripe URL is necessary but not sufficient.
  //
  // Until then, we deliberately fail here to signal the feature is not
  // fully delivered.
  return fail(
    'real Stripe URL issued, but the end-to-end paid flow (webhook -> active subscription) is not yet verified by this script',
    'url=' + url + ' (extend this script with Stripe test-mode card + webhook assertion before declaring payments delivered)'
  );
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: payments (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
