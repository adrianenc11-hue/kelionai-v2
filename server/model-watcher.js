'use strict';

/**
 * AI Model Watcher — checks current AI model versions vs latest available
 * Runs weekly check and provides admin notification badges
 */

const logger = require('pino')({ name: 'model-watcher' });

// Current models we use
const { MODELS } = require('./config/models');
const CURRENT_MODELS = {
  gemini: {
    name: 'Gemini',
    version: MODELS.GEMINI_CHAT,
    provider: 'Google',
    apiKeyEnv: 'GOOGLE_AI_KEY',
  },
  openai: {
    name: 'GPT',
    version: MODELS.OPENAI_CHAT,
    provider: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  groq: {
    name: 'Groq',
    version: MODELS.GROQ_PRIMARY,
    provider: 'Groq',
    apiKeyEnv: 'GROQ_API_KEY',
  },
};

// Known latest stable versions (updated manually or via check)
const latestVersions = {
  gemini: {
    version: 'gemini-3.1-flash',
    released: '2026-03',
    status: 'stable',
  },
  openai: { version: 'gpt-5.4', released: '2026-03', status: 'stable' },
  groq: {
    version: 'llama-3.3-70b-versatile',
    released: '2026-02',
    status: 'stable',
  },
};

let lastCheck = null;

/**
 * Check model status: 🟢 La zi / 🟡 Update disponibil / 🔴 Depreciat
 */
function getModelStatus() {
  const models = Object.entries(CURRENT_MODELS).map(([key, model]) => {
    const latest = latestVersions[key];
    const hasKey = !!process.env[model.apiKeyEnv];

    let status = 'unknown';
    let badge = '⚪';
    let message = 'Not configured';

    if (!hasKey) {
      status = 'not_configured';
      badge = '⚫';
      message = `No ${model.apiKeyEnv} set`;
    } else if (model.version === latest?.version) {
      status = 'up_to_date';
      badge = '🟢';
      message = 'La zi';
    } else if (latest?.version) {
      // Check if our version is older
      status = 'update_available';
      badge = '🟡';
      message = `Update: ${latest.version} (${latest.released})`;
    }

    return {
      key,
      name: model.name,
      provider: model.provider,
      currentVersion: model.version,
      latestVersion: latest?.version || 'unknown',
      hasApiKey: hasKey,
      status,
      badge,
      message,
    };
  });

  const overallBadge = models.some((m) => m.status === 'update_available')
    ? '🟡'
    : models.every((m) => m.status === 'up_to_date' || m.status === 'not_configured')
      ? '🟢'
      : '🔴';

  return {
    models,
    overallBadge,
    overallStatus: overallBadge === '🟢' ? 'All up to date' : 'Updates available',
    lastCheck: lastCheck || 'Never',
    nextCheck: 'Weekly (automatic)',
  };
}

/**
 * Try to check for updates (best effort, no external API needed)
 */
async function checkForUpdates() {
  lastCheck = new Date().toISOString();

  // Check Gemini model by trying a simple call
  try {
    const key = process.env.GOOGLE_AI_KEY;
    if (key) {
      // Try to list available models
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json();
        const models = (data.models || [])
          .filter((m) => m.name.includes('gemini'))
          .map((m) => m.name.replace('models/', ''));

        // Find latest flash and pro
        const latestPro =
          models.find((m) => m.includes('gemini-3.1-pro')) || models.find((m) => m.includes('gemini-3.0-pro'));
        const latestFlash =
          models.find((m) => m.includes('gemini-3.1-flash')) || models.find((m) => m.includes('gemini-3.0-flash'));

        if (latestPro) {
          latestVersions.gemini = {
            version: latestPro,
            released: new Date().toISOString().slice(0, 7),
            status: 'stable',
          };
        }

        logger.info({ availableModels: models.length, latestPro, latestFlash }, '[ModelWatcher] Gemini models checked');
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, '[ModelWatcher] Gemini check failed');
  }

  logger.info({ lastCheck }, '[ModelWatcher] Model version check complete');
  return getModelStatus();
}

// Weekly check (every 7 days)
setInterval(
  () => {
    checkForUpdates().catch(() => {});
  },
  7 * 24 * 60 * 60 * 1000
);

// First check 30s after boot
setTimeout(() => {
  checkForUpdates().catch(() => {});
}, 30000);

module.exports = {
  getModelStatus,
  checkForUpdates,
  CURRENT_MODELS,
};
