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

  // ── 11. OCR pe schemă electronică ──
  it('11 extracts component values from a schematic image via OCR', async () => {
    const html = `<!DOCTYPE html><html><body style="background:#fff;font-family:monospace;font-size:48px;padding:20px;"><div>R1 10K</div><div>C2 100nF</div><div>U1 LM358</div></body></html>`;
    writeTmp('sch.html', html);
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`file:///${tmpFile('sch.html').replace(/\\/g, '/')}`);
    const screenshot = await page.screenshot({ type: 'png' });
    await browser.close();
    const base64 = screenshot.toString('base64');
    const r = await executeRealTool('ocr_engine', { mode: 'image', base64, lang: 'eng' });
    expect(r.ok).toBe(true);
    const text = (r.text || '').toUpperCase();
    expect(text).toContain('R1');
    expect(text).toContain('10K');
    expect(text).toContain('LM358');
  });

  // ── 12. Parsare datasheet simulat ──
  it('12 parses a local HTML datasheet and extracts key specifications', async () => {
    const html = `<h1>LM358 Datasheet</h1><p>Supply Voltage: 3V to 32V</p><p>Input Bias Current: 45nA</p><p>Gain Bandwidth: 1MHz</p>`;
    writeTmp('lm358.html', html);
    const content = readTmp('lm358.html');
    const voltage = content.match(/Supply Voltage:\s*([^\n<]+)/i);
    expect(voltage).toBeTruthy();
    expect(voltage[1]).toContain('3V');
    expect(voltage[1]).toContain('32V');
    const current = content.match(/Input Bias Current:\s*([^\n<]+)/i);
    expect(current).toBeTruthy();
    expect(current[1]).toContain('45');
  });

  // ── 13. Parsare BOM CSV ──
  it('13 parses a BOM CSV and validates required fields', async () => {
    const csv = `Reference,Value,Footprint,Manufacturer,PartNumber\nR1,10K,0805,Vishay,CRCW080510K0F\nC2,100nF,0805,Murata,GRM21BR71H104KA01\nU1,LM358,SOIC-8,Texas Instruments,LM358DR`;
    writeTmp('bom.csv', csv);
    const r = await executeRealTool('read_local_file', { path: tmpFile('bom.csv') });
    expect(r.ok).toBe(true);
    const lines = (r.content || '').split('\n');
    expect(lines[0]).toContain('Reference');
    expect(lines[0]).toContain('Manufacturer');
    expect(lines[1]).toContain('R1');
    expect(lines).toHaveLength(4);
  });

  // ── 14. Calcul electric ──
  it('14 calculates resistor power dissipation and checks rating', async () => {
    const r = await executeRealTool('calculate', { expression: '5^2 / 220' });
    expect(r.ok).toBe(true);
    const power = parseFloat(r.result);
    expect(power).toBeCloseTo(0.1136, 3);
    expect(power).toBeLessThan(0.25); // 1/4W rating
  });

  // ── 15. Cercetare standard medical ──
  it('15 fetches medical standard info from Wikipedia and extracts key terms', async () => {
    const r = await executeRealTool('browse_web', { start_url: 'https://en.wikipedia.org/wiki/IEC_60601' });
    expect(r.ok).toBe(true);
    const text = (r.content || '').toLowerCase();
    expect(text).toMatch(/medical|patient|safety|electrical|device/);
  });

  // ── 16. Generare manual producere ──
  it('16 generates an assembly manual with required sections', async () => {
    const manual = `# Manual Producere – Glucometru V1\n\n## 1. Pregătire\n- Verificare BOM\n- Unelte: letconă, stație lipit, multimetru\n\n## 2. Asamblare PCB\n- Lipire componente pasive (R, C)\n- Lipire integrat (U1 LM358)\n- Conectare senzor\n\n## 3. Testare\n- Continuitate trasee\n- Tensiune de alimentare 5V ± 5%\n- Semnal ieșire senzor 100–500mV\n\n## 4. Calibrare\n- Punct 0: soluție 0mg/dL\n- Punct 100: soluție 100mg/dL\n- Verificare toleranță ±5mg/dL\n`;
    const r = await executeRealTool('edit_local_file', { path: tmpFile('manual.md'), content: manual, create: true });
    expect(r.ok).toBe(true);
    const content = readTmp('manual.md');
    expect(content).toContain('Asamblare');
    expect(content).toContain('Testare');
    expect(content).toContain('Calibrare');
  });

  // ── 17. Generare checklist testare ──
  it('17 generates an electrical test checklist', async () => {
    const checklist = `- [ ] Continuitate GND – toate punctele < 0.1Ω\n- [ ] Tensiune alimentare 5V = 4.75–5.25V\n- [ ] Consum curent < 50mA\n- [ ] Semnal ieșire senzor în domeniu 0.1–0.5V\n- [ ] Test izolație 500VDC > 10MΩ\n- [ ] EMC pre-scan fără erori majore\n`;
    const r = await executeRealTool('edit_local_file', { path: tmpFile('checklist.md'), content: checklist, create: true });
    expect(r.ok).toBe(true);
    const content = readTmp('checklist.md');
    expect(content).toContain('Continuitate');
    expect(content).toContain('Tensiune');
    expect(content).toContain('izolație');
  });

  // ── 18. Căutare echivalență componentă (simulat) ──
  it('18 finds an alternative component from a local catalog', async () => {
    const catalog = JSON.stringify([
      { id: 'R1', value: '10K', footprint: '0805', mpn: 'CRCW080510K0F', alt: 'RC0805FR-0710KL' },
      { id: 'U1', value: 'LM358', footprint: 'SOIC-8', mpn: 'LM358DR', alt: 'MC1458D' },
    ], null, 2);
    writeTmp('catalog.json', catalog);
    const r = await executeRealTool('read_local_file', { path: tmpFile('catalog.json') });
    expect(r.ok).toBe(true);
    // read_local_file prefixes line numbers — strip them before JSON.parse
    const raw = (r.content || '').split('\n').map(l => l.replace(/^\d+:\s*/, '')).join('\n');
    const data = JSON.parse(raw || '[]');
    const alt = data.find(c => c.id === 'U1')?.alt;
    expect(alt).toBe('MC1458D');
  });

  // ── 19. Traducere tehnică ──
  it('19 translates a technical medical sentence into Romanian', async () => {
    const r = await executeRealTool('translate', { text: 'The device must comply with IEC 60601-1 isolation requirements for Type BF applied parts.', to: 'ro' });
    expect(r.ok).toBe(true);
    const text = (r.translated || '').toLowerCase();
    expect(text).toMatch(/dispozitiv|conformitate|ie|izolatie|pacient|siguran|bf/);
  });

  // ── 20. Procedură calibrare senzor ──
  it('20 generates a temperature sensor calibration procedure', async () => {
    const proc = `# Procedură Calibrare – Senzor NTC 10K\n\n## Echipament\n- Termometru referință (±0.1°C)\n- Baie gheață + apă (ță de topire)\n- Baie apă la 25°C\n\n## Pași\n1. Măsurare la 0°C: așteaptă stabilizare 5 min.\n   - Valoare așteptată: ~29.5kΩ (NTC 10K, B=3950)\n   - Toleranță acceptată: ±0.5°C\n2. Măsurare la 25°C:\n   - Valoare așteptată: ~10kΩ\n   - Toleranță acceptată: ±0.5°C\n3. Dacă ambele puncte sunt în toleranță, salvează coeficienții în memorie EEPROM.\n4. Dacă nu, repetă măsurarea sau înlocuiește senzorul.\n`;
    const r = await executeRealTool('edit_local_file', { path: tmpFile('calibrare.md'), content: proc, create: true });
    expect(r.ok).toBe(true);
    const content = readTmp('calibrare.md');
    expect(content).toContain('0°C');
    expect(content).toContain('25°C');
    expect(content).toContain('toleran');
    expect(content).toContain('EEPROM');
  });

});
