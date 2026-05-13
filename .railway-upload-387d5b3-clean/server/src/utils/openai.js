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

const config = require('../config');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

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
  return getProvider() === 'gemini' ? config.gemini.chatModel : config.openai.model;
}

// Ordered list of (client, provider, model) candidates to try in sequence.
// Callers iterate until one succeeds. Gemini primary + fallbacks first
// (ordered by GEMINI_CHAT_MODEL + GEMINI_CHAT_FALLBACKS), then OpenAI as a
// hard fallback when Gemini is down.
function getChatProviderChain() {
  const chain = [];
  const gem = getGeminiClient();
  if (gem) {
    const seen = new Set();
    const candidates = [config.gemini.chatModel, ...config.gemini.chatFallbacks];
    for (const model of candidates) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      chain.push({ client: gem, provider: 'gemini', model });
    }
  }
  const oa = getOpenAIClient();
  if (oa) chain.push({ client: oa, provider: 'openai', model: config.openai.model });
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
