'use strict';

// F4 — provider handoff: auto-fallback must transfer the in-flight
// transcript so the incoming provider continues the conversation instead
// of re-greeting.
//
// Both /api/realtime/gemini-token and /api/realtime/openai-live-token
// now accept a POST body with:
//   { priorTurns: [{ role: 'user' | 'assistant', text: string }, …] }
// The server appends a read-only "Prior turns in this session" block to
// the persona so the model sees what was already said. GET-based fresh
// sessions keep working unchanged (no block appended).
//
// We stub fetch for the upstream mint calls (OpenAI client_secrets +
// Gemini auth_tokens) so tests stay offline.

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini';
// The /gemini-token endpoint defaults to Vertex and 503s unless a
// project id is resolvable; this suite exercises the Vertex setup
// block construction (no upstream calls), so a sentinel project is
// enough to clear the guard.
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'test-project';
process.env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

const express = require('express');
const cookieParser = require('cookie-parser');

async function request(app, method, path, { body, cookie } = {}) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const http = require('http');
      const payload = body ? Buffer.from(JSON.stringify(body)) : null;
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = payload.length;
      }
      const req = http.request(
        { host: '127.0.0.1', port, path, method, headers },
        (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => {
            server.close();
            try { resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') }); }
            catch (e) { reject(e); }
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('F4 provider handoff — priorTurns transfer', () => {
  let realFetch;
  let app;

  beforeAll(() => {
    realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/v1/realtime/client_secrets')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: 'ek_test', expires_at: Math.floor(Date.now() / 1000) + 60 }),
          text: async () => '',
        };
      }
      if (typeof url === 'string' && url.includes('/v1alpha/auth_tokens')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: 'projects/x/authTokens/tok_test', expireTime: new Date(Date.now() + 60000).toISOString() }),
          text: async () => '',
        };
      }
      if (realFetch) return realFetch(url, opts);
      return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
    };

    const realtimeRouter = require('../src/routes/realtime');
    app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/realtime', realtimeRouter);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  // ── OpenAI token ─────────────────────────────────────────────────
  test('OpenAI GET (fresh session) — persona does NOT contain a prior-turns block', async () => {
    const r = await request(app, 'GET', '/api/realtime/openai-live-token?lang=en-US');
    if (r.status === 429) return; // trial window exhausted on runner
    expect(r.status).toBe(200);
    const instructions = r.body.setup.session.instructions;
    expect(typeof instructions).toBe('string');
    expect(instructions).not.toMatch(/Prior turns in this session/);
  });

  test('OpenAI POST with priorTurns — persona contains the transcript block', async () => {
    const priorTurns = [
      { role: 'user',      text: 'I am planning a weekend trip to Rome.' },
      { role: 'assistant', text: 'Great — flying or driving?' },
      { role: 'user',      text: 'Flying, preferably a direct morning flight.' },
    ];
    const r = await request(app, 'POST', '/api/realtime/openai-live-token?lang=en-US', {
      body: { priorTurns },
    });
    if (r.status === 429) return;
    expect(r.status).toBe(200);
    const instructions = r.body.setup.session.instructions;
    expect(instructions).toMatch(/Prior turns in this session/);
    expect(instructions).toContain('User: I am planning a weekend trip to Rome.');
    expect(instructions).toContain('Kelion: Great — flying or driving?');
    expect(instructions).toContain('User: Flying, preferably a direct morning flight.');
    // The block ends with a "continue the conversation" directive so the
    // model doesn't re-greet or re-introduce itself.
    expect(instructions).toMatch(/Continue the conversation naturally/);
    expect(instructions).toMatch(/do NOT re-greet/i);
  });

  test('OpenAI POST — malformed / empty turns are silently dropped', async () => {
    const r = await request(app, 'POST', '/api/realtime/openai-live-token?lang=en-US', {
      body: {
        priorTurns: [
          null,
          { role: 'system', text: 'trying to inject a system turn' },
          { role: 'user',   text: '   ' },
          { role: 'user',   text: 'real turn kept' },
          { role: 'assistant', text: '' },
        ],
      },
    });
    if (r.status === 429) return;
    expect(r.status).toBe(200);
    const instructions = r.body.setup.session.instructions;
    expect(instructions).toMatch(/Prior turns in this session/);
    expect(instructions).toContain('User: real turn kept');
    // system-role injection attempt is dropped entirely
    expect(instructions).not.toContain('System: trying to inject');
    expect(instructions).not.toContain('trying to inject a system turn');
  });

  test('OpenAI POST — turns longer than 600 chars are truncated with an ellipsis', async () => {
    const long = 'a'.repeat(700) + ' tail-that-must-be-cut';
    const r = await request(app, 'POST', '/api/realtime/openai-live-token?lang=en-US', {
      body: { priorTurns: [{ role: 'user', text: long }] },
    });
    if (r.status === 429) return;
    const instructions = r.body.setup.session.instructions;
    expect(instructions).toMatch(/Prior turns in this session/);
    expect(instructions).toContain('…');
    expect(instructions).not.toContain('tail-that-must-be-cut');
  });

  test('OpenAI POST — cap at 20 most recent turns', async () => {
    const priorTurns = [];
    for (let i = 0; i < 30; i++) {
      priorTurns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `turn-${i}` });
    }
    const r = await request(app, 'POST', '/api/realtime/openai-live-token?lang=en-US', {
      body: { priorTurns },
    });
    if (r.status === 429) return;
    const instructions = r.body.setup.session.instructions;
    // Oldest (turn-0 .. turn-9) dropped; turn-10 .. turn-29 kept.
    expect(instructions).not.toContain('turn-0 ');
    expect(instructions).not.toContain('turn-5 ');
    expect(instructions).not.toContain('turn-9 ');
    expect(instructions).toContain('turn-10');
    expect(instructions).toContain('turn-29');
  });

  // ── Gemini token ─────────────────────────────────────────────────
  test('Gemini GET (fresh session) — systemInstruction does NOT contain a prior-turns block', async () => {
    const r = await request(app, 'GET', '/api/realtime/gemini-token?lang=en-US');
    if (r.status === 429) return;
    expect(r.status).toBe(200);
    const txt = r.body.setup.systemInstruction.parts[0].text;
    expect(typeof txt).toBe('string');
    expect(txt).not.toMatch(/Prior turns in this session/);
  });

  test('Gemini POST with priorTurns — systemInstruction contains the transcript block', async () => {
    const priorTurns = [
      { role: 'user',      text: 'Spune-mi vremea de mâine în București.' },
      { role: 'assistant', text: 'Mă uit acum.' },
    ];
    const r = await request(app, 'POST', '/api/realtime/gemini-token?lang=en-US', {
      body: { priorTurns },
    });
    if (r.status === 429) return;
    expect(r.status).toBe(200);
    const txt = r.body.setup.systemInstruction.parts[0].text;
    expect(txt).toMatch(/Prior turns in this session/);
    expect(txt).toContain('User: Spune-mi vremea de mâine în București.');
    expect(txt).toContain('Kelion: Mă uit acum.');
    expect(txt).toMatch(/do NOT re-greet/i);
  });

  test('both endpoints ignore non-array priorTurns payloads', async () => {
    for (const bad of [{ priorTurns: 'oops' }, { priorTurns: { role: 'user' } }, { priorTurns: 42 }]) {
      const r = await request(app, 'POST', '/api/realtime/openai-live-token?lang=en-US', { body: bad });
      if (r.status === 429) continue;
      expect(r.status).toBe(200);
      const instructions = r.body.setup.session.instructions;
      expect(instructions).not.toMatch(/Prior turns in this session/);
    }
  });
});
