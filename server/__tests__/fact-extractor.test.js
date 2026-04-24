'use strict';

// Unit tests for factExtractor.js — the small subset that doesn't need
// Gemini. We mostly exercise `looksThirdParty()` (the offline guardrail
// that drops facts about someone OTHER than the signed-in user) and
// the "no API key → empty array" short-circuit of extractFacts.
//
// Rationale: the whole bug class "kelion confuses memories between
// users / between people" was caused by the extractor keeping items
// like "my wife is a teacher" attributed to the user. This test locks
// in the rejection rule so the next refactor doesn't regress it.

const { extractFacts, _internal } = require('../src/services/factExtractor');
const { looksThirdParty, buildExtractionSystem } = _internal;

describe('factExtractor.looksThirdParty', () => {
  test('rejects "my wife/husband/partner" relational facts', () => {
    expect(looksThirdParty('my wife is a doctor', 'Adrian')).toBe(true);
    expect(looksThirdParty('my husband loves cats', 'Adrian')).toBe(true);
    expect(looksThirdParty('my partner plays tennis', 'Adrian')).toBe(true);
    expect(looksThirdParty('my son is 5 years old', 'Adrian')).toBe(true);
    expect(looksThirdParty('my daughter works at google', 'Adrian')).toBe(true);
  });

  test('rejects plain third-person statements', () => {
    expect(looksThirdParty('he is a dentist', 'Adrian')).toBe(true);
    expect(looksThirdParty('she works at a hospital', 'Adrian')).toBe(true);
    expect(looksThirdParty('they have two children', 'Adrian')).toBe(true);
  });

  test('rejects facts starting with a name that is NOT the user', () => {
    expect(looksThirdParty('John is a developer', 'Adrian')).toBe(true);
    expect(looksThirdParty('maria loves opera', 'Adrian')).toBe(true);
  });

  test('accepts genuine user facts', () => {
    expect(looksThirdParty('the user is learning Spanish', 'Adrian')).toBe(false);
    expect(looksThirdParty('you have two cats', '')).toBe(false);
    expect(looksThirdParty('Adrian is learning Spanish', 'Adrian')).toBe(false);
  });

  test('accepts first-name facts when userName is multi-word (full name)', () => {
    // Regression: looksThirdParty used to compare the fact's first
    // word against the ENTIRE userName, so "Adrian is learning
    // Spanish" was dropped when userName was "Adrian Enciulescu".
    expect(looksThirdParty('Adrian is learning Spanish', 'Adrian Enciulescu')).toBe(false);
    expect(looksThirdParty('Enciulescu works at a bank', 'Adrian Enciulescu')).toBe(false);
    expect(looksThirdParty('Maria loves opera', 'Adrian Enciulescu')).toBe(true);
  });

  test('rejects empty / null input', () => {
    expect(looksThirdParty('', 'Adrian')).toBe(true);
    expect(looksThirdParty(null, 'Adrian')).toBe(true);
  });
});

describe('factExtractor.buildExtractionSystem', () => {
  test('embeds the user name when provided', () => {
    const s = buildExtractionSystem('Adrian');
    expect(s).toMatch(/Adrian/);
    expect(s).toMatch(/Every "I", "me", "my"/);
  });

  test('handles anonymous users gracefully', () => {
    const s = buildExtractionSystem('');
    expect(s).toMatch(/anonymous/);
  });
});

describe('factExtractor.extractFacts', () => {
  // Force the config.gemini.apiKey getter to be falsy so the extractor
  // short-circuits to []. This path is the only one we can exercise
  // without talking to Gemini.
  const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
    jest.resetModules();
  });

  test('returns [] when gemini key is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    // Re-require after unsetting so config freshly reads the env.
    jest.resetModules();
    const { extractFacts: fresh } = require('../src/services/factExtractor');
    const facts = await fresh(
      [{ role: 'user', text: 'I love tennis' }],
      { userName: 'Adrian' },
    );
    expect(facts).toEqual([]);
  });

  test('returns [] for empty transcripts', async () => {
    const facts = await extractFacts([], { userName: 'Adrian' });
    expect(facts).toEqual([]);
  });
});
