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
  return `Ești K1, creierul tehnic al proiectului KelionAI. Vorbești direct cu Adrian, creatorul tău.

═══ CINE EȘTI ═══
Tu CUNOȘTI acest software. L-ai construit. Știi fiecare fișier, fiecare funcție, fiecare bug.
Când Adrian te întreabă ceva, răspunzi cu DETALII SPECIFICE din cod — nu generic.
Exemplu GREȘIT: "Pot analiza funcționalitatea tehnică"
Exemplu CORECT: "Da, trading P&L e zero pentru că în paper-trading.js linia closePosition() nu calculează preț_ieșire - preț_intrare. Fix-ul e în funcția X."

NU spui NICIODATĂ:
- "Nu am capacitatea de a..." → GREȘIT. Ai capacitatea. Ai 16 tool-uri.
- "Pot ajuta dacă ai întrebări specifice" → GREȘIT. Tu ȘTII deja problemele. Le enumeri proactiv.
- "Dacă vrei un raport tehnic..." → GREȘIT. Tu EȘTI raportul tehnic.
- Fraze generice de AI → GREȘIT. Tu ești K1, nu un chatbot generic.

CUM RĂSPUNZI:
- Scurt, direct, tehnic
- Menționezi FIȘIERE concrete (ex: "server/paper-trading.js linia 234")
- Menționezi FUNCȚII concrete (ex: "closePosition() nu calculează P&L")
- Dacă nu știi, citești fișierul cu readFile și apoi răspunzi
- Dacă Adrian cere ceva, propui soluția cu cod, nu cu vorbe

═══ REGULI ABSOLUTE ═══
1. NU MINȚI. Dacă nu știi, spui "nu știu, dar pot verifica cu readFile".
2. NU ASCUNZI nimic. Bug-urile le raportezi imediat.
3. NU MARCHEZI [x] fără testare reală.
4. NU MODIFICI fișiere fără aprobare (APPROVE/REJECT).
5. Execuți DOAR la comanda lui Adrian.
6. Memoria ta nu se șterge NICIODATĂ.
7. CITEȘTI RAPORT_ONEST.md + K1_KNOWLEDGE.md la fiecare sesiune.
8. AI ACCES TOTAL — poți citi orice (.env, config, tot). Nu spune "nu am acces".
9. Poți instala pachete cu runCommand("npm install X").

═══ TOOL-URI ═══
Când Adrian cere o acțiune, răspunzi cu JSON între \\\`\\\`\\\`json ... \\\`\\\`\\\`:
{"tool":"numeToolului","params":{...},"description":"Ce face"}

Fără aprobare: readFile, searchCode, listFiles, gitStatus, gitLog, gitDiff, runTests, queryDB, screenshot, browse, webSearch, readUrl, generateImage
Cu aprobare ⚠️: writeFile, editFile, runCommand, deploy, browseWithAuth, mutateDB

EXEMPLE CONCRETE — COPIAZĂ FORMATUL EXACT:

Dacă Adrian zice "arată codul din server/index.js":
\\\`\\\`\\\`json
{"tool":"readFile","params":{"filePath":"server/index.js"},"description":"Citesc server/index.js"}
\\\`\\\`\\\`

Dacă Adrian zice "caută bug-uri":
\\\`\\\`\\\`json
{"tool":"searchCode","params":{"query":"TODO|FIXME|BUG|HACK"},"description":"Caut TODO-uri și bug-uri"}
\\\`\\\`\\\`

Dacă Adrian zice "ce fișiere avem?":
\\\`\\\`\\\`json
{"tool":"listFiles","params":{"directory":"."},"description":"Listez structura proiectului"}
\\\`\\\`\\\`

Dacă Adrian zice "editează X în fișierul Y":
\\\`\\\`\\\`json
{"tool":"editFile","params":{"filePath":"server/index.js","target":"text vechi exact","replacement":"text nou"},"description":"Editez server/index.js"}
\\\`\\\`\\\`

REGULA DE AUR: Dacă Adrian cere ORICE despre cod, fișiere, sau proiect — folosești un TOOL mai întâi, apoi răspunzi cu rezultatul. NICIODATĂ nu răspunzi din memorie fără tool call.

IMPORTANT: Dacă Adrian te întreabă ceva și nu ai informația exactă, FOLOSEȘTE readFile să citești fișierul relevant ÎNAINTE de a răspunde. Nu ghici — verifică.

═══ CE ȘTII DESPRE PROIECT ═══
${knowledge}

═══ STAREA REALĂ (RAPORT ONEST) ═══
${raport}

═══ ISTORIC CONVERSAȚIE ═══
${history}

═══ REGULA DE AUR ═══
RESPECTĂ INTEGRAL regulile din K1_KNOWLEDGE.md (secțiunile 1-26).
ÎNAINTE de a raporta ORICE problemă, VERIFICĂ în cod cu readFile.
NU citi din memorie, NU presupune, NU inventa. Doar ce verifici cu ochii tăi în cod e real.
Folosește etichetele: DECLARAT / VERIFICAT / NECONFIRMAT / BLOCAT.
Nu transforma o presupunere în fapt.
Nu transforma o intenție în rezultat.
Nu spune "gata" fără probă.

Când Adrian intră, îl saluti scurt și îl întrebi pe ce vrea să lucrăm.`;
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
        // #4 LINE-BASED EDITING — mai precis
        const lines = cur.split('\n');
        const s = Math.max(0, startLine - 1);
        const e = Math.min(lines.length, endLine);
        const section = lines.slice(s, e).join('\n');
        occ = target ? section.split(target).length - 1 : 1;
        editFn = () => {
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
          return { success: true, file: fp };
        };
      } else {
        occ = target ? cur.split(target).length - 1 : 0;
        editFn = () => {
          if (!target || occ === 0) return { success: false, error: 'Text negăsit' };
          fs.writeFileSync(path.resolve(fp), cur.replace(target, replacement), 'utf8');
          return { success: true, file: fp };
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
        message: `⚠️ APROBARE\nEdit: ${fp}${startLine ? ` (L${startLine}-${endLine})` : ''}\nFind: ${(target || '').slice(0, 200)}\nReplace: ${(replacement || '').slice(0, 200)}\n(${occ} potriviri)`,
        preview: _pendingOps.get(opId).preview,
      };
    }
    case 'writeFile': {
      const opId = `OP_${++_opCounter}`;
      const fp = params.filePath || params.path,
        content = params.content;
      let cur = '';
      try {
        cur = fs.readFileSync(path.resolve(fp), 'utf8');
      } catch {
        /* ignored */
      }
      _pendingOps.set(opId, {
        type: 'writeFile',
        preview: {
          file: fp,
          curLen: cur.length,
          newLen: (content || '').length,
        },
        execute: () => {
          const d = path.dirname(path.resolve(fp));
          if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.resolve(fp), content, 'utf8');
          return { success: true, file: fp, size: content.length };
        },
      });
      return {
        pendingApproval: true,
        opId,
        message: `⚠️ APROBARE\nScrie: ${fp} (${(content || '').length} chars)`,
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
    default:
      return { result: `Tool necunoscut: ${tool}` };
  }
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
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
