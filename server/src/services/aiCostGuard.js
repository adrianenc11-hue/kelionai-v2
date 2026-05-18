'use strict';

// ── AI Daily Cost Guard ───────────────────────────────────────────────
// Simple in-memory daily budget tracker for AI API spend.
// Resets at midnight UTC. A server restart resets the counter — acceptable
// for a soft guard. Hard cap blocks Fast Mode; soft cap triggers warning.

const HARD_DAILY_USD = Number(process.env.AI_DAILY_BUDGET_USD) || 3;
const SOFT_DAILY_USD = HARD_DAILY_USD * 0.5;

let dailyCost = 0;
let lastReset = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function _resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastReset) {
    dailyCost = 0;
    lastReset = today;
    console.log(`[aiCostGuard] Daily budget reset. Hard=$${HARD_DAILY_USD} Soft=$${SOFT_DAILY_USD}`);
  }
}

/**
 * Record an API call cost based on model and token usage.
 * @param {string} model — model ID
 * @param {{prompt_tokens?:number, completion_tokens?:number}} usage
 * @returns {{cost:number, dailyCost:number, remaining:number}}
 */
function recordCost(model, usage = {}) {
  _resetIfNewDay();
  // Adrian 2026-05-18: synced with modelRouter.js — primary brain is Claude Opus 4.7.
  const rates = {
    'anthropic/claude-opus-4.7': { input: 5.0, output: 25.0 },
    'anthropic/claude-opus-4.7-fast': { input: 30.0, output: 150.0 },
    'anthropic/claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
    'anthropic/claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'moonshotai/kimi-k2.6': { input: 0.73, output: 3.49 },
    'meta-llama/llama-3.3-70b-instruct': { input: 0.2, output: 0.2 },
    'gemini-2.5-pro': { input: 0, output: 0 },
    'gemini-2.5-flash': { input: 0, output: 0 },
    'gemini-2.0-flash': { input: 0, output: 0 },
    'google/gemini-2.0-flash-001': { input: 0, output: 0 },
  };
  const rate = rates[model] || { input: 1.0, output: 3.0 };
  const cost = ((usage.prompt_tokens || 0) * rate.input + (usage.completion_tokens || 0) * rate.output) / 1_000_000;
  dailyCost += cost;
  const remaining = Math.max(0, HARD_DAILY_USD - dailyCost);
  if (dailyCost >= SOFT_DAILY_USD) {
    console.warn(`[aiCostGuard] SOFT CAP reached: $${dailyCost.toFixed(2)} / $${HARD_DAILY_USD} (model=${model})`);
  }
  return { cost, dailyCost, remaining };
}

/**
 * Check current budget status.
 * @returns {{ok:boolean, warning:boolean, blocked:boolean, dailyCost:number, remaining:number, hardCap:number}}
 */
function checkBudget() {
  _resetIfNewDay();
  const remaining = Math.max(0, HARD_DAILY_USD - dailyCost);
  const warning = dailyCost >= SOFT_DAILY_USD && dailyCost < HARD_DAILY_USD;
  const blocked = dailyCost >= HARD_DAILY_USD;
  return { ok: !blocked, warning, blocked, dailyCost, remaining, hardCap: HARD_DAILY_USD };
}

/**
 * Is Fast Mode currently allowed?
 * Blocked when soft cap is reached to preserve margin.
 */
function isFastAllowed() {
  const { ok, warning } = checkBudget();
  return ok && !warning;
}

module.exports = { recordCost, checkBudget, isFastAllowed };
