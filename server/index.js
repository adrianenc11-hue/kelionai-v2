// ═══════════════════════════════════════════════════════════════
// KelionAI v2.2 — BRAIN-POWERED SERVER
// Autonomous thinking, self-repair, auto-learning
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0, integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()] });
}
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { supabase, supabaseAdmin } = require('./supabase');
const { runMigration } = require('./migrate');
const { KelionBrain } = require('./brain');
const { buildSystemPrompt } = require('./persona');

const logger = require('./logger');
const { router: paymentsRouter, checkUsage, incrementUsage } = require('./payments');
const legalRouter = require('./legal');
const { validate, registerSchema, loginSchema, refreshSchema, chatSchema, speakSchema, listenSchema, visionSchema, searchSchema, weatherSchema, imagineSchema, memorySchema } = require('./validation');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "https://api.openai.com", "https://generativelanguage.googleapis.com", "https://api.anthropic.com", "https://api.elevenlabs.io", "https://api.groq.com", "https://api.perplexity.ai", "https://api.tavily.com", "https://google.serper.dev", "https://api.duckduckgo.com", "https://api.together.xyz", "https://api.deepseek.com", "https://geocoding-api.open-meteo.com", "https://api.open-meteo.com"],
            mediaSrc: ["'self'", "blob:"],
            workerSrc: ["'self'", "blob:"],
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : null;

app.use(cors({
    origin: (origin, callback) => {
        if (!allowedOrigins) return callback(null, true);
        if (!origin) return callback(null, true);
        const env = process.env.NODE_ENV || 'development';
        if (env !== 'production' && (origin.startsWith('http://localhost') || origin.startsWith('http://127.'))) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
    },
    credentials: true
}));

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// ═══ HTTP REQUEST LOGGING ═══
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            component: 'HTTP',
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration,
            userAgent: req.get('user-agent')
        }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// ═══ RATE LIMITING ═══
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Prea multe cereri. Așteaptă un minut.' }, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Prea multe încercări. Așteaptă 15 minute.' } });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'Prea multe căutări. Așteaptă un minut.' } });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Prea multe imagini. Așteaptă un minut.' } });

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Prea multe cereri API. Așteaptă 15 minute.' },
    standardHeaders: true,
    legacyHeaders: false
});

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Prea multe cereri. Încearcă mai târziu.' },
    standardHeaders: true,
    legacyHeaders: false
});

const memoryLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Prea multe cereri memorie.' }, standardHeaders: true, legacyHeaders: false });
const weatherLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Prea multe cereri meteo.' }, standardHeaders: true, legacyHeaders: false });
const sosLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Prea multe cereri SOS.' }, standardHeaders: true, legacyHeaders: false });

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// ═══ ADMIN AUTH MIDDLEWARE ═══
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

const metrics = require('./metrics');
app.use(metrics.metricsMiddleware);
app.get('/metrics', adminAuth, asyncHandler(async (req, res) => { res.set('Content-Type', metrics.register.contentType); res.end(await metrics.register.metrics()); }));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.use(express.static(path.join(__dirname, '..', 'app')));
app.use('/api', globalLimiter);
const PORT = process.env.PORT || 3000;
const memFallback = {};

// ═══ BRAIN INITIALIZATION ═══
const brain = new KelionBrain({
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    perplexityKey: process.env.PERPLEXITY_API_KEY,
    tavilyKey: process.env.TAVILY_API_KEY,
    serperKey: process.env.SERPER_API_KEY,
    togetherKey: process.env.TOGETHER_API_KEY,
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,
    supabaseAdmin
});
logger.info({ component: 'Brain' }, '🧠 Engine initialized');

// ═══ AUTH HELPER ═══
async function getUserFromToken(req) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ') || !supabase) return null;
    try { const { data: { user } } = await supabase.auth.getUser(h.split(' ')[1]); return user; }
    catch (e) { return null; }
}

// ═══ AUTH ENDPOINTS ═══
app.post('/api/auth/register', authLimiter, validate(registerSchema), async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email și parolă obligatorii' });
        if (!supabase) return res.status(503).json({ error: 'Auth indisponibil' });
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || email.split('@')[0] } } });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Eroare înregistrare' }); }
});

app.post('/api/auth/login', authLimiter, validate(loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email și parolă obligatorii' });
        if (!supabase) return res.status(503).json({ error: 'Auth indisponibil' });
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Eroare login' }); }
});

app.post('/api/auth/logout', async (req, res) => { try { if (supabase) await supabase.auth.signOut(); } catch(e){} res.json({ success: true }); });
app.get('/api/auth/me', asyncHandler(async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u) return res.status(401).json({ error: 'Neautentificat' });
    res.json({ user: { id: u.id, email: u.email, name: u.user_metadata?.full_name } });
}));
app.post('/api/auth/refresh', validate(refreshSchema), async (req, res) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token || !supabase) return res.status(400).json({ error: 'Token lipsă' });
        const { data, error } = await supabase.auth.refreshSession({ refresh_token });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Eroare refresh' }); }
});

// ═══════════════════════════════════════════════════════════════
// CHAT — BRAIN-POWERED (the core)
// Brain decides tools → executes in parallel → builds deep prompt → AI responds → learns
// ═══════════════════════════════════════════════════════════════
app.post('/api/chat', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Mesaj lipsă' });
        const user = await getUserFromToken(req);

        // ── Usage check ──
        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită chat atinsă. Upgrade la Pro pentru mai multe mesaje.', plan: usage.plan, limit: usage.limit, upgrade: true });

        // ── BRAIN v2 THINKS: analyze → decompose → plan → execute → CoT ──
        const thought = await brain.think(message, avatar, history, language, user?.id, conversationId);

        // ── BUILD DEEP PERSONA PROMPT (with CoT guidance) ──
        let memoryContext = '';
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(30);
                if (prefs?.length > 0) memoryContext = prefs.map(p => `${p.key}: ${JSON.stringify(p.value)}`).join('; ');
            } catch(e){}
        }
        const systemPrompt = buildSystemPrompt(avatar, language, memoryContext, { failedTools: thought.failedTools }, thought.chainOfThought);

        // ── COMPRESSED CONVERSATION HISTORY (auto-summarized if >20 msgs) ──
        const compressedHist = thought.compressedHistory || history.slice(-20);
        const msgs = compressedHist.map(h => ({ role: h.role === 'ai' ? 'assistant' : h.role, content: h.content }));
        msgs.push({ role: 'user', content: thought.enrichedMessage });

        // ── AI CALL (Claude → GPT-4o → DeepSeek) ──
        let reply = null, engine = null;

        // Claude (primary)
        if (!reply && process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: systemPrompt, messages: msgs }) });
                const d = await r.json();
                reply = d.content?.[0]?.text;
                if (reply) engine = 'Claude';
            } catch(e) { logger.warn({ component: 'Chat', err: e.message }, 'Claude'); }
        }
        // GPT-4o (fallback)
        if (!reply && process.env.OPENAI_API_KEY) {
            try {
                const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] }) });
                const d = await r.json();
                reply = d.choices?.[0]?.message?.content;
                if (reply) engine = 'GPT-4o';
            } catch(e) { logger.warn({ component: 'Chat', err: e.message }, 'GPT-4o'); }
        }
        // DeepSeek (tertiary)
        if (!reply && process.env.DEEPSEEK_API_KEY) {
            try {
                const r = await fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
                    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] }) });
                const d = await r.json();
                reply = d.choices?.[0]?.message?.content;
                if (reply) engine = 'DeepSeek';
            } catch(e) { logger.warn({ component: 'Chat', err: e.message }, 'DeepSeek'); }
        }

        if (!reply) return res.status(503).json({ error: 'AI indisponibil' });

        // ── Save conversation (sync to get ID) + Learn async ──
        let savedConvId = conversationId;
        if (supabaseAdmin) {
            try { savedConvId = await saveConv(user?.id, avatar, message, reply, conversationId, language); } catch(e){ logger.warn({ component: 'Chat', err: e.message }, 'saveConv'); }
        }
        brain.learnFromConversation(user?.id, message, reply).catch(()=>{});
        incrementUsage(user?.id, 'chat', supabaseAdmin).catch(()=>{});

        logger.info({ component: 'Chat', engine, avatar, language, tools: thought.toolsUsed, chainOfThought: !!thought.chainOfThought, thinkTime: thought.thinkTime, replyLength: reply.length }, `${engine} | ${avatar} | ${language} | tools:[${thought.toolsUsed.join(',')}] | CoT:${!!thought.chainOfThought} | ${thought.thinkTime}ms think | ${reply.length}c`);

        // ── RESPONSE with monitor content + brain metadata ──
        const response = { reply, avatar, engine, language, thinkTime: thought.thinkTime, conversationId: savedConvId, isEmergency: thought.analysis.isEmergency || false };
        if (thought.monitor.content) {
            response.monitor = thought.monitor;
        }
        res.json(response);

    } catch(e) { logger.error({ component: 'Chat', err: e.message }, e.message); res.status(500).json({ error: 'Eroare AI' }); }
});

// ═══════════════════════════════════════════════════════════════
// CHAT STREAM — Server-Sent Events (word-by-word response)
// ═══════════════════════════════════════════════════════════════
app.post('/api/chat/stream', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Mesaj lipsă' });
        const user = await getUserFromToken(req);

        // ── Usage check ──
        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită chat atinsă. Upgrade la Pro pentru mai multe mesaje.', plan: usage.plan, limit: usage.limit, upgrade: true });

        // SSE headers
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });

        // Brain thinks (tools in parallel)
        const thought = await brain.think(message, avatar, history, language, user?.id, conversationId);

        // Send monitor content immediately if available
        if (thought.monitor.content) {
            res.write(`data: ${JSON.stringify({ type: 'monitor', content: thought.monitor.content, monitorType: thought.monitor.type })}\n\n`);
        }

        // Build prompt
        let memoryContext = '';
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(30);
                if (prefs?.length > 0) memoryContext = prefs.map(p => `${p.key}: ${JSON.stringify(p.value)}`).join('; ');
            } catch(e){}
        }
        const systemPrompt = buildSystemPrompt(avatar, language, memoryContext, { failedTools: thought.failedTools }, thought.chainOfThought);
        const compressedHist = thought.compressedHistory || history.slice(-20);
        const msgs = compressedHist.map(h => ({ role: h.role === 'ai' ? 'assistant' : h.role, content: h.content }));
        msgs.push({ role: 'user', content: thought.enrichedMessage });

        let fullReply = '';

        // Try Claude streaming
        if (process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: systemPrompt, messages: msgs, stream: true }) });

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

        // Fallback: non-streaming GPT-4o or DeepSeek (send as single chunk)
        if (!fullReply) {
            if (process.env.OPENAI_API_KEY) {
                try {
                    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] }) });
                    const d = await r.json();
                    fullReply = d.choices?.[0]?.message?.content || '';
                    if (fullReply) { res.write(`data: ${JSON.stringify({ type: 'start', engine: 'GPT-4o' })}\n\n`); res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullReply })}\n\n`); }
                } catch(e) {}
            }
        }
        if (!fullReply && process.env.DEEPSEEK_API_KEY) {
            try {
                const r = await fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
                    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048, messages: [{ role: 'system', content: systemPrompt }, ...msgs] }) });
                const d = await r.json();
                fullReply = d.choices?.[0]?.message?.content || '';
                if (fullReply) { res.write(`data: ${JSON.stringify({ type: 'start', engine: 'DeepSeek' })}\n\n`); res.write(`data: ${JSON.stringify({ type: 'chunk', text: fullReply })}\n\n`); }
            } catch(e) {}
        }

        // Save conversation (sync to get ID) then end stream
        let savedConvId = conversationId;
        if (fullReply && supabaseAdmin) {
            try { savedConvId = await saveConv(user?.id, avatar, message, fullReply, conversationId, language); } catch(e){ logger.warn({ component: 'Stream', err: e.message }, 'saveConv'); }
        }

        // End stream
        res.write(`data: ${JSON.stringify({ type: 'done', reply: fullReply, thinkTime: thought.thinkTime, conversationId: savedConvId, isEmergency: thought.analysis.isEmergency || false })}\n\n`);
        res.end();

        if (fullReply) brain.learnFromConversation(user?.id, message, fullReply).catch(()=>{});
        if (fullReply) incrementUsage(user?.id, 'chat', supabaseAdmin).catch(()=>{});
        logger.info({ component: 'Stream', avatar, language, replyLength: fullReply.length }, `${avatar} | ${language} | ${fullReply.length}c`);

    } catch(e) { logger.error({ component: 'Stream', err: e.message }, e.message); if (!res.headersSent) res.status(500).json({ error: 'Eroare stream' }); else res.end(); }
});

// ═══ SAVE CONVERSATION ═══
async function saveConv(uid, avatar, userMsg, aiReply, convId, lang) {
    if (!supabaseAdmin) return;
    if (!convId) {
        const { data } = await supabaseAdmin.from('conversations').insert({ user_id: uid || null, avatar, title: userMsg.substring(0, 80) }).select('id').single();
        convId = data?.id;
    } else { await supabaseAdmin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId); }
    if (convId) await supabaseAdmin.from('messages').insert([
        { conversation_id: convId, role: 'user', content: userMsg, language: lang },
        { conversation_id: convId, role: 'assistant', content: aiReply, language: lang }
    ]);
    return convId;
}

// ═══ TTS — ElevenLabs ═══
app.post('/api/speak', apiLimiter, validate(speakSchema), async (req, res) => {
    try {
        const { text, avatar = 'kelion' } = req.body;
        if (!text || !process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'tts', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită TTS atinsă. Upgrade la Pro pentru mai mult.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const vid = avatar === 'kira' ? 'EXAVITQu4vr4xnSDxMaL' : 'VR6AewLTigWG4xSOukaG';
        const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
        if (!r.ok) return res.status(503).json({ error: 'TTS fail' });
        const buf = await r.buffer();
        logger.info({ component: 'Speak', bytes: buf.length, avatar }, buf.length + ' bytes | ' + avatar);
        incrementUsage(user?.id, 'tts', supabaseAdmin).catch(()=>{});
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length }); res.send(buf);
    } catch(e) { res.status(500).json({ error: 'Eroare TTS' }); }
});

// ═══ STT — Groq Whisper ═══
app.post('/api/listen', apiLimiter, validate(listenSchema), async (req, res) => {
    try {
        if (req.body.text) return res.json({ text: req.body.text, engine: 'WebSpeech' });
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: 'Audio lipsă' });
        if (process.env.GROQ_API_KEY) {
            const form = new FormData();
            form.append('file', Buffer.from(audio, 'base64'), { filename: 'a.webm', contentType: 'audio/webm' });
            form.append('model', 'whisper-large-v3');
            const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
            const d = await r.json(); return res.json({ text: d.text || '', engine: 'Groq' });
        }
        res.status(503).json({ error: 'Folosește Web Speech API' });
    } catch(e) { res.status(500).json({ error: 'Eroare STT' }); }
});

// ═══ VISION — Claude Vision ═══
app.post('/api/vision', apiLimiter, validate(visionSchema), async (req, res) => {
    try {
        const { image, avatar = 'kelion', language = 'ro' } = req.body;
        if (!image || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Vision indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'vision', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită vision atinsă. Upgrade la Pro pentru mai mult.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const LANGS = { ro:'română', en:'English' };
        const prompt = `Ești OCHII unei persoane. Descrie EXACT ce vezi cu PRECIZIE MAXIMĂ.
Persoane: vârstă, sex, haine (culori exacte), expresie, gesturi, ce țin în mâini.
Obiecte: fiecare obiect, culoare, dimensiune, poziție.
Text: citește ORICE text vizibil.
Pericole: obstacole, trepte → "ATENȚIE:"
Răspunde în ${LANGS[language] || 'română'}, concis dar detaliat.`;
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
                messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: prompt }] }] }) });
        const d = await r.json();
        incrementUsage(user?.id, 'vision', supabaseAdmin).catch(()=>{});
        res.json({ description: d.content?.[0]?.text || 'Nu am putut analiza.', avatar, engine: 'Claude' });
    } catch(e) { res.status(500).json({ error: 'Eroare viziune' }); }
});

// ═══ SEARCH — Perplexity Sonar → Tavily → Serper → DuckDuckGo ═══
app.post('/api/search', searchLimiter, validate(searchSchema), async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query lipsă' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'search', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită căutări atinsă. Upgrade la Pro pentru mai multe căutări.', plan: usage.plan, limit: usage.limit, upgrade: true });

        // 1. Perplexity Sonar (best — synthesized answer + citations)
        if (process.env.PERPLEXITY_API_KEY) {
            try {
                const r = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY },
                    body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }], max_tokens: 500 })
                });
                if (r.ok) {
                    const d = await r.json();
                    const answer = d.choices?.[0]?.message?.content || '';
                    const citations = d.citations || [];
                    const results = citations.slice(0, 5).map(url => ({ title: url, content: '', url }));
                    logger.info({ component: 'Search', engine: 'Perplexity', chars: answer.length }, 'Perplexity Sonar — ' + answer.length + ' chars');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(()=>{});
                    return res.json({ results, answer, engine: 'Perplexity' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Perplexity', err: e.message }, 'Perplexity'); }
        }

        // 2. Tavily (good — aggregated + parsed)
        if (process.env.TAVILY_API_KEY) {
            try {
                const tr = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5, include_answer: true }) });
                if (tr.ok) {
                    const td = await tr.json();
                    logger.info({ component: 'Search', engine: 'Tavily', results: (td.results || []).length }, 'Tavily — ' + (td.results || []).length + ' results');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(()=>{});
                    return res.json({ results: (td.results || []).map(x => ({ title: x.title, content: x.content, url: x.url })), answer: td.answer || '', engine: 'Tavily' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Tavily', err: e.message }, 'Tavily'); }
        }

        // 3. Serper (fast — raw Google results, cheap)
        if (process.env.SERPER_API_KEY) {
            try {
                const sr = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY },
                    body: JSON.stringify({ q: query, num: 5 })
                });
                if (sr.ok) {
                    const sd = await sr.json();
                    const answer = sd.answerBox?.answer || sd.answerBox?.snippet || sd.knowledgeGraph?.description || '';
                    const results = (sd.organic || []).slice(0, 5).map(x => ({ title: x.title, content: x.snippet, url: x.link }));
                    logger.info({ component: 'Search', engine: 'Serper', results: results.length }, 'Serper — ' + results.length + ' results');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(()=>{});
                    return res.json({ results, answer, engine: 'Serper' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Serper', err: e.message }, 'Serper'); }
        }

        // 4. DuckDuckGo (free fallback)
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
        const d = await r.json();
        const results = [];
        if (d.Abstract) results.push({ title: d.Heading || query, content: d.Abstract, url: d.AbstractURL });
        if (d.RelatedTopics) for (const t of d.RelatedTopics.slice(0, 5)) if (t.Text) results.push({ title: t.Text.substring(0, 80), content: t.Text, url: t.FirstURL });
        incrementUsage(user?.id, 'search', supabaseAdmin).catch(()=>{});
        res.json({ results, answer: d.Abstract || '', engine: 'DuckDuckGo' });
    } catch(e) { res.status(500).json({ error: 'Eroare căutare' }); }
});

// ═══ WEATHER — Open-Meteo ═══
app.post('/api/weather', weatherLimiter, validate(weatherSchema), async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'Oraș lipsă' });
        const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=ro')).json();
        if (!geo.results?.[0]) return res.status(404).json({ error: '"' + city + '" negăsit' });
        const { latitude, longitude, name, country } = geo.results[0];
        const wx = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude='+latitude+'&longitude='+longitude+'&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto')).json();
        const c = wx.current;
        const codes = {0:'Senin ☀️',1:'Parțial senin 🌤️',2:'Parțial noros ⛅',3:'Noros ☁️',45:'Ceață 🌫️',51:'Burniță 🌦️',61:'Ploaie 🌧️',71:'Ninsoare 🌨️',80:'Averse 🌦️',95:'Furtună ⛈️'};
        const cond = codes[c.weather_code] || '?';
        res.json({ city: name, country, temperature: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, condition: cond,
            description: name+', '+country+': '+c.temperature_2m+'°C, '+cond+', umiditate '+c.relative_humidity_2m+'%, vânt '+c.wind_speed_10m+' km/h' });
    } catch(e) { res.status(500).json({ error: 'Eroare meteo' }); }
});

// ═══ IMAGINE — Together FLUX ═══
app.post('/api/imagine', imageLimiter, validate(imagineSchema), async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !process.env.TOGETHER_API_KEY) return res.status(503).json({ error: 'Imagine indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'image', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Limită imagini atinsă. Upgrade la Pro pentru mai multe imagini.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const r = await fetch('https://api.together.xyz/v1/images/generations', { method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.TOGETHER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'black-forest-labs/FLUX.1-schnell', prompt, width: 1024, height: 1024, steps: 4, n: 1, response_format: 'b64_json' }) });
        if (!r.ok) return res.status(503).json({ error: 'Generare eșuată' });
        const d = await r.json(); const b64 = d.data?.[0]?.b64_json;
        if (!b64) return res.status(500).json({ error: 'No data' });
        incrementUsage(user?.id, 'image', supabaseAdmin).catch(()=>{});
        res.json({ image: 'data:image/png;base64,' + b64, prompt, engine: 'FLUX' });
    } catch(e) { res.status(500).json({ error: 'Eroare imagine' }); }
});

// ═══ MEMORY ═══
app.post('/api/memory', memoryLimiter, validate(memorySchema), async (req, res) => {
    try {
        const { action, key, value } = req.body;
        const user = await getUserFromToken(req); const uid = user?.id || 'guest';
        if (supabaseAdmin && user) {
            if (action === 'save') { await supabaseAdmin.from('user_preferences').upsert({ user_id: user.id, key, value: typeof value === 'object' ? value : { data: value } }, { onConflict: 'user_id,key' }); return res.json({ success: true }); }
            if (action === 'load') { const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', key).single(); return res.json({ value: data?.value || null }); }
            if (action === 'list') { const { data } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id); return res.json({ keys: (data||[]).map(d=>d.key), items: data||[] }); }
        }
        if (!memFallback[uid]) memFallback[uid] = {};
        if (action === 'save') { memFallback[uid][key] = value; res.json({ success: true }); }
        else if (action === 'load') res.json({ value: memFallback[uid][key] || null });
        else if (action === 'list') res.json({ keys: Object.keys(memFallback[uid]) });
        else res.status(400).json({ error: 'Acțiune: save, load, list' });
    } catch(e) { res.status(500).json({ error: 'Eroare memorie' }); }
});

// ═══ SOS ENDPOINTS ═══
app.post('/api/sos/alert', sosLimiter, asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    const { location, timestamp } = req.body;
    logger.error({ component: 'SOS', userId: user?.id, location, timestamp }, '🆘 EMERGENCY ALERT TRIGGERED');
    if (user && supabaseAdmin) {
        await supabaseAdmin.from('user_preferences').upsert({
            user_id: user.id, key: 'last_sos_alert',
            value: { location, timestamp, resolved: false }
        }, { onConflict: 'user_id,key' }).catch(() => {});
    }
    res.json({ received: true, message: 'Emergency services: call 112 immediately if in danger' });
}));

app.post('/api/sos/cancel', sosLimiter, asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    if (user && supabaseAdmin) {
        await supabaseAdmin.from('user_preferences').upsert({
            user_id: user.id, key: 'last_sos_alert',
            value: { resolved: true, resolvedAt: new Date().toISOString() }
        }, { onConflict: 'user_id,key' }).catch(() => {});
    }
    res.json({ cancelled: true });
}));

app.get('/api/sos/contact', asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    if (!user || !supabaseAdmin) return res.json({ contact: null });
    const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', 'emergency_contact').single();
    res.json({ contact: data?.value || null });
}));

// ═══ CONVERSATIONS ═══
app.get('/api/conversations', asyncHandler(async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ conversations: [] });
    const { data } = await supabaseAdmin.from('conversations').select('id, avatar, title, created_at, updated_at').eq('user_id', u.id).order('updated_at', { ascending: false }).limit(50);
    res.json({ conversations: data || [] });
}));
app.get('/api/conversations/:id/messages', asyncHandler(async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ messages: [] });
    // Verify the conversation belongs to this user
    const { data: conv, error: convErr } = await supabaseAdmin.from('conversations').select('id').eq('id', req.params.id).eq('user_id', u.id).single();
    if (convErr && convErr.code !== 'PGRST116') return res.status(500).json({ error: 'Eroare server' });
    if (!conv) return res.status(403).json({ error: 'Access interzis' });
    const { data } = await supabaseAdmin.from('messages').select('id, role, content, created_at').eq('conversation_id', req.params.id).order('created_at', { ascending: true });
    res.json({ messages: data || [] });
}));

// ═══ BRAIN DIAGNOSTICS ═══
app.get('/api/brain', adminAuth, (req, res) => {
    res.json(brain.getDiagnostics());
});
app.post('/api/brain/reset', adminAuth, (req, res) => {
    const { tool } = req.body;
    if (tool) brain.resetTool(tool);
    else brain.resetAll();
    res.json({ success: true, diagnostics: brain.getDiagnostics() });
});

// ═══ BRAIN DASHBOARD (live monitoring) ═══
app.get('/dashboard', adminAuth, (req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>KelionAI Brain Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui,sans-serif;padding:20px}
h1{color:#00ffff;margin-bottom:20px;font-size:1.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px}
.card h2{color:#888;font-size:0.85rem;text-transform:uppercase;margin-bottom:12px;letter-spacing:1px}
.stat{font-size:2rem;font-weight:bold;color:#00ffff}
.stat.warn{color:#ffaa00}
.stat.bad{color:#ff4444}
.stat.good{color:#00ff88}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.row:last-child{border:none}
.label{color:#888}
.val{font-weight:bold}
.bar{height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin-top:4px}
.bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#00ffff,#00ff88)}
.journal{font-size:0.8rem;color:#aaa;margin-top:8px}
.journal-entry{padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03)}
.refresh{position:fixed;top:15px;right:15px;background:#00ffff;color:#000;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold}
</style></head>
<body>
<h1>\u{1F9E0} KelionAI Brain Dashboard</h1>
<button class="refresh" onclick="load()">Refresh</button>
<div class="grid" id="grid"></div>
<script>
async function load(){
  try{
    const r=await fetch('/api/brain');
    const d=await r.json();
    const g=document.getElementById('grid');
    const statusClass=d.status==='healthy'?'good':d.status==='degraded'?'bad':'warn';
    g.innerHTML=\`
    <div class="card"><h2>Status</h2><div class="stat \${statusClass}">\${d.status.toUpperCase()}</div>
    <div class="row"><span class="label">Version</span><span class="val">\${d.version}</span></div>
    <div class="row"><span class="label">Uptime</span><span class="val">\${Math.round(d.uptime/60)}m</span></div>
    <div class="row"><span class="label">Memory</span><span class="val">\${d.memory.rss} / \${d.memory.heap}</span></div></div>
    
    <div class="card"><h2>Conversations</h2><div class="stat">\${d.conversations}</div>
    <div class="row"><span class="label">Learnings</span><span class="val">\${d.learningsExtracted}</span></div>
    <div class="row"><span class="label">Errors (1h)</span><span class="val \${d.recentErrors>5?'bad':''}">\${d.recentErrors}</span></div></div>
    
    <div class="card"><h2>Tool Usage</h2>
    \${Object.entries(d.toolStats).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}</span></div>\`).join('')}</div>
    
    <div class="card"><h2>Tool Health</h2>
    \${Object.entries(d.toolErrors).map(([k,v])=>{
      const cls=v>=5?'bad':v>0?'warn':'good';
      return \`<div class="row"><span class="label">\${k}</span><span class="val \${cls}">\${v>=5?'DEGRADED':v>0?v+' errors':'OK'}</span></div>\`;
    }).join('')}</div>
    
    <div class="card"><h2>Latency (avg)</h2>
    \${Object.entries(d.avgLatency).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}ms</span>
    <div class="bar"><div class="bar-fill" style="width:\${Math.min(100,v/100*100)}%"></div></div></div>\`).join('')||'<div style="color:#888">No data yet</div>'}</div>
    
    <div class="card"><h2>Strategies</h2>
    <div class="row"><span class="label">Search refinements</span><span class="val">\${d.strategies.searchRefinements}</span></div>
    <div class="row"><span class="label">Failure recoveries</span><span class="val">\${d.strategies.failureRecoveries}</span></div>
    \${Object.entries(d.strategies.toolCombinations).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}</span></div>\`).join('')}</div>
    
    <div class="card" style="grid-column:1/-1"><h2>Journal (last 10)</h2>
    <div class="journal">\${(d.journal||[]).map(j=>\`<div class="journal-entry">\${new Date(j.time).toLocaleTimeString()} — <strong>\${j.event}</strong>: \${j.lesson}</div>\`).join('')||'Empty'}</div></div>
    \`;
  }catch(e){document.getElementById('grid').innerHTML='<div class="card"><div class="stat bad">OFFLINE</div></div>';}
}
load();setInterval(load,5000);
</script></body></html>`);
});

// ═══ SHARE HELPERS VIA app.locals (for payments/legal routers) ═══
app.locals.getUserFromToken = getUserFromToken;
app.locals.supabaseAdmin = supabaseAdmin;

// ═══ PAYMENTS & LEGAL ROUTES ═══
app.use('/api/payments', paymentsRouter);
app.use('/api/legal', legalRouter);

// ═══ HEALTH ═══
app.get('/api/health', (req, res) => {
    const diag = brain.getDiagnostics();
    res.json({
        status: 'online', version: '2.3.0', timestamp: new Date().toISOString(),
        brain: diag.status,
        conversations: diag.conversations,
        services: {
            ai_claude: !!process.env.ANTHROPIC_API_KEY, ai_gpt4o: !!process.env.OPENAI_API_KEY,
            ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
            tts: !!process.env.ELEVENLABS_API_KEY, stt: true, vision: !!process.env.ANTHROPIC_API_KEY,
            search_perplexity: !!process.env.PERPLEXITY_API_KEY, search_tavily: !!process.env.TAVILY_API_KEY,
            search_serper: !!process.env.SERPER_API_KEY, search_ddg: true, weather: true,
            images: !!process.env.TOGETHER_API_KEY,
            payments: !!process.env.STRIPE_SECRET_KEY,
            auth: !!supabase, database: !!supabaseAdmin
        }
    });
});

// Inject Sentry DSN as a meta tag when SENTRY_DSN is configured (optional)
const _rawHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const _indexHtml = process.env.SENTRY_DSN
    ? _rawHtml.replace(
        '<meta name="sentry-dsn" content="">',
        `<meta name="sentry-dsn" content="${process.env.SENTRY_DSN.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
    )
    : _rawHtml;

// 404 for unknown API routes — must come before the catch-all
app.use('/api', (req, res, next) => {
    res.status(404).json({ error: 'API endpoint negăsit' });
});

app.get('*', (req, res) => res.type('html').send(_indexHtml));

// Sentry error handler must be registered after all routes
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// ═══ GLOBAL ERROR HANDLER ═══
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    if (process.env.NODE_ENV === 'production') {
        logger.error({ component: 'Error', method: req.method, path: req.path }, err.message);
        return res.status(statusCode).json({
            error: statusCode === 500 ? 'Eroare internă de server' : err.message
        });
    }
    logger.error({ component: 'Error', method: req.method, path: req.path, err: err.stack }, err.message);
    res.status(statusCode).json({
        error: err.message,
        stack: err.stack,
        details: err.details || undefined
    });
});

// ═══ STARTUP ═══
if (require.main === module) {
    process.on('uncaughtException', (err) => {
        logger.fatal({ component: 'Process', err: err.stack }, 'Uncaught Exception: ' + err.message);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        logger.fatal({ component: 'Process', reason: String(reason) }, 'Unhandled Rejection: ' + reason);
        process.exit(1);
    });

    runMigration().then(migrated => {
        app.listen(PORT, '0.0.0.0', () => {
            logger.info({ component: 'Server', port: PORT, ai: { claude: !!process.env.ANTHROPIC_API_KEY, gpt4o: !!process.env.OPENAI_API_KEY, deepseek: !!process.env.DEEPSEEK_API_KEY }, tts: !!process.env.ELEVENLABS_API_KEY, payments: !!process.env.STRIPE_SECRET_KEY, db: !!supabaseAdmin, migration: !!migrated }, 'KelionAI v2.3 started on port ' + PORT);
        });
    }).catch(e => {
        logger.error({ component: 'Server' }, 'Migration error');
        app.listen(PORT, '0.0.0.0', () => logger.info({ component: 'Server', port: PORT }, 'KelionAI v2.3 on port ' + PORT + ' (migration failed)'));
    });
}

module.exports = app;
