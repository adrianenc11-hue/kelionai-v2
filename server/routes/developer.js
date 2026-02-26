// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — DEVELOPER API ROUTES
// API key management + public API v1 endpoints
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('../logger');
const rateLimit = require('express-rate-limit');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');

const router = express.Router();

// ═══ RATE LIMITERS ═══
const mgmtLimiter = rateLimit({
    windowMs: 60 * 1000, max: 30,
    message: { error: 'Too many requests. Wait a minute.' },
    standardHeaders: true, legacyHeaders: false
});

const v1Limiter = rateLimit({
    windowMs: 60 * 1000, max: 60,
    message: { error: 'Too many requests. Wait a minute.' },
    standardHeaders: true, legacyHeaders: false
});

// ═══ HELPER: generate secure API key ═══
function generateApiKey() {
    return 'kel_' + crypto.randomBytes(32).toString('hex');
}

// ════════════════════════════════════
// API KEY MANAGEMENT ROUTES (/api/developer/...)
// ════════════════════════════════════

// GET /api/developer/keys — list active keys for current user
router.get('/keys', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .select('id, name, key_preview, created_at, last_used_at, request_count, rate_limit, revoked_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ keys: data || [] });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'List keys error');
        res.status(500).json({ error: 'Failed to list keys' });
    }
});

// POST /api/developer/keys — create a new API key
router.post('/keys', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const name = (req.body.name || 'My API Key').toString().slice(0, 100);

        // Limit to 10 active keys per user
        const { count } = await supabaseAdmin
            .from('api_keys')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .is('revoked_at', null);

        if (count >= 10) return res.status(400).json({ error: 'Maximum 10 active API keys allowed' });

        const key = generateApiKey();
        const keyPreview = key.slice(0, 10) + '...' + key.slice(-4);

        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .insert({
                user_id: user.id,
                name,
                key,
                key_preview: keyPreview,
                rate_limit: 100,
                request_count: 0
            })
            .select('id, name, key, key_preview, created_at, rate_limit')
            .single();

        if (error) throw error;

        logger.info({ component: 'Developer', userId: user.id }, 'API key created: ' + data.id);
        res.status(201).json({ key: data });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'Create key error');
        res.status(500).json({ error: 'Failed to create key' });
    }
});

// DELETE /api/developer/keys/:id — revoke an API key
router.delete('/keys/:id', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const { id } = req.params;
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid key ID' });

        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .update({ revoked_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', user.id)
            .select('id')
            .single();

        if (error || !data) return res.status(404).json({ error: 'Key not found' });

        logger.info({ component: 'Developer', userId: user.id }, 'API key revoked: ' + id);
        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'Revoke key error');
        res.status(500).json({ error: 'Failed to revoke key' });
    }
});

// GET /api/developer/stats — usage dashboard for current user
router.get('/stats', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const { data: keys } = await supabaseAdmin
            .from('api_keys')
            .select('id, name, key_preview, request_count, last_used_at, revoked_at')
            .eq('user_id', user.id)
            .order('request_count', { ascending: false });

        const activeKeys = (keys || []).filter(k => !k.revoked_at);
        const totalRequests = (keys || []).reduce((sum, k) => sum + (k.request_count || 0), 0);

        res.json({
            activeKeys: activeKeys.length,
            totalKeys: (keys || []).length,
            totalRequests,
            keys: keys || []
        });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'Stats error');
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// POST /api/developer/webhooks — save webhook URL for current user
router.post('/webhooks', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const url = (req.body.url || '').toString().slice(0, 500);
        if (url && !/^https?:\/\/.+/.test(url)) {
            return res.status(400).json({ error: 'Invalid webhook URL — must start with http:// or https://' });
        }

        await supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: user.id, key: 'webhook_url', value: url || null }, { onConflict: 'user_id,key' });

        res.json({ success: true, url: url || null });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'Webhook save error');
        res.status(500).json({ error: 'Failed to save webhook' });
    }
});

// GET /api/developer/webhooks — get webhook URL for current user
router.get('/webhooks', mgmtLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const { data } = await supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('user_id', user.id)
            .eq('key', 'webhook_url')
            .single();

        res.json({ url: data?.value || null });
    } catch (e) {
        res.json({ url: null });
    }
});

// ════════════════════════════════════
// PUBLIC API v1 ENDPOINTS (/api/v1/...)
// ════════════════════════════════════

// GET /api/v1/status — public, no key required
router.get('/v1/status', (req, res) => {
    res.json({
        status: 'online',
        version: '1.0',
        timestamp: new Date().toISOString(),
        endpoints: [
            { method: 'GET',  path: '/api/v1/status',       auth: false, description: 'API status' },
            { method: 'GET',  path: '/api/v1/models',        auth: true,  description: 'List available AI models' },
            { method: 'GET',  path: '/api/v1/user/profile',  auth: true,  description: 'Current user profile' },
            { method: 'POST', path: '/api/v1/chat',          auth: true,  description: 'Send a message to the AI' }
        ]
    });
});

// GET /api/v1/models — list available AI models (requires API key)
router.get('/v1/models', v1Limiter, apiKeyAuth, (req, res) => {
    const models = [];
    if (process.env.ANTHROPIC_API_KEY) models.push({ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', primary: true });
    if (process.env.OPENAI_API_KEY) models.push({ id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', primary: false });
    if (process.env.DEEPSEEK_API_KEY) models.push({ id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', primary: false });
    if (!models.length) models.push({ id: 'default', name: 'KelionAI Default', provider: 'KelionAI', primary: true });
    res.json({ models });
});

// GET /api/v1/user/profile — returns authenticated user's profile (requires API key)
router.get('/v1/user/profile', v1Limiter, apiKeyAuth, async (req, res) => {
    try {
        const { supabaseAdmin } = req.app.locals;
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

        const userId = req.apiKeyUserId;
        const { data: user, error } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (error || !user) return res.status(404).json({ error: 'User not found' });

        res.json({
            id: user.user.id,
            email: user.user.email,
            name: user.user.user_metadata?.full_name,
            createdAt: user.user.created_at
        });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'v1 profile error');
        res.status(500).json({ error: 'Internal error' });
    }
});

// POST /api/v1/chat — send a message and receive AI response (requires API key)
router.post('/v1/chat', v1Limiter, apiKeyAuth, async (req, res) => {
    try {
        const { brain } = req.app.locals;
        if (!brain) return res.status(503).json({ error: 'AI unavailable' });

        const message = (req.body.message || '').toString().slice(0, 10000);
        if (!message) return res.status(400).json({ error: 'message is required' });

        const avatar = ['kelion', 'kira'].includes(req.body.avatar) ? req.body.avatar : 'kelion';
        const language = (req.body.language || 'en').toString().slice(0, 10);
        const history = Array.isArray(req.body.history) ? req.body.history.slice(0, 20) : [];

        const thought = await brain.think(message, avatar, history, language, req.apiKeyUserId, null);

        const { buildSystemPrompt } = require('../persona');
        const systemPrompt = buildSystemPrompt(avatar, language, '', {}, thought.chainOfThought);
        const msgs = (thought.compressedHistory || history).map(h => ({
            role: h.role === 'ai' ? 'assistant' : h.role,
            content: h.content
        }));
        msgs.push({ role: 'user', content: thought.enrichedMessage });

        let reply = null;

        if (!reply && process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: msgs })
                });
                const d = await r.json();
                reply = d.content?.[0]?.text;
            } catch (e) { /* fallthrough */ }
        }
        if (!reply && process.env.OPENAI_API_KEY) {
            try {
                const r = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 1024, messages: [{ role: 'system', content: systemPrompt }, ...msgs] })
                });
                const d = await r.json();
                reply = d.choices?.[0]?.message?.content;
            } catch (e) { /* fallthrough */ }
        }

        if (!reply) return res.status(503).json({ error: 'AI unavailable' });

        res.json({ reply, avatar, language, toolsUsed: thought.toolsUsed || [] });
    } catch (e) {
        logger.error({ component: 'Developer', err: e.message }, 'v1 chat error');
        res.status(500).json({ error: 'Internal error' });
    }
});

module.exports = router;
