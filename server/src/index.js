'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { csrfSeed } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');
const { checkSubscription, getPlans } = require('./middleware/subscription');
const { initDb } = require('./db');
const { createReferralCode, findReferralCode, useReferralCode } = require('./db');
const authRouter       = require('./routes/auth');
const usersRouter      = require('./routes/users');
const adminRouter      = require('./routes/admin');
const chatRouter       = require('./routes/chat');
const ttsRouter        = require('./routes/tts');
const realtimeRouter   = require('./routes/realtime');
const passkeyRouter    = require('./routes/passkey');
const memoryRouter     = require('./routes/memory');
const toolsRouter      = require('./routes/tools');
const pushRouter       = require('./routes/push');
const proactive        = require('./services/proactive');

const app = express();
app.disable('x-powered-by');

// Initialize database
initDb().then(() => {
  console.log('[kelion-startup] Database initialized');
}).catch(err => {
  console.error('[kelion-startup] Database initialization failed:', err.message);
});

// Validate required API keys in production
if (config.isProduction) {
  const requiredKeys = ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY'];
  const missing = requiredKeys.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`[kelion-startup] WARNING: Missing required API keys: ${missing.join(', ')}`);
    console.warn('[kelion-startup] AI features will not work without these keys');
  }
}

const distPath = path.resolve(__dirname, '../../dist');
const fs = require('fs');
if (fs.existsSync(distPath)) {
  console.log(`[kelion-startup] dist folder FOUND. Files: ${JSON.stringify(fs.readdirSync(distPath))}`);
} else {
  console.warn(`[kelion-startup] dist folder not found at: ${distPath} (expected in production)`);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "blob:"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com", "wss://api.openai.com", "https://generativelanguage.googleapis.com", "wss://generativelanguage.googleapis.com", "https://raw.githack.com", "https://*.githubusercontent.com", "blob:", "https:", "wss:"],
        mediaSrc:   ["'self'", "blob:"],
        workerSrc:  ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

app.set('trust proxy', 1);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })
);

const chatLimiter = (process.env.NODE_ENV === 'test') ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for AI services. Please wait a moment.' },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrfSeed);

// Auth routes (no auth required)
app.use('/auth', authRouter);

// Subscription plans (no auth required)
app.get('/api/subscription/plans', (req, res) => {
  res.json({ plans: getPlans() });
});

// Payment routes (auth required)
app.post('/api/payments/create-checkout-session', requireAuth, (req, res) => {
  const { planId } = req.body || {};
  const plans = getPlans();
  const plan = plans.find(p => p.id === planId);

  if (!plan) {
    return res.status(400).json({ error: 'Invalid plan ID' });
  }
  if (planId === 'free') {
    return res.status(400).json({ error: 'Cannot create checkout for free plan' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }
  res.json({ sessionId: 'mock-session-id', url: 'https://checkout.stripe.com/mock' });
});

app.get('/api/payments/history', requireAuth, (req, res) => {
  res.json({ payments: [] });
});

// Referral routes (auth required)
app.post('/api/referral/generate', requireAuth, async (req, res) => {
  try {
    const ref = await createReferralCode(req.user.id);
    res.json({ code: ref.code, expires_at: ref.expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate referral code' });
  }
});

app.get('/api/referral/validate/:code', requireAuth, async (req, res) => {
  try {
    const ref = await findReferralCode(req.params.code);
    if (!ref) {
      return res.status(404).json({ error: 'Referral code not found' });
    }
    res.json({ valid: true, code: ref.code });
  } catch (err) {
    res.status(500).json({ error: 'Failed to validate referral code' });
  }
});

app.post('/api/referral/use', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: 'Referral code is required' });
    }
    const ref = await findReferralCode(code);
    if (!ref) {
      return res.status(404).json({ error: 'Referral code not found' });
    }
    if (ref.owner_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot use your own referral code' });
    }
    if (ref.used) {
      return res.status(400).json({ error: 'Referral code already used' });
    }
    await useReferralCode(code, req.user.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message && (err.message.includes('own referral') || err.message.includes('already used'))) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to use referral code' });
  }
});

// Free trial token (no auth, rate limited per IP - 1 per day)
const trialTokens = new Map(); // ip -> timestamp
app.get('/api/realtime/trial-token', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const last = trialTokens.get(ip);
  if (last && (now - last) < 24 * 60 * 60 * 1000) {
    return res.status(429).json({ error: 'Free trial: one session per day' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Not configured' });

  try {
    const voice = process.env.OPENAI_VOICE_KELION || 'ash';
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice,
      }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to create session' });
    const data = await r.json();
    trialTokens.set(ip, now);
    res.json({ token: data.client_secret.value, expiresAt: data.client_secret.expires_at, trial: true, voice });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// API routes (auth required)
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/admin', requireAuth, adminRouter);
app.use('/api/chat', requireAuth, chatLimiter, checkSubscription(), chatRouter);
app.use('/api/tts', requireAuth, chatLimiter, checkSubscription(), ttsRouter);
// Realtime router is PUBLIC in Stage 1 (no login/users/subs per product spec).
// Rate limiting still applies to prevent abuse. Ephemeral-token endpoints only
// hand back short-lived tokens; persona + config are baked in server-side.
app.use('/api/realtime', chatLimiter, realtimeRouter);

// Stage 3 — M13 passkey (public — register/auth flows need to be reachable
// without auth) + M14/M16/M17 memory (signed-in users only).
app.use('/api/auth/passkey', passkeyRouter);
app.use('/api/memory', requireAuth, memoryRouter);

// Stage 4 — M19 (browser use) + M20 (web search status) + M21 (MCP stubs).
// Router is PUBLIC by design: Gemini Live tool-call flow has no login gate,
// and MCP endpoints self-check for a signed-in user inside the handler.
app.use('/api/tools', chatLimiter, toolsRouter);

// Stage 5 — M23 push + M24/M25 proactive scheduler. Requires passkey auth,
// except /public-key which the browser needs to fetch BEFORE authenticating.
app.get('/api/push/public-key', (_req, res) => {
  res.json({ publicKey: pushRouter.getVapidPublicKey() });
});
app.use('/api/push', requireAuth, pushRouter);

if (process.env.NODE_ENV !== 'test' && process.env.PROACTIVE_DISABLED !== '1') {
  try { proactive.start(require('./routes/push').getWebPush()); }
  catch (err) { console.warn('[proactive] failed to start:', err.message); }
}

// Health check with service status
app.get('/health', async (_req, res) => {
  const health = {
    status: 'ok',
    ts: new Date().toISOString(),
    services: {
      database: 'unknown',
      ai: 'unknown',
      ai_provider: 'none',
      openai: 'unknown',
      gemini: 'unknown',
      elevenlabs: 'unknown',
    },
  };

  // Check database
  try {
    const { getDb } = require('./db');
    const db = getDb();
    if (db) {
      await db.get('SELECT 1');
      health.services.database = 'connected';
    } else {
      health.services.database = 'disconnected';
    }
  } catch {
    health.services.database = 'error';
  }

  // AI providers — Gemini preferred, OpenAI fallback
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  health.services.gemini = hasGemini ? 'configured' : 'not configured';
  health.services.openai = hasOpenAI ? 'configured' : 'not configured';
  health.services.ai = (hasGemini || hasOpenAI) ? 'configured' : 'not configured';
  health.services.ai_provider = hasGemini ? 'gemini' : (hasOpenAI ? 'openai' : 'none');

  // ElevenLabs (legacy TTS fallback)
  health.services.elevenlabs = process.env.ELEVENLABS_API_KEY ? 'configured' : 'not configured';

  res.json(health);
});
app.get('/ping',   (_req, res) => res.send('<h1>PONG - Server is alive and reached!</h1>'));

if (process.env.NODE_ENV === 'production') {
  console.log(`[kelion-api] Production mode: serving from ${distPath}`);
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (/^\/(api)(\/|$)/.test(req.path) || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  const PORT = config.port;
  app.listen(PORT, () => {
    console.log(`[kelion-api] Server listening on port ${PORT} (${config.nodeEnv})`);
    console.log(`[kelion-api] CORS origins: ${config.corsOrigins.join(', ')}`);
  });
}

module.exports = app;

