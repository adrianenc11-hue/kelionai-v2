#!/usr/bin/env node
'use strict';

/**
 * KelionAI — Verificare automată deploy (Railway + Netlify + gates locale)
 *
 * Rulează:
 *  1) Gate-uri locale (gate, security)
 *  2) Check Railway CLI + link + env cheie în .env / Railway
 *  3) Check GitHub secrets Netlify (dacă gh este instalat)
 *
 * Utilizare: npm run check:deploy
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const _ENV_EXAMPLE = path.join(ROOT, '.env.example');

const REQUIRED_RAILWAY_KEYS = ['GOOGLE_AI_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];

function log(title, msg) {
  process.stdout.write(`[${title}] ${msg}\n`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.silent ? 'pipe' : 'inherit',
    shell: true,
  });
  return res;
}

function parseEnv(filePath) {
  const out = new Map();
  if (!fs.existsSync(filePath)) return out;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    const key = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (key) out.set(key, value);
  }
  return out;
}

function checkLocalGates() {
  log('LOCAL', 'Rulez `npm run gate` (truth guard)...');
  const res = run('npm', ['run', 'gate'], { silent: false });
  if (res.status === 0) {
    log('LOCAL', '✅ Gate-uri locale: PASS');
  } else {
    log('LOCAL', '❌ Gate-uri locale au eșuat (vezi log-urile de mai sus).');
  }
}

function checkRailway() {
  log('RAILWAY', 'Verific Railway CLI...');
  const ver = run('railway', ['--version'], { silent: true });
  if (ver.status !== 0) {
    log('RAILWAY', '⚠️  Railway CLI nu este instalat sau nu este în PATH. Rulează: npm i -g @railway/cli');
    return;
  }
  log('RAILWAY', `✅ Railway CLI detectat (${(ver.stdout || '').trim()})`);

  const who = run('railway', ['whoami'], { silent: true });
  if (who.status !== 0) {
    log('RAILWAY', '⚠️  Nu ești autentificat. Rulează: railway login');
  } else {
    log('RAILWAY', `✅ Autentificat ca: ${(who.stdout || '').trim()}`);
  }

  const status = run('railway', ['status'], { silent: true });
  if (status.status !== 0) {
    log('RAILWAY', '⚠️  Niciun proiect Railway link-uit. Rulează: railway link (din acest director).');
  } else {
    log('RAILWAY', '✅ Proiect Railway este link-uit.');
  }

  const envLocal = parseEnv(ENV_FILE);
  const missing = [];
  for (const key of REQUIRED_RAILWAY_KEYS) {
    const v = envLocal.get(key);
    if (!v || !v.trim() || v.endsWith('xxx')) {
      missing.push(key);
    }
  }
  if (missing.length === 0) {
    log('RAILWAY', '✅ Cheile critice pentru Railway există în .env (GOOGLE_AI_KEY + SUPABASE_*)');
  } else {
    log('RAILWAY', `⚠️  Lipsesc sau sunt placeholder în .env: ${missing.join(', ')}. Rulează: npm run railway:setup`);
  }
}

function checkNetlifySecrets() {
  log('NETLIFY', 'Verific GitHub CLI (gh) pentru secrete Netlify...');
  const ghVer = run('gh', ['--version'], { silent: true });
  if (ghVer.status !== 0) {
    log(
      'NETLIFY',
      '⚠️  GitHub CLI (gh) nu este instalat sau nu este în PATH. Sari peste check Netlify sau instalează-l.'
    );
    return;
  }
  const auth = run('gh', ['auth', 'status'], { silent: true });
  if (auth.status !== 0) {
    log('NETLIFY', '⚠️  gh nu este autentificat. Rulează: gh auth login (apoi rulează din nou check:deploy).');
    return;
  }

  const repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
    silent: true,
  });
  if (repo.status !== 0) {
    log(
      'NETLIFY',
      '⚠️  Nu pot detecta repo-ul GitHub pentru acest director. Rulează comanda din interiorul repo-ului clonat.'
    );
    return;
  }
  log('NETLIFY', `✅ Repo GitHub detectat: ${(repo.stdout || '').trim()}`);

  const secrets = run('gh', ['secret', 'list'], { silent: true });
  if (secrets.status !== 0) {
    log('NETLIFY', '⚠️  Nu pot lista secretele GitHub. Verifică permisiunile pentru gh.');
    return;
  }
  const txt = secrets.stdout || '';
  const hasToken = /^NETLIFY_AUTH_TOKEN\s/m.test(txt);
  const hasSite = /^NETLIFY_SITE_ID\s/m.test(txt);

  if (hasToken && hasSite) {
    log('NETLIFY', '✅ NETLIFY_AUTH_TOKEN și NETLIFY_SITE_ID sunt setate ca GitHub Secrets.');
  } else {
    const missing = [];
    if (!hasToken) missing.push('NETLIFY_AUTH_TOKEN');
    if (!hasSite) missing.push('NETLIFY_SITE_ID');
    log('NETLIFY', `⚠️  Lipsesc secretele: ${missing.join(', ')}. Rulează: bash scripts/setup-secrets.sh`);
  }
}

function main() {
  log('CHECK', 'Pornesc verificările automate de deploy...');
  checkLocalGates();
  checkRailway();
  checkNetlifySecrets();
  log('CHECK', 'Verificări terminate. Citește mesajele de mai sus pentru pașii următori (dacă există ⚠️).');
}

main();
