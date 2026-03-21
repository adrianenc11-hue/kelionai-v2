/**
 * KelionAI v3.4 — Ollama Provider (On-Device AI)
 *
 * Connects to local Ollama instance (localhost:11434) for:
 * - Offline AI inference
 * - Privacy-first conversations
 * - Cost reduction (zero API charges)
 * - Hybrid routing (local → cloud fallback)
 *
 * Supported operations:
 * - chat: Send prompt, get response (streaming optional)
 * - generate: Raw completion
 * - list: Available models
 * - pull: Download new model
 * - delete: Remove model
 * - status: Connection check
 */
'use strict';

const logger = require('../logger');

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '30000', 10);
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3';

// ── Connection state ──
let isAvailable = false;
let lastCheck = 0;
const CHECK_INTERVAL = 60 * 1000; // Re-check every 60s

/**
 * Check if Ollama is running
 */
async function checkStatus() {
  if (Date.now() - lastCheck < CHECK_INTERVAL && lastCheck > 0) {
    return isAvailable;
  }

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    isAvailable = res.ok;
    lastCheck = Date.now();

    if (isAvailable) {
      const data = await res.json();
      logger.info(
        {
          component: 'Ollama',
          models: (data.models || []).length,
          url: OLLAMA_BASE,
        },
        `🏠 Ollama connected: ${(data.models || []).length} models available`
      );
    }
  } catch {
    isAvailable = false;
    lastCheck = Date.now();
  }

  return isAvailable;
}

/**
 * Chat completion via Ollama
 * @param {string} prompt - User message
 * @param {Object} options - { model, systemPrompt, temperature, history }
 * @returns {{success: boolean, response?: string, model?: string, error?: string, local: boolean}}
 */
async function chat(prompt, options = {}) {
  const available = await checkStatus();
  if (!available) {
    return { success: false, error: 'Ollama not available', local: false };
  }

  const model = options.model || DEFAULT_MODEL;
  const messages = [];

  // System prompt
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }

  // History
  if (options.history && Array.isArray(options.history)) {
    for (const msg of options.history.slice(-10)) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }
  }

  // Current message
  messages.push({ role: 'user', content: prompt });

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 2048,
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const response = data.message?.content || '';

    logger.info(
      {
        component: 'Ollama',
        model,
        tokensEval: data.eval_count,
        durationMs: Math.round((data.total_duration || 0) / 1e6),
      },
      `🏠 Local AI response: ${model} (${data.eval_count || 0} tokens)`
    );

    return {
      success: true,
      response,
      model,
      local: true,
      provider: 'ollama',
      tokensUsed: data.eval_count || 0,
      durationMs: Math.round((data.total_duration || 0) / 1e6),
    };
  } catch (e) {
    logger.warn({ component: 'Ollama', model, err: e.message }, 'Local AI chat failed');
    return { success: false, error: e.message, local: true };
  }
}

/**
 * List available local models
 */
async function listModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    return {
      success: true,
      models: (data.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        sizeHuman: formatBytes(m.size),
        modified: m.modified_at,
        digest: m.digest?.substring(0, 12),
        family: m.details?.family || 'unknown',
        parameters: m.details?.parameter_size || 'unknown',
        quantization: m.details?.quantization_level || 'unknown',
      })),
    };
  } catch (e) {
    return { success: false, error: e.message, models: [] };
  }
}

/**
 * Pull (download) a model
 * @param {string} modelName - e.g. "llama3", "mistral", "phi3"
 */
async function pullModel(modelName) {
  try {
    logger.info({ component: 'Ollama', model: modelName }, `📥 Pulling model: ${modelName}`);

    const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: false }),
      signal: AbortSignal.timeout(600000), // 10 min timeout for downloads
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    logger.info({ component: 'Ollama', model: modelName, status: data.status }, `✅ Model pulled: ${modelName}`);

    return { success: true, status: data.status || 'success' };
  } catch (e) {
    logger.warn({ component: 'Ollama', model: modelName, err: e.message }, 'Model pull failed');
    return { success: false, error: e.message };
  }
}

/**
 * Delete a local model
 */
async function deleteModel(modelName) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    logger.info({ component: 'Ollama', model: modelName }, `🗑️ Model deleted: ${modelName}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get detailed model info
 */
async function showModel(modelName) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { success: true, ...(await res.json()) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Utility ──
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

// ── Check on module load ──
if (process.env.OLLAMA_ENABLED === 'true') {
  checkStatus().then((ok) => {
    if (!ok) {
      logger.info({ component: 'Ollama' }, '🏠 Ollama not detected — will use cloud providers');
    }
  });
}

module.exports = {
  chat,
  listModels,
  pullModel,
  deleteModel,
  showModel,
  checkStatus,
  get isAvailable() {
    return isAvailable;
  },
  get defaultModel() {
    return DEFAULT_MODEL;
  },
  OLLAMA_BASE,
};
