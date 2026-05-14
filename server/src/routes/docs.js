'use strict';

// Public API documentation — auto-generated from the live router state.
// Returns an OpenAPI-flavoured JSON summary so external developers can
// discover Kelion endpoints without reading source code.

const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Kelion Public API',
      version: '1.0.0',
      description: 'External developer API for Kelion AI. Chat, tools, memory, and health endpoints.',
      contact: { url: 'https://kelionai.app/contact' },
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'Chat', description: 'Text completion and conversation' },
      { name: 'Tools', description: 'Execute real-world tools (search, code, maps, etc.)' },
      { name: 'Memory', description: 'Long-term user memory' },
      { name: 'Health', description: 'Service health and diagnostics' },
    ],
    paths: {
      '/api/chat': {
        post: {
          tags: ['Chat'],
          summary: 'Send a chat message',
          description: 'Streams a text response using the configured LLM. Supports memory injection and tool calls.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: 'User message text' },
                    history: { type: 'array', description: 'Previous messages [{role, content}]' },
                    lang: { type: 'string', description: 'Language tag, e.g. en-US' },
                  },
                  required: ['message'],
                },
              },
            },
          },
          responses: {
            200: { description: 'SSE stream of assistant tokens' },
            401: { description: 'Unauthorized or credits exhausted' },
            502: { description: 'All AI providers exhausted' },
          },
        },
      },
      '/api/tools/execute': {
        post: {
          tags: ['Tools'],
          summary: 'Execute a named tool',
          description: 'Runs any of the 130+ Kelion tools by name with JSON arguments.',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'search_web' },
                    args: { type: 'object', description: 'Tool-specific parameters' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: {
            200: { description: 'Tool result JSON' },
            400: { description: 'Unknown tool or invalid args' },
          },
        },
      },
      '/api/memory': {
        get: {
          tags: ['Memory'],
          summary: 'List stored memory facts',
          responses: { 200: { description: 'Array of memory items' } },
        },
        delete: {
          tags: ['Memory'],
          summary: 'Clear all memory',
          responses: { 200: { description: 'Number of deleted items' } },
        },
      },
      '/api/health': {
        get: {
          tags: ['Health'],
          summary: 'Service health check',
          responses: { 200: { description: '{ ok: true, timestamp }' } },
        },
      },
      '/api/diag/model-router-health': {
        get: {
          tags: ['Health'],
          summary: 'AI provider health (OpenRouter, Google AI Studio)',
          responses: { 200: { description: 'Provider status object' } },
        },
      },
    },
    externalDocs: {
      description: 'Kelion Homepage',
      url: 'https://kelionai.app',
    },
  });
});

module.exports = router;
