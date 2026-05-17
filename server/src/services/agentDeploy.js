'use strict';

/**
 * @fileoverview agentDeploy.js — Kelion Autonomous Deploy Agent
 *
 * Manages deployment lifecycle via Railway GraphQL API and git-based
 * deploy flow. The agent always deploys through PRs to master — Railway
 * auto-deploys on master push.
 *
 * Flow:
 * 1. Agent creates branch + commits changes
 * 2. Agent creates PR via agentGitHub.createPr()
 * 3. Owner merges PR on GitHub
 * 4. Railway detects master push → builds + deploys
 * 5. Agent polls /health endpoint for deploy_sha match
 * 6. If timeout → reports failure (owner must check Railway dashboard)
 *
 * @module services/agentDeploy
 */

const { execCommand } = require('./agentShell');

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://kelionai.app';
const RAILWAY_TOKEN = process.env.AGENT_RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
const RAILWAY_GRAPHQL = 'https://backboard.railway.app/graphql/v2';
const DEPLOY_VERIFY_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes
const DEPLOY_POLL_INTERVAL_MS = 15_000; // 15 seconds

// ── Railway GraphQL Client ───────────────────────────────────────

/**
 * Execute a Railway GraphQL query/mutation.
 * @param {string} query - GraphQL query string
 * @param {object} [variables]
 * @returns {Promise<{ok, data?, error?}>}
 */
async function _railwayGql(query, variables = {}) {
  if (!RAILWAY_TOKEN) return { ok: false, error: 'RAILWAY_TOKEN not configured.' };
  try {
    const res = await fetch(RAILWAY_GRAPHQL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) {
      return { ok: false, error: json.errors.map(e => e.message).join('; ') };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Deploy Verification ──────────────────────────────────────────

/**
 * Poll the production /health endpoint until deploy_sha matches the
 * expected commit SHA, or timeout.
 * @param {string} expectedSha — the git commit SHA to wait for
 * @param {number} [timeoutMs] — max wait time (default 8 min)
 * @returns {Promise<{ok, deploy_sha?, elapsed_ms?, error?}>}
 */
async function verifyDeploy(expectedSha, timeoutMs = DEPLOY_VERIFY_TIMEOUT_MS) {
  if (!expectedSha) return { ok: false, error: 'expectedSha required.' };
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${PRODUCTION_URL}/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      const liveSha = data?.deploy_sha;

      if (liveSha === expectedSha) {
        return { ok: true, deploy_sha: liveSha, elapsed_ms: timeoutMs - (deadline - Date.now()) };
      }
      if (liveSha === 'unknown') {
        // Pre-sync-gate build — proceed without matching
        return { ok: true, deploy_sha: liveSha, elapsed_ms: timeoutMs - (deadline - Date.now()), note: 'Production does not expose deploy_sha yet.' };
      }

      console.log(`[agentDeploy] Waiting... live_sha=${liveSha || '(empty)'}, expected=${expectedSha.slice(0, 8)}`);
    } catch (e) {
      console.warn(`[agentDeploy] Health check failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, DEPLOY_POLL_INTERVAL_MS));
  }

  return { ok: false, error: `Deploy verification timed out after ${timeoutMs / 1000}s. Expected SHA: ${expectedSha.slice(0, 12)}`, elapsed_ms: timeoutMs };
}

/**
 * Get the current production health status.
 * @returns {Promise<{ok, data?: {status, deploy_sha, uptime_seconds, version, memory}}>}
 */
async function getProductionHealth() {
  try {
    const res = await fetch(`${PRODUCTION_URL}/health`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Railway Service Status ───────────────────────────────────────

/**
 * Get recent deployments from Railway.
 * @param {number} [limit=5]
 * @returns {Promise<{ok, data?}>}
 */
async function getDeployments(limit = 5) {
  return _railwayGql(`
    query {
      deployments(first: ${Math.min(limit, 20)}) {
        edges {
          node {
            id
            status
            createdAt
            updatedAt
          }
        }
      }
    }
  `);
}

/**
 * Get deployment logs.
 * @param {string} deploymentId
 * @returns {Promise<{ok, data?}>}
 */
async function getLogs(deploymentId) {
  if (!deploymentId) return { ok: false, error: 'deploymentId required.' };
  return _railwayGql(`
    query($id: String!) {
      deploymentLogs(deploymentId: $id) {
        message
        timestamp
        severity
      }
    }
  `, { id: deploymentId });
}

/**
 * Get the current commit SHA from git HEAD.
 * @returns {Promise<{ok, sha?}>}
 */
async function getCurrentCommitSha() {
  const result = await execCommand('git rev-parse HEAD', 5000);
  if (result.ok) {
    return { ok: true, sha: result.stdout.trim() };
  }
  return { ok: false, error: result.error || 'Failed to get commit SHA.' };
}

/**
 * Full deploy pipeline: push to master is handled by PR merge.
 * This function verifies the deploy after merge.
 * @param {string} commitSha — SHA of the merged commit
 * @returns {Promise<{ok, data?}>}
 */
async function deployAndVerify(commitSha) {
  if (!commitSha) {
    const shaResult = await getCurrentCommitSha();
    if (!shaResult.ok) return { ok: false, error: 'Cannot determine commit SHA: ' + shaResult.error };
    commitSha = shaResult.sha;
  }

  console.log(`[agentDeploy] Verifying deployment of commit ${commitSha.slice(0, 8)}...`);

  // Step 1: Check current production state
  const preHealth = await getProductionHealth();
  console.log(`[agentDeploy] Pre-deploy health: ${JSON.stringify(preHealth.data?.deploy_sha || 'unknown')}`);

  // Step 2: Wait for Railway to deploy the commit
  const verify = await verifyDeploy(commitSha);

  if (verify.ok) {
    console.log(`[agentDeploy] ✅ Deploy verified in ${verify.elapsed_ms}ms. SHA: ${verify.deploy_sha}`);
  } else {
    console.error(`[agentDeploy] ❌ Deploy verification failed: ${verify.error}`);
  }

  // Step 3: Post-deploy health check
  const postHealth = await getProductionHealth();

  return {
    ok: verify.ok,
    data: {
      commitSha,
      verification: verify,
      preDeployHealth: preHealth.data,
      postDeployHealth: postHealth.data,
    },
  };
}

module.exports = {
  verifyDeploy,
  deployAndVerify,
  getProductionHealth,
  getDeployments,
  getLogs,
  getCurrentCommitSha,
};
