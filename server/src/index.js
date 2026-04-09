'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const BetterSqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const config = require('./config');
const authRouter         = require('./routes/auth');
const usersRouter        = require('./routes/users');
const adminRouter        = require('./routes/admin');
const subscriptionsRouter = require('./routes/subscriptions');
const paymentsRouter     = require('./routes/payments');

const app = express();

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet());

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
const sessionDb = new Database(path.resolve(config.dbPath));
app.use(
  session({
    name:   config.session.name,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    store: new BetterSqliteStore({ client: sessionDb }),
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
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/subscription', subscriptionsRouter);
app.use('/api/payments', paymentsRouter);

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
  app.listen(PORT, () => {
    console.log(`[kelion-api] Server listening on port ${PORT} (${config.nodeEnv})`);
    console.log(`[kelion-api] Google redirect URI: ${config.google.redirectUri}`);
    console.log(`[kelion-api] CORS origins: ${config.corsOrigins.join(', ')}`);
  });
}

module.exports = app; // export for testing
