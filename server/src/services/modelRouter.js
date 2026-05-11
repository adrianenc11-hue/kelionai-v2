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
  // Primary: Nemotron 3 Super (fastest, most reliable on OpenRouter free)
  // Falls back to: Ring-2.6-1T → Qwen3 Coder
  chat: process.env.MODEL_CHAT || 'nvidia/nemotron-3-super-120b-a12b:free',

  // Coding specialist
  coder: process.env.MODEL_CODER || 'qwen/qwen3-coder:free',

  // Vision: camera frames, image analysis
  vision: process.env.MODEL_VISION || 'google/gemma-4-31b-it:free',
};

// OpenRouter fallback models (used when Google AI Studio is unavailable)
const OPENROUTER_FALLBACK = {
  chat:   ['nvidia/nemotron-3-super-120b-a12b:free', 'inclusionai/ring-2.6-1t:free', 'qwen/qwen3-coder:free'],
  coder:  ['qwen/qwen3-coder:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'inclusionai/ring-2.6-1t:free'],
  vision: ['google/gemma-4-31b-it:free', 'google/gemma-4-27b-it:free'],
};

/**
 * Get the optimal model for a task type.
 * @param {'chat'|'coder'|'vision'} taskType
 * @returns {string} Model ID
 */
function getModel(taskType) {
  return MODELS[taskType] || MODELS.chat;
}

/**
 * Get the API endpoint and auth for a model.
 * If GOOGLE_API_KEY is set and model is a Gemini model, use AI Studio directly.
 * Otherwise, use OpenRouter.
 *
 * @param {string} model - Model ID
 * @returns {{ url: string, authHeader: string, provider: string }}
 */
function getEndpoint(model) {
  const googleKey = process.env.GOOGLE_API_KEY;
  const isGeminiModel = model.startsWith('gemini');

  if (googleKey && isGeminiModel) {
    return {
      url: GOOGLE_AI_STUDIO,
      authHeader: `Bearer ${googleKey}`,
      provider: 'google-ai-studio',
    };
  }

  // Fall back to OpenRouter
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authHeader: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    provider: 'openrouter',
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
  return /\b(cod[e]?|script|funcți[ei]|debug|refactor|implement|api|endpoint|bug|error|class|component|python|javascript|typescript|react|node|sql|html|css|java|rust|algorithm)\b/i.test(msg.toLowerCase());
}

/**
 * Make an API call with automatic provider selection + fallback.
 * 1. Try Google AI Studio (if GOOGLE_API_KEY set)
 * 2. If rate limited or error, try OpenRouter fallback chain
 *
 * @param {'chat'|'coder'|'vision'} taskType
 * @param {object} body - Request body (messages, tools, etc.)
 * @returns {Promise<{response: Response, model: string, provider: string}>}
 */
async function smartFetch(taskType, body) {
  const model = getModel(taskType);
  const endpoint = getEndpoint(model);

  console.log(`[modelRouter] ${taskType} → ${model} via ${endpoint.provider}`);

  // Try primary provider
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': endpoint.authHeader,
        'HTTP-Referer': 'https://kelion.ai',
        'X-Title': 'Kelion AI',
      },
      body: JSON.stringify({ ...body, model }),
    });

    if (response.ok) {
      return { response, model, provider: endpoint.provider };
    }

    console.warn(`[modelRouter] ${model} via ${endpoint.provider} failed: ${response.status}`);
  } catch (err) {
    console.warn(`[modelRouter] ${model} via ${endpoint.provider} error: ${err.message}`);
  }

  // Fallback to OpenRouter chain
  const chain = getFallbackChain(taskType);
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) throw new Error('No OPENROUTER_API_KEY for fallback');

  for (let i = 0; i < chain.length; i++) {
    const fbModel = chain[i];

    // Wait before retry (1s, 2s, 3s)
    const waitMs = Math.min(1000 * (i + 1), 3000);
    console.log(`[modelRouter] Fallback ${i + 1}/${chain.length}: ${fbModel} (wait ${waitMs}ms)`);
    await new Promise(resolve => setTimeout(resolve, waitMs));

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
      });

      if (response.ok) {
        console.log(`[modelRouter] Fallback ${fbModel} succeeded!`);
        return { response, model: fbModel, provider: 'openrouter' };
      }
      console.warn(`[modelRouter] Fallback ${fbModel} failed: ${response.status}`);
    } catch (err) {
      console.warn(`[modelRouter] Fallback ${fbModel} error: ${err.message}`);
    }
  }

  throw new Error(`All models exhausted for ${taskType}`);
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
