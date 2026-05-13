#!/usr/bin/env node
'use strict';

/**
 * Verifies that RULES.md has not been modified without authorization.
 *
 * Reads SHA-256 of RULES.md, compares with the expected hash stored in
 * RULES.sha256 (signed off by the owner on every legitimate change).
 *
 * Exit codes:
 *   0 — hash matches, rules intact
 *   1 — hash mismatch, rules have been tampered with
 *   2 — missing file (RULES.md or RULES.sha256)
 *
 * Usage:
 *   node scripts/verify-rules-integrity.cjs
 *
 * Used by:
 *   - .github/workflows/rules-integrity.yml (blocks PRs on mismatch)
 *   - any AI agent at the start of its session (per .augment/rules.md)
 *   - manually by the owner to audit
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot    = path.resolve(__dirname, '..');
const rulesPath   = path.join(repoRoot, 'RULES.md');
const hashPath    = path.join(repoRoot, 'RULES.sha256');

function fail(code, msg) {
  process.stderr.write('RULES INTEGRITY CHECK FAILED\n');
  process.stderr.write(msg + '\n');
  process.exit(code);
}

if (!fs.existsSync(rulesPath)) {
  fail(2, 'RULES.md does not exist at repo root.');
}

const rulesBuf = fs.readFileSync(rulesPath);
const actual   = crypto.createHash('sha256').update(rulesBuf).digest('hex');

if (process.argv.includes('--write')) {
  // Owner-only action: regenerate the authoritative hash after an intentional edit.
  fs.writeFileSync(hashPath, actual + '  RULES.md\n');
  process.stdout.write('RULES.sha256 regenerated. Commit it together with RULES.md.\n');
  process.stdout.write('hash = ' + actual + '\n');
  process.exit(0);
}

if (!fs.existsSync(hashPath)) {
  fail(2, 'RULES.sha256 does not exist at repo root. Owner must generate it once with:\n  node scripts/verify-rules-integrity.cjs --write');
}

const expectedRaw = fs.readFileSync(hashPath, 'utf8').trim();
const expected    = expectedRaw.split(/\s+/)[0];

if (expected !== actual) {
  fail(1,
    'RULES.md hash does not match RULES.sha256.\n' +
    '  expected: ' + expected + '\n' +
    '  actual:   ' + actual + '\n\n' +
    'This means RULES.md was modified without an authorized update of the hash.\n' +
    'If you (the owner) edited RULES.md intentionally, run:\n' +
    '  node scripts/verify-rules-integrity.cjs --write\n' +
    'and commit both files in the same PR. Otherwise, revert the change.');
}

process.stdout.write('RULES integrity OK (sha256=' + actual + ')\n');
process.exit(0);
