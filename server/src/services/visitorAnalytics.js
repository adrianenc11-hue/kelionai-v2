'use strict';

// Admin · Visitors — advanced analytics.
//
// Adrian 2026-04-22: "la vizite super rudimentar,peste tot". The old
// `/api/admin/visitors` endpoint returns the last-N rows and a top-5
// country tally. This service aggregates the same `visitor_events`
// table into the richer shape the admin UI needs:
//
//   - `byCountry`     — every country that appears in the window, desc by
//                       count, so the map list isn't capped to 5.
//   - `byDevice`      — desktop / mobile / tablet / unknown — bots
//                       intentionally excluded so the chart only reflects
//                       real visitors. Bot count is reported separately
//                       via `bots.count` for the admin who wants to see
//                       crawl pressure.
//   - `byBrowser`     — Chrome / Firefox / Safari / Edge / etc., parsed
//                       from the user-agent. Real visitors only.
//   - `byOs`          — Windows / macOS / Linux / Android / iOS, parsed
//                       from the user-agent.
//   - `topReferrers`  — non-empty referer hosts (where they came from).
//   - `topPaths`      — landing paths that received the most visits.
//   - `byDay`         — one bucket per UTC day for the last N days, zero-
//                       padded so the SVG chart renders a continuous line.
//   - `funnel`        — visits → signed-in sessions → distinct signed-in
//                       users → users who topped up in the window → users
//                       who burned credits in the window. Answers "how
//                       many of the people hitting the site actually
//                       converted?".
//
// Adrian 2026-04-25: "boti nu-i mai afisam, doar reali cu datele lor cit
// mai complete". Bots are excluded from every metric except the dedicated
// `bots` block. Real visitors get richer dimensions (browser, OS,
// referrer source, landing path) on top of the existing country/device
// mix.
//
// Everything is capped (`days` clamped 1..365, row fetch limited to
// 50k) so the endpoint stays cheap even after months of traffic.

const { getDb } = require('../db');

const MS_PER_DAY = 86_400_000;

function classifyDevice(userAgent) {
  // Cheap UA sniff — matches the patterns used by the existing
  // frontend for its "mobile vs desktop" branch so the admin number
  // and the runtime flag agree.
  if (!userAgent || typeof userAgent !== 'string') return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/bot|crawl|spider|slurp|bing|google|yandex|duckduck|facebookexternalhit|embedly|preview|http[-_ ]?client|python-requests|curl\/|wget|go-http|java\//.test(ua)) {
    return 'bot';
  }
  if (/ipad|tablet|kindle|playbook|nexus 7|nexus 10/.test(ua)) return 'tablet';
  if (/android|iphone|ipod|mobile|blackberry|iemobile|opera mini|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

function classifyBrowser(userAgent) {
  // Cheap browser sniff — order matters because most browsers
  // include the Chrome token, Edge includes Chrome+Safari, etc.
  if (!userAgent || typeof userAgent !== 'string') return 'Unknown';
  const ua = userAgent;
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Vivaldi/i.test(ua)) return 'Vivaldi';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'Safari';
  return 'Other';
}

function classifyOs(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return 'Unknown';
  const ua = userAgent;
  // iPad/iPhone UAs include "Mac OS X" — check iOS first so they
  // aren't misclassified as macOS desktops.
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function refererHost(referer) {
  // Extract the bare host (e.g. "www.google.com" → "google.com") for
  // the top-referrers tally. Anything we can't parse is treated as
  // "direct / unknown" so the chart isn't dominated by garbage strings.
  if (!referer || typeof referer !== 'string') return null;
  const trimmed = referer.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    let h = (u.hostname || '').toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h || null;
  } catch (_) {
    return null;
  }
}

function dayKey(ts) {
  // UTC day bucket — matches the zero-padded axis we build below.
  const d = ts instanceof Date ? ts : new Date(ts);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function clampDays(days) {
  // `Number(0) || 30` short-circuits to 30, which would silently
  // override a test/caller that asks for "as few days as allowed".
  // Parse first, fall back to 30 only when the input is NaN.
  const n = Number(days);
  const base = Number.isFinite(n) ? n : 30;
  return Math.min(365, Math.max(1, Math.trunc(base)));
}

function buildDayAxis(days, now = Date.now()) {
  const out = [];
  const safeDays = clampDays(days);
  for (let i = safeDays - 1; i >= 0; i -= 1) {
    out.push(new Date(now - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return out;
}

function topN(map, n = 10) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

async function getVisitorAnalytics({ days = 30 } = {}) {
  const safeDays = clampDays(days);
  const since = new Date(Date.now() - safeDays * MS_PER_DAY).toISOString();

  let rows = [];
  let topups = [];
  let consumptions = [];
  try {
    const db = getDb();
    if (db) {
      // Pull a capped slice of raw events. 50k rows = ~2-5 MB, still
      // well under the Node heap; anything past that would also blow
      // the admin panel JSON size, so we prefer the cap to unbounded
      // queries.
      rows = await db.all(
        `SELECT ts, country, user_agent, user_id, referer, path
         FROM visitor_events
         WHERE ts >= ?
         ORDER BY ts DESC
         LIMIT 50000`,
        [since]
      );
      // Funnel side-tables. We only need the user_id lists, not the
      // full ledger rows — keeps the query small.
      const [topupRows, consumeRows] = await Promise.all([
        db.all(
          `SELECT DISTINCT user_id FROM credit_transactions
           WHERE created_at >= ? AND kind = 'topup' AND user_id IS NOT NULL`,
          [since]
        ),
        db.all(
          `SELECT DISTINCT user_id FROM credit_transactions
           WHERE created_at >= ? AND kind = 'consume' AND user_id IS NOT NULL`,
          [since]
        ),
      ]);
      topups = Array.isArray(topupRows) ? topupRows : [];
      consumptions = Array.isArray(consumeRows) ? consumeRows : [];
    }
  } catch (err) {
    console.warn('[visitorAnalytics] query failed:', err && err.message);
  }

  const byCountry = new Map();
  const byDevice = { mobile: 0, tablet: 0, desktop: 0, unknown: 0 };
  const byBrowser = new Map();
  const byOs = new Map();
  const byReferrer = new Map();
  const byPath = new Map();
  const byDay = new Map();
  const visitorUserIds = new Set();
  let signedInVisits = 0;
  let realVisits = 0;
  let botVisits = 0;
  const botCountries = new Map();

  for (const r of rows) {
    const device = classifyDevice(r.user_agent);
    if (device === 'bot') {
      // Bots are excluded from every visitor-facing metric. We track
      // their volume separately so admin can see crawl pressure but
      // they don't dilute the conversion funnel or the country mix.
      botVisits += 1;
      const bc = r.country && String(r.country).trim();
      if (bc) botCountries.set(bc, (botCountries.get(bc) || 0) + 1);
      continue;
    }

    realVisits += 1;
    byDevice[device] = (byDevice[device] || 0) + 1;

    const c = r.country && String(r.country).trim();
    if (c) byCountry.set(c, (byCountry.get(c) || 0) + 1);

    const browser = classifyBrowser(r.user_agent);
    byBrowser.set(browser, (byBrowser.get(browser) || 0) + 1);

    const os = classifyOs(r.user_agent);
    byOs.set(os, (byOs.get(os) || 0) + 1);

    const refHost = refererHost(r.referer);
    if (refHost) {
      byReferrer.set(refHost, (byReferrer.get(refHost) || 0) + 1);
    } else {
      byReferrer.set('(direct)', (byReferrer.get('(direct)') || 0) + 1);
    }

    const p = (r.path || '').trim();
    if (p) byPath.set(p, (byPath.get(p) || 0) + 1);

    const key = dayKey(r.ts);
    if (key) byDay.set(key, (byDay.get(key) || 0) + 1);

    if (r.user_id !== null && r.user_id !== undefined) {
      signedInVisits += 1;
      visitorUserIds.add(Number(r.user_id));
    }
  }

  const axis = buildDayAxis(safeDays);
  const byDayArr = axis.map((day) => ({ day, count: byDay.get(day) || 0 }));

  const byCountryArr = Array.from(byCountry.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  const topupIds = new Set(
    topups.map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n))
  );
  const consumeIds = new Set(
    consumptions.map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n))
  );
  const topupVisitors = Array.from(visitorUserIds).filter((id) => topupIds.has(id)).length;
  const consumeVisitors = Array.from(visitorUserIds).filter((id) => consumeIds.has(id)).length;

  return {
    windowDays: safeDays,
    ts: new Date().toISOString(),
    totals: {
      // `visits` excludes bots — that's what the admin chart should
      // show by default. The raw row count (incl. bots) is in
      // `bots.count + totals.visits` if anyone needs it.
      visits: realVisits,
      signedInVisits,
      uniqueUsers: visitorUserIds.size,
    },
    byCountry: byCountryArr,
    byDevice,
    byBrowser: topN(byBrowser, 12),
    byOs: topN(byOs, 12),
    topReferrers: topN(byReferrer, 12),
    topPaths: topN(byPath, 12),
    byDay: byDayArr,
    bots: {
      // Hidden by default in the UI. Available so admin can spot
      // unusual crawl volume without it polluting the real numbers.
      count: botVisits,
      byCountry: Array.from(botCountries.entries())
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count),
    },
    funnel: {
      visits: realVisits,
      signedInVisits,
      uniqueSignedInUsers: visitorUserIds.size,
      usersWithTopup: topupVisitors,
      usersWithConsumption: consumeVisitors,
    },
  };
}

module.exports = {
  getVisitorAnalytics,
  // Exposed for unit tests.
  _classifyDevice: classifyDevice,
  _classifyBrowser: classifyBrowser,
  _classifyOs: classifyOs,
  _refererHost: refererHost,
  _buildDayAxis: buildDayAxis,
};
