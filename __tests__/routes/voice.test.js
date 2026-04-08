'use strict';

const request = require('supertest');
const app = require('../../src/app');

describe('Voice Routes', () => {
  describe('GET /api/voice/voices', () => {
    it('returns 200 with an array of voice identifiers', async () => {
      const res = await request(app).get('/api/voice/voices');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.voices)).toBe(true);
      expect(res.body.voices.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/voice/languages', () => {
    it('returns 200 with an array of language codes', async () => {
      const res = await request(app).get('/api/voice/languages');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.languages)).toBe(true);
      expect(res.body.languages.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/voice/synthesise', () => {
    const validBody = { text: 'Hello world', voice: 'alloy', language: 'en', speed: 1.0 };

    it('returns 202 with synthesis metadata for a valid request', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send(validBody);
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('request');
      expect(res.body).toHaveProperty('estimatedDurationSeconds');
      expect(typeof res.body.estimatedDurationSeconds).toBe('number');
    });

    it('accepts a request with only the required text field', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: 'Just text' });
      expect(res.status).toBe(202);
    });

    it('returns 400 when text field is missing', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ voice: 'alloy' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('missing');
    });

    it('returns 422 when text is an empty string', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: '   ' });
      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty('details');
    });

    it('returns 422 for an invalid voice', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: 'Hi', voice: 'unknown-voice' });
      expect(res.status).toBe(422);
    });

    it('returns 422 for an invalid language', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: 'Hi', language: 'zz' });
      expect(res.status).toBe(422);
    });

    it('returns 422 when speed is out of range', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: 'Hi', speed: 100 });
      expect(res.status).toBe(422);
    });

    it('returns 413 when content-length exceeds limit', async () => {
      const res = await request(app)
        .post('/api/voice/synthesise')
        .send({ text: 'x'.repeat(21 * 1024) });
      expect(res.status).toBe(413);
    });
  });

  describe('POST /api/voice/estimate', () => {
    it('returns 200 with word count and duration for valid input', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .send({ text: 'Hello world' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('wordCount', 2);
      expect(res.body).toHaveProperty('estimatedDurationSeconds');
      expect(typeof res.body.estimatedDurationSeconds).toBe('number');
    });

    it('uses a custom speed when provided', async () => {
      const normal = await request(app)
        .post('/api/voice/estimate')
        .send({ text: 'Hello world', speed: 1 });
      const fast = await request(app)
        .post('/api/voice/estimate')
        .send({ text: 'Hello world', speed: 2 });
      expect(fast.body.estimatedDurationSeconds).toBeLessThan(normal.body.estimatedDurationSeconds);
    });

    it('returns 400 when text field is missing', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .send({ speed: 1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when text is empty', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .send({ text: '  ' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when speed is not a positive number', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .send({ text: 'hello', speed: -1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when speed is non-numeric', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .send({ text: 'hello', speed: 'fast' });
      expect(res.status).toBe(400);
    });
  });
});
