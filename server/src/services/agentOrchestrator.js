'use strict';

/**
 * agentOrchestrator.js — Kelion Developer Agent
 *
 * Receives a natural-language task, generates a plan via LLM,
 * executes steps (read → write → test → build → commit → push),
 * verifies results, iterates on errors. All actions are logged
 * and require admin approval for commit/push.
 */

const { smartFetch } = require('./modelRouter');
const { createTask, updateTask } = require('./agentTasks');
const agentFs = require('./agentFs');
const agentShell = require('./agentShell');
const agentDiagnostics = require('./agentDiagnostics');
const agentGitHub = require('./agentGitHub');

// ── Safety Guardrails ──
const BLOCKED_PATHS = [
  /server\/src\/middleware\/auth\.js$/,
  /server\/src\/routes\/admin\.js$/,
  /server\/src\/services\/agent.*\.js$/,
  /server\/src\/db\/postgres-schema\.js$/,
  /\.env/,
  /\.env\./,
  /config\/secrets/,
  /\.railway/,
  /\.git\/hooks/,
];
const BLOCKED_SHELL_PATTERNS = [
  /rm\s+-rf\s+\//,
  />\s*\/dev\/null/,
  /curl.*\|.*bash/,
  /wget.*\|.*sh/,
  /eval\s*\(/,
  /exec\s*\(/,
];
const MAX_FILES_PER_TASK = 10;
const MAX_STEPS = 20;

function isPathAllowed(p) {
  const normalized = p.replace(/\\/g, '/');
  return !BLOCKED_PATHS.some(rx => rx.test(normalized));
}

function isShellAllowed(cmd) {
  const c = cmd.toLowerCase().trim();
  return !BLOCKED_SHELL_PATTERNS.some(rx => rx.test(c));
}

// ── LLM Plan Generation ──
async function _generatePlan(description, codebaseSummary) {
  const messages = [
    { role: 'system', content: `You are Kelion Developer Agent — a disciplined software engineer that plans code changes.

Output STRICT JSON only. No markdown, no prose outside the JSON block.

Rules:
1. First step MUST be "read" to inspect the file(s) you will modify.
2. Second step is "think" with your reasoning.
3. Then "write" the corrected file content.
4. Then "test" and "build".
5. Then "git_status".
6. Last "commit" with a conventional commit message.

Supported step types: read, write, shell, test, build, lint, git_status, commit, push, pr.

Max ${MAX_FILES_PER_TASK} files per task. Max ${MAX_STEPS} steps.` },
    { role: 'user', content: `Task: ${description}\n\nCodebase summary:\n${codebaseSummary || '(no summary provided)'}\n\nGenerate the JSON plan:` },
  ];

  const { response } = await smartFetch('coder', { messages, temperature: 0.2, max_tokens: 4000 }, true, false);
  const json = await response.json();
  const raw = json.choices?.[0]?.message?.content || '';

  // Extract JSON from possible markdown fences
  const match = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
  const payload = match ? match[1].trim() : raw.trim();

  try {
    const plan = JSON.parse(payload);
    if (!Array.isArray(plan.steps)) throw new Error('Missing steps array');
    return plan;
  } catch (e) {
    console.error('[agentOrchestrator] LLM plan parse error:', e.message, 'raw:', raw.slice(0, 500));
    return { steps: [{ id: 1, type: 'shell', command: `echo "Plan generation failed: ${e.message}"`, reason: 'Fallback diagnostic' }] };
  }
}

// ── Step Execution ──
async function _executeStep(taskId, step, state) {
  const log = (type, detail) => {
    const entry = { ts: new Date().toISOString(), stepId: step.id, type, detail };
    state.logs.push(entry);
    console.log(`[agentOrchestrator] task=${taskId} step=${step.id} [${type}] ${JSON.stringify(detail).slice(0, 200)}`);
  };

  try {
    switch (step.type) {
      case 'read': {
        if (!isPathAllowed(step.path)) {
          log('blocked', { reason: 'Path blocked by guardrail', path: step.path });
          return { ok: false, blocked: true };
        }
        const r = await agentFs.readFile(step.path);
        if (r.ok) state.fileCache[step.path] = r.content;
        log('read', { path: step.path, ok: r.ok, size: r.content?.length });
        return r;
      }
      case 'write': {
        if (!isPathAllowed(step.path)) {
          log('blocked', { reason: 'Path blocked by guardrail', path: step.path });
          return { ok: false, blocked: true };
        }
        if (Object.keys(state.fileCache).length >= MAX_FILES_PER_TASK && !state.fileCache[step.path]) {
          log('blocked', { reason: 'Max files per task exceeded' });
          return { ok: false, blocked: true };
        }
        // Backup original if exists
        const orig = await agentFs.readFile(step.path);
        if (orig.ok) state.backups[step.path] = orig.content;
        const r = await agentFs.writeFile(step.path, step.content);
        state.fileCache[step.path] = step.content;
        state.modifiedPaths.add(step.path);
        log('write', { path: step.path, ok: r.ok });
        return r;
      }
      case 'shell': {
        if (!isShellAllowed(step.command)) {
          log('blocked', { reason: 'Command blocked by guardrail', command: step.command });
          return { ok: false, blocked: true };
        }
        const r = await agentShell.execCommand(step.command, step.timeout || 30000);
        log('shell', { command: step.command, ok: r.ok, exitCode: r.exitCode });
        return r;
      }
      case 'test': {
        const r = await agentDiagnostics.runTests(step.filter || '');
        log('test', { filter: step.filter, ok: r.ok });
        return r;
      }
      case 'build': {
        const r = await agentDiagnostics.runBuild();
        log('build', { ok: r.ok });
        return r;
      }
      case 'lint': {
        const r = await agentDiagnostics.runLint();
        log('lint', { ok: r.ok });
        return r;
      }
      case 'git_status': {
        const r = await agentDiagnostics.getGitStatus();
        log('git_status', { ok: r.ok });
        return r;
      }
      case 'commit': {
        if (!state.approvedCommit) {
          log('pending_approval', { reason: 'Commit requires admin approval' });
          return { ok: false, pendingApproval: true };
        }
        const r = await agentShell.execCommand(`git add -A && git commit -m "${step.message.replace(/"/g, '\\"')}"`, 15000);
        log('commit', { message: step.message, ok: r.ok });
        return r;
      }
      case 'push': {
        if (!state.approvedPush) {
          log('pending_approval', { reason: 'Push requires admin approval' });
          return { ok: false, pendingApproval: true };
        }
        const r = await agentShell.execCommand(`git push origin ${step.branch || 'HEAD'}`, 30000);
        log('push', { branch: step.branch, ok: r.ok });
        return r;
      }
      case 'pr': {
        if (!state.approvedPush) {
          log('pending_approval', { reason: 'PR requires admin approval' });
          return { ok: false, pendingApproval: true };
        }
        const r = await agentGitHub.createPr(step.branch, step.title, step.body);
        log('pr', { branch: step.branch, ok: r.ok });
        return r;
      }
      case 'think': {
        log('think', { reason: step.reason || step.content || '(no reasoning)' });
        return { ok: true };
      }
      default:
        log('unknown_step', { type: step.type });
        return { ok: false, error: `Unknown step type: ${step.type}` };
    }
  } catch (err) {
    log('error', { message: err.message });
    return { ok: false, error: err.message };
  }
}

// ── Main Orchestrator ──

async function startTask(description, options = {}) {
  const { approvedCommit = false, approvedPush = false, codebaseSummary = '' } = options;

  // 1. Create DB task
  const task = await createTask({
    title: description.slice(0, 120),
    description,
    priority: 'high',
  });
  const taskId = task.id;

  // 2. State
  const state = {
    logs: [],
    fileCache: {},
    backups: {},
    modifiedPaths: new Set(),
    approvedCommit,
    approvedPush,
    status: 'planning',
  };

  // 3. Generate plan
  const plan = await _generatePlan(description, codebaseSummary);
  state.plan = plan;
  state.status = 'executing';
  await updateTask(taskId, { status: 'in_progress', description: `Plan: ${plan.steps.length} steps` });

  // 4. Execute steps
  for (const step of plan.steps.slice(0, MAX_STEPS)) {
    const result = await _executeStep(taskId, step, state);
    if (result.blocked) {
      state.status = 'blocked';
      await updateTask(taskId, { status: 'blocked', description: `Blocked at step ${step.id}: ${result.reason || step.type}` });
      break;
    }
    if (result.pendingApproval) {
      state.status = 'pending_approval';
      await updateTask(taskId, { status: 'pending_approval', description: `Waiting approval at step ${step.id}: ${step.type}` });
      break;
    }
    if (!result.ok && step.type !== 'test') {
      // For non-test steps, fail fast
      state.status = 'failed';
      await updateTask(taskId, { status: 'failed', description: `Failed at step ${step.id}: ${step.type}` });
      break;
    }
    if (!result.ok && step.type === 'test') {
      // Auto-iterate on test failure (up to 3 attempts)
      // TODO: send test output back to LLM for fix generation
      state.status = 'test_failed';
      await updateTask(taskId, { status: 'test_failed', description: `Tests failed at step ${step.id}` });
      break;
    }
  }

  if (state.status === 'executing') {
    state.status = 'done';
    await updateTask(taskId, { status: 'done', description: `Completed ${plan.steps.length} steps` });
  }

  return {
    ok: state.status === 'done' || state.status === 'pending_approval',
    taskId,
    status: state.status,
    logs: state.logs,
    modifiedPaths: Array.from(state.modifiedPaths),
    backups: Object.keys(state.backups),
  };
}

/**
 * Approve a pending task so it can proceed with commit/push/PR.
 */
async function approveTask(taskId, { commit = false, push = false } = {}) {
  // In a full implementation we'd load the task state from DB/memory.
  // For now, the orchestrator is stateless per-process; the UI will
  // re-invoke startTask with approvals set.
  return { ok: true, taskId, approvedCommit: commit, approvedPush: push };
}

/**
 * Revert all file changes for a task using stored backups.
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
