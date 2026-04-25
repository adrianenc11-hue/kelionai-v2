'use strict';

// PR C — unit tests for run_regex, run_code, and the user-intern tools
// (get_my_credits / get_my_usage / get_my_profile). We mock the e2b SDK
// and the db module so the suite runs offline and never needs a real
// sandbox API key or a database.

jest.mock('@e2b/code-interpreter', () => {
  const kill = jest.fn(async () => {});
  const runCode = jest.fn(async (_code, _opts) => ({
    logs: { stdout: ['hello from python\n'], stderr: [] },
    text: '42',
    results: [{ type: 'text', text: '42' }],
    error: null,
  }));
  return {
    __kill: kill,
    __runCode: runCode,
    Sandbox: {
      create: jest.fn(async (_cfg) => ({ runCode, kill })),
    },
  };
}, { virtual: true });

// Mock the shared db module. We expose both the helper-style API
// (getCreditsBalance, getUserById) and the raw `getDb().all()` path
// used by toolGetMyUsage to hit credit_transactions directly.
const fakeRows = [
  { delta_minutes: 30, amount_cents: 1000, currency: 'EUR', kind: 'topup',    note: 'Stripe',  created_at: '2026-04-20T10:00:00Z' },
  { delta_minutes: -2, amount_cents: null, currency: null,  kind: 'consume',  note: 'voice',   created_at: '2026-04-21T09:00:00Z' },
  { delta_minutes: -3, amount_cents: null, currency: null,  kind: 'consume',  note: 'voice',   created_at: '2026-04-21T11:00:00Z' },
];

jest.mock('../src/db', () => ({
  getCreditsBalance: jest.fn(async (_uid) => 12.5),
  getUserById: jest.fn(async (uid) => ({
    id: uid,
    name: 'Adrian',
    email: 'adrian@example.com',
    credits_balance_minutes: 12.5,
    created_at: '2026-01-01T00:00:00Z',
  })),
  getDb: jest.fn(async () => ({
    all: jest.fn(async (_sql, _params) => fakeRows),
  })),
}));

const {
  toolRunRegex,
  toolRunCode,
  toolGetMyCredits,
  toolGetMyUsage,
  toolGetMyProfile,
} = require('../src/services/realTools');

describe('run_regex — PR C', () => {
  test('rejects missing pattern', () => {
    const r = toolRunRegex({ input: 'abc' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/pattern/i);
  });

  test('rejects pattern longer than 500 chars', () => {
    const r = toolRunRegex({ pattern: 'a'.repeat(501), input: 'x' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/too long/i);
  });

  test('rejects input longer than 50k chars', () => {
    const r = toolRunRegex({ pattern: 'a', input: 'x'.repeat(50_001) });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/too long/i);
  });

  test('mode=test returns matched boolean', () => {
    const r = toolRunRegex({ pattern: '^hello', input: 'hello world', mode: 'test' });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(true);
  });

  test('mode=match returns captures with indices', () => {
    const r = toolRunRegex({ pattern: '(\\w+)@(\\w+)', input: 'a@b and c@d', flags: 'g', mode: 'match' });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.matches[0].groups).toEqual(['a', 'b']);
    expect(r.matches[1].match).toBe('c@d');
  });

  test('mode=replace substitutes with backrefs', () => {
    const r = toolRunRegex({ pattern: '(\\w+) (\\w+)', input: 'Adrian E', flags: '', mode: 'replace', replacement: '$2 $1' });
    expect(r.ok).toBe(true);
    expect(r.output).toBe('E Adrian');
  });

  test('reports invalid regex cleanly', () => {
    const r = toolRunRegex({ pattern: '(', input: 'x' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/invalid regex/i);
  });

  test('zero-length match does not loop forever', () => {
    const r = toolRunRegex({ pattern: 'a*', input: 'xyz', flags: 'g', mode: 'match' });
    expect(r.ok).toBe(true);
    // Guard in implementation must bound the match count on zero-width matches.
    expect(r.count).toBeLessThanOrEqual(500);
  });

  test('flag sanitisation strips non-standard characters', () => {
    // "gx!;DROP TABLE" would be a regex-compilation error if passed through.
    const r = toolRunRegex({ pattern: 'a', input: 'aaa', flags: 'gx!;DROP', mode: 'match' });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
  });
});

describe('run_code — PR C', () => {
  beforeEach(() => {
    delete process.env.E2B_API_KEY;
  });

  test('returns unavailable when E2B_API_KEY is missing', async () => {
    const r = await toolRunCode({ language: 'python', code: 'print(1)' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(String(r.error)).toMatch(/not configured/i);
  });

  test('rejects empty code when key is set', async () => {
    process.env.E2B_API_KEY = 'sk-test';
    const r = await toolRunCode({ language: 'python', code: '' });
    expect(r.ok).toBe(false);
  });

  test('rejects code longer than 20k chars', async () => {
    process.env.E2B_API_KEY = 'sk-test';
    const r = await toolRunCode({ language: 'python', code: 'x'.repeat(20_001) });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/too long/i);
  });

  test('rejects unknown language', async () => {
    process.env.E2B_API_KEY = 'sk-test';
    const r = await toolRunCode({ language: 'brainfuck', code: '+' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/unsupported/i);
  });

  test('happy path returns stdout/text and kills the sandbox', async () => {
    process.env.E2B_API_KEY = 'sk-test';
    const r = await toolRunCode({ language: 'python', code: 'print("hello from python")' });
    expect(r.ok).toBe(true);
    expect(r.language).toBe('python');
    expect(r.stdout).toContain('hello from python');
    expect(r.text).toBe('42');
    const mod = require('@e2b/code-interpreter');
    expect(mod.Sandbox.create).toHaveBeenCalled();
    expect(mod.__kill).toHaveBeenCalled();
  });
});

describe('user-intern tools — PR C', () => {
  test('get_my_credits returns sign-in prompt without ctx', async () => {
    const r = await toolGetMyCredits({});
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(String(r.error)).toMatch(/sign in/i);
  });

  test('get_my_credits returns balance fields with ctx', async () => {
    const r = await toolGetMyCredits({}, { user: { id: 7 } });
    expect(r.ok).toBe(true);
    expect(r.minutes).toBe(12.5);
    expect(r.displayMinutes).toBe('12.5 min');
    expect(r.low).toBe(false);
    expect(r.empty).toBe(false);
  });

  test('get_my_credits marks low/empty correctly', async () => {
    const db = require('../src/db');
    db.getCreditsBalance.mockResolvedValueOnce(0.2);
    const r = await toolGetMyCredits({}, { user: { id: 7 } });
    expect(r.low).toBe(true);
    expect(r.empty).toBe(false);
  });

  test('get_my_usage requires ctx', async () => {
    const r = await toolGetMyUsage({});
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  test('get_my_usage summarises topups vs consumed', async () => {
    const r = await toolGetMyUsage({}, { user: { id: 7 } });
    expect(r.ok).toBe(true);
    expect(r.minutesConsumed).toBe(5);
    expect(r.minutesTopped).toBe(30);
    expect(r.recent.length).toBe(3);
    expect(r.recent[0].kind).toBe('topup');
    expect(r.recent[0].amountCents).toBe(1000);
  });

  test('get_my_profile requires ctx', async () => {
    const r = await toolGetMyProfile({});
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  test('get_my_profile returns safe fields', async () => {
    const r = await toolGetMyProfile({}, { user: { id: 7 } });
    expect(r.ok).toBe(true);
    expect(r.id).toBe(7);
    expect(r.email).toBe('adrian@example.com');
    expect(r.creditsMinutes).toBe(12.5);
    expect(r.createdAt).toBe('2026-01-01T00:00:00Z');
  });
});
