'use strict';

/**
 * F11 — unit tests for the OpenAI image-generation helper + the
 * `/api/generated-images/:id` serving route. Mocks fetch so no
 * real OpenAI quota is consumed.
 */

const express = require('express');
const request = require('supertest');

function freshService() {
  jest.resetModules();
  return require('../src/services/imageGen');
}

function mountRoute(service) {
  jest.resetModules();
  // Make the route module pick up the freshly-required service instance
  // (Node's require cache would otherwise serve the pre-reset copy).
  const app = express();
  const router = require('../src/routes/generatedImages');
  app.use('/api/generated-images', router);
  return app;
}

describe('imageGen.generateImage', () => {
  const origFetch = global.fetch;
  const origKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = origFetch;
    process.env.OPENAI_API_KEY = origKey;
  });

  it('returns unavailable when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'a red apple' });
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
    expect(r.error).toMatch(/OPENAI_API_KEY/);
  });

  it('rejects empty prompt', async () => {
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Missing prompt/);
  });

  it('rejects unsupported size values', async () => {
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'cat', size: '42x42' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid size/);
  });

  it('surfaces OpenAI moderation errors specifically', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Your request was rejected by the safety system.' } }),
    });
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'nasty' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/safety/i);
  });

  it('surfaces other upstream errors with status + detail', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'server error' } }),
    });
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'apple' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
  });

  it('on success: caches PNG + returns a short-lived URL', async () => {
    // Tiny fake PNG header — not a real image, but enough that the
    // cache + route round-trip is exercised without pulling Jimp.
    const fakeBase64 = Buffer.from('fake-png-bytes').toString('base64');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: fakeBase64 }] }),
    });
    const service = freshService();
    const r = await service.generateImage({ prompt: 'a calm sunset over the sea' });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^[a-f0-9]{24}$/);
    expect(r.url).toBe(`/api/generated-images/${r.id}`);
    expect(r.title).toBe('a calm sunset over the sea');
    expect(r.prompt).toBe('a calm sunset over the sea');
    expect(r.size).toBe('auto');
    // Model is pinned on gpt-image-1 unless overridden.
    expect(r.model).toBe('gpt-image-1');
    // And the cache really holds the bytes.
    const hit = service.cacheGet(r.id);
    expect(hit).not.toBeNull();
    expect(Buffer.isBuffer(hit.pngBuffer)).toBe(true);
    expect(hit.pngBuffer.toString()).toBe('fake-png-bytes');
  });

  it('evicts oldest entry when cache exceeds CACHE_MAX', async () => {
    const service = freshService();
    // Fill cache with 21 entries — newest evicts oldest at capacity (20).
    for (let i = 0; i < 21; i++) {
      const b64 = Buffer.from(`png-${i}`).toString('base64');
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: b64 }] }),
      });
      await service.generateImage({ prompt: `prompt ${i}` });
    }
    expect(service._cache.size).toBeLessThanOrEqual(20);
  });

  it('accepts publicBase and returns an absolute URL', async () => {
    const b64 = Buffer.from('hi').toString('base64');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    });
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'coffee', publicBase: 'https://kelion.ai' });
    expect(r.url.startsWith('https://kelion.ai/api/generated-images/')).toBe(true);
  });
});

describe('GET /api/generated-images/:id', () => {
  const origFetch = global.fetch;
  const origKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = origFetch;
    process.env.OPENAI_API_KEY = origKey;
  });

  it('serves the cached PNG with correct content-type', async () => {
    const b64 = Buffer.from('png-data').toString('base64');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    });
    const service = freshService();
    const gen = await service.generateImage({ prompt: 'dog' });
    const app = express();
    app.use('/api/generated-images', require('../src/routes/generatedImages'));
    const res = await request(app).get(`/api/generated-images/${gen.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.toString()).toBe('png-data');
  });

  it('rejects malformed id', async () => {
    freshService();
    const app = express();
    app.use('/api/generated-images', require('../src/routes/generatedImages'));
    const res = await request(app).get('/api/generated-images/not..a..valid..id');
    expect(res.status).toBe(400);
  });

  it('404s on unknown id', async () => {
    freshService();
    const app = express();
    app.use('/api/generated-images', require('../src/routes/generatedImages'));
    const res = await request(app).get('/api/generated-images/abcdef0123456789abcdef01');
    expect(res.status).toBe(404);
  });
});

describe('realTools.toolGenerateImage dispatch', () => {
  const origFetch = global.fetch;
  const origKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = origFetch;
    process.env.OPENAI_API_KEY = origKey;
  });

  it('executeRealTool("generate_image") routes through toolGenerateImage', async () => {
    jest.resetModules();
    const b64 = Buffer.from('x').toString('base64');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: b64 }] }),
    });
    const { executeRealTool, REAL_TOOL_NAMES } = require('../src/services/realTools');
    expect(REAL_TOOL_NAMES).toContain('generate_image');
    const r = await executeRealTool('generate_image', { prompt: 'castle' });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^\/api\/generated-images\/[a-f0-9]{24}$/);
  });
});
