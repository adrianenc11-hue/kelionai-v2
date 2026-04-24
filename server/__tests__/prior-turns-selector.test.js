'use strict';

// Cross-mode handoff selector — unit tests for the pure function that
// decides what `priorTurns` payload gets shipped to the voice hook's
// start() when the user taps / wake-words from idle. The same rule
// runs client-side (src/lib/priorTurnsSelector.js) — see the parity
// test at the bottom of this suite.

const fs = require('fs');
const path = require('path');
const { selectPriorTurns } = require('../src/util/priorTurnsSelector');

describe('selectPriorTurns — cross-mode voice handoff', () => {
  it('returns [] when both inputs are empty', () => {
    expect(selectPriorTurns([], [])).toEqual([]);
  });

  it('returns [] when both inputs are non-arrays', () => {
    expect(selectPriorTurns(null, undefined)).toEqual([]);
    expect(selectPriorTurns('x', 42)).toEqual([]);
  });

  it('prefers chatMessages when non-empty (voice→text→voice case)', () => {
    const chat = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what is the weather?' },
    ];
    const voice = [{ role: 'user', text: 'old voice' }];
    expect(selectPriorTurns(chat, voice)).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
      { role: 'user', text: 'what is the weather?' },
    ]);
  });

  it('falls back to voice turns when chatMessages is empty (pure voice)', () => {
    const voice = [
      { role: 'user', text: 'ping' },
      { role: 'assistant', text: 'pong' },
    ];
    expect(selectPriorTurns([], voice)).toEqual([
      { role: 'user', text: 'ping' },
      { role: 'assistant', text: 'pong' },
    ]);
  });

  it('drops entries with missing role/text/content', () => {
    const chat = [
      { role: 'user', content: '' },
      { role: '', content: 'orphan' },
      { content: 'no role' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'real' },
    ];
    expect(selectPriorTurns(chat, [])).toEqual([
      { role: 'user', text: 'real' },
    ]);
  });

  it('normalises unknown roles to user (defensive)', () => {
    const chat = [
      { role: 'system', content: 'ignore me not' },
      { role: 'assistant', content: 'ok' },
    ];
    expect(selectPriorTurns(chat, [])).toEqual([
      { role: 'user', text: 'ignore me not' },
      { role: 'assistant', text: 'ok' },
    ]);
  });

  it('caps output to `max` entries (server persona budget)', () => {
    const chat = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const out = selectPriorTurns(chat, [], 10);
    expect(out).toHaveLength(10);
    // Should keep the most recent (tail).
    expect(out[0].text).toBe('msg-20');
    expect(out[9].text).toBe('msg-29');
  });

  it('defaults cap to 20 when max omitted', () => {
    const chat = Array.from({ length: 50 }, (_, i) => ({
      role: 'user',
      content: `m${i}`,
    }));
    expect(selectPriorTurns(chat, [])).toHaveLength(20);
  });

  it('caps voice fallback too', () => {
    const voice = Array.from({ length: 30 }, (_, i) => ({
      role: 'user',
      text: `v${i}`,
    }));
    expect(selectPriorTurns([], voice, 5)).toHaveLength(5);
  });
});

// The ESM copy under src/lib is what Vite bundles for the browser.
// We cannot `require()` it here (no ESM transform), so compare source
// text against the CJS twin to catch drift. The parity check is
// skipped with a clear message when the frontend file is not present
// so standalone server-side CI keeps working.
describe('selectPriorTurns — frontend/backend parity', () => {
  const frontendPath = path.join(
    __dirname,
    '..', '..', 'src', 'lib', 'priorTurnsSelector.js'
  );
  let frontendSource = '';
  try { frontendSource = fs.readFileSync(frontendPath, 'utf8'); } catch (_) {}

  const hasFrontend = Boolean(frontendSource);
  const test = hasFrontend ? it : it.skip;

  test('frontend copy exports a function with the same rules', () => {
    expect(frontendSource).toContain('export function selectPriorTurns');
    expect(frontendSource).toContain('chatMessages');
    expect(frontendSource).toContain('voiceTurns');
    // Both copies share the same normalisation pattern so they stay
    // in lockstep — tighten the check here if either copy is reworked.
    expect(frontendSource).toContain("m.role === 'assistant' ? 'assistant' : 'user'");
    expect(frontendSource).toContain("t.role === 'assistant' ? 'assistant' : 'user'");
  });
});
