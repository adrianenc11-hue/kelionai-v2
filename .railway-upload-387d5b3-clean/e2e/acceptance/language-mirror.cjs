#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: language-mirror
 *
 * The AI must reply in the same language as the user's last message.
 * Tests three independent languages in three independent sessions.
 * Exits 0 only if ALL three replies look like the right language.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

async function registerAndToken() {
  const email = `accept_lang_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
  const r = await fetch(BASE + '/auth/local/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'AcceptTest1234!', name: 'Acceptance Lang' }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 201 || !body?.token) throw new Error('register failed: status=' + r.status);
  return body.token;
}

async function chat(token, message) {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      avatar: 'kelion',
      datetime: new Date().toISOString(),
      timezone: 'Europe/Bucharest',
    }),
  });
  if (!r.ok) throw new Error('/api/chat status=' + r.status);
  const raw = await r.text();
  let text = '';
  for (const line of raw.split('\n')) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m) continue;
    const payload = m[1].trim();
    if (!payload || payload === '[DONE]') continue;
    try { const obj = JSON.parse(payload); if (obj.content) text += obj.content; } catch (_) {}
  }
  return text;
}

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: language-mirror\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

const cases = [
  {
    lang: 'Romanian',
    prompt: 'Salut! Spune-mi numele tau intr-o propozitie scurta.',
    positive: /[\u0103\u00E2\u00EE\u0219\u021B]|\b(sunt|ma|numesc|eu|meu|este|si|numele)\b/i,
    negativeMin: 0,
  },
  {
    lang: 'French',
    prompt: 'Bonjour, dis-moi ton nom en une phrase.',
    positive: /\b(je|suis|m'appelle|bonjour|mon|nom|appelle)\b/i,
    negativeMin: 0,
  },
  {
    lang: 'German',
    prompt: 'Hallo, wie heisst du? Antworte in einem Satz auf Deutsch.',
    positive: /\b(ich|bin|hei[ss]?e|mein|name)\b/i,
    negativeMin: 0,
  },
];

(async () => {
  const token = await registerAndToken();
  const results = [];
  for (const c of cases) {
    const reply = await chat(token, c.prompt);
    const ok = c.positive.test(reply);
    results.push({ lang: c.lang, ok, reply: reply.slice(0, 200) });
    process.stdout.write(`[${ok ? 'ok' : 'FAIL'}] ${c.lang}: "${reply.slice(0, 120).replace(/\n/g, ' ')}"\n`);
  }
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    return fail(
      `${failed.length}/${results.length} language reply did not match expected language`,
      failed.map(f => `${f.lang}: ${f.reply}`).join(' | ')
    );
  }
  process.stdout.write('\nACCEPTANCE OK: language-mirror (' + results.length + '/' + results.length + ' languages mirrored)\n');
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: language-mirror (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
