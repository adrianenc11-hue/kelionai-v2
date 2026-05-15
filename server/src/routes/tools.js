'use strict';

// Stage 4 — tool executors for Kelion's function-calling.
// These endpoints are hit by the CLIENT after the model emits a toolCall
// message, so the tool runs inside our trust boundary (not client-side).
// Each endpoint returns { ok: true, result: <string> } on success, or
// { ok: false, error: <string>, unavailable?: true } when a provider isn't
// configured so the model can gracefully tell the user what's missing.

const { Router } = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { executeRealTool, REAL_TOOL_NAMES, ADMIN_ONLY_TOOLS } = require('../services/realTools');
const { isAdminUser } = require('../middleware/optionalAuth');
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
// Proxies to Jina AI (for fetching/searching) + OpenRouter (for reasoning)
// Completely free, bypassing the paid Browser Use Cloud limits.
router.post('/browser/browse', async (req, res) => {
  const ip = req.ip || 'anon';
  if (!rateOk(`browse:${ip}`, 20, 60 * 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'Too many browse tasks in the last hour.' });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return res.status(200).json({
      ok: false,
      unavailable: true,
      error: 'The web browsing agent is not connected yet (no OPENROUTER_API_KEY on the server).',
    });
  }

  const { task, start_url } = req.body || {};
  if (typeof task !== 'string' || task.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'Missing or empty task.' });
  }

  try {
    let markdownContext = '';
    let usedUrl = start_url;
    
    // Fetch content via Jina AI
    if (start_url) {
      const fetchReq = await fetch(`https://r.jina.ai/${encodeURIComponent(start_url)}`);
      markdownContext = await fetchReq.text();
    } else {
      // If no start URL, use Jina Search
      const fetchReq = await fetch(`https://s.jina.ai/${encodeURIComponent(task)}`);
      markdownContext = await fetchReq.text();
      usedUrl = 'Search Results';
    }

    if (!markdownContext || markdownContext.trim() === '') {
      return res.status(200).json({ ok: false, error: 'Could not fetch content for the requested task/URL.' });
    }

    // Truncate to ~30k chars to avoid token limits
    markdownContext = markdownContext.slice(0, 30000);

    // Call OpenRouter
    const orReq = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.google.chatModel,
        messages: [
          {
            role: 'system',
            content: "You are an AI browsing agent. You have been given the markdown content of a webpage or search results. Your job is to read this content and complete the user's task. Output ONLY the answer/summary required by the task, clearly and concisely."
          },
          {
            role: 'user',
            content: `Task: ${task}\n\nURL Context: ${usedUrl}\n\nWebpage Content:\n${markdownContext}`
          }
        ]
      })
    });

    if (!orReq.ok) {
      console.error('[tools/browse] OpenRouter error:', orReq.status, await orReq.text());
      return res.status(200).json({ ok: false, error: 'OpenRouter processing failed.' });
    }

    const orRes = await orReq.json();
    const resultText = orRes.choices?.[0]?.message?.content || 'No output generated.';

    return res.json({
      ok: true,
      result: resultText,
      live_url: usedUrl || null,
    });
  } catch (err) {
    console.error('[tools/browse] error', err.message);
    return res.status(200).json({ ok: false, error: 'The web-browsing agent failed.' });
  }
});

// ─── MCP — Google Calendar / Gmail / Drive ─────────────────────────
// Uses per-user OAuth tokens stored in DB. When a user hasn't connected
// Google yet, we return a connect URL they can visit.
const googleMcp = require('../services/googleMcp');

router.get('/mcp/connect', async (req, res) => {
  const user = await peekUser(req);
  if (!user) return res.status(401).send('Not signed in');
  const { url, nonce } = googleMcp.getConnectUrl(user.id);
  // Security audit 2026-05-11 (C2): store the CSRF nonce in an httpOnly
  // cookie so the callback can validate that the OAuth redirect came from
  // the same browser session that initiated it.
  res.cookie('kelion.mcp_state', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 min — plenty for the OAuth round-trip
    path: '/',
  });
  res.redirect(url);
});

router.post('/mcp/calendar', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only read your calendar when you're signed in." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json({ ok: false, unavailable: true, error: 'MCP integrations are not enabled on this server.' });
  
  const connected = await googleMcp.hasGoogleConnection(user.id);
  if (!connected) {
    const { url } = googleMcp.getConnectUrl(user.id);
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
    const { url } = googleMcp.getConnectUrl(user.id);
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
    const { url } = googleMcp.getConnectUrl(user.id);
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
// Voice sessions emit tool calls on the
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
    // Security: a subset of REAL_TOOL_NAMES executes shell commands,
    // writes to the filesystem, mutates the repo, or hits the DB
    // directly. Without this guard ANY visitor that holds the public
    // CSRF cookie can POST {name: 'run_terminal_command', args: {...}}
    // and turn the server into a shell-as-a-service. Admin-gate the
    // dangerous subset; everything else (weather/maps/wiki/...) stays
    // open so guests still have a useful assistant.
    if (ADMIN_ONLY_TOOLS.has(name)) {
      // Pass `req` to isAdminUser so it can re-decode the JWT and read
      // the `role` claim — tools.js's local peekUser only keeps id/name/
      // email, so role-based admins would otherwise be missed (email
      // allowlist would still catch the primary admin but not custom
      // role grants).
      const admin = await isAdminUser(req);
      if (!admin) {
        return res.status(403).json({
          ok: false,
          error: `Tool "${name}" is admin-only on this deployment.`,
        });
      }
    }
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
    google_search: true, // built into the model, always on
    browse_web: true, // Uses Jina AI (free, no key required)
    mcp: {
      calendar: !!process.env.MCP_ENABLED,
      email: !!process.env.MCP_ENABLED,
      files: !!process.env.MCP_ENABLED,
    },
  });
});

// ─── SSE Streaming Terminal ───────────────────────────────────────
// Streams terminal output line-by-line via Server-Sent Events so the
// client monitor shows real-time output as it happens ("viteza luminii").
// Uses spawn (unbuffered) instead of exec (buffered).
const { spawn } = require('child_process');
const _path = require('path');
const TOOLS_REPO_ROOT = _path.resolve(__dirname, '../../../');

router.post('/terminal-stream', async (req, res) => {
  const user = await peekUser(req);
  // Same RCE concern as /execute above — spawn()'s a /bin/sh on the
  // server with whatever the request supplies. Admin-only.
  const admin = await isAdminUser(req);
  if (!admin) {
    return res.status(403).json({ ok: false, error: 'Admin-only endpoint.' });
  }
  const ip = req.ip || 'anon';
  if (!rateOk(`stream:${ip}`, 30, 60_000)) {
    return res.status(429).json({ ok: false, error: 'Too many streaming commands.' });
  }

  const cmd = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
  if (!cmd) return res.status(400).json({ ok: false, error: 'No command' });
  if (cmd.includes('rm -rf /') || cmd.includes('mkfs')) {
    return res.status(403).json({ ok: false, error: 'Blocked.' });
  }

  let cwd = TOOLS_REPO_ROOT;
  if (req.body?.cwd) {
    cwd = _path.resolve(TOOLS_REPO_ROOT, req.body.cwd);
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const isWin = process.platform === 'win32';
  const shell = isWin ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWin ? ['/c', cmd] : ['-c', cmd];

  const child = spawn(shell, shellArgs, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });

  let killed = false;
  let ended = false;
  const killTimer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
  }, 120000);

  const sendEvent = (type, data) => {
    if (ended) return;
    try { res.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch {}
  };

  sendEvent('start', { cmd, cwd, pid: child.pid });

  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.length > 0) sendEvent('stdout', line);
    }
  });

  child.stderr.on('data', (chunk) => {
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.length > 0) sendEvent('stderr', line);
    }
  });

  const endStream = () => {
    if (ended) return;
    ended = true;
    clearTimeout(killTimer);
    res.write('data: [DONE]\n\n');
    res.end();
  };

  child.on('close', (code) => {
    sendEvent('exit', { code, killed });
    endStream();
  });

  child.on('error', (err) => {
    sendEvent('error', err.message);
    endStream();
  });

  req.on('close', () => {
    clearTimeout(killTimer);
    if (!child.killed) child.kill();
  });
});

module.exports = router;
