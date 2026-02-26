#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Configurare automată Railway
// Utilizare: node scripts/railway-setup.js  sau  npm run railway:setup
// ═══════════════════════════════════════════════════════════════
'use strict';

const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Culori terminal ──────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const ok   = (msg) => console.log(`${C.green}✅ ${msg}${C.reset}`);
const err  = (msg) => console.log(`${C.red}❌ ${msg}${C.reset}`);
const warn = (msg) => console.log(`${C.yellow}⚠️  ${msg}${C.reset}`);
const info = (msg) => console.log(`${C.cyan}ℹ️  ${msg}${C.reset}`);
const step = (msg) => console.log(`\n${C.bold}${C.blue}▶ ${msg}${C.reset}`);

const PROJECT_DIR = path.resolve(__dirname, '..');
const ENV_EXAMPLE = path.join(PROJECT_DIR, '.env.example');
const ENV_FILE    = path.join(PROJECT_DIR, '.env');

// ─── Helpers ─────────────────────────────────────────────────
function run(args, opts = {}) {
    // Accept either a string (shell command) or an array (argv, no shell)
    if (Array.isArray(args)) {
        return spawnSync(args[0], args.slice(1), { stdio: 'inherit', ...opts });
    }
    return spawnSync(args, { shell: true, stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
    try {
        return execSync(cmd, { stdio: 'pipe' }).toString().trim();
    } catch {
        return null;
    }
}

function isInstalled(bin) {
    return runCapture(`${bin} --version`) !== null;
}

// ─── Parse variabile din fișier .env / .env.example ──────────
function parseEnvFile(filePath) {
    const vars = {};
    if (!fs.existsSync(filePath)) return vars;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) continue;
        const key   = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            vars[key] = value;
        }
    }
    return vars;
}

// Valori placeholder — considerate ca "necompletate"
const PLACEHOLDER_PATTERNS = [
    /^sk-ant-api03-xxx/,
    /^sk-proj-xxx/,
    /^sk-xxx/,
    /^sk_xxx/,
    /^gsk_xxx/,
    /^pplx-xxx/,
    /^tvly-xxx/,
    /xxxxx/,
    /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.xxx/,
    /\.supabase\.co$/, // URL template
    /^https:\/\/xxxx/,
    /^postgresql:\/\/postgres:xxx/,
    /^sk_test_xxx/,
    /^whsec_xxx/,
    /^price_xxx/,
    /^https:\/\/xxx@xxx/,
    /^https:\/\/prometheus-prod-xxx/,
];

function isPlaceholder(value) {
    if (!value) return true;
    return PLACEHOLDER_PATTERNS.some((re) => re.test(value));
}

// ─── Lista completă de variabile cerute ──────────────────────
const REQUIRED_VARS = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'ELEVENLABS_API_KEY',
    'GROQ_API_KEY',
    'PERPLEXITY_API_KEY',
    'TAVILY_API_KEY',
    'SERPER_API_KEY',
    'TOGETHER_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_DB_PASSWORD',
    'DATABASE_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_PRO',
    'STRIPE_PRICE_PREMIUM',
    'SENTRY_DSN',
    'GRAFANA_PROM_URL',
    'GRAFANA_PROM_USER',
    'GRAFANA_PROM_PASS',
    'PORT',
    'NODE_ENV',
    'LOG_LEVEL',
    'APP_URL',
    'ALLOWED_ORIGINS',
    'GOOGLE_MAPS_KEY',
    'ADMIN_TOKEN',
];

// ─── MAIN ─────────────────────────────────────────────────────
function main() {
    console.log('');
    console.log(`${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}${C.cyan}   KelionAI v2 — Configurare automată Railway     ${C.reset}`);
    console.log(`${C.bold}${C.cyan}══════════════════════════════════════════════════${C.reset}`);
    console.log('');

    // ── 1. Verifică / instalează Railway CLI ─────────────────
    step('1. Verificare Railway CLI');
    if (!isInstalled('railway')) {
        warn('Railway CLI nu este instalat. Instalez automat...');
        const res = run('npm i -g @railway/cli');
        if (res.status !== 0) {
            err('Instalarea Railway CLI a eșuat. Rulează manual: npm i -g @railway/cli');
            process.exit(1);
        }
        ok('Railway CLI instalat cu succes');
    } else {
        ok(`Railway CLI detectat: ${runCapture('railway --version')}`);
    }

    // ── 2. Login Railway ──────────────────────────────────────
    step('2. Autentificare Railway');
    const whoami = runCapture('railway whoami');
    if (whoami) {
        ok(`Deja autentificat ca: ${whoami}`);
    } else {
        info('Se deschide browserul pentru autentificare Railway...');
        const res = run('railway login');
        if (res.status !== 0) {
            err('Autentificarea Railway a eșuat.');
            process.exit(1);
        }
        ok('Autentificat în Railway');
    }

    // ── 3. Link proiect ───────────────────────────────────────
    step('3. Linkare proiect Railway');
    info('Legarea proiectului curent la Railway...');
    const linkRes = run('railway link');
    if (linkRes.status !== 0) {
        warn('Linkarea automată a eșuat — poți face manual: railway link');
    } else {
        ok('Proiect linkat la Railway');
    }

    // ── 4. Colectează valorile variabilelor ───────────────────
    step('4. Colectare variabile de configurare');

    const exampleVars = parseEnvFile(ENV_EXAMPLE);
    const localVars   = parseEnvFile(ENV_FILE);

    // Generează ADMIN_TOKEN automat
    const adminToken = crypto.randomBytes(32).toString('hex');
    ok('ADMIN_TOKEN generat automat');

    const finalVars = {};

    for (const key of REQUIRED_VARS) {
        if (key === 'ADMIN_TOKEN') {
            finalVars[key] = { value: adminToken, source: 'generat' };
            continue;
        }

        // Prioritate: .env local > .env.example (dacă nu e placeholder)
        const localVal   = localVars[key];
        const exampleVal = exampleVars[key];

        if (localVal && !isPlaceholder(localVal)) {
            finalVars[key] = { value: localVal, source: 'local .env' };
        } else if (exampleVal && !isPlaceholder(exampleVal)) {
            finalVars[key] = { value: exampleVal, source: '.env.example' };
        } else {
            // Valori implicite pentru variabile de sistem
            const defaults = {
                PORT:            '3000',
                NODE_ENV:        'production',
                LOG_LEVEL:       'info',
                APP_URL:         'https://kelionai.app',
                ALLOWED_ORIGINS: '',
            };
            if (key in defaults) {
                finalVars[key] = { value: defaults[key], source: 'implicit' };
            } else {
                finalVars[key] = { value: 'placeholder_to_be_updated', source: 'placeholder' };
            }
        }
    }

    // ── 5. Setează variabilele în Railway ────────────────────
    step('5. Setare variabile în Railway');

    let setCount = 0;
    let placeholderCount = 0;

    for (const [key, { value, source }] of Object.entries(finalVars)) {
        if (!value && value !== '0') {
            warn(`  ${key} — sărit (valoare goală)`);
            continue;
        }

        // Setează variabila în Railway folosind argv (fără shell) pentru a evita injecția
        const res = run(['railway', 'variables', 'set', `${key}=${value}`], { stdio: 'pipe' });

        if (res.status !== 0) {
            warn(`  ${key} — setare eșuată (poți seta manual)`);
        } else {
            setCount++;
            if (source === 'placeholder') {
                placeholderCount++;
            }
        }
    }

    ok(`${setCount} variabile setate în Railway`);
    if (placeholderCount > 0) {
        warn(`${placeholderCount} variabile au valoarea 'placeholder_to_be_updated' și pot fi actualizate ulterior`);
    }

    // ── 6. Afișează tabelul sumar ────────────────────────────
    step('6. Sumar variabile');
    console.log('');
    console.log(`  ${'VARIABILA'.padEnd(30)} ${'SURSĂ'.padEnd(15)} STATUS`);
    console.log(`  ${'─'.repeat(30)} ${'─'.repeat(15)} ${'─'.repeat(20)}`);

    for (const [key, { value, source }] of Object.entries(finalVars)) {
        const statusIcon = source === 'placeholder'
            ? `${C.yellow}⚠  placeholder${C.reset}`
            : `${C.green}✓  setat${C.reset}`;
        const srcDisplay = source.padEnd(15);
        const keyDisplay = key.padEnd(30);
        console.log(`  ${keyDisplay} ${srcDisplay} ${statusIcon}`);
    }

    // ── 7. Deploy automat ────────────────────────────────────
    step('7. Deploy automat Railway');
    if (placeholderCount > 0) {
        warn(`Atenție: ${placeholderCount} variabile sunt placeholder. Aplicația poate eșua dacă acestea sunt critice.`);
    }
    info('Pornesc deploy pe Railway...');
    const deployRes = run(['railway', 'up']);
    if (deployRes.status !== 0) {
        warn('Deploy-ul a eșuat sau a fost întrerupt. Poți rula manual: railway up');
    } else {
        ok('Deploy Railway pornit cu succes!');
    }

    // ── Sumar final ───────────────────────────────────────────
    console.log('');
    console.log(`${C.bold}${C.green}══════════════════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}${C.green}   ✅ Configurare Railway completă!               ${C.reset}`);
    console.log(`${C.bold}${C.green}══════════════════════════════════════════════════${C.reset}`);
    console.log('');
    info('Pași următori:');
    console.log(`  1. ${C.cyan}railway logs${C.reset}              — verifică log-urile deploy-ului`);
    console.log(`  2. ${C.cyan}railway open${C.reset}              — deschide aplicația în browser`);
    if (placeholderCount > 0) {
        console.log(`  3. ${C.yellow}railway variables set KEY=VALOARE_REALA${C.reset} — actualizează placeholderele`);
    }
    console.log('');
}

try {
    main();
} catch (e) {
    err(`Eroare neașteptată: ${e.message}`);
    process.exit(1);
}
