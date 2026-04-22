'use strict';

/**
 * Tests for the follow-up to PRs #134 / #135 Devin Review findings:
 *  - fetch_url / rss_read no longer allow http:// or private-IP SSRF
 *  - get_forecast actually returns up to 16 days (not silently 7)
 *  - unit_convert accepts degF/degC/degK and GB/MB aliases
 *
 * We stub globalThis.fetch so no real network call happens.
 */

const realTools = require('../src/services/realTools');

const FETCH_CALLS = [];

beforeEach(() => {
  FETCH_CALLS.length = 0;
  global.fetch = jest.fn(async (url) => {
    FETCH_CALLS.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{}',
      json: async () => ({
        daily: { time: Array.from({ length: 16 }, (_, i) => `d${i}`) },
        current_units: {},
        daily_units: {},
      }),
    };
  });
});

afterEach(() => {
  delete global.fetch;
});

describe('SSRF guard on fetch_url', () => {
  test('rejects http:// even if the host is public', async () => {
    const r = await realTools.toolFetchUrl({ url: 'http://example.com/' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/https/);
    expect(FETCH_CALLS).toHaveLength(0);
  });

  test('rejects cloud metadata IP', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://169.254.169.254/latest/meta-data/' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/private IP/);
    expect(FETCH_CALLS).toHaveLength(0);
  });

  test('rejects loopback', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://127.0.0.1:8080/admin' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/private IP/);
    expect(FETCH_CALLS).toHaveLength(0);
  });

  test('rejects 10/8', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://10.0.0.5/' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/private IP/);
  });

  test('rejects 192.168/16', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://192.168.1.1/' });
    expect(r.ok).toBe(false);
  });

  test('rejects 172.16/12', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://172.20.10.5/' });
    expect(r.ok).toBe(false);
  });

  test('rejects localhost hostname', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://localhost/' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/private host/);
  });

  test('rejects metadata.google.internal', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://metadata.google.internal/computeMetadata/v1/' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/private host/);
  });

  test('rejects IPv6 loopback', async () => {
    const r = await realTools.toolFetchUrl({ url: 'https://[::1]/' });
    expect(r.ok).toBe(false);
  });
});

describe('SSRF guard on rss_read', () => {
  test('rejects http:// feeds', async () => {
    const r = await realTools.toolRssRead({ url: 'http://example.com/feed.xml' });
    expect(r.ok).toBe(false);
    expect(FETCH_CALLS).toHaveLength(0);
  });

  test('rejects private-IP feeds', async () => {
    const r = await realTools.toolRssRead({ url: 'https://127.0.0.1/feed' });
    expect(r.ok).toBe(false);
  });
});

describe('get_forecast respects the 16-day ceiling', () => {
  test('passes forecast_days=14 through to Open-Meteo when days=14', async () => {
    await realTools.toolGetForecast({ lat: 46.77, lon: 23.6, days: 14 });
    expect(FETCH_CALLS.length).toBeGreaterThan(0);
    const last = FETCH_CALLS[FETCH_CALLS.length - 1];
    expect(last).toMatch(/forecast_days=14/);
  });

  test('caps at 16 when caller asks for more', async () => {
    await realTools.toolGetForecast({ lat: 46.77, lon: 23.6, days: 25 });
    const last = FETCH_CALLS[FETCH_CALLS.length - 1];
    expect(last).toMatch(/forecast_days=16/);
  });

  test('get_weather still clamps to 7 by default (unchanged contract)', async () => {
    await realTools.toolGetWeather({ lat: 46.77, lon: 23.6, days: 14 });
    const last = FETCH_CALLS[FETCH_CALLS.length - 1];
    expect(last).toMatch(/forecast_days=7/);
  });
});

describe('unit_convert aliases', () => {
  test('degF → degC works (was: unknown unit "degf")', () => {
    const r = realTools.toolUnitConvert({ value: 100, from: 'degF', to: 'degC' });
    expect(r.ok).toBe(true);
    expect(r.category).toBe('temperature');
    expect(Math.round(r.result)).toBe(38);
  });

  test('degC → K works', () => {
    const r = realTools.toolUnitConvert({ value: 0, from: 'degC', to: 'K' });
    expect(r.ok).toBe(true);
    expect(Math.round(r.result)).toBe(273);
  });

  test('GB → MB works (was: unknown unit "gb")', () => {
    const r = realTools.toolUnitConvert({ value: 2, from: 'GB', to: 'MB' });
    expect(r.ok).toBe(true);
    expect(r.category).toBe('data');
    expect(r.result).toBe(2000);
  });

  test('GiB → MiB works (binary)', () => {
    const r = realTools.toolUnitConvert({ value: 1, from: 'GiB', to: 'MiB' });
    expect(r.ok).toBe(true);
    expect(r.result).toBe(1024);
  });

  test('°F still works (degree symbol)', () => {
    const r = realTools.toolUnitConvert({ value: 32, from: '°F', to: '°C' });
    expect(r.ok).toBe(true);
    expect(Math.round(r.result)).toBe(0);
  });
});
