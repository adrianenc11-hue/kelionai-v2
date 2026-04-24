'use strict';

// Adrian asked for a single recognizable voice across every AI reply —
// "vreau o singura voce auzita de user, indiferent de ce AI este in spate".
// Voice-to-voice realtime (OpenAI `ash`, Gemini `Charon`) is fixed by
// those providers and cannot be routed through ElevenLabs without a
// rearchitecture, but every text-chat reply goes through /api/tts and
// that endpoint can pick ElevenLabs uniformly. These tests lock in the
// provider-selection priority so nobody accidentally demotes ElevenLabs
// back behind OpenAI/Gemini.

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
const jwt     = require('jsonwebtoken');
const app     = require('../src/index');

const OG_FETCH = global.fetch;
const ORIG_KEYS = {
  OPENAI: process.env.OPENAI_API_KEY,
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
    if (/api\.openai\.com/.test(url)) {
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

function restoreFetch() {
  global.fetch = OG_FETCH;
}

function restoreKeys() {
  if (ORIG_KEYS.OPENAI   === undefined) delete process.env.OPENAI_API_KEY;     else process.env.OPENAI_API_KEY     = ORIG_KEYS.OPENAI;
  if (ORIG_KEYS.GEMINI   === undefined) delete process.env.GEMINI_API_KEY;     else process.env.GEMINI_API_KEY     = ORIG_KEYS.GEMINI;
  if (ORIG_KEYS.ELEVEN   === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = ORIG_KEYS.ELEVEN;
  if (ORIG_KEYS.OVERRIDE === undefined) delete process.env.TTS_PROVIDER;       else process.env.TTS_PROVIDER       = ORIG_KEYS.OVERRIDE;
}

async function ttsCall() {
  return request(app).post('/api/tts').send({ text: 'hello there', lang: 'en' });
}

describe('TTS provider priority (unified voice)', () => {
  beforeEach(() => mockDb._reset());
  afterEach(() => {
    restoreFetch();
    restoreKeys();
  });

  test('ElevenLabs wins by default when ELEVENLABS_API_KEY is set (even if OpenAI + Gemini are also set)', async () => {
    process.env.OPENAI_API_KEY     = 'sk-openai-test';
    process.env.GEMINI_API_KEY     = 'AIza-gemini-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    delete process.env.TTS_PROVIDER;
    const calls = stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('elevenlabs');
    expect(calls.some((u) => /elevenlabs\.io/.test(u))).toBe(true);
    expect(calls.some((u) => /api\.openai\.com/.test(u))).toBe(false);
  });

  test('Falls back to OpenAI when ELEVENLABS_API_KEY is missing', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.GEMINI_API_KEY = 'AIza-gemini-test';
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.TTS_PROVIDER;
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('openai');
  });

  test('Falls back to Gemini when only Gemini is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    process.env.GEMINI_API_KEY = 'AIza-gemini-test';
    delete process.env.TTS_PROVIDER;
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('gemini');
  });

  test('TTS_PROVIDER=openai forces OpenAI even when ElevenLabs key is set', async () => {
    process.env.OPENAI_API_KEY     = 'sk-openai-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    process.env.TTS_PROVIDER       = 'openai';
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('openai');
  });

  test('TTS_PROVIDER=elevenlabs forces ElevenLabs even when only OpenAI key is live (but ElevenLabs key must exist)', async () => {
    process.env.OPENAI_API_KEY     = 'sk-openai-test';
    process.env.ELEVENLABS_API_KEY = 'sk-eleven-test';
    process.env.TTS_PROVIDER       = 'elevenlabs';
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(200);
    expect(r.headers['x-tts-provider']).toBe('elevenlabs');
  });

  test('503 when no TTS provider is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    stubFetch();
    const r = await ttsCall();
    expect(r.status).toBe(503);
  });
});
