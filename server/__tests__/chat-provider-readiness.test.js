'use strict';

const ORIGINAL_ENV = process.env;

describe('chat provider readiness', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  function resetAiEnv(extra = {}) {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-at-least-32-chars',
      JWT_SECRET: 'test-jwt-secret-at-least-32-chars!!',
      ...extra,
    };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEYS;
    Object.assign(process.env, extra);
  }

  it('reports a clear 503 when no server AI provider is configured', async () => {
    resetAiEnv();

    const express = require('express');
    const request = require('supertest');
    const chatRouter = require('../src/routes/chat');
    const app = express();
    app.use(express.json());
    app.use('/api/chat', chatRouter);

    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'Buna' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_PROVIDER_NOT_CONFIGURED');
    expect(res.body.error).toContain('OPENROUTER_API_KEY');
    expect(res.body.error).not.toContain('GOOGLE_API_KEY');
  }, 20000);

  it('does not recognize Google AI keys as a valid chat provider', () => {
    resetAiEnv({ GOOGLE_API_KEY: 'test-google-key' });

    const { hasAiProvider, hasGoogleProvider, hasOpenRouterProvider } = require('../src/services/modelRouter');

    expect(hasAiProvider()).toBe(false);
    expect(hasGoogleProvider()).toBe(false);
    expect(hasOpenRouterProvider()).toBe(false);
  });

  it('requires OpenRouter for chat readiness', () => {
    resetAiEnv({ OPENROUTER_API_KEY: 'test-openrouter-key' });

    const { hasAiProvider, hasGoogleProvider, hasOpenRouterProvider } = require('../src/services/modelRouter');

    expect(hasAiProvider()).toBe(true);
    expect(hasGoogleProvider()).toBe(false);
    expect(hasOpenRouterProvider()).toBe(true);
  });
});
