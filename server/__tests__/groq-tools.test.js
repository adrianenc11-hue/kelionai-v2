'use strict';

/**
 * Tests for the Groq-powered coding tools.
 *
 * We intentionally do NOT hit the real Groq API in CI. Instead:
 *   - When GROQ_API_KEY is missing, the helper must return
 *     { ok:false, unavailable:true } and the dispatcher must surface that
 *     verbatim (no crash, no network call).
 *   - When a key is present we stub global.fetch to validate the request
 *     shape and make sure the JSON return path compiles.
 */

const {
  executeRealTool,
  toolSolveProblem,
  toolCodeReview,
  toolExplainCode,
  REAL_TOOL_NAMES,
} = require('../src/services/realTools');

describe('Groq tool catalog integration', () => {
  test('REAL_TOOL_NAMES includes the 3 Groq tools', () => {
    expect(REAL_TOOL_NAMES).toEqual(expect.arrayContaining([
      'solve_problem', 'code_review', 'explain_code',
    ]));
  });

  test('executeRealTool dispatches each Groq tool', async () => {
    const prev = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      for (const name of ['solve_problem', 'code_review', 'explain_code']) {
        const r = await executeRealTool(name, {
          description: 'x', code: 'console.log(1)',
        });
        expect(r).not.toBeNull();
        expect(r.ok).toBe(false);
        expect(r.unavailable).toBe(true);
      }
    } finally {
      if (prev !== undefined) process.env.GROQ_API_KEY = prev;
    }
  });
});

describe('Groq tools — unavailable path (GROQ_API_KEY missing)', () => {
  beforeEach(() => { delete process.env.GROQ_API_KEY; });

  test('solve_problem returns unavailable=true when key missing', async () => {
    const r = await toolSolveProblem({ description: 'Sort an array.' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/GROQ_API_KEY/);
  });

  test('code_review returns unavailable=true when key missing', async () => {
    const r = await toolCodeReview({ code: 'for(;;){}' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  test('explain_code returns unavailable=true when key missing', async () => {
    const r = await toolExplainCode({ code: 'a=1' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  test('missing required args short-circuit before the key check', async () => {
    // Important: even if the server *is* configured later, calling with
    // empty args should return a deterministic argument error — not
    // quietly bill a Groq request.
    process.env.GROQ_API_KEY = 'gsk_test_never_used';
    try {
      const a = await toolSolveProblem({});
      const b = await toolCodeReview({});
      const c = await toolExplainCode({});
      expect(a.ok).toBe(false);
      expect(a.error).toMatch(/problem description/);
      expect(b.ok).toBe(false);
      expect(b.error).toMatch(/code/);
      expect(c.ok).toBe(false);
      expect(c.error).toMatch(/code/);
    } finally {
      delete process.env.GROQ_API_KEY;
    }
  });
});

describe('Groq tools — happy path (fetch stubbed)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GROQ_API_KEY;
  });

  test('solve_problem hits Groq chat completions with the expected shape', async () => {
    process.env.GROQ_API_KEY = 'gsk_test_stub_1234567890';
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'PLAN\n1. sort\nCODE\n```py\nsorted(x)\n```' } }],
          usage: { total_tokens: 42 },
        }),
      };
    };
    const r = await toolSolveProblem({ description: 'Sort numbers.', language: 'python' });
    expect(r.ok).toBe(true);
    expect(r.result).toMatch(/sorted/);
    expect(captured.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(captured.init.method).toBe('POST');
    const body = JSON.parse(captured.init.body);
    expect(body.model).toMatch(/qwen/i);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toMatch(/python/);
  });

  test('Groq HTTP failure surfaces as ok:false with status code', async () => {
    process.env.GROQ_API_KEY = 'gsk_test_stub_1234567890';
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'Rate limit',
      json: async () => ({}),
    });
    const r = await toolCodeReview({ code: 'x=1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/429/);
  });
});
