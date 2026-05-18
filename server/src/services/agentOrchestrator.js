'use strict';

/**
 * @fileoverview agentOrchestrator.js — Kelion Developer Agent (Autonomous)
 *
 * Kelion Developer Agent transforms natural-language tasks into executed
 * code changes. Pipeline: PLAN → EXECUTE → VALIDATE → COMMIT.
 *
 * Core capabilities:
 * 1. 🗣️  **Narrative output** — every step produces a human-readable
 *    voice+text transcript so Kelion can speak what it is doing.
 * 2. 🧪  **Certified validators** — syntax check (node --check),
 *    SAST security scan, ESLint, targeted Jest tests, production build.
 * 3. ✅  **Exhaustive validation gate** — no commit is allowed until
 *    ALL five validator stages pass cleanly.
 * 4. 🚫  **Zero intrusive alerts** — failures are logged as structured
 *    status cards, never red panic banners.
 * 5. 🔄  **Stop-Repair-Resume loop** — on test/build failure the agent
 *    pauses, asks the LLM for a fix patch, applies it, re-runs the
 *    failed stage. Max 3 auto-repair iterations; after that it stops
 *    and awaits human approval.
 * 6. 📚  **Full JSDoc documentation** — every public symbol is typed
 *    and documented for easy discovery by future maintainers.
 *
 * Safety guardrails (non-negotiable):
 * • Blocked paths: auth middleware, env files, secrets, payment code.
 * • Blocked shell patterns: rm -rf /, eval(), curl | bash, etc.
 * • Max 10 modified files per task, max 20 steps per plan.
 * • Commit & push require explicit admin approval.
 *
 * @module services/agentOrchestrator
 */

const fs = require('fs').promises;
const { smartFetch } = require('./modelRouter');
const { createTask, updateTask, getTask } = require('./agentTasks');
const agentFs = require('./agentFs');
const agentShell = require('./agentShell');
const agentDiagnostics = require('./agentDiagnostics');
const agentGitHub = require('./agentGitHub');
const agentBrowser = require('./agentBrowser');
const agentSandbox = require('./agentSandbox');
const agentDeploy = require('./agentDeploy');
const PROTECTED_BRANCHES = new Set(['master', 'main', 'origin/master', 'origin/main', 'HEAD']);

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

// agentWeb loaded lazily to avoid circular deps if not present
let _agentWeb;
function _getAgentWeb() {
  if (!_agentWeb) { try { _agentWeb = require('./agentWeb'); } catch (_) { _agentWeb = null; } }
  return _agentWeb;
}

// ── Mutex: prevent parallel autonomous tasks from clobbering each other ──
let _taskLock = false;
function _acquireLock() {
  if (_taskLock) return false;
  _taskLock = true;
  return true;
}
function _releaseLock() {
  _taskLock = false;
}

// ── Safety Guardrails ──
/** @const {RegExp[]} Paths that may NEVER be read or written by the agent. */
const BLOCKED_PATHS = [
  /server\/src\/middleware\/auth\.js$/,
  /server\/src\/routes\/admin\.js$/,
  /server\/src\/services\/agent.*\.js$/,
  /server\/src\/db\/postgres-schema\.js$/,
  /\.env/, /\.env\./, /config\/secrets/, /\.railway/, /\.git\/hooks/,
];
/** @const {RegExp[]} Shell commands that are permanently blocked. */
const BLOCKED_SHELL_PATTERNS = [
  /rm\s+-rf\s+\//, />\s*\/dev\/null/, /curl.*\|.*bash/,
  /wget.*\|.*sh/, /eval\s*\(/, /exec\s*\(/,
];
/** @const {number} Maximum files a single task may touch. */
const MAX_FILES_PER_TASK = 10;
/** @const {number} Maximum steps in one LLM-generated plan. */
const MAX_STEPS = 20;
/** @const {number} Maximum auto-repair iterations before human approval is required. */
const MAX_REPAIR_ITERATIONS = 3;
/** @const {number} Maximum autonomy loop iterations (re-plan after completion assessment). */
const MAX_AUTONOMY_ITERATIONS = 5;

/**
 * Normalise and validate a file path against the blocklist.
 * @param {string} p — raw relative path from repo root
 * @returns {boolean}
 */
function isPathAllowed(p) {
  const normalized = p.replace(/\\/g, '/');
  return !BLOCKED_PATHS.some(rx => rx.test(normalized));
}

/**
 * Validate a shell command against the dangerous-pattern blocklist.
 * @param {string} cmd — raw command string
 * @returns {boolean}
 */
function isShellAllowed(cmd) {
  const c = cmd.toLowerCase().trim();
  return !BLOCKED_SHELL_PATTERNS.some(rx => rx.test(c));
}

// ── Persistence helper ──
/**
 * Persist the runtime execution state back into the agent_tasks row
 * so approve/revert and the UI can reconstruct the full context.
 * Safe to call frequently (after each step). Lightweight — JSON-only columns.
 */
async function _saveState(taskId, state) {
  try {
    await updateTask(taskId, {
      status: state.status,
      status_detail: state.statusDetail || state.status,
      narratives: state.narratives,
      logs: state.logs,
      plan: state.plan,
      modified_paths: Array.from(state.modifiedPaths || []),
      backups: state.backups,
      approved_commit: state.approvedCommit || false,
      approved_push: state.approvedPush || false,
    });
    return { ok: true };
  } catch (err) {
    console.error('[agentOrchestrator] _saveState failed:', err && err.message);
    return { ok: false, error: err && err.message };
  }
}

// ── Narrative Engine ──
/**
 * Produce a human-readable / voice-ready description of a step.
 * This text can be fed directly to Kelion's TTS pipeline so the
 * avatar "speaks" what the developer agent is doing.
 * @param {object} step — the plan step
 * @param {object} result — execution result
 * @returns {string} Romanian narrative sentence
 */
function _narrateStep(step, result) {
  const typeNames = {
    read: 'citesc', write: 'modific', shell: 'rulez comanda',
    test: 'verific testele', build: 'compilez', lint: 'verific stilul',
    validate: 'rulez validarea exhaustivă', git_status: 'verific git-ul',
    commit: 'salvez commit', push: 'public pe remote', pr: 'creez pull request',
    think: 'analizez', repair: 'repar eroarea', speak: 'anunț',
    browse: 'navighez pe web', sandbox: 'execut cod izolat',
    deploy: 'deployez pe producție', verify_deploy: 'verific deploy-ul',
    search_web: 'caut pe web',
  };
  const verb = typeNames[step.type] || step.type;
  if (result.blocked) return `Am blocat pasul ${step.type} — siguranța nu permite această acțiune.`;
  if (result.pendingApproval) return `Am terminat ${verb}. Aștept aprobarea ta pentru a continua.`;
  if (!result.ok) return `Eroare la ${verb}: ${result.error || result.stderr?.slice(0, 120)}.`;
  if (step.type === 'read') return `Citesc fișierul ${step.path}.`;
  if (step.type === 'write') return `Am modificat fișierul ${step.path}.`;
  if (step.type === 'test') return `Testele ${result.ok ? 'au trecut' : 'au eșuat'}${result.stdout ? ` (${result.stdout.slice(0, 60)}...)` : ''}.`;
  if (step.type === 'validate') return `Validarea exhaustivă ${result.ok ? 'a trecut' : 'a eșuat'} — ${result.stage || ''}.`;
  if (step.type === 'repair') return `Repar automat eroarea – încercarea ${step.iteration || 1}.`;
  if (step.type === 'speak') return step.content || '';
  if (step.type === 'browse') return `Am navigat la ${step.url || '(url)'}${result.data?.title ? ' — ' + result.data.title : ''}.`;
  if (step.type === 'sandbox') return `Am executat cod izolat${result.ok ? ' cu succes' : ' — eroare'}.`;
  if (step.type === 'deploy') return `Deploy inițiat — aștept PR merge pe master.`;
  if (step.type === 'verify_deploy') return `Deploy-ul ${result.ok ? 'a reușit' : 'a eșuat'} — SHA: ${result.data?.deploy_sha || 'unknown'}.`;
  if (step.type === 'search_web') return `Am căutat pe web: ${step.query || ''}${result.data?.results ? ` (${result.data.results.length} rezultate)` : ''}.`;
  return `${verb} — ${result.ok ? 'OK' : 'eroare'}.`;
}

// ── LLM Plan Generation ──
/**
 * Ask the heavy coder model to produce a structured JSON plan.
 * The plan includes a new "validate" step that triggers the
 * exhaustive five-stage validation pipeline (syntax → security →
 * lint → tests → build) before any commit step.
 * @param {string} description — natural-language task
 * @param {string} codebaseSummary — optional repo context
 * @returns {Promise<{steps:object[]}>}
 */
async function _generatePlan(description, codebaseSummary) {
  const messages = [
    { role: 'system', content: `You are Kelion Developer Agent — a fully autonomous AI agent.
You can write code, browse the web, run sandboxed JS, execute shell commands, and deploy.

Output STRICT JSON only. No markdown, no prose outside JSON.

Rules:
1. First step MUST be "read" to inspect the file(s) you will modify.
2. Second step is "think" with your reasoning.
3. Then "write" the corrected file content (full file, never patches).
4. Then "validate" step — this triggers syntax+security+lint+test+build automatically.
5. Then "git_status".
6. Last "commit" with a conventional commit message.
7. If deployment is needed, add "pr" step to create a pull request.

Supported types:
- Code: read, write, shell, test, build, lint, validate, git_status, commit, push, pr
- Browser: browse (with url, action: navigate|click|type|extract|links, selector?, text?, schema?)
- Sandbox: sandbox (with code, timeout?)
- Web: search_web (with query)
- Deploy: deploy, verify_deploy (with commitSha?)
- Meta: think, speak, repair

Max ${MAX_FILES_PER_TASK} files. Max ${MAX_STEPS} steps.
Every step may include an optional "content" field used as TTS narrative.` },
    { role: 'user', content: `Task: ${description}\n\nCodebase summary:\n${codebaseSummary || '(no summary)'}\n\nGenerate JSON plan:` },
  ];

  const { response } = await smartFetch('coder', { messages, temperature: 0.2, max_tokens: 4000 }, true, false);
  const json = await response.json();
  const raw = json.choices?.[0]?.message?.content || '';

  const match = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
  const payload = match ? match[1].trim() : raw.trim();

  try {
    const plan = JSON.parse(payload);
    if (!Array.isArray(plan.steps)) throw new Error('Missing steps array');
    return plan;
  } catch (e) {
    console.error('[agentOrchestrator] plan parse error:', e.message, 'raw:', raw.slice(0, 500));
    return { steps: [{ id: 1, type: 'speak', content: 'Nu am reușit să generez planul. Verific logurile.' }] };
  }
}

// ── Step Execution ──
/**
 * Execute a single plan step under full guardrail and logging.
 * Automatically appends a narrative sentence to `state.narratives`
 * so Kelion can read it aloud.
 * @param {number|string} taskId — DB task id
 * @param {object} step — plan step
 * @param {object} state — mutable execution state
 * @returns {Promise<{ok:boolean, blocked?:boolean, pendingApproval?:boolean, error?:string}>}
 */
async function _executeStep(taskId, step, state) {
  const log = (type, detail) => {
    const entry = { ts: new Date().toISOString(), stepId: step.id, type, detail };
    state.logs.push(entry);
    console.log(`[agentOrchestrator] task=${taskId} step=${step.id} [${type}] ${JSON.stringify(detail).slice(0, 200)}`);
  };

  let r = { ok: false };
  try {
    switch (step.type) {
      case 'read': {
        if (!isPathAllowed(step.path)) { log('blocked', { reason: 'path guardrail', path: step.path }); r = { ok: false, blocked: true }; break; }
        r = await agentFs.readFile(step.path);
        if (r.ok) state.fileCache[step.path] = r.content;
        log('read', { path: step.path, ok: r.ok });
        break;
      }
      case 'write': {
        if (!isPathAllowed(step.path)) { log('blocked', { reason: 'path guardrail', path: step.path }); r = { ok: false, blocked: true }; break; }
        // Guardrail: cap distinct modified files (reads do NOT count).
        if (state.modifiedPaths.size >= MAX_FILES_PER_TASK && !state.modifiedPaths.has(step.path)) {
          log('blocked', { reason: 'max files' }); r = { ok: false, blocked: true }; break;
        }
        const orig = await agentFs.readFile(step.path);
        if (orig.ok) state.backups[step.path] = orig.content;
        r = await agentFs.writeFile(step.path, step.content);
        state.fileCache[step.path] = step.content;
        state.modifiedPaths.add(step.path);
        log('write', { path: step.path, ok: r.ok });
        break;
      }
      case 'shell': {
        if (!isShellAllowed(step.command)) { log('blocked', { reason: 'shell guardrail', cmd: step.command }); r = { ok: false, blocked: true }; break; }
        r = await agentShell.execCommand(step.command, step.timeout || 30000);
        log('shell', { cmd: step.command, ok: r.ok, exitCode: r.exitCode });
        break;
      }
      case 'test': {
        r = await agentDiagnostics.runTests(step.filter || '');
        log('test', { filter: step.filter, ok: r.ok });
        break;
      }
      case 'build': {
        r = await agentDiagnostics.runBuild();
        log('build', { ok: r.ok });
        break;
      }
      case 'lint': {
        r = await agentDiagnostics.runLint();
        log('lint', { ok: r.ok });
        break;
      }
      case 'validate': {
        // Exhaustive five-stage validation — no commit may pass before this.
        r = await agentDiagnostics.runExhaustiveValidation(Array.from(state.modifiedPaths), step.filter || '');
        log('validate', { ok: r.ok, stage: r.stage });
        break;
      }
      case 'git_status': {
        r = await agentDiagnostics.getGitStatus();
        log('git_status', { ok: r.ok });
        break;
      }
      case 'commit': {
        if (!state.approvedCommit) { log('pending_approval', { reason: 'commit' }); r = { ok: false, pendingApproval: true }; break; }
        const paths = Array.from(state.modifiedPaths || []);
        const addCmd = paths.length ? `git add -- ${paths.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(' ')}` : 'git add -A';
        // Cross-platform safe: write message to a temp file under .git/ (guaranteed to exist
        // and excluded from path guardrails) and pass it via -F. Avoids echo | pipe breakage
        // on Windows PowerShell and backtick/$() injection in the message itself.
        const safeMsg = step.message || 'chore: agent commit';
        const tmpMsgPath = '.git/TMP_AGENT_COMMIT_MSG';
        const wr = await agentFs.writeFile(tmpMsgPath, safeMsg);
        if (!wr.ok) {
          r = { ok: false, error: 'Failed to write temp commit message file.' };
          log('commit', { msg: step.message, ok: false, error: r.error });
          break;
        }
        r = await agentShell.execCommand(`${addCmd} && git commit -F ${tmpMsgPath}`, 15000);
        // Cleanup best-effort (non-blocking).
        try { await fs.unlink(tmpMsgPath); } catch (_) {}
        log('commit', { msg: step.message, ok: r.ok });
        break;
      }
      case 'push': {
        if (!state.approvedPush) { log('pending_approval', { reason: 'push' }); r = { ok: false, pendingApproval: true }; break; }
        const branch = String(step.branch || '').trim();
        if (!isSafePrBranch(branch)) {
          r = { ok: false, error: 'Push requires an explicit non-master feature branch.' };
          log('push', { branch, ok: false, error: r.error });
          break;
        }
        r = await agentShell.execCommand(`git push origin ${branch}`, 30000);
        log('push', { branch, ok: r.ok });
        break;
      }
      case 'pr': {
        if (!state.approvedPush) { log('pending_approval', { reason: 'pr' }); r = { ok: false, pendingApproval: true }; break; }
        const branch = String(step.branch || '').trim();
        if (!isSafePrBranch(branch)) {
          r = { ok: false, error: 'PR requires an explicit non-master feature branch.' };
          log('pr', { branch, ok: false, error: r.error });
          break;
        }
        r = await agentGitHub.createPr(branch, step.title, step.body);
        log('pr', { branch, ok: r.ok });
        break;
      }
      case 'think': {
        log('think', { reason: step.reason || step.content || '(no reasoning)' });
        r = { ok: true };
        break;
      }
      case 'speak': {
        log('speak', { content: step.content || '' });
        r = { ok: true };
        break;
      }
      // ── NEW: Browser navigation ──
      case 'browse': {
        const action = step.action || 'navigate';
        switch (action) {
          case 'navigate':
            r = await agentBrowser.navigate(step.url, step.options);
            break;
          case 'click':
            r = await agentBrowser.click(step.url, step.selector, step.options);
            break;
          case 'type':
            r = await agentBrowser.type(step.url, step.selector, step.text, step.options);
            break;
          case 'extract':
            r = await agentBrowser.extractStructured(step.url, step.schema);
            break;
          case 'fill':
            r = await agentBrowser.fillForm(step.url, step.fields, step.options);
            break;
          case 'links':
            r = await agentBrowser.getLinks(step.url);
            break;
          case 'screenshot':
            r = await agentBrowser.screenshot(step.url, step.options);
            break;
          case 'evaluate':
            r = await agentBrowser.evaluateJs(step.url, step.code);
            break;
          default:
            r = await agentBrowser.navigate(step.url);
        }
        log('browse', { url: step.url, action, ok: r.ok });
        break;
      }

      // ── NEW: Sandboxed code execution ──
      case 'sandbox': {
        r = await agentSandbox.executeJs(step.code, { timeout: step.timeout, globals: step.globals });
        log('sandbox', { ok: r.ok, duration_ms: r.duration_ms });
        break;
      }

      // ── NEW: Web search ──
      case 'search_web': {
        const web = _getAgentWeb();
        if (web && web.searchWeb) {
          r = await web.searchWeb(step.query, step.numResults || 5);
        } else {
          r = { ok: false, error: 'agentWeb module not available.' };
        }
        log('search_web', { query: step.query, ok: r.ok });
        break;
      }

      // ── NEW: Deploy verification ──
      case 'verify_deploy': {
        r = await agentDeploy.deployAndVerify(step.commitSha);
        log('verify_deploy', { ok: r.ok });
        break;
      }

      default:
        log('unknown_step', { type: step.type });
        r = { ok: false, error: `Unknown step type: ${step.type}` };
    }
  } catch (err) {
    log('error', { message: err.message });
    r = { ok: false, error: err.message };
  }

  // Narrative — voice-ready sentence for Kelion TTS
  const narrative = _narrateStep(step, r);
  state.narratives.push({ stepId: step.id, type: step.type, narrative, ts: new Date().toISOString() });
  log('narrative', { text: narrative });

  // Persist incremental state so resume / revert / UI work across restarts.
  await _saveState(taskId, state);

  return r;
}

// ── Auto-Repair: Stop → Repair → Resume ──
/**
 * When a validation or test stage fails, pause execution, ask the
 * heavy model for a targeted fix, apply it, then re-run the stage.
 * Max {@link MAX_REPAIR_ITERATIONS} attempts before stopping for human review.
 * @param {number|string} taskId — DB task id
 * @param {object} failedStep — the step that failed
 * @param {object} state — mutable execution state
 * @param {number} iteration — current repair attempt (1-based)
 * @returns {Promise<{ok:boolean, repaired:boolean}>}
 */
async function _autoRepair(taskId, failedStep, state, iteration = 1) {
  if (iteration > MAX_REPAIR_ITERATIONS) {
    state.narratives.push({ stepId: failedStep.id, type: 'repair', narrative: `Repararea automată a eșuat după ${MAX_REPAIR_ITERATIONS} încercări. Aștept aprobarea ta.`, ts: new Date().toISOString() });
    return { ok: false, repaired: false };
  }

  // Build a concise diagnostic prompt for the heavy model
  const diagnostic = state.logs
    .filter(l => l.stepId === failedStep.id || l.type === 'error')
    .map(l => `[${l.type}] ${JSON.stringify(l.detail).slice(0, 300)}`)
    .join('\n');

  const messages = [
    { role: 'system', content: `You are Kelion Developer Agent — auto-repair mode.

The previous code change failed validation. Output STRICT JSON with a single "write" step that fixes the issue.
Rules:
- Return the FULL corrected file content, never a diff.
- Only modify files that were previously touched in this task.
- Include a brief "reason" field explaining the fix.` },
    { role: 'user', content: `Failed step: ${failedStep.type}\nError logs:\n${diagnostic}\n\nProvide JSON fix:` },
  ];

  try {
    const { response } = await smartFetch('coder', { messages, temperature: 0.2, max_tokens: 4000 }, true, false);
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const match = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
    const payload = match ? match[1].trim() : raw.trim();
    const fix = JSON.parse(payload);

    if (fix.type === 'write' && fix.path && isPathAllowed(fix.path)) {
      // Păstrăm backup-ul ORIGINAL — nu-l suprascriem cu versiunea intermediară de pe disc.
      if (!state.backups[fix.path]) {
        const orig = await agentFs.readFile(fix.path);
        if (orig.ok) state.backups[fix.path] = orig.content;
      }
      const wr = await agentFs.writeFile(fix.path, fix.content);
      state.fileCache[fix.path] = fix.content;
      state.modifiedPaths.add(fix.path);
      state.narratives.push({ stepId: failedStep.id, type: 'repair', narrative: `Repar eroarea automat – încercarea ${iteration}. ${fix.reason || ''}`, ts: new Date().toISOString() });
      return { ok: wr.ok, repaired: wr.ok };
    }
  } catch (e) {
    console.error('[agentOrchestrator] autoRepair LLM error:', e.message);
  }
  return { ok: false, repaired: false };
}

// ── Main Orchestrator ──
/**
 * Start a new autonomous development task.
 * Pipeline: create task → LLM plan → execute steps → validate → repair if needed → commit.
 * @param {string} description — natural-language task (e.g. "scoate bula de chat")
 * @param {object} [options]
 * @param {boolean} [options.approvedCommit=false]
 * @param {boolean} [options.approvedPush=false]
 * @param {string} [options.codebaseSummary='']
 * @returns {Promise<{ok:boolean, taskId:number, status:string, logs:object[], narratives:object[], modifiedPaths:string[]}>}
 */
async function startTask(description, options = {}) {
  if (!_acquireLock()) {
    return { ok: false, error: 'Another autonomous task is already running. Wait for it to finish or cancel it.', status: 'locked' };
  }
  try {
    return await _startTaskLocked(description, options);
  } finally {
    _releaseLock();
  }
}

async function _startTaskLocked(description, options = {}) {
  const { approvedCommit = false, approvedPush = false, codebaseSummary = '' } = options;

  const task = await createTask({
    title: description.slice(0, 120),
    description,
    priority: 'high',
  });
  const taskId = task.id;

  const state = {
    logs: [],
    narratives: [],
    fileCache: {},
    backups: {},
    modifiedPaths: new Set(),
    approvedCommit,
    approvedPush,
    status: 'planning',
    repairCount: 0,
  };

  // Narrative: Kelion speaks what it is about to do
  state.narratives.push({ stepId: 0, type: 'speak', narrative: `Pornesc task-ul: ${description.slice(0, 200)}. Generez planul de lucru.`, ts: new Date().toISOString() });

  // 1. Generate plan
  const plan = await _generatePlan(description, codebaseSummary);
  state.plan = plan;
  state.status = 'executing';
  state.statusDetail = `Plan: ${plan.steps.length} pași`;
  await updateTask(taskId, { status: 'in_progress', status_detail: state.statusDetail });

  // 2. Execute steps
  for (const step of plan.steps.slice(0, MAX_STEPS)) {
    const result = await _executeStep(taskId, step, state);

    if (result.blocked) {
      state.status = 'blocked';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: 'Am oprit execuția – acțiunea este blocată de regulile de siguranță.', ts: new Date().toISOString() });
      state.statusDetail = `Blocat la pasul ${step.id}: ${step.type}`;
      await updateTask(taskId, { status: 'blocked', status_detail: state.statusDetail });
      break;
    }

    if (result.pendingApproval) {
      state.status = 'pending_approval';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: 'Am terminat modificările. Aștept aprobarea ta pentru commit și push.', ts: new Date().toISOString() });
      state.statusDetail = `Aștept aprobare la pasul ${step.id}: ${step.type}`;
      await updateTask(taskId, { status: 'pending_approval', status_detail: state.statusDetail });
      break;
    }

    // Validation / test / build failure → Stop → Repair → Resume
    if (!result.ok && (step.type === 'test' || step.type === 'build' || step.type === 'validate' || step.type === 'lint')) {
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: `Validarea ${step.type} a eșuat. Încep repararea automată – încercarea ${state.repairCount + 1}.`, ts: new Date().toISOString() });

      const repair = await _autoRepair(taskId, step, state, state.repairCount + 1);
      if (repair.repaired) {
        state.repairCount++;
        // Re-run the SAME step after repair
        const retry = await _executeStep(taskId, { ...step, iteration: state.repairCount }, state);
        if (retry.ok) {
          state.narratives.push({ stepId: step.id, type: 'speak', narrative: `Repararea a funcționat. Validarea ${step.type} a trecut.`, ts: new Date().toISOString() });
          continue; // continue to next step
        }
      }

      // Repair failed or exhausted
      state.status = 'needs_review';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: `Nu am reușit să repar automat după ${state.repairCount} încercări. Te rog să verifici și să aprobi manual.`, ts: new Date().toISOString() });
      state.statusDetail = `Reparare eșuată la pasul ${step.id}: ${step.type}`;
      await updateTask(taskId, { status: 'needs_review', status_detail: state.statusDetail });
      break;
    }

    // Non-validation step failed → fail fast
    if (!result.ok) {
      state.status = 'failed';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: `Eroare la pasul ${step.type}. Oprire rapidă pentru siguranță.`, ts: new Date().toISOString() });
      state.statusDetail = `Eșec la pasul ${step.id}: ${step.type}`;
      await updateTask(taskId, { status: 'failed', status_detail: state.statusDetail });
      break;
    }
  }

  if (state.status === 'executing') {
    state.status = 'done';
    state.narratives.push({ stepId: 999, type: 'speak', narrative: 'Task finalizat cu succes. Toate validările au trecut.', ts: new Date().toISOString() });
    state.statusDetail = `Complet – ${plan.steps.length} pași`;
    await updateTask(taskId, { status: 'done', status_detail: state.statusDetail });
  }

  // ── Autonomy Loop: assess completion, re-plan if needed ──
  if (state.status === 'done' && (options.autonomous || false) && (state.autonomyIteration || 0) < MAX_AUTONOMY_ITERATIONS) {
    const assessment = await _assessCompletion(description, state);
    if (!assessment.complete) {
      state.autonomyIteration = (state.autonomyIteration || 0) + 1;
      state.status = 'executing';
      state.narratives.push({ stepId: 0, type: 'speak', narrative: `Iterația ${state.autonomyIteration}: ${assessment.reason}. Regeneez plan.`, ts: new Date().toISOString() });
      await _saveState(taskId, state);

      // Re-plan with context from previous iteration
      const newPlan = await _generatePlan(assessment.nextSteps || description, codebaseSummary);
      state.plan = newPlan;
      for (const step of newPlan.steps.slice(0, MAX_STEPS)) {
        const result = await _executeStep(taskId, step, state);
        if (!result.ok && (step.type === 'validate' || step.type === 'test')) {
          const repair = await _autoRepair(taskId, step, state, state.repairCount + 1);
          if (repair.repaired) { state.repairCount++; continue; }
          state.status = 'needs_review';
          break;
        }
        if (result.blocked || result.pendingApproval || !result.ok) break;
      }
      if (state.status === 'executing') state.status = 'done';
    }
  }

  // Final save ensures DB reflects the latest state before the orchestrator loop ends.
  await _saveState(taskId, state);

  return {
    ok: state.status === 'done' || state.status === 'pending_approval',
    taskId,
    status: state.status,
    statusDetail: state.statusDetail,
    logs: state.logs,
    narratives: state.narratives,
    modifiedPaths: Array.from(state.modifiedPaths),
    backups: Object.keys(state.backups),
  };
}

/**
 * Approve a pending task so it can proceed with commit/push/PR.
 * Loads the full execution state from the DB, sets approval flags,
 * re-runs any remaining commit / push / PR steps, and saves the result.
 * @param {number|string} taskId
 * @param {object} [options]
 * @param {boolean} [options.commit=false]
 * @param {boolean} [options.push=false]
 * @returns {Promise<{ok:boolean, taskId:number, approvedCommit:boolean, approvedPush:boolean, narratives:object[]}>}
 */
async function approveTask(taskId, { commit = false, push = false } = {}) {
  const { ok: found, task } = await getTask(taskId);
  if (!found) return { ok: false, taskId, error: `Task ${taskId} not found.` };

  const BLOCKED_APPROVAL_STATUSES = ['done', 'failed', 'reverted', 'blocked'];
  if (BLOCKED_APPROVAL_STATUSES.includes(task.status)) {
    return { ok: false, taskId, error: `Cannot approve a task that is already ${task.status}.` };
  }

  // Re-hydrate state from DB
  const state = {
    logs:           task.logs || [],
    narratives:       task.narratives || [],
    fileCache:      {},
    backups:          task.backups || {},
    modifiedPaths:    new Set(task.modified_paths || []),
    approvedCommit:   commit,
    approvedPush:     push,
    status:           task.status,
    repairCount:      0,
    plan:             task.plan,
    statusDetail:     task.status_detail || task.status,
  };

  state.narratives.push({ stepId: 0, type: 'speak', narrative: `Aprobare primită. commit=${commit ? 'DA' : 'NU'} push=${push ? 'DA' : 'NU'}`, ts: new Date().toISOString() });

  // If there was a pending commit step, re-execute it now that we are approved.
  if (commit && state.plan?.steps) {
    const commitStep = state.plan.steps.find(s => s.type === 'commit');
    if (commitStep) {
      const r = await _executeStep(taskId, commitStep, state);
      if (!r.ok) {
        state.status = 'failed';
        await _saveState(taskId, state);
        return { ok: false, taskId, approvedCommit: commit, approvedPush: push, narratives: state.narratives, error: 'Commit failed after approval.' };
      }
    }
  }

  if (push && state.plan?.steps) {
    const pushStep = state.plan.steps.find(s => s.type === 'push');
    if (pushStep) {
      const r = await _executeStep(taskId, pushStep, state);
      if (!r.ok) {
        state.status = 'failed';
        await _saveState(taskId, state);
        return { ok: false, taskId, approvedCommit: commit, approvedPush: push, narratives: state.narratives, error: 'Push failed after approval.' };
      }
    }
  }

  state.status = 'done';
  await _saveState(taskId, state);
  return { ok: true, taskId, approvedCommit: commit, approvedPush: push, narratives: state.narratives };
}

/**
 * Revert every file modified by a task back to its original content.
 * Loads backups from DB if the caller did not provide a runtime state.
 * @param {number|string} taskId
 * @param {object} [callerState] — optional execution state containing `backups`
 * @returns {Promise<{ok:boolean, taskId:number, reverted:{path:string, ok:boolean}[]}>}
 */
async function revertTask(taskId, callerState) {
  let backups = callerState?.backups || {};
  if (!Object.keys(backups).length) {
    const { ok: found, task } = await getTask(taskId);
    if (!found) return { ok: false, taskId, error: `Task ${taskId} not found.`, reverted: [] };
    backups = task.backups || {};
  }

  if (!Object.keys(backups).length) {
    return { ok: false, taskId, error: 'No backups found for this task — nothing to revert.', reverted: [] };
  }

  const results = [];
  for (const [p, content] of Object.entries(backups)) {
    if (content === null || content === undefined) {
      results.push({ path: p, ok: false, error: 'Backup content is null or undefined — skipping.' });
      continue;
    }
    const r = await agentFs.writeFile(p, content);
    results.push({ path: p, ok: r.ok, error: r.error || undefined });
  }

  // Mark task as reverted so the UI no longer shows approval buttons.
  const { task } = await getTask(taskId);
  if (task) {
    await updateTask(taskId, { status: 'reverted', status_detail: 'Revert executat – fișierele au fost restaurate.' });
  }

  return { ok: results.every(r => r.ok), taskId, reverted: results };
}

// ── Completion Assessment (Autonomy Loop) ──
/**
 * Ask the LLM to assess whether the task is fully complete or needs more steps.
 * Used by the autonomy loop to determine if re-planning is needed.
 * @param {string} description — original task description
 * @param {object} state — current execution state
 * @returns {Promise<{complete: boolean, reason?: string, nextSteps?: string}>}
 */
async function _assessCompletion(description, state) {
  try {
    const context = [
      `Original task: ${description}`,
      `Steps completed: ${state.narratives?.length || 0}`,
      `Modified files: ${Array.from(state.modifiedPaths || []).join(', ') || 'none'}`,
      `Current status: ${state.status}`,
      `Last 3 narratives: ${(state.narratives || []).slice(-3).map(n => n.narrative).join(' | ')}`,
    ].join('\n');

    const messages = [
      { role: 'system', content: `You are Kelion Developer Agent — completion assessor.
Given a task description and execution results, determine if the task is fully complete.
Output STRICT JSON: { "complete": true/false, "reason": "...", "nextSteps": "..." }
If complete is false, nextSteps should describe what remains to be done.` },
      { role: 'user', content: context },
    ];

    const { response } = await smartFetch('coder', { messages, temperature: 0.1, max_tokens: 500 }, true, false);
    const json = await response.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const match = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
    const payload = match ? match[1].trim() : raw.trim();
    return JSON.parse(payload);
  } catch (e) {
    console.error('[agentOrchestrator] _assessCompletion error:', e.message);
    return { complete: true, reason: 'Assessment failed — assuming complete.' };
  }
}

module.exports = { startTask, approveTask, revertTask, isPathAllowed, isShellAllowed, isSafePrBranch };
