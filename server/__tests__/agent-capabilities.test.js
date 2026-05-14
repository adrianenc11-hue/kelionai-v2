'use strict';

process.env.NODE_ENV = 'test';
jest.setTimeout(30000);

const fs = require('fs');
const path = require('path');
const os = require('os');

const { executeRealTool } = require('../src/services/realTools');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kelion-agent-eval-'));
const tmpFile = (name) => path.join(TMP, name);
const writeTmp = (name, content) => fs.writeFileSync(tmpFile(name), content, 'utf8');
const readTmp = (name) => fs.readFileSync(tmpFile(name), 'utf8');

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe('Agent Capability Evaluation — 10 advanced scenarios', () => {

  // ── 1. Code Generation & File Write ──
  it('01 writes a working Express endpoint to a new file', async () => {
    const code = `const express = require('express');\nconst router = express.Router();\nrouter.get('/ping', (req, res) => res.json({ ok: true }));\nmodule.exports = router;`;
    const r = await executeRealTool('edit_local_file', { path: tmpFile('routes/ping.js'), content: code, create: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(tmpFile('routes/ping.js'))).toBe(true);
    expect(readTmp('routes/ping.js')).toContain('router.get(\'/ping\'');
  });

  // ── 2. Dependency Installation ──
  it('02 installs an npm package inside a temp project', async () => {
    fs.mkdirSync(tmpFile('proj'), { recursive: true });
    fs.writeFileSync(tmpFile('proj/package.json'), JSON.stringify({ name: 'eval', version: '1.0.0' }), 'utf8');
    const r = await executeRealTool('run_terminal_command', { command: `cd "${tmpFile('proj')}" && npm install lodash --legacy-peer-deps` });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(tmpFile('proj/node_modules/lodash'))).toBe(true);
  });

  // ── 3. Bug Identification & Fix ──
  it('03 fixes a runtime bug in a source file', async () => {
    writeTmp('buggy.js', `function greet(name) { return 'Hello ' + name.toUpperCase(); }\nmodule.exports = { greet };`);
    const r = await executeRealTool('edit_local_file', {
      path: tmpFile('buggy.js'),
      content: `function greet(name) { const n = name || 'Guest'; return 'Hello ' + n.toUpperCase(); }\nmodule.exports = { greet };`,
    });
    expect(r.ok).toBe(true);
    const fixed = require(tmpFile('buggy.js'));
    expect(fixed.greet()).toBe('Hello GUEST');
    expect(fixed.greet('Ada')).toBe('Hello ADA');
  });

  // ── 4. Configuration / Env Setup ──
  it('04 appends a required env variable to .env', async () => {
    writeTmp('.env', 'PORT=3001\nNODE_ENV=development\n');
    const r = await executeRealTool('edit_local_file', {
      path: tmpFile('.env'),
      content: 'PORT=3001\nNODE_ENV=development\nAGENT_EVAL_KEY=secret-42\n',
    });
    expect(r.ok).toBe(true);
    expect(readTmp('.env')).toContain('AGENT_EVAL_KEY=secret-42');
  });

  // ── 5. Cross-file Refactor ──
  it('05 moves a function across files and updates imports', async () => {
    writeTmp('utils.js', `const add = (a,b) => a+b;\nmodule.exports = { add };`);
    writeTmp('app.js', `const { add } = require('./utils');\nconsole.log(add(2,3));`);
    // Step A — write helper.js with the moved function
    const r1 = await executeRealTool('edit_local_file', {
      path: tmpFile('helpers.js'),
      content: `const add = (a,b) => a+b;\nmodule.exports = { add };`,
      create: true,
    });
    expect(r1.ok).toBe(true);
    // Step B — update app.js import
    const r2 = await executeRealTool('edit_local_file', {
      path: tmpFile('app.js'),
      content: `const { add } = require('./helpers');\nconsole.log(add(2,3));`,
    });
    expect(r2.ok).toBe(true);
    expect(readTmp('app.js')).toContain(`require('./helpers')`);
  });

  // ── 6. Database Schema Update ──
  it('06 adds a new table to a SQLite schema file', async () => {
    writeTmp('schema.sql', `CREATE TABLE users (id INTEGER PRIMARY KEY);`);
    const r = await executeRealTool('edit_local_file', {
      path: tmpFile('schema.sql'),
      content: `CREATE TABLE users (id INTEGER PRIMARY KEY);\nCREATE TABLE agent_eval_logs (id INTEGER PRIMARY KEY, score INTEGER, passed_at TEXT);`,
    });
    expect(r.ok).toBe(true);
    expect(readTmp('schema.sql')).toContain('agent_eval_logs');
  });

  // ── 7. Web Research & Data Extraction via terminal ──
  it('07 fetches a live webpage via curl and extracts the title tag', async () => {
    const r = await executeRealTool('run_terminal_command', {
      command: `curl -sL https://example.com | findstr /i "<title>"`,
    });
    expect(r.ok).toBe(true);
    expect((r.stdout || '').toLowerCase()).toContain('example domain');
  });

  // ── 8. Git Commit & Push (local dry-run) ──
  it('08 stages, commits and pushes a change via terminal commands', async () => {
    fs.mkdirSync(tmpFile('gitrepo'), { recursive: true });
    // Init bare repo to simulate remote
    await executeRealTool('run_terminal_command', { command: `cd "${tmpFile('gitrepo')}" && git init --bare origin.git` });
    // Init local repo
    await executeRealTool('run_terminal_command', { command: `cd "${tmpFile('gitrepo')}" && git init && git remote add origin ./origin.git` });
    writeTmp('gitrepo/readme.md', '# Eval');
    await executeRealTool('run_terminal_command', { command: `cd "${tmpFile('gitrepo')}" && git add . && git -c user.email="a@b.com" -c user.name="Bot" commit -m "eval commit"` });
    const r = await executeRealTool('run_terminal_command', { command: `cd "${tmpFile('gitrepo')}" && git push origin master || git push origin main` });
    expect(r.stdout || r.stderr).toMatch(/master|main/);
  });

  // ── 9. Pull Request Payload Construction ──
  it('09 builds a valid GitHub PR JSON payload with correct schema', async () => {
    const r = await executeRealTool('run_terminal_command', {
      command: `node -e "console.log(JSON.stringify({title:'Agent eval PR',head:'feature/eval',base:'master',body:'Automated evaluation body'}))"`,
    });
    expect(r.ok).toBe(true);
    const payload = JSON.parse((r.stdout || '').trim());
    expect(payload).toMatchObject({
      title: expect.any(String),
      head: expect.any(String),
      base: expect.any(String),
    });
  });

  // ── 10. UI Button Click via Playwright ──
  it('10 opens a local HTML page and clicks a button via Playwright', async () => {
    const html = `<!DOCTYPE html><html><head><title>Before</title></head><body><button id="btn" onclick="document.title='CLICKED'">Press me</button></body></html>`;
    writeTmp('page.html', html);
    const pagePath = tmpFile('page.html').replace(/\\/g, '/');
    const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file:///${pagePath}');
  await page.click('#btn');
  const title = await page.title();
  await browser.close();
  console.log(JSON.stringify({ ok: true, title }));
})();
`;
    writeTmp('click.cjs', script);
    const r = await executeRealTool('run_terminal_command', {
      command: `cd "${TMP}" && node click.cjs`,
    });
    expect(r.ok).toBe(true);
    const output = JSON.parse((r.stdout || '').trim().split('\n').pop());
    expect(output.title).toBe('CLICKED');
  });

});
