'use strict';

// Admin · Visitors — advanced analytics.
//
// Adrian 2026-04-22: "la vizite super rudimentar,peste tot". The old
// `/api/admin/visitors` endpoint returns the last-N rows and a top-5
// country tally. This service aggregates the same `visitor_events`
// table into the richer shape the admin UI needs:
//
//   - `byCountry` — every country that appears in the window, desc by
//     count, so the map list isn't capped to 5.
//   - `byDevice`  — mobile / tablet / desktop / bot, classified in JS
//     from the user-agent string (SQL regex dialects differ between
//     SQLite and Postgres; doing it in JS keeps both backends honest).
//   - `byDay`     — one bucket per UTC day for the last N days, zero-
//     padded so the SVG chart renders a continuous line.
//   - `funnel`    — visits → signed-in sessions → distinct signed-in
//     users → users who topped up in the window → users who burned
//     credits in the window. Answers "how many of the people hitting
//     the site actually converted?".
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
  if (/bot|crawl|spider|slurp|bing|google|yandex|duckduck|facebookexternalhit|embedly|preview/.test(ua)) {
    return 'bot';
  }
  if (/ipad|tablet|kindle|playbook|nexus 7|nexus 10/.test(ua)) return 'tablet';
  if (/android|iphone|ipod|mobile|blackberry|iemobile|opera mini|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
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
        `SELECT ts, country, user_agent, user_id
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
  const byDevice = { mobile: 0, tablet: 0, desktop: 0, bot: 0, unknown: 0 };
  const byDay = new Map();
  const visitorUserIds = new Set();
  let signedInVisits = 0;

  for (const r of rows) {
    const c = r.country && String(r.country).trim();
    if (c) byCountry.set(c, (byCountry.get(c) || 0) + 1);
    const device = classifyDevice(r.user_agent);
    byDevice[device] = (byDevice[device] || 0) + 1;
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
      visits: rows.length,
      signedInVisits,
      uniqueUsers: visitorUserIds.size,
    },
    byCountry: byCountryArr,
    byDevice,
    byDay: byDayArr,
    funnel: {
      visits: rows.length,
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
  _buildDayAxis: buildDayAxis,
};
