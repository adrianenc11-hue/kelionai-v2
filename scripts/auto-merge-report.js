#!/usr/bin/env node
/**
 * scripts/auto-merge-report.js
 *
 * Standalone script that checks the state of all 14 target PRs and prints
 * a Markdown report.  Requires GITHUB_TOKEN (or GH_TOKEN) in the environment.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/auto-merge-report.js
 *   GH_TOKEN=ghp_...      node scripts/auto-merge-report.js
 */

'use strict';

const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error('ERROR: set GITHUB_TOKEN or GH_TOKEN before running this script.');
  process.exit(1);
}

// Support GITHUB_REPOSITORY=owner/repo (set automatically in Actions environments)
const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || 'adrianenc11-hue/kelionai-v2').split('/');

// Optimal merge order (mirrors .github/workflows/auto-merge-all.yml)
const PR_ORDER = [
  { number: 136, title: 'actions/checkout 4→6',                            group: 'GitHub Actions bumps' },
  { number: 134, title: 'actions/setup-node 4→6',                          group: 'GitHub Actions bumps' },
  { number: 133, title: 'actions/github-script 7→8',                       group: 'GitHub Actions bumps' },
  { number: 138, title: 'actions/upload-artifact 4→7',                     group: 'GitHub Actions bumps' },
  { number: 135, title: '@supabase/supabase-js 2.97→2.98',                 group: 'npm dependency bumps' },
  { number: 137, title: 'stripe 20.3.1→20.4.0',                            group: 'npm dependency bumps' },
  { number: 139, title: '@sentry/browser 10.39→10.40',                     group: 'npm dependency bumps' },
  { number: 140, title: '@sentry/node 10.39→10.40',                        group: 'npm dependency bumps' },
  { number: 141, title: 'jest 29.7→30.2',                                  group: 'npm dependency bumps' },
  { number: 123, title: 'Add full integration pipeline',                    group: 'Feature PRs' },
  { number: 128, title: 'Add comprehensive Playwright E2E test suite',      group: 'Feature PRs' },
  { number: 129, title: 'Add HTTPS redirect, Lighthouse CI, uptime monitoring', group: 'Feature PRs' },
  { number: 142, title: 'Fix onboarding flow (inline event handlers)',       group: 'Feature PRs' },
  { number: 143, title: 'Add live Work-In-Progress status page',            group: 'Feature PRs' },
];

/**
 * Minimal GitHub REST API helper (no external dependencies).
 */
function githubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kelionai-auto-merge-report/1.0',
      },
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${json.message || body}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function fetchPR(number) {
  return githubRequest(`/repos/${OWNER}/${REPO}/pulls/${number}`);
}

function statusIcon(pr) {
  if (!pr)               return '❓';
  if (pr.merged)         return '✅';
  if (pr.state === 'closed') return '⏭️';
  if (pr.draft)          return '📝';
  const ms = pr.mergeable_state;
  if (ms === 'dirty' || ms === 'conflict') return '❌';
  if (ms === 'clean' || ms === 'has_hooks') return '🟢';
  return '🔵';
}

function statusLabel(pr) {
  if (!pr)               return 'Unknown';
  if (pr.merged)         return 'Merged';
  if (pr.state === 'closed') return 'Closed';
  if (pr.draft)          return 'Draft';
  const ms = pr.mergeable_state;
  if (ms === 'dirty' || ms === 'conflict') return 'Conflict';
  if (ms === 'clean' || ms === 'has_hooks') return 'Ready';
  if (ms === 'blocked')  return 'Blocked (checks)';
  if (ms === 'behind')   return 'Behind base';
  if (ms === 'unknown')  return 'Mergeability unknown';
  return ms || 'Open';
}

async function main() {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  console.log(`\nFetching PR states for ${OWNER}/${REPO}…\n`);

  const rows = [];
  let mergedCount = 0;
  let conflictCount = 0;
  let skippedCount = 0;
  let draftCount = 0;
  let readyCount = 0;

  for (const { number, title, group } of PR_ORDER) {
    let pr = null;
    try {
      pr = await fetchPR(number);
    } catch (e) {
      console.error(`  ⚠️  PR #${number}: ${e.message}`);
    }

    const icon  = statusIcon(pr);
    const label = statusLabel(pr);

    if (pr) {
      if (pr.merged)               mergedCount++;
      else if (pr.state === 'closed') skippedCount++;
      else if (pr.draft)           draftCount++;
      else if (label === 'Conflict') conflictCount++;
      else                         readyCount++;
    }

    rows.push({ number, title, group, icon, label, pr });
  }

  // ── Markdown report ────────────────────────────────────────────────────────
  let report = `# 🚀 Auto-Merge Report — ${date}\n\n`;
  report += `## Summary\n`;
  report += `- ✅ Merged:          ${mergedCount}/${PR_ORDER.length}\n`;
  report += `- 🟢 Ready to merge:  ${readyCount}/${PR_ORDER.length}\n`;
  report += `- ❌ Conflicts:       ${conflictCount}/${PR_ORDER.length}\n`;
  report += `- ⏭️  Skipped/Closed: ${skippedCount}/${PR_ORDER.length}\n`;
  report += `- 📝 Still draft:     ${draftCount}/${PR_ORDER.length}\n\n`;

  report += `## Details\n\n`;
  report += `| # | PR | Title | Group | Status | Mergeable state |\n`;
  report += `|---|---|---|---|---|---|\n`;

  let idx = 1;
  for (const { number, title, group, icon, label, pr } of rows) {
    const ms = pr ? (pr.mergeable_state || '—') : '—';
    report += `| ${idx++} | #${number} | ${title} | ${group} | ${icon} ${label} | \`${ms}\` |\n`;
  }

  report += `\n---\n_Generated by \`scripts/auto-merge-report.js\` at ${date}_\n`;

  console.log(report);

  // Also write a file next to the script for convenience
  const path = require('path');
  const fs   = require('fs');
  const outFile = path.join(__dirname, '..', 'auto-merge-report.md');
  fs.writeFileSync(outFile, report);
  console.log(`Report written to: ${outFile}\n`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
