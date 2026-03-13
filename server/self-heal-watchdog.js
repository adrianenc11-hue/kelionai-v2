// ═══════════════════════════════════════════════════════════════
// KelionAI — Self-Healing Watchdog
// Automatic error detection → Brain AI analysis → GitHub issue
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_THRESHOLD = 5; // min occurrences to trigger self-heal
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per pattern
const MAX_ISSUES_PER_HOUR = 3; // don't spam GitHub

// Track what we've already processed
const _processedPatterns = new Map(); // key → { lastTriggered, issueUrl }
let _issuesCreatedThisHour = 0;
let _hourReset = Date.now();
let _scanInterval = null;
let _isScanning = false;

/**
 * Start the self-healing watchdog
 * @param {object} opts
 * @param {Map} opts.errorPatterns - Frontend error patterns (from index.js)
 * @param {object} opts.brain - Brain instance (for AI analysis)
 * @param {object} opts.supabaseAdmin - Supabase admin client
 */
function start({ errorPatterns, brain, supabaseAdmin }) {
  if (_scanInterval) {
    logger.warn({ component: "SelfHeal" }, "Watchdog already running");
    return;
  }

  logger.info(
    { component: "SelfHeal", interval: SCAN_INTERVAL_MS / 1000 + "s" },
    "🐕 Self-Healing Watchdog started — scanning every 5 minutes",
  );

  // Initial scan after 30s (let server stabilize)
  setTimeout(() => scan({ errorPatterns, brain, supabaseAdmin }), 30000);

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
      _issuesCreatedThisHour = 0;
      _hourReset = Date.now();
    }

    // 1. Collect error patterns above threshold
    const critical = [];

    // Frontend errors
    if (errorPatterns && errorPatterns.size > 0) {
      errorPatterns.forEach((count, key) => {
        if (count >= ERROR_THRESHOLD && !_isOnCooldown(key)) {
          critical.push({ source: "frontend", key, count });
        }
      });
    }

    // Backend brain errors
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

    // Backend error log
    if (brain && brain.errorLog && brain.errorLog.length > 0) {
      // Group by message
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

    if (critical.length === 0) {
      // All quiet — no action needed
      return;
    }

    logger.warn(
      { component: "SelfHeal", patterns: critical.length },
      `🔴 ${critical.length} critical error pattern(s) detected`,
    );

    // 2. Process each critical pattern
    for (const pattern of critical) {
      if (_issuesCreatedThisHour >= MAX_ISSUES_PER_HOUR) {
        logger.warn(
          { component: "SelfHeal" },
          "⚠️ Max issues per hour reached, pausing",
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
 * Process a single error pattern: AI analysis → GitHub issue
 */
async function _processPattern(pattern, { brain, supabaseAdmin }) {
  const { key, count, source } = pattern;

  logger.info(
    { component: "SelfHeal", key, count, source },
    `🧠 Analyzing pattern: ${key}`,
  );

  // 1. AI Analysis
  let aiAnalysis = null;
  if (brain && typeof brain.singleProviderCall === "function") {
    try {
      const prompt = `You are a senior Node.js developer analyzing a recurring error in KelionAI.

ERROR PATTERN (occurred ${count} times):
Source: ${source}
Key: ${key}
${pattern.message ? `Message: ${pattern.message}` : ""}
${pattern.tool ? `Failed Tool: ${pattern.tool}` : ""}

Analyze this error and respond in EXACT JSON format:
{
  "severity": "low|medium|high|critical",
  "rootCause": "Brief root cause description",
  "suggestedFix": "Specific code change suggestion",
  "file": "probable file path",
  "canAutoFix": false,
  "preventionTip": "How to prevent this in the future"
}`;

      const raw = await Promise.race([
        brain.singleProviderCall(prompt, 500),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("AI timeout")), 10000),
        ),
      ]);

      const jsonMatch = (raw || "").match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiAnalysis = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.warn(
        { component: "SelfHeal", err: e.message },
        "AI analysis failed — proceeding with raw data",
      );
    }
  }

  // 2. Create GitHub Issue
  const githubToken = process.env.GITHUB_TOKEN;
  let issueUrl = null;

  if (githubToken) {
    try {
      const owner = "adrianenc11-hue";
      const repo = "kelionai-v2";

      const severity = aiAnalysis?.severity || "medium";
      const severityEmoji =
        severity === "critical"
          ? "🔴"
          : severity === "high"
            ? "🟠"
            : severity === "medium"
              ? "🟡"
              : "🟢";

      const title = `${severityEmoji} Self-Heal: ${aiAnalysis?.rootCause || key} (${count}x)`;

      const body = `## 🤖 Self-Healing Watchdog Report

### Error Pattern
| Field | Value |
|-------|-------|
| **Source** | ${source} |
| **Pattern Key** | \`${key}\` |
| **Occurrences** | ${count}x |
| **Severity** | ${severityEmoji} ${severity} |
| **Detected** | ${new Date().toISOString()} |

### AI Root Cause Analysis
${
  aiAnalysis
    ? `- **Root Cause**: ${aiAnalysis.rootCause}
- **Suggested Fix**: ${aiAnalysis.suggestedFix}
- **File**: \`${aiAnalysis.file || "unknown"}\`
- **Auto-fixable**: ${aiAnalysis.canAutoFix ? "✅ Yes" : "❌ No — human review needed"}
- **Prevention**: ${aiAnalysis.preventionTip || "N/A"}`
    : "_AI analysis unavailable — review raw error data_"
}

### Raw Error Data
\`\`\`json
${JSON.stringify(pattern, null, 2)}
\`\`\`

---
_Auto-generated by KelionAI Self-Healing Watchdog 🐕_
_Threshold: ${ERROR_THRESHOLD}+ occurrences | Scan interval: ${SCAN_INTERVAL_MS / 1000}s_`;

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
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

      const ghData = await res.json();
      issueUrl = ghData.html_url || null;

      if (issueUrl) {
        _issuesCreatedThisHour++;
        logger.info(
          { component: "SelfHeal", issueUrl, severity },
          `✅ GitHub issue created: ${issueUrl}`,
        );
      } else {
        logger.warn(
          { component: "SelfHeal", ghResponse: JSON.stringify(ghData).substring(0, 200) },
          "GitHub issue creation returned no URL",
        );
      }
    } catch (e) {
      logger.error(
        { component: "SelfHeal", err: e.message },
        "GitHub issue creation failed",
      );
    }
  } else {
    logger.warn(
      { component: "SelfHeal" },
      "⚠️ No GITHUB_TOKEN — logging analysis only",
    );
  }

  // 3. Save to brain memory
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("brain_memory").insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        memory_type: "self_heal_action",
        content: `Self-heal triggered for ${key} (${count}x). ${aiAnalysis?.rootCause || "No AI analysis"}. Issue: ${issueUrl || "no GitHub token"}`,
        context: {
          pattern,
          aiAnalysis,
          issueUrl,
          timestamp: new Date().toISOString(),
        },
        importance: 9,
      });
    } catch {
      /* non-critical */
    }
  }

  // 4. Mark as processed (cooldown)
  _processedPatterns.set(key, {
    lastTriggered: Date.now(),
    issueUrl,
    analysis: aiAnalysis,
  });
}

/**
 * Check if a pattern is on cooldown
 */
function _isOnCooldown(key) {
  const entry = _processedPatterns.get(key);
  if (!entry) return false;
  return Date.now() - entry.lastTriggered < COOLDOWN_MS;
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
      issueUrl: val.issueUrl,
      cooldownRemaining: Math.max(
        0,
        Math.round((COOLDOWN_MS - (Date.now() - val.lastTriggered)) / 1000),
      ),
    });
  });

  return {
    running: !!_scanInterval,
    scanIntervalMs: SCAN_INTERVAL_MS,
    errorThreshold: ERROR_THRESHOLD,
    cooldownMs: COOLDOWN_MS,
    maxIssuesPerHour: MAX_ISSUES_PER_HOUR,
    issuesCreatedThisHour: _issuesCreatedThisHour,
    processedPatterns: processed,
    hasGithubToken: !!process.env.GITHUB_TOKEN,
  };
}

module.exports = { start, stop, scan, getStatus };
