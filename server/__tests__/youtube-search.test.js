'use strict';

/**
 * F10 — /api/youtube/search wraps the official YouTube Data API v3 so
 * `show_on_monitor('video', <free text>)` can upgrade from the
 * external-results-card fallback (PR #160) to a real inline
 * /embed/<videoId> iframe on the avatar's stage monitor.
 *
 * We stub globalThis.fetch so no real network call happens.
 */

const express = require('express');
const request = require('supertest');

function mountRouter() {
  const app = express();
  const router = require('../src/routes/youtube');
  app.use('/api/youtube', router);
  return app;
}

describe('GET /api/youtube/search', () => {
  const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
    delete global.fetch;
  });

  test('returns 404 when YOUTUBE_API_KEY is not configured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=jazz');
    expect(r.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns 400 when q is missing', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search');
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('forwards videoEmbeddable=true filter and returns parsed payload', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        items: [
          {
            id: { videoId: 'abc123DEF' },
            snippet: {
              title: 'Best Country Playlist',
              channelTitle: 'TestChannel',
              thumbnails: {
                default: { url: 'https://img.example/def.jpg' },
                medium: { url: 'https://img.example/med.jpg' },
              },
            },
          },
        ],
      }),
    });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=country%20music');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      videoId: 'abc123DEF',
      title: 'Best Country Playlist',
      channelTitle: 'TestChannel',
      thumbnail: 'https://img.example/med.jpg',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toMatch(/videoEmbeddable=true/);
    expect(requested).toMatch(/type=video/);
    expect(requested).toMatch(/maxResults=1/);
    expect(requested).toMatch(/key=test-key/);
    expect(requested).toMatch(/q=country\+music|q=country%20music/);
  });

  test('caches repeated queries so we do not burn quota', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        items: [
          {
            id: { videoId: 'xyz' },
            snippet: { title: 'T', channelTitle: 'C', thumbnails: {} },
          },
        ],
      }),
    });
    const app = mountRouter();
    await request(app).get('/api/youtube/search?q=jazz');
    await request(app).get('/api/youtube/search?q=JAZZ');
    await request(app).get('/api/youtube/search?q=jazz');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns 204 when no embeddable results', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ items: [] }),
    });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=zzzxqxq_no_match_ever');
    expect(r.status).toBe(204);
  });

  test('returns 502 when upstream YouTube API errors', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'quotaExceeded',
      json: async () => ({}),
    });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=something_uncached');
    expect(r.status).toBe(502);
  });
});
