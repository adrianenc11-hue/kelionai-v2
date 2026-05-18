#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: chat-roundtrip
 *
 * Public production chat is healthy only when kelionai.app can complete a
 * real /api/chat request and return a non-empty assistant reply. This catches
 * the exact failure Adrian saw: UI loads, Railway deploy is green, but chat
 * returns "Chat failed" / 5xx.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: chat-roundtrip\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

function cookieValue(setCookieHeaders, name) {
  for (const raw of setCookieHeaders) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0 && first.slice(0, eq) === name) return first.slice(eq + 1);
  }
  return '';
}

function getSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

(async () => {
  const page = await fetch(BASE + '/', { redirect: 'manual' });
  if (page.status < 200 || page.status >= 400) {
    return fail('site root did not return 2xx/3xx', 'status=' + page.status);
  }

  const setCookies = getSetCookie(page.headers);
  const csrf = cookieValue(setCookies, 'kelion.csrf');
  if (!csrf) {
    return fail('root page did not set kelion.csrf cookie', 'set-cookie=' + JSON.stringify(setCookies));
  }
  const cookieHeader = setCookies
    .map(c => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');

  const payload = {
    message: 'Raspunde strict cu: KELION_CHAT_OK',
    sessionId: 'acceptance-chat-' + Date.now(),
    clientTimezone: 'Europe/London',
    clientLocalTime: new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }),
  };

  const chat = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(payload),
  });
  const text = await chat.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}

  if (chat.status !== 200) {
    return fail('/api/chat did not return 200', 'status=' + chat.status + ' body=' + text.slice(0, 800));
  }
  const reply = body?.reply;
  if (typeof reply !== 'string' || !reply.trim()) {
    return fail('/api/chat returned empty reply', JSON.stringify(body));
  }

  process.stdout.write('ACCEPTANCE PASS: chat-roundtrip\n');
  process.stdout.write('  base:  ' + BASE + '\n');
  process.stdout.write('  model: ' + (body.model || '<unknown>') + '\n');
  process.stdout.write('  reply: ' + reply.slice(0, 120).replace(/\s+/g, ' ') + '\n');
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: chat-roundtrip (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
