'use strict';
/**
 * BRAIN CHAT — Direct admin-brain conversation route
 * K1 mode: Adrian talks directly to the brain.
 * 16+ tools, approval workflow, persistent memory, full knowledge base.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../logger');
const BrainSession = require('../brain-session');
const kiraTools = require('../kira-tools');

const _pendingOps = new Map();
let _opCounter = 0;

// ═══ LOAD FILES ═══
function loadFileContent(filename) {
  try {
    const p = path.join(process.cwd(), filename);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return `(${filename} nu a fost găsit)`;
  } catch (e) {
    return `(Eroare citire ${filename}: ${e.message})`;
  }
}

// ═══ K1 SYSTEM PROMPT ═══
function getK1SystemPrompt(knowledge, raport, history) {
  var basePrompt = '';
  try { basePrompt = fs.readFileSync(path.join(__dirname, '..', 'K1_SYSTEM_PROMPT.txt'), 'utf8'); } catch(e) { basePrompt = 'Esti K1, creierul tehnic al KelionAI.'; }
  return basePrompt + '\n\n=== CE STII DESPRE PROIECT ===\n' + knowledge + '\n\n=== RAPORT ONEST ===\n' + raport + '\n\n=== ISTORIC ===\n' + history;
}

// ═══ TOOL EXECUTOR ═══
function processToolCall(toolCall) {
  const { tool, params } = toolCall;
  switch (tool) {
    case 'readFile': {
      const filePath = params.filePath || params.path;
      if (!filePath) return { result: 'Eroare: lipsește filePath' };
      try {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) return { result: `Fișier inexistent: ${filePath}` };
        const stat = fs.statSync(resolved);
        if (stat.size > 500000) return { result: `Fișier prea mare: ${stat.size} bytes (max 500KB)` };
        const content = fs.readFileSync(resolved, 'utf8');
        const lines = content.split('\n');
        if (params.startLine && params.endLine) {
          const s = Math.max(1, params.startLine) - 1,
            e = Math.min(lines.length, params.endLine);
          return {
            result: lines
              .slice(s, e)
              .map((l, i) => `${s + i + 1}: ${l}`)
              .join('\n'),
          };
        }
        return {
          result: `${filePath} (${lines.length} linii, ${stat.size}B):\n${content.slice(0, 50000)}`,
        };
      } catch (e) {
        return { result: `Eroare citire: ${e.message}` };
      }
    }
    case 'searchCode':
      return {
        result: JSON.stringify(kiraTools.projectSearch(params.query, params.path)),
      };
    case 'listFiles':
      return {
        result: JSON.stringify(kiraTools.projectTree(params.dir, params.depth)),
      };
    case 'gitStatus':
      return { result: JSON.stringify(kiraTools.gitStatus()) };
    case 'gitLog':
      return { result: JSON.stringify(kiraTools.gitLog(params.n)) };
    case 'gitDiff':
      return { result: JSON.stringify(kiraTools.gitDiff()) };
    case 'runTests':
      return { result: JSON.stringify(kiraTools.runTests(params.suite)) };
    case 'queryDB':
      return { needsAsync: true, tool: 'queryDB', params };
    case 'screenshot':
      return { needsAsync: true, tool: 'screenshot', params };
    case 'browse':
      return { needsAsync: true, tool: 'browse', params };
    case 'webSearch':
      return { needsAsync: true, tool: 'webSearch', params };
    case 'readUrl':
      return { needsAsync: true, tool: 'readUrl', params };

    case 'editFile': {
      const opId = `OP_${++_opCounter}`;
      const fp = params.filePath || params.path;
      const target = params.target || params.find;
      const replacement = params.replacement || params.replace;
      const startLine = params.startLine;
      const endLine = params.endLine;
      let cur = '';
      try {
        cur = fs.readFileSync(path.resolve(fp), 'utf8');
      } catch {
        /* ignored */
      }
      let occ = 0;
      let editFn;
      if (startLine && endLine) {
        const lines = cur.split('\n');
        const s = Math.max(0, startLine - 1);
        const e = Math.min(lines.length, endLine);
        const section = lines.slice(s, e).join('\n');
        occ = target ? section.split(target).length - 1 : 1;
        editFn = () => {
          // ── SAFE EDIT: Backup ──
          const backupDir = path.resolve('backups');
          if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
          fs.writeFileSync(path.join(backupDir, path.basename(fp) + '.' + Date.now() + '.bak'), cur, 'utf8');

          if (target && occ > 0) {
            const newSection = section.replace(target, replacement);
            const newLines = [...lines.slice(0, s), ...newSection.split('\n'), ...lines.slice(e)];
            fs.writeFileSync(path.resolve(fp), newLines.join('\n'), 'utf8');
          } else if (!target) {
            const newLines = [...lines.slice(0, s), ...replacement.split('\n'), ...lines.slice(e)];
            fs.writeFileSync(path.resolve(fp), newLines.join('\n'), 'utf8');
            occ = 1;
          } else {
            return { success: false, error: 'Text negăsit în range' };
          }

          // ── SAFE EDIT: Syntax check + rollback ──
          if (fp.endsWith('.js')) {
            try {
              execSync(`node --check "${path.resolve(fp)}"`, { timeout: 5000 });
            } catch (syntaxErr) {
              fs.writeFileSync(path.resolve(fp), cur, 'utf8');
              return { success: false, error: `Syntax error — ROLLBACK: ${syntaxErr.message.substring(0, 200)}` };
            }
          }
          return { success: true, file: fp, backup: true };
        };
      } else {
        occ = target ? cur.split(target).length - 1 : 0;
        editFn = () => {
          if (!target || occ === 0) return { success: false, error: 'Text negăsit' };
          // ── SAFE EDIT: Backup ──
          const backupDir = path.resolve('backups');
          if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
          fs.writeFileSync(path.join(backupDir, path.basename(fp) + '.' + Date.now() + '.bak'), cur, 'utf8');

          fs.writeFileSync(path.resolve(fp), cur.replace(target, replacement), 'utf8');

          // ── SAFE EDIT: Syntax check + rollback ──
          if (fp.endsWith('.js')) {
            try {
              execSync(`node --check "${path.resolve(fp)}"`, { timeout: 5000 });
            } catch (syntaxErr) {
              fs.writeFileSync(path.resolve(fp), cur, 'utf8');
              return { success: false, error: `Syntax error — ROLLBACK: ${syntaxErr.message.substring(0, 200)}` };
            }
          }
          return { success: true, file: fp, backup: true };
        };
      }
      _pendingOps.set(opId, {
        type: 'editFile',
        preview: {
          file: fp,
          find: (target || '').slice(0, 500),
          replace: (replacement || '').slice(0, 500),
          occ,
          startLine,
          endLine,
        },
        execute: editFn,
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nEdit: ${fp}${startLine ? ` (L${startLine}-${endLine})` : ''}\nFind: ${(target || '').slice(0, 200)}\nReplace: ${(replacement || '').slice(0, 200)}\n(${occ} potriviri)\n💾 Auto-backup activat`,
        preview: _pendingOps.get(opId).preview,
      };
    }
    // ── GIT RESTORE — K1 poate restaura fișiere corupte ──
    case 'gitRestore': {
      const fp = params.filePath || params.path;
      if (!fp) return { result: 'Eroare: lipsește filePath' };
      try {
        execSync(`git checkout HEAD -- "${fp}"`, { cwd: process.cwd(), timeout: 10000 });
        const restored = fs.readFileSync(path.resolve(fp), 'utf8');
        return { result: `✅ Fișier restaurat din git: ${fp} (${restored.length} chars, ${restored.split('\n').length} linii)` };
      } catch (e) {
        return { result: `❌ Restaurare eșuată: ${e.message}` };
      }
    }
    case 'writeFile': {
      const opId = `OP_${++_opCounter}`;
      const fp = params.filePath || params.path,
        content = params.content;
      let cur = '';
      try {
        cur = fs.readFileSync(path.resolve(fp), 'utf8');
      } catch {
        /* new file */
      }

      // ── SAFE WRITE GUARD 1: Truncation check ──
      if (cur.length > 100 && content && content.length < cur.length * 0.5) {
        return {
          result: `🛑 BLOCAT: Noul conținut (${content.length} chars) e mai mic de 50% din originalul (${cur.length} chars). Risc de corupție. Folosește editFile pentru modificări parțiale.`
        };
      }

      _pendingOps.set(opId, {
        type: 'writeFile',
        preview: {
          file: fp,
          curLen: cur.length,
          newLen: (content || '').length,
          truncationRisk: cur.length > 100 && (content || '').length < cur.length * 0.7,
        },
        execute: () => {
          // ── SAFE WRITE GUARD 2: Auto-backup ──
          if (cur.length > 0) {
            const backupDir = path.resolve('backups');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupName = path.basename(fp) + '.' + Date.now() + '.bak';
            fs.writeFileSync(path.join(backupDir, backupName), cur, 'utf8');
            logger.info({ component: 'K1-SafeWrite', file: fp, backup: backupName }, '💾 Backup created');
          }

          const d = path.dirname(path.resolve(fp));
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.resolve(fp), content, 'utf8');

          // ── SAFE WRITE GUARD 3: Syntax check (.js files) ──
          if (fp.endsWith('.js')) {
            try {
              execSync(`node --check "${path.resolve(fp)}"`, { timeout: 5000 });
            } catch (syntaxErr) {
              // ROLLBACK
              fs.writeFileSync(path.resolve(fp), cur, 'utf8');
              logger.warn({ component: 'K1-SafeWrite', file: fp }, '🔄 ROLLBACK: Syntax error detected');
              return { success: false, error: `Syntax error detected — ROLLBACK applied: ${syntaxErr.message.substring(0, 200)}` };
            }
          }

          // ── SAFE WRITE GUARD 4: Verify write ──
          const written = fs.readFileSync(path.resolve(fp), 'utf8');
          if (written.length !== content.length) {
            fs.writeFileSync(path.resolve(fp), cur, 'utf8');
            return { success: false, error: `Write verification failed (${written.length} vs ${content.length}) — ROLLBACK applied` };
          }

          return { success: true, file: fp, size: content.length, backup: true };
        },
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nScrie: ${fp} (${(content || '').length} chars, original: ${cur.length} chars)\n${cur.length > 100 && (content || '').length < cur.length * 0.7 ? '⚠️ ATENȚIE: Fișierul se micșorează semnificativ!' : '✅ Dimensiune OK'}`,
        preview: _pendingOps.get(opId).preview,
      };
    }
    case 'runCommand': {
      const opId = `OP_${++_opCounter}`;
      const cmd = params.command || params.cmd;
      _pendingOps.set(opId, {
        type: 'runCommand',
        preview: { command: cmd },
        execute: () => {
          try {
            const out = execSync(cmd, {
              timeout: 30000,
              encoding: 'utf8',
              maxBuffer: 1024 * 1024,
              cwd: process.cwd(),
            });
            return { success: true, output: (out || '').slice(0, 20000) };
          } catch (e) {
            return {
              success: false,
              error: e.message,
              output: ((e.stdout || '') + (e.stderr || '')).slice(0, 10000),
            };
          }
        },
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nComandă: ${cmd}`,
      };
    }
    case 'deploy': {
      const opId = `OP_${++_opCounter}`;
      _pendingOps.set(opId, {
        type: 'deploy',
        preview: { action: 'railway up' },
        execute: () => {
          try {
            const out = execSync('npx -y @railway/cli up --detach 2>&1', {
              timeout: 120000,
              encoding: 'utf8',
              maxBuffer: 2 * 1024 * 1024,
              cwd: process.cwd(),
            });
            return { success: true, output: (out || '').slice(0, 10000) };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
      });
      return {
        pendingApproval: true,
        opId,
        message: '⚠️ APROBARE\nDeploy pe Railway?',
      };
    }
    case 'browseWithAuth': {
      const opId = `OP_${++_opCounter}`;
      _pendingOps.set(opId, {
        type: 'browseWithAuth',
        params,
        preview: { url: params.url, actions: params.actions },
        execute: async () => {
          let puppeteer;
          try {
            puppeteer = require('puppeteer');
          } catch {
            return { success: false, error: 'Puppeteer nu e instalat' };
          }
          let browser;
          try {
            browser = await puppeteer.launch({
              headless: 'new',
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
              timeout: 30000,
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            await page.goto(params.url, {
              waitUntil: 'networkidle2',
              timeout: 30000,
            });
            const results = [];
            if (params.actions && Array.isArray(params.actions)) {
              for (const a of params.actions) {
                try {
                  if (a.type === 'fill') {
                    await page.waitForSelector(a.selector, { timeout: 5000 });
                    await page.type(a.selector, a.value, { delay: 50 });
                    results.push({ action: 'fill', ok: true });
                  } else if (a.type === 'click') {
                    await page.waitForSelector(a.selector, { timeout: 5000 });
                    await page.click(a.selector);
                    await page.waitForTimeout(2000);
                    results.push({ action: 'click', ok: true });
                  } else if (a.type === 'wait') {
                    await page.waitForTimeout(a.ms || 2000);
                    results.push({ action: 'wait', ok: true });
                  } else if (a.type === 'select') {
                    await page.select(a.selector, a.value);
                    results.push({ action: 'select', ok: true });
                  }
                } catch (e) {
                  results.push({ action: a.type, ok: false, error: e.message });
                }
              }
            }
            const content = await page.evaluate(() => ({
              title: document.title,
              url: window.location.href,
              text: document.body?.innerText?.slice(0, 15000) || '',
            }));
            await browser.close();
            return { success: true, ...content, actions: results };
          } catch (e) {
            if (browser) await browser.close().catch(() => {});
            return { success: false, error: e.message };
          }
        },
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nBrowser: ${params.url}\nAcțiuni: ${JSON.stringify(params.actions || []).slice(0, 300)}`,
        preview: _pendingOps.get(opId).preview,
      };
    }
    case 'mutateDB': {
      const opId = `OP_${++_opCounter}`;
      _pendingOps.set(opId, {
        type: 'mutateDB',
        params,
        preview: {
          table: params.table,
          op: params.operation,
          data: params.data,
        },
        execute: null,
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nDB ${params.operation} pe ${params.table}`,
      };
    }
    // #15 IMAGE GENERATION — DALL-E via OpenAI
    case 'generateImage': {
      return { needsAsync: true, tool: 'generateImage', params };
    }
    case 'verifyFile': {
      const fp = params.filePath || params.path;
      if (!fp) return { result: 'Eroare: lipseste filePath' };
      try {
        const resolved = path.resolve(fp);
        if (!fs.existsSync(resolved)) return { result: 'Fisier inexistent: ' + fp };
        const content = fs.readFileSync(resolved, 'utf8');
        const lines = content.split('\n').length;
        const size = content.length;
        let syntaxOk = 'N/A';
        if (fp.endsWith('.js')) {
          try { execSync('node --check "' + resolved + '"', { timeout: 5000 }); syntaxOk = 'OK'; }
          catch (e) { syntaxOk = 'EROARE: ' + (e.message || '').substring(0, 200); }
        }
        return { result: 'Verificare ' + fp + ': ' + size + ' chars, ' + lines + ' linii, syntax: ' + syntaxOk };
      } catch (e) { return { result: 'Eroare verificare: ' + e.message }; }
    }
    case 'autoRepair': {
      const task = params.task || params.description || 'fix';
      const fp = params.filePath || params.path;
      if (!fp) return { result: 'Eroare: lipseste filePath' };
      return { needsAsync: true, tool: 'autoRepair', params: { task, filePath: fp } };
    }
    default:
      return { result: 'Tool necunoscut: ' + tool };
  }
}


// ═══ AUTO-REPAIR PIPELINE — 5 AI Models ═══
async function callAIProvider(provider, system, message) {
  var key, url, body, headers;
  switch (provider) {
    case 'groq':
      key = process.env.GROQ_API_KEY;
      if (!key) return null;
      url = 'https://api.groq.com/openai/v1/chat/completions';
      body = JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 2048 });
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      break;
    case 'deepseek':
      key = process.env.DEEPSEEK_API_KEY;
      if (!key) return null;
      url = 'https://api.deepseek.com/v1/chat/completions';
      body = JSON.stringify({ model: 'deepseek-coder', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 2048 });
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      break;
    case 'claude-haiku':
      key = process.env.ANTHROPIC_API_KEY;
      if (!key) return null;
      url = 'https://api.anthropic.com/v1/messages';
      body = JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 2048, system: system, messages: [{ role: 'user', content: message }] });
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      break;
    case 'gpt54':
      key = process.env.OPENAI_API_KEY;
      if (!key) return null;
      url = 'https://api.openai.com/v1/chat/completions';
      body = JSON.stringify({ model: 'gpt-5.4', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_completion_tokens: 4096 });
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      break;
    case 'claude-opus':
      key = process.env.ANTHROPIC_API_KEY;
      if (!key) return null;
      url = 'https://api.anthropic.com/v1/messages';
      body = JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, system: system, messages: [{ role: 'user', content: message }] });
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      break;
    default: return null;
  }
  try {
    var r = await fetch(url, { method: 'POST', headers: headers, body: body, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return '[' + provider + ' eroare ' + r.status + ']';
    var d = await r.json();
    if (d.choices) return d.choices[0].message.content;
    if (d.content) return d.content[0].text;
    return null;
  } catch (e) { return '[' + provider + ' timeout: ' + e.message + ']'; }
}

async function autoRepairPipeline(task, filePath) {
  var log = [];
  log.push('=== AUTO-REPAIR PIPELINE START ===');
  log.push('Task: ' + task);
  log.push('File: ' + filePath);

  var fileContent = '';
  try { fileContent = fs.readFileSync(path.resolve(filePath), 'utf8'); }
  catch (e) { log.push('FAIL: Nu pot citi fisierul: ' + e.message); return log.join('\n'); }

  // STEP 1: Groq — Diagnostic rapid
  log.push('\n--- STEP 1: Groq DIAGNOSTIC ---');
  var diagPrompt = 'Esti expert in diagnosticare bug-uri. Analizeaza si identifica EXACT ce e gresit. Raspunde SCURT: (1) Problema (2) Linia/valorile (3) De ce.';
  var diag = await callAIProvider('groq', diagPrompt, 'TASK: ' + task + '\nFISIER: ' + filePath + '\nCOD:\n' + fileContent.substring(0, 8000));
  log.push('Groq: ' + (diag || 'SKIP'));

  // STEP 2: DeepSeek — Analiza tehnica
  log.push('\n--- STEP 2: DeepSeek ANALIZA ---');
  var analysisPrompt = 'Propune EXACT ce modificari. Raspunde cu JSON: {"target":"text vechi EXACT","replacement":"text nou","justification":"de ce"}';
  var analysis = await callAIProvider('deepseek', analysisPrompt, 'DIAGNOSTIC:\n' + (diag || '') + '\nCOD:\n' + fileContent.substring(0, 8000));
  if (!analysis) analysis = await callAIProvider('gpt54', analysisPrompt, 'DIAGNOSTIC:\n' + (diag || '') + '\nCOD:\n' + fileContent.substring(0, 8000));
  log.push('DeepSeek: ' + (analysis || 'SKIP'));

  // STEP 3: Claude Haiku — Validare
  log.push('\n--- STEP 3: Claude Haiku VALIDARE ---');
  var validatePrompt = 'Verifica fix-ul: (1) Nu corupe (2) Valori in range (3) Nu afecteaza alte functii. Raspunde: SAFE sau UNSAFE + motiv.';
  var validation = await callAIProvider('claude-haiku', validatePrompt, 'FIX:\n' + (analysis || '') + '\nCOD:\n' + fileContent.substring(0, 5000));
  if (!validation) validation = 'SAFE (skip - API indisponibil)';
  log.push('Haiku: ' + validation);

  if (validation && validation.toUpperCase().includes('UNSAFE')) {
    log.push('\nABORT: Fix marcat UNSAFE');
    return log.join('\n');
  }

  // STEP 4: GPT-5.4 — Executie
  log.push('\n--- STEP 4: GPT-5.4 EXECUTIE ---');
  var execPrompt = 'Genereaza EXACT un JSON de editare. Format STRICT:\n{"tool":"editFile","params":{"filePath":"' + filePath + '","target":"TEXT VECHI EXACT","replacement":"TEXT NOU"}}\nUn singur JSON, nimic altceva.';
  var execution = await callAIProvider('gpt54', execPrompt, 'DIAGNOSTIC:\n' + (diag || '') + '\nANALIZA:\n' + (analysis || '') + '\nVALIDARE:\n' + (validation || '') + '\nCOD:\n' + fileContent.substring(0, 8000));
  log.push('GPT-5.4: ' + (execution || 'FAIL'));

  var editResult = 'Nu s-a executat';
  try {
    var jsonMatch = (execution || '').match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
    if (jsonMatch) {
      var editCmd = JSON.parse(jsonMatch[0]);
      var toolResult = processToolCall(editCmd);
      editResult = toolResult.result || toolResult.message || JSON.stringify(toolResult);
      log.push('Executie: ' + editResult);
    } else { log.push('FAIL: Nu am gasit JSON valid'); }
  } catch (e) { log.push('FAIL: ' + e.message); }

  // STEP 5: Claude Opus — Verificare finala
  log.push('\n--- STEP 5: Claude Opus VERIFICARE ---');
  var newContent = '';
  try { newContent = fs.readFileSync(path.resolve(filePath), 'utf8'); } catch (e) { newContent = 'EROARE'; }
  var verifyPrompt = 'Compara INAINTE si DUPA. Verifica: (1) Edit aplicat corect (2) Syntax OK (3) Nu s-a pierdut cod. Raspunde: PASS sau FAIL + detalii.';
  var verify = await callAIProvider('claude-opus', verifyPrompt, 'INAINTE:\n' + fileContent.substring(0, 4000) + '\nDUPA:\n' + newContent.substring(0, 4000) + '\nEDIT: ' + editResult);
  if (!verify) verify = await callAIProvider('gpt54', verifyPrompt, 'INAINTE:\n' + fileContent.substring(0, 4000) + '\nDUPA:\n' + newContent.substring(0, 4000));
  log.push('Opus: ' + (verify || 'SKIP'));

  if (verify && verify.toUpperCase().includes('FAIL')) {
    log.push('\nROLLBACK: Verificare esuata');
    var restoreResult = processToolCall({ tool: 'restoreBackup', params: { filePath: filePath } });
    log.push('Restore: ' + (restoreResult.result || JSON.stringify(restoreResult)));
  }

  log.push('\n=== AUTO-REPAIR PIPELINE END ===');
  return log.join('\n');
}


// ═══ AI PROVIDERS ═══
async function callK1(systemPrompt, userMessage) {
  for (const p of [
    { name: 'GPT-5.4', fn: () => callOpenAI(systemPrompt, userMessage) },
    { name: 'gemini', fn: () => callGemini(systemPrompt, userMessage) },
  ]) {
    try {
      const r = await p.fn();
      if (r) return { text: r, provider: p.name };
    } catch (e) {
      logger.warn({ component: 'K1', provider: p.name, err: e.message }, 'K1 provider failed');
    }
  }
  return { text: 'Eroare: niciun provider AI disponibil.', provider: 'none' };
}

async function callGemini(system, message) {
  const key = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: message }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callOpenAI(system, message) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      max_completion_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content || null;
}

// ═══ ROUTES ═══
let _session = null;
function getSession(supabase) {
  if (!_session) _session = new BrainSession(supabase);
  return _session;
}

// POST /api/admin/brain-chat
router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mesaj gol' });
    const sid = sessionId || `session_${Date.now()}`;
    const supabase = req.app?.locals?.supabase || null;
    const session = getSession(supabase);
    const currentSession = await session.getSession(sid);
    await session.addMessage(sid, 'user', message);

    const knowledge = loadFileContent('K1_KNOWLEDGE.md');
    const raport = loadFileContent('RAPORT_ONEST.md');
    const history = session.buildHistory(currentSession, 30);
    let systemPrompt = getK1SystemPrompt(knowledge, raport, history);

    // ── WORKING MEMORY: Injectează context de task-uri neterminate + golden knowledge ──
    const brain = req.app?.locals?.brain;
    if (brain) {
      try {
        // 1. Resume context — task-uri neterminate
        const resumeCtx = await brain.buildResumeContext('24eaf533-0af5-4871-9c74-91e123936397');
        if (resumeCtx) {
          systemPrompt += resumeCtx;
          logger.info({ component: 'K1-WorkingMemory' }, '📋 Resume context injected into K1');
        }
        // 2. Golden knowledge relevant pentru mesajul curent
        const relevantKnowledge = brain.getRelevantKnowledge(message);
        if (relevantKnowledge.length > 0) {
          systemPrompt += '\n\n═══ GOLDEN KNOWLEDGE RELEVANT ═══\n' +
            relevantKnowledge.join('\n') + '\n═══════════════════════════════\n';
        }
        // 3. Lecții din erori anterioare
        if (brain._errorLog && brain._errorLog.length > 0) {
          const recentLessons = brain._errorLog.slice(-3);
          systemPrompt += '\n\n═══ LECȚII RECENTE DIN ERORI ═══\n' +
            recentLessons.map(l => `- ${l.context}: ${l.pattern} → ${l.resolution || 'neremediat'}`).join('\n') +
            '\n═══════════════════════════════\n';
        }
      } catch { /* non-blocking */ }
    }

    let response = await callK1(systemPrompt, message);

    // === #12 ANTI-GENERIC FILTER ===
    const BANNED = [
      'spune-mi ce vrei',
      'ce aspect dore',
      'pot ajuta',
      'te pot ajuta',
      'nu e practic',
      'nu pot afisa',
      'nu am capacitat',
      'cum doresti',
      'te rog sa specifici',
      'sunt aici pentru',
      'nu este practic',
      'ce anume vrei',
      'cum vrei sa procedam',
    ];
    const low = response.text.toLowerCase();
    if (BANNED.some((p) => low.includes(p)) && !response.text.includes('```json')) {
      logger.warn({ component: 'K1' }, 'Generic response blocked, retrying');
      const force =
        systemPrompt +
        '\n\nRASPUNSUL ANTERIOR A FOST BLOCAT. EXECUTA DIRECT: "' +
        message +
        '". Foloseste TOOL-URI (readFile, searchCode, listFiles). Raspunde cu FAPTE si COD, nu cu vorbe.';
      response = await callK1(force, message);
    }

    // #16 MULTIPLE TOOL CALLS — parsează TOATE blocurile json
    let toolResult = null;
    const allToolMatches = [...response.text.matchAll(/```json\s*(\{[\s\S]*?"tool"[\s\S]*?\})\s*```/g)];
    const toolResults = [];
    for (const toolMatch of allToolMatches) {
      try {
        const toolCall = JSON.parse(toolMatch[1]);
        let tr = processToolCall(toolCall);
        if (tr.needsAsync) {
          if (tr.tool === 'queryDB' && supabase) {
            const { data, error } = await supabase
              .from(tr.params.table)
              .select(tr.params.select || '*')
              .limit(tr.params.limit || 20);
            tr = {
              result: JSON.stringify({ data, error: error?.message }, null, 2),
            };
          } else if (tr.tool === 'screenshot') {
            tr = {
              result: JSON.stringify(await kiraTools.renderPage(tr.params.url, { screenshot: true })),
            };
          } else if (tr.tool === 'browse') {
            tr = {
              result: JSON.stringify(
                await kiraTools.renderPage(tr.params.url, {
                  screenshot: false,
                })
              ),
            };
          } else if (tr.tool === 'webSearch') {
            const sk = process.env.SERPER_API_KEY;
            if (sk) {
              const sr = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-KEY': sk,
                },
                body: JSON.stringify({ q: tr.params.query, num: 10 }),
              });
              tr = {
                result: JSON.stringify(await sr.json(), null, 2).slice(0, 10000),
              };
            } else {
              tr = { result: 'SERPER_API_KEY lipsește' };
            }
          } else if (tr.tool === 'autoRepair') {
            tr = { result: await autoRepairPipeline(tr.params.task, tr.params.filePath) };
          } else if (tr.tool === 'readUrl') {
            tr = {
              result: JSON.stringify(await kiraTools.scrapeUrl(tr.params.url), null, 2).slice(0, 15000),
            };
          } else if (tr.tool === 'generateImage') {
            // #15 IMAGE GENERATION
            const imgKey = process.env.OPENAI_API_KEY;
            if (imgKey) {
              const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${imgKey}`,
                },
                body: JSON.stringify({
                  model: 'dall-e-3',
                  prompt: tr.params.prompt,
                  n: 1,
                  size: tr.params.size || '1024x1024',
                }),
              });
              const imgData = await imgRes.json();
              tr = {
                result: JSON.stringify({
                  url: imgData.data?.[0]?.url,
                  revised_prompt: imgData.data?.[0]?.revised_prompt,
                }),
              };
            } else {
              tr = { result: 'OPENAI_API_KEY lipsește pentru imagini' };
            }
          }
        }
        toolResults.push(tr);
      } catch (e) {
        toolResults.push({ result: `Eroare tool: ${e.message}` });
      }
    }
    // Combină rezultatele
    if (toolResults.length === 1) toolResult = toolResults[0];
    else if (toolResults.length > 1)
      toolResult = {
        result: toolResults.map((tr, i) => `[Tool ${i + 1}] ${tr.result || tr.message || 'OK'}`).join('\n\n'),
      };

    let brainMessage = toolResult?.pendingApproval
      ? `${response.text}\n\n---\n${toolResult.message}`
      : toolResult?.result
        ? `${response.text}\n\n---\nRezultat:\n${typeof toolResult.result === 'string' ? toolResult.result.slice(0, 5000) : JSON.stringify(toolResult.result).slice(0, 5000)}`
        : response.text;

    // === #13 TRUTH CHECK ===
    // Regex stricter: doar referințe valide de fișiere (fără prefixe false ca "n./")
    const fileRefs = brainMessage.match(/(?:^|[\s"'(,])([a-zA-Z][\w\-./]*\.(?:js|ts|html|css|json|md))\b/gi) || [];
    const tw = [];
    const cwd = process.cwd();
    for (const raw of [...new Set(fileRefs)].slice(0, 5)) {
      const f = raw.replace(/^[\s"'(,]+/, ''); // curăță prefix
      if (f.length < 3 || f.startsWith('n.') || f.startsWith('..')) continue; // skip invalid
      const c = [
        path.resolve(cwd, f),
        path.resolve(cwd, 'server', f),
        path.resolve(cwd, 'app', f),
        path.resolve(cwd, 'app/js', f),
        path.resolve(cwd, 'server/routes', f),
        path.resolve(cwd, 'server/config', f),
      ];
      if (!c.some((p) => fs.existsSync(p))) tw.push('TRUTH: "' + f + '" NU EXISTA pe disc.');
    }
    if (tw.length > 0) brainMessage += '\n\n---\n' + tw.join('\n');

    await session.addMessage(sid, 'brain', brainMessage);

    // ── SELF-LEARNING: K1 învață din brain-chat (scris + vorbit) ──
    if (brain) {
      brain._learnFromResponse(message, brainMessage, {
        toolsUsed: toolResults.map(t => t.tool || 'unknown'),
        hadError: brainMessage.includes('Eroare') || brainMessage.includes('❌')
      }, '24eaf533-0af5-4871-9c74-91e123936397').catch(() => {});
      // Salvează în memorie persistentă ce s-a discutat
      brain.saveMemory('24eaf533-0af5-4871-9c74-91e123936397', 'conversation',
        `[BRAIN-CHAT] User: ${message.substring(0, 200)} | K1: ${brainMessage.substring(0, 300)}`,
        { source: 'brain-chat', sessionId: sid }
      ).catch(() => {});
    }

    res.json({
      reply: brainMessage,
      provider: response.provider,
      sessionId: sid,
      toolResult: toolResult || null,
      pendingApproval: toolResult?.pendingApproval ? { opId: toolResult.opId, preview: toolResult.preview } : null,
    });
  } catch (e) {
    logger.error({ component: 'K1', err: e.message, stack: e.stack }, 'K1 chat error');
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/brain-chat/history
router.get('/history', async (req, res) => {
  try {
    const s = getSession(req.app?.locals?.supabase);
    res.json({ sessions: await s.listSessions() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/brain-chat/session/:id
router.get('/session/:id', async (req, res) => {
  try {
    const s = getSession(req.app?.locals?.supabase);
    res.json(await s.getSession(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/brain-chat/approve
router.post('/approve', async (req, res) => {
  try {
    const { opId } = req.body;
    if (!opId) return res.status(400).json({ error: 'lipsește opId' });
    const op = _pendingOps.get(opId);
    if (!op) return res.status(404).json({ error: `Op ${opId} nu există` });
    const result = op.execute
      ? typeof op.execute === 'function'
        ? await op.execute()
        : op.execute
      : { error: 'No executor' };
    _pendingOps.delete(opId);
    logger.info({ component: 'K1', opId, type: op.type }, `✅ Approved: ${op.type}`);
    res.json({ approved: true, opId, type: op.type, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/brain-chat/reject
router.post('/reject', async (req, res) => {
  try {
    const { opId } = req.body;
    if (!opId) return res.status(400).json({ error: 'lipsește opId' });
    const op = _pendingOps.get(opId);
    if (!op) return res.status(404).json({ error: `Op ${opId} nu există` });
    _pendingOps.delete(opId);
    logger.info({ component: 'K1', opId, type: op.type }, `❌ Rejected: ${op.type}`);
    res.json({ rejected: true, opId, type: op.type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
