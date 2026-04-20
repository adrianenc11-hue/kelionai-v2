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
  const base = process.env.BROWSER_USE_API_BASE || 'https://api.cloud.browser-use.com';
  try {
    // Kick off the task
    const createResp = await fetch(`${base}/api/v1/run-task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: start_url ? `${task}\n\nStart at: ${start_url}` : task,
        max_steps: maxSteps,
        use_adblock: true,
        use_proxy: false,
      }),
    });
    if (!createResp.ok) {
      const txt = await createResp.text().catch(() => '');
      console.error('[tools/browse] create failed', createResp.status, txt);
      return res.status(502).json({ ok: false, error: 'The web-browsing agent is not reachable right now.' });
    }
    const { id: taskId } = await createResp.json();
    if (!taskId) {
      return res.status(502).json({ ok: false, error: 'Web-browsing agent returned no task id.' });
    }

    // Poll until completion or timeout (~90s)
    const deadline = Date.now() + 90_000;
    let finalStatus = null;
    let result = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const st = await fetch(`${base}/api/v1/task/${taskId}/status`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!st.ok) continue;
      const j = await st.json();
      if (['finished', 'failed', 'stopped'].includes(j.status)) {
        finalStatus = j.status;
        result = j;
        break;
      }
    }
    if (!finalStatus) {
      return res.status(200).json({ ok: false, error: 'The web task took too long, I gave up waiting.' });
    }
    if (finalStatus !== 'finished') {
      return res.status(200).json({ ok: false, error: `Task ${finalStatus}: ${result?.last_message || 'no details'}.` });
    }
    return res.json({
      ok: true,
      result: String(result?.output || result?.last_message || 'Done, but the agent returned no summary.').slice(0, 4000),
      live_url: result?.live_url || null,
    });
  } catch (err) {
    console.error('[tools/browse] error', err.message);
    return res.status(502).json({ ok: false, error: 'The web-browsing agent failed.' });
  }
});

// ─── MCP skeleton (M21) ───────────────────────────────────────────
// These are STUBS for now. When the user connects a calendar/email/files
// provider (Google, Microsoft, Apple) via MCP, the integration module writes
// a per-user MCP client config in the DB and these endpoints route through it.
// Until then, we return "not connected" so Kelion tells the user the truth.
function mcpUnavailable(kind) {
  return {
    ok: false,
    unavailable: true,
    error: `I can see ${kind} once you connect it. Ask Adrian to enable MCP integrations and you'll get a prompt to link your account.`,
  };
}

router.post('/mcp/calendar', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only read your calendar when you're signed in with a passkey." });
  }
  // TODO(Stage 4+): look up user's MCP config and forward to the
  // calendar MCP server. For now, skeleton.
  if (!process.env.MCP_ENABLED) return res.status(200).json(mcpUnavailable('your calendar'));
  return res.status(200).json({ ok: false, error: 'MCP calendar not configured yet.' });
});

router.post('/mcp/email', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only read your email when you're signed in with a passkey." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json(mcpUnavailable('your email'));
  return res.status(200).json({ ok: false, error: 'MCP email not configured yet.' });
});

router.post('/mcp/files', async (req, res) => {
  const user = await peekUser(req);
  if (!user) {
    return res.status(200).json({ ok: false, error: "I can only search your files when you're signed in with a passkey." });
  }
  if (!process.env.MCP_ENABLED) return res.status(200).json(mcpUnavailable('your files'));
  return res.status(200).json({ ok: false, error: 'MCP files not configured yet.' });
});

// ─── deep_think (M29) ─────────────────────────────────────────────
// Router tool: Flash Live is optimized for voice latency, not deep
// reasoning. When the user asks something that needs real thinking
// (analysis, planning, multi-step explanation, structured comparison,
// fact-heavy "what happened / what is true" questions), Flash calls
// this tool with the full question. We run it through Gemini 3.1 Pro
// + Google Search grounding via the generateContent API — a SEPARATE
// HTTP call that never touches the Live WebSocket — and return the
// answer as plain text. Flash then narrates it to the user in his
// own voice. No voice overlap, no streaming, no risk to barge-in.
//
// If GEMINI_API_KEY is missing or Pro returns an error we respond
// with a plain-English unavailable message so Flash can gracefully
// tell the user it couldn't reason deeply right now, rather than
// crashing the session.
router.post('/deep-think', async (req, res) => {
  const ip = req.ip || 'anon';
  // 30 Pro calls / hour / IP is generous for a voice session while
  // still capping runaway loops that could burn budget. Adjust if
  // real usage shows it's too tight.
  if (!rateOk(`deep_think:${ip}`, 30, 60 * 60 * 1000)) {
    return res.status(429).json({ ok: false, error: 'Too many deep-think requests in the last hour.' });
  }

  const apiKey = process.env.GEMINI_API_KEY_ADMIN || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      unavailable: true,
      error: 'Deeper thinking is not available right now (no Gemini API key configured).',
    });
  }

  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (question.length < 3) {
    return res.status(400).json({ ok: false, error: 'Missing or empty question.' });
  }
  const context = typeof req.body?.context === 'string' ? req.body.context.slice(0, 4000) : '';

  // Default to the current Pro preview; operators can bump via env when
  // Google ships a newer one. If the chosen model 404s we surface the
  // error so Flash tells the user truthfully ("I couldn't reach my
  // thinking model just now") instead of inventing.
  const model = process.env.GEMINI_DEEP_THINK_MODEL || 'gemini-3.1-pro-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // System instruction keeps Pro's answer VOICE-friendly — Flash will
  // speak this out loud, so no markdown, no bullet lists, no citations
  // inline. Sources are surfaced separately via groundingMetadata.
  const systemText = [
    'You are the deep-reasoning engine behind Kelion, a voice assistant.',
    'Your answer will be spoken out loud by Kelion\'s voice. Keep it natural and conversational.',
    'Rules: no markdown, no bullet points, no numbered lists, no URLs, no citations in the text, no headings.',
    'Be concrete and structured, but write as continuous spoken sentences — 3 to 8 sentences for most questions.',
    'If the question needs fresh facts, use Google Search grounding. Do not mention that you searched.',
    'If you are not confident, say so plainly.',
  ].join(' ');

  const userText = context
    ? `Recent conversation context (for grounding, do not quote):\n${context}\n\nQuestion: ${question}`
    : question;

  try {
    const deadlineMs = 20_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deadlineMs);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          tools: [{ googleSearch: {} }],
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[tools/deep-think] pro call failed', r.status, txt.slice(0, 500));
      return res.status(200).json({
        ok: false,
        error: 'My thinking model could not be reached right now.',
      });
    }

    const j = await r.json();
    const cand = j?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const text = parts.map((p) => p?.text || '').join('').trim();
    if (!text) {
      return res.status(200).json({
        ok: false,
        error: 'I thought about it but got no clear answer.',
      });
    }

    // Collect grounding sources (URIs + titles) if present.
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c) => c?.web ? { title: c.web.title || '', uri: c.web.uri || '' } : null)
      .filter((s) => s && s.uri)
      .slice(0, 8);

    return res.json({
      ok: true,
      result: text.slice(0, 4000),
      sources,
    });
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? 'Thinking took too long, I gave up waiting.'
      : 'My thinking model crashed on that one.';
    console.error('[tools/deep-think] error', err && err.message);
    return res.status(200).json({ ok: false, error: msg });
  }
});

// Introspection — which tools are actually usable on this instance.
// The frontend surfaces this in transcript meta / debug overlay.
router.get('/status', (_req, res) => {
  res.json({
    google_search: true, // built into Gemini Live, always on
    browse_web: !!process.env.BROWSER_USE_API_KEY,
    deep_think: !!(process.env.GEMINI_API_KEY_ADMIN || process.env.GEMINI_API_KEY),
    mcp: {
      calendar: !!process.env.MCP_ENABLED,
      email: !!process.env.MCP_ENABLED,
      files: !!process.env.MCP_ENABLED,
    },
  });
});

module.exports = router;
