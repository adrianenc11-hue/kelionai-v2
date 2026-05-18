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
  // Adrian 2026-05-18: upgraded to Claude Opus 4.7 — the LATEST Claude model.
  // Owner requested the newest version ("modelul trebuie sa fie clode 4.6 daca
  // e ultimul sau ultimul"). Opus 4.7 is the current frontier (May 2026).
  // All routes go through OpenRouter with OPENROUTER_API_KEY.
  chat: process.env.MODEL_CHAT || 'anthropic/claude-opus-4.7',
  chat_heavy: process.env.MODEL_CHAT_HEAVY || 'anthropic/claude-opus-4.7',
  chat_heavy_fast: process.env.MODEL_CHAT_HEAVY_FAST || process.env.MODEL_CHAT_HEAVY || 'anthropic/claude-opus-4.7-fast',

  // Coding: Claude Opus 4.7 for all coding tasks.
  coder: process.env.MODEL_CODER || 'anthropic/claude-opus-4.7',
  coder_heavy: process.env.MODEL_CODER_HEAVY || 'anthropic/claude-opus-4.7',
  coder_heavy_fast: process.env.MODEL_CODER_HEAVY_FAST || process.env.MODEL_CODER_HEAVY || 'anthropic/claude-opus-4.7-fast',

  // Vision: Claude Opus 4.7 has strong multimodal support.
  vision: process.env.MODEL_VISION || 'anthropic/claude-opus-4.7',
  vision_heavy: process.env.MODEL_VISION_HEAVY || 'anthropic/claude-opus-4.7',

  // Tandem second-brain (Kimi K2.6) — runs in parallel on heavy tasks.
  tandem_chat: process.env.MODEL_CHAT_TANDEM || 'moonshotai/kimi-k2.6',
  tandem_coder: process.env.MODEL_CODER_TANDEM || 'moonshotai/kimi-k2.6',
};

// Internal fallback — Google AI Studio models tried when Claude is down.
const GOOGLE_FALLBACK = {
  chat_heavy: ['gemini-2.5-flash', 'gemini-2.0-flash'],
  chat:       ['gemini-2.5-flash', 'gemini-2.0-flash'],
  coder_heavy:['gemini-2.5-flash', 'gemini-2.0-flash'],
  coder:      ['gemini-2.5-flash', 'gemini-2.0-flash'],
  vision_heavy:['gemini-2.5-flash'],
  vision:     ['gemini-2.5-flash'],
};

// Fallback chain — OpenRouter models tried after Claude + Google AI Studio fail.
const OPENROUTER_FALLBACK = {
  chat:        ['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  chat_heavy:  ['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  coder:       ['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  coder_heavy: ['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
  vision:      ['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001'],
  vision_heavy:['anthropic/claude-3-5-sonnet-20241022', 'google/gemini-2.0-flash-001'],
};

/**
 * Get the optimal model for a task type.
 * @param {'chat'|'coder'|'vision'} taskType
 * @param {boolean} useHeavy - Whether to use the premium/heavy model
 * @returns {string} Model ID
 */
function getModel(taskType, useHeavy = false, fastMode = false) {
  if (fastMode && useHeavy) {
    const fastKey = `${taskType}_heavy_fast`;
    if (MODELS[fastKey]) return MODELS[fastKey];
  }
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
 * @param {boolean} fastMode - Whether to use the fast premium variant (6x cost, 3x speed)
 * @returns {Promise<{response: Response, model: string, provider: string}>}
 */
async function smartFetch(taskType, body, useHeavy = false, fastMode = false) {
  const model = getModel(taskType, useHeavy, fastMode);
  const endpoint = getEndpoint(model);

  console.log(`[modelRouter] ${taskType} (heavy=${useHeavy} fast=${fastMode}) → ${model} via ${endpoint.provider}`);

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

  throw new Error(`All models exhausted for ${taskType} (heavy=${useHeavy} fast=${fastMode})`);
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

// ──────────────────────────────────────────────────────────────────────────────
// AUTO-MODEL-UPDATE — checks OpenRouter for latest AI models every 6h.
// Adrian 2026-05-18: "kelion trebuie sa foloseasca scriptul de cautare a
// ultimilor updaturi la fiecare ai, permanent, si apelarea lor in aplicatie."
//
// On server start + every CHECK_INTERVAL_MS, queries the OpenRouter models API
// for the latest Claude Opus model. If a newer version is found, hot-swaps
// all MODELS entries and logs the upgrade. No restart needed.
// ──────────────────────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = Number(process.env.MODEL_CHECK_INTERVAL_MS) || 6 * 60 * 60 * 1000; // 6h
let _lastChecked = 0;
let _checkTimer = null;

/**
 * Run 3 real compatibility tests against a candidate model.
 * Returns { passed: true } only if ALL tests succeed.
 * Tests:
 *   1. Basic chat — model responds coherently to a simple prompt
 *   2. Tool calling — model can generate a valid tool_call
 *   3. Romanian language — model responds correctly in Romanian
 */
async function verifyModelCompatibility(modelId, apiKey, fetchImpl) {
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://kelionai.app',
    'X-Title': 'KelionAI-CompatCheck',
  };

  // Test 1: Basic chat response
  try {
    const r1 = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with exactly: COMPAT_OK' }],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: AbortSignal.timeout?.(20000),
    });
    if (!r1.ok) return { passed: false, reason: `Test1-BasicChat: HTTP ${r1.status}` };
    const d1 = await r1.json();
    const text1 = d1?.choices?.[0]?.message?.content || '';
    if (!text1.includes('COMPAT_OK')) {
      return { passed: false, reason: `Test1-BasicChat: unexpected response "${text1.slice(0, 50)}"` };
    }
    console.log(`[modelRouter] ✓ Test 1/3 passed: basic chat`);
  } catch (e) {
    return { passed: false, reason: `Test1-BasicChat: ${e?.message || e}` };
  }

  // Test 2: Tool calling support
  try {
    const r2 = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'What is 2+2? Use the calculate tool.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Evaluate a math expression',
            parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
          },
        }],
        tool_choice: 'required',
        max_tokens: 100,
        temperature: 0,
      }),
      signal: AbortSignal.timeout?.(20000),
    });
    if (!r2.ok) return { passed: false, reason: `Test2-ToolCall: HTTP ${r2.status}` };
    const d2 = await r2.json();
    const tc = d2?.choices?.[0]?.message?.tool_calls;
    if (!tc || !Array.isArray(tc) || tc.length === 0) {
      return { passed: false, reason: 'Test2-ToolCall: model did not generate tool_calls' };
    }
    if (tc[0]?.function?.name !== 'calculate') {
      return { passed: false, reason: `Test2-ToolCall: wrong tool "${tc[0]?.function?.name}"` };
    }
    console.log(`[modelRouter] ✓ Test 2/3 passed: tool calling`);
  } catch (e) {
    return { passed: false, reason: `Test2-ToolCall: ${e?.message || e}` };
  }

  // Test 3: Romanian language support
  try {
    const r3 = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Răspunde în română cu exact un cuvânt: care este capitala României?' }],
        max_tokens: 20,
        temperature: 0,
      }),
      signal: AbortSignal.timeout?.(20000),
    });
    if (!r3.ok) return { passed: false, reason: `Test3-Romanian: HTTP ${r3.status}` };
    const d3 = await r3.json();
    const text3 = (d3?.choices?.[0]?.message?.content || '').toLowerCase();
    if (!text3.includes('bucure')) {
      return { passed: false, reason: `Test3-Romanian: expected "București", got "${text3.slice(0, 50)}"` };
    }
    console.log(`[modelRouter] ✓ Test 3/3 passed: Romanian language`);
  } catch (e) {
    return { passed: false, reason: `Test3-Romanian: ${e?.message || e}` };
  }

  return { passed: true };
}


/**
 * Query OpenRouter for available models and find the latest Claude Opus.
 * Falls back to current model if the API is unreachable.
 */
async function checkLatestModels() {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) {
    console.warn('[modelRouter] No OPENROUTER_API_KEY — skipping model update check.');
    return null;
  }

  const fetchImpl = typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : (await import('node-fetch')).default;

  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${orKey}` },
      signal: AbortSignal.timeout?.(15000),
    });
    if (!res.ok) {
      console.warn(`[modelRouter] OpenRouter models API returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    const models = data?.data || [];

    // Find all Claude Opus models (not :free variants, not beta)
    const claudeOpus = models
      .filter(m => m.id && m.id.startsWith('anthropic/claude-opus'))
      .filter(m => !m.id.includes(':free') && !m.id.includes('beta'))
      .sort((a, b) => (b.id || '').localeCompare(a.id || '')); // latest first

    // Find all Claude Sonnet models as secondary option
    const claudeSonnet = models
      .filter(m => m.id && m.id.startsWith('anthropic/claude-sonnet'))
      .filter(m => !m.id.includes(':free') && !m.id.includes('beta'))
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''));

    // Find latest Gemini models for fallback awareness
    const gemini = models
      .filter(m => m.id && (m.id.startsWith('google/gemini') || m.id.startsWith('gemini')))
      .filter(m => !m.id.includes(':free'))
      .sort((a, b) => (b.id || '').localeCompare(a.id || ''));

    const report = {
      timestamp: new Date().toISOString(),
      latestClaudeOpus: claudeOpus[0]?.id || null,
      latestClaudeSonnet: claudeSonnet[0]?.id || null,
      latestGemini: gemini[0]?.id || null,
      totalModels: models.length,
    };

    console.log(`[modelRouter] 🔍 Model scan complete:`, JSON.stringify(report));

    // Auto-upgrade: if a newer Claude Opus is found, verify + hot-swap
    const bestOpus = claudeOpus[0];
    if (bestOpus && bestOpus.id) {
      // Exclude -fast variant from base comparison
      const baseId = bestOpus.id.replace(/-fast$/, '');
      const currentBase = MODELS.chat.replace(/-fast$/, '');

      if (baseId !== currentBase) {
        const oldModel = MODELS.chat;
        const fastVariant = models.find(m => m.id === `${baseId}-fast`);
        const fastId = fastVariant ? fastVariant.id : baseId;

        // ── COMPATIBILITY VERIFICATION (0% incompatibility) ──────────
        // Run 3 real test calls before switching. Abort if ANY fails.
        console.log(`[modelRouter] 🧪 Testing ${baseId} compatibility before upgrade...`);
        const compatible = await verifyModelCompatibility(baseId, orKey, fetchImpl);
        if (!compatible.passed) {
          console.warn(`[modelRouter] ❌ ${baseId} FAILED compatibility: ${compatible.reason}. Keeping ${oldModel}.`);
          return { upgraded: false, current: oldModel, blocked: baseId, reason: compatible.reason, report };
        }
        console.log(`[modelRouter] ✅ ${baseId} passed all 3 compatibility tests.`);

        // Hot-swap all model slots
        MODELS.chat = baseId;
        MODELS.chat_heavy = baseId;
        MODELS.chat_heavy_fast = fastId;
        MODELS.coder = baseId;
        MODELS.coder_heavy = baseId;
        MODELS.coder_heavy_fast = fastId;
        MODELS.vision = baseId;
        MODELS.vision_heavy = baseId;

        console.log(`[modelRouter] 🚀 AUTO-UPGRADE: ${oldModel} → ${baseId} (fast: ${fastId})`);
        return { upgraded: true, from: oldModel, to: baseId, fast: fastId, report };
      }
    }

    return { upgraded: false, current: MODELS.chat, report };
  } catch (err) {
    console.warn('[modelRouter] Model update check failed:', err?.message || err);
    return null;
  }
}

// NOTE: No self-starting timer here. The healthWatchdog.js (which already
// runs every 5 min) calls checkLatestModels() periodically. This avoids
// duplicate timers — Adrian: "nu tot adauga, cauta ce exista deja".

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
  checkLatestModels,
  verifyModelCompatibility,
};

