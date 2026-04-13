'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const authRouter          = require('./routes/auth');
const localAuthRouter     = require('./routes/localAuth');
const usersRouter         = require('./routes/users');
const adminRouter         = require('./routes/admin');
const subscriptionsRouter = require('./routes/subscriptions');
const paymentsRouter      = require('./routes/payments');
const chatRouter          = require('./routes/chat');
const ttsRouter           = require('./routes/tts');
const referralRouter      = require('./routes/referral');

const app = express();

const distPath = path.resolve(__dirname, '../../dist');
const fs = require('fs');
if (fs.existsSync(distPath)) {
  console.log(`[kelion-startup] dist folder FOUND. Files: ${JSON.stringify(fs.readdirSync(distPath))}`);
} else {
  console.warn(`[kelion-startup] dist folder not found at: ${distPath} (expected in production)`);
}

// ---------------------------------------------------------------------------
// Security headers — CSP configured for the app's needs
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'", "https://js.stripe.com", "blob:"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com", "https://api.stripe.com", "https://raw.githack.com", "https://*.githubusercontent.com", "blob:"],
        frameSrc:   ["https://js.stripe.com"],
        mediaSrc:   ["'self'", "blob:"],
        workerSrc:  ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// ---------------------------------------------------------------------------
// Trust proxy (Railway/Cloudflare sit behind reverse proxies)
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,                   // 15 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 30,                   // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 minute
  max: 20,                   // 20 chat/tts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for AI services. Please wait a moment.' },
});

// ---------------------------------------------------------------------------
// Body parsers
// ---------------------------------------------------------------------------
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Routes (with rate limiting applied per group)
// ---------------------------------------------------------------------------
app.use('/auth',             authLimiter, authRouter);
app.use('/auth/local',       authLimiter, localAuthRouter);
app.use('/api/users',        apiLimiter,  usersRouter);
app.use('/api/admin',        apiLimiter,  adminRouter);
app.use('/api/subscription', apiLimiter,  subscriptionsRouter);
app.use('/api/payments',     apiLimiter,  paymentsRouter);
app.use('/api/chat',         chatLimiter, chatRouter);
app.use('/api/tts',          chatLimiter, ttsRouter);
app.use('/api/referral',     apiLimiter,  referralRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.get('/ping',   (_req, res) => res.send('<h1>PONG - Server is alive and reached!</h1>'));

// ---------------------------------------------------------------------------
// Serve frontend static files in production
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  console.log(`[kelion-api] Production mode: serving from ${distPath}`);
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (/^\/(api|auth)(\/|$)/.test(req.path) || req.path === '/health') {
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
    console.log(`[kelion-api] Google redirect URI: ${config.google.redirectUri}`);
    console.log(`[kelion-api] CORS origins: ${config.corsOrigins.join(', ')}`);
  });
}

module.exports = app;
