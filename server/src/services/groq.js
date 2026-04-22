'use strict';

/**
 * Groq inference helper.
 *
 * Thin wrapper around the Groq Chat Completions endpoint used by our
 * code-oriented real tools (solve_problem / code_review / explain_code).
 * We deliberately keep this *separate* from the main chat flow — the chat
 * module must remain untouched (see user directive "modulul de chat trebuie
 * permanent sa ramina asa"). Groq is ONLY reachable through the real-tools
 * path, never as a chat provider.
 *
 * Behavior when `GROQ_API_KEY` is missing on the server:
 *   - We never throw — callers get `{ ok: false, unavailable: true, error }`
 *     so the model can verbalize a graceful "not configured" message.
 *   - No network request is attempted.
 *
 * Free tier notes (https://console.groq.com):
 *   - Qwen2.5-Coder-32B is the current default for coding: SOTA among
 *     free-tier open-weights models on HumanEval / MBPP.
 *   - Llama 3.3 70B Versatile is the fallback for general reasoning.
 *   - Both run at 1000+ tok/s on Groq's LPUs so we can wait synchronously
 *     inside a tool-call window without timing out voice turns.
 */

// Cap Groq usage so a buggy tool-call can't drain the quota or lock the
// voice turn for too long. Voice/text chat expects sub-10s tool results;
// Groq is fast enough that a single prompt rarely exceeds 3s.
const DEFAULT_MODEL = 'qwen/qwen2.5-coder-32b-instruct';
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_PROMPT_CHARS = 8000;
const MAX_OUTPUT_TOKENS = 1500;
const REQUEST_TIMEOUT_MS = 15000;

let nodeFetchPromise = null;
async function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  if (!nodeFetchPromise) {
    nodeFetchPromise = import('node-fetch').then((mod) => mod.default || mod);
  }
  return nodeFetchPromise;
}

function hasApiKey() {
  return typeof process.env.GROQ_API_KEY === 'string' && process.env.GROQ_API_KEY.length > 10;
}

/**
 * Call Groq with a list of messages. Returns a JSON-safe object the tool
 * executor can surface to the model on the next turn.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 */
async function groqChat(messages, opts = {}) {
  if (!hasApiKey()) {
    return {
      ok: false,
      unavailable: true,
      error: 'Groq tools are not configured on this server (GROQ_API_KEY missing). Ask the operator to add the key in Railway to enable advanced coding help.',
    };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages required' };
  }

  // Cap every message so a huge paste can't blow past Groq's 32k context
  // window or run up our free-tier token budget.
  const capped = messages.map((m) => ({
    role: m.role || 'user',
    content: String(m.content ?? '').slice(0, MAX_PROMPT_CHARS),
  }));

  const body = {
    model: opts.model || DEFAULT_MODEL,
    messages: capped,
    // `??` not `||` so a caller explicitly passing 0 doesn't silently
    // fall back to MAX_OUTPUT_TOKENS; the clamp below still keeps us
    // inside Groq's free-tier ceiling regardless of what was passed.
    max_tokens: Math.min(Math.max(opts.maxTokens ?? MAX_OUTPUT_TOKENS, 64), 4000),
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
    stream: false,
  };

  const fetchImpl = await getFetch();
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
      return { ok: false, error: `Groq HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const j = await res.json();
    const choice = j && j.choices && j.choices[0];
    const text = choice && choice.message && choice.message.content;
    if (!text) return { ok: false, error: 'Groq returned empty completion' };
    return {
      ok: true,
      text: String(text),
      model: body.model,
      usage: j.usage || null,
    };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, error: 'Groq request timed out' };
    }
    return { ok: false, error: err && err.message ? err.message : 'Groq request failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  groqChat,
  hasApiKey,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
};
