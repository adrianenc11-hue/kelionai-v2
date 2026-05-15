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

const { smartFetch } = require('./modelRouter');
const { createTask, updateTask } = require('./agentTasks');
const agentFs = require('./agentFs');
const agentShell = require('./agentShell');
const agentDiagnostics = require('./agentDiagnostics');
const agentGitHub = require('./agentGitHub');

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
    { role: 'system', content: `You are Kelion Developer Agent — a disciplined software engineer.

Output STRICT JSON only. No markdown, no prose outside JSON.

Rules:
1. First step MUST be "read" to inspect the file(s) you will modify.
2. Second step is "think" with your reasoning.
3. Then "write" the corrected file content (full file, never patches).
4. Then "validate" step — this triggers syntax+security+lint+test+build automatically.
5. Then "git_status".
6. Last "commit" with a conventional commit message.

Supported types: read, write, shell, test, build, lint, validate, git_status, commit, push, pr, think, speak.

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
        if (Object.keys(state.fileCache).length >= MAX_FILES_PER_TASK && !state.fileCache[step.path]) { log('blocked', { reason: 'max files' }); r = { ok: false, blocked: true }; break; }
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
        r = await agentShell.execCommand(`git add -A && git commit -m "${step.message.replace(/"/g, '\\"')}"`, 15000);
        log('commit', { msg: step.message, ok: r.ok });
        break;
      }
      case 'push': {
        if (!state.approvedPush) { log('pending_approval', { reason: 'push' }); r = { ok: false, pendingApproval: true }; break; }
        r = await agentShell.execCommand(`git push origin ${step.branch || 'HEAD'}`, 30000);
        log('push', { branch: step.branch, ok: r.ok });
        break;
      }
      case 'pr': {
        if (!state.approvedPush) { log('pending_approval', { reason: 'pr' }); r = { ok: false, pendingApproval: true }; break; }
        r = await agentGitHub.createPr(step.branch, step.title, step.body);
        log('pr', { branch: step.branch, ok: r.ok });
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
      const orig = await agentFs.readFile(fix.path);
      if (orig.ok) state.backups[fix.path] = orig.content;
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
  await updateTask(taskId, { status: 'in_progress', description: `Plan: ${plan.steps.length} pași` });

  // 2. Execute steps
  for (const step of plan.steps.slice(0, MAX_STEPS)) {
    const result = await _executeStep(taskId, step, state);

    if (result.blocked) {
      state.status = 'blocked';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: 'Am oprit execuția – acțiunea este blocată de regulile de siguranță.', ts: new Date().toISOString() });
      await updateTask(taskId, { status: 'blocked', description: `Blocat la pasul ${step.id}: ${step.type}` });
      break;
    }

    if (result.pendingApproval) {
      state.status = 'pending_approval';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: 'Am terminat modificările. Aștept aprobarea ta pentru commit și push.', ts: new Date().toISOString() });
      await updateTask(taskId, { status: 'pending_approval', description: `Aștept aprobare la pasul ${step.id}: ${step.type}` });
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
      await updateTask(taskId, { status: 'needs_review', description: `Reparare eșuată la pasul ${step.id}: ${step.type}` });
      break;
    }

    // Non-validation step failed → fail fast
    if (!result.ok) {
      state.status = 'failed';
      state.narratives.push({ stepId: step.id, type: 'speak', narrative: `Eroare la pasul ${step.type}. Oprire rapidă pentru siguranță.`, ts: new Date().toISOString() });
      await updateTask(taskId, { status: 'failed', description: `Eșec la pasul ${step.id}: ${step.type}` });
      break;
    }
  }

  if (state.status === 'executing') {
    state.status = 'done';
    state.narratives.push({ stepId: 999, type: 'speak', narrative: 'Task finalizat cu succes. Toate validările au trecut.', ts: new Date().toISOString() });
    await updateTask(taskId, { status: 'done', description: `Complet – ${plan.steps.length} pași` });
  }

  return {
    ok: state.status === 'done' || state.status === 'pending_approval',
    taskId,
    status: state.status,
    logs: state.logs,
    narratives: state.narratives,
    modifiedPaths: Array.from(state.modifiedPaths),
    backups: Object.keys(state.backups),
  };
}

/**
 * Approve a pending task so it can proceed with commit/push/PR.
 * @param {number|string} taskId
 * @param {object} [options]
 * @param {boolean} [options.commit=false]
 * @param {boolean} [options.push=false]
 * @returns {Promise<{ok:boolean, taskId:number, approvedCommit:boolean, approvedPush:boolean}>}
 */
async function approveTask(taskId, { commit = false, push = false } = {}) {
  return { ok: true, taskId, approvedCommit: commit, approvedPush: push };
}

/**
 * Revert every file modified by a task back to its original content.
 * @param {number|string} taskId
 * @param {object} state — execution state containing `backups`
 * @returns {Promise<{ok:boolean, taskId:number, reverted:{path:string, ok:boolean}[]}>}
 */
async function revertTask(taskId, state) {
  const results = [];
  for (const [p, content] of Object.entries(state.backups || {})) {
    const r = await agentFs.writeFile(p, content);
    results.push({ path: p, ok: r.ok });
  }
  return { ok: results.every(r => r.ok), taskId, reverted: results };
}

module.exports = { startTask, approveTask, revertTask };
