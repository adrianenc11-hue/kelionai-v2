'use strict';

const { execCommand } = require('./agentShell');

async function redeploy() {
  const result = await execCommand('npx @railway/cli up --detach', 120000);
  return result;
}

async function getDeployments() {
  const result = await execCommand('npx @railway/cli deployment list', 30000);
  return result;
}

async function getLogs(deploymentId) {
  if (!deploymentId) return { ok: false, error: 'No deploymentId provided.' };
  const result = await execCommand(`npx @railway/cli logs ${deploymentId}`, 30000);
  return result;
}

module.exports = { redeploy, getDeployments, getLogs };
