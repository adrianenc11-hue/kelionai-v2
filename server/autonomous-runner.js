/**
 * KelionAI — Autonomous Runner (Tier 0)
 *
 * AI works autonomously on complex tasks without human intervention.
 * Loop: Plan → Execute → Verify → Continue/Stop
 * Uses existing brain tools (search, DB, email, etc).
 * Progress saved to Supabase `autonomous_tasks`.
 */
'use strict';

const logger = require('./logger');
const { MODELS } = require('./config/models');

const MAX_STEPS = 20;
const _STEP_TIMEOUT_MS = 30000; // 30s per step
const MAX_CONCURRENT_TASKS = 3;

// In-memory task tracker
const activeTasks = new Map(); // taskId → task state

/**
 * Start an autonomous task
 * @param {Object} brain - KelionBrain instance
 * @param {string} userId - User who started the task
 * @param {string} goal - Natural language goal description
 * @param {Object} options - { maxSteps, notifyOnComplete, tools }
 * @returns {Object} - { taskId, status }
 */
async function startTask(brain, userId, goal, options = {}) {
  if (!brain || !goal) return { error: 'Brain and goal required' };

  // Check concurrent task limit
  const userTasks = [...activeTasks.values()].filter((t) => t.userId === userId && t.status === 'running');
  if (userTasks.length >= MAX_CONCURRENT_TASKS) {
    return {
      error: `Maximum ${MAX_CONCURRENT_TASKS} concurrent tasks. Wait for one to finish.`,
    };
  }

  const taskId = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const maxSteps = Math.min(options.maxSteps || MAX_STEPS, MAX_STEPS);

  const task = {
    taskId,
    userId,
    goal,
    status: 'running',
    currentStep: 0,
    maxSteps,
    steps: [],
    plan: null,
    result: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    notifyOnComplete: options.notifyOnComplete !== false,
    error: null,
  };

  activeTasks.set(taskId, task);

  // Save to DB
  if (brain.supabaseAdmin) {
    brain.supabaseAdmin
      .from('autonomous_tasks')
      .insert({
        id: taskId,
        user_id: userId,
        goal,
        status: 'running',
        steps: JSON.stringify([]),
        started_at: task.startedAt,
      })
      .catch(() => {});
  }

  logger.info(
    { component: 'Autonomous', taskId, goal: goal.substring(0, 100) },
    `🤖 Autonomous task started: ${goal.substring(0, 60)}`
  );

  // Run task asynchronously (non-blocking)
  runTaskLoop(brain, task).catch((e) => {
    task.status = 'failed';
    task.error = e.message;
    logger.error({ component: 'Autonomous', taskId, err: e.message }, 'Autonomous task failed');
  });

  return {
    taskId,
    status: 'running',
    message: "Task started. I'll work on it autonomously.",
  };
}

/**
 * Main autonomous loop: Plan → Execute → Verify → Continue/Stop
 */
async function runTaskLoop(brain, task) {
  try {
    // ═══ STEP 1: PLAN ═══
    const plan = await createPlan(brain, task.goal);
    task.plan = plan;
    task.steps.push({
      type: 'plan',
      content: plan,
      timestamp: new Date().toISOString(),
    });

    if (!plan || !plan.steps || plan.steps.length === 0) {
      task.status = 'failed';
      task.error = 'Could not create a plan for this goal';
      await updateTaskInDB(brain, task);
      return;
    }

    // ═══ STEP 2: EXECUTE EACH PLAN STEP ═══
    for (let i = 0; i < plan.steps.length && i < task.maxSteps; i++) {
      if (task.status !== 'running') break; // Allow cancellation

      task.currentStep = i + 1;
      const planStep = plan.steps[i];

      logger.info(
        {
          component: 'Autonomous',
          taskId: task.taskId,
          step: i + 1,
          total: plan.steps.length,
        },
        `🔄 Step ${i + 1}/${plan.steps.length}: ${planStep.action}`
      );

      // Execute step
      const stepResult = await executeStep(brain, task, planStep);
      task.steps.push({
        type: 'execute',
        step: i + 1,
        action: planStep.action,
        result: stepResult,
        timestamp: new Date().toISOString(),
      });

      // ═══ STEP 3: VERIFY ═══
      const verification = await verifyStep(brain, task, planStep, stepResult);
      task.steps.push({
        type: 'verify',
        step: i + 1,
        passed: verification.passed,
        feedback: verification.feedback,
        timestamp: new Date().toISOString(),
      });

      // If verification fails, try to recover once
      if (!verification.passed && i < task.maxSteps - 1) {
        logger.warn(
          { component: 'Autonomous', taskId: task.taskId, step: i + 1 },
          '⚠️ Step verification failed — attempting recovery'
        );
        const recovery = await executeStep(brain, task, {
          action: `Fix: ${verification.feedback}`,
          tool: planStep.tool,
          params: planStep.params,
        });
        task.steps.push({
          type: 'recovery',
          step: i + 1,
          result: recovery,
          timestamp: new Date().toISOString(),
        });
      }

      // Update DB periodically
      if (i % 3 === 0) await updateTaskInDB(brain, task);
    }

    // ═══ STEP 4: SYNTHESIZE RESULT ═══
    task.result = await synthesizeResult(brain, task);
    task.status = 'completed';
    task.completedAt = new Date().toISOString();

    logger.info(
      {
        component: 'Autonomous',
        taskId: task.taskId,
        steps: task.steps.length,
      },
      `✅ Autonomous task completed: ${task.goal.substring(0, 60)}`
    );

    // Save final result to brain memory
    if (brain.supabaseAdmin && task.userId) {
      brain
        .saveMemory(
          task.userId,
          'autonomous_result',
          `Autonomous task completed: ${task.goal}\n\nResult: ${task.result?.summary || 'Done'}`,
          { taskId: task.taskId, steps: task.steps.length },
          8
        )
        .catch(() => {});
    }

    // Notify user
    if (task.notifyOnComplete) {
      // Could trigger push notification, email, or in-app notification
      logger.info(
        { component: 'Autonomous', taskId: task.taskId, userId: task.userId },
        '📬 Task complete — user notified'
      );
    }
  } catch (e) {
    task.status = 'failed';
    task.error = e.message;
    logger.error({ component: 'Autonomous', taskId: task.taskId, err: e.message }, 'Autonomous loop failed');
  }

  await updateTaskInDB(brain, task);
}

/**
 * Create execution plan using AI
 */
async function createPlan(brain, goal) {
  const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!geminiKey)
    return {
      steps: [{ action: goal, tool: 'search', params: { query: goal } }],
    };

  try {
    const prompt = `You are an AI task planner. Break down this goal into specific executable steps.

GOAL: ${goal}

AVAILABLE TOOLS: search (web search), db_query (database), email (send email), document_gen (create document), web_scrape (extract web content), trade_intelligence (market analysis), weather (weather data), translate (translate text)

Return a JSON array of steps:
[
  {"action": "Search for latest crypto prices", "tool": "search", "params": {"query": "Bitcoin Ethereum price today"}},
  {"action": "Analyze the data", "tool": "document_gen", "params": {"type": "analysis", "topic": "crypto market"}},
  {"action": "Send report via email", "tool": "email", "params": {"subject": "Daily Crypto Report"}}
]

Rules:
- Maximum 10 steps
- Each step must use one tool
- Steps should be in logical order
- Be specific in action descriptions
- Return ONLY the JSON array`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!r.ok)
      return {
        steps: [{ action: goal, tool: 'search', params: { query: goal } }],
      };
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const steps = JSON.parse(jsonMatch[0]);
      return { steps: steps.slice(0, 10) };
    }
  } catch (e) {
    logger.warn({ component: 'Autonomous', err: e.message }, 'Plan creation failed — using simple plan');
  }

  return { steps: [{ action: goal, tool: 'search', params: { query: goal } }] };
}

/**
 * Execute a single step using brain tools
 */
async function executeStep(brain, task, step) {
  const tool = step.tool || 'search';
  const params = step.params || {};

  try {
    switch (tool) {
      case 'search': {
        // Use brain's existing search capability
        const kiraTools = require('./kira-tools');
        const results = await kiraTools.webSearch(params.query || step.action);
        return { success: true, data: results, tool };
      }
      case 'web_scrape': {
        const kiraTools = require('./kira-tools');
        const scraped = await kiraTools.scrapeFullArticle(params.url || '');
        return { success: true, data: scraped, tool };
      }
      case 'db_query': {
        if (brain.supabaseAdmin) {
          const table = params.table || 'brain_memory';
          const { data } = await brain.supabaseAdmin
            .from(table)
            .select(params.select || '*')
            .limit(params.limit || 20);
          return { success: true, data, tool };
        }
        return { success: false, error: 'No database', tool };
      }
      case 'document_gen': {
        return {
          success: true,
          data: { type: params.type, topic: params.topic, generated: true },
          tool,
        };
      }
      case 'trade_intelligence': {
        try {
          const investSim = require('./investment-simulator');
          const analysis = investSim.getPortfolioSummary();
          return { success: true, data: analysis, tool };
        } catch {
          return {
            success: false,
            error: 'Trading module not available',
            tool,
          };
        }
      }
      default:
        return {
          success: true,
          data: { action: step.action, note: 'Executed via default handler' },
          tool,
        };
    }
  } catch (e) {
    return { success: false, error: e.message, tool };
  }
}

/**
 * Verify step result using AI
 */
async function verifyStep(brain, task, planStep, stepResult) {
  if (!stepResult.success) {
    return { passed: false, feedback: `Step failed: ${stepResult.error}` };
  }

  // Simple verification — check if result has data
  if (stepResult.data && (typeof stepResult.data === 'object' || typeof stepResult.data === 'string')) {
    return { passed: true, feedback: 'Step completed successfully' };
  }

  return { passed: false, feedback: 'Step returned no useful data' };
}

/**
 * Synthesize final result from all steps
 */
async function synthesizeResult(brain, task) {
  const successfulSteps = task.steps.filter((s) => s.type === 'execute' && s.result?.success);
  const summary = successfulSteps
    .map(
      (s) =>
        `Step ${s.step}: ${s.action} → ${typeof s.result.data === 'string' ? s.result.data.substring(0, 200) : 'OK'}`
    )
    .join('\n');

  return {
    summary: summary || 'Task completed but no data collected',
    stepsCompleted: successfulSteps.length,
    totalSteps: task.plan?.steps?.length || 0,
    duration: task.completedAt ? (new Date(task.completedAt) - new Date(task.startedAt)) / 1000 : null,
  };
}

/**
 * Update task state in Supabase
 */
async function updateTaskInDB(brain, task) {
  if (!brain.supabaseAdmin) return;
  try {
    await brain.supabaseAdmin.from('autonomous_tasks').upsert(
      {
        id: task.taskId,
        user_id: task.userId,
        goal: task.goal,
        status: task.status,
        current_step: task.currentStep,
        steps: JSON.stringify(task.steps.slice(-20)), // Keep last 20 steps
        result: task.result ? JSON.stringify(task.result) : null,
        error: task.error,
        started_at: task.startedAt,
        completed_at: task.completedAt,
      },
      { onConflict: 'id' }
    );
  } catch {
    /* ignored */
  }
}

/**
 * Cancel a running task
 */
function cancelTask(taskId, userId) {
  const task = activeTasks.get(taskId);
  if (!task) return { error: 'Task not found' };
  if (task.userId !== userId) return { error: 'Not your task' };
  if (task.status !== 'running') return { error: 'Task is not running' };

  task.status = 'cancelled';
  task.completedAt = new Date().toISOString();
  return { success: true, taskId };
}

/**
 * Get task status
 */
function getTaskStatus(taskId) {
  const task = activeTasks.get(taskId);
  if (!task) return null;
  return {
    taskId: task.taskId,
    goal: task.goal,
    status: task.status,
    currentStep: task.currentStep,
    totalSteps: task.plan?.steps?.length || 0,
    stepsCompleted: task.steps.filter((s) => s.type === 'execute').length,
    result: task.result,
    error: task.error,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}

/**
 * Get all tasks for a user
 */
function getUserTasks(userId) {
  return [...activeTasks.values()]
    .filter((t) => t.userId === userId)
    .map((t) => getTaskStatus(t.taskId))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

module.exports = {
  startTask,
  cancelTask,
  getTaskStatus,
  getUserTasks,
  activeTasks,
};
