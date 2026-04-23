'use strict';

/**
 * F10 — /api/youtube/search wraps the official YouTube Data API v3 so
 * `show_on_monitor('video', <free text>)` can upgrade from the
 * external-results-card fallback (PR #160) to a real inline
 * /embed/<videoId> iframe on the avatar's stage monitor.
 *
 * Later: when YOUTUBE_API_KEY is absent (or the API call fails with
 * quotaExceeded), we transparently fall back to scraping the public
 * youtube.com/results HTML for the first videoId. The scrape path
 * uses the same global fetch, so we stub it in tests.
 *
 * We stub globalThis.fetch so no real network call happens.
 */

const express = require('express');
const request = require('supertest');

function mountRouter() {
  const app = express();
  // Reload the router fresh for each test so its in-process cache
  // doesn't leak between cases (cache TTL is 10 min — longer than the
  // whole suite). `jest.resetModules()` in beforeEach handles this.
  const router = require('../src/routes/youtube');
  app.use('/api/youtube', router);
  return app;
}

// Minimal ytInitialData-style HTML fixture. The real page wraps the
// JSON in `var ytInitialData = {...};</script>` which is what the
// scrape regex keys on.
function scrapeHtmlFixture({ videoId = 'scr123', title = 'Scraped Jazz', channel = 'ScrapeChan', thumb = 'https://img.example/scr.jpg' } = {}) {
  const data = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId,
                        title: { runs: [{ text: title }] },
                        ownerText: { runs: [{ text: channel }] },
                        thumbnail: { thumbnails: [{ url: thumb }] },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
  return `<html><body><script>var ytInitialData = ${JSON.stringify(data)};</script></body></html>`;
}

describe('GET /api/youtube/search', () => {
  const ORIGINAL_KEY = process.env.YOUTUBE_API_KEY;
  const ORIGINAL_SCRAPE = process.env.YOUTUBE_SCRAPE_FALLBACK;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_SCRAPE === undefined) delete process.env.YOUTUBE_SCRAPE_FALLBACK;
    else process.env.YOUTUBE_SCRAPE_FALLBACK = ORIGINAL_SCRAPE;
    delete global.fetch;
  });

  test('returns 404 when YOUTUBE_API_KEY is missing AND scrape fallback is disabled', async () => {
    delete process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_SCRAPE_FALLBACK = '0';
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

  test('returns 204 when API returns no embeddable results AND scrape also returns no match', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    process.env.YOUTUBE_SCRAPE_FALLBACK = '1';
    fetchMock
      // 1st call: Data API — empty
      .mockResolvedValueOnce({
        ok: true, status: 200, text: async () => '',
        json: async () => ({ items: [] }),
      })
      // 2nd call: scrape — no videoRenderer in payload
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '<html></html>',
      });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=zzzxqxq_no_match_ever');
    expect(r.status).toBe(204);
  });

  test('returns 502 when upstream YouTube API errors and scrape is disabled', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    process.env.YOUTUBE_SCRAPE_FALLBACK = '0';
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

  test('falls back to scrape when API returns quotaExceeded', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    process.env.YOUTUBE_SCRAPE_FALLBACK = '1';
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'quotaExceeded',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => scrapeHtmlFixture({ videoId: 'fallback1', title: 'Fallback Jazz' }),
      });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=fallback_quota');
    expect(r.status).toBe(200);
    expect(r.body.videoId).toBe('fallback1');
    expect(r.body.title).toBe('Fallback Jazz');
  });

  test('scrapes directly when no API key is set and scrape is enabled (default)', async () => {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_SCRAPE_FALLBACK; // default = enabled
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => scrapeHtmlFixture({ videoId: 'direct1', title: 'Direct Scrape' }),
    });
    const app = mountRouter();
    const r = await request(app).get('/api/youtube/search?q=direct_scrape');
    expect(r.status).toBe(200);
    expect(r.body.videoId).toBe('direct1');
    // Only one upstream call — scrape, no API.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toMatch(/youtube\.com\/results/);
  });
});
