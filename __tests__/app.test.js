'use strict';

const request = require('supertest');
const express = require('express');
const app = require('../src/app');

describe('App', () => {
  describe('GET /health', () => {
    it('returns 200 with service status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', service: 'kelion-voice' });
    });
  });

  describe('404 handler', () => {
    it('returns 404 for an unknown route', async () => {
      const res = await request(app).get('/unknown-path');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 404 for an unknown POST route', async () => {
      const res = await request(app).post('/no-such-endpoint').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('JSON parsing', () => {
    it('parses a JSON request body correctly', async () => {
      const res = await request(app)
        .post('/api/voice/estimate')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'test body parsing' }));
      expect(res.status).toBe(200);
    });
  });

  describe('Error handler', () => {
    it('returns 500 for an unhandled error thrown by a route', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/boom', () => {
        throw new Error('unexpected failure');
      });
      testApp.use((err, req, res, next) => {
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Internal server error' });
      });
      const res = await request(testApp).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error', 'unexpected failure');
    });

    it('uses err.status when present', async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/not-found', () => {
        const err = new Error('custom not found');
        err.status = 404;
        throw err;
      });
      testApp.use((err, req, res, next) => {
        const status = err.status || 500;
        res.status(status).json({ error: err.message || 'Internal server error' });
      });
      const res = await request(testApp).get('/not-found');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'custom not found');
    });
  });
});
