'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

const dns = require('dns/promises');
const proxyRouter = require('../src/routes/proxy');

function makeApp() {
  const app = express();
  app.use('/api/proxy', proxyRouter);
  return app;
}

function makeWebStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

describe('proxy route security + stream behavior', () => {
  beforeEach(() => {
    dns.lookup.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test.each(['/api/proxy', '/api/proxy/stream'])('rejects loopback/private literals on %s', async (path) => {
    const app = makeApp();

    const literal = await request(app).get(`${path}?url=${encodeURIComponent('http://127.0.0.1:8080')}`);
    expect(literal.status).toBe(400);
    expect(literal.text).toMatch(/private or internal/i);

    const localhost = await request(app).get(`${path}?url=${encodeURIComponent('http://localhost:8080')}`);
    expect(localhost.status).toBe(400);
    expect(localhost.text).toMatch(/private or internal/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects hosts that resolve to private addresses', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const app = makeApp();

    const res = await request(app).get('/api/proxy?url=https%3A%2F%2Fexample.com');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/private or internal/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects expanded-form private IPv6 literals', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/proxy?url=http%3A%2F%2F%5Bfc00%3A0%3A0%3A0%3A0%3A0%3A0%3A1%5D%2F');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/private or internal/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('does not forward stale upstream content-length/content-encoding for rewritten HTML', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch.mockResolvedValue({
      status: 200,
      headers: new Headers({
        'content-type': 'text/html; charset=utf-8',
        'content-length': '9',
        'content-encoding': 'gzip',
      }),
      text: async () => '<html><head></head><body>ok</body></html>',
    });

    const app = makeApp();
    const res = await request(app).get('/api/proxy?url=https%3A%2F%2Fexample.com%2Findex.html');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).not.toBe('9');
  });

  test('forwards range headers/status and streams body on /stream', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    let fetchOptions;
    global.fetch.mockImplementation(async (_url, options) => {
      fetchOptions = options;
      return {
        status: 206,
        headers: new Headers({
          'content-type': 'audio/mpeg',
          'content-range': 'bytes 0-2/10',
          'content-length': '3',
          'accept-ranges': 'bytes',
          etag: '"abc"',
          'last-modified': 'Fri, 01 Jan 2021 00:00:00 GMT',
        }),
        body: makeWebStream(['abc']),
      };
    });

    const app = makeApp();
    const res = await request(app)
      .get('/api/proxy/stream?url=https%3A%2F%2Fexample.com%2Faudio.mp3')
      .set('Range', 'bytes=0-2')
      .set('If-Range', '"abc"')
      .set('If-Modified-Since', 'Fri, 01 Jan 2021 00:00:00 GMT')
      .set('If-None-Match', '"abc"');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-2/10');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(fetchOptions.signal).toBeTruthy();
    expect(fetchOptions.headers.Range).toBe('bytes=0-2');
    expect(fetchOptions.headers['If-Range']).toBe('"abc"');
    expect(fetchOptions.headers['If-Modified-Since']).toBe('Fri, 01 Jan 2021 00:00:00 GMT');
    expect(fetchOptions.headers['If-None-Match']).toBe('"abc"');
  });
});
