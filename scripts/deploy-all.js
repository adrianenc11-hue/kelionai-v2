#!/usr/bin/env node
'use strict';

/**
 * KelionAI — Deploy complet (Railway + Netlify)
 *
 * Face, în ordine:
 *  1) Verificări automate: npm run check:deploy
 *  2) Deploy backend (Railway) prin: npm run deploy  (scripts/deploy.sh)
 *  3) Deploy frontend (Netlify) prin GitHub Actions: workflow "Manual Deploy"
 *
 * Utilizare: npm run deploy:all
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function log(title, msg) {
  process.stdout.write(`[${title}] ${msg}\n`);
}

function run(title, cmd, args, opts = {}) {
  log(title, `Rulez: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    stdio: opts.inherit ? 'inherit' : 'pipe',
  });
  if (!opts.inherit) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  if (res.status !== 0) {
    log(title, `❌ Comandă eșuată cu exit code ${res.status}`);
  } else {
    log(title, '✅ OK');
  }
  return res;
}

function main() {
  // 1) Verificări automate
  const check = run('CHECK', 'npm', ['run', 'check:deploy'], { inherit: true });
  if (check.status !== 0) {
    log('CHECK', '⚠️  Verificările au eșuat. Rezolvă problemele de mai sus înainte de deploy complet.');
    process.exit(1);
  }

  // 2) Deploy backend (Railway) prin scripts/deploy.sh
  const dep = run('RAILWAY', 'npm', ['run', 'deploy'], { inherit: true });
  if (dep.status !== 0) {
    log('RAILWAY', '⚠️  Deploy-ul backend a eșuat. Verifică log-urile Railway / scripts/deploy.sh.');
    process.exit(1);
  }

  // 3) Deploy frontend (Netlify) via GitHub Actions "Manual Deploy"
  //    (dacă gh este instalat și autentificat)
  log('NETLIFY', "Încerc să pornesc workflow-ul GitHub 'Manual Deploy' pentru Netlify (environment=production)...");
  const ghVer = spawnSync('gh', ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
  });
  if (ghVer.status !== 0) {
    log(
      'NETLIFY',
      "⚠️  GitHub CLI (gh) nu este instalat sau nu este în PATH. Deschide GitHub → Actions → 'Manual Deploy' și apasă Run workflow."
    );
    process.exit(0);
  }

  const wf = spawnSync('gh', ['workflow', 'run', 'deploy-only.yml', '-f', 'environment=production'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
  });
  if (wf.status !== 0) {
    log(
      'NETLIFY',
      "⚠️  Nu am putut porni workflow-ul 'Manual Deploy'. Poți să-l pornești manual din GitHub → Actions."
    );
    if (wf.stdout) process.stdout.write(wf.stdout);
    if (wf.stderr) process.stderr.write(wf.stderr);
  } else {
    log('NETLIFY', "✅ Workflow 'Manual Deploy' pornit. Urmărește statusul în GitHub → Actions.");
  }

  log(
    'DONE',
    'Deploy complet lansat. Backend pe Railway + frontend pe Netlify (PROD_DOMAIN) vor fi actualizate după finalizarea pipeline-urilor.'
  );
}

main();
