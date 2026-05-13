'use strict';

const { execCommand } = require('./agentShell');

const RAILWAY_TOKEN = process.env.AGENT_RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
const RAILWAY_PROJECT = process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_PROJECT;

async function railwayFetch(path, method = 'GET', body = null) {
  if (!RAILWAY_TOKEN) return { ok: false, error: 'RAILWAY_TOKEN not configured.' };
  const url = `https://backboard.railway.app/graphql/v2${path}`;
  try {
    const { fetch } = await import('node-fetch');
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, status: res.status, error: data?.message || JSON.stringify(data) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function redeploy() {
  if (!RAILWAY_TOKEN) return { ok: false, error: 'RAILWAY_TOKEN not configured.' };
  return execCommand('curl -s -X POST https://backboard.railway.app/graphql/v2 -H "Authorization: Bearer ' + RAILWAY_TOKEN + '" -H "Content-Type: application/json" -d \'{"query": "mutation { deploy }"}\' 2>&1', 60000);
}

async function getDeployments() {
  if (!RAILWAY_TOKEN) return { ok: false, error: 'RAILWAY_TOKEN not configured.' };
  return execCommand('curl -s -X POST https://backboard.railway.app/graphql/v2 -H "Authorization: Bearer ' + RAILWAY_TOKEN + '" -H "Content-Type: application/json" -d \'{"query": "query { deployments { edges { node { id status createdAt } } } }"}\' 2>&1', 30000);
}

async function getLogs(deploymentId) {
  if (!deploymentId) return { ok: false, error: 'No deploymentId provided.' };
  if (!RAILWAY_TOKEN) return { ok: false, error: 'RAILWAY_TOKEN not configured.' };
  return execCommand(`curl -s -X POST https://backboard.railway.app/graphql/v2 -H "Authorization: Bearer ${RAILWAY_TOKEN}" -H "Content-Type: application/json" -d '{"query": "query { deploymentLogs(deploymentId: \\"${deploymentId}\\") }"}' 2>&1`, 30000);
}

module.exports = { redeploy, getDeployments, getLogs };
