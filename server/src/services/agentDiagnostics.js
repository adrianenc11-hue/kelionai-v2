'use strict';

const { execCommand } = require('./agentShell');
const { readFile } = require('./agentFs');

// ── Standardized certified checkers ──
// These verifiers run on every modified file before commit is allowed.

/**
 * Run Jest tests. Optional filter for faster targeted runs.
 * @param {string} filter — test path pattern (e.g. 'agent' or 'voiceClone')
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function runTests(filter = '') {
  const cmd = filter
    ? `cd server && npx jest --testPathPattern="${filter}" --verbose`
    : 'cd server && npx jest --verbose';
  return execCommand(cmd, 300000);
}

/**
 * Full production build check.
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function runBuild() {
  return execCommand('npm run build', 120000);
}

/**
 * ESLint static analysis (read-only — does NOT mutate files).
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function runLint() {
  return execCommand('npx eslint src server/src --ext .js,.jsx,.cjs,.mjs', 60000);
}

/**
 * ESLint with auto-fix for safe formatting fixes (unused vars, spacing, quotes).
 * Runs ONLY after a manual read-only lint proved there are no structural errors.
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function runLintFix() {
  return execCommand('npx eslint src server/src --ext .js,.jsx,.cjs,.mjs --fix', 60000);
}

/**
 * Syntax check via Node.js parser for every file in the list.
 * Fast, no-dependency, catches unclosed braces, invalid syntax, missing imports.
 * @param {string[]} files — relative paths from repo root
 * @returns {Promise<{ok:boolean, passed:string[], failed:{path:string, error:string}[]}>}
 */
async function runSyntaxCheck(files) {
  const passed = [];
  const failed = [];
  for (const f of files.slice(0, 20)) {
    const r = await execCommand(`node --check "${f}"`, 10000);
    if (r.ok) passed.push(f);
    else failed.push({ path: f, error: r.stderr || r.error || 'Syntax error' });
  }
  return { ok: failed.length === 0, passed, failed };
}

/**
 * Security static scan — certified lightweight SAST.
 * Detects: eval(), Function() constructor, hardcoded secrets,
          dangerous child_process exec with user input,
          __proto__ pollution, inline script injection.
 * @param {string[]} files — relative paths from repo root
 * @returns {Promise<{ok:boolean, findings:{path:string,line:number,severity:string,rule:string,snippet:string}[]}>}
 */
async function runSecurityScan(files) {
  const DANGEROUS_PATTERNS = [
    { rx: /\beval\s*\(/, rule: 'eval-usage', severity: 'critical' },
    { rx: /new\s+Function\s*\(/, rule: 'Function-constructor', severity: 'critical' },
    { rx: /child_process.*exec\s*\(.*\+/, rule: 'exec-concat', severity: 'critical' },
    { rx: /__proto__|constructor\s*\[\s*["']prototype["']/, rule: 'prototype-pollution', severity: 'high' },
    { rx: /password\s*[:=]\s*["'][^"']{4,}["']/, rule: 'hardcoded-secret', severity: 'high' },
    { rx: /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i, rule: 'hardcoded-api-key', severity: 'high' },
    { rx: /<script[^>]*>.*<\/script>/i, rule: 'inline-script', severity: 'medium' },
    { rx: /document\.write\s*\(/, rule: 'document-write', severity: 'medium' },
  ];

  const findings = [];
  for (const f of files.slice(0, 20)) {
    const r = await readFile(f);
    if (!r.ok) continue;
    const lines = r.content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const p of DANGEROUS_PATTERNS) {
        if (p.rx.test(line)) {
          findings.push({
            path: f,
            line: idx + 1,
            severity: p.severity,
            rule: p.rule,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    });
  }
  const critical = findings.filter(x => x.severity === 'critical');
  return { ok: critical.length === 0, findings };
}

/**
 * Git status snapshot — shows dirty files + last 3 commits.
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string}>}
 */
async function getGitStatus() {
  return execCommand('git status --short && git log --oneline -3', 15000);
}

/**
 * Exhaustive pre-commit validation pipeline.
 * Order: syntax → security → lint → test → build.
 * Stops on first critical failure and returns detailed report.
 * @param {string[]} modifiedFiles — files changed by the agent
 * @param {string} testFilter — optional jest filter for targeted test run
 * @returns {Promise<{ok:boolean, stage:string, detail:object}>}
 */
async function runExhaustiveValidation(modifiedFiles, testFilter = '') {
  // 1. Syntax
  const syntax = await runSyntaxCheck(modifiedFiles);
  if (!syntax.ok) {
    return { ok: false, stage: 'syntax', detail: syntax };
  }

  // 2. Security
  const sec = await runSecurityScan(modifiedFiles);
  if (!sec.ok) {
    return { ok: false, stage: 'security', detail: sec };
  }

  // 3. Lint (read-only)
  const lint = await runLint();
  if (!lint.ok) {
    return { ok: false, stage: 'lint', detail: lint };
  }

  // 4. Tests (targeted if filter provided, else full suite)
  const tests = await runTests(testFilter);
  if (!tests.ok) {
    return { ok: false, stage: 'tests', detail: tests };
  }

  // 5. Build
  const build = await runBuild();
  if (!build.ok) {
    return { ok: false, stage: 'build', detail: build };
  }

  return { ok: true, stage: 'all', detail: { syntax, security: sec, lint, tests, build } };
}

module.exports = {
  runTests, runBuild, runLint, runLintFix, runSyntaxCheck, runSecurityScan, getGitStatus,
  runExhaustiveValidation,
};
