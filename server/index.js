// ═══════════════════════════════════════════════════════════════
// KelionAI v2.2 — BRAIN-POWERED SERVER
// Autonomous thinking, self-repair, auto-learning
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();

// Verificare Node.js versiune — fetch nativ disponibil din Node 18+
if (!globalThis.fetch) {
    throw new Error('Node.js 18+ required for native fetch. Current: ' + process.version);
}
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0, integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()]
    });
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { supabase, supabaseAdmin } = require('./supabase');
const { runMigration } = require('./migrate');
const { KelionBrain } = require('./brain');
const { buildSystemPrompt } = require('./persona');

const logger = require('./logger');
const { router: paymentsRouter, checkUsage, incrementUsage } = require('./payments');
const legalRouter = require('./legal');
const { router: messengerRouter, getStats: getMessengerStats } = require('./messenger');
const { router: telegramRouter, broadcastNews } = require('./telegram');
const fbPage = require('./facebook-page');
const instagram = require('./instagram');
const developerRouter = require('./routes/developer');
const { validate, registerSchema, loginSchema, refreshSchema, chatSchema, speakSchema, listenSchema, visionSchema, searchSchema, weatherSchema, imagineSchema, memorySchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, changeEmailSchema } = require('./validation');

const app = express();
app.set('trust proxy', 1);

// ═══ HTTPS FORCE REDIRECT ═══
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
});

// ═══ CSP NONCE MIDDLEWARE — generează nonce unic per request ═══
app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use((req, res, next) => {
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    (req, res) => `'nonce-${res.locals.cspNonce}'`,
                    // CDN-uri necesare cu versiuni pinned
                    "https://cdn.jsdelivr.net",
                    "https://browser.sentry-cdn.com",
                ],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: [
                    "'self'",
                    "blob:",
                    "https://api.openai.com",
                    "https://generativelanguage.googleapis.com",
                    "https://api.anthropic.com",
                    "https://api.elevenlabs.io",
                    "https://api.groq.com",
                    "https://api.perplexity.ai",
                    "https://api.tavily.com",
                    "https://google.serper.dev",
                    "https://api.duckduckgo.com",
                    "https://api.together.xyz",
                    "https://api.deepseek.com",
                    "https://geocoding-api.open-meteo.com",
                    "https://api.open-meteo.com",
                ],
                mediaSrc: ["'self'", "blob:"],
                workerSrc: ["'self'", "blob:"],
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    })(req, res, next);
});

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
// Messenger webhook needs raw body for HMAC-SHA256 validation
app.use('/api/messenger/webhook', express.raw({ type: 'application/json' }));
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
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Too many requests. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });
const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many TTS requests. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Please wait 15 minutes.' } });
const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'Too many searches. Please wait a minute.' } });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many image requests. Please wait a minute.' } });

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many API requests. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const memoryLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many memory requests.' }, standardHeaders: true, legacyHeaders: false });
const weatherLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many weather requests.' }, standardHeaders: true, legacyHeaders: false });

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// ═══ ADMIN AUTH MIDDLEWARE ═══
function adminAuth(req, res, next) {
    const secret = req.headers['x-admin-secret'];
    const expected = process.env.ADMIN_SECRET_KEY;
    if (!secret || !expected) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const secretBuf = Buffer.from(secret);
        const expectedBuf = Buffer.from(expected);
        if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    } catch (e) {
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
// Read index.html once at startup, injecting Sentry DSN if configured
const _rawHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const _indexHtml = process.env.SENTRY_DSN
    ? _rawHtml.replace(
        '<meta name="sentry-dsn" content="">',
        `<meta name="sentry-dsn" content="${process.env.SENTRY_DSN.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
    )
    : _rawHtml;

// Serve main app with CSP nonce injection (express.static skips index.html for /)
app.get('/', (req, res) => {
    const nonce = res.locals.cspNonce || '';
    const html = _indexHtml.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Read onboarding.html once at startup
const _rawOnboarding = fs.existsSync(path.join(__dirname, '..', 'app', 'onboarding.html'))
    ? fs.readFileSync(path.join(__dirname, '..', 'app', 'onboarding.html'), 'utf8')
    : null;

// Read reset-password.html once at startup
const _rawResetPassword = fs.existsSync(path.join(__dirname, '..', 'app', 'reset-password.html'))
    ? fs.readFileSync(path.join(__dirname, '..', 'app', 'reset-password.html'), 'utf8')
    : null;

// Serve onboarding with CSP nonce injection
app.get('/onboarding.html', (req, res) => {
    if (!_rawOnboarding) return res.redirect('/');
    const nonce = res.locals.cspNonce || '';
    const html = _rawOnboarding.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Serve reset-password with CSP nonce injection
app.get('/reset-password.html', (req, res) => {
    if (!_rawResetPassword) return res.redirect('/');
    const nonce = res.locals.cspNonce || '';
    const html = _rawResetPassword.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, '..', 'app')));
app.use('/api', globalLimiter);
const PORT = process.env.PORT || 3000;
const memFallback = Object.create(null);

// Cleanup memFallback every hour to prevent memory leaks
setInterval(() => {
    const keys = Object.keys(memFallback);
    if (keys.length > 1000) {
        // Keep only the most recent 500 entries
        const toDelete = keys.slice(0, keys.length - 500);
        for (const k of toDelete) delete memFallback[k];
        logger.info({ component: 'Memory', removed: toDelete.length, remaining: 500 }, 'memFallback cleanup');
    }
}, 60 * 60 * 1000);

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
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || email.split('@')[0] } } });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, message: 'Please check your email to verify your account before signing in.' });
    } catch (e) { res.status(500).json({ error: 'Registration error' }); }
});

app.post('/api/auth/login', authLimiter, validate(loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.status(401).json({ error: error.message });
        if (!data.user.email_confirmed_at) {
            return res.status(403).json({ error: 'Email not verified. Please check your inbox and verify your email before signing in.' });
        }
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Login error' }); }
});

app.post('/api/auth/logout', async (req, res) => { try { if (supabase) await supabase.auth.signOut(); } catch (e) { } res.json({ success: true }); });
app.get('/api/auth/me', asyncHandler(async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: { id: u.id, email: u.email, name: u.user_metadata?.full_name } });
}));
app.post('/api/auth/refresh', validate(refreshSchema), async (req, res) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token || !supabase) return res.status(400).json({ error: 'Token missing' });
        const { data, error } = await supabase.auth.refreshSession({ refresh_token });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Refresh error' }); }
});

app.post('/api/auth/forgot-password', authLimiter, validate(forgotPasswordSchema), async (req, res) => {
    try {
        const { email } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const redirectTo = (process.env.APP_URL || 'https://kelionai.app') + '/reset-password.html';
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    } catch (e) { res.status(500).json({ error: 'Password reset error' }); }
});

app.post('/api/auth/reset-password', authLimiter, validate(resetPasswordSchema), async (req, res) => {
    try {
        const { access_token, password } = req.body;
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token: access_token });
        if (sessionError) return res.status(401).json({ error: 'Invalid or expired reset token' });
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'Password updated successfully.' });
    } catch (e) { res.status(500).json({ error: 'Password reset error' }); }
});

app.post('/api/auth/change-password', authLimiter, validate(changePasswordSchema), async (req, res) => {
    try {
        const u = await getUserFromToken(req);
        if (!u) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { password } = req.body;
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'Password updated successfully.' });
    } catch (e) { res.status(500).json({ error: 'Change password error' }); }
});

app.post('/api/auth/change-email', authLimiter, validate(changeEmailSchema), async (req, res) => {
    try {
        const u = await getUserFromToken(req);
        if (!u) return res.status(401).json({ error: 'Not authenticated' });
        if (!supabase) return res.status(503).json({ error: 'Auth service unavailable' });
        const { email } = req.body;
        const { error } = await supabase.auth.updateUser({ email });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ message: 'A confirmation email has been sent to the new address.' });
    } catch (e) { res.status(500).json({ error: 'Change email error' }); }
});

// ═══════════════════════════════════════════════════════════════
// CHAT — BRAIN-POWERED (the core)
// Brain decides tools → executes in parallel → builds deep prompt → AI responds → learns
// ═══════════════════════════════════════════════════════════════
app.post('/api/chat', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        const user = await getUserFromToken(req);

        // ── Usage check ──
        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Chat limit reached. Upgrade to Pro for more messages.', plan: usage.plan, limit: usage.limit, upgrade: true });

        // ── BRAIN v2 THINKS: analyze → decompose → plan → execute → CoT ──
        const thought = await brain.think(message, avatar, history, language, user?.id, conversationId);

        // ── BUILD DEEP PERSONA PROMPT (with CoT guidance) ──
        let memoryContext = '';
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(30);
                if (prefs?.length > 0) memoryContext = prefs.map(p => `${p.key}: ${JSON.stringify(p.value)}`).join('; ');
            } catch (e) { }
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

        if (!reply) return res.status(503).json({ error: 'AI indisponibil' });

        // ── Save conversation (sync to get ID) + Learn async ──
        let savedConvId = conversationId;
        if (supabaseAdmin) {
            try { savedConvId = await saveConv(user?.id, avatar, message, reply, conversationId, language); } catch (e) { logger.warn({ component: 'Chat', err: e.message }, 'saveConv'); }
        }
        brain.learnFromConversation(user?.id, message, reply).catch(() => { });
        incrementUsage(user?.id, 'chat', supabaseAdmin).catch(() => { });

        logger.info({ component: 'Chat', engine, avatar, language, tools: thought.toolsUsed, chainOfThought: !!thought.chainOfThought, thinkTime: thought.thinkTime, replyLength: reply.length }, `${engine} | ${avatar} | ${language} | tools:[${thought.toolsUsed.join(',')}] | CoT:${!!thought.chainOfThought} | ${thought.thinkTime}ms think | ${reply.length}c`);

        // ── RESPONSE with monitor content + brain metadata ──
        const response = { reply, avatar, engine, language, thinkTime: thought.thinkTime, conversationId: savedConvId };
        if (thought.monitor.content) {
            response.monitor = thought.monitor;
        }
        res.json(response);

    } catch (e) { logger.error({ component: 'Chat', err: e.message }, e.message); res.status(500).json({ error: 'Eroare AI' }); }
});

// ═══════════════════════════════════════════════════════════════
// CHAT STREAM — Server-Sent Events (word-by-word response)
// ═══════════════════════════════════════════════════════════════
app.post('/api/chat/stream', chatLimiter, validate(chatSchema), async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        const user = await getUserFromToken(req);

        // ── Usage check ──
        const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Chat limit reached. Upgrade to Pro for more messages.', plan: usage.plan, limit: usage.limit, upgrade: true });

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

        // Fallback: non-streaming GPT-4o or DeepSeek (send as single chunk)
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

        // Save conversation (sync to get ID) then end stream
        let savedConvId = conversationId;
        if (fullReply && supabaseAdmin) {
            try { savedConvId = await saveConv(user?.id, avatar, message, fullReply, conversationId, language); } catch (e) { logger.warn({ component: 'Stream', err: e.message }, 'saveConv'); }
        }

        // End stream
        res.write(`data: ${JSON.stringify({ type: 'done', reply: fullReply, thinkTime: thought.thinkTime, conversationId: savedConvId })}\n\n`);
        res.end();

        if (fullReply) brain.learnFromConversation(user?.id, message, fullReply).catch(() => { });
        if (fullReply) incrementUsage(user?.id, 'chat', supabaseAdmin).catch(() => { });
        logger.info({ component: 'Stream', avatar, language, replyLength: fullReply.length }, `${avatar} | ${language} | ${fullReply.length}c`);

    } catch (e) { logger.error({ component: 'Stream', err: e.message }, e.message); if (!res.headersSent) res.status(500).json({ error: 'Eroare stream' }); else res.end(); }
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
app.post('/api/speak', ttsLimiter, validate(speakSchema), async (req, res) => {
    try {
        const { text, avatar = 'kelion', mood = 'neutral' } = req.body;
        if (!text || !process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'tts', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'TTS limit reached. Upgrade to Pro for more.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const voiceSettings = {
            happy: { stability: 0.4, similarity_boost: 0.8, style: 0.7 },
            sad: { stability: 0.7, similarity_boost: 0.9, style: 0.3 },
            laughing: { stability: 0.3, similarity_boost: 0.7, style: 0.9 },
            thinking: { stability: 0.6, similarity_boost: 0.8, style: 0.4 },
            excited: { stability: 0.3, similarity_boost: 0.8, style: 0.8 },
            concerned: { stability: 0.7, similarity_boost: 0.9, style: 0.4 },
            neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.5 }
        };
        const selectedVoiceSettings = voiceSettings[mood] || voiceSettings.neutral;

        const vid = avatar === 'kira'
            ? (process.env.ELEVENLABS_VOICE_KIRA || 'EXAVITQu4vr4xnSDxMaL')
            : (process.env.ELEVENLABS_VOICE_KELION || 'VR6AewLTigWG4xSOukaG');
        const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: selectedVoiceSettings })
        });
        if (!r.ok) return res.status(503).json({ error: 'TTS fail' });
        const buf = Buffer.from(await r.arrayBuffer());
        logger.info({ component: 'Speak', bytes: buf.length, avatar, mood }, buf.length + ' bytes | ' + avatar);
        incrementUsage(user?.id, 'tts', supabaseAdmin).catch(() => { });
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length }); res.send(buf);
    } catch (e) { res.status(500).json({ error: 'TTS error' }); }
});

// ═══ STT — Groq Whisper ═══
app.post('/api/listen', apiLimiter, validate(listenSchema), async (req, res) => {
    try {
        if (req.body.text) return res.json({ text: req.body.text, engine: 'WebSpeech' });
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: 'Audio is required' });
        if (process.env.GROQ_API_KEY) {
            const form = new FormData();
            form.append('file', Buffer.from(audio, 'base64'), { filename: 'a.webm', contentType: 'audio/webm' });
            form.append('model', 'whisper-large-v3');
            const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
            const d = await r.json(); return res.json({ text: d.text || '', engine: 'Groq' });
        }
        res.status(503).json({ error: 'Use Web Speech API' });
    } catch (e) { res.status(500).json({ error: 'STT error' }); }
});

// ═══ VISION — Claude Vision ═══
app.post('/api/vision', apiLimiter, validate(visionSchema), async (req, res) => {
    try {
        const { image, avatar = 'kelion', language = 'ro' } = req.body;
        if (!image || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Vision indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'vision', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Vision limit reached. Upgrade to Pro for more.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const LANGS = { ro: 'română', en: 'English' };
        const prompt = `Ești OCHII unei persoane. Descrie EXACT ce vezi cu PRECIZIE MAXIMĂ.
Persoane: vârstă, sex, haine (culori exacte), expresie, gesturi, ce țin în mâini.
Obiecte: fiecare obiect, culoare, dimensiune, poziție.
Text: citește ORICE text vizibil.
Pericole: obstacole, trepte → "ATENȚIE:"
Răspunde în ${LANGS[language] || 'română'}, concis dar detaliat.`;
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514', max_tokens: 1024,
                messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: prompt }] }]
            })
        });
        const d = await r.json();
        incrementUsage(user?.id, 'vision', supabaseAdmin).catch(() => { });
        res.json({ description: d.content?.[0]?.text || 'Nu am putut analiza.', avatar, engine: 'Claude' });
    } catch (e) { res.status(500).json({ error: 'Vision error' }); }
});

// ═══ SEARCH — Perplexity Sonar → Tavily → Serper → DuckDuckGo ═══
app.post('/api/search', searchLimiter, validate(searchSchema), async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query is required' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'search', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Search limit reached. Upgrade to Pro for more searches.', plan: usage.plan, limit: usage.limit, upgrade: true });

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
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
                    return res.json({ results, answer, engine: 'Perplexity' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Perplexity', err: e.message }, 'Perplexity'); }
        }

        // 2. Tavily (good — aggregated + parsed)
        if (process.env.TAVILY_API_KEY) {
            try {
                const tr = await fetch('https://api.tavily.com/search', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5, include_answer: true })
                });
                if (tr.ok) {
                    const td = await tr.json();
                    logger.info({ component: 'Search', engine: 'Tavily', results: (td.results || []).length }, 'Tavily — ' + (td.results || []).length + ' results');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
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
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
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
        incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
        res.json({ results, answer: d.Abstract || '', engine: 'DuckDuckGo' });
    } catch (e) { res.status(500).json({ error: 'Search error' }); }
});

// ═══ WEATHER — Open-Meteo ═══
app.post('/api/weather', weatherLimiter, validate(weatherSchema), async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'City is required' });
        const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=ro')).json();
        if (!geo.results?.[0]) return res.status(404).json({ error: '"' + city + '" not found' });
        const { latitude, longitude, name, country } = geo.results[0];
        const wx = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto')).json();
        const c = wx.current;
        const codes = { 0: 'Senin ☀️', 1: 'Parțial senin 🌤️', 2: 'Parțial noros ⛅', 3: 'Noros ☁️', 45: 'Ceață 🌫️', 51: 'Burniță 🌦️', 61: 'Ploaie 🌧️', 71: 'Ninsoare 🌨️', 80: 'Averse 🌦️', 95: 'Furtună ⛈️' };
        const cond = codes[c.weather_code] || '?';
        res.json({
            city: name, country, temperature: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, condition: cond,
            description: name + ', ' + country + ': ' + c.temperature_2m + '°C, ' + cond + ', umiditate ' + c.relative_humidity_2m + '%, vânt ' + c.wind_speed_10m + ' km/h'
        });
    } catch (e) { res.status(500).json({ error: 'Weather error' }); }
});

// ═══ IMAGINE — Together FLUX ═══
app.post('/api/imagine', imageLimiter, validate(imagineSchema), async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !process.env.TOGETHER_API_KEY) return res.status(503).json({ error: 'Imagine indisponibil' });

        // ── Usage check ──
        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'image', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Image limit reached. Upgrade to Pro for more images.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const r = await fetch('https://api.together.xyz/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.TOGETHER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'black-forest-labs/FLUX.1-schnell', prompt, width: 1024, height: 1024, steps: 4, n: 1, response_format: 'b64_json' })
        });
        if (!r.ok) return res.status(503).json({ error: 'Image generation failed' });
        const d = await r.json(); const b64 = d.data?.[0]?.b64_json;
        if (!b64) return res.status(500).json({ error: 'No data' });
        incrementUsage(user?.id, 'image', supabaseAdmin).catch(() => { });
        res.json({ image: 'data:image/png;base64,' + b64, prompt, engine: 'FLUX' });
    } catch (e) { res.status(500).json({ error: 'Image error' }); }
});

// ═══ MEMORY ═══
app.post('/api/memory', memoryLimiter, validate(memorySchema), async (req, res) => {
    try {
        const { action, key, value } = req.body;
        const user = await getUserFromToken(req);
        // Sanitize uid to prevent prototype pollution: prefix with 'u:' to ensure it's never a prototype key
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
    if (convErr && convErr.code !== 'PGRST116') return res.status(500).json({ error: 'Server error' });
    if (!conv) return res.status(403).json({ error: 'Access denied' });
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

// ═══ ADMIN HEALTH CHECK ═══
app.get('/api/admin/health-check', adminAuth, asyncHandler(async (req, res) => {
    logger.info({ component: 'Admin' }, '🏥 Health check performed');
    const recommendations = [];

    // a) Server status
    const upSec = process.uptime();
    const d0 = Math.floor(upSec / 86400), h0 = Math.floor((upSec % 86400) / 3600);
    const m0 = Math.floor((upSec % 3600) / 60), s0 = Math.floor(upSec % 60);
    const mem = process.memoryUsage();
    const server = {
        version: '2.3.0',
        uptime: `${d0}d ${h0}h ${m0}m ${s0}s`,
        uptimeSeconds: Math.round(upSec),
        nodeVersion: process.version,
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
        },
        timestamp: new Date().toISOString()
    };

    // b) Service availability
    const services = {
        ai_claude: { label: 'AI Claude', active: !!process.env.ANTHROPIC_API_KEY },
        ai_gpt4o: { label: 'AI GPT-4o', active: !!process.env.OPENAI_API_KEY },
        ai_deepseek: { label: 'AI DeepSeek', active: !!process.env.DEEPSEEK_API_KEY },
        tts_elevenlabs: { label: 'TTS ElevenLabs', active: !!process.env.ELEVENLABS_API_KEY },
        stt_groq: { label: 'STT Groq', active: !!process.env.GROQ_API_KEY },
        search_perplexity: { label: 'Search Perplexity', active: !!process.env.PERPLEXITY_API_KEY },
        search_tavily: { label: 'Search Tavily', active: !!process.env.TAVILY_API_KEY },
        search_serper: { label: 'Search Serper', active: !!process.env.SERPER_API_KEY },
        images_together: { label: 'Image Together', active: !!process.env.TOGETHER_API_KEY },
        payments_stripe: { label: 'Payments Stripe', active: !!process.env.STRIPE_SECRET_KEY },
        stripe_webhook: { label: 'Stripe Webhook', active: !!process.env.STRIPE_WEBHOOK_SECRET },
        monitoring_sentry: { label: 'Error Monitoring Sentry', active: !!process.env.SENTRY_DSN }
    };
    if (!process.env.STRIPE_WEBHOOK_SECRET) recommendations.push('STRIPE_WEBHOOK_SECRET nu e configurat — webhook-urile nu vor fi validate');
    if (!process.env.SENTRY_DSN) recommendations.push('SENTRY_DSN lipsește — erorile nu sunt monitorizate');
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
        recommendations.push('Nicio cheie AI configurată — chat-ul nu va funcționa');
    }

    // c) Database check
    const database = { connected: false, tables: {} };
    if (supabaseAdmin) {
        const tables = ['conversations', 'messages', 'user_preferences', 'subscriptions', 'usage'];
        await Promise.all(tables.map(async (tbl) => {
            try {
                const { count, error } = await supabaseAdmin.from(tbl).select('id', { count: 'exact', head: true });
                database.tables[tbl] = error ? { ok: false, error: error.message } : { ok: true, count };
            } catch (e) { database.tables[tbl] = { ok: false, error: e.message }; }
        }));
        database.connected = Object.values(database.tables).some(t => t.ok);
    } else {
        database.error = 'supabaseAdmin client not initialized';
        recommendations.push('Supabase nu este configurat — baza de date nu funcționează');
    }

    // d) Brain diagnostics
    const brainDiag = brain.getDiagnostics();
    const degradedTools = brainDiag.degradedTools || Object.entries(brainDiag.toolErrors || {}).filter(([, v]) => v >= 5).map(([k]) => k);
    const brainResult = {
        status: brainDiag.status,
        conversations: brainDiag.conversations,
        toolStats: brainDiag.toolStats,
        toolErrors: brainDiag.toolErrors,
        degradedTools,
        recentErrors: brainDiag.recentErrors,
        avgLatency: brainDiag.avgLatency,
        journal: (brainDiag.journal || []).slice(-5)
    };
    if (brainDiag.status === 'degraded') recommendations.push(`Brain engine is degraded — ${degradedTools.join(', ') || 'unele tool-uri'} au erori`);

    // e) Auth system check
    const auth = { supabaseInitialized: !!supabase, supabaseAdminInitialized: !!supabaseAdmin, authAvailable: !!supabase };
    if (!supabase) recommendations.push('Supabase anon client nu e inițializat — autentificarea nu funcționează');

    // f) Payments check
    const paymentsCheck = {
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
        webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        priceProConfigured: !!process.env.STRIPE_PRICE_PRO,
        pricePremiumConfigured: !!process.env.STRIPE_PRICE_PREMIUM,
        activeSubscribers: null
    };
    if (supabaseAdmin && process.env.STRIPE_SECRET_KEY) {
        try {
            const { count } = await supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active');
            paymentsCheck.activeSubscribers = count;
        } catch (e) { paymentsCheck.subscribersError = e.message; }
    }

    // g) Rate limiting status
    const rateLimits = {
        chat: { max: 20, windowMs: 60000, windowLabel: '1min' },
        auth: { max: 10, windowMs: 900000, windowLabel: '15min' },
        search: { max: 15, windowMs: 60000, windowLabel: '1min' },
        image: { max: 5, windowMs: 60000, windowLabel: '1min' },
        memory: { max: 30, windowMs: 60000, windowLabel: '1min' },
        weather: { max: 10, windowMs: 60000, windowLabel: '1min' },
        api: { max: 20, windowMs: 900000, windowLabel: '15min' },
        global: { max: 200, windowMs: 900000, windowLabel: '15min' }
    };

    // h) Security check
    const security = {
        cspEnabled: true,
        httpsRedirect: process.env.NODE_ENV === 'production',
        corsConfigured: true,
        adminSecretConfigured: !!process.env.ADMIN_SECRET_KEY
    };
    if (!process.env.ADMIN_SECRET_KEY) recommendations.push('ADMIN_SECRET_KEY nu e configurat — dashboard-ul admin nu este protejat');

    // i) Error summary
    const errors = { recentCount: brainDiag.recentErrors || 0, degradedTools };

    // j) Overall score
    let score = 0;
    const activeCount = Object.values(services).filter(s => s.active).length;
    score += Math.floor(activeCount / Object.keys(services).length * 20);
    if (database.connected) score += 20;
    if (brainDiag.status === 'healthy') score += 15;
    if ((brainDiag.recentErrors || 0) === 0) score += 10;
    if (security.cspEnabled && security.adminSecretConfigured) score += 15;
    if (services.ai_claude.active || services.ai_gpt4o.active || services.ai_deepseek.active) score += 20;

    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    res.json({ timestamp: new Date().toISOString(), score, grade, server, services, database, brain: brainResult, auth, payments: paymentsCheck, rateLimits, security, errors, recommendations });
}));

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
.btns{position:fixed;top:15px;right:15px;display:flex;gap:8px}
.refresh{background:#00ffff;color:#000;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-btn{background:#1a1a2a;color:#00ffff;border:1px solid #00ffff;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px}
.hc-box{background:#0d0d20;border:1px solid rgba(0,255,255,0.2);border-radius:16px;padding:28px;width:100%;max-width:860px;margin:auto}
.hc-box h2{color:#00ffff;margin-bottom:4px;font-size:1.2rem}
.hc-score{font-size:3rem;font-weight:bold;margin:8px 0}
.hc-grade-A,.hc-grade-B{color:#00ff88}
.hc-grade-C{color:#ffaa00}
.hc-grade-D,.hc-grade-F{color:#ff4444}
.hc-bar-wrap{background:rgba(255,255,255,0.08);border-radius:6px;height:10px;margin-bottom:20px}
.hc-bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#00ffff,#00ff88);transition:width .4s}
.hc-section{margin-top:18px}
.hc-section h3{color:#888;font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:6px}
.hc-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.85rem}
.hc-row:last-child{border:none}
.hc-ok{color:#00ff88}
.hc-err{color:#ff4444}
.hc-warn{color:#ffaa00}
.hc-rec{background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.25);border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#ffcc66;margin-top:6px}
.hc-footer{display:flex;gap:10px;margin-top:24px;justify-content:flex-end}
.hc-close{background:rgba(255,255,255,0.1);color:#e0e0e0;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-export{background:#00ffff;color:#000;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:bold}
</style></head>
<body>
<h1>\u{1F9E0} KelionAI Brain Dashboard</h1>
<div class="btns">
  <button class="hc-btn" onclick="runHealthCheck()">🏥 Health Check</button>
  <button class="refresh" onclick="load()">Refresh</button>
</div>
<div class="grid" id="grid"></div>
<div class="hc-modal" id="hc-modal">
  <div class="hc-box">
    <h2>🏥 Health Check Report</h2>
    <div id="hc-body"></div>
    <div class="hc-footer">
      <button class="hc-export" onclick="exportHC()">Exportă JSON</button>
      <button class="hc-close" onclick="document.getElementById('hc-modal').style.display='none'">Închide</button>
    </div>
  </div>
</div>
<script>
var _adminSecret=sessionStorage.getItem('kelion_admin_secret')||'';
var _hcData=null;
function adminHdrs(){return _adminSecret?{'x-admin-secret':_adminSecret}:{};}
async function load(){
  try{
    const r=await fetch('/api/brain',{headers:adminHdrs()});
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
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ic(ok){return ok?'<span class="hc-ok">✅</span>':'<span class="hc-err">❌</span>';}
function renderHC(d){
  const gc=d.grade==='A'||d.grade==='B'?'hc-grade-A':d.grade==='C'?'hc-grade-C':'hc-grade-D';
  let h='<div class="hc-score '+gc+'">'+d.score+'/100 <small style="font-size:1.2rem">Grade: '+esc(d.grade)+'</small></div>';
  h+='<div class="hc-bar-wrap"><div class="hc-bar-fill" style="width:'+d.score+'%"></div></div>';
  h+='<div class="hc-section"><h3>🖥 Server</h3>';
  h+='<div class="hc-row"><span>Version</span><span>'+esc(d.server.version)+'</span></div>';
  h+='<div class="hc-row"><span>Uptime</span><span>'+esc(d.server.uptime)+'</span></div>';
  h+='<div class="hc-row"><span>Node.js</span><span>'+esc(d.server.nodeVersion)+'</span></div>';
  h+='<div class="hc-row"><span>Memory RSS</span><span>'+esc(d.server.memory.rss)+'</span></div>';
  h+='<div class="hc-row"><span>Heap Used</span><span>'+esc(d.server.memory.heapUsed)+'</span></div></div>';
  h+='<div class="hc-section"><h3>⚙️ Services</h3>';
  for(const[k,s] of Object.entries(d.services)){h+='<div class="hc-row"><span>'+esc(s.label)+'</span><span>'+ic(s.active)+'</span></div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🗄 Database</h3>';
  h+='<div class="hc-row"><span>Connected</span><span>'+ic(d.database.connected)+'</span></div>';
  for(const[t,v] of Object.entries(d.database.tables||{})){h+='<div class="hc-row"><span>'+esc(t)+'</span><span>'+(v.ok?'<span class="hc-ok">✅ '+v.count+' rows</span>':'<span class="hc-err">❌ '+esc(v.error)+'</span>')+'</span></div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🧠 Brain</h3>';
  const bc=d.brain.status==='healthy'?'hc-ok':d.brain.status==='degraded'?'hc-err':'hc-warn';
  h+='<div class="hc-row"><span>Status</span><span class="'+bc+'">'+esc(d.brain.status)+'</span></div>';
  h+='<div class="hc-row"><span>Conversations</span><span>'+d.brain.conversations+'</span></div>';
  h+='<div class="hc-row"><span>Recent Errors</span><span class="'+(d.brain.recentErrors>0?'hc-err':'hc-ok')+'">'+d.brain.recentErrors+'</span></div>';
  if(d.brain.degradedTools&&d.brain.degradedTools.length){h+='<div class="hc-row"><span>Degraded Tools</span><span class="hc-err">'+esc(d.brain.degradedTools.join(', '))+'</span></div>';}
  if(d.brain.journal&&d.brain.journal.length){h+='<div style="margin-top:8px;font-size:0.78rem;color:#888">';for(const j of d.brain.journal){h+='<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">'+new Date(j.time).toLocaleTimeString()+' — <strong>'+esc(j.event)+'</strong>: '+esc(j.lesson)+'</div>';}h+='</div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🔐 Auth & Security</h3>';
  h+='<div class="hc-row"><span>Supabase Auth</span><span>'+ic(d.auth.authAvailable)+'</span></div>';
  h+='<div class="hc-row"><span>CSP Enabled</span><span>'+ic(d.security.cspEnabled)+'</span></div>';
  h+='<div class="hc-row"><span>HTTPS Redirect</span><span>'+ic(d.security.httpsRedirect)+'</span></div>';
  h+='<div class="hc-row"><span>Admin Secret</span><span>'+ic(d.security.adminSecretConfigured)+'</span></div>';
  h+='</div>';
  h+='<div class="hc-section"><h3>💳 Payments</h3>';
  h+='<div class="hc-row"><span>Stripe</span><span>'+ic(d.payments.stripeConfigured)+'</span></div>';
  h+='<div class="hc-row"><span>Webhook</span><span>'+ic(d.payments.webhookConfigured)+'</span></div>';
  if(d.payments.activeSubscribers!==null){h+='<div class="hc-row"><span>Active Subscribers</span><span>'+d.payments.activeSubscribers+'</span></div>';}
  h+='</div>';
  if(d.recommendations&&d.recommendations.length){
    h+='<div class="hc-section"><h3>⚠️ Recomandări</h3>';
    for(const r of d.recommendations){h+='<div class="hc-rec">'+esc(r)+'</div>';}
    h+='</div>';
  }
  return h;
}
async function runHealthCheck(){
  const modal=document.getElementById('hc-modal');
  const body=document.getElementById('hc-body');
  modal.style.display='flex';
  body.innerHTML='<div style="text-align:center;color:#00ffff;padding:40px;font-size:1.1rem">⏳ Se verifică...</div>';
  try{
    const r=await fetch('/api/admin/health-check',{headers:adminHdrs()});
    const d=await r.json();
    if(r.status===401){body.innerHTML='<div style="color:#ff4444;padding:20px">❌ Unauthorized. Setează admin secret în sessionStorage (kelion_admin_secret).</div>';return;}
    _hcData=d;
    body.innerHTML=renderHC(d);
  }catch(e){body.innerHTML='<div style="color:#ff4444;padding:20px">❌ Eroare: '+esc(e.message)+'</div>';}
}
function exportHC(){
  if(!_hcData)return;
  const blob=new Blob([JSON.stringify(_hcData,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='health-check-'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.json';
  a.click();
}
load();setInterval(load,5000);
</script></body></html>`);
});

// ═══ SHARE HELPERS VIA app.locals (for payments/legal/messenger routers) ═══
app.locals.getUserFromToken = getUserFromToken;
app.locals.supabaseAdmin = supabaseAdmin;
app.locals.brain = brain;

// ═══ PAYMENTS, LEGAL, MESSENGER & DEVELOPER ROUTES ═══
app.use('/api/payments', paymentsRouter);
app.use('/api/legal', legalRouter);
app.use('/api/messenger', messengerRouter);
app.use('/api/telegram', express.json(), telegramRouter);
app.use('/api/developer', developerRouter);
app.use('/api', developerRouter); // mounts /api/v1/* endpoints

// ═══ MESSENGER STATS (admin only) ═══
app.get('/api/messenger/stats', adminAuth, (req, res) => {
    res.json(getMessengerStats());
});

// ═══ MEDIA HEALTH ENDPOINTS ═══
app.get('/api/media/facebook/health', (req, res) => {
    res.json(fbPage.getHealth());
});
app.get('/api/media/instagram/health', (req, res) => {
    res.json(instagram.getHealth());
});
app.get('/api/media/status', adminAuth, (req, res) => {
    res.json({
        messenger: { hasToken: !!process.env.FB_PAGE_ACCESS_TOKEN, health: '/api/messenger/health' },
        telegram: { hasToken: !!process.env.TELEGRAM_BOT_TOKEN, health: '/api/telegram/health' },
        facebook: fbPage.getHealth(),
        instagram: instagram.getHealth(),
        news: { scheduler: 'active', hours: [5, 12, 18], endpoint: '/api/news/public' }
    });
});

// ═══ PUBLISH NEWS TO ALL MEDIA (admin trigger) ═══
app.post('/api/media/publish-news', adminAuth, express.json(), asyncHandler(async (req, res) => {
    const articles = req.body.articles || [];
    const results = { facebook: null, telegram: null };
    if (articles.length > 0) {
        results.facebook = await fbPage.publishNewsBatch(articles, req.body.maxPosts || 3);
        await broadcastNews(articles);
        results.telegram = 'broadcasted';
    }
    res.json({ success: true, results });
}));

// ═══ PAYMENTS ADMIN STATS — revenue, active subscribers, churn ═══
app.get('/api/payments/admin/stats', adminAuth, asyncHandler(async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

    const { PLAN_LIMITS } = require('./payments');
    const PLAN_PRICES = { pro: 9.99, enterprise: 29.99, premium: 19.99 };

    // Active subscribers by plan (fetch updated_at for churn calculation)
    const { data: subs } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, current_period_end, updated_at')
        .order('status');

    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const activeSubs = (subs || []).filter(s =>
        s.status === 'active' && s.current_period_end && new Date(s.current_period_end) > now
    );
    const pastDueSubs = (subs || []).filter(s => s.status === 'past_due');
    // Churn: subscriptions cancelled in the last 30 days
    const recentCancelledSubs = (subs || []).filter(s =>
        s.status === 'cancelled' && s.updated_at && new Date(s.updated_at) >= thirtyDaysAgo
    );

    const planCounts = {};
    activeSubs.forEach(s => { planCounts[s.plan] = (planCounts[s.plan] || 0) + 1; });

    const mrr = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan] || 0), 0);

    // Churn rate: recently cancelled / (active + recently cancelled)
    const totalForChurn = activeSubs.length + recentCancelledSubs.length;
    const churnRate = totalForChurn > 0
        ? ((recentCancelledSubs.length / totalForChurn) * 100).toFixed(1)
        : '0.0';

    // Usage stats (today)
    const today = now.toISOString().split('T')[0];
    const { data: usageData } = await supabaseAdmin
        .from('usage')
        .select('type, count')
        .eq('date', today);

    const usageTotals = {};
    (usageData || []).forEach(u => { usageTotals[u.type] = (usageTotals[u.type] || 0) + u.count; });

    res.json({
        activeSubscribers: activeSubs.length,
        cancelledLast30Days: recentCancelledSubs.length,
        pastDueSubscribers: pastDueSubs.length,
        planCounts,
        mrr: Math.round(mrr * 100) / 100,
        churnRate: parseFloat(churnRate),
        usageToday: usageTotals,
        timestamp: now.toISOString()
    });
}));

// POST /api/ticker/disable — save ticker preference (Premium only)
app.post('/api/ticker/disable', asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    if (!user || !supabaseAdmin) return res.status(401).json({ error: 'Auth required' });
    const { data: sub } = await supabaseAdmin.from('subscriptions').select('plan').eq('user_id', user.id).single();
    if (sub?.plan !== 'premium') return res.status(403).json({ error: 'Premium only' });
    await supabaseAdmin.from('user_preferences').upsert({ user_id: user.id, key: 'ticker_disabled', value: req.body.disabled }, { onConflict: 'user_id,key' });
    res.json({ success: true });
}));

// ═══ NEWS BOT ═══
const newsModule = require('./news');
// Public endpoint — no auth required (for frontend news widget)
app.get('/api/news/public', (req, res) => {
    const allReq = Object.assign({}, req, { url: '/latest', query: req.query });
    newsModule.router.handle(allReq, res, () => {
        res.json({ articles: [], total: 0, message: 'No articles cached yet. RSS fetches at 05:00, 12:00, 18:00 RO time.' });
    });
});
app.use('/api/news', adminAuth, newsModule.router);
newsModule.setSupabase(supabaseAdmin);
newsModule.restoreCache();

// ═══ TRADING BOT (admin only) ═══
app.use('/api/trading', adminAuth, require('./trading'));

// ═══ SPORTS BOT (admin only) ═══
app.use('/api/sports', adminAuth, require('./sports'));

// ═══ HEALTH ═══
app.get('/api/health', (req, res) => {
    const diag = brain.getDiagnostics();
    res.json({
        status: 'ok', version: '2.3.0', timestamp: new Date().toISOString(),
        uptime: process.uptime(),
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

// 404 for unknown API routes — must come before the catch-all
app.use('/api', (req, res, next) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.get('*', (req, res) => {
    const nonce = res.locals.cspNonce || '';
    const html = _indexHtml.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Sentry error handler must be registered after all routes
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// ═══ GLOBAL ERROR HANDLER ═══
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    if (process.env.NODE_ENV === 'production') {
        logger.error({ component: 'Error', method: req.method, path: req.path }, err.message);
        return res.status(statusCode).json({
            error: statusCode === 500 ? 'Internal server error' : err.message
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
