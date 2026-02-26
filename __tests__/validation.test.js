'use strict';

const {
    registerSchema,
    loginSchema,
    refreshSchema,
    chatSchema,
    speakSchema,
    listenSchema,
    visionSchema,
    searchSchema,
    weatherSchema,
    imagineSchema,
    memorySchema,
    validate,
} = require('../server/validation');

describe('registerSchema', () => {
    test('accepts valid email, password, and optional name', () => {
        const result = registerSchema.safeParse({ email: 'a@b.com', password: 'secret123', name: 'Alice' });
        expect(result.success).toBe(true);
    });

    test('rejects invalid email', () => {
        const result = registerSchema.safeParse({ email: 'not-an-email', password: 'secret123' });
        expect(result.success).toBe(false);
    });

    test('rejects password shorter than 6 characters', () => {
        const result = registerSchema.safeParse({ email: 'a@b.com', password: '123' });
        expect(result.success).toBe(false);
    });

    test('rejects missing email', () => {
        const result = registerSchema.safeParse({ password: 'secret123' });
        expect(result.success).toBe(false);
    });
});

describe('loginSchema', () => {
    test('accepts valid email and password', () => {
        const result = loginSchema.safeParse({ email: 'a@b.com', password: 'pass' });
        expect(result.success).toBe(true);
    });

    test('rejects missing password', () => {
        const result = loginSchema.safeParse({ email: 'a@b.com' });
        expect(result.success).toBe(false);
    });
});

describe('refreshSchema', () => {
    test('accepts a refresh_token string', () => {
        const result = refreshSchema.safeParse({ refresh_token: 'tok123' });
        expect(result.success).toBe(true);
    });

    test('rejects empty refresh_token', () => {
        const result = refreshSchema.safeParse({ refresh_token: '' });
        expect(result.success).toBe(false);
    });

    test('rejects missing refresh_token', () => {
        const result = refreshSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('chatSchema', () => {
    test('accepts message with defaults', () => {
        const result = chatSchema.safeParse({ message: 'Hello' });
        expect(result.success).toBe(true);
    });

    test('accepts all optional fields', () => {
        const result = chatSchema.safeParse({ message: 'Hi', avatar: 'kira', history: [{ role: 'user', content: 'hey' }], language: 'en', conversationId: 'abc' });
        expect(result.success).toBe(true);
    });

    test('rejects empty message', () => {
        const result = chatSchema.safeParse({ message: '' });
        expect(result.success).toBe(false);
    });

    test('rejects message over 10000 characters', () => {
        const result = chatSchema.safeParse({ message: 'a'.repeat(10001) });
        expect(result.success).toBe(false);
    });

    test('rejects invalid avatar value', () => {
        const result = chatSchema.safeParse({ message: 'Hi', avatar: 'unknown' });
        expect(result.success).toBe(false);
    });
});

describe('speakSchema', () => {
    test('accepts text with default avatar', () => {
        const result = speakSchema.safeParse({ text: 'Hello' });
        expect(result.success).toBe(true);
    });

    test('accepts text with avatar kira', () => {
        const result = speakSchema.safeParse({ text: 'Hello', avatar: 'kira' });
        expect(result.success).toBe(true);
    });

    test('rejects empty text', () => {
        const result = speakSchema.safeParse({ text: '' });
        expect(result.success).toBe(false);
    });

    test('rejects missing text', () => {
        const result = speakSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    test('rejects text over 10000 characters', () => {
        const result = speakSchema.safeParse({ text: 'a'.repeat(10001) });
        expect(result.success).toBe(false);
    });
});

describe('listenSchema', () => {
    test('accepts body with text field (WebSpeech passthrough)', () => {
        const result = listenSchema.safeParse({ text: 'hello' });
        expect(result.success).toBe(true);
    });

    test('accepts body with audio field', () => {
        const result = listenSchema.safeParse({ audio: 'base64data' });
        expect(result.success).toBe(true);
    });

    test('rejects empty body (neither text nor audio)', () => {
        const result = listenSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('visionSchema', () => {
    test('accepts image string', () => {
        const result = visionSchema.safeParse({ image: 'base64imgdata' });
        expect(result.success).toBe(true);
    });

    test('accepts image with optional fields', () => {
        const result = visionSchema.safeParse({ image: 'data', avatar: 'kelion', language: 'en' });
        expect(result.success).toBe(true);
    });

    test('rejects missing image', () => {
        const result = visionSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('searchSchema', () => {
    test('accepts a query string', () => {
        const result = searchSchema.safeParse({ query: 'weather today' });
        expect(result.success).toBe(true);
    });

    test('rejects empty query', () => {
        const result = searchSchema.safeParse({ query: '' });
        expect(result.success).toBe(false);
    });

    test('rejects missing query', () => {
        const result = searchSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    test('rejects query over 500 characters', () => {
        const result = searchSchema.safeParse({ query: 'a'.repeat(501) });
        expect(result.success).toBe(false);
    });
});

describe('weatherSchema', () => {
    test('accepts a city string', () => {
        const result = weatherSchema.safeParse({ city: 'București' });
        expect(result.success).toBe(true);
    });

    test('rejects empty city', () => {
        const result = weatherSchema.safeParse({ city: '' });
        expect(result.success).toBe(false);
    });

    test('rejects missing city', () => {
        const result = weatherSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('imagineSchema', () => {
    test('accepts a prompt string', () => {
        const result = imagineSchema.safeParse({ prompt: 'a sunset over mountains' });
        expect(result.success).toBe(true);
    });

    test('rejects empty prompt', () => {
        const result = imagineSchema.safeParse({ prompt: '' });
        expect(result.success).toBe(false);
    });

    test('rejects prompt over 1000 characters', () => {
        const result = imagineSchema.safeParse({ prompt: 'a'.repeat(1001) });
        expect(result.success).toBe(false);
    });
});

describe('memorySchema', () => {
    test('accepts save action with key and value', () => {
        const result = memorySchema.safeParse({ action: 'save', key: 'theme', value: 'dark' });
        expect(result.success).toBe(true);
    });

    test('accepts load action', () => {
        const result = memorySchema.safeParse({ action: 'load', key: 'theme' });
        expect(result.success).toBe(true);
    });

    test('accepts list action without key', () => {
        const result = memorySchema.safeParse({ action: 'list' });
        expect(result.success).toBe(true);
    });

    test('rejects invalid action', () => {
        const result = memorySchema.safeParse({ action: 'delete' });
        expect(result.success).toBe(false);
    });

    test('rejects missing action', () => {
        const result = memorySchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('validate middleware factory', () => {
    test('calls next() when validation passes', () => {
        const middleware = validate(speakSchema);
        const req = { body: { text: 'hello' } };
        const res = {};
        const next = jest.fn();
        middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('returns 400 with error details when validation fails', () => {
        const middleware = validate(speakSchema);
        const req = { body: {} };
        const json = jest.fn();
        const res = { status: jest.fn(() => ({ json })) };
        const next = jest.fn();
        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Validare eșuată', details: expect.any(Array) }));
        expect(next).not.toHaveBeenCalled();
    });

    test('sanitizes req.body to only parsed fields', () => {
        const middleware = validate(speakSchema);
        const req = { body: { text: 'hi', extraField: 'should be stripped' } };
        const res = {};
        const next = jest.fn();
        middleware(req, res, next);
        expect(req.body).toEqual({ text: 'hi' });
        expect(req.body.extraField).toBeUndefined();
    });
});
