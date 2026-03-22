// ═══════════════════════════════════════════════════════════════
// KelionAI — SELF-HEAL ENGINE v1.0
// K1 scans its own brain for errors, reads source code,
// calls Gemini to analyze + generate fix, applies fix,
// verifies, commits and pushes (auto-deploy)
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MODELS } = require('./config/models');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HEAL_COOLDOWN = 10 * 60 * 1000; // max 1 auto-fix per 10 min
let lastHealTime = 0;
let healInProgress = false;

/**
 * Start the self-heal loop.
 * Every 60s, scans brain.toolErrors for > 0.
 * If found: reads error, reads source, calls Gemini, applies fix, verifies, deploys.
 */
function startSelfHealLoop(brain, supabaseAdmin) {
  setInterval(async () => {
    if (!brain || healInProgress) return;
    try {
      await scanAndHeal(brain, supabaseAdmin);
    } catch (e) {
      logger.warn({ component: 'SelfHeal', err: e.message }, 'Self-heal loop error');
    }
  }, 60000);
  logger.info({ component: 'SelfHeal' }, '🩺 Self-heal engine started (scan every 60s)');
}

async function scanAndHeal(brain, supabaseAdmin) {
  // 1. SCAN — find tools with errors > 0
  const errored = Object.entries(brain.toolErrors).filter(([, c]) => c > 0);
  if (errored.length === 0) return; // brain healthy, nothing to do

  // Check recent errors (last 5 min)
  const recentErrors = brain.errorLog.filter((e) => Date.now() - e.time < 300000);

  for (const [tool, count] of errored) {
    const toolRecent = recentErrors.filter((e) => e.tool === tool);

    if (toolRecent.length === 0) {
      // No recent errors — tool recovered on its own after code fix
      logger.info({ component: 'SelfHeal', tool, count }, `🩺 Tool '${tool}' recovered — clearing ${count} old errors`);
      brain.toolErrors[tool] = 0;
      continue;
    }

    // Tool STILL failing — attempt repair
    if (Date.now() - lastHealTime < HEAL_COOLDOWN) {
      logger.info({ component: 'SelfHeal', tool }, '⏳ Cooldown active, skipping repair');
      continue;
    }

    const lastError = toolRecent[toolRecent.length - 1];
    logger.warn(
      { component: 'SelfHeal', tool, count, lastError: lastError.msg },
      `🔴 Tool '${tool}' has ${count} active errors. Initiating auto-repair...`
    );

    healInProgress = true;
    lastHealTime = Date.now();

    try {
      await attemptRepair(brain, supabaseAdmin, tool, count, lastError);
    } catch (e) {
      logger.error({ component: 'SelfHeal', tool, err: e.message }, 'Auto-repair failed');
      logToMemory(supabaseAdmin, tool, 'repair_failed', e.message);
    } finally {
      healInProgress = false;
    }

    break; // One repair at a time
  }
}

async function attemptRepair(brain, supabaseAdmin, tool, errorCount, lastError) {
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!claudeKey && !groqKey) {
    logger.warn({ component: 'SelfHeal' }, 'No Claude or Groq API key — cannot auto-repair');
    return;
  }

  // STEP 1: IDENTIFY — Find the source code that generates this error
  logger.info({ component: 'SelfHeal', tool }, '📖 Step 1: Reading relevant source code...');

  const toolFileMap = {
    search_web: 'server/brain.js',
    search: 'server/brain.js',
    get_weather: 'server/brain.js',
    weather: 'server/brain.js',
    generate_image: 'server/brain.js',
    imagine: 'server/brain.js',
    play_radio: 'server/brain.js',
    play_video: 'server/brain.js',
    get_news: 'server/brain.js',
    open_website: 'server/brain.js',
    check_system_health: 'server/brain.js',
    recall_memory: 'server/brain.js',
    memory: 'server/brain.js',
    thinkV4: 'server/brain-v4.js',
    thinkV5: 'server/brain-v5.js',
    health_check: 'server/brain.js',
    send_email: 'server/brain-v4.js',
    browse_page: 'server/brain-v4.js',
    call_saved_tool: 'server/brain.js',
    discover_and_save_tool: 'server/brain.js',
  };

  const sourceFile = toolFileMap[tool] || 'server/brain-v4.js';
  const fullPath = path.join(PROJECT_ROOT, sourceFile);

  if (!fs.existsSync(fullPath)) {
    logger.warn({ component: 'SelfHeal', tool, file: sourceFile }, 'Source file not found');
    return;
  }

  // Read relevant section of source code (search for the tool name)
  const sourceContent = fs.readFileSync(fullPath, 'utf8');
  const lines = sourceContent.split('\n');

  // Find lines containing the tool name or error message
  const searchTerms = [tool, lastError.msg.substring(0, 50)];
  const relevantLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (searchTerms.some((t) => lines[i].toLowerCase().includes(t.toLowerCase()))) {
      // Get context: 10 lines before and 20 lines after
      const start = Math.max(0, i - 10);
      const end = Math.min(lines.length, i + 20);
      for (let j = start; j < end; j++) {
        relevantLines.push(`${j + 1}: ${lines[j]}`);
      }
      break;
    }
  }

  const codeSnippet =
    relevantLines.length > 0 ? relevantLines.join('\n') : `[Could not find '${tool}' in ${sourceFile}]`;

  // STEP 2: ANALYZE — Ask AI to diagnose and generate fix
  // Priority: Claude Sonnet 4 (best at code) → Groq Llama 4 Scout (fastest, free)
  const prompt = `You are KelionAI's self-healing engine. A tool has errors that need fixing.

TOOL: ${tool}
ERROR COUNT: ${errorCount}
LAST ERROR MESSAGE: ${lastError.msg}
SOURCE FILE: ${sourceFile}

RELEVANT CODE:
\`\`\`javascript
${codeSnippet}
\`\`\`

YOUR TASK:
1. Analyze the error root cause
2. Generate a MINIMAL, SAFE fix
3. The fix must prevent this error from happening again
4. The fix must NOT break existing functionality
5. Return ONLY a JSON response

RESPONSE FORMAT (strict JSON, no markdown):
{
  "diagnosis": "What causes this error",
  "fix": {
    "file": "${sourceFile}",
    "search": "EXACT lines to find (copy-paste from code above)",
    "replace": "Fixed version of those exact lines"
  },
  "verification": "How to verify the fix works",
  "confidence": 0.0-1.0
}

If you cannot safely fix this, return:
{"diagnosis": "...", "fix": null, "reason": "Why it cannot be auto-fixed", "confidence": 0}`;

  let rawText = '';
  let usedProvider = 'none';

  // ── Try Claude Sonnet 4 first (best code quality) ──
  if (claudeKey) {
    logger.info({ component: 'SelfHeal', tool }, '🧠 Step 2: Asking Claude Sonnet 4 to analyze...');
    try {
      const claudeModel = MODELS?.CLAUDE || 'claude-sonnet-4-20250514';
      const claudeR = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 2048,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (claudeR.ok) {
        const claudeData = await claudeR.json();
        rawText = claudeData.content?.[0]?.text || '';
        usedProvider = 'claude';
        logger.info({ component: 'SelfHeal', tool }, '✅ Claude responded');
      } else {
        logger.warn({ component: 'SelfHeal', status: claudeR.status }, 'Claude API failed, trying Groq...');
      }
    } catch (e) {
      logger.warn({ component: 'SelfHeal', err: e.message }, 'Claude timeout/error, trying Groq...');
    }
  }

  // ── Fallback: Groq Llama 4 Scout (fastest, free) ──
  if (!rawText && groqKey) {
    logger.info({ component: 'SelfHeal', tool }, '🧠 Step 2: Asking Groq (Llama 4 Scout) to analyze...');
    try {
      const groqModel = MODELS?.GROQ_PRIMARY || 'meta-llama/llama-4-scout-17b-16e-instruct';
      const groqR = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (groqR.ok) {
        const groqData = await groqR.json();
        rawText = groqData.choices?.[0]?.message?.content || '';
        usedProvider = 'groq';
        logger.info({ component: 'SelfHeal', tool }, '✅ Groq responded');
      } else {
        logger.error({ component: 'SelfHeal', status: groqR.status }, 'Groq API also failed');
      }
    } catch (e) {
      logger.error({ component: 'SelfHeal', err: e.message }, 'Groq timeout/error');
    }
  }

  if (!rawText) {
    logger.error({ component: 'SelfHeal', tool }, 'All AI providers failed — cannot auto-repair');
    return;
  }

  // Parse JSON from response
  let analysis;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    analysis = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger.warn({ component: 'SelfHeal', provider: usedProvider, raw: rawText.substring(0, 200) }, 'Cannot parse AI response');
    logToMemory(supabaseAdmin, tool, 'analysis_unparseable', rawText.substring(0, 500));
    return;
  }

  logger.info(
    { component: 'SelfHeal', tool, diagnosis: analysis.diagnosis, confidence: analysis.confidence },
    `📋 Diagnosis: ${analysis.diagnosis}`
  );

  // Log diagnosis to brain_memory
  logToMemory(
    supabaseAdmin,
    tool,
    'diagnosed',
    JSON.stringify({
      diagnosis: analysis.diagnosis,
      confidence: analysis.confidence,
      fix: analysis.fix ? 'proposed' : 'none',
    })
  );

  // STEP 3: REPAIR — Apply fix if confidence >= 0.7 and fix exists
  if (!analysis.fix || analysis.confidence < 0.7) {
    logger.warn(
      { component: 'SelfHeal', tool, confidence: analysis.confidence },
      `⚠️ Cannot auto-fix: ${analysis.reason || 'low confidence'}. Logged for admin review.`
    );
    logToMemory(supabaseAdmin, tool, 'needs_manual_fix', analysis.reason || analysis.diagnosis);
    return;
  }

  const fixFile = path.join(PROJECT_ROOT, analysis.fix.file);
  if (!fs.existsSync(fixFile)) {
    logger.warn({ component: 'SelfHeal', file: analysis.fix.file }, 'Fix target file not found');
    return;
  }

  // Safety: only allow fixes in server/ and app/ directories
  if (!analysis.fix.file.startsWith('server/') && !analysis.fix.file.startsWith('app/')) {
    logger.warn({ component: 'SelfHeal', file: analysis.fix.file }, 'Fix target outside allowed directories');
    return;
  }

  const currentContent = fs.readFileSync(fixFile, 'utf8');
  if (!currentContent.includes(analysis.fix.search)) {
    logger.warn({ component: 'SelfHeal', tool }, 'Search string not found in file — fix may be stale');
    logToMemory(supabaseAdmin, tool, 'fix_stale', 'Search string not found in current code');
    return;
  }

  logger.info({ component: 'SelfHeal', tool, file: analysis.fix.file }, '🔧 Step 3: Applying fix...');

  const fixedContent = currentContent.replace(analysis.fix.search, analysis.fix.replace);
  fs.writeFileSync(fixFile, fixedContent, 'utf8');

  // STEP 4: VERIFY — Check syntax
  logger.info({ component: 'SelfHeal', tool }, '✅ Step 4: Verifying fix...');

  try {
    execSync(`node -c "${fixFile}"`, { timeout: 10000, encoding: 'utf8' });
    logger.info({ component: 'SelfHeal', tool }, '✅ Syntax check passed');
  } catch (syntaxErr) {
    // ROLLBACK — syntax error
    logger.error({ component: 'SelfHeal', tool, err: syntaxErr.message }, '❌ Syntax check FAILED — rolling back');
    fs.writeFileSync(fixFile, currentContent, 'utf8');
    logToMemory(supabaseAdmin, tool, 'fix_rolled_back', 'Syntax error after fix: ' + syntaxErr.message);
    return;
  }

  // STEP 5: DEPLOY — git commit and push
  logger.info({ component: 'SelfHeal', tool }, '🚀 Step 5: Committing and deploying fix...');

  try {
    execSync(`git add "${analysis.fix.file}"`, { cwd: PROJECT_ROOT, timeout: 10000 });
    execSync(`git commit -m "🩺 self-heal: fix ${tool} — ${analysis.diagnosis.substring(0, 60)}"`, {
      cwd: PROJECT_ROOT,
      timeout: 10000,
    });
    execSync('git push', { cwd: PROJECT_ROOT, timeout: 30000 });
    logger.info({ component: 'SelfHeal', tool }, '🚀 Fix deployed! Railway will auto-rebuild.');

    logToMemory(
      supabaseAdmin,
      tool,
      'auto_fixed_deployed',
      JSON.stringify({
        diagnosis: analysis.diagnosis,
        file: analysis.fix.file,
        confidence: analysis.confidence,
        timestamp: new Date().toISOString(),
      })
    );

    // Clear the tool error since we just fixed it
    brain.toolErrors[tool] = 0;
  } catch (gitErr) {
    logger.error({ component: 'SelfHeal', tool, err: gitErr.message }, 'Git push failed — rolling back');
    fs.writeFileSync(fixFile, currentContent, 'utf8');
    try {
      execSync('git checkout -- .', { cwd: PROJECT_ROOT, timeout: 5000 });
    } catch (_) {}
    logToMemory(supabaseAdmin, tool, 'deploy_failed', gitErr.message);
  }
}

function logToMemory(supabaseAdmin, tool, action, details) {
  if (!supabaseAdmin) return;
  supabaseAdmin
    .from('brain_memory')
    .insert({
      user_id: 'system',
      memory_type: 'self_heal_log',
      content: `[SELF-HEAL] ${action}: ${tool} — ${typeof details === 'string' ? details.substring(0, 300) : JSON.stringify(details).substring(0, 300)}`,
      context: { tool, action, details, timestamp: new Date().toISOString() },
      importance: action === 'auto_fixed_deployed' ? 10 : 7,
    })
    .catch(() => {});
}

module.exports = { startSelfHealLoop };
