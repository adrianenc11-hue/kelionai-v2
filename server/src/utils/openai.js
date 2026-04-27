'use strict';

/**
 * Singleton AI client — now OpenAI (GPT-5.5).
 *
 * Per Adrian (LLM switch, 2026-04-27): the chat surface (text + vision)
 * runs on GPT-5.5. Voice runs on gpt-realtime-1.5 via the Realtime API
 * (separate endpoint). This client is used for:
 *   - /api/chat text completions (GPT-5.5)
 *   - Vision frame descriptions (GPT-5.5 with image input)
 *
 * Env:
 *   OPENAI_API_KEY   → required
 *   AI_MODEL         → optional override (default: gpt-5.5)
 */
let _client = null;

const DEFAULT_CHAT_MODEL = 'gpt-5.5';

function getAI() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const OpenAI = require('openai');
  _client = new OpenAI({ apiKey });
  return _client;
}

function getProvider() { return 'openai'; }

function getDefaultChatModel() {
  return process.env.AI_MODEL || DEFAULT_CHAT_MODEL;
}

function getOpenAI() { return getAI(); }

module.exports = { getAI, getOpenAI, getProvider, getDefaultChatModel };
