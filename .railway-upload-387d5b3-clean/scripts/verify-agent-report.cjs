#!/usr/bin/env node
'use strict';

/**
 * Scans a text report (agent output, commit message, PR description) for
 * forbidden claims without executable proof.
 *
 * Exit codes:
 *   0 — report contains no unproven claims
 *   1 — at least one unproven claim detected
 *   2 — input file missing
 *
 * Usage:
 *   node scripts/verify-agent-report.cjs <path-to-report.txt>
 *   cat report.txt | node scripts/verify-agent-report.cjs -
 *
 * A claim is "unproven" if it uses one of the forbidden-claim words
 * (PASS, verificat, functioneaza, done, ready, complete, all green, etc.)
 * without being accompanied, in the same report, by BOTH:
 *   (a) a shell command block (```, $, >, # prefix, or `node ...`), and
 *   (b) an exit-code indication or HTTP status line.
 *
 * This is a heuristic, not a proof. It catches the pattern of cosmetic
 * reports that motivated RULES.md. It is intentionally strict.
 */

const fs = require('fs');

const FORBIDDEN = [
  /\bPASS\b/i,
  /\bFAIL\b/i,
  /\bverificat\b/i,
  /\bfunctioneaza\b/i,
  /\bfunc[tț]ioneaz[aă]\b/i,
  /\bgata\b/i,
  /\bdone\b/i,
  /\bready\b/i,
  /\bcomplete\b/i,
  /\ball green\b/i,
  /\bnothing pending\b/i,
  /\bworking tree clean\b/i,
  /\btotul verde\b/i,
  /\btotul OK\b/i,
  /\b\d+\s*\/\s*\d+\s+PASS\b/i,
];

// Markers that indicate genuine executed evidence.
const EVIDENCE_CMD = [
  /^\s*\$\s+\S/m,
  /^\s*>\s+\S/m,
  /^\s*#\s+\S/m,
  /```(?:bash|sh|powershell|ps1|cmd)/i,
  /\bnode\s+\S+\.c?js\b/,
  /\bcurl\s+-/,
  /\bInvoke-WebRequest\b/,
  /\bgit\s+(?:push|commit|log|status)\b/,
];
const EVIDENCE_RESULT = [
  /\bexit\s*(?:code)?\s*[:=]?\s*\d+/i,
  /\bstatus\s*[:=]?\s*\d{3}\b/i,
  /\bHTTP\/\d\.\d\s+\d{3}\b/i,
  /\breturn-code\s*[:=>]\s*\d+/i,
  /\bcontent-type\s*[:=]/i,
];

function readInput() {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write('Usage: verify-agent-report.cjs <file|->\n');
    process.exit(2);
  }
  if (arg === '-') {
    return fs.readFileSync(0, 'utf8');
  }
  if (!fs.existsSync(arg)) {
    process.stderr.write('Input file not found: ' + arg + '\n');
    process.exit(2);
  }
  return fs.readFileSync(arg, 'utf8');
}

const text = readInput();

const hasCmd    = EVIDENCE_CMD.some(r => r.test(text));
const hasResult = EVIDENCE_RESULT.some(r => r.test(text));
const hasEvidence = hasCmd && hasResult;

const violations = [];
const lines = text.split(/\r?\n/);
lines.forEach((line, i) => {
  for (const re of FORBIDDEN) {
    if (re.test(line)) {
      violations.push({ line: i + 1, text: line.trim(), pattern: re.toString() });
      break;
    }
  }
});

if (violations.length === 0) {
  process.stdout.write('No forbidden claim words found. Report is neutral.\n');
  process.exit(0);
}

process.stdout.write('Claim words found: ' + violations.length + '\n');
process.stdout.write('Executable evidence present: ' + (hasEvidence ? 'yes' : 'no') + '\n');
process.stdout.write('  command-like lines: ' + hasCmd + '\n');
process.stdout.write('  result/status lines: ' + hasResult + '\n');

if (hasEvidence) {
  process.stdout.write('\nReport contains claim words AND executable evidence. Manual review still required by owner.\n');
  process.exit(0);
}

process.stderr.write('\nUNPROVEN CLAIMS DETECTED (no executed commands with exit codes or HTTP statuses):\n');
violations.forEach(v => {
  process.stderr.write('  line ' + v.line + ': ' + v.text.slice(0, 160) + '\n');
});
process.stderr.write('\nThis report claims success without showing the commands that produced it.\n');
process.stderr.write('Per RULES.md (rules 2, 4, 9, 18, 20, 21, 25): reject.\n');
process.exit(1);
