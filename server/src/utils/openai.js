'use strict';

/**
 * Singleton AI client.
 *
 * Priority: prefer OpenAI when OPENAI_API_KEY is present, fall back to Gemini.
 * Rationale: the voice path (OpenAI Realtime) is always OpenAI, so when the
 * text path also runs on OpenAI the two transports share the same persona,
 * the same tool-calling semantics (Gemini-via-OpenAI-compat silently drops
 * `tool_calls` chunks on streaming completions, which made "show me the
 * map" return an empty `[DONE]`), and the user hears a single consistent
 * Kelion instead of two different voices / writing styles.
 *
 * To force Gemini explicitly (e.g. on a pure-Gemini deployment), set
 * `AI_PROVIDER=gemini`.
 *
 * Env (priority order):
 *   AI_PROVIDER=openai|gemini  → hard override
 *   OPENAI_API_KEY / AI_API_KEY → use OpenAI (default when both keys exist)
 *   GEMINI_API_KEY             → use Gemini via OpenAI-compat endpoint
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
  const override  = (process.env.AI_PROVIDER || '').toLowerCase();

  const OpenAI = require('openai');

  const preferGemini = override === 'gemini' || (!openaiKey && geminiKey);
  if (preferGemini && geminiKey) {
    _client = new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL });
    _provider = 'gemini';
    return _client;
  }
  if (openaiKey) {
    _client = new OpenAI({ apiKey: openaiKey });
    _provider = 'openai';
    return _client;
  }
  if (geminiKey) {
    _client = new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL });
    _provider = 'gemini';
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
