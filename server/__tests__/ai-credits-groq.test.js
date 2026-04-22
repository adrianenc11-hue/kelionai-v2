'use strict';

/**
 * Tests for the Groq entry in the admin AI-credits grid.
 *
 * We don't want to hit the live Groq API in CI, so:
 *   - When GROQ_API_KEY is missing, the card must be `configured:false`,
 *     status:'error', and carry a helpful message — no network call.
 *   - getAllCredits() must surface Groq between OpenAI and ElevenLabs so
 *     the admin dashboard renders it with the other AI providers.
 */

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini';

const { probeGroq, getAllCredits } = require('../src/services/aiCredits');

describe('probeGroq — unavailable path (GROQ_API_KEY missing)', () => {
  const prevKey = process.env.GROQ_API_KEY;
  beforeEach(() => { delete process.env.GROQ_API_KEY; });
  afterAll(() => { if (prevKey !== undefined) process.env.GROQ_API_KEY = prevKey; });

  test('returns a well-formed error card with the reload link intact', async () => {
    const card = await probeGroq();
    expect(card.id).toBe('groq');
    expect(card.name).toBe('Groq');
    expect(card.configured).toBe(false);
    expect(card.status).toBe('error');
    expect(card.message).toMatch(/GROQ_API_KEY/);
    // Admin UI turns the whole card into an <a href=topUpUrl> — this
    // has to point at the Groq key console so admins can self-serve a
    // new key when the probe flips to error.
    expect(card.topUpUrl).toBe('https://console.groq.com/keys');
    expect(card.billingUrl).toMatch(/^https:\/\/console\.groq\.com/);
    expect(card.subtitle).toMatch(/coding/i);
  });
});

describe('getAllCredits — Groq slot', () => {
  const prevKey = process.env.GROQ_API_KEY;
  beforeEach(() => { delete process.env.GROQ_API_KEY; });
  afterAll(() => { if (prevKey !== undefined) process.env.GROQ_API_KEY = prevKey; });

  test('Groq card appears in the returned grid', async () => {
    const cards = await getAllCredits();
    const ids = cards.map((c) => c.id);
    expect(ids).toContain('groq');
  });

  test('Groq card sits alongside the other AI-provider cards', async () => {
    const cards = await getAllCredits();
    const idx = Object.fromEntries(cards.map((c, i) => [c.id, i]));
    // OpenAI → Groq → ElevenLabs (AI brains before revenue/infra).
    expect(idx.openai).toBeLessThan(idx.groq);
    expect(idx.groq).toBeLessThan(idx.elevenlabs);
  });
});
