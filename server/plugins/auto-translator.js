/**
 * Sample Plugin: Auto-Translator
 *
 * Automatically translates AI responses to the user's preferred language.
 * Demonstrates middleware-type plugin that hooks into brain response pipeline.
 */

// Plugin manifest (exported for auto-registration)
const manifest = {
  id: 'auto-translator',
  name: 'Auto Translator',
  version: '1.0.0',
  description: 'Detects user language and auto-translates AI responses. Supports RO, EN, ES, FR, DE, IT.',
  author: 'KelionAI',
  icon: '🌐',
  category: 'utility',
  type: 'middleware', // "middleware" | "command" | "widget"
  pricing: 'free',
  endpoints: [],
  config: {
    defaultLanguage: 'ro',
    supportedLanguages: ['ro', 'en', 'es', 'fr', 'de', 'it'],
  },
};

/**
 * Middleware hook — runs AFTER AI generates a response
 * @param {Object} ctx - { userMessage, aiResponse, userId, language }
 * @returns {Object} modified response or null to skip
 */
async function afterResponse(ctx) {
  const { aiResponse, language } = ctx;
  if (!language || language === 'auto') return null; // skip

  // If response is already in target language, skip
  // Simple heuristic: check for common language markers
  const langHints = {
    ro: /[ăîâșț]/i,
    es: /[ñ¿¡]/i,
    fr: /[éèêëàâæçœ]/i,
    de: /[äöüß]/i,
  };

  if (langHints[language] && langHints[language].test(aiResponse)) {
    return null; // already in target language
  }

  // Return instruction for brain to translate
  return {
    action: 'translate',
    targetLanguage: language,
    text: aiResponse,
  };
}

/**
 * Command hook — runs when user invokes /translate
 * @param {Object} ctx - { args, userId }
 * @returns {Object} command result
 */
async function onCommand(ctx) {
  const { args } = ctx;
  if (!args || args.length < 2) {
    return {
      response: 'Usage: /translate <language> <text>\nSupported: ro, en, es, fr, de, it',
    };
  }

  const targetLang = args[0].toLowerCase();
  const text = args.slice(1).join(' ');

  if (!manifest.config.supportedLanguages.includes(targetLang)) {
    return {
      response: `Unsupported language: ${targetLang}. Supported: ${manifest.config.supportedLanguages.join(', ')}`,
    };
  }

  return {
    action: 'translate',
    targetLanguage: targetLang,
    text,
  };
}

module.exports = { manifest, afterResponse, onCommand };
