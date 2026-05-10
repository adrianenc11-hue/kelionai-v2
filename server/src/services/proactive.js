'use strict';

// Stage 5 — M24/M25: proactive scheduler.
// Runs inside the Node process. Every PROACTIVE_TICK_MS it scans signed-in
// users with active push subscriptions, decides if Kelion should ping them,
// and sends a web push if so.
//
// Decision policy (rule-based v1; pluggable for LLM-based v2):
//   1. User must have at least one memory_item (else we have nothing to say).
//   2. At most ONE proactive ping per user per 18h.
//   3. Current hour must be inside a quiet-hours window (default 09:00–21:00 UTC;
//      TODO: per-user timezone once we store it).
//   4. Pick a relevant memory_item (goal > routine > relationship > preference).
//   5. Craft a 1-line message template in EN ("A small nudge on your <goal>: …").

const {
  getDb,
  listActivePushSubscriptions,
  markPushSent,
  disablePushSubscriptionByEndpoint,
  logProactive,
  recentProactiveForUser,
} = require('../db');

const TICK_MS = Number(process.env.PROACTIVE_TICK_MS) || 15 * 60 * 1000; // 15 min
const MIN_GAP_MS = Number(process.env.PROACTIVE_MIN_GAP_MS) || 18 * 60 * 60 * 1000;
const QUIET_START_LOCAL = Number(process.env.PROACTIVE_START_HOUR ?? 9);
const QUIET_END_LOCAL   = Number(process.env.PROACTIVE_END_HOUR   ?? 21);

// Estimate a user's UTC offset from their last known longitude.
// Every 15° of longitude ≈ 1 hour offset from UTC. This is a rough
// approximation (ignores DST and political timezone boundaries) but
// is good enough for quiet-hours gating and avoids adding a timezone
// column or a heavy tz library.
function estimateUtcOffsetFromLng(lng) {
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return 0;
  return Math.round(lng / 15);
}

// Fetch the most recent longitude for a user from memory_items or
// action_log (geo tools store lat/lng in args). Returns null if
// no geo data is available.
async function getUserLng(userId) {
  const db = getDb();
  if (!db) return null;
  try {
    // Check action_log for recent geo-aware tool calls
    const row = await db.get(
      `SELECT args FROM action_log
       WHERE user_id = ? AND args LIKE '%lng%'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (row?.args) {
      try {
        const parsed = JSON.parse(row.args);
        if (typeof parsed.lng === 'number') return parsed.lng;
        if (typeof parsed.longitude === 'number') return parsed.longitude;
      } catch { /* ignore parse errors */ }
    }
  } catch { /* action_log may not exist yet */ }
  return null;
}

function withinQuietHours(date = new Date(), utcOffset = 0) {
  // Convert UTC hour to user's local hour
  const localHour = (date.getUTCHours() + utcOffset + 24) % 24;
  return localHour >= QUIET_START_LOCAL && localHour < QUIET_END_LOCAL;
}

const KIND_WEIGHT = { goal: 5, routine: 4, relationship: 3, preference: 2, skill: 2, context: 1, identity: 0, fact: 1 };

async function pickMemoryForUser(userId) {
  const db = getDb();
  if (!db) return null;
  const rows = await db.all(
    "SELECT id, kind, fact, created_at FROM memory_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 40",
    [userId]
  );
  if (!rows.length) return null;
  rows.sort((a, b) => (KIND_WEIGHT[b.kind] || 0) - (KIND_WEIGHT[a.kind] || 0));
  return rows[0];
}

function composeMessage(memoryItem) {
  const { kind, fact } = memoryItem;
  const truncated = fact.length > 140 ? fact.slice(0, 137) + '…' : fact;
  switch (kind) {
    case 'goal':
      return { title: 'Kelion', body: `A small nudge on your goal — ${truncated}. Want to pick it back up?`, reason: `goal:${memoryItem.id}` };
    case 'routine':
      return { title: 'Kelion', body: `Thinking about your routine — ${truncated}. How's it going?`, reason: `routine:${memoryItem.id}` };
    case 'relationship':
      return { title: 'Kelion', body: `A little reminder: ${truncated}. Worth a check-in?`, reason: `relationship:${memoryItem.id}` };
    case 'preference':
      return { title: 'Kelion', body: `I remember — ${truncated}. Want to talk?`, reason: `preference:${memoryItem.id}` };
    default:
      return { title: 'Kelion', body: 'I was thinking about you. Want to talk?', reason: `other:${memoryItem.id}` };
  }
}

// Global flag to ensure we only alert once per server lifecycle
let _claude_opusAlertSent = false;
async function checkClaude4Availability() {
  if (_claude_opusAlertSent) return null;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  try {
    const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch : (await import('node-fetch')).default;
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    const models = data.models || [];
    // We check if any Claude Opus model supports BidiGenerateContent (Live WebSocket)
    const claudeLive = models.find(m => 
      m.name.toLowerCase().includes('claude-4') && 
      (m.supportedGenerationMethods || []).includes('bidiGenerateContent')
    );
    if (claudeLive) {
      _claude_opusAlertSent = true;
      console.log('🚨 [PROACTIVE] GEMMA 4 NATIVE AUDIO IS AVAILABLE! 🚨', claudeLive.name);
      return { title: 'Kelion AI Update', body: `Claude Opus is ready for full voice replacement! Model: ${claudeLive.displayName || claudeLive.name}`, reason: 'system_alert:claude_opus' };
    }
  } catch (err) {
    // Ignore fetch errors to not pollute logs
  }
  return null;
}

async function runOnce({ webpush, now = new Date() } = {}) {
  if (!webpush) return { skipped: 'no-webpush' };
  // Global quiet-hours check (server default) — per-user override below
  // For the global check we use UTC offset 0; individual users get their
  // own offset inside the loop.
  if (!withinQuietHours(now, 0)) return { skipped: 'quiet-hours', hour: now.getUTCHours() };

  const subs = await listActivePushSubscriptions();
  const byUser = new Map();
  for (const s of subs) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id).push(s);
  }

  const report = { users_considered: byUser.size, sent: 0, skipped_gap: 0, no_memory: 0, failed: 0 };
  
  // 1. Check for systemic alerts (like Claude Opus Availability)
  const systemAlertMsg = await checkClaude4Availability();

  for (const [userId, userSubs] of byUser) {
      let msg = systemAlertMsg;
    if (!msg) {
      const recent = await recentProactiveForUser(userId, MIN_GAP_MS);
      if (recent.length > 0) { report.skipped_gap += 1; continue; }

      // Per-user quiet-hours: skip if user's local time is outside window
      const lng = await getUserLng(userId);
      const userOffset = estimateUtcOffsetFromLng(lng);
      if (!withinQuietHours(now, userOffset)) { report.skipped_gap += 1; continue; }

      const mem = await pickMemoryForUser(userId);
      if (!mem) { report.no_memory += 1; continue; }
      msg = composeMessage(mem);
    }
    
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: '/' });
    let delivered = false;
    for (const s of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } },
          payload
        );
        await markPushSent(s.id);
        delivered = true;
      } catch (err) {
        const code = err.statusCode || 0;
        if (code === 404 || code === 410) {
          await disablePushSubscriptionByEndpoint(s.endpoint);
        } else {
          console.warn('[proactive] push send failed', code, err.message);
        }
      }
    }
    await logProactive({ userId, kind: 'proactive', title: msg.title, body: msg.body, reason: msg.reason, delivered });
    if (delivered) report.sent += 1; else report.failed += 1;
  }
  return report;
}

let intervalHandle = null;
function start(webpush) {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runOnce({ webpush }).catch((err) => console.error('[proactive] tick error', err.message));
  }, TICK_MS);
  if (intervalHandle.unref) intervalHandle.unref();
  console.log(`[proactive] scheduler started — tick every ${Math.round(TICK_MS / 60000)}m, gap ${Math.round(MIN_GAP_MS / 3600000)}h, quiet ${QUIET_START_LOCAL}-${QUIET_END_LOCAL} LOCAL`);
}
function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { runOnce, start, stop, pickMemoryForUser, composeMessage, withinQuietHours, estimateUtcOffsetFromLng };
