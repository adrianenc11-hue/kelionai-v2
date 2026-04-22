'use strict';

// PR D — communications + automations + package info tool tests.
//
// We never reach the real Resend / Twilio / Zapier / GitHub / npm / PyPI
// endpoints in CI. Outbound HTTP is stubbed through globalThis.fetch —
// the same pattern used by the Groq tool tests.

// PR C (lazy-loaded e2b) is still open in PR #149. On master the
// REAL_TOOL_NAMES array does not include it yet, so this file does
// not reference run_code / run_regex / get_my_* at all.

const {
  executeRealTool,
  toolSendEmail,
  toolSendSms,
  toolCreateCalendarIcs,
  toolZapierTrigger,
  toolGithubRepoInfo,
  toolNpmPackageInfo,
  toolPypiPackageInfo,
  REAL_TOOL_NAMES,
} = require('../src/services/realTools');

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  delete process.env.EMAIL_FROM;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM;
  delete process.env.GITHUB_TOKEN;
});

// ───────────────────────── catalog regression ─────────────────────

describe('PR D catalog', () => {
  test('REAL_TOOL_NAMES includes the 7 PR D tools', () => {
    expect(REAL_TOOL_NAMES).toEqual(expect.arrayContaining([
      'send_email', 'send_sms', 'create_calendar_ics',
      'zapier_trigger',
      'github_repo_info', 'npm_package_info', 'pypi_package_info',
    ]));
  });
});

// ───────────────────────── send_email ─────────────────────────────

describe('send_email', () => {
  test('returns unavailable=true when RESEND_API_KEY is missing', async () => {
    const r = await toolSendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/RESEND_API_KEY/);
  });

  test('rejects missing "from" when RESEND_FROM is unset', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const r = await toolSendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/sender/);
  });

  test('rejects invalid recipient addresses', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'kelion@kelion.ai';
    const r = await toolSendEmail({ to: 'not-an-email', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid recipient/);
  });

  test('rejects when both text and html are missing', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'kelion@kelion.ai';
    const r = await toolSendEmail({ to: 'a@b.co', subject: 's' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/body/);
  });

  test('POSTs to Resend with expected shape and returns id', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'kelion@kelion.ai';
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ id: 'em_12345' }) };
    };
    const r = await toolSendEmail({
      to: ['a@b.co', 'c@d.co'], subject: 'hi', text: 'body',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('em_12345');
    expect(r.provider).toBe('resend');
    expect(captured.url).toBe('https://api.resend.com/emails');
    expect(captured.init.method).toBe('POST');
    expect(captured.init.headers.Authorization).toBe('Bearer re_test');
    const body = JSON.parse(captured.init.body);
    expect(body.to).toEqual(['a@b.co', 'c@d.co']);
    expect(body.from).toBe('kelion@kelion.ai');
    expect(body.subject).toBe('hi');
    expect(body.text).toBe('body');
  });

  test('surfaces Resend HTTP error with status', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM = 'kelion@kelion.ai';
    globalThis.fetch = async () => ({
      ok: false, status: 422, json: async () => ({ message: 'Invalid domain' }),
    });
    const r = await toolSendEmail({ to: 'a@b.co', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/Invalid domain/);
  });
});

// ───────────────────────── send_sms ───────────────────────────────

describe('send_sms', () => {
  test('returns unavailable when Twilio keys are missing', async () => {
    const r = await toolSendSms({ to: '+14155550123', message: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/TWILIO/);
  });

  test('requires a "from" number', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    const r = await toolSendSms({ to: '+14155550123', message: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/TWILIO_FROM/);
  });

  test('rejects non-E.164 "to" numbers', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM = '+14155550100';
    const r = await toolSendSms({ to: 'call me', message: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/E\.164/);
  });

  test('POSTs form-encoded body with HTTP Basic auth', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM = '+14155550100';
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 201, json: async () => ({ sid: 'SM42', status: 'queued', num_segments: '1' }) };
    };
    const r = await toolSendSms({ to: '+14155550123', message: 'hi' });
    expect(r.ok).toBe(true);
    expect(r.sid).toBe('SM42');
    expect(captured.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(captured.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(captured.init.headers.Authorization).toMatch(/^Basic /);
    const params = new URLSearchParams(captured.init.body);
    expect(params.get('From')).toBe('+14155550100');
    expect(params.get('To')).toBe('+14155550123');
    expect(params.get('Body')).toBe('hi');
  });

  test('strips spaces / dashes / parens from to+from before hitting Twilio', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_FROM = '+1 (415) 555-0100';
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 201, json: async () => ({ sid: 'SM99', status: 'queued' }) };
    };
    const r = await toolSendSms({ to: '+1 (415) 555-0123', message: 'hi' });
    expect(r.ok).toBe(true);
    const params = new URLSearchParams(captured.init.body);
    expect(params.get('From')).toBe('+14155550100');
    expect(params.get('To')).toBe('+14155550123');
  });
});

// ───────────────────────── create_calendar_ics ────────────────────

describe('create_calendar_ics', () => {
  test('generates a valid VCALENDAR with mandatory fields', () => {
    const r = toolCreateCalendarIcs({
      title: 'Kelion standup',
      start: '2026-05-01T09:00:00Z',
      end:   '2026-05-01T09:30:00Z',
      location: 'Zoom',
      description: 'Weekly sync',
    });
    expect(r.ok).toBe(true);
    expect(r.ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(r.ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(r.ics).toMatch(/SUMMARY:Kelion standup/);
    expect(r.ics).toMatch(/DTSTART:20260501T090000Z/);
    expect(r.ics).toMatch(/DTEND:20260501T093000Z/);
    expect(r.ics).toMatch(/LOCATION:Zoom/);
    expect(r.ics).toMatch(/DESCRIPTION:Weekly sync/);
    expect(r.dataUrl).toMatch(/^data:text\/calendar;charset=utf-8;base64,/);
  });

  test('defaults end to start + 1h when end is missing', () => {
    const r = toolCreateCalendarIcs({ title: 'x', start: '2026-05-01T09:00:00Z' });
    expect(r.ok).toBe(true);
    expect(r.ics).toMatch(/DTEND:20260501T100000Z/);
  });

  test('escapes commas, semicolons and newlines in the summary', () => {
    const r = toolCreateCalendarIcs({
      title: 'Pay; eat, sleep\nrepeat',
      start: '2026-05-01T09:00:00Z',
    });
    expect(r.ok).toBe(true);
    expect(r.ics).toMatch(/SUMMARY:Pay\\; eat\\, sleep\\nrepeat/);
  });

  test('wraps attendee CN in DQUOTEs when it contains RFC 5545 specials', () => {
    const r = toolCreateCalendarIcs({
      title: 'x',
      start: '2026-05-01T09:00:00Z',
      attendees: [{ name: 'Doe; John, CEO', email: 'jd@example.com' }],
    });
    expect(r.ok).toBe(true);
    // Must NOT backslash-escape the parameter value (that's for property values).
    expect(r.ics).not.toMatch(/CN=Doe\\;/);
    // Must quote the value because it contains ';' and ','.
    expect(r.ics).toMatch(/ATTENDEE;CN="Doe; John, CEO";RSVP=TRUE:mailto:jd@example\.com/);
  });

  test('drops invalid attendee emails but keeps valid ones', () => {
    const r = toolCreateCalendarIcs({
      title: 'x',
      start: '2026-05-01T09:00:00Z',
      attendees: [
        { name: 'Adrian', email: 'a@b.co' },
        { email: 'not-an-email' },
        'another-invalid',
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.ics).toMatch(/ATTENDEE;CN=Adrian;RSVP=TRUE:mailto:a@b\.co/);
    expect(r.ics).not.toMatch(/not-an-email/);
    expect(r.attendees).toHaveLength(1);
  });

  test('rejects bad ISO start', () => {
    const r = toolCreateCalendarIcs({ title: 'x', start: 'not-a-date' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/start/);
  });
});

// ───────────────────────── zapier_trigger ─────────────────────────

describe('zapier_trigger', () => {
  test('rejects non-Zapier URLs', async () => {
    const r = await toolZapierTrigger({ webhook_url: 'https://evil.example.com/hook', payload: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Catch Hook/);
  });

  test('POSTs payload as JSON and surfaces zapier status', async () => {
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ status: 'success', id: 'req_abc' }),
      };
    };
    const r = await toolZapierTrigger({
      webhook_url: 'https://hooks.zapier.com/hooks/catch/123/abcdef/',
      payload: { kelion: 'hi', minutes: 42 },
    });
    expect(r.ok).toBe(true);
    expect(r.zapierStatus).toBe('success');
    expect(r.zapierId).toBe('req_abc');
    expect(captured.url).toBe('https://hooks.zapier.com/hooks/catch/123/abcdef/');
    expect(captured.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(captured.init.body)).toEqual({ kelion: 'hi', minutes: 42 });
  });

  test('surfaces Zapier HTTP error with status', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 410, text: async () => JSON.stringify({ message: 'hook retired' }),
    });
    const r = await toolZapierTrigger({
      webhook_url: 'https://hooks.zapier.com/hooks/catch/1/a/',
      payload: {},
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(410);
    expect(r.error).toMatch(/retired/);
  });
});

// ───────────────────────── github_repo_info ───────────────────────

describe('github_repo_info', () => {
  test('rejects malformed repo slug', async () => {
    const r = await toolGithubRepoInfo({ repo: 'no-slash' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/slug/);
  });

  test('strips https://github.com/ prefix and .git suffix', async () => {
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return {
        ok: true, status: 200,
        json: async () => ({
          full_name: 'facebook/react',
          description: 'A JS library',
          stargazers_count: 240000,
          forks_count: 50000,
          subscribers_count: 1000,
          open_issues_count: 1500,
          language: 'JavaScript',
          license: { spdx_id: 'MIT' },
          topics: ['ui', 'react'],
          archived: false,
          fork: false,
          default_branch: 'main',
          html_url: 'https://github.com/facebook/react',
          created_at: '2013-05-24T16:15:54Z',
          pushed_at: '2026-04-20T12:00:00Z',
          updated_at: '2026-04-20T12:00:00Z',
        }),
      };
    };
    const r = await toolGithubRepoInfo({ repo: 'https://github.com/facebook/react.git' });
    expect(r.ok).toBe(true);
    expect(r.fullName).toBe('facebook/react');
    expect(r.stars).toBe(240000);
    expect(r.license).toBe('MIT');
    expect(captured.url).toBe('https://api.github.com/repos/facebook/react');
    expect(captured.init.headers['User-Agent']).toBe('kelion-ai-tools');
    expect(captured.init.headers.Authorization).toBeUndefined();
  });

  test('attaches GITHUB_TOKEN bearer when present', async () => {
    process.env.GITHUB_TOKEN = 'ghp_abc';
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ full_name: 'a/b' }) };
    };
    await toolGithubRepoInfo({ repo: 'a/b' });
    expect(captured.init.headers.Authorization).toBe('Bearer ghp_abc');
  });

  test('returns 404 cleanly for missing repo', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await toolGithubRepoInfo({ repo: 'who/where' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toMatch(/not found/);
  });
});

// ───────────────────────── npm_package_info ───────────────────────

describe('npm_package_info', () => {
  test('rejects invalid package names', async () => {
    const r = await toolNpmPackageInfo({ name: 'With Spaces!!' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid/);
  });

  test('returns latest version + description for a well-formed registry payload', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('registry.npmjs.org')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            name: 'react',
            'dist-tags': { latest: '19.1.0' },
            versions: {
              '19.1.0': {
                description: 'React is a JS library',
                homepage: 'https://react.dev',
                license: 'MIT',
                repository: { url: 'git+https://github.com/facebook/react.git' },
                keywords: ['react', 'ui'],
              },
              '18.3.0': { description: 'older' },
            },
            time: { modified: '2026-04-01T00:00:00Z' },
          }),
        };
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return { ok: true, status: 200, json: async () => ({ downloads: 25000000 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const r = await toolNpmPackageInfo({ name: 'react' });
    expect(r.ok).toBe(true);
    expect(r.latest).toBe('19.1.0');
    expect(r.description).toMatch(/React/);
    expect(r.license).toBe('MIT');
    expect(r.weeklyDownloads).toBe(25000000);
    // Regression: `modified` was previously always null because the code read
    // j.modified instead of j.time.modified.
    expect(r.modified).toBe('2026-04-01T00:00:00Z');
  });

  test('handles scoped packages', async () => {
    let captured = null;
    globalThis.fetch = async (url) => {
      captured = url;
      return {
        ok: true, status: 200,
        json: async () => ({ name: '@scope/pkg', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } }),
      };
    };
    const r = await toolNpmPackageInfo({ name: '@scope/pkg' });
    expect(r.ok).toBe(true);
    expect(captured).toMatch(/@scope\/pkg/);
  });
});

// ───────────────────────── pypi_package_info ──────────────────────

describe('pypi_package_info', () => {
  test('rejects invalid names', async () => {
    const r = await toolPypiPackageInfo({ name: 'with space' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid/);
  });

  test('parses PyPI JSON response into a trimmed shape', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        info: {
          name: 'requests',
          version: '2.32.0',
          summary: 'Python HTTP for Humans.',
          description: 'x'.repeat(3000),
          home_page: 'https://requests.readthedocs.io',
          author: 'Kenneth Reitz',
          author_email: 'me@kennethreitz.org',
          license: 'Apache 2.0',
          requires_python: '>=3.8',
          project_urls: { Homepage: 'https://requests.readthedocs.io' },
        },
        releases: { '2.31.0': [], '2.32.0': [] },
      }),
    });
    const r = await toolPypiPackageInfo({ name: 'requests' });
    expect(r.ok).toBe(true);
    expect(r.latest).toBe('2.32.0');
    expect(r.description.endsWith('…')).toBe(true);
    expect(r.license).toBe('Apache 2.0');
    expect(r.requiresPython).toBe('>=3.8');
    expect(r.releases).toEqual(expect.arrayContaining(['2.32.0']));
  });

  test('404 returns clean error', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await toolPypiPackageInfo({ name: 'no-such-pkg-kelion' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toMatch(/not found/);
  });
});

// ───────────────────────── executeRealTool dispatch ───────────────

describe('executeRealTool dispatch for PR D', () => {
  test('dispatches each new name', async () => {
    // send_email — unavailable path
    const r1 = await executeRealTool('send_email', { to: 'a@b.co', subject: 's', text: 't' });
    expect(r1).not.toBeNull();
    expect(r1.unavailable).toBe(true);

    // send_sms — unavailable path
    const r2 = await executeRealTool('send_sms', { to: '+14155550123', message: 'hi' });
    expect(r2).not.toBeNull();
    expect(r2.unavailable).toBe(true);

    // create_calendar_ics — pure function, happy path
    const r3 = await executeRealTool('create_calendar_ics', { title: 'x', start: '2026-05-01T09:00:00Z' });
    expect(r3.ok).toBe(true);

    // zapier_trigger — bad URL
    const r4 = await executeRealTool('zapier_trigger', { webhook_url: 'https://evil.example.com/' });
    expect(r4.ok).toBe(false);
  });
});
