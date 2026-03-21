#!/usr/bin/env node
/**
 * KelionAI v3.3 — Setup Wizard
 *
 * Interactive CLI to generate .env configuration.
 * Run: node scripts/setup-wizard.js
 */
'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal = '') {
  const suffix = defaultVal ? ` [${defaultVal}]` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function section(title) {
  console.log(`\n  ═══ ${title} ═══`);
}

async function main() {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║     🧠 KelionAI v3.3 — Setup Wizard      ║
  ║     Self-Hosting Configuration            ║
  ╚═══════════════════════════════════════════╝
  `);

  const env = {};

  // ── Server ──
  section('🖥️  Server');
  env.PORT = await ask('Port', '3000');
  env.NODE_ENV = await ask('Environment (development/production)', 'production');

  // ── Database ──
  section('🗄️  Database (Supabase)');
  env.SUPABASE_URL = await ask('Supabase URL (https://xxx.supabase.co)');
  env.SUPABASE_ANON_KEY = await ask('Supabase Anon Key');
  env.SUPABASE_SERVICE_ROLE_KEY = await ask('Supabase Service Role Key');
  env.SUPABASE_DB_PASSWORD = await ask('Database Password');

  // ── AI Providers ──
  section('🤖 AI Providers (leave blank to skip)');
  env.OPENAI_API_KEY = await ask('OpenAI API Key');
  env.GOOGLE_AI_KEY = await ask('Google AI / Gemini API Key');
  env.GROQ_API_KEY = await ask('Groq API Key');

  // ── Search ──
  section('🔍 Search Providers (at least 1 recommended)');
  env.TAVILY_API_KEY = await ask('Tavily API Key');
  env.SERPER_API_KEY = await ask('Serper API Key');
  env.PERPLEXITY_API_KEY = await ask('Perplexity API Key');

  // ── Voice ──
  section('🎙️  Voice (optional)');
  env.ELEVENLABS_API_KEY = await ask('ElevenLabs API Key');

  // ── Payments ──
  section('💳 Payments (optional)');
  env.STRIPE_SECRET_KEY = await ask('Stripe Secret Key');
  env.STRIPE_WEBHOOK_SECRET = await ask('Stripe Webhook Secret');

  // ── Monitoring ──
  section('📊 Monitoring (optional)');
  env.SENTRY_DSN = await ask('Sentry DSN');

  // ── Security ──
  section('🔒 Security');
  const defaultSecret = crypto.randomBytes(32).toString('hex');
  env.ADMIN_SECRET_KEY = await ask('Admin Secret Key', defaultSecret);
  env.ALLOWED_ORIGINS = await ask('Allowed Origins (comma-separated)', 'https://kelionai.app');

  // ── Multi-tenant ──
  section('🏢 Multi-tenant (optional)');
  env.MULTI_TENANT = await ask('Enable multi-tenant? (true/false)', 'false');

  // ── Generate .env ──
  console.log('\n  ═══ Generating .env ═══\n');

  const envContent = Object.entries(env)
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const envPath = path.join(process.cwd(), '.env');

  if (fs.existsSync(envPath)) {
    const overwrite = await ask('⚠️  .env already exists. Overwrite? (yes/no)', 'no');
    if (overwrite !== 'yes') {
      const backupPath = `${envPath}.backup.${Date.now()}`;
      fs.copyFileSync(envPath, backupPath);
      console.log(`  📦 Backup created: ${backupPath}`);
    }
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`  ✅ .env created at: ${envPath}`);
  console.log(`  📝 ${Object.keys(env).filter((k) => env[k]).length} variables configured`);

  console.log(`
  ═══════════════════════════════════════════
  🚀 Ready to launch!

  Local:    node server/index.js
  Docker:   docker compose up -d
  Railway:  git push origin master

  Admin:    http://localhost:${env.PORT}/admin
  Health:   http://localhost:${env.PORT}/health
  ═══════════════════════════════════════════
  `);

  rl.close();
}

main().catch((e) => {
  console.error('Setup failed:', e.message);
  rl.close();
  process.exit(1);
});
