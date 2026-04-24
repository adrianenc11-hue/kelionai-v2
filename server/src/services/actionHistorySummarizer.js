'use strict';

// PR #8/N — Memory of Actions. Produce a short, speakable summary of a
// tool-execution result for action_history. We intentionally keep this
// module tiny and tool-unaware: the per-tool cleverness already lives
// in src/lib/kelionTools.js#summarizeRealTool (client-side speakable
// render). Here we only need a stable server-side summary that
// Kelion's later `get_action_history` read will surface verbatim.
//
// Rules:
//   • Length capped at 300 chars so the row stays cheap to scan.
//   • On tool failure we surface the error string so "did you already
//     email that?" → "send_email failed: SMTP 550" is informative.
//   • On success we prefer a small set of well-known keys (summary,
//     result, message, text, title, name, url, translated, expression)
//     over a JSON dump — these are what the voice model cares about
//     when deciding whether to re-run.
//   • Arrays are reduced to "N items" so we don't store a 4 KB search
//     result set just to remember a query happened.
//   • Nothing secret-sensitive is recorded — args sanitisation happens
//     in logAction() in db/index.js. This module only sees the tool
//     OUTPUT, which is already safe to persist.

const PREFERRED_KEYS = [
  'summary',      // plan_task
  'translated',   // translate
  'result',       // calculate, solve_problem, code_review, explain_code
  'expression',   // calculate
  'message',      // generic ok/fail
  'text',         // generic
  'title',        // web_search top hit, generate_image
  'name',         // geocode, nearby_places
  'url',          // generate_image, fetch_url
  'address',      // reverse_geocode
  'city',         // get_weather.location
];

function pickScalar(j, key) {
  const v = j?.[key];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function summarizeResultForHistory(toolName, result) {
  if (!result || typeof result !== 'object') {
    return result == null ? null : String(result).slice(0, 300);
  }
  if (result.ok === false) {
    const err = typeof result.error === 'string' ? result.error : 'failed';
    const unavailable = result.unavailable ? ' (unavailable)' : '';
    return `${toolName || 'tool'} failed: ${err}${unavailable}`.slice(0, 300);
  }

  const name = String(toolName || '');
  // Known shapes first — mirror the client summarizer where it helps.
  if (name === 'get_weather' && result.current && result.location?.name) {
    return `${result.location.name}: ${result.current.temperature_2m}°C`.slice(0, 300);
  }
  if (name === 'plan_task' && Array.isArray(result.steps)) {
    const n = result.steps.length;
    const head = result.summary ? ` — ${String(result.summary).slice(0, 120)}` : '';
    return `planned ${n} step${n === 1 ? '' : 's'}${head}`.slice(0, 300);
  }
  if ((name === 'web_search' || name === 'search_academic' ||
       name === 'search_github' || name === 'search_stackoverflow')
       && Array.isArray(result.results)) {
    const n = result.results.length;
    const first = result.results[0]?.title || result.results[0]?.url || '';
    return `${n} result${n === 1 ? '' : 's'}${first ? ` — ${String(first).slice(0, 180)}` : ''}`.slice(0, 300);
  }
  if (name === 'generate_image' && result.url) {
    return `image: ${String(result.url).slice(0, 250)}`.slice(0, 300);
  }
  if (name === 'send_email' && (result.delivered || result.id || result.messageId)) {
    const to = Array.isArray(result.to) ? result.to.join(',') : (result.to || '');
    return `email sent${to ? ` to ${String(to).slice(0, 120)}` : ''}`.slice(0, 300);
  }
  if (name === 'ui_navigate' && result.route) {
    return `navigated to ${String(result.route).slice(0, 120)}`.slice(0, 300);
  }
  if (name === 'ui_notify' && result.text) {
    return `notify: ${String(result.text).slice(0, 240)}`.slice(0, 300);
  }

  // Preferred-keys fallback — pick the first one that exists.
  for (const k of PREFERRED_KEYS) {
    const v = pickScalar(result, k);
    if (v) return v.slice(0, 300);
  }

  // Last-resort fallback — "ok" with a short JSON dump of the keys so
  // the history row carries SOMETHING useful. We cap hard at 300.
  try {
    const keys = Object.keys(result).filter((k) => k !== 'ok').slice(0, 6).join(',');
    return `ok${keys ? ` {${keys}}` : ''}`.slice(0, 300);
  } catch {
    return 'ok';
  }
}

module.exports = { summarizeResultForHistory };
