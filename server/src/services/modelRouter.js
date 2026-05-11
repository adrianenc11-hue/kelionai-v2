'use strict';

// ─────────────────────────────────────────────────────────────────
// Smart Model Router — TOP 3 free models only.
//
// Each model is the undisputed #1 at its job. Zero cost.
//
// ┌──────────────────────┬──────────────────────────────────────────┐
// │ Task                 │ Model                                    │
// ├──────────────────────┼──────────────────────────────────────────┤
// │ Chat + Tools + Voice │ Ring-2.6-1T  (63B active, #1 agentic)   │
// │ Coding               │ Qwen3 Coder  (35B active, #1 coding)    │
// │ Vision / Camera      │ Gemma 4 31B  (only free with vision)    │
// └──────────────────────┴──────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────

const MODELS = {
  // #1 — Main brain: chat, tools, reasoning, voice pipeline
  // 1T params, 63B active, 262K context, 66K output, adaptive thinking
  chat: process.env.MODEL_CHAT || 'inclusionai/ring-2.6-1t:free',

  // #2 — Coding specialist: ask_expert_coder, thinking_mode, deep_search code
  // 480B params, 35B active, 262K context, SWE-bench top performer
  coder: process.env.MODEL_CODER || 'qwen/qwen3-coder:free',

  // #3 — Vision: camera frames, image analysis
  // 31B dense, native multimodal, structured output
  vision: process.env.MODEL_VISION || 'google/gemma-4-31b-it:free',
};

// Fallback: if primary model is rate-limited, try the next best
const FALLBACK = {
  chat:   ['inclusionai/ring-2.6-1t:free', 'qwen/qwen3-coder:free'],
  coder:  ['qwen/qwen3-coder:free', 'inclusionai/ring-2.6-1t:free'],
  vision: ['google/gemma-4-31b-it:free', 'google/gemma-4-27b-it:free'],
};

/**
 * Get the optimal model for a task type.
 * @param {'chat'|'coder'|'vision'} taskType
 * @returns {string} OpenRouter model ID
 */
function getModel(taskType) {
  return MODELS[taskType] || MODELS.chat;
}

/**
 * Get fallback chain for rate-limit resilience.
 * @param {'chat'|'coder'|'vision'} taskType
 * @returns {string[]}
 */
function getFallbackChain(taskType) {
  return FALLBACK[taskType] || FALLBACK.chat;
}

/**
 * Auto-detect: is this message a coding task?
 * Used by ask_expert_coder and thinking_mode to pick coder model.
 */
function isCodingTask(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return /\b(cod[e]?|script|funcți[ei]|debug|refactor|implement|api|endpoint|bug|error|class|component|python|javascript|typescript|react|node|sql|html|css|java|rust|algorithm)\b/i.test(m);
}

/**
 * Fetch with automatic fallback through the chain.
 * On 429/5xx, retries with next model in chain.
 *
 * @param {string} taskType - 'chat', 'coder', or 'vision'
 * @param {function(model: string): Promise<Response>} fetchFn - function that takes model ID and returns fetch promise
 * @returns {Promise<{response: Response, model: string}>}
 */
async function fetchWithFallback(taskType, fetchFn) {
  const chain = getFallbackChain(taskType);
  const errors = [];

  for (const model of chain) {
    try {
      const response = await fetchFn(model);
      if (response.ok) {
        return { response, model };
      }
      if (response.status === 429 || response.status >= 500) {
        errors.push(`${model}: HTTP ${response.status}`);
        console.warn(`[modelRouter] ${model} returned ${response.status}, trying next...`);
        continue;
      }
      // 4xx (not 429) — model-specific error, return as-is
      return { response, model };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      console.warn(`[modelRouter] ${model} failed: ${err.message}, trying next...`);
    }
  }

  throw new Error(`All models failed: ${errors.join(' | ')}`);
}

module.exports = {
  MODELS,
  FALLBACK,
  getModel,
  getFallbackChain,
  fetchWithFallback,
  isCodingTask,
};
