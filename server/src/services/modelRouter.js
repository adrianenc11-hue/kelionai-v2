'use strict';

// ─────────────────────────────────────────────────────────────────
// Smart Model Router v2 — Dual-provider for rate-limit resilience.
//
// PRIMARY: Google AI Studio direct (30 RPM free, no OpenRouter)
// BACKUP:  OpenRouter free models (16 RPM combined limit)
//
// Why dual-provider: OpenRouter free tier is capped at 16 req/min
// for ALL free models combined. An agentic system with tool loops
// blows through that in seconds. Google AI Studio's free tier is
// much more generous (30 RPM for Flash, 1500 RPD).
// ─────────────────────────────────────────────────────────────────

// Google AI Studio endpoint (direct, no OpenRouter middleman)
const GOOGLE_AI_STUDIO = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const MODELS = {
  // Primary: Top-tier free Uncensored / Hacker models from OpenRouter 2026
  chat: process.env.MODEL_CHAT || 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  chat_heavy: process.env.MODEL_CHAT_HEAVY || 'nousresearch/hermes-3-llama-3.1-405b:free',

  // Coding specialist: Qwen Coder
  coder: process.env.MODEL_CODER || 'qwen/qwen3-coder:free',
  coder_heavy: process.env.MODEL_CODER_HEAVY || 'qwen/qwen3-coder:free',

  // Vision / Extraction
  vision: process.env.MODEL_VISION || 'minimax/minimax-m2.5:free',
  vision_heavy: process.env.MODEL_VISION_HEAVY || 'z-ai/glm-4.5-air:free',
};

// OpenRouter fallback models
const OPENROUTER_FALLBACK = {
  chat:   ['cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 'nousresearch/hermes-3-llama-3.1-405b:free'],
  chat_heavy: ['nousresearch/hermes-3-llama-3.1-405b:free', 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free'],
  coder:  ['qwen/qwen3-coder:free', 'nousresearch/hermes-3-llama-3.1-405b:free'],
  coder_heavy: ['nousresearch/hermes-3-llama-3.1-405b:free', 'qwen/qwen3-coder:free'],
  vision: ['minimax/minimax-m2.5:free'],
  vision_heavy: ['z-ai/glm-4.5-air:free'],
};

/**
 * Get the optimal model for a task type.
 * @param {'chat'|'coder'|'vision'} taskType
 * @param {boolean} useHeavy - Whether to use the premium/heavy model
 * @returns {string} Model ID
 */
function getModel(taskType, useHeavy = false) {
  const key = useHeavy ? `${taskType}_heavy` : taskType;
  return MODELS[key] || MODELS[taskType] || MODELS.chat;
}

/**
 * Get the API endpoint and auth for a model.
 * If GOOGLE_API_KEY is set and model is a Gemini model, use AI Studio directly.
 * Otherwise, use OpenRouter.
 *
 * @param {string} model - Model ID
 * @returns {{ url: string, authHeader: string, provider: string, apiModel: string }}
 */
function getEndpoint(model) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const isGeminiModel = model.includes('gemini-');

  if (googleKey && isGeminiModel) {
    // Google AI Studio natively expects 'gemini-X', strip 'google/' if present
    const bareModel = model.replace(/^google\//, '');
    return {
      url: GOOGLE_AI_STUDIO,
      authHeader: `Bearer ${googleKey}`,
      provider: 'google-ai-studio',
      apiModel: bareModel
    };
  }

  // Fall back to OpenRouter
  // OpenRouter requires the 'google/' prefix for Gemini models
  const openRouterModel = (!model.includes('/') && isGeminiModel) ? `google/${model}` : model;
  
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authHeader: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    provider: 'openrouter',
    apiModel: openRouterModel
  };
}

/**
 * Get fallback chain for rate-limit resilience.
 * @param {'chat'|'coder'|'vision'} taskType
 * @returns {string[]} OpenRouter model IDs to try
 */
function getFallbackChain(taskType) {
  return OPENROUTER_FALLBACK[taskType] || OPENROUTER_FALLBACK.chat;
}

/**
 * Auto-detect: is this message a coding task?
 */
function isCodingTask(msg) {
  if (!msg) return false;
  // Adrian: "trebuie sa detecteze orice task de software/cod". 
  // Added Romanian keywords: soft, program, aplicație, crea, dezvolt, proiect, sistem.
  return /\b(cod[e]?|script|funcți[ei]|debug|refactor|implement|api|endpoint|bug|error|class|component|python|javascript|typescript|react|node|sql|html|css|java|rust|algorithm|soft|program|aplicați|creează|dezvolt|proiect|arhitectur|sistem)\b/i.test(msg.toLowerCase());
}

/**
 * Make an API call with automatic provider selection + fallback.
 * 1. Try Google AI Studio (if GOOGLE_API_KEY set)
 * 2. If rate limited or error, try OpenRouter fallback chain
 *
 * @param {'chat'|'coder'|'vision'} taskType
 * @param {object} body - Request body (messages, tools, etc.)
 * @param {boolean} useHeavy - Whether to use the premium/heavy model
 * @returns {Promise<{response: Response, model: string, provider: string}>}
 */
async function smartFetch(taskType, body, useHeavy = false) {
  const model = getModel(taskType, useHeavy);
  const endpoint = getEndpoint(model);

  console.log(`[modelRouter] ${taskType} (heavy=${useHeavy}) → ${model} via ${endpoint.provider}`);

  // Try primary provider — 45s timeout (heavy tasks like audits need time)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': endpoint.authHeader,
        'HTTP-Referer': 'https://kelion.ai',
        'X-Title': 'Kelion AI',
      },
      body: JSON.stringify({ ...body, model: endpoint.apiModel }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return { response, model, provider: endpoint.provider };
    }

    const errText = await response.text().catch(() => '');
    console.warn(`[modelRouter] ${model} via ${endpoint.provider} failed: ${response.status} - ${errText}`);
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[modelRouter] ${model} via ${endpoint.provider} error: ${err.message}`);
  }

  // Fallback to OpenRouter chain
  const chainKey = useHeavy ? `${taskType}_heavy` : taskType;
  const chain = OPENROUTER_FALLBACK[chainKey] || OPENROUTER_FALLBACK[taskType] || OPENROUTER_FALLBACK.chat;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) throw new Error('No OPENROUTER_API_KEY for fallback');

  for (let i = 0; i < chain.length; i++) {
    const fbModel = chain[i];
    console.log(`[modelRouter] fallback ${i + 1}/${chain.length}: ${fbModel}`);

    const fCtrl = new AbortController();
    const fTimer = setTimeout(() => fCtrl.abort(), 12000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${orKey}`,
          'HTTP-Referer': 'https://kelion.ai',
          'X-Title': 'Kelion AI',
        },
        body: JSON.stringify({ ...body, model: fbModel }),
        signal: fCtrl.signal,
      });
      clearTimeout(fTimer);

      if (response.ok) {
        console.log(`[modelRouter] Fallback ${fbModel} succeeded!`);
        return { response, model: fbModel, provider: 'openrouter' };
      }
      const fErrText = await response.text().catch(() => '');
      console.warn(`[modelRouter] Fallback ${fbModel} failed: ${response.status} - ${fErrText}`);
    } catch (err) {
      clearTimeout(fTimer);
      console.warn(`[modelRouter] Fallback ${fbModel} error: ${err.message}`);
    }
  }

  throw new Error(`All models exhausted for ${taskType} (heavy=${useHeavy})`);
}

module.exports = {
  MODELS,
  OPENROUTER_FALLBACK,
  getModel,
  getEndpoint,
  getFallbackChain,
  smartFetch,
  isCodingTask,
};
