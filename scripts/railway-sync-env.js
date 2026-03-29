#!/usr/bin/env node
/**
 * railway-sync-env.js
 * Rulează automat la startup pe Railway.
 * Railway injectează variabilele ca process.env → le scriem în .env → pornim serverul.
 * 
 * Adaugă în Procfile sau package.json "start":
 *   node scripts/railway-sync-env.js && node server/index.js
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

// Chei pe care le ignorăm (Railway system vars)
const IGNORE_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
  'PWD', 'OLDPWD', 'SHLVL', 'LOGNAME', 'MAIL', 'HOSTNAME',
  'RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID',
  'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_REPLICA_ID', 'RAILWAY_GIT_COMMIT_SHA',
  'RAILWAY_GIT_AUTHOR', 'RAILWAY_GIT_BRANCH', 'RAILWAY_GIT_REPO_NAME',
  'RAILWAY_GIT_REPO_OWNER', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_STATIC_URL', 'RAILWAY_VOLUME_MOUNT_PATH', 'RAILWAY_TCP_PROXY_DOMAIN',
  'RAILWAY_TCP_PROXY_PORT', 'RAILWAY_PROJECT_NAME', 'RAILWAY_SERVICE_NAME',
  'RAILWAY_ENVIRONMENT_NAME', 'npm_config_cache', 'npm_config_prefix',
  'npm_execpath', 'npm_node_execpath', 'npm_package_json',
  'NODE_PATH', 'NVM_DIR', 'NVM_BIN', 'NVM_INC',
]);

// Categorii pentru organizare în .env
const CATEGORIES = {
  'SERVER': ['PORT', 'NODE_ENV', 'BASE_URL', 'APP_URL', 'SERVER_URL', 'FRONTEND_URL', 'BACKEND_URL'],
  'AUTH': ['JWT_SECRET', 'SESSION_SECRET', 'COOKIE_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_TOKEN'],
  'SUPABASE': ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY', 'SUPABASE_JWT_SECRET', 'DATABASE_URL'],
  'OPENAI': ['OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_MODEL', 'OPENAI_BASE_URL'],
  'ANTHROPIC': ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CLAUDE_MODEL'],
  'GEMINI': ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  'ELEVENLABS': ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID'],
  'STRIPE': ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'STRIPE_PRODUCT_ID'],
  'EMAIL': ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'ALERT_EMAIL', 'SENDGRID_API_KEY', 'RESEND_API_KEY'],
  'STORAGE': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_BUCKET_NAME', 'AWS_REGION', 'CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME'],
  'OTHER': [],
};

function syncEnv() {
  console.log('🔄 [railway-sync-env] Sincronizare variabile Railway → .env...');

  // Colectează toate variabilele din process.env (exclusiv cele de sistem)
  const railwayVars = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!IGNORE_KEYS.has(key) && value !== undefined && value !== '') {
      railwayVars[key] = value;
    }
  }

  const count = Object.keys(railwayVars).length;
  console.log(`✅ [railway-sync-env] Găsite ${count} variabile de mediu din Railway`);

  if (count === 0) {
    console.log('⚠️  [railway-sync-env] Nicio variabilă găsită. Continuăm fără .env sync.');
    return;
  }

  // Citește .env existent dacă există
  let existingVars = {};
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.substring(0, eqIdx).trim();
          const v = trimmed.substring(eqIdx + 1).trim();
          existingVars[k] = v;
        }
      }
    });
  }

  // Railway vars au prioritate peste .env existent
  const merged = { ...existingVars, ...railwayVars };

  // Construiește conținutul .env organizat pe categorii
  let envContent = `# KelionAI - Environment Variables\n`;
  envContent += `# Auto-sincronizat de railway-sync-env.js\n`;
  envContent += `# Data: ${new Date().toISOString()}\n`;
  envContent += `# Sursa: Railway process.env\n\n`;

  const writtenKeys = new Set();

  for (const [category, keys] of Object.entries(CATEGORIES)) {
    let categoryVars;

    if (category === 'OTHER') {
      // Toate cheile rămase care nu au fost scrise
      categoryVars = Object.entries(merged).filter(([k]) => !writtenKeys.has(k));
    } else {
      categoryVars = keys
        .filter(k => merged[k] !== undefined)
        .map(k => [k, merged[k]]);
    }

    if (categoryVars.length > 0) {
      envContent += `# ===== ${category} =====\n`;
      for (const [key, value] of categoryVars) {
        // Escape valori cu spații sau caractere speciale
        const safeValue = value.includes(' ') || value.includes('#')
          ? `"${value.replace(/"/g, '\\"')}"`
          : value;
        envContent += `${key}=${safeValue}\n`;
        writtenKeys.add(key);
      }
      envContent += '\n';
    }
  }

  // Backup .env vechi
  if (fs.existsSync(ENV_PATH)) {
    const backupPath = ENV_PATH + '.bak';
    fs.copyFileSync(ENV_PATH, backupPath);
  }

  // Scrie noul .env
  fs.writeFileSync(ENV_PATH, envContent, 'utf8');

  console.log(`✅ [railway-sync-env] .env actualizat cu ${Object.keys(merged).length} variabile`);
  console.log(`📍 [railway-sync-env] Locație: ${ENV_PATH}`);

  // Log sumar (mascat)
  const important = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'STRIPE_SECRET_KEY', 'SUPABASE_URL', 'JWT_SECRET'];
  console.log('\n📋 [railway-sync-env] Chei importante:');
  important.forEach(k => {
    if (merged[k]) {
      const v = merged[k];
      const masked = v.length > 8 ? v.substring(0, 4) + '****' + v.slice(-4) : '****';
      console.log(`   ✓ ${k} = ${masked}`);
    } else {
      console.log(`   ✗ ${k} = LIPSĂ`);
    }
  });

  console.log('\n🚀 [railway-sync-env] Sync complet! Pornesc serverul...\n');
}

// Rulează sync
syncEnv();