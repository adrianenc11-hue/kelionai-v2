'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const cookieParser = require('cookie-parser');

const config = require('./config');

// Ensure config is mutable
if (!config.dbPath) {
  config.dbPath = '/tmp/kelion-data/kelion.db';
}

// Ensure data directory exists before anything tries to open a DB file
// Use /tmp for database to avoid permission issues in containerized environments
const dbDir = process.env.DB_DIR || '/tmp/kelion-data';
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
  } catch (err) {
    console.warn(`Warning: Failed to create directory ${dbDir}:`, err);
    // Continue anyway - the directory might already exist or be writable
  }
}

// Override config.dbPath to use the writable directory
config.dbPath = path.join(dbDir, 'kelion.db');

const authRouter          = require('./routes/auth');
const localAuthRouter     = require('./routes/localAuth');
const usersRouter         = require('./routes/users');
const adminRouter         = require('./routes/admin');
const subscriptionsRouter = require('./routes/subscriptions');
const paymentsRouter      = require('./routes/payments');
const referralRouter      = require('./routes/referral');

const app = express();

// ---------------------------------------------------------------------------
// Security headers (minimal – no helmet, it blocks React/Three.js)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,   // Required for cookies to be sent cross-origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ---------------------------------------------------------------------------
// Body parsers
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Session (used by web clients and transiently during the OAuth flow)
// ---------------------------------------------------------------------------
app.use(
  session({
    name:   config.session.name,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure:   config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain:   config.cookie.domain || undefined,
      maxAge:   config.session.maxAgeMs,
    },
  })
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/auth', authRouter);
app.use("/auth/local", localAuthRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/subscription', subscriptionsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/referral', referralRouter);

// Health / readiness probe (useful for Railway)
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Serve frontend static files in production (must come after API routes)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../dist');
  app.use(express.static(distPath));

  // SPA fallback — serve index.html for any non-API GET request
  app.get('*', (req, res, next) => {
    if (/^\/(api|auth)(\/|$)/.test(req.path) || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

// 404 catch-all (reached in development for all unmatched routes, and in
// production for unmatched API/auth routes or non-GET requests to unknown paths)
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start server (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------
if (require.main === module) {
  const PORT = config.port;
  try {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[kelion-api] Server listening on 0.0.0.0:${PORT} (${config.nodeEnv})`);
      console.log(`[kelion-api] process.env.PORT = ${process.env.PORT}`);
      console.log(`[kelion-api] Google redirect URI: ${config.google.redirectUri}`);
      console.log(`[kelion-api] CORS origins: ${config.corsOrigins.join(', ')}`);
    });
  } catch (err) {
    console.error('[kelion-api] FATAL startup error:', err);
    process.exit(1);
  }
}

module.exports = app; // export for testing
