'use strict';

// Stage 4 — tool executors for Kelion's function-calling.
// These endpoints are hit by the CLIENT after Gemini Live emits a toolCall
// message, so the tool runs inside our trust boundary (not client-side).
// Each endpoint returns { ok: true, result: <string> } on success, or
// { ok: false, error: <string>, unavailable?: true } when a provider isn't
// configured so Gemini can gracefully tell the user what's missing.

const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { executeRealTool, REAL_TOOL_NAMES } = require('../services/realTools');
const { logAction } = require('../db');
const { summarizeResultForHistory } = require('../services/actionHistorySummarizer');

const router = Router();

// Soft auth — most tool calls are allowed for guests, but MCP calls
// that access a user's account only work when signed in.
//
// Mirrors the Postgres-only "numeric sub" guard from PR #61. A stale
// pre-Postgres JWT (passkey credential-hash / UUID in `sub`) would
// otherwise reach DB queries with BIGINT columns and crash with
// `invalid input syntax for type bigint`. Treating those cookies as
// absent here is equivalent to the user being signed out (exactly what
// they need to do to get a fresh numeric-sub token anyway).
async function peekUser(req) {
  try {
    const token = req.cookies?.['kelion.token'];
    if (!token) return null;
    const decoded = jwt.verify(token, config.jwt.secret);
    if (process.env.DATABASE_URL) {
      const sub = decoded.sub;
      const numeric = Number.parseInt(sub, 10);
      if (!Number.isFinite(numeric) || String(numeric) !== String(sub)) {
        return null;
      }
      return { id: numeric, name: decoded.name, email: decoded.email };
    }
    return { id: decoded.sub, name: decoded.name, email: decoded.email };
  } catch { return null; }
}

// Tiny per-IP rate cap so a runaway session cannot burn budget.
// Max bucket size guards against unbounded growth from one-shot IPs that
// never return (Devin Review ANALYSIS pr-review-182448fc_0002); combined
// with the periodic sweep below that drops buckets with no live entries.
const BUCKET_MAX_ENTRIES = 10_000;
const BUCKET_SWEEP_MS    = 15 * 60 * 1000;
const bucket = new Map(); // key -> [t1, t2, ...]
function rateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (bucket.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  bucket.set(key, arr);
  // Hard cap: if we somehow passed the size guard, evict the oldest half.
  if (bucket.size > BUCKET_MAX_ENTRIES) {
    const victims = Math.floor(BUCKET_MAX_ENTRIES / 2);
    let i = 0;
    for (const k of bucket.keys()) {
      if (i++ >= victims) break;
      bucket.delete(k);
    }
  }
  return true;
}
// Periodically sweep entries whose newest timestamp is older than the
// widest window any caller uses (1h). Disabled under NODE_ENV=test so
// Jest does not hang on an open timer.
if (process.env.NODE_ENV !== 'test') {
  const sweep = setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [k, arr] of bucket) {
      if (!arr.length || arr[arr.length - 1] < cutoff) bucket.delete(k);
    }
  }, BUCKET_SWEEP_MS);
  if (sweep.unref) sweep.unref();
}

// ─── browse_web (M19) ─────────────────────────────────────────────
// Proxies to Browser Use Cloud (https://docs.cloud.browser-use.com).
// Sync-style call: we poll the task until completion or timeout.
// If BROWSER_USE_API_KEY is missing, return a clean "unavailable" so
// Kelion tells the user "I can't browse the web yet, the agent isn't
// connected" instead of silently failing.
router.post('/browser/browse', async (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateOk(`browse:${ip}`, 20, 60 * 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'Too many browse tasks in the last hour.' });
  }

  const apiKey = process.env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      unavailable: true,
      error: 'The web browsing agent is not connected yet (no BROWSER_USE_API_KEY on the server).',
    });
  }

  const { task, start_url } = req.body || {};
  if (typeof task !== 'string' || task.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'Missing or empty task.' });
  }

  const maxSteps = Math.min(Number(process.env.BROWSER_USE_MAX_STEPS) || 25, 50);
  const base = process.env.BROWSER_USE_API_BASE || 'https://api.browser-use.com';
  try {
    // Create a session (v3 API)
    const createResp = await fetch(`${base}/api/v3/sessions`, {
      method: 'POST',
      headers: { 'X-Browser-Use-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: start_url ? `${task}\n\nStart at: ${start_url}` : task,
      }),
    });
    if (!createResp.ok) {
      const txt = await createResp.text().catch(() => '');
      console.error('[tools/browse] create failed', createResp.status, txt);
      return res.status(502).json({ ok: false, error: 'The web-browsing agent is not reachable right now.' });
    }
    const session = await createResp.json();
    const sessionId = session.id;
    if (!sessionId) {
      return res.status(502).json({ ok: false, error: 'Web-browsing agent returned no session id.' });
    }

    // Poll until completion or timeout (~90s)
    const deadline = Date.now() + 90_000;
    let finalStatus = null;
    let result = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      const st = await fetch(`${base}/api/v3/sessions/${sessionId}`, {
        headers: { 'X-Browser-Use-API-Key': apiKey },
      });
      if (!st.ok) continue;
      const j = await st.json();
      if (['completed', 'finished', 'failed', 'stopped', 'error'].includes(j.status)) {
        finalStatus = j.status;
        result = j;
        break;
      }
    }
    if (!finalStatus) {
      return res.status(200).json({ ok: false, error: 'The web task took too long, I gave up waiting.' });
    }
    if (finalStatus === 'failed' || finalStatus === 'error' || finalStatus === 'stopped') {
      return res.status(200).json({ ok: false, error: `Task ${finalStatus}: ${result?.lastStepSummary || result?.output || 'no details'}.` });
    }
    return res.json({
      ok: true,
      result: String(result?.output || result?.lastStepSummary || 'Done, but the agent returned no summary.').slice(0, 4000),
      live_url: result?.liveUrl || null,
    });
  } catch (err) {
    console.error('[tools/browse] error', err.message);
    return res.status(502).json({ ok: false, error: 'The web-browsing agent failed.' });
  }
});

// ─── MCP — Google Calendar / Gmail / Drive ─────────────────────────
// Uses per-user OAuth tokens stored in DB. When a user hasn't connected
// Google yet, we return a connect URL they can visit.
const googleMcp = require('../services/googleMcp');

router.post('/mcp/calendar', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only read your calendar when you're signed in." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json({ ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' });
  
  const connected = await googleMcp.hasGoogleConnection(user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(user.id);
    return res.status(200).json({ ok: false, error: `Your Google account is not connected yet. Visit this link to connect: ${url}`, connectUrl: url });
  }
  
  try {
    const { maxResults, timeMin, timeMax } = req.body || {};
    const result = await googleMcp.listCalendarEvents(user.id, { maxResults, timeMin, timeMax });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[mcp/calendar]', err.message);
    return res.status(200).json({ ok: false, error: 'Failed to fetch calendar events.' });
  }
});

router.post('/mcp/email', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only read your email when you're signed in." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json({ ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' });
  
  const connected = await googleMcp.hasGoogleConnection(user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(user.id);
    return res.status(200).json({ ok: false, error: `Your Google account is not connected yet. Visit this link to connect: ${url}`, connectUrl: url });
  }
  
  try {
    const { maxResults, query } = req.body || {};
    const result = await googleMcp.listEmails(user.id, { maxResults, query });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[mcp/email]', err.message);
    return res.status(200).json({ ok: false, error: 'Failed to fetch emails.' });
  }
});

router.post('/mcp/files', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only search your files when you're signed in." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json({ ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' });
  
  const connected = await googleMcp.hasGoogleConnection(user.id);
  if (!connected) {
    const url = googleMcp.getConnectUrl(user.id);
    return res.status(200).json({ ok: false, error: `Your Google account is not connected yet. Visit this link to connect: ${url}`, connectUrl: url });
  }
  
  try {
    const { maxResults, query } = req.body || {};
    const result = await googleMcp.listDriveFiles(user.id, { maxResults, query });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[mcp/files]', err.message);
    return res.status(200).json({ ok: false, error: 'Failed to fetch files.' });
  }
});

// ─── Temp file upload ─────────────────────────────────────────────
router.post('/upload_temp', (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateOk(`upload:${ip}`, 50, 60_000)) {
    return res.status(429).json({ ok: false, error: 'Too many uploads.' });
  }
  const id = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2);
  const { storeTempFile } = require('../services/realTools');
  const mimeType = req.headers['content-type'] || 'application/octet-stream';
  storeTempFile(id, req.body, mimeType);
  res.json({ id });
});

// ─── Real-tool proxy (shared server-side executor) ────────────────
// Voice sessions (Gemini Live) emit tool calls on the
// client; src/lib/kelionTools.js runTool() proxies unknown names here so
// they run inside our trust boundary with the same executor the text
// chat route already uses. Rate-limited per IP to stop a runaway session
// from burning free-tier quotas on Open-Meteo / Nominatim / etc.
router.post('/execute', async (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateOk(`real:${ip}`, 120, 60_000)) {
    return res.status(429).json({ ok: false, error: 'Slow down — too many tool calls in the last minute.' });
  }
  const name = typeof req.body?.name === 'string' ? req.body.name : '';
  const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
  if (!name) return res.status(400).json({ ok: false, error: 'missing tool name' });
  if (!REAL_TOOL_NAMES.includes(name)) {
    return res.status(200).json({ ok: false, unavailable: true, error: `Tool "${name}" is not available on this build.` });
  }
  try {
    // PR C adds user-intern tools (`get_my_credits`, `get_my_usage`,
    // `get_my_profile`) that need the caller identity. They return a
    // "sign in first" message when the ctx is absent, so this peek
    // never fails the request — it only enriches it.
    const user = await peekUser(req);
    const ctx = user ? { user } : undefined;
    const startedAt = Date.now();
    const result = await executeRealTool(name, args, ctx);
    const durationMs = Date.now() - startedAt;
    if (result == null) {
      return res.status(200).json({ ok: false, unavailable: true, error: `Tool "${name}" has no executor.` });
    }
    // PR #8/N — Memory of Actions. Record the tool call for signed-in
    // users so Kelion's `get_action_history` can answer "did you
    // already do X?" without re-running the tool. The summarizer only
    // sees the OUTPUT; args sanitisation lives inside logAction().
    // Writes are best-effort and the helper already swallows errors —
    // but we also await a fire-and-forget wrapper here so an unexpected
    // synchronous throw can never bubble up and 500 the live request.
    if (user?.id) {
      const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : null;
      const resultSummary = summarizeResultForHistory(name, result);
      Promise.resolve()
        .then(() => logAction({
          userId: user.id,
          sessionId,
          toolName: name,
          args,
          resultSummary,
          ok: result?.ok !== false,
          durationMs,
        }))
        .catch(() => { /* logAction already logs internally when NODE_ENV != 'test' */ });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('[tools/execute]', name, err?.message);
    return res.status(200).json({ ok: false, error: 'Tool execution failed.' });
  }
});

// Introspection — which tools are actually usable on this instance.
// The frontend surfaces this in transcript meta / debug overlay.
router.get('/status', (_req, res) => {
  res.json({
    google_search: true, // built into Gemini Live, always on
    browse_web: !!process.env.BROWSER_USE_API_KEY,
    mcp: {
      calendar: !!process.env.MCP_ENABLED,
      email: !!process.env.MCP_ENABLED,
      files: !!process.env.MCP_ENABLED,
    },
  });
});

module.exports = router;
