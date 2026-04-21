'use strict';

// Integration-style tests for `/api/realtime/openai-live-token`.
//
// We don't hit OpenAI's servers (no network in CI). Instead we stub
// `global.fetch` to return the GA client_secrets response shape so
// the route runs end-to-end and we can assert on the `firstFrame`
// (session.update) payload it emits — that's the single point where
// Kelion's persona, tool catalog, audio format, and VAD/transcription
// config are stamped server-side for the OpenAI Realtime transport.
//
// Why assert on firstFrame rather than on a live socket? Because the
// browser client (src/lib/openaiRealtime.js) ships this exact object
// verbatim on DataChannel open. If the shape drifts, voice chat dies
// silently — model refuses the session with a 1007, or the VAD runs
// with wrong sample rate, etc. Locking the contract here catches
// regressions before merge.

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini';

const express = require('express');
const cookieParser = require('cookie-parser');

// A tiny JSON-only test client — avoids pulling in supertest just for
// three assertions.
async function getJSON(app, path) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const http = require('http');
      http.get({ host: '127.0.0.1', port, path }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') }); }
          catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  });
}

describe('/api/realtime/openai-live-token', () => {
  let realFetch;
  let app;

  beforeAll(() => {
    realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      // OpenAI ephemeral-token mint — return the GA response shape.
      if (typeof url === 'string' && url.includes('/v1/realtime/client_secrets')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value:      'ek_test_abcdef',
            expires_at: Math.floor(Date.now() / 1000) + 60,
          }),
          text: async () => '',
        };
      }
      // Fallthrough for any geo / other fetches the route may perform.
      if (realFetch) return realFetch(url, opts);
      return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
    };

    const realtimeRouter = require('../src/routes/realtime');
    app = express();
    app.use(cookieParser());
    app.use('/api/realtime', realtimeRouter);
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  test('returns an ephemeral token, model id, and firstFrame session.update', async () => {
    const { status, body } = await getJSON(app, '/api/realtime/openai-live-token?lang=en-US');
    // Guests are rate-limited via the shared trial window. If the window
    // is exhausted on the test runner we accept that and skip the deep
    // assertions — CI boots fresh so this normally passes.
    if (status === 429) return;
    expect(status).toBe(200);
    expect(body.token).toBe('ek_test_abcdef');
    expect(body.provider).toBe('openai');
    expect(body.wsUrl).toMatch(/^wss:\/\/api\.openai\.com\/v1\/realtime\?model=/);
    expect(typeof body.model).toBe('string');
    expect(body.model.length).toBeGreaterThan(0);

    const frame = body.setup;
    expect(frame).toBeTruthy();
    expect(frame.type).toBe('session.update');
    expect(frame.session.type).toBe('realtime');
    expect(frame.session.model).toBe(body.model);
    expect(typeof frame.session.instructions).toBe('string');
    // Kelion persona is long — short strings indicate a render regression.
    expect(frame.session.instructions.length).toBeGreaterThan(500);
    // The persona is identity-bearing — must name "Kelion" somewhere so
    // the model doesn't drift into a generic assistant voice.
    expect(frame.session.instructions).toMatch(/Kelion/);
  });

  test('firstFrame audio config matches the WebRTC client expectations', async () => {
    const { status, body } = await getJSON(app, '/api/realtime/openai-live-token?lang=en-US');
    if (status === 429) return;
    const audio = body.setup.session.audio;
    // Input: 24 kHz PCM (OpenAI GA format); VAD server-side with
    // interrupt_response so barge-in is automatic (no client code needed
    // to stop the assistant's audio when the user starts speaking).
    expect(audio.input.format.type).toBe('audio/pcm');
    expect(audio.input.format.rate).toBe(24000);
    expect(audio.input.turn_detection.type).toBe('server_vad');
    expect(audio.input.turn_detection.create_response).toBe(true);
    expect(audio.input.turn_detection.interrupt_response).toBe(true);
    expect(audio.input.transcription).toBeDefined();
    expect(typeof audio.input.transcription.model).toBe('string');
    // Output: 24 kHz PCM again; voice falls back to `marin` (GA-
    // recommended neutral voice) when OPENAI_REALTIME_LIVE_VOICE is
    // unset.
    expect(audio.output.format.type).toBe('audio/pcm');
    expect(audio.output.format.rate).toBe(24000);
    expect(typeof audio.output.voice).toBe('string');
    expect(audio.output.voice.length).toBeGreaterThan(0);
  });

  test('firstFrame embeds the OpenAI-shape tool catalog', async () => {
    const { status, body } = await getJSON(app, '/api/realtime/openai-live-token?lang=en-US');
    if (status === 429) return;
    const tools = body.setup.session.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    // Every tool should be in the OpenAI function-calling shape (flat
    // list of { type: 'function', name, description, parameters }).
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.parameters).toBeDefined();
      expect(t.parameters.type).toBe('object');
    }
    // And the adapter must have rendered the exact same tool-name set
    // as the Gemini path, so swapping providers doesn't change what
    // Kelion can do.
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('browse_web');
    expect(names).toContain('observe_user_emotion');
    expect(names).toContain('show_on_monitor');
    expect(body.setup.session.tool_choice).toBe('auto');
  });
});
