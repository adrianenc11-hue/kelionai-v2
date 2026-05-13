#!/usr/bin/env node
'use strict';

const https = require('https');
const http = require('http');
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

const checks = [];

async function checkOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { name: 'OpenRouter API Key', ok: false, error: 'Not set' };
  const r = await fetchJson('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': `Bearer ${key}` } });
  return { name: 'OpenRouter API Key', ok: r.ok, status: r.status, error: r.ok ? null : 'Invalid key or rate limit' };
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

async function checkGithubToken() {
  const key = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN;
  if (!key) return { name: 'GitHub Token', ok: false, error: 'Not set (GITHUB_TOKEN or AGENT_GITHUB_TOKEN)' };
  const r = await fetchJson('https://api.github.com/user', { headers: { 'Authorization': `token ${key}`, 'User-Agent': 'KelionAgent' } });
  return { name: 'GitHub Token', ok: r.ok, status: r.status, error: r.ok ? null : 'Invalid token' };
}

async function checkGoogleSearch() {
  const key = process.env.AGENT_GOOGLE_API_KEY || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const cx = process.env.AGENT_GOOGLE_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!key || !cx) return { name: 'Google Search (Agent)', ok: false, error: 'AGENT_GOOGLE_API_KEY + AGENT_GOOGLE_CX (or GOOGLE_CUSTOM_SEARCH_API_KEY + CX) not both set' };
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=test&num=1`;
  const r = await fetchJson(url);
  return { name: 'Google Search (Agent)', ok: r.ok, status: r.status, error: r.ok ? null : 'Invalid key/CX or quota exceeded' };
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
    value: enabled || 'not set',
    error: enabled === '1' ? null : 'Must be set to "1" for /api/agent/* routes',
  };
}

async function checkDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  return {
    name: 'DATABASE_URL (Postgres)',
    ok: !!url,
    value: url ? 'set' : 'not set',
    note: url ? 'Using Postgres/Superbase' : 'Using local SQLite (data wipes on redeploy unless volume mounted)',
  };
}

async function checkSessionSecrets() {
  const sess = process.env.SESSION_SECRET;
  const jwt = process.env.JWT_SECRET;
  return {
    name: 'Secrets',
    ok: !!(sess && jwt),
    session: sess ? 'set' : 'missing — will regenerate random on restart',
    jwt: jwt ? 'set' : 'missing — will regenerate random on restart',
  };
}

async function runAll() {
  console.log('\n=== KELION ENVIRONMENT AUDIT ===\n');
  const results = await Promise.all([
    checkOpenRouter(),
    checkElevenLabs(),
    checkStripe(),
    checkGithubToken(),
    checkGoogleSearch(),
    checkRailwayToken(),
    checkSentry(),
    checkAgentEnabled(),
    checkDatabaseUrl(),
    checkSessionSecrets(),
  ]);

  let fail = 0;
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
    if (r.status) console.log(`   Status: ${r.status}`);
    if (r.value) console.log(`   Value: ${r.value}`);
    if (r.backend) console.log(`   Backend: ${r.backend} | Frontend: ${r.frontend}`);
    if (r.session) console.log(`   SESSION_SECRET: ${r.session} | JWT_SECRET: ${r.jwt}`);
    if (r.note) console.log(`   Note: ${r.note}`);
    if (r.error) { console.log(`   ⚠️  ${r.error}`); fail++; }
    console.log('');
  }

  console.log(`=== RESULT: ${results.length - fail}/${results.length} OK ===`);
  if (fail > 0) {
    console.log('\nFix: set missing vars in Railway dashboard → Variables tab, then redeploy.');
  } else {
    console.log('\nAll environment variables are configured correctly.');
  }
  process.exit(fail > 0 ? 1 : 0);
}

runAll();
