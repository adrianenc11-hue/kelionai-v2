// ═══════════════════════════════════════════════════════════════
// KelionAI — A/B Testing Framework for Prompt Variants
// Test different prompt strategies & track which performs better
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

// ── Active experiments storage ──
const experiments = new Map();
const userAssignments = new Map(); // userId → { experimentId → variant }
const variantMetrics = new Map(); // experimentId:variant → { ... }

/**
 * Create a new A/B experiment
 * @param {object} config
 * @param {string} config.id - Unique experiment ID
 * @param {string} config.name - Human-readable name
 * @param {string} config.description - What this tests
 * @param {string} config.target - What to modify: 'prompt_section', 'temperature', 'model', 'system_instruction'
 * @param {object} config.variants - { A: value, B: value, [C: value] }
 * @param {number} [config.trafficPercent=100] - % of users included
 * @param {string} [config.status='active'] - 'active' | 'paused' | 'completed'
 */
function createExperiment(config) {
  if (!config.id || !config.variants) {
    throw new Error("Experiment needs id and variants");
  }

  const experiment = {
    id: config.id,
    name: config.name || config.id,
    description: config.description || "",
    target: config.target || "prompt_section",
    variants: config.variants,
    variantNames: Object.keys(config.variants),
    trafficPercent: config.trafficPercent || 100,
    status: config.status || "active",
    createdAt: new Date().toISOString(),
    winner: null,
  };

  experiments.set(config.id, experiment);

  // Initialize metrics for each variant
  for (const v of experiment.variantNames) {
    const key = `${config.id}:${v}`;
    if (!variantMetrics.has(key)) {
      variantMetrics.set(key, {
        impressions: 0,
        thumbsUp: 0,
        thumbsDown: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
        corrections: 0,
        followUps: 0,
      });
    }
  }

  logger.info(
    { component: "ABTest", experiment: config.id },
    `🧪 Experiment created: ${config.name}`,
  );
  return experiment;
}

/**
 * Get the variant assigned to a user for an experiment
 * Uses consistent hashing so same user always gets same variant
 */
function getVariant(userId, experimentId) {
  const exp = experiments.get(experimentId);
  if (!exp || exp.status !== "active") return null;

  // Check traffic allocation
  const userHash = simpleHash(userId || "anonymous");
  if (userHash % 100 >= exp.trafficPercent) return null; // User not in experiment

  // Check if already assigned
  const userExps = userAssignments.get(userId) || {};
  if (userExps[experimentId]) return userExps[experimentId];

  // Assign variant based on hash (consistent)
  const variantIdx = userHash % exp.variantNames.length;
  const variant = exp.variantNames[variantIdx];

  // Store assignment
  userExps[experimentId] = variant;
  userAssignments.set(userId, userExps);

  logger.info(
    { component: "ABTest", experiment: experimentId, user: userId, variant },
    "User assigned to variant",
  );
  return variant;
}

/**
 * Apply active experiments to a prompt config
 * Returns modified config with experiment values applied
 */
function applyExperiments(userId, promptConfig) {
  const applied = [];

  for (const [id, exp] of experiments) {
    if (exp.status !== "active") continue;

    const variant = getVariant(userId, id);
    if (!variant) continue;

    const value = exp.variants[variant];
    applied.push({ experiment: id, variant, target: exp.target });

    // Track impression
    const metricKey = `${id}:${variant}`;
    const m = variantMetrics.get(metricKey);
    if (m) m.impressions++;

    // Apply based on target type
    switch (exp.target) {
      case "prompt_section":
        // value = { section: 'RULES', content: '...' }
        if (value.section) {
          promptConfig.overrides = promptConfig.overrides || {};
          promptConfig.overrides[value.section] = value.content;
        }
        break;
      case "temperature":
        promptConfig.temperature = value;
        break;
      case "model":
        promptConfig.model = value;
        break;
      case "system_instruction":
        promptConfig.systemInstructionAppend =
          (promptConfig.systemInstructionAppend || "") + "\n" + value;
        break;
      case "response_style":
        promptConfig.responseStyle = value;
        break;
    }
  }

  if (applied.length > 0) {
    promptConfig._abTests = applied;
  }

  return promptConfig;
}

/**
 * Record feedback for an experiment variant
 */
function recordFeedback(userId, type) {
  const userExps = userAssignments.get(userId) || {};
  for (const [expId, variant] of Object.entries(userExps)) {
    const key = `${expId}:${variant}`;
    const m = variantMetrics.get(key);
    if (!m) continue;

    switch (type) {
      case "thumbsUp":
        m.thumbsUp++;
        break;
      case "thumbsDown":
        m.thumbsDown++;
        break;
      case "correction":
        m.corrections++;
        break;
      case "followUp":
        m.followUps++;
        break;
    }
  }
}

/**
 * Record response time for metrics
 */
function recordResponseTime(userId, timeMs) {
  const userExps = userAssignments.get(userId) || {};
  for (const [expId, variant] of Object.entries(userExps)) {
    const key = `${expId}:${variant}`;
    const m = variantMetrics.get(key);
    if (!m) continue;
    m.totalResponseTime += timeMs;
    m.avgResponseTime =
      m.impressions > 0 ? m.totalResponseTime / m.impressions : 0;
  }
}

/**
 * Get full report for an experiment
 */
function getExperimentReport(experimentId) {
  const exp = experiments.get(experimentId);
  if (!exp) return null;

  const report = {
    ...exp,
    variants: {},
  };

  for (const v of exp.variantNames) {
    const key = `${experimentId}:${v}`;
    const m = variantMetrics.get(key) || {
      impressions: 0,
      thumbsUp: 0,
      thumbsDown: 0,
    };
    const total = m.thumbsUp + m.thumbsDown;
    report.variants[v] = {
      ...m,
      value: exp.variants[v],
      satisfactionRate:
        total > 0 ? ((m.thumbsUp / total) * 100).toFixed(1) + "%" : "N/A",
      correctionRate:
        m.impressions > 0
          ? ((m.corrections / m.impressions) * 100).toFixed(1) + "%"
          : "N/A",
    };
  }

  return report;
}

/**
 * Get all experiments
 */
function getAllExperiments() {
  const list = [];
  for (const [id] of experiments) {
    list.push(getExperimentReport(id));
  }
  return list;
}

/**
 * Declare a winner and complete the experiment
 */
function declareWinner(experimentId, winnerVariant) {
  const exp = experiments.get(experimentId);
  if (!exp) return null;
  exp.status = "completed";
  exp.winner = winnerVariant;
  exp.completedAt = new Date().toISOString();
  logger.info(
    { component: "ABTest", experiment: experimentId, winner: winnerVariant },
    `🏆 Winner declared: ${winnerVariant}`,
  );
  return exp;
}

/**
 * Delete an experiment
 */
function deleteExperiment(experimentId) {
  const exp = experiments.get(experimentId);
  if (!exp) return false;
  experiments.delete(experimentId);
  // Clean up metrics
  for (const v of exp.variantNames) {
    variantMetrics.delete(`${experimentId}:${v}`);
  }
  // Clean user assignments
  for (const [, exps] of userAssignments) {
    delete exps[experimentId];
  }
  return true;
}

/**
 * Simple hash function for consistent assignment
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

// ── Seed default experiments ──
createExperiment({
  id: "response_length",
  name: "Response Length Test",
  description: "Testing concise vs detailed responses",
  target: "system_instruction",
  variants: {
    concise:
      "CRITICAL: Keep ALL responses under 2 sentences. Be extremely brief.",
    detailed:
      "Provide thorough, comprehensive responses with examples when helpful.",
    balanced:
      "Be concise for simple questions, detailed for complex ones. Adapt naturally.",
  },
  trafficPercent: 50,
});

createExperiment({
  id: "tone_warmth",
  name: "Tone Warmth Test",
  description: "Testing warm vs professional tone",
  target: "system_instruction",
  variants: {
    warm: "Be extra warm, use emojis occasionally, be like a close friend.",
    professional:
      "Be professional and precise. No emojis. Direct and efficient.",
  },
  trafficPercent: 30,
});

module.exports = {
  createExperiment,
  getVariant,
  applyExperiments,
  recordFeedback,
  recordResponseTime,
  getExperimentReport,
  getAllExperiments,
  declareWinner,
  deleteExperiment,
};
