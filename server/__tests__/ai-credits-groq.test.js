'use strict';

/**
 * Tests for the Groq entry in the admin AI-credits grid.
 *
 * Groq coding tools were removed (single-LLM cleanup). The probeGroq
 * function now returns a static "removed" card for backwards compat.
 */

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini';

const { probeGroq, getAllCredits } = require('../src/services/aiCredits');

describe('probeGroq — returns removed stub', () => {
  test('returns a well-formed unconfigured card', async () => {
    const card = await probeGroq();
    expect(card.id).toBe('groq');
    expect(card.name).toBe('Groq');
    expect(card.configured).toBe(false);
    expect(card.status).toBe('unconfigured');
    expect(card.message).toMatch(/removed/i);
  });
});

describe('getAllCredits — Groq slot', () => {
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
