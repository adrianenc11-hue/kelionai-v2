'use strict';

// Audit M9 — memory subject tagging round-trip.
//
// Covers:
//   1. factExtractor normalises `subject` / `subject_name` / `confidence`
//      from the raw Gemini JSON (defaulting to 'self' when absent,
//      dropping "other" rows without a usable name, clamping confidence).
//   2. formatMemoryBlocks partitions a mixed list into a "signed-in user"
//      section and an "other people" section grouped by name, and produces
//      an empty string when the list is empty (zero regression risk for
//      guests / brand-new users with no memory).
//
// Both are pure functions that don't hit the network or the DB, so the
// suite is fast and deterministic. We do NOT call the real Gemini API;
// instead we fake the fetch so we can feed raw JSON strings through the
// same parse path the production code takes.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/kelion-memory-subject-test.db';
process.env.GEMINI_API_KEY = 'test-dummy-key';

const { formatMemoryBlocks } = require('../src/routes/realtime');
const { extractFacts }       = require('../src/services/factExtractor');

describe('formatMemoryBlocks (Audit M9)', () => {
  it('returns "" for empty / non-array input', () => {
    expect(formatMemoryBlocks([])).toBe('');
    expect(formatMemoryBlocks(null)).toBe('');
    expect(formatMemoryBlocks(undefined)).toBe('');
  });

  it('renders a self-only list under the signed-in user heading', () => {
    const out = formatMemoryBlocks([
      { kind: 'identity', fact: 'lives in Cluj',           subject: 'self' },
      { kind: 'skill',    fact: 'speaks fluent Romanian',  subject: 'self' },
    ]);
    expect(out).toMatch(/Known facts about the signed-in user/);
    expect(out).toMatch(/\[identity\] lives in Cluj/);
    expect(out).toMatch(/\[skill\] speaks fluent Romanian/);
    // No "other" section when there's nothing to put in it.
    expect(out).not.toMatch(/Other people the user has mentioned/);
  });

  it('partitions self vs other facts and groups other by subject_name', () => {
    const out = formatMemoryBlocks([
      { kind: 'identity',     fact: 'works as a software engineer', subject: 'self' },
      { kind: 'relationship', fact: 'has a sister named Ioana',     subject: 'self' },
      { kind: 'identity',     fact: 'works as a dancer',            subject: 'other', subject_name: 'Ioana' },
      { kind: 'preference',   fact: 'vegan',                        subject: 'other', subject_name: 'Ioana' },
      { kind: 'identity',     fact: 'works at AE Studio',           subject: 'other', subject_name: 'Radu' },
    ]);
    // Self section lists user facts, NOT Ioana's.
    const selfBlock = out.split('Other people')[0];
    expect(selfBlock).toMatch(/software engineer/);
    expect(selfBlock).not.toMatch(/dancer/);
    // Other section groups per name.
    expect(out).toMatch(/Other people the user has mentioned/);
    expect(out).toMatch(/NOT about the user/);
    expect(out).toMatch(/• Ioana:/);
    expect(out).toMatch(/\[identity\] works as a dancer/);
    expect(out).toMatch(/\[preference\] vegan/);
    expect(out).toMatch(/• Radu:/);
    expect(out).toMatch(/\[identity\] works at AE Studio/);
  });

  it('treats subject="other" WITHOUT subject_name as self (defensive)', () => {
    // Malformed extraction shouldn't land nameless facts in an orphan
    // "other" bucket — better to show them under self than to lose them.
    const out = formatMemoryBlocks([
      { kind: 'context', fact: 'went to a concert last week', subject: 'other' },
    ]);
    expect(out).toMatch(/Known facts about the signed-in user/);
    expect(out).toMatch(/\[context\] went to a concert last week/);
    expect(out).not.toMatch(/Other people the user has mentioned/);
  });

  it('skips rows with no fact text', () => {
    const out = formatMemoryBlocks([
      { kind: 'identity', fact: 'lives in Cluj', subject: 'self' },
      { kind: 'identity', fact: '',              subject: 'self' },
      { kind: 'identity',                         subject: 'self' },
      null,
    ]);
    expect(out).toMatch(/lives in Cluj/);
    // Only the one good fact renders.
    expect(out.match(/\[identity\]/g) || []).toHaveLength(1);
  });
});

describe('extractFacts normalisation (Audit M9)', () => {
  // We exercise the production parsing path by faking global.fetch so the
  // module's Gemini call returns whatever JSON string we want.
  const withMockGemini = (rawText) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: rawText }] } }],
      }),
    });
    // eslint-disable-next-line no-global-assign
    global.fetch = fetchMock;
    return fetchMock;
  };

  afterEach(() => {
    // Let other suites re-install their own fetch mocks.
    delete global.fetch;
  });

  it('defaults subject to "self" when the model omits the field', () => {
    withMockGemini(JSON.stringify([
      { kind: 'identity', fact: 'lives in Cluj' },
    ]));
    return extractFacts([{ role: 'user', text: 'I live in Cluj.' }]).then((out) => {
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        subject:       'self',
        subject_name:  null,
        confidence:    1.0,
      });
    });
  });

  it('accepts subject="other" with a subject_name', () => {
    withMockGemini(JSON.stringify([
      { kind: 'identity', fact: 'works as a dancer', subject: 'other', subject_name: 'Ioana', confidence: 0.85 },
      { kind: 'identity', fact: 'works as a vet',    subject: 'self',  confidence: 0.95 },
    ]));
    return extractFacts([{ role: 'user', text: 'I am a vet. My sister Ioana dances.' }]).then((out) => {
      expect(out).toHaveLength(2);
      const byFact = Object.fromEntries(out.map((o) => [o.fact, o]));
      expect(byFact['works as a dancer']).toMatchObject({
        subject: 'other', subject_name: 'Ioana', confidence: 0.85,
      });
      expect(byFact['works as a vet']).toMatchObject({
        subject: 'self', subject_name: null, confidence: 0.95,
      });
    });
  });

  it('drops "other" rows without a usable subject_name', () => {
    // The extractor's #1 job is "don't corrupt the self profile".
    // A nameless "other" fact is useless (we can't group it by person)
    // and dangerous if mis-coerced back to self, so we drop it.
    withMockGemini(JSON.stringify([
      { kind: 'identity', fact: 'nameless dancer', subject: 'other' },
      { kind: 'identity', fact: 'nameless dancer', subject: 'other', subject_name: '   ' },
      { kind: 'identity', fact: 'lives in Cluj',   subject: 'self' },
    ]));
    return extractFacts([{ role: 'user', text: 'placeholder' }]).then((out) => {
      expect(out).toHaveLength(1);
      expect(out[0].fact).toBe('lives in Cluj');
    });
  });

  it('clamps confidence into [0, 1] and treats non-numeric as 1.0', () => {
    withMockGemini(JSON.stringify([
      { kind: 'identity', fact: 'a', subject: 'self', confidence: -0.4 },
      { kind: 'identity', fact: 'b', subject: 'self', confidence: 5    },
      { kind: 'identity', fact: 'c', subject: 'self', confidence: 'x'  },
    ]));
    return extractFacts([{ role: 'user', text: 'p' }]).then((out) => {
      expect(out.map((o) => o.confidence)).toEqual([0, 1, 1]);
    });
  });

  it('coerces unknown subject strings back to "self"', () => {
    // A mis-structured response like { subject: "ioana" } must NOT be
    // stored as an "other" row with subject_name absent — that's the
    // exact corruption the feature is meant to prevent.
    withMockGemini(JSON.stringify([
      { kind: 'identity', fact: 'lives in Cluj', subject: 'IOANA' },
    ]));
    return extractFacts([{ role: 'user', text: 'p' }]).then((out) => {
      expect(out[0].subject).toBe('self');
      expect(out[0].subject_name).toBe(null);
    });
  });
});
