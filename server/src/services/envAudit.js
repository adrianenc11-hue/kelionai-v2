#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function fetchJson(url, opts = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 300, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: res.statusCode < 300, status: res.statusCode, data }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function checkOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { name: 'OpenRouter API Key', ok: false, requiredForAutonomy: true, error: 'Not set' };
  const r = await fetchJson('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
  return { name: 'OpenRouter API Key', ok: r.ok, requiredForAutonomy: true, status: r.status, error: r.ok ? null : 'Invalid key or rate limit' };
}

async function checkElevenLabs() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { name: 'ElevenLabs API Key', ok: false, error: 'Not set' };
  const r = await fetchJson('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  return { name: 'ElevenLabs API Key', ok: r.ok, status: r.status, error: r.ok ? null : 'Invalid key' };
}

async function checkStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { name: 'Stripe Secret Key', ok: false, error: 'Not set' };
  const r = await fetchJson('https://api.stripe.com/v1/products', { headers: { 'Authorization': `Bearer ${key}` } });
  return { name: 'Stripe Secret Key', ok: r.ok, status: r.status, error: r.ok ? null : 'Invalid key' };
}

async function checkStripeWebhook() {
  const sec = process.env.STRIPE_WEBHOOK_SECRET;
  return {
    name: 'Stripe Webhook Secret',
    ok: !!sec,
    value: sec ? 'set' : 'not set',
    error: sec ? null : 'Without STRIPE_WEBHOOK_SECRET, POST /api/credits/webhook returns 503 and no real top-up ever lands in credit_ledger',
  };
}

async function checkGithubToken() {
  const key = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!key) return { name: 'GitHub Token', ok: false, requiredForAutonomy: true, error: 'Not set (GITHUB_TOKEN, AGENT_GITHUB_TOKEN, or GH_TOKEN)' };
  const r = await fetchJson('https://api.github.com/user', { headers: { 'Authorization': `token ${key}`, 'User-Agent': 'KelionAgent' } });
  return { name: 'GitHub Token', ok: r.ok, requiredForAutonomy: true, status: r.status, error: r.ok ? null : 'Invalid token' };
}

async function checkGoogleAiStudio() {
  const keys = (process.env.GOOGLE_API_KEYS || process.env.GOOGLE_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (!keys.length) {
    return { name: 'Google AI Studio Keys', ok: false, requiredForAutonomy: true, error: 'Not set (GOOGLE_API_KEY or GOOGLE_API_KEYS)' };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(keys[0])}`;
  const r = await fetchJson(url);
  return {
    name: 'Google AI Studio Keys',
    ok: r.ok,
    requiredForAutonomy: true,
    status: r.status,
    value: `${keys.length} key(s) configured`,
    error: r.ok ? null : 'Invalid Google AI key or quota/API access problem',
  };
}

async function checkGoogleSearch() {
  const key = process.env.AGENT_GOOGLE_API_KEY || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const cx = process.env.AGENT_GOOGLE_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!key || !cx) return { name: 'Google Search (Agent)', ok: false, requiredForAutonomy: true, error: 'AGENT_GOOGLE_API_KEY + AGENT_GOOGLE_CX (or GOOGLE_CUSTOM_SEARCH_API_KEY + CX) not both set' };
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=test&num=1`;
  const r = await fetchJson(url);
  return { name: 'Google Search (Agent)', ok: r.ok, requiredForAutonomy: true, status: r.status, error: r.ok ? null : 'Invalid key/CX or quota exceeded' };
}

async function checkRailwayToken() {
  const key = process.env.AGENT_RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
  if (!key) return { name: 'Railway Token', ok: false, error: 'Not set (AGENT_RAILWAY_TOKEN or RAILWAY_API_TOKEN)' };
  const r = await fetchJson('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ me { id } }' }),
  });
  return { name: 'Railway Token', ok: r.ok && !r.error, status: r.status, error: (r.ok && !r.error) ? null : 'Invalid token or GraphQL error' };
}

async function checkSentry() {
  const dsn = process.env.SENTRY_DSN;
  const viteDsn = process.env.VITE_SENTRY_DSN;
  return {
    name: 'Sentry DSN',
    ok: !!(dsn || viteDsn),
    backend: dsn ? 'set' : 'missing',
    frontend: viteDsn ? 'set' : 'missing',
    error: (dsn || viteDsn) ? null : 'Both SENTRY_DSN and VITE_SENTRY_DSN missing',
  };
}

async function checkAgentEnabled() {
  const enabled = process.env.AGENT_ENABLED;
  return {
    name: 'AGENT_ENABLED',
    ok: enabled === '1',
    requiredForAutonomy: true,
    value: enabled || 'not set',
    error: enabled === '1' ? null : 'Must be set to "1" for /api/agent/* routes',
  };
}

async function checkAgentShellCwd() {
  const raw = process.env.AGENT_SHELL_CWD;
  const resolved = raw ? path.resolve(raw) : process.cwd();
  const exists = fs.existsSync(resolved);
  const hasPackage = exists && fs.existsSync(path.join(resolved, 'package.json'));
  return {
    name: 'AGENT_SHELL_CWD',
    ok: !!raw && exists && hasPackage,
    requiredForAutonomy: true,
    value: raw ? resolved : 'not set',
    error: !raw
      ? 'Must be set explicitly to the repo root before AGENT_ENABLED=1'
      : (!exists ? 'Path does not exist' : (!hasPackage ? 'Path does not look like the repo root' : null)),
  };
}

async function checkMasterBranchProtection() {
  const key = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN || process.env.GH_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER || 'adrianenc11-hue';
  const repo = process.env.GITHUB_REPO_NAME || 'kelionai-v2';
  if (!key) {
    return { name: 'Master Branch Protection', ok: false, requiredForAutonomy: true, error: 'Cannot verify without a GitHub token' };
  }
  const r = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/branches/master/protection`, {
    headers: {
      'Authorization': `token ${key}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'KelionAgent',
    },
  });
  const data = r.data || {};
  const hasPrGate = !!data.required_pull_request_reviews || !!data.required_status_checks;
  return {
    name: 'Master Branch Protection',
    ok: r.ok && hasPrGate,
    requiredForAutonomy: true,
    status: r.status,
    error: r.ok
      ? (hasPrGate ? null : 'Protection exists but PR/status gates are not enforced')
      : 'master is not protected, token lacks permission, or repo/branch not found',
  };
}

async function checkDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  return {
    name: 'DATABASE_URL (Postgres)',
    ok: !!url,
    requiredForAutonomy: true,
    value: url ? 'set' : 'not set',
    note: url ? 'Using Postgres/Supabase' : 'Using local SQLite (data wipes on redeploy unless volume mounted)',
  };
}

async function checkSessionSecrets() {
  const sess = process.env.SESSION_SECRET;
  const jwt = process.env.JWT_SECRET;
  return {
    name: 'Secrets',
    ok: !!(sess && jwt),
    requiredForAutonomy: true,
    error: (sess && jwt) ? null : 'SESSION_SECRET and JWT_SECRET must both be set',
    session: sess ? 'set' : 'missing — random on restart',
    jwt: jwt ? 'set' : 'missing — random on restart',
  };
}

async function runEnvAudit() {
  const results = await Promise.all([
    checkOpenRouter(),
    checkGoogleAiStudio(),
    checkElevenLabs(),
    checkStripe(),
    checkStripeWebhook(),
    checkGithubToken(),
    checkGoogleSearch(),
    checkRailwayToken(),
    checkSentry(),
    checkAgentEnabled(),
    checkAgentShellCwd(),
    checkMasterBranchProtection(),
    checkDatabaseUrl(),
    checkSessionSecrets(),
  ]);
  const fail = results.filter(r => !r.ok).length;
  const autonomyRequired = results.filter(r => r.requiredForAutonomy);
  const autonomyBlockers = autonomyRequired.filter(r => !r.ok);
  return {
    results,
    allOk: fail === 0,
    fail,
    total: results.length,
    autonomy: {
      ready: autonomyBlockers.length === 0,
      fail: autonomyBlockers.length,
      total: autonomyRequired.length,
      blockers: autonomyBlockers.map(r => ({ name: r.name, error: r.error || r.note || 'not ready' })),
    },
  };
}

module.exports = { runEnvAudit };
