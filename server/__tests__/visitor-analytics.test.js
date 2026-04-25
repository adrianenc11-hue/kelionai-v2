'use strict';

// PR E4 — admin · visitors analytics.
//
// Covers the pure helpers (device classifier, day-axis builder) plus
// the aggregate shape returned by `getVisitorAnalytics`. The DB is
// stubbed with an in-memory fixture so the test does not touch
// SQLite/Postgres and runs in <10ms.

jest.mock('../src/db', () => {
  const rows = [];
  const topups = [];
  const consumes = [];
  const fakeDb = {
    all: jest.fn(async (sql /*, params */) => {
      if (/FROM visitor_events/.test(sql)) return rows;
      if (/kind = 'topup'/.test(sql)) return topups;
      if (/kind = 'consume'/.test(sql)) return consumes;
      return [];
    }),
  };
  return {
    getDb: () => fakeDb,
    __setFixture: ({ visits = [], tops = [], cons = [] }) => {
      rows.length = 0; rows.push(...visits);
      topups.length = 0; topups.push(...tops);
      consumes.length = 0; consumes.push(...cons);
    },
  };
});

const db = require('../src/db');
const {
  getVisitorAnalytics,
  _classifyDevice,
  _buildDayAxis,
} = require('../src/services/visitorAnalytics');

describe('_classifyDevice', () => {
  test('detects iPhone as mobile', () => {
    expect(
      _classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605')
    ).toBe('mobile');
  });
  test('detects Android phone as mobile', () => {
    expect(
      _classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile')
    ).toBe('mobile');
  });
  test('detects iPad as tablet', () => {
    expect(
      _classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605')
    ).toBe('tablet');
  });
  test('detects desktop Chrome as desktop', () => {
    expect(
      _classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')
    ).toBe('desktop');
  });
  test('detects Googlebot as bot', () => {
    expect(_classifyDevice('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
  });
  test('handles missing/null UA', () => {
    expect(_classifyDevice(null)).toBe('unknown');
    expect(_classifyDevice('')).toBe('unknown');
  });
});

describe('_buildDayAxis', () => {
  test('returns N consecutive UTC day keys ending today', () => {
    const now = Date.UTC(2026, 3, 22, 10, 0, 0); // 2026-04-22T10:00:00Z
    const axis = _buildDayAxis(5, now);
    expect(axis).toEqual([
      '2026-04-18',
      '2026-04-19',
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
    ]);
  });
  test('clamps to [1, 365]', () => {
    expect(_buildDayAxis(0).length).toBe(1);
    expect(_buildDayAxis(10000).length).toBe(365);
  });
});

describe('getVisitorAnalytics', () => {
  test('aggregates real visitors only — bots are excluded from every metric except `bots`', async () => {
    // Adrian 2026-04-25: "boti nu-i mai afisam, doar reali cu datele
    // lor cit mai complete". Bots must not pollute the country mix,
    // device mix, day chart, or funnel — they go into a dedicated
    // `bots` block.
    const now = Date.now();
    const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
    db.__setFixture({
      visits: [
        { ts: iso(0), country: 'RO', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile', user_id: 1, referer: 'https://www.google.com/search', path: '/' },
        { ts: iso(0), country: 'RO', user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0', user_id: 1, referer: '', path: '/' },
        { ts: iso(1), country: 'DE', user_agent: 'Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605', user_id: 2, referer: 'https://twitter.com/i/u', path: '/pricing' },
        { ts: iso(2), country: 'CN', user_agent: 'Googlebot/2.1', user_id: null, referer: '', path: '/' },
        { ts: iso(3), country: 'US', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/16 Safari/605', user_id: 3, referer: 'https://news.ycombinator.com/', path: '/' },
      ],
      tops: [{ user_id: 1 }, { user_id: 3 }],
      cons: [{ user_id: 1 }],
    });
    const out = await getVisitorAnalytics({ days: 7 });

    expect(out.windowDays).toBe(7);
    // 5 raw rows; 1 was Googlebot — totals.visits counts real only.
    expect(out.totals.visits).toBe(4);
    expect(out.totals.signedInVisits).toBe(4);
    expect(out.totals.uniqueUsers).toBe(3);

    // byCountry excludes the bot's CN row.
    expect(out.byCountry).toEqual([
      { country: 'RO', count: 2 },
      { country: 'DE', count: 1 },
      { country: 'US', count: 1 },
    ]);

    // byDevice does NOT have a 'bot' key any more — bots live in
    // `out.bots`. The visible categories sum to the real-visit count.
    expect(out.byDevice.mobile).toBe(1);
    expect(out.byDevice.tablet).toBe(1);
    expect(out.byDevice.desktop).toBe(2);
    expect(out.byDevice.bot).toBeUndefined();

    // Bots reported separately so admin can still see crawl pressure.
    expect(out.bots.count).toBe(1);
    expect(out.bots.byCountry).toEqual([{ country: 'CN', count: 1 }]);

    // Browser / OS mix derived from the UA — only real visitors.
    const browsers = Object.fromEntries(out.byBrowser.map((b) => [b.key, b.count]));
    expect(browsers.Chrome).toBe(1);
    expect(browsers.Safari).toBeGreaterThanOrEqual(1);
    const os = Object.fromEntries(out.byOs.map((b) => [b.key, b.count]));
    expect(os.Windows).toBe(1);
    expect(os.macOS).toBe(1);
    expect(os.iOS).toBeGreaterThanOrEqual(1);

    // Top referrers: google + twitter + ycombinator + 1 direct visit.
    const refs = Object.fromEntries(out.topReferrers.map((r) => [r.key, r.count]));
    expect(refs['google.com']).toBe(1);
    expect(refs['twitter.com']).toBe(1);
    expect(refs['news.ycombinator.com']).toBe(1);
    expect(refs['(direct)']).toBe(1);

    // Top landing paths.
    const paths = Object.fromEntries(out.topPaths.map((p) => [p.key, p.count]));
    expect(paths['/']).toBe(3);
    expect(paths['/pricing']).toBe(1);

    // byDay has N entries, totals add up to real visits (bot excluded).
    expect(out.byDay.length).toBe(7);
    const daySum = out.byDay.reduce((a, b) => a + b.count, 0);
    expect(daySum).toBe(4);

    // Funnel mirrors the real-visitor totals.
    expect(out.funnel.visits).toBe(4);
    expect(out.funnel.uniqueSignedInUsers).toBe(3);
    expect(out.funnel.usersWithTopup).toBe(2);
    expect(out.funnel.usersWithConsumption).toBe(1);
  });

  test('returns empty shape when DB is unavailable', async () => {
    db.__setFixture({ visits: [], tops: [], cons: [] });
    const out = await getVisitorAnalytics({ days: 30 });
    expect(out.totals.visits).toBe(0);
    expect(out.byCountry).toEqual([]);
    expect(out.byDay.length).toBe(30);
    expect(out.bots.count).toBe(0);
  });
});
