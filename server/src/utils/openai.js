'use strict';

/**
 * Singleton AI client.
 * Prefers Gemini when GEMINI_API_KEY is present, otherwise falls back to OpenAI.
 * Gemini exposes an OpenAI-compatible chat/completions endpoint, so the same
 * `openai` SDK is reused against Gemini's base URL.
 *
 * Env (priority order):
 *   GEMINI_API_KEY    → use Gemini via OpenAI-compat endpoint
 *   OPENAI_API_KEY    → use OpenAI
 *   AI_API_KEY        → generic fallback for either, behaves like OpenAI
 */
let _client = null;
let _provider = null;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';

function getAI() {
  if (_client) return _client;

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

  const OpenAI = require('openai');
  if (geminiKey) {
    _client = new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL });
    _provider = 'gemini';
    return _client;
  }
  if (openaiKey) {
    _client = new OpenAI({ apiKey: openaiKey });
    _provider = 'openai';
    return _client;
  }
  return null;
}

function getProvider() {
  if (!_client) getAI();
  return _provider;
}

function getDefaultChatModel() {
  const explicit = process.env.AI_MODEL;
  if (explicit) return explicit;
  return getProvider() === 'gemini' ? DEFAULT_GEMINI_CHAT_MODEL : DEFAULT_OPENAI_CHAT_MODEL;
}

// Backwards-compatible alias — existing routes import this name.
function getOpenAI() { return getAI(); }

module.exports = { getAI, getOpenAI, getProvider, getDefaultChatModel };
