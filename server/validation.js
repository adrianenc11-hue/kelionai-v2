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

const eventSchema = z.object({
    title: z.string().min(1).max(200),
    type: z.enum(['birthday', 'anniversary', 'event', 'reminder']).default('event'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format dată: YYYY-MM-DD'),
    recurring: z.boolean().default(false),
    notes: z.string().max(2000).optional(),
    remind_days_before: z.number().int().min(0).max(365).default(3),
});

const journalSchema = z.object({
    mood: z.number().int().min(1).max(5).optional(),
    best_moment: z.string().max(2000).optional(),
    improvements: z.string().max(2000).optional(),
    goals: z.string().max(2000).optional(),
    free_text: z.string().max(10000).optional(),
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
    eventSchema,
    journalSchema,
};
