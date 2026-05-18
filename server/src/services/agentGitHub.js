'use strict';

const https = require('https');
const { URL } = require('url');

const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'adrianenc11-hue';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'kelionai-v2';
const PROTECTED_BRANCHES = new Set(['master', 'main']);

function getGithubToken() {
  return process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN || process.env.GH_TOKEN;
}

function isSafePrBranch(branch) {
  const name = String(branch || '').trim();
  return !!name
    && !PROTECTED_BRANCHES.has(name)
    && !name.startsWith('-')
    && !name.includes('..')
    && !name.includes('@{')
    && !name.endsWith('.lock')
    && /^[A-Za-z0-9._/-]+$/.test(name);
}

function githubRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const token = getGithubToken();
    if (!token) return resolve({ ok: false, error: 'GITHUB_TOKEN, AGENT_GITHUB_TOKEN, or GH_TOKEN not configured.' });
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KelionAgent',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, data: json });
          } else {
            resolve({ ok: false, status: res.statusCode, error: json.message || data });
          }
        } catch {
          resolve({ ok: false, status: res.statusCode, error: 'Invalid JSON response from GitHub API', body: data });
        }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createPr(branch, title, body = '', base = 'master') {
  if (!isSafePrBranch(branch)) {
    return { ok: false, error: 'PR creation requires a non-master feature branch.' };
  }
  return githubRequest('/pulls', 'POST', { title, head: branch, base, body });
}

async function listOpenPrs() {
  return githubRequest('/pulls?state=open');
}

async function mergePr(number) {
  if (process.env.AGENT_ALLOW_PR_MERGE !== '1') {
    return { ok: false, error: 'PR merge is disabled. Set AGENT_ALLOW_PR_MERGE=1 only after branch protection and required checks are enforced.' };
  }
  return githubRequest(`/pulls/${number}/merge`, 'PUT', { merge_method: 'squash' });
}

module.exports = { createPr, listOpenPrs, mergePr, isSafePrBranch };
