#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — PRE-START DEPLOY GATE
// Runs BEFORE server starts. Blocks deploy if hardcoded values found.
// This ensures the zero-hardcoded rule survives every deploy.
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['server', 'app/js', 'app/admin'];

// Patterns that should NEVER appear in functional code
const BLOCK_PATTERNS = [
  {
    name: 'Hardcoded kelionai.app URL',
    regex: /["'`]https:\/\/kelionai\.app/gi,
  },
  {
    name: 'Bare kelionai.app domain',
    regex: /(?<!@)(?<!\.)(?<!\/\/)kelionai\.app(?!["'])/gi,
  },
];

// Lines that are OK (comments, env vars, audit fix-rule documentation, email addresses)
const WHITELIST = [
  /^\s*\/\//, // JS comments
  /^\s*\*/, // Block comment lines
  /process\.env\./, // Uses env var
  /support@kelionai/, // Email address
  /privacy@kelionai/, // Email address
  /noreply@kelionai/, // Email address
  /\/\/ .*kelionai\.app/, // Comment mentioning domain
  /replace\('https:\/\//, // Part of the auto-fix replace() logic
];

/**
 * scan
 * @returns {*}
 */
function scan() {
  const findings = [];

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) continue;

    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (fp.includes('node_modules')) continue;
        if (e.isDirectory()) {
          walk(fp);
          continue;
        }
        if (!e.name.endsWith('.js')) continue;

        const lines = fs.readFileSync(fp, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (WHITELIST.some((re) => re.test(line))) continue;

          for (const p of BLOCK_PATTERNS) {
            p.regex.lastIndex = 0;
            if (p.regex.test(line)) {
              findings.push({
                file: path.relative(ROOT, fp).replace(/\\/g, '/'),
                line: i + 1,
                pattern: p.name,
                code: line.trim().substring(0, 100),
              });
            }
          }
        }
      }
    };
    walk(absDir);
  }

  return findings;
}

// ── GATE CHECK ──
const findings = scan();

if (findings.length > 0) {
  console.error('\n❌ DEPLOY BLOCKED — Hardcoded values detected!\n');
  for (const f of findings) {
    console.error(`  🔴 ${f.file}:${f.line} — ${f.pattern}`);
    console.error(`     ${f.code}\n`);
  }
  console.error(`Total: ${findings.length} violations.`);
  console.error('Fix: Replace hardcoded URLs with process.env.APP_URL\n');
  process.exit(1); // Block deploy
} else {
  console.log('✅ Pre-start audit: CLEAN — zero hardcoded values. Starting server...\n');
}
