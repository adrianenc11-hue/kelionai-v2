#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: language-switch
 *
 * Within a single session, when the user switches the language of the
 * last message, the AI's next reply must switch to that language.
 * Sequence: RO -> FR -> DE, all in one session with shared history.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

async function registerAndToken() {
  const email = `accept_switch_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
  const r = await fetch(BASE + '/auth/local/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'AcceptTest1234!', name: 'Acceptance Switch' }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 201 || !body?.token) throw new Error('register failed: status=' + r.status);
  return body.token;
}

async function chat(token, history) {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      messages: history,
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
  process.stderr.write('ACCEPTANCE FAIL: language-switch\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

const steps = [
  { prompt: 'Salut, cum te numesti? Raspunde in romana, o propozitie.',    check: /[\u0103\u00E2\u00EE\u0219\u021B]|\b(sunt|ma|numesc|eu|meu|este|si)\b/i, lang: 'Romanian' },
  { prompt: 'Maintenant, reponds en francais: quel est ton nom?',          check: /\b(je|suis|m'appelle|mon|nom|appelle)\b/i,                             lang: 'French'   },
  { prompt: 'Jetzt bitte auf Deutsch: wie heisst du?',                     check: /\b(ich|bin|hei[ss]?e|mein|name)\b/i,                                    lang: 'German'   },
];

(async () => {
  const token = await registerAndToken();
  const history = [];
  const results = [];
  for (const step of steps) {
    history.push({ role: 'user', content: step.prompt });
    const reply = await chat(token, history);
    history.push({ role: 'assistant', content: reply });
    const ok = step.check.test(reply);
    results.push({ lang: step.lang, ok, reply: reply.slice(0, 200) });
    process.stdout.write(`[${ok ? 'ok' : 'FAIL'}] switch -> ${step.lang}: "${reply.slice(0, 120).replace(/\n/g, ' ')}"\n`);
  }
  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    return fail(
      `${failed.length}/${results.length} language switches were not honored`,
      failed.map(f => `${f.lang}: ${f.reply}`).join(' | ')
    );
  }
  process.stdout.write('\nACCEPTANCE OK: language-switch (' + results.length + '/' + results.length + ' switches honored)\n');
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: language-switch (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
