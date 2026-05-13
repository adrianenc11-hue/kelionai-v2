'use strict';

const { execCommand } = require('./agentShell');

async function runTests(filter = '') {
  const cmd = filter
    ? `npx playwright test --grep "${filter}" --reporter=list`
    : 'npx playwright test --reporter=list';
  return execCommand(cmd, 300000);
}

async function runBuild() {
  return execCommand('npm run build', 120000);
}

async function runLint() {
  return execCommand('npx eslint src server/src --ext .js,.jsx,.cjs,.mjs', 60000);
}

async function getGitStatus() {
  return execCommand('git status --short && git log --oneline -3', 15000);
}

module.exports = { runTests, runBuild, runLint, getGitStatus };
