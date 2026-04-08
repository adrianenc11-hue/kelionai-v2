'use strict';

const { requireJson, requireFields, limitPayloadSize } = require('../../src/middleware/validation');

function makeReqRes({ headers = {}, body = {} } = {}) {
  const req = {
    headers,
    body,
    is(contentType) {
      const ct = this.headers['content-type'] || '';
      return ct.toLowerCase().includes(contentType.toLowerCase());
    },
  };

  let statusCode = 200;
  let responseBody = null;

  const res = {
    get statusCode() {
      return statusCode;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseBody = data;
      return res;
    },
    _getData() {
      return JSON.stringify(responseBody);
    },
  };

  return { req, res };
}

describe('validation middleware', () => {
  describe('requireJson', () => {
    it('calls next() when Content-Type is application/json', () => {
      const { req, res } = makeReqRes({
        headers: { 'content-type': 'application/json' },
      });
      const next = jest.fn();
      requireJson(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    });

    it('returns 415 when Content-Type is missing', () => {
      const { req, res } = makeReqRes();
      const next = jest.fn();
      requireJson(req, res, next);
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res._getData());
      expect(body).toHaveProperty('error');
    });

    it('returns 415 when Content-Type is text/plain', () => {
      const { req, res } = makeReqRes({
        headers: { 'content-type': 'text/plain' },
      });
      const next = jest.fn();
      requireJson(req, res, next);
      expect(res.statusCode).toBe(415);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireFields', () => {
    const middleware = requireFields(['text', 'voice']);

    it('calls next() when all required fields are present', () => {
      const { req, res } = makeReqRes({
        body: { text: 'hello', voice: 'alloy' },
      });
      const next = jest.fn();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when a required field is missing', () => {
      const { req, res } = makeReqRes({ body: { text: 'hello' } });
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res._getData());
      expect(body.missing).toContain('voice');
    });

    it('returns 400 when a required field is null', () => {
      const { req, res } = makeReqRes({ body: { text: null, voice: 'alloy' } });
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res._getData());
      expect(body.missing).toContain('text');
    });

    it('returns 400 and lists all missing fields', () => {
      const { req, res } = makeReqRes({ body: {} });
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res._getData());
      expect(body.missing).toEqual(expect.arrayContaining(['text', 'voice']));
    });
  });

  describe('limitPayloadSize', () => {
    const MAX = 1024;
    const middleware = limitPayloadSize(MAX);

    it('calls next() when content-length is within limit', () => {
      const { req, res } = makeReqRes({
        headers: { 'content-length': String(MAX) },
      });
      const next = jest.fn();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('calls next() when content-length header is absent', () => {
      const { req, res } = makeReqRes();
      const next = jest.fn();
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 413 when content-length exceeds limit', () => {
      const { req, res } = makeReqRes({
        headers: { 'content-length': String(MAX + 1) },
      });
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.statusCode).toBe(413);
      expect(next).not.toHaveBeenCalled();
      const body = JSON.parse(res._getData());
      expect(body).toHaveProperty('error');
    });
  });
});
