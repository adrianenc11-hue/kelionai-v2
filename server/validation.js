'use strict';

const { z } = require('zod');

// ═══ SCHEMAS ═══

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6).max(128),
    name: z.string().max(100).optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(128),
});

const refreshSchema = z.object({
    refresh_token: z.string().min(1),
});

const chatSchema = z.object({
    message: z.string().min(1).max(10000),
    avatar: z.enum(['kelion', 'kira']).optional(),
    history: z.array(z.object({
        role: z.string(),
        content: z.string(),
    })).max(100).optional(),
    language: z.string().min(2).max(10).optional(),
    conversationId: z.string().optional(),
});

const speakSchema = z.object({
    text: z.string().min(1).max(10000),
    avatar: z.enum(['kelion', 'kira']).optional(),
    mood: z.enum(['happy', 'sad', 'laughing', 'thinking', 'excited', 'concerned', 'neutral', 'surprised', 'playful', 'determined', 'loving', 'sleepy', 'frustrated', 'anxious']).optional(),
});

const listenSchema = z.object({
    text: z.string().max(10000).optional(),
    audio: z.string().min(1).optional(),
}).refine(data => data.text !== undefined || data.audio !== undefined, {
    message: 'text sau audio obligatoriu',
});

const visionSchema = z.object({
    image: z.string().min(1),
    avatar: z.enum(['kelion', 'kira']).optional(),
    language: z.string().min(2).max(10).optional(),
});

const searchSchema = z.object({
    query: z.string().min(1).max(500),
});

const weatherSchema = z.object({
    city: z.string().min(1).max(200),
});

const imagineSchema = z.object({
    prompt: z.string().min(1).max(1000),
});

const memorySchema = z.object({
    action: z.enum(['save', 'load', 'list']),
    key: z.string().max(200).optional(),
    value: z.any().optional(),
});

// ═══ MIDDLEWARE FACTORY ═══

function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                error: 'Validare eșuată',
                details: result.error.issues.map(i => ({
                    field: i.path.join('.'),
                    message: i.message,
                })),
            });
        }
        req.body = result.data;
        next();
    };
}

module.exports = {
    validate,
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
};
