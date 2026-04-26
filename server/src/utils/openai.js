'use strict';

/**
 * Singleton AI client — Gemini ONLY.
 *
 * Per Adrian (single-LLM cleanup, 2026-04): the chat surface (text + voice)
 * must run on a single LLM. We use Gemini exclusively. Even when
 * `OPENAI_API_KEY` is present in the environment (left over for other
 * services like image generation tools), the chat path ignores it and
 * always talks to Gemini via its OpenAI-compatible endpoint.
 *
 * The `OpenAI` SDK is kept ONLY as the HTTP transport — it sends requests
 * to Google's Gemini-compat endpoint. There is no path back to ChatGPT.
 *
 * Env:
 *   GEMINI_API_KEY   → required
 *   GEMINI_CHAT_MODEL or AI_MODEL → optional override of the chat model
 */
let _client = null;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-3-flash-preview';

function getAI() {
  if (_client) return _client;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  const OpenAI = require('openai');
  _client = new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL });
  return _client;
}

function getProvider() { return 'gemini'; }

function getDefaultChatModel() {
  return process.env.AI_MODEL || process.env.GEMINI_CHAT_MODEL || DEFAULT_GEMINI_CHAT_MODEL;
}

function getOpenAI() { return getAI(); }

module.exports = { getAI, getOpenAI, getProvider, getDefaultChatModel };
