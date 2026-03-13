// ═══════════════════════════════════════════════════════════════
// KelionAI — Self-Healing Watchdog v2 (FULL AUTO)
// Error detection → AI analysis → Auto-fix → Deploy → Verify → Revert
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_THRESHOLD = 5; // min occurrences to trigger
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per pattern
const MAX_FIXES_PER_HOUR = 3; // rate limit
const DEPLOY_WAIT_MS = 3 * 60 * 1000; // 3 min wait for Railway deploy
const HEALTH_CHECK_RETRIES = 3; // retry health check N times

const GITHUB_OWNER = "adrianenc11-hue";
const GITHUB_REPO = "kelionai-v2";
const GITHUB_BRANCH = "master";

// Auto-fix only for low/medium severity — high/critical get issues only
const AUTO_FIX_SEVERITIES = ["low", "medium"];

// Track state
const _processedPatterns = new Map();
const _autoFixLog = []; // history of all auto-fixes
let _fixesThisHour = 0;
let _hourReset = Date.now();
let _scanInterval = null;
let _isScanning = false;
let _appUrl = "";

/**
 * Start the self-healing watchdog
 */
function start({ errorPatterns, brain, supabaseAdmin }) {
  if (_scanInterval) {
    logger.warn({ component: "SelfHeal" }, "Watchdog already running");
    return;
  }

  _appUrl =
    process.env.APP_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  logger.info(
    {
      component: "SelfHeal",
      interval: SCAN_INTERVAL_MS / 1000 + "s",
      autoFix: true,
      autoFixSeverities: AUTO_FIX_SEVERITIES,
    },
    "🐕 Self-Healing Watchdog v2 started — FULL AUTO MODE",
  );

  // Initial scan after 60s (let server fully stabilize)
  setTimeout(() => scan({ errorPatterns, brain, supabaseAdmin }), 60000);

  // Then scan every 5 minutes
  _scanInterval = setInterval(
    () => scan({ errorPatterns, brain, supabaseAdmin }),
    SCAN_INTERVAL_MS,
  );
}

function stop() {
  if (_scanInterval) {
    clearInterval(_scanInterval);
    _scanInterval = null;
    logger.info({ component: "SelfHeal" }, "🐕 Watchdog stopped");
  }
}

/**
 * Main scan loop
 */
async function scan({ errorPatterns, brain, supabaseAdmin }) {
  if (_isScanning) return;
  _isScanning = true;

  try {
    // Reset hourly counter
    if (Date.now() - _hourReset > 60 * 60 * 1000) {
      _fixesThisHour = 0;
      _hourReset = Date.now();
    }

    // Collect error patterns above threshold
    const critical = [];

    if (errorPatterns && errorPatterns.size > 0) {
      errorPatterns.forEach((count, key) => {
        if (count >= ERROR_THRESHOLD && !_isOnCooldown(key)) {
          critical.push({ source: "frontend", key, count });
        }
      });
    }

    if (brain && brain.toolErrors) {
      for (const [tool, count] of Object.entries(brain.toolErrors)) {
        if (count >= ERROR_THRESHOLD) {
          const key = `backend:tool:${tool}`;
          if (!_isOnCooldown(key)) {
            critical.push({ source: "backend", key, count, tool });
          }
        }
      }
    }

    if (brain && brain.errorLog && brain.errorLog.length > 0) {
      const grouped = {};
      brain.errorLog.forEach((e) => {
        const k = (e.message || e).toString().substring(0, 80);
        grouped[k] = (grouped[k] || 0) + 1;
      });
      for (const [msg, count] of Object.entries(grouped)) {
        if (count >= ERROR_THRESHOLD) {
          const key = `backend:error:${msg}`;
          if (!_isOnCooldown(key)) {
            critical.push({ source: "backend", key, count, message: msg });
          }
        }
      }
    }

    if (critical.length === 0) return;

    logger.warn(
      { component: "SelfHeal", patterns: critical.length },
      `🔴 ${critical.length} critical error pattern(s) detected`,
    );

    for (const pattern of critical) {
      if (_fixesThisHour >= MAX_FIXES_PER_HOUR) {
        logger.warn(
          { component: "SelfHeal" },
          "⚠️ Max fixes per hour reached, pausing",
        );
        break;
      }
      await _processPattern(pattern, { brain, supabaseAdmin });
    }
  } catch (e) {
    logger.error(
      { component: "SelfHeal", err: e.message },
      "Watchdog scan error",
    );
  } finally {
    _isScanning = false;
  }
}

/**
 * Process a single error pattern — FULL AUTO PIPELINE
 * Analyze → Fix → Commit → Deploy → Health Check → Revert if broken
 */
async function _processPattern(pattern, { brain, supabaseAdmin }) {
  const { key, count, source } = pattern;
  const githubToken = process.env.GITHUB_TOKEN;
  const timestamp = new Date().toISOString();

  const logEntry = {
    key,
    count,
    source,
    timestamp,
    steps: [],
    result: "pending",
  };

  logger.info(
    { component: "SelfHeal", key, count, source },
    `🧠 [Step 1/6] Analyzing pattern: ${key}`,
  );

  // ── STEP 1: AI ANALYSIS ──
  let aiAnalysis = null;
  if (brain && typeof brain.singleProviderCall === "function") {
    try {
      const prompt = `You are a senior Node.js developer. KelionAI has a RECURRING ERROR (${count}x):

Source: ${source}
Key: ${key}
${pattern.message ? `Message: ${pattern.message}` : ""}
${pattern.tool ? `Failed Tool: ${pattern.tool}` : ""}

You MUST respond in this EXACT JSON format (nothing else):
{
  "severity": "low|medium|high|critical",
  "rootCause": "1-sentence root cause",
  "file": "server/path/to/file.js",
  "originalCode": "the exact lines to replace (or null if new code needed)",
  "fixedCode": "the corrected code (or null if cannot auto-fix)",
  "canAutoFix": true,
  "explanation": "Why this fix works"
}

RULES:
- severity low/medium = safe to auto-fix
- severity high/critical = needs human review
- canAutoFix = true ONLY if you are 95%+ confident the fix is correct
- originalCode and fixedCode must be EXACT (copy-paste ready)
- If unsure, set canAutoFix to false`;

      const raw = await Promise.race([
        brain.singleProviderCall(prompt, 800),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("AI timeout")), 15000),
        ),
      ]);

      const jsonMatch = (raw || "").match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiAnalysis = JSON.parse(jsonMatch[0]);
      }
      logEntry.steps.push({ step: "analysis", status: "ok", aiAnalysis });
    } catch (e) {
      logEntry.steps.push({ step: "analysis", status: "failed", error: e.message });
      logger.warn(
        { component: "SelfHeal", err: e.message },
        "AI analysis failed",
      );
    }
  }

  if (!aiAnalysis) {
    logEntry.result = "no_analysis";
    _finalize(logEntry, pattern, supabaseAdmin);
    return;
  }

  const severity = aiAnalysis.severity || "medium";
  const canAutoFix =
    aiAnalysis.canAutoFix === true &&
    AUTO_FIX_SEVERITIES.includes(severity) &&
    aiAnalysis.file &&
    aiAnalysis.fixedCode;

  // ── STEP 2: DECIDE — AUTO-FIX or ISSUE-ONLY ──
  if (!canAutoFix || !githubToken) {
    logger.info(
      { component: "SelfHeal", severity, canAutoFix, hasToken: !!githubToken },
      `📋 [Step 2/6] Creating issue only (severity: ${severity}, autoFix: ${canAutoFix})`,
    );
    const issueUrl = await _createGithubIssue(pattern, aiAnalysis, githubToken);
    logEntry.steps.push({ step: "issue", status: issueUrl ? "ok" : "skipped", issueUrl });
    logEntry.result = "issue_only";
    _fixesThisHour++;
    _finalize(logEntry, pattern, supabaseAdmin);
    return;
  }

  // ── STEP 3: AUTO-FIX — COMMIT CODE ──
  logger.info(
    { component: "SelfHeal", file: aiAnalysis.file },
    `🔧 [Step 3/6] Auto-fixing: ${aiAnalysis.file}`,
  );

  let commitSha = null;
  try {
    commitSha = await _commitFix(aiAnalysis, githubToken, key);
    logEntry.steps.push({ step: "commit", status: "ok", sha: commitSha });
    logger.info(
      { component: "SelfHeal", sha: commitSha },
      `✅ [Step 3/6] Fix committed: ${commitSha}`,
    );
  } catch (e) {
    logEntry.steps.push({ step: "commit", status: "failed", error: e.message });
    logEntry.result = "commit_failed";
    logger.error(
      { component: "SelfHeal", err: e.message },
      "Commit failed — creating issue instead",
    );
    const issueUrl = await _createGithubIssue(pattern, aiAnalysis, githubToken);
    logEntry.steps.push({ step: "issue_fallback", issueUrl });
    _finalize(logEntry, pattern, supabaseAdmin);
    return;
  }

  // ── STEP 4: WAIT FOR DEPLOY ──
  logger.info(
    { component: "SelfHeal", waitMs: DEPLOY_WAIT_MS },
    `⏳ [Step 4/6] Waiting ${DEPLOY_WAIT_MS / 1000}s for Railway deploy...`,
  );
  await _sleep(DEPLOY_WAIT_MS);
  logEntry.steps.push({ step: "deploy_wait", status: "ok" });

  // ── STEP 5: HEALTH CHECK ──
  logger.info(
    { component: "SelfHeal" },
    `🏥 [Step 5/6] Running health check...`,
  );

  const healthy = await _healthCheck();
  logEntry.steps.push({ step: "health_check", status: healthy ? "ok" : "failed" });

  if (healthy) {
    // ── SUCCESS! ──
    logger.info(
      { component: "SelfHeal", sha: commitSha },
      `🎉 [Step 6/6] AUTO-FIX SUCCESSFUL! ${aiAnalysis.file} is healthy`,
    );
    logEntry.result = "auto_fixed";
    _fixesThisHour++;
    _finalize(logEntry, pattern, supabaseAdmin);
    return;
  }

  // ── STEP 6: REVERT ──
  logger.warn(
    { component: "SelfHeal", sha: commitSha },
    `⚠️ [Step 6/6] Health check FAILED — REVERTING commit ${commitSha}`,
  );

  try {
    const revertSha = await _revertCommit(commitSha, githubToken, key);
    logEntry.steps.push({ step: "revert", status: "ok", revertSha });
    logEntry.result = "reverted";
    logger.info(
      { component: "SelfHeal", revertSha },
      `↩️ Successfully reverted. Creating issue for manual review.`,
    );

    // Create issue since auto-fix failed
    const issueUrl = await _createGithubIssue(
      pattern,
      { ...aiAnalysis, note: "AUTO-FIX WAS ATTEMPTED AND REVERTED — health check failed" },
      githubToken,
    );
    logEntry.steps.push({ step: "issue_post_revert", issueUrl });
  } catch (e) {
    logEntry.steps.push({ step: "revert", status: "failed", error: e.message });
    logEntry.result = "revert_failed";
    logger.error(
      { component: "SelfHeal", err: e.message },
      "🔴 CRITICAL: Revert failed! Manual intervention needed!",
    );
  }

  _finalize(logEntry, pattern, supabaseAdmin);
}

// ═══════════════════════════════════════════════════════
// GITHUB API HELPERS
// ═══════════════════════════════════════════════════════

/**
 * Commit a fix to GitHub (direct to master)
 */
async function _commitFix(aiAnalysis, githubToken, patternKey) {
  const { file, fixedCode } = aiAnalysis;
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
  };

  // 1. Get current file content from GitHub
  const fileRes = await fetch(`${api}/contents/${file}?ref=${GITHUB_BRANCH}`, { headers });
  if (!fileRes.ok) {
    throw new Error(`File not found on GitHub: ${file} (${fileRes.status})`);
  }
  const fileData = await fileRes.json();
  const currentContent = Buffer.from(fileData.content, "base64").toString("utf-8");

  // 2. Apply fix
  let newContent;
  if (aiAnalysis.originalCode && currentContent.includes(aiAnalysis.originalCode)) {
    // Replace specific code block
    newContent = currentContent.replace(aiAnalysis.originalCode, fixedCode);
  } else {
    // Can't find exact code to replace — abort
    throw new Error(
      `Cannot find originalCode in ${file} — aborting auto-fix for safety`,
    );
  }

  if (newContent === currentContent) {
    throw new Error("Fix produced no changes — aborting");
  }

  // 3. Commit the fix
  const commitMsg = `🤖 self-heal: ${aiAnalysis.rootCause || patternKey}\n\nAuto-fix by Self-Healing Watchdog\nPattern: ${patternKey}\nSeverity: ${aiAnalysis.severity}`;

  const commitRes = await fetch(`${api}/contents/${file}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: commitMsg,
      content: Buffer.from(newContent).toString("base64"),
      sha: fileData.sha,
      branch: GITHUB_BRANCH,
    }),
  });

  if (!commitRes.ok) {
    const err = await commitRes.json();
    throw new Error(`GitHub commit failed: ${err.message || commitRes.status}`);
  }

  const commitData = await commitRes.json();
  return commitData.commit?.sha?.substring(0, 7) || "unknown";
}

/**
 * Revert a commit by restoring the previous version
 */
async function _revertCommit(commitSha, githubToken, patternKey) {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
  };

  // Get the commit to find parent
  const commitRes = await fetch(`${api}/commits/${GITHUB_BRANCH}`, { headers });
  const commitData = await commitRes.json();

  if (!commitData.parents || commitData.parents.length === 0) {
    throw new Error("No parent commit found to revert to");
  }

  // Use Git ref to force-update branch to parent commit
  const parentSha = commitData.parents[0].sha;

  const updateRes = await fetch(`${api}/git/refs/heads/${GITHUB_BRANCH}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      sha: parentSha,
      force: true,
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.json();
    throw new Error(`Revert failed: ${err.message || updateRes.status}`);
  }

  logger.info(
    { component: "SelfHeal", parentSha: parentSha.substring(0, 7) },
    `↩️ Branch reset to parent: ${parentSha.substring(0, 7)}`,
  );

  return parentSha.substring(0, 7);
}

/**
 * Create a GitHub issue (for non-auto-fixable or failed fixes)
 */
async function _createGithubIssue(pattern, aiAnalysis, githubToken) {
  if (!githubToken) return null;

  try {
    const severity = aiAnalysis?.severity || "medium";
    const severityEmoji =
      severity === "critical" ? "🔴"
      : severity === "high" ? "🟠"
      : severity === "medium" ? "🟡"
      : "🟢";

    const title = `${severityEmoji} Self-Heal: ${aiAnalysis?.rootCause || pattern.key} (${pattern.count}x)`;

    const body = `## 🤖 Self-Healing Watchdog Report

| Field | Value |
|-------|-------|
| **Source** | ${pattern.source} |
| **Pattern** | \`${pattern.key}\` |
| **Occurrences** | ${pattern.count}x |
| **Severity** | ${severityEmoji} ${severity} |
| **Auto-fixable** | ${aiAnalysis?.canAutoFix ? "✅" : "❌"} |

### AI Analysis
- **Root Cause**: ${aiAnalysis?.rootCause || "Unknown"}
- **Suggested Fix**: ${aiAnalysis?.suggestedFix || aiAnalysis?.explanation || "N/A"}
- **File**: \`${aiAnalysis?.file || "unknown"}\`
${aiAnalysis?.note ? `\n> ⚠️ **${aiAnalysis.note}**` : ""}

---
_Auto-generated by KelionAI Self-Healing Watchdog 🐕_`;

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          title,
          body,
          labels: ["self-heal", "automated", severity],
        }),
      },
    );

    const data = await res.json();
    return data.html_url || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// HEALTH CHECK & UTILITIES
// ═══════════════════════════════════════════════════════

async function _healthCheck() {
  for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
    try {
      const res = await fetch(`${_appUrl}/api/health`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (data.ok || data.status === "ok") {
        return true;
      }
      logger.warn(
        { component: "SelfHeal", attempt: i + 1, data },
        "Health check returned non-ok",
      );
    } catch (e) {
      logger.warn(
        { component: "SelfHeal", attempt: i + 1, err: e.message },
        "Health check failed, retrying...",
      );
    }
    // Wait 10s before retry
    await _sleep(10000);
  }
  return false;
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _isOnCooldown(key) {
  const entry = _processedPatterns.get(key);
  if (!entry) return false;
  return Date.now() - entry.lastTriggered < COOLDOWN_MS;
}

function _finalize(logEntry, pattern, supabaseAdmin) {
  // Save to processed patterns
  _processedPatterns.set(pattern.key, {
    lastTriggered: Date.now(),
    result: logEntry.result,
    steps: logEntry.steps,
  });

  // Save to auto-fix log
  _autoFixLog.push(logEntry);
  if (_autoFixLog.length > 50) _autoFixLog.shift();

  // Save to Supabase brain memory
  if (supabaseAdmin) {
    supabaseAdmin
      .from("brain_memory")
      .insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        memory_type: "self_heal_action",
        content: `[${logEntry.result.toUpperCase()}] ${pattern.key} (${pattern.count}x) — ${logEntry.steps.map((s) => s.step + ":" + s.status).join(" → ")}`,
        context: logEntry,
        importance: logEntry.result === "revert_failed" ? 10 : 8,
      })
      .then(() => {})
      .catch(() => {});
  }

  logger.info(
    { component: "SelfHeal", result: logEntry.result, key: pattern.key },
    `📋 Self-heal complete: ${logEntry.result}`,
  );
}

/**
 * Get watchdog status (for admin panel)
 */
function getStatus() {
  const processed = [];
  _processedPatterns.forEach((val, key) => {
    processed.push({
      key,
      lastTriggered: new Date(val.lastTriggered).toISOString(),
      result: val.result,
      cooldownRemaining: Math.max(
        0,
        Math.round((COOLDOWN_MS - (Date.now() - val.lastTriggered)) / 1000),
      ),
    });
  });

  return {
    version: 2,
    mode: "FULL_AUTO",
    running: !!_scanInterval,
    scanIntervalMs: SCAN_INTERVAL_MS,
    errorThreshold: ERROR_THRESHOLD,
    cooldownMs: COOLDOWN_MS,
    maxFixesPerHour: MAX_FIXES_PER_HOUR,
    fixesThisHour: _fixesThisHour,
    autoFixSeverities: AUTO_FIX_SEVERITIES,
    deployWaitMs: DEPLOY_WAIT_MS,
    healthCheckRetries: HEALTH_CHECK_RETRIES,
    processedPatterns: processed,
    recentFixes: _autoFixLog.slice(-10),
    hasGithubToken: !!process.env.GITHUB_TOKEN,
  };
}

module.exports = { start, stop, scan, getStatus };
