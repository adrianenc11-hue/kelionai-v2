#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: trial-timer
 *
 * The unauthenticated trial endpoint must enforce:
 *   - a 15-minute session cap on the token itself (expiresAt <= now + 15min + some skew);
 *   - a per-IP rate limit of 1 trial per 24h (second request from same IP within
 *     the window must return 429).
 *
 * This script verifies both properties without waiting 15 minutes.
 * The actual 15-minute hard-stop on the voice session is enforced on the
 * realtime server side via the token's expiresAt; if that value is wrong,
 * the feature is broken regardless of client UI.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: trial-timer\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

async function getTrial() {
  const r = await fetch(BASE + '/api/realtime/trial-token?avatar=kelion');
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const first = await getTrial();

  if (first.status === 429) {
    // IP already consumed trial in the current 24h window. We can still check
    // that the 429 response is well-formed, but we cannot verify the
    // expiresAt bound. Report honestly.
    process.stdout.write('First request returned 429 (IP already used trial in 24h window).\n');
    return fail(
      'cannot verify expiresAt bound because this IP already consumed its daily trial; rerun from a fresh IP',
      'status=429'
    );
  }

  if (first.status !== 200 || !first.body?.token || !first.body?.expiresAt) {
    return fail('first trial request did not return 200 with token+expiresAt', 'status=' + first.status + ' body=' + JSON.stringify(first.body));
  }

  const delta = first.body.expiresAt - now;
  const min = 14 * 60; // allow a little slack below 15 min
  const max = 16 * 60; // and a little above
  if (delta < min || delta > max) {
    return fail(
      'expiresAt is not ~15 minutes from now',
      'delta=' + delta + 's (expected between ' + min + ' and ' + max + ')'
    );
  }
  process.stdout.write('[ok] trial token lifetime: ' + delta + 's (~' + Math.round(delta / 60) + ' min)\n');

  // Second request within 24h from same IP must be 429.
  const second = await getTrial();
  if (second.status !== 429) {
    return fail(
      'second trial request from same IP did not return 429',
      'status=' + second.status + ' body=' + JSON.stringify(second.body)
    );
  }
  process.stdout.write('[ok] second request from same IP correctly returned 429\n');

  process.stdout.write('\nACCEPTANCE OK: trial-timer (15-min cap on token, 1/day/IP enforced)\n');
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: trial-timer (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
