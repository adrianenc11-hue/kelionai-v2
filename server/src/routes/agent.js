'use strict';

const { Router } = require('express');
const { requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const agentFs = require('../services/agentFs');
const agentShell = require('../services/agentShell');
const agentWeb = require('../services/agentWeb');
const agentBrowser = require('../services/agentBrowser');
const agentGitHub = require('../services/agentGitHub');
const agentDeploy = require('../services/agentDeploy');
const agentDiagnostics = require('../services/agentDiagnostics');
const agentTasks = require('../services/agentTasks');
const agentOrchestrator = require('../services/agentOrchestrator');
const agentSandbox = require('../services/agentSandbox');
const { isPathAllowed: _isPathAllowed, isShellAllowed: _isShellAllowed } = agentOrchestrator;

const router = Router();

// Admin-only, rate-limited: agent actions can be expensive.
const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

router.use(requireAdmin);
router.use(agentLimiter);

// ── File System ──
// All FS routes apply the same path guardrails as the orchestrator to prevent
// traversal into blocked files (auth, env, payment, agent source, secrets).
router.post('/fs/read', async (req, res) => {
  try {
    if (!_isPathAllowed(req.body.path)) {
      return res.status(403).json({ ok: false, error: 'Path blocked by safety guardrail.' });
    }
    const result = await agentFs.readFile(req.body.path);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/read]', err && err.message);
    res.status(500).json({ error: 'File read failed' });
  }
});

router.post('/fs/write', async (req, res) => {
  try {
    if (!_isPathAllowed(req.body.path)) {
      return res.status(403).json({ ok: false, error: 'Path blocked by safety guardrail.' });
    }
    const result = await agentFs.writeFile(req.body.path, req.body.content);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/write]', err && err.message);
    res.status(500).json({ error: 'File write failed' });
  }
});

router.post('/fs/list', async (req, res) => {
  try {
    if (req.body.path && !_isPathAllowed(req.body.path)) {
      return res.status(403).json({ ok: false, error: 'Path blocked by safety guardrail.' });
    }
    const result = await agentFs.listDir(req.body.path);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/list]', err && err.message);
    res.status(500).json({ error: 'Directory list failed' });
  }
});

// ── Shell ──
// Applies the same shell-pattern blocklist as the orchestrator (regex-based,
// catches eval(), curl | bash, rm -rf /, etc.). The simple string match in
// agentShell.js is kept as a second redundant layer.
router.post('/shell/exec', async (req, res) => {
  try {
    if (!_isShellAllowed(req.body.command)) {
      return res.status(403).json({ ok: false, error: 'Command blocked by safety guardrail.' });
    }
    const result = await agentShell.execCommand(req.body.command, req.body.timeout);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/shell/exec]', err && err.message);
    res.status(500).json({ error: 'Shell execution failed' });
  }
});

// ── Web ──
router.post('/web/fetch', async (req, res) => {
  try {
    const result = await agentWeb.fetchUrl(req.body.url, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/web/fetch]', err && err.message);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

router.post('/web/search', async (req, res) => {
  try {
    const result = await agentWeb.searchWeb(req.body.query, req.body.numResults);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/web/search]', err && err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Browser ──
router.post('/browser/screenshot', async (req, res) => {
  try {
    const result = await agentBrowser.screenshot(req.body.url, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/screenshot]', err && err.message);
    res.status(500).json({ error: 'Screenshot failed' });
  }
});

router.post('/browser/content', async (req, res) => {
  try {
    const result = await agentBrowser.getPageContent(req.body.url);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/content]', err && err.message);
    res.status(500).json({ error: 'Page content fetch failed' });
  }
});

// ── Browser: Full Navigation (NEW) ──
router.post('/browser/navigate', async (req, res) => {
  try {
    const result = await agentBrowser.navigate(req.body.url, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/navigate]', err && err.message);
    res.status(500).json({ error: 'Navigation failed' });
  }
});

router.post('/browser/click', async (req, res) => {
  try {
    const result = await agentBrowser.click(req.body.url, req.body.selector, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/click]', err && err.message);
    res.status(500).json({ error: 'Click failed' });
  }
});

router.post('/browser/type', async (req, res) => {
  try {
    const result = await agentBrowser.type(req.body.url, req.body.selector, req.body.text, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/type]', err && err.message);
    res.status(500).json({ error: 'Type failed' });
  }
});

router.post('/browser/extract', async (req, res) => {
  try {
    const result = await agentBrowser.extractStructured(req.body.url, req.body.schema);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/extract]', err && err.message);
    res.status(500).json({ error: 'Extract failed' });
  }
});

router.post('/browser/fill-form', async (req, res) => {
  try {
    const result = await agentBrowser.fillForm(req.body.url, req.body.fields, req.body.options);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/fill-form]', err && err.message);
    res.status(500).json({ error: 'Form fill failed' });
  }
});

router.post('/browser/links', async (req, res) => {
  try {
    const result = await agentBrowser.getLinks(req.body.url);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/links]', err && err.message);
    res.status(500).json({ error: 'Links extraction failed' });
  }
});

router.post('/browser/evaluate', async (req, res) => {
  try {
    const result = await agentBrowser.evaluateJs(req.body.url, req.body.code);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/browser/evaluate]', err && err.message);
    res.status(500).json({ error: 'JS evaluation failed' });
  }
});

// ── GitHub ──
router.post('/github/create-pr', async (req, res) => {
  try {
    const result = await agentGitHub.createPr(req.body.branch, req.body.title, req.body.body, req.body.base);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/github/create-pr]', err && err.message);
    res.status(500).json({ error: 'PR creation failed' });
  }
});

router.get('/github/open-prs', async (req, res) => {
  try {
    const result = await agentGitHub.listOpenPrs();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/github/open-prs]', err && err.message);
    res.status(500).json({ error: 'PR list failed' });
  }
});

router.post('/github/merge-pr', async (req, res) => {
  try {
    const result = await agentGitHub.mergePr(req.body.number);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/github/merge-pr]', err && err.message);
    res.status(500).json({ error: 'PR merge failed' });
  }
});

// ── Deploy ──
router.post('/deploy/redeploy', async (req, res) => {
  try {
    const result = await agentDeploy.redeploy();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/deploy/redeploy]', err && err.message);
    res.status(500).json({ error: 'Redeploy failed' });
  }
});

router.get('/deploy/list', async (req, res) => {
  try {
    const result = await agentDeploy.getDeployments();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/deploy/list]', err && err.message);
    res.status(500).json({ error: 'Deployment list failed' });
  }
});

// ── Deploy: Verification + Health (NEW) ──
router.post('/deploy/verify', async (req, res) => {
  try {
    const result = await agentDeploy.deployAndVerify(req.body.commitSha);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/deploy/verify]', err && err.message);
    res.status(500).json({ error: 'Deploy verification failed' });
  }
});

router.get('/deploy/health', async (req, res) => {
  try {
    const result = await agentDeploy.getProductionHealth();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/deploy/health]', err && err.message);
    res.status(500).json({ error: 'Health check failed' });
  }
});

// ── Sandbox: Isolated JS Execution (NEW) ──
router.post('/sandbox/execute', async (req, res) => {
  try {
    const result = await agentSandbox.executeJs(req.body.code, {
      timeout: req.body.timeout,
      globals: req.body.globals,
    });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/sandbox/execute]', err && err.message);
    res.status(500).json({ error: 'Sandbox execution failed' });
  }
});

router.post('/sandbox/validate', async (req, res) => {
  try {
    const result = agentSandbox.validateCode(req.body.code);
    res.json(result);
  } catch (err) {
    console.error('[agent/sandbox/validate]', err && err.message);
    res.status(500).json({ error: 'Code validation failed' });
  }
});

// ── Diagnostics ──
router.post('/diag/tests', async (req, res) => {
  try {
    const result = await agentDiagnostics.runTests(req.body.filter);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/diag/tests]', err && err.message);
    res.status(500).json({ error: 'Test run failed' });
  }
});

router.post('/diag/build', async (req, res) => {
  try {
    const result = await agentDiagnostics.runBuild();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/diag/build]', err && err.message);
    res.status(500).json({ error: 'Build failed' });
  }
});

router.post('/diag/lint', async (req, res) => {
  try {
    const result = await agentDiagnostics.runLint();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/diag/lint]', err && err.message);
    res.status(500).json({ error: 'Lint failed' });
  }
});

router.get('/diag/git-status', async (req, res) => {
  try {
    const result = await agentDiagnostics.getGitStatus();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/diag/git-status]', err && err.message);
    res.status(500).json({ error: 'Git status failed' });
  }
});

// ── Tasks ──
router.post('/tasks/create', async (req, res) => {
  try {
    const result = await agentTasks.createTask(req.body);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/tasks/create]', err && err.message);
    res.status(500).json({ error: 'Task creation failed' });
  }
});

router.post('/tasks/update/:id', async (req, res) => {
  try {
    const result = await agentTasks.updateTask(req.params.id, req.body);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/tasks/update]', err && err.message);
    res.status(500).json({ error: 'Task update failed' });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const result = await agentTasks.getTasks(req.query.status);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/tasks/list]', err && err.message);
    res.status(500).json({ error: 'Task list failed' });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    const result = await agentTasks.deleteTask(req.params.id);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/tasks/delete]', err && err.message);
    res.status(500).json({ error: 'Task deletion failed' });
  }
});

// ── Dev Agent Orchestrator ──
// Starts an autonomous coding task: plan → execute → test → commit.
// Requires admin approval for commit/push steps.

router.post('/dev/start', async (req, res) => {
  try {
    const { description, codebaseSummary, approvedCommit, approvedPush } = req.body || {};
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'description required' });
    }
    const result = await agentOrchestrator.startTask(description, {
      codebaseSummary: String(codebaseSummary || ''),
      approvedCommit: Boolean(approvedCommit),
      approvedPush: Boolean(approvedPush),
    });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (err) {
    console.error('[agent/dev/start]', err && err.message);
    res.status(500).json({ error: 'Dev agent start failed' });
  }
});

router.post('/dev/approve', async (req, res) => {
  try {
    const { taskId, commit, push } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId required' });
    const result = await agentOrchestrator.approveTask(taskId, { commit: Boolean(commit), push: Boolean(push) });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/dev/approve]', err && err.message);
    res.status(500).json({ error: 'Approval failed' });
  }
});

router.post('/dev/revert', async (req, res) => {
  try {
    const { taskId, state } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId required' });
    const result = await agentOrchestrator.revertTask(taskId, state || {});
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/dev/revert]', err && err.message);
    res.status(500).json({ error: 'Revert failed' });
  }
});

module.exports = router;
