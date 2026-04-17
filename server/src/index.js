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
const { checkSubscription, getPlans, SUBSCRIPTION_PLANS } = require('./middleware/subscription');
const { initDb } = require('./db');
const {
  createReferralCode, findReferralCode, useReferralCode,
  findById, updateSubscription, updateStripeCustomerId,
  findByStripeCustomerId, getUsageToday,
} = require('./db');
const authRouter       = require('./routes/auth');
const usersRouter      = require('./routes/users');
const adminRouter      = require('./routes/admin');
const chatRouter       = require('./routes/chat');
const ttsRouter        = require('./routes/tts');
const realtimeRouter   = require('./routes/realtime');

// Lazy-loaded Stripe client. Returns null when STRIPE_SECRET_KEY is absent
// so the app still boots in test / dev environments without payment keys.
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = require('stripe');
  _stripe = new Stripe(key);
  return _stripe;
}

// Trial length cap for the free-trial realtime session. Enforced on our side
// regardless of what the upstream provider returns.
const TRIAL_MAX_MS = 15 * 60 * 1000;

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
        connectSrc: ["'self'", "https://api.openai.com", "wss://api.openai.com", "https://raw.githack.com", "https://*.githubusercontent.com", "blob:", "https:", "wss:"],
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

// Stripe webhook must receive the raw request body for signature verification,
// so it is mounted BEFORE express.json() and uses express.raw() for itself.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !whSecret) {
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], whSecret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = Number(session.metadata?.userId);
        const planId = session.metadata?.planId;
        if (userId && planId && SUBSCRIPTION_PLANS[planId]) {
          await updateSubscription(userId, {
            subscription_tier: planId,
            subscription_status: 'active',
          });
          if (session.customer) {
            await updateStripeCustomerId(userId, session.customer);
          }
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const user = await findByStripeCustomerId(sub.customer);
        if (user) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          await updateSubscription(user.id, {
            subscription_status: active ? 'active' : sub.status,
            subscription_tier:   active ? user.subscription_tier : 'free',
          });
        }
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed', detail: err.message });
  }
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

// Payment routes (auth required).
// Uses Stripe Checkout with inline price_data — no pre-created Price IDs required.
app.post('/api/payments/create-checkout-session', requireAuth, async (req, res) => {
  const { planId, successUrl, cancelUrl } = req.body || {};
  const plan = SUBSCRIPTION_PLANS[planId];

  if (!plan) {
    return res.status(400).json({ error: 'Invalid plan ID' });
  }
  if (planId === 'free') {
    return res.status(400).json({ error: 'Cannot create checkout for free plan' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  try {
    const user = await findById(req.user.id);
    const base = `${req.protocol}://${req.get('host')}`;
    const success = successUrl || `${base}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel  = cancelUrl  || `${base}/pricing?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: user?.stripe_customer_id || undefined,
      customer_email: user?.stripe_customer_id ? undefined : (user?.email || req.user.email),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
          product_data: {
            name: `Kelion ${plan.name}`,
            description: plan.features.join(' • '),
          },
          unit_amount: Math.round(plan.price * 100),
          recurring: { interval: plan.interval || 'month' },
        },
      }],
      success_url: success,
      cancel_url: cancel,
      metadata: {
        userId: String(req.user.id),
        planId,
      },
      subscription_data: {
        metadata: {
          userId: String(req.user.id),
          planId,
        },
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('[stripe] checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
});

app.get('/api/payments/history', requireAuth, (req, res) => {
  res.json({ payments: [] });
});

// Current subscription snapshot for the authenticated user.
app.get('/api/subscription/status', requireAuth, async (req, res) => {
  try {
    const user = await findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const tier = user.subscription_tier || 'free';
    const plan = SUBSCRIPTION_PLANS[tier] || SUBSCRIPTION_PLANS.free;
    const usageToday = await getUsageToday(req.user.id);
    res.json({
      tier,
      status: user.subscription_status || 'active',
      plan: { id: plan.id, name: plan.name, price: plan.price, interval: plan.interval },
      usage: { today: usageToday, dailyLimit: plan.dailyLimit },
      stripeCustomerId: user.stripe_customer_id || null,
    });
  } catch (err) {
    console.error('[subscription/status] error:', err.message);
    res.status(500).json({ error: 'Failed to load subscription status' });
  }
});

// Available avatars. Static list for now; kept as an endpoint so the client
// can discover voices/models without hard-coding them.
app.get('/api/avatars', (req, res) => {
  res.json({
    avatars: [
      {
        id: 'kelion',
        name: 'Kelion',
        gender: 'male',
        description: 'Calm, professional male voice assistant.',
        model: '/models/kelion.glb',
        voice: process.env.OPENAI_VOICE_KELION || 'ash',
        geminiVoice: process.env.GEMINI_LIVE_VOICE_KELION || 'Kore',
      },
    ],
  });
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
    if (!r.ok) {
      const body = await r.text();
      console.error('[trial-token] upstream error:', r.status, body);
      return res.status(500).json({ error: 'Failed to create session', upstream_status: r.status, detail: body.slice(0, 500) });
    }
    const data = await r.json();
    trialTokens.set(ip, now);
    // Cap the returned expiresAt at TRIAL_MAX_MS from now on our side, so the
    // advertised trial length is honoured regardless of upstream defaults.
    const upstreamExpiresAt = data.client_secret?.expires_at;
    const capExpiresAt = Math.floor((now + TRIAL_MAX_MS) / 1000);
    const expiresAt = upstreamExpiresAt && upstreamExpiresAt < capExpiresAt ? upstreamExpiresAt : capExpiresAt;
    res.json({ token: data.client_secret.value, expiresAt, trial: true, voice });
  } catch (err) {
    console.error('[trial-token] Error:', err.message);
    res.status(500).json({ error: 'Failed to create session', detail: err.message });
  }
});

// API routes (auth required)
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/admin', requireAuth, adminRouter);
app.use('/api/chat', requireAuth, chatLimiter, checkSubscription(), chatRouter);
app.use('/api/tts', requireAuth, chatLimiter, checkSubscription(), ttsRouter);
app.use('/api/realtime', requireAuth, chatLimiter, realtimeRouter);

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

