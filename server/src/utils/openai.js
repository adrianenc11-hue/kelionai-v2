'use strict';

/**
 * AI client registry. Gemini + OpenAI can both be configured; callers can
 * request either explicitly, or call getAI() for the preferred one (Gemini
 * when GEMINI_API_KEY is present, OpenAI otherwise). Both clients use the
 * same `openai` SDK — Gemini via its OpenAI-compat endpoint.
 *
 * Env (priority order for getAI):
 *   GEMINI_API_KEY    → prefer Gemini
 *   OPENAI_API_KEY    → fallback to OpenAI
 *   AI_API_KEY        → generic OpenAI alias
 */
let _geminiClient = null;
let _openaiClient = null;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const DEFAULT_GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_CHAT_MODEL,
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];
const DEFAULT_OPENAI_CHAT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getGeminiClient() {
  if (_geminiClient) return _geminiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const OpenAI = require('openai');
  _geminiClient = new OpenAI({ apiKey: key, baseURL: GEMINI_BASE_URL });
  return _geminiClient;
}

function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;
  const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!key) return null;
  const OpenAI = require('openai');
  _openaiClient = new OpenAI({ apiKey: key });
  return _openaiClient;
}

// Preferred client (Gemini > OpenAI). Kept for backward compatibility.
function getAI() {
  return getGeminiClient() || getOpenAIClient();
}

function getProvider() {
  if (getGeminiClient()) return 'gemini';
  if (getOpenAIClient()) return 'openai';
  return null;
}

function getDefaultChatModel() {
  const explicit = process.env.AI_MODEL;
  if (explicit) return explicit;
  return getProvider() === 'gemini' ? DEFAULT_GEMINI_CHAT_MODEL : DEFAULT_OPENAI_CHAT_MODEL;
}

// Ordered list of (client, provider, model) candidates to try in sequence.
// Callers iterate until one succeeds. Gemini preview models first (fastest),
// then stable Gemini, then OpenAI as a hard fallback when Gemini is down.
function getChatProviderChain() {
  const chain = [];
  const gem = getGeminiClient();
  if (gem) {
    const seen = new Set();
    for (const model of GEMINI_FALLBACK_MODELS) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      chain.push({ client: gem, provider: 'gemini', model });
    }
  }
  const oa = getOpenAIClient();
  if (oa) chain.push({ client: oa, provider: 'openai', model: DEFAULT_OPENAI_CHAT_MODEL });
  return chain;
}

function getOpenAI() { return getAI(); }

module.exports = {
  getAI,
  getOpenAI,
  getGeminiClient,
  getOpenAIClient,
  getProvider,
  getDefaultChatModel,
  getChatProviderChain,
};
