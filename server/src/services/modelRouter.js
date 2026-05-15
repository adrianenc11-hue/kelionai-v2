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

// ── Rate-limit token bucket (Google AI Studio 30 RPM) ────────────
// Protects the free tier so bursts (e.g. 5 users chatting at once)
// don't trigger 429. Requests exceeding the bucket wait in a FIFO
// queue and are flushed every 2 s.
const BUCKET_MAX = parseInt(process.env.GOOGLE_RPM_LIMIT, 10) || 25; // leave 5 RPM headroom
const REFILL_MS = 60_000;
let bucketTokens = BUCKET_MAX;
let bucketLastRefill = Date.now();
const _modelQueue = [];
let _modelQueueRunning = false;

function _canTakeToken() {
  const now = Date.now();
  if (now - bucketLastRefill >= REFILL_MS) {
    bucketTokens = BUCKET_MAX;
    bucketLastRefill = now;
  }
  if (bucketTokens > 0) {
    bucketTokens--;
    return true;
  }
  return false;
}

async function _flushModelQueue() {
  if (_modelQueueRunning) return;
  _modelQueueRunning = true;
  while (_modelQueue.length > 0) {
    if (_canTakeToken()) {
      const { fn, resolve, reject } = _modelQueue.shift();
      try { resolve(await fn()); } catch (e) { reject(e); }
    } else {
      const now = Date.now();
      const wait = Math.max(2000, REFILL_MS - (now - bucketLastRefill));
      await new Promise(r => setTimeout(r, wait));
    }
  }
  _modelQueueRunning = false;
}

/**
 * Enqueue a model call behind the token bucket.
 * All smartFetch() calls for the Google AI Studio primary provider
 * go through here so we never exceed the RPM cap.
 */
function _queuedModelCall(fn) {
  return new Promise((resolve, reject) => {
    _modelQueue.push({ fn, resolve, reject });
    _flushModelQueue();
  });
}

// Google AI Studio endpoint (direct, no OpenRouter middleman)
const GOOGLE_AI_STUDIO = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// -- Multi-key rotation for Google AI Studio --
// Support comma-separated GOOGLE_API_KEYS env var. When one key hits 429,
// rotate to the next. This prevents a single exhausted free-tier project
// from taking down the whole app.
const GOOGLE_KEYS = (process.env.GOOGLE_API_KEYS || process.env.GOOGLE_API_KEY || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);
if (GOOGLE_KEYS.length === 0) {
  console.warn('[modelRouter] No GOOGLE_API_KEY or GOOGLE_API_KEYS set. Gemini calls will fail.');
}
let _currentKeyIndex = 0;

const MODELS = {
  // Adrian: Google AI Studio direct (free 30 RPM) is the PRIMARY
  // provider because OpenRouter free tier is exhausted (402/404).
  // Every default model is Gemini so getEndpoint() routes to AI Studio.
  // Override via env if you ever want to switch back.
  chat: process.env.MODEL_CHAT || 'gemini-2.5-flash',
  chat_heavy: process.env.MODEL_CHAT_HEAVY || 'gemini-2.5-pro',

  // Coding: Flash is fast and cheap, Pro is for heavy audits.
  coder: process.env.MODEL_CODER || 'gemini-2.5-flash',
  coder_heavy: process.env.MODEL_CODER_HEAVY || 'gemini-2.5-pro',

  // Vision: Gemini 2.5 Flash has strong multimodal support.
  vision: process.env.MODEL_VISION || 'gemini-2.5-flash',
  vision_heavy: process.env.MODEL_VISION_HEAVY || 'gemini-2.5-pro',

  // Tandem second-brain (Kimi K2.6) — runs in parallel with Opus 4.7 on heavy tasks.
  tandem_chat: process.env.MODEL_CHAT_TANDEM || 'moonshotai/kimi-k2.6',
  tandem_coder: process.env.MODEL_CODER_TANDEM || 'moonshotai/kimi-k2.6',
};

// Internal fallback — same provider (Google AI Studio), different model.
// Each model has separate quota, so switching from Pro to Flash often works
// when Pro is exhausted, *before* trying OpenRouter.
const GOOGLE_FALLBACK = {
  chat_heavy: ['gemini-2.5-flash', 'gemini-2.0-flash'],
  chat:       ['gemini-2.5-flash', 'gemini-2.0-flash'],
  coder_heavy:['gemini-2.5-flash', 'gemini-2.0-flash'],
  coder:      ['gemini-2.5-flash', 'gemini-2.0-flash'],
  vision_heavy:['gemini-2.5-flash'],
  vision:     ['gemini-2.5-flash'],
};

// Fallback chain — OpenRouter free tier (16 RPM combined).
// We keep 3–4 models so one rate-limit / outage doesn't exhaust the chain.
// Google AI Studio direct is tried *first* via getEndpoint() when GOOGLE_API_KEY is set.
const OPENROUTER_FALLBACK = {
  chat:        ['google/gemini-2.0-flash-001', 'anthropic/claude-3-haiku', 'meta-llama/llama-3.3-70b-instruct'],
  chat_heavy:  ['google/gemini-2.0-flash-001', 'anthropic/claude-3-5-sonnet-20241022', 'meta-llama/llama-3.3-70b-instruct'],
  coder:       ['google/gemini-2.0-flash-001', 'anthropic/claude-3-5-sonnet-20241022', 'meta-llama/llama-3.3-70b-instruct'],
  coder_heavy: ['google/gemini-2.0-flash-001', 'anthropic/claude-3-opus-20240229', 'meta-llama/llama-3.3-70b-instruct'],
  vision:      ['google/gemini-2.0-flash-001', 'anthropic/claude-3-5-sonnet-20241022'],
  vision_heavy:['google/gemini-2.0-flash-001', 'anthropic/claude-3-opus-20240229'],
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
function getEndpoint(model, keyIndex = 0) {
  const googleKey = GOOGLE_KEYS[keyIndex % Math.max(GOOGLE_KEYS.length, 1)];
  const isGeminiModel = model.includes('gemini-');

  if (googleKey && isGeminiModel && !process.env.USE_OPENROUTER_FOR_GEMINI) {
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
 * Auto-detect: is this a complex/heavy-reasoning task that warrants the premium model?
 * Catches non-coding requests that still benefit from a stronger brain: audits,
 * analysis, planning, strategy, multi-step reasoning, comparisons, deep explanations.
 */
function isComplexTask(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase();
  // Long prompts almost always need reasoning — trigger on length too.
  if (msg.length >= 600) return true;
  // Prefix match (no trailing \b) so e.g. "planific" matches both "planific" and "planifica".
  return /\b(audit|analiz|planific|strateg|complic|complex|dificil|profund|detaliat|compar|evalu|decid|gândeș|gindeste|reason|reflect|explic|justific|argumentez|sintetiz|rezum|optim|îmbunătăț|imbunata|review|critic|recomand)/i.test(m);
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
  // Google AI Studio calls go through the token bucket so we never
  // exceed the free-tier RPM cap under burst load.
  const isGoogleStudio = endpoint.provider === 'google-ai-studio';
  const makePrimaryCall = async () => {
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
      return response;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  // Try each Google key in rotation
  if (isGoogleStudio && GOOGLE_KEYS.length > 0) {
    for (let keyIdx = 0; keyIdx < GOOGLE_KEYS.length; keyIdx++) {
      const keyEndpoint = getEndpoint(model, keyIdx);
      const keyCall = async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        try {
          const response = await fetch(keyEndpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': keyEndpoint.authHeader,
              'HTTP-Referer': 'https://kelion.ai',
              'X-Title': 'Kelion AI',
            },
            body: JSON.stringify({ ...body, model: keyEndpoint.apiModel }),
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          return response;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      };

      try {
        const response = await _queuedModelCall(keyCall);
        if (response.ok) {
          _currentKeyIndex = keyIdx;
          return { response, model, provider: keyEndpoint.provider };
        }
        const errText = await response.text().catch(() => '');
        if (response.status === 429) {
          console.warn(`[modelRouter] Key ${keyIdx + 1}/${GOOGLE_KEYS.length} rate-limited, rotating...`);
          continue;
        }
        console.warn(`[modelRouter] ${model} key ${keyIdx + 1} failed: ${response.status} - ${errText}`);
      } catch (err) {
        console.warn(`[modelRouter] ${model} key ${keyIdx + 1} error: ${err.message}`);
      }
    }
  } else {
    try {
      const response = await makePrimaryCall();
      if (response.ok) {
        return { response, model, provider: endpoint.provider };
      }
      const errText = await response.text().catch(() => '');
      console.warn(`[modelRouter] ${model} via ${endpoint.provider} failed: ${response.status} - ${errText}`);
    } catch (err) {
      console.warn(`[modelRouter] ${model} via ${endpoint.provider} error: ${err.message}`);
    }
  }

  // Google AI Studio internal fallback: same provider, lighter model
  const chainKey = useHeavy ? `${taskType}_heavy` : taskType;
  const googleFallback = GOOGLE_FALLBACK[chainKey] || GOOGLE_FALLBACK[taskType];
  if (googleFallback && GOOGLE_KEYS.length > 0) {
    for (const fbModel of googleFallback) {
      for (let keyIdx = 0; keyIdx < GOOGLE_KEYS.length; keyIdx++) {
        const fbEndpoint = getEndpoint(fbModel, keyIdx);
        const fbCall = async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 45000);
          try {
            const response = await fetch(fbEndpoint.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': fbEndpoint.authHeader,
                'HTTP-Referer': 'https://kelion.ai',
                'X-Title': 'Kelion AI',
              },
              body: JSON.stringify({ ...body, model: fbEndpoint.apiModel }),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            return response;
          } catch (err) {
            clearTimeout(timer);
            throw err;
          }
        };
        try {
          const response = await _queuedModelCall(fbCall);
          if (response.ok) {
            _currentKeyIndex = keyIdx;
            console.log(`[modelRouter] Google fallback ${fbModel} succeeded!`);
            return { response, model: fbModel, provider: fbEndpoint.provider };
          }
          const errText = await response.text().catch(() => '');
          if (response.status === 429) continue;
          console.warn(`[modelRouter] Google fallback ${fbModel} key ${keyIdx + 1} failed: ${response.status} - ${errText}`);
        } catch (err) {
          console.warn(`[modelRouter] Google fallback ${fbModel} key ${keyIdx + 1} error: ${err.message}`);
        }
      }
    }
  }

  // Fallback to OpenRouter chain
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

/**
 * Tandem execution: primary (Opus 4.7 standard) + secondary (Kimi K2.6) in parallel.
 * Returns the primary response, but logs the secondary for comparison.
 * If the primary fails, falls back to the secondary.
 *
 * @param {'chat'|'coder'} taskType
 * @param {object} body
 * @returns {Promise<{response: Response, model: string, provider: string}>}
 */
async function runTandem(taskType, body) {
  const primaryModel = getModel(taskType, true, false); // Opus standard
  const secondaryModel = MODELS[`tandem_${taskType}`] || MODELS.tandem_chat || 'moonshotai/kimi-k2.6';

  const primaryPromise = smartFetch(taskType, body, true, false);
  const secondaryPromise = (async () => {
    const endpoint = getEndpoint(secondaryModel);
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
      return { response, model: secondaryModel, provider: endpoint.provider };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  })();

  const t0 = Date.now();
  let primary, secondary;
  try {
    [primary, secondary] = await Promise.allSettled([primaryPromise, secondaryPromise]);
  } catch (e) {
    console.error('[modelRouter] Tandem Promise.allSettled error:', e);
  }

  const duration = Date.now() - t0;
  const primaryOk = primary?.status === 'fulfilled' && primary.value?.response?.ok;
  const secondaryOk = secondary?.status === 'fulfilled' && secondary.value?.response?.ok;

  console.log(`[modelRouter] Tandem complete in ${duration}ms | primary=${primaryModel} ok=${primaryOk} | secondary=${secondaryModel} ok=${secondaryOk}`);

  if (primaryOk) {
    return primary.value;
  }
  if (secondaryOk) {
    console.log(`[modelRouter] Tandem fallback to secondary ${secondaryModel}`);
    return secondary.value;
  }

  if (primary?.status === 'rejected') {
    throw new Error(`Tandem primary failed: ${primary.reason?.message || primary.reason}`);
  }
  if (secondary?.status === 'rejected') {
    throw new Error(`Tandem secondary failed: ${secondary.reason?.message || secondary.reason}`);
  }
  throw new Error('Tandem both models returned non-OK responses');
}

module.exports = {
  MODELS,
  OPENROUTER_FALLBACK,
  getModel,
  getEndpoint,
  getFallbackChain,
  smartFetch,
  runTandem,
  isCodingTask,
  isComplexTask,
};
