'use strict';

/**
 * Singleton OpenAI client.
 * Avoids creating a new instance on every request.
 */
let _client = null;

function getOpenAI() {
  if (_client) return _client;

  const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!key) return null;

  const OpenAI = require('openai');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

module.exports = { getOpenAI };
