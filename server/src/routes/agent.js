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
  const result = await agentFs.readFile(req.body.path);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/fs/write', async (req, res) => {
  const result = await agentFs.writeFile(req.body.path, req.body.content);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/fs/list', async (req, res) => {
  const result = await agentFs.listDir(req.body.path);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Shell ──
router.post('/shell/exec', async (req, res) => {
  const result = await agentShell.execCommand(req.body.command, req.body.timeout);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Web ──
router.post('/web/fetch', async (req, res) => {
  const result = await agentWeb.fetchUrl(req.body.url, req.body.options);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/web/search', async (req, res) => {
  const result = await agentWeb.searchWeb(req.body.query, req.body.numResults);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Browser ──
router.post('/browser/screenshot', async (req, res) => {
  const result = await agentBrowser.screenshot(req.body.url, req.body.options);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/browser/content', async (req, res) => {
  const result = await agentBrowser.getPageContent(req.body.url);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── GitHub ──
router.post('/github/create-pr', async (req, res) => {
  const result = await agentGitHub.createPr(req.body.branch, req.body.title, req.body.body, req.body.base);
  res.status(result.ok ? 200 : 400).json(result);
});

router.get('/github/open-prs', async (req, res) => {
  const result = await agentGitHub.listOpenPrs();
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/github/merge-pr', async (req, res) => {
  const result = await agentGitHub.mergePr(req.body.number);
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Deploy ──
router.post('/deploy/redeploy', async (req, res) => {
  const result = await agentDeploy.redeploy();
  res.status(result.ok ? 200 : 400).json(result);
});

router.get('/deploy/list', async (req, res) => {
  const result = await agentDeploy.getDeployments();
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Diagnostics ──
router.post('/diag/tests', async (req, res) => {
  const result = await agentDiagnostics.runTests(req.body.filter);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/diag/build', async (req, res) => {
  const result = await agentDiagnostics.runBuild();
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/diag/lint', async (req, res) => {
  const result = await agentDiagnostics.runLint();
  res.status(result.ok ? 200 : 400).json(result);
});

router.get('/diag/git-status', async (req, res) => {
  const result = await agentDiagnostics.getGitStatus();
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Tasks ──
router.post('/tasks/create', async (req, res) => {
  const result = await agentTasks.createTask(req.body);
  res.status(result.ok ? 200 : 400).json(result);
});

router.post('/tasks/update/:id', async (req, res) => {
  const result = await agentTasks.updateTask(req.params.id, req.body);
  res.status(result.ok ? 200 : 400).json(result);
});

router.get('/tasks', async (req, res) => {
  const result = await agentTasks.getTasks(req.query.status);
  res.status(result.ok ? 200 : 400).json(result);
});

router.delete('/tasks/:id', async (req, res) => {
  const result = await agentTasks.deleteTask(req.params.id);
  res.status(result.ok ? 200 : 400).json(result);
});

module.exports = router;
