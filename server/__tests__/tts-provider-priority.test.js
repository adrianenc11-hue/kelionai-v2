'use strict';

// Single-LLM cleanup (Adrian, 2026-04): the user hears ONE voice across
// every reply. ElevenLabs is the primary path (cloned voice or curated
// native male per language). Gemini TTS is the only fallback if
// ElevenLabs isn't configured. The OpenAI TTS path was removed entirely.
//
// These tests lock in the priority so nobody accidentally re-introduces
// OpenAI or demotes ElevenLabs behind Gemini.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/noop.db';

const { createMockDb } = require('./helpers/mockDb');
const mockDb = createMockDb();
jest.mock('../src/db', () => mockDb);
jest.mock('../src/utils/google', () => ({
  generateState: jest.fn().mockReturnValue('s'),
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier:'v', codeChallenge:'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const app     = require('../src/index');

const OG_FETCH = global.fetch;
const ORIG_KEYS = {
  GEMINI: process.env.GEMINI_API_KEY,
  ELEVEN: process.env.ELEVENLABS_API_KEY,
  OVERRIDE: process.env.TTS_PROVIDER,
};

function stubFetch() {
  const calls = [];
  global.fetch = jest.fn(async (url) => {
    calls.push(String(url));
    if (/elevenlabs\.io/.test(url)) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    }
    if (/generativelanguage\.googleapis\.com/.test(url)) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('RIFF').toString('base64') } }] } }],
        }),
      };
    }
    return { ok: false, status: 404, text: async () => 'unknown' };
  });
  return calls;
}

function restoreFetch() { global.fetch = OG_FETCH; }
function restoreKeys() {
  if (ORIG_KEYS.GEMINI   === undefined) delete process.env.GEMINI_API_KEY;     else process.env.GEMINI_API_KEY     = ORIG_KEYS.GEMINI;
  if (ORIG_KEYS.ELEVEN   === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = ORIG_KEYS.ELEVEN;
  if (ORIG_KEYS.OVERRIDE === undefined) delete process.env.TTS_PROVIDER;       else process.env.TTS_PROVIDER       = ORIG_KEYS.OVERRIDE;
}

async function ttsCall() {
  return request(app).post('/api/tts').send({ text: 'hello there', lang: 'en' });
}

describe('TTS provider priority (unified voice — ElevenLabs primary)', () => {
  beforeEach(() => mockDb._reset());
  afterEach(() => {
    restoreFetch();
    restoreKeys();
  });

  test('ElevenLabs wins by default when ELEVENLABS_API_KEY is set (Gemini also set)', async () => {
    process.env.GEMINI_API_KEY     = 'AIza-gemini-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    delete process.env.TTS_PROVIDER;
    const calls = stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('elevenlabs');
    expect(calls.some((u) => /elevenlabs\.io/.test(u))).toBe(true);
  });

  test('Falls back to Gemini when ELEVENLABS_API_KEY is missing', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-gemini-test';
    delete process.env.TTS_PROVIDER;
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('gemini');
  });

  test('TTS_PROVIDER=gemini forces Gemini even when ElevenLabs key is set', async () => {
    process.env.GEMINI_API_KEY     = 'AIza-gemini-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    process.env.TTS_PROVIDER       = 'gemini';
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('gemini');
  });

  test('TTS_PROVIDER=elevenlabs picks ElevenLabs', async () => {
    process.env.GEMINI_API_KEY     = 'AIza-gemini-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    process.env.TTS_PROVIDER       = 'elevenlabs';
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('elevenlabs');
  });

  test('503 when no TTS provider is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(503);
  });
});
