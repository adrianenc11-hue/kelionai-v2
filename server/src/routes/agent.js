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
router.post('/fs/read', async (req, res) => {
  try {
    const result = await agentFs.readFile(req.body.path);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/read]', err && err.message);
    res.status(500).json({ error: 'File read failed' });
  }
});

router.post('/fs/write', async (req, res) => {
  try {
    const result = await agentFs.writeFile(req.body.path, req.body.content);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/write]', err && err.message);
    res.status(500).json({ error: 'File write failed' });
  }
});

router.post('/fs/list', async (req, res) => {
  try {
    const result = await agentFs.listDir(req.body.path);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[agent/fs/list]', err && err.message);
    res.status(500).json({ error: 'Directory list failed' });
  }
});

// ── Shell ──
router.post('/shell/exec', async (req, res) => {
  try {
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

module.exports = router;
