#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — API Key Rotation Script
// Generates internal secrets automatically
// Guides through external key regeneration with provider links
// Pushes everything to Railway via CLI
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// ── Colors for terminal ──
const C = {
  R: '\x1b[31m', G: '\x1b[32m', Y: '\x1b[33m', B: '\x1b[34m',
  M: '\x1b[35m', C: '\x1b[36m', W: '\x1b[37m', RESET: '\x1b[0m',
  BOLD: '\x1b[1m', DIM: '\x1b[2m',
};

function genSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ── Keys that we generate ourselves (no external provider) ──
const INTERNAL_SECRETS = [
  { name: 'SESSION_SECRET', bytes: 32, desc: 'Express session encryption' },
  { name: 'REFERRAL_SECRET', bytes: 32, desc: 'Referral system HMAC' },
  { name: 'ADMIN_SECRET_KEY', bytes: 24, desc: 'Admin panel access key' },
  { name: 'WA_VERIFY_TOKEN', bytes: 16, desc: 'WhatsApp webhook verification' },
  { name: 'MESSENGER_VERIFY_TOKEN', bytes: 16, desc: 'Messenger webhook verification' },
  { name: 'GITHUB_WEBHOOK_SECRET', bytes: 20, desc: 'GitHub webhook HMAC' },
];

// ── External provider keys (user must regenerate manually) ──
const EXTERNAL_KEYS = [
  {
    group: '🔴 CRITICE — fără ele serverul nu merge',
    keys: [
      { name: 'SUPABASE_URL', url: 'https://supabase.com/dashboard/project/_/settings/api', desc: 'Supabase → Settings → API → URL' },
      { name: 'SUPABASE_ANON_KEY', url: 'https://supabase.com/dashboard/project/_/settings/api', desc: 'Supabase → Settings → API → anon key' },
      { name: 'SUPABASE_SERVICE_KEY', url: 'https://supabase.com/dashboard/project/_/settings/api', desc: 'Supabase → Settings → API → service_role key' },
      { name: 'ELEVENLABS_API_KEY', url: 'https://elevenlabs.io/app/settings/api-keys', desc: 'ElevenLabs → Settings → API Keys → Create' },
    ],
  },
  {
    group: '🟡 AI PROVIDERS — recomandate',
    keys: [
      { name: 'GOOGLE_AI_KEY', url: 'https://aistudio.google.com/apikey', desc: 'Google AI Studio → Get API Key → Create', alias: 'GEMINI_API_KEY' },
      { name: 'OPENAI_API_KEY', url: 'https://platform.openai.com/api-keys', desc: 'OpenAI → API Keys → Create new' },
      { name: 'ANTHROPIC_API_KEY', url: 'https://console.anthropic.com/settings/keys', desc: 'Anthropic → Settings → API Keys → Create' },
      { name: 'GROQ_API_KEY', url: 'https://console.groq.com/keys', desc: 'Groq → API Keys → Create' },
      { name: 'DEEPSEEK_API_KEY', url: 'https://platform.deepseek.com/api_keys', desc: 'DeepSeek → API Keys → Create' },
    ],
  },
  {
    group: '🟡 VOICE & SEARCH',
    keys: [
      { name: 'DEEPGRAM_API_KEY', url: 'https://console.deepgram.com/', desc: 'Deepgram → API Keys → Create' },
      { name: 'CARTESIA_API_KEY', url: 'https://play.cartesia.ai/', desc: 'Cartesia → API Keys → Create' },
      { name: 'TAVILY_API_KEY', url: 'https://tavily.com/', desc: 'Tavily → Dashboard → API Keys' },
    ],
  },
  {
    group: '🟡 PAYMENTS',
    keys: [
      { name: 'STRIPE_SECRET_KEY', url: 'https://dashboard.stripe.com/apikeys', desc: 'Stripe → API Keys → Reveal + Roll key' },
      { name: 'STRIPE_WEBHOOK_SECRET', url: 'https://dashboard.stripe.com/webhooks', desc: 'Stripe → Webhooks → Signing secret (roll)' },
    ],
  },
  {
    group: '🟢 OPȚIONALE — Social / Misc',
    keys: [
      { name: 'WA_ACCESS_TOKEN', url: 'https://developers.facebook.com/', desc: 'Meta → WhatsApp → API Setup → Token', aliases: ['WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN'] },
      { name: 'TELEGRAM_BOT_TOKEN', url: 'https://t.me/BotFather', desc: 'Telegram → @BotFather → /newtoken' },
      { name: 'SENTRY_DSN', url: 'https://sentry.io/', desc: 'Sentry → Project → Client Keys → DSN' },
    ],
  },
];

// ── Railway helper ──
function railwaySet(name, value) {
  try {
    execSync(`railway variables set ${name}="${value}"`, {
      stdio: 'pipe',
      timeout: 15000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

function railwayLinked() {
  try {
    execSync('railway status', { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log(`
${C.BOLD}${C.C}═══════════════════════════════════════════════════════════${C.RESET}
${C.BOLD}  🔑 KelionAI v2 — Key Rotation Tool${C.RESET}
${C.BOLD}${C.C}═══════════════════════════════════════════════════════════${C.RESET}
`);

  // Check Railway
  let useRailway = false;
  const railwayOk = railwayLinked();
  if (railwayOk) {
    console.log(`${C.G}✅ Railway CLI linked to project${C.RESET}\n`);
    const ans = await ask(`${C.Y}Push keys to Railway automatically? (y/n): ${C.RESET}`);
    useRailway = ans.trim().toLowerCase() === 'y';
  } else {
    console.log(`${C.Y}⚠️  Railway CLI not linked. Keys will be printed for manual copy.${C.RESET}`);
    console.log(`${C.DIM}   Run: railway login && railway link${C.RESET}\n`);
  }

  const allNewKeys = {};

  // ═══ STEP 1: Auto-generate internal secrets ═══
  console.log(`\n${C.BOLD}${C.M}═══ STEP 1: Internal Secrets (auto-generated) ═══${C.RESET}\n`);

  for (const s of INTERNAL_SECRETS) {
    const value = genSecret(s.bytes);
    allNewKeys[s.name] = value;
    console.log(`  ${C.G}✅ ${s.name}${C.RESET} ${C.DIM}(${s.desc})${C.RESET}`);
    console.log(`     ${C.DIM}${value.substring(0, 12)}...${C.RESET}`);
  }

  // ═══ STEP 2: External keys — guided regeneration ═══
  console.log(`\n${C.BOLD}${C.M}═══ STEP 2: External API Keys ═══${C.RESET}`);
  console.log(`${C.DIM}For each key: open the link, regenerate, paste new value.${C.RESET}`);
  console.log(`${C.DIM}Press ENTER to skip keys you don't use.${C.RESET}\n`);

  for (const group of EXTERNAL_KEYS) {
    console.log(`\n${C.BOLD}${C.B}── ${group.group} ──${C.RESET}\n`);

    for (const key of group.keys) {
      console.log(`  ${C.Y}${key.name}${C.RESET}`);
      console.log(`  ${C.DIM}${key.desc}${C.RESET}`);
      console.log(`  ${C.C}${key.url}${C.RESET}`);

      const value = await ask(`  ${C.W}Paste new key (ENTER to skip): ${C.RESET}`);
      const trimmed = value.trim();

      if (trimmed) {
        allNewKeys[key.name] = trimmed;
        // Set aliases too
        if (key.alias) allNewKeys[key.alias] = trimmed;
        if (key.aliases) {
          for (const a of key.aliases) allNewKeys[a] = trimmed;
        }
        console.log(`  ${C.G}✅ Saved${C.RESET}\n`);
      } else {
        console.log(`  ${C.DIM}⏭  Skipped${C.RESET}\n`);
      }
    }
  }

  // ═══ STEP 3: Push to Railway or print summary ═══
  const keyCount = Object.keys(allNewKeys).length;
  console.log(`\n${C.BOLD}${C.M}═══ STEP 3: Applying ${keyCount} keys ═══${C.RESET}\n`);

  if (useRailway) {
    let ok = 0;
    let fail = 0;
    for (const [name, value] of Object.entries(allNewKeys)) {
      process.stdout.write(`  Setting ${name}... `);
      if (railwaySet(name, value)) {
        console.log(`${C.G}✅${C.RESET}`);
        ok++;
      } else {
        console.log(`${C.R}❌${C.RESET}`);
        fail++;
      }
    }
    console.log(`\n${C.G}✅ ${ok} keys set on Railway${C.RESET}`);
    if (fail > 0) console.log(`${C.R}❌ ${fail} keys failed — set manually in Railway dashboard${C.RESET}`);

    // Trigger redeploy
    console.log(`\n${C.Y}Triggering Railway redeploy...${C.RESET}`);
    try {
      execSync('railway up --detach', { stdio: 'pipe', timeout: 30000 });
      console.log(`${C.G}✅ Redeploy triggered${C.RESET}`);
    } catch {
      console.log(`${C.Y}⚠️  Auto-redeploy failed. Push a commit or redeploy from dashboard.${C.RESET}`);
    }
  } else {
    // Print .env format for manual copy
    console.log(`${C.BOLD}Copy these to your .env or Railway dashboard:${C.RESET}\n`);
    console.log(`${C.DIM}─────────────────────────────────────────${C.RESET}`);
    for (const [name, value] of Object.entries(allNewKeys)) {
      console.log(`${name}=${value}`);
    }
    console.log(`${C.DIM}─────────────────────────────────────────${C.RESET}`);
  }

  // ═══ STEP 4: Reminder checklist ═══
  console.log(`
${C.BOLD}${C.C}═══ POST-ROTATION CHECKLIST ═══${C.RESET}

  ${C.Y}1.${C.RESET} Verify server starts: ${C.DIM}curl https://kelionai.app/api/health${C.RESET}
  ${C.Y}2.${C.RESET} Test login (Supabase keys)
  ${C.Y}3.${C.RESET} Test chat (AI provider keys)
  ${C.Y}4.${C.RESET} Test voice (ElevenLabs / Deepgram / Cartesia)
  ${C.Y}5.${C.RESET} Test payment (Stripe — use test mode first!)
  ${C.Y}6.${C.RESET} Revoke OLD keys from all provider dashboards
     ${C.R}⚠️  Do this AFTER confirming new keys work!${C.RESET}

${C.BOLD}${C.G}Done! 🔒${C.RESET}
`);

  rl.close();
}

main().catch((e) => {
  console.error(`${C.R}Error: ${e.message}${C.RESET}`);
  rl.close();
  process.exit(1);
});
