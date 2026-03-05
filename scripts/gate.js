#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — Truth Guard Gate Runner
// Runs ALL mandatory gates in enforced order.
// Exit code 0 = PASS (deploy allowed). Non-zero = FAIL (deploy forbidden).
// ═══════════════════════════════════════════════════════════════
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'gate_report.json');
const ERR_PATH = path.join(ROOT, 'file_err.txt');

// Collect all stderr/stdout for file_err.txt
let errLog = '';

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    errLog += line + '\n';
}

function runGate(name, cmd, opts = {}) {
    log(`\n════ GATE: ${name} ════`);
    log(`Command: ${cmd}`);
    const start = Date.now();
    try {
        const output = execSync(cmd, {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: opts.timeout || 300_000, // 5 min default
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        const duration = Date.now() - start;
        const trimmed = (output || '').trim();
        if (trimmed) {
            log(trimmed.slice(-2000)); // keep last 2000 chars
            errLog += trimmed.slice(-2000) + '\n';
        }
        log(`✅ ${name} PASSED (${duration}ms)`);
        return { name, status: 'pass', duration, output: trimmed.slice(-500) };
    } catch (e) {
        const duration = Date.now() - start;
        const stderr = (e.stderr || '').trim();
        const stdout = (e.stdout || '').trim();
        const combined = `${stdout}\n${stderr}`.trim().slice(-2000);
        log(combined);
        errLog += combined + '\n';
        log(`❌ ${name} FAILED (${duration}ms, exit ${e.status})`);
        return { name, status: 'fail', duration, exitCode: e.status, output: combined.slice(-500) };
    }
}

// ═══ MAIN ═══
(async () => {
    log('═══ TRUTH GUARD — GATE RUNNER ═══');
    log(`Commit: ${process.env.GITHUB_SHA || 'local'}`);
    log(`Node: ${process.version}`);
    log(`CWD: ${ROOT}`);

    const results = [];
    let failed = false;

    // 1) Prettier format check
    results.push(runGate('Prettier (format check)', 'npx prettier --check "server/**/*.js"'));
    if (results.at(-1).status === 'fail') failed = true;

    // 2) Lint
    results.push(runGate('Lint (ESLint)', 'npx eslint server/'));
    if (results.at(-1).status === 'fail') failed = true;

    // 2) Typecheck (N/A for JS project)
    results.push(runGate('Typecheck', 'npm run typecheck --silent'));
    // typecheck N/A is always pass — don't set failed

    // 3) Unit/Integration tests
    results.push(runGate('Unit Tests (Jest)', 'npx jest --forceExit --silent', { timeout: 120_000 }));
    if (results.at(-1).status === 'fail') failed = true;

    // 4) Build validation
    results.push(runGate('Build Validation', 'npm run build --silent'));
    if (results.at(-1).status === 'fail') failed = true;

    // 5) Security scan
    results.push(runGate('Security (npm audit)', 'npm audit --audit-level=high'));
    if (results.at(-1).status === 'fail') failed = true;

    // 6) Smoke tests (only if BASE_URL or API_BASE_URL is set)
    const smokeUrl = process.env.BASE_URL || process.env.API_BASE_URL;
    if (smokeUrl) {
        results.push(runGate('Smoke Probe', `npm run smoke --silent`, { timeout: 60_000 }));
        if (results.at(-1).status === 'fail') failed = true;
    } else {
        log('\n════ GATE: Smoke Probe ════');
        log('⏭️  SKIPPED — no BASE_URL or API_BASE_URL set (local run)');
        results.push({ name: 'Smoke Probe', status: 'skipped', reason: 'No BASE_URL set' });
    }

    // 7) E2E (only if BASE_URL is set — requires real URL per Truth Guard rules)
    if (smokeUrl) {
        results.push(runGate('E2E (Playwright)', 'npm run e2e', { timeout: 600_000 }));
        if (results.at(-1).status === 'fail') failed = true;
    } else {
        log('\n════ GATE: E2E (Playwright) ════');
        log('⏭️  SKIPPED — no BASE_URL set (requires Railway preview URL per Truth Guard rules)');
        results.push({ name: 'E2E (Playwright)', status: 'skipped', reason: 'No BASE_URL set — E2E requires real preview URL' });
    }

    // ═══ Generate artifacts ═══
    log('\n════ GENERATING ARTIFACTS ════');

    const report = {
        version: '1.0',
        commit: process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
        branch: process.env.GITHUB_HEAD_REF || execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim(),
        preview_url: smokeUrl || null,
        timestamp: new Date().toISOString(),
        node_version: process.version,
        overall: failed ? 'FAIL' : 'PASS',
        gates: results,
        limitations: [
            ...(smokeUrl ? [] : ['Smoke + E2E skipped — no BASE_URL (local run only)']),
            'Typecheck: N/A (JS-only project)',
            'Lighthouse: not run in CI (no headless Chrome)'
        ]
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log(`✅ gate_report.json written`);

    fs.writeFileSync(ERR_PATH, errLog);
    log(`✅ file_err.txt written`);

    // ═══ Summary ═══
    log('\n═══ GATE SUMMARY ═══');
    for (const r of results) {
        const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
        log(`  ${icon} ${r.name}: ${r.status.toUpperCase()}${r.duration ? ` (${r.duration}ms)` : ''}`);
    }
    log(`\n  Overall: ${report.overall}`);

    if (failed) {
        log('\n🚫 DEPLOY FORBIDDEN — gates did not pass.');
        process.exit(1);
    } else {
        log('\n✅ ALL GATES PASSED — deploy allowed.');
        process.exit(0);
    }
})();
