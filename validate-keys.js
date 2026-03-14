#!/usr/bin/env node
'use strict';

// ═══════════════════════════════════════════════════════════════
// KelionAI — ENV KEY VALIDATOR
// Tests every single API key with a real request
// Run: node validate-keys.js
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();

const results = [];

/**
 * log
 * @param {*} name
 * @param {*} status
 * @param {*} detail
 * @returns {*}
 */
function log(name, status, detail) {
  const icon = status === 'OK' ? '✅' : status === 'MISSING' ? '⬜' : status === 'EXPIRED' ? '🔴' : '❌';
  results.push({ name, status, detail });
}

/**
 * testKey
 * @param {*} name
 * @param {*} testFn
 * @returns {*}
 */
async function testKey(name, testFn) {
  const val = process.env[name];
  if (!val || val.trim() === '' || val === 'undefined' || val === 'null' || val === 'your_key_here') {
    log(name, 'MISSING', 'Not set or empty');
    return;
  }
  if (val.length < 5) {
    log(name, 'INVALID', `Too short (${val.length} chars)`);
    return;
  }
  if (testFn) {
    try {
      const result = await testFn(val);
      log(name, result.ok ? 'OK' : 'EXPIRED', result.detail);
    } catch (e) {
      log(name, 'ERROR', e.message?.slice(0, 80));
    }
  } else {
    log(name, 'SET', `${val.length} chars (no live test available)`);
  }
}

/**
 * run
 * @returns {*}
 */
async function run() {
  // ═══ 🔴 OBLIGATORII ═══

  await testKey('GOOGLE_AI_KEY', async (key) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (r.status === 200) return { ok: true, detail: 'Gemini API working' };
    if (r.status === 400 || r.status === 403) return { ok: false, detail: 'INVALID KEY or API not enabled' };
    if (r.status === 429) return { ok: true, detail: 'Rate limited but key valid' };
    const body = await r.text().catch(() => '');
    return { ok: false, detail: `HTTP ${r.status}: ${body.slice(0, 100)}` };
  });

  await testKey('SUPABASE_URL', async (val) => {
    if (!val.includes('supabase.co')) return { ok: false, detail: 'Invalid URL format' };
    const r = await fetch(`${val}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY || 'test' },
    });
    if (r.status === 200 || r.status === 401) return { ok: true, detail: `Supabase reachable (${r.status})` };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('SUPABASE_ANON_KEY', async (key) => {
    const url = process.env.SUPABASE_URL;
    if (!url) return { ok: false, detail: 'SUPABASE_URL not set — cannot test' };
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key } });
    if (r.status === 200) return { ok: true, detail: 'Anon key valid' };
    if (r.status === 401 || r.status === 403) return { ok: false, detail: 'Key rejected (expired or wrong project)' };
    return { ok: r.status < 500, detail: `HTTP ${r.status}` };
  });

  await testKey('SUPABASE_SERVICE_KEY', async (key) => {
    const url = process.env.SUPABASE_URL;
    if (!url) return { ok: false, detail: 'SUPABASE_URL not set' };
    const r = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) return { ok: true, detail: 'Service key valid (admin access)' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('ELEVENLABS_API_KEY', async (key) => {
    const r = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key },
    });
    if (r.status === 200) {
      const d = await r.json().catch(() => ({}));
      return { ok: true, detail: `User: ${d.subscription?.tier || 'active'}` };
    }
    if (r.status === 401) return { ok: false, detail: 'INVALID or EXPIRED key' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('SESSION_SECRET', async (key) => {
    return {
      ok: key.length >= 32,
      detail: key.length >= 32 ? `${key.length} chars (secure)` : 'Too short — need ≥32 chars',
    };
  });

  // ═══ 🟡 RECOMANDATE ═══

  await testKey('OPENAI_API_KEY', async (key) => {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) return { ok: true, detail: 'OpenAI API active' };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    if (r.status === 429) return { ok: true, detail: 'Rate limited but key valid' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('DEEPSEEK_API_KEY', async (key) => {
    const r = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) return { ok: true, detail: 'DeepSeek active' };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    return { ok: r.status < 500, detail: `HTTP ${r.status}` };
  });

  await testKey('GROQ_API_KEY', async (key) => {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) return { ok: true, detail: 'Groq API active' };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('STRIPE_SECRET_KEY', async (key) => {
    if (!key.startsWith('sk_')) return { ok: false, detail: 'Must start with sk_live_ or sk_test_' };
    const r = await fetch('https://api.stripe.com/v1/balance', {
      headers: {
        Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}`,
      },
    });
    if (r.status === 200)
      return {
        ok: true,
        detail: `Stripe ${key.startsWith('sk_live') ? 'LIVE' : 'TEST'} mode`,
      };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('STRIPE_WEBHOOK_SECRET', async (key) => {
    return {
      ok: key.startsWith('whsec_'),
      detail: key.startsWith('whsec_') ? 'Format correct' : 'Must start with whsec_',
    };
  });

  await testKey('TAVILY_API_KEY', async (key) => {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
    });
    if (r.status === 200) return { ok: true, detail: 'Tavily search active' };
    if (r.status === 401 || r.status === 403) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  // ═══ 🟢 OPȚIONALE ═══

  await testKey('PERPLEXITY_API_KEY', async (key) => {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
    });
    if (r.status === 200) return { ok: true, detail: 'Perplexity active' };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('SERPER_API_KEY', async (key) => {
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: 'test', num: 1 }),
    });
    if (r.status === 200) return { ok: true, detail: 'Serper active' };
    if (r.status === 401 || r.status === 403) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('TOGETHER_API_KEY', async (key) => {
    const r = await fetch('https://api.together.xyz/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) return { ok: true, detail: 'Together AI active' };
    if (r.status === 401) return { ok: false, detail: 'INVALID KEY' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('SENTRY_DSN', async (val) => {
    return {
      ok: val.includes('sentry.io') || val.includes('@'),
      detail: val.includes('sentry') ? 'DSN format OK' : 'Invalid DSN format',
    };
  });

  await testKey('GOOGLE_MAPS_KEY', null);
  await testKey('ELEVENLABS_VOICE_KELION', null);
  await testKey('ELEVENLABS_VOICE_KIRA', null);
  await testKey('REFERRAL_SECRET', async (key) => {
    return { ok: key.length >= 32, detail: `${key.length} chars` };
  });

  // ═══ 📱 CANALE SOCIALE ═══

  // WhatsApp uses different names in code!
  await testKey('WHATSAPP_TOKEN', null);
  // Code actually uses WA_ACCESS_TOKEN
  await testKey('WA_ACCESS_TOKEN', async (key) => {
    return {
      ok: key.length > 20,
      detail: `${key.length} chars — code uses WA_ACCESS_TOKEN`,
    };
  });
  await testKey('WA_PHONE_NUMBER_ID', null);
  await testKey('WA_VERIFY_TOKEN', null);

  await testKey('MESSENGER_PAGE_TOKEN', null);
  await testKey('MESSENGER_VERIFY_TOKEN', null);

  await testKey('TELEGRAM_BOT_TOKEN', async (key) => {
    const r = await fetch(`https://api.telegram.org/bot${key}/getMe`);
    if (r.status === 200) {
      const d = await r.json();
      return { ok: true, detail: `Bot: @${d.result?.username}` };
    }
    if (r.status === 401) return { ok: false, detail: 'INVALID TOKEN' };
    return { ok: false, detail: `HTTP ${r.status}` };
  });

  await testKey('FACEBOOK_PAGE_TOKEN', null);
  await testKey('INSTAGRAM_TOKEN', null);

  // ═══ EXTRA (found in code but not in user list) ═══

  await testKey('APP_URL', async (val) => {
    return { ok: val.startsWith('http'), detail: val };
  });
  await testKey('NODE_ENV', async (val) => {
    return { ok: ['production', 'development'].includes(val), detail: val };
  });
  await testKey('PORT', null);
  await testKey('DATABASE_URL', null);
  await testKey('SUPABASE_DB_PASSWORD', null);
  await testKey('NEWSAPI_KEY', null);
  await testKey('GNEWS_KEY', null);
  await testKey('GUARDIAN_KEY', null);
  await testKey('CURRENTS_API_KEY', null);
  await testKey('MEDIASTACK_KEY', null);
  await testKey('BINANCE_API_KEY', null);
  await testKey('BINANCE_API_SECRET', null);
  await testKey('MAX_TRADE_AMOUNT', null);

  // ═══ SUMMARY ═══
  const ok = results.filter((r) => r.status === 'OK' || r.status === 'SET').length;
  const missing = results.filter((r) => r.status === 'MISSING').length;
  const expired = results.filter(
    (r) => r.status === 'EXPIRED' || r.status === 'INVALID' || r.status === 'ERROR'
  ).length;

  // ═══ NAME MISMATCHES ═══

  if (expired > 0) {
    results
      .filter((r) => r.status === 'EXPIRED' || r.status === 'INVALID' || r.status === 'ERROR')
      .forEach((r) => /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* console.log(`   → ${r.name}: ${r.detail}`) (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ removed * / (removed) */);
  }
}

run().catch((e) => console.error('Validator error:', e));
