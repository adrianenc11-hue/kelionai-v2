// ═══════════════════════════════════════════════════════════════
// KelionAI — Chat Routes (brain-powered + streaming)
// Brain decides tools → executes in parallel → builds deep prompt → AI responds → learns
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { validate, chatSchema, memorySchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');
const { buildSystemPrompt } = require('../persona');

const router = express.Router();

const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many requests. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });
const memoryLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many memory requests.' }, standardHeaders: true, legacyHeaders: false });

// ═══ SAVE CONVERSATION HELPER ═══
async function saveConv(supabaseAdmin, uid, avatar, userMsg, aiReply, convId, lang) {
    if (!supabaseAdmin) return;
    if (!convId) {
        const { data } = await supabaseAdmin.from('conversations').insert({ user_id: uid || null, avatar, title: userMsg.substring(0, 80) }).select('id').single();
        convId = data?.id;
    } else { await supabaseAdmin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId); }
    if (convId) await supabaseAdmin.from('messages').insert([
        { conversation_id: convId, role: 'user', content: userMsg, language: lang, source: 'web' },
        { conversation_id: convId, role: 'assistant', content: aiReply, language: lang, source: 'web' }
    ]);
    return convId;
}

// ═══ ADMIN KEYWORD BLACKLIST ═══
const ADMIN_KEYWORDS = /\b(admin|administrator|dashboard|panou\s*admin|setări\s*admin|settings\s*admin|admin\s*panel|admin\s*mode|deschide\s*admin)\b/i;

// POST /api/chat
router.post('/chat', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        const user = await getUserFromToken(req);

        // Admin keyword blacklist — total silence for non-owners
        const isOwner = user?.role === 'admin';
        if (!isOwner && ADMIN_KEYWORDS.test(message)) {
            return res.status(200).json({ reply: '', avatar, engine: 'silent', language });
        }

        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Chat limit reached. Upgrade to Pro for more messages.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const thought = await brain.think(message, avatar, history, language, user?.id, conversationId);

        let memoryContext = '';
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(30);
                if (prefs?.length > 0) memoryContext = prefs.map(p => `${p.key}: ${JSON.stringify(p.value)}`).join('; ');
            } catch (e) { }
        }
        const systemPrompt = buildSystemPrompt(avatar, language, memoryContext, { failedTools: thought.failedTools }, thought.chainOfThought);

        const compressedHist = thought.compressedHistory || history.slice(-20);
        const msgs = compressedHist.map(h => ({ role: h.role === 'ai' ? 'assistant' : h.role, content: h.content }));
        msgs.push({ role: 'user', content: thought.enrichedMessage });

        let reply = null, engine = null;

        // Claude (primary)
        if (!reply && process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: systemPrompt, messages: msgs })
                });
                const d = await r.json();
                reply = d.content?.[0]?.text;
                if (reply) engine = 'Claude';
            } catch (e) { logger.warn({ component: 'Chat', err: e.message }, 'Claude'); }
        }
        // GPT-4o (fallback)
        if (!reply && process.env.OPENAI_API_KEY) {
            try {
                const r = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] })
                });
                const d = await r.json();
                reply = d.choices?.[0]?.message?.content;
                if (reply) engine = 'GPT-4o';
            } catch (e) { logger.warn({ component: 'Chat', err: e.message }, 'GPT-4o'); }
        }
        // DeepSeek (tertiary)
        if (!reply && process.env.DEEPSEEK_API_KEY) {
            try {
                const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
                    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] })
                });
                const d = await r.json();
                reply = d.choices?.[0]?.message?.content;
                if (reply) engine = 'DeepSeek';
            } catch (e) { logger.warn({ component: 'Chat', err: e.message }, 'DeepSeek'); }
        }

        if (!reply) return res.status(503).json({ error: 'AI unavailable' });

        let savedConvId = conversationId;
        if (supabaseAdmin) {
            try { savedConvId = await saveConv(supabaseAdmin, user?.id, avatar, message, reply, conversationId, language); } catch (e) { logger.warn({ component: 'Chat', err: e.message }, 'saveConv'); }
        }
        brain.learnFromConversation(user?.id, message, reply).catch(() => { });
        incrementUsage(user?.id, 'chat', supabaseAdmin).catch(() => { });

        logger.info({ component: 'Chat', engine, avatar, language, tools: thought.toolsUsed, chainOfThought: !!thought.chainOfThought, thinkTime: thought.thinkTime, replyLength: reply.length }, `${engine} | ${avatar} | ${language} | tools:[${thought.toolsUsed.join(',')}] | CoT:${!!thought.chainOfThought} | ${thought.thinkTime}ms think | ${reply.length}c`);

        const response = { reply, avatar, engine, language, thinkTime: thought.thinkTime, conversationId: savedConvId };
        if (thought.monitor.content) { response.monitor = thought.monitor; }
        res.json(response);

    } catch (e) { logger.error({ component: 'Chat', err: e.message }, e.message); res.status(500).json({ error: 'AI error' }); }
});

// POST /api/chat/stream — Server-Sent Events (word-by-word response)
router.post('/chat/stream', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        const user = await getUserFromToken(req);

        // Admin keyword blacklist — total silence for non-owners
        const isOwnerStream = user?.role === 'admin';
        if (!isOwnerStream && ADMIN_KEYWORDS.test(message)) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
            res.write(`data: ${JSON.stringify({ type: 'done', conversationId: null })}\n\n`);
            res.end();
            return;
        }

        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Chat limit reached. Upgrade to Pro for more messages.', plan: usage.plan, limit: usage.limit, upgrade: true });

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

        const thought = await brain.think(message, avatar, history, language, user?.id, conversationId);

        if (thought.monitor.content) {
            res.write(`data: ${JSON.stringify({ type: 'monitor', content: thought.monitor.content, monitorType: thought.monitor.type })}\n\n`);
        }

        let memoryContext = '';
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(30);
                if (prefs?.length > 0) memoryContext = prefs.map(p => `${p.key}: ${JSON.stringify(p.value)}`).join('; ');
            } catch (e) { }
        }
        const systemPrompt = buildSystemPrompt(avatar, language, memoryContext, { failedTools: thought.failedTools }, thought.chainOfThought);
        const compressedHist = thought.compressedHistory || history.slice(-20);
        const msgs = compressedHist.map(h => ({ role: h.role === 'ai' ? 'assistant' : h.role, content: h.content }));
        msgs.push({ role: 'user', content: thought.enrichedMessage });

        let fullReply = '';

        // Try Claude streaming
        if (process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: systemPrompt, messages: msgs, stream: true })
                });

                if (r.ok && r.body) {
                    res.write(`data: ${JSON.stringify({ type: 'start', engine: 'Claude' })}\n\n`);
                    const reader = r.body;
                    let buffer = '';

                    await new Promise((resolve, reject) => {
                        reader.on('data', (chunk) => {
                            buffer += chunk.toString();
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (!line.startsWith('data: ')) continue;
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;
                                try {
                                    const parsed = JSON.parse(data);
                                    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                                        fullReply += parsed.delta.text;
                                        res.write(`data: ${JSON.stringify({ type: 'chunk', text: parsed.delta.text })}\n\n`);
                                    }
                                } catch (e) { /* skip parse errors */ }
                            }
                        });
                        reader.on('end', resolve);
                        reader.on('error', reject);
                    });
                }
            } catch (e) { logger.warn({ component: 'Stream', err: e.message }, 'Claude'); }
        }

        // Fallback: non-streaming GPT-4o or DeepSeek
        if (!fullReply) {
            if (process.env.OPENAI_API_KEY) {
                try {
                    const r = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] })
                    });
                    const d = await r.json();
                    fullReply = d.choices?.[0]?.message?.content || '';
                    if (fullReply) { res.write(`data: ${JSON.stringify({ type: 'start', engine: 'GPT-4o' })}\n\n`); res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullReply })}\n\n`); }
                } catch (e) { }
            }
        }
        if (!fullReply && process.env.DEEPSEEK_API_KEY) {
            try {
                const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
                    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] })
                });
                const d = await r.json();
                fullReply = d.choices?.[0]?.message?.content || '';
                if (fullReply) { res.write(`data: ${JSON.stringify({ type: 'start', engine: 'DeepSeek' })}\n\n`); res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullReply })}\n\n`); }
            } catch (e) { }
        }

        let savedConvId = conversationId;
        if (fullReply && supabaseAdmin) {
            try { savedConvId = await saveConv(supabaseAdmin, user?.id, avatar, message, fullReply, conversationId, language); } catch (e) { logger.warn({ component: 'Stream', err: e.message }, 'saveConv'); }
        }

        res.write(`data: ${JSON.stringify({ type: 'done', reply: fullReply, thinkTime: thought.thinkTime, conversationId: savedConvId })}\n\n`);
        res.end();

        if (fullReply) brain.learnFromConversation(user?.id, message, fullReply).catch(() => { });
        if (fullReply) incrementUsage(user?.id, 'chat', supabaseAdmin).catch(() => { });
        logger.info({ component: 'Stream', avatar, language, replyLength: fullReply.length }, `${avatar} | ${language} | ${fullReply.length}c`);

    } catch (e) { logger.error({ component: 'Stream', err: e.message }, e.message); if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); else res.end(); }
});

// GET /api/conversations
router.get('/conversations', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const u = await getUserFromToken(req);
        if (!u || !supabaseAdmin) return res.json({ conversations: [] });
        const { data } = await supabaseAdmin.from('conversations').select('id, avatar, title, created_at, updated_at').eq('user_id', u.id).order('updated_at', { ascending: false }).limit(50);
        res.json({ conversations: data || [] });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const u = await getUserFromToken(req);
        if (!u || !supabaseAdmin) return res.json({ messages: [] });
        const { data: conv, error: convErr } = await supabaseAdmin.from('conversations').select('id').eq('id', req.params.id).eq('user_id', u.id).single();
        if (convErr && convErr.code !== 'PGRST116') return res.status(500).json({ error: 'Server error' });
        if (!conv) return res.status(403).json({ error: 'Access denied' });
        const { data } = await supabaseAdmin.from('messages').select('id, role, content, created_at').eq('conversation_id', req.params.id).order('created_at', { ascending: true });
        res.json({ messages: data || [] });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/memory
router.post('/memory', memoryLimiter, validate(memorySchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin, memFallback } = req.app.locals;
        const { action, key, value } = req.body;
        const user = await getUserFromToken(req);
        const uid = 'u:' + (user?.id || 'guest');
        if (supabaseAdmin && user) {
            if (action === 'save') { await supabaseAdmin.from('user_preferences').upsert({ user_id: user.id, key, value: typeof value === 'object' ? value : { data: value } }, { onConflict: 'user_id,key' }); return res.json({ success: true }); }
            if (action === 'load') { const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', key).single(); return res.json({ value: data?.value || null }); }
            if (action === 'list') { const { data } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id); return res.json({ keys: (data || []).map(d => d.key), items: data || [] }); }
        }
        if (!memFallback[uid]) memFallback[uid] = Object.create(null);
        if (action === 'save') { memFallback[uid][key] = value; res.json({ success: true }); }
        else if (action === 'load') res.json({ value: memFallback[uid][key] || null });
        else if (action === 'list') res.json({ keys: Object.keys(memFallback[uid]) });
        else res.status(400).json({ error: 'Action must be: save, load, list' });
    } catch (e) { res.status(500).json({ error: 'Memory error' }); }
});

module.exports = router;
