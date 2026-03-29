// ═══════════════════════════════════════════════════════════════
// KelionAI — Server Entry Point v3
// Multi-AI orchestration, memory, safety, source code protection
// Self-development engine, GPS/weather live, Claude Code
// ═══════════════════════════════════════════════════════════════
'use strict';

// ── Load .env FIRST ──
require('dotenv').config();

// ── Core ──
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

// ── Logger ──
const logger = require('./logger');

// ── Code Shield — PRIMUL lucru inițializat ──
const codeShield = require('./code-shield');
codeShield.initialize();

// ── Config ──
const { MODELS, API_ENDPOINTS } = require('./config/models');
const { APP, PLAN_CONFIG } = require('./config/app');

// ── Database ──
const { supabase, supabaseAdmin, getUserFromToken } = require('./supabase');

// ── Brain ──
const { KelionBrain } = require('./brain');

// ── Scalability ──
const { circuitAllow, circuitSuccess, circuitFailure } = require('./scalability');

// ── Cache ──
const { cacheGet, cacheSet } = require('./cache');

// ── Admin sessions ──
const { validateSession, createSession } = require('./admin-sessions');

// ── Admin Auth Middleware ──
const { adminAuth } = require('./middleware/auth');

// ── Routes ──
const authRouter        = require('./routes/auth');
const chatRouter        = require('./routes/chat');
const voiceRouter       = require('./routes/voice');
const visionRouter      = require('./routes/vision');
const toolsApiRouter    = require('./routes/tools-api');
const adminApiRouter    = require('./routes/admin');
const adminMonitorRouter  = require('./routes/admin/monitor');
const adminRevenueRouter  = require('./routes/admin/revenue');
const adminUsersRouter    = require('./routes/admin/users');
const adminVisitorsRouter = require('./routes/admin/visitors');
const adminAlertsRouter   = require('./routes/admin/alerts');
const adminPricingRouter  = require('./routes/admin/pricing');
const adminConfigRouter   = require('./routes/admin/config');
const adminHistoryRouter  = require('./routes/admin/history');
const mobileApiRouter   = require('./routes/mobile-api');
const developerRouter   = require('./routes/developer');
const legalApiRouter    = require('./routes/legal-api');
const paymentsRouter    = require('./routes/payments');
const pricingRouter     = require('./routes/pricing');
const referralRouter    = require('./routes/referral');
const healthRouter      = require('./routes/health');
const identityRouter    = require('./routes/identity');
const { setupVoiceStream } = require('./routes/voice-stream');
const { setupRealtimeVoice } = require('./routes/voice-realtime');
const { setupLiveChat } = require('./routes/live');
const configRouter      = require('./routes/config');
const selfDevRouter     = require('./routes/self-dev');
const contactRouter     = require('./routes/contact');
const workspaceRouter   = require('./routes/workspace');
const refundRouter      = require('./routes/refund');
const brainApiRouter    = require('./routes/brain-api');
const scheduler         = require('./scheduler');
const alerts            = require('./alerts');

// ── Stripe Webhook (raw body — ÎNAINTE de express.json) ──
const stripeWebhookRouter = require('./routes/stripe-webhook');

// ── Middleware ──
const geoSession = require('./middleware/geo-session');

// ── Metrics ──
const { metricsMiddleware, register: metricsRegister } = require('./metrics');

// ── Migrate ──
const { runMigration: runMigrations } = require('./migrate');

// ═══════════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);

// ── Brain instance ──
const brain = new KelionBrain();

// ── App locals ──
app.locals.brain = brain;
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;
app.locals.getUserFromToken = getUserFromToken;

// ═══════════════════════════════════════════════════════════════
// TRUST PROXY
// ═══════════════════════════════════════════════════════════════
app.set('trust proxy', 1);

// ═══════════════════════════════════════════════════════════════
// COMPRESSION
// ═══════════════════════════════════════════════════════════════
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ═══════════════════════════════════════════════════════════════
// HELMET — Security headers
// ═══════════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false, // gestionat manual mai jos
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  permissionsPolicy: {
    features: {
      camera: ['self'],
      microphone: ['self'],
      geolocation: ['self'],
      payment: ['self'],
    },
  },
}));

// ═══════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════
const allowedOrigins = [
  process.env.APP_URL,
  process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : null,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((o) => origin === o)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-secret', 'x-admin-key', 'x-session-token'],
}));

// ═══════════════════════════════════════════════════════════════
// STRIPE WEBHOOK — raw body ÎNAINTE de express.json()
// ═══════════════════════════════════════════════════════════════
app.use('/api/stripe', stripeWebhookRouter);

// ═══════════════════════════════════════════════════════════════
// BODY PARSERS
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// BODY PARSERS
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// ═══════════════════════════════════════════════════════════════
// PROMETHEUS METRICS
// ═══════════════════════════════════════════════════════════════
app.use(metricsMiddleware);
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK — ÎNAINTE de orice middleware, returnează 200 mereu
// ═══════════════════════════════════════════════════════════════
app.use('/api/health', healthRouter);

// ═══════════════════════════════════════════════════════════════
// CODE SHIELD MIDDLEWARE — Primul layer de protecție
// ═══════════════════════════════════════════════════════════════
app.use(codeShield.sourceCodeProtectionMiddleware);
app.use(codeShield.apiProtectionMiddleware);
app.use(codeShield.hotlinkProtectionMiddleware);

// ═══════════════════════════════════════════════════════════════
// GEO SESSION MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(geoSession);

// ═══════════════════════════════════════════════════════════════
// CSP — Content Security Policy
// ═══════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://js.stripe.com https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: blob: https: http:`,
    `media-src 'self' blob: https:`,
    `connect-src 'self' blob: https://api.openai.com https://api.anthropic.com https://api.groq.com https://generativelanguage.googleapis.com https://api.elevenlabs.io wss://api.elevenlabs.io https://api.perplexity.ai https://api.deepseek.com https://api.tavily.com https://api.open-meteo.com https://geocoding-api.open-meteo.com https://ipapi.co https://ip-api.com https://freeipapi.com https://wttr.in https://js.stripe.com`,
    `frame-src 'self' https://js.stripe.com https://hooks.stripe.com`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    process.env.NODE_ENV === 'production' ? `upgrade-insecure-requests` : null,
  ].filter(Boolean).join('; ');

  res.setHeader('Content-Security-Policy', csp);
  next();
});

// ═══════════════════════════════════════════════════════════════
// STATIC FILES
// ═══════════════════════════════════════════════════════════════

// Serve HTML files with CSP nonce injection
const fs = require('fs');
const APP_DIR = path.join(__dirname, '../app');

function serveHtmlWithNonce(req, res, htmlFile) {
  const filePath = path.join(APP_DIR, htmlFile);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(404).sendFile(path.join(APP_DIR, '404.html'));
    const nonce = res.locals.cspNonce || '';
    // Add nonce to all inline <script> tags (not ones with src=)
    const patched = html.replace(/<script(?![^>]*\bsrc\b)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(patched);
  });
}

// Route HTML pages through nonce injection
app.get('/', (req, res) => serveHtmlWithNonce(req, res, 'index.html'));
app.get('/index.html', (req, res) => serveHtmlWithNonce(req, res, 'index.html'));
app.get('/onboarding.html', (req, res) => serveHtmlWithNonce(req, res, 'onboarding.html'));
app.get('/reset-password.html', (req, res) => serveHtmlWithNonce(req, res, 'reset-password.html'));
app.get('/error.html', (req, res) => serveHtmlWithNonce(req, res, 'error.html'));
app.get('/404.html', (req, res) => serveHtmlWithNonce(req, res, '404.html'));

// Sub-directory index pages
['admin', 'dashboard', 'settings', 'workspace', 'pricing', 'contact',
 'privacy', 'terms', 'gdpr', 'cookie-policy', 'refund-policy'].forEach(dir => {
  app.get(`/${dir}`, (req, res) => serveHtmlWithNonce(req, res, `${dir}/index.html`));
  app.get(`/${dir}/`, (req, res) => serveHtmlWithNonce(req, res, `${dir}/index.html`));
  app.get(`/${dir}/index.html`, (req, res) => serveHtmlWithNonce(req, res, `${dir}/index.html`));
});

// Service Worker — must NEVER be cached by CDN/browser
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(APP_DIR, 'sw.js'));
});

// Static assets (JS, CSS, images, models, etc.) — no nonce needed
app.use(express.static(APP_DIR, {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
  etag: true,
  lastModified: true,
  index: false, // We handle index.html above with nonce injection
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Service Worker must never be cached by CDN/browser
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // GLB models — short cache + must-revalidate so avatar updates propagate fast
    if (filePath.endsWith('.glb')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
    if (/\.[0-9a-f]{8,}\.(js|css|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));




app.post('/api/admin/verify', express.json(), async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const adminCode = process.env.ADMIN_SECRET_KEY;
    if (!adminCode) return res.status(500).json({ error: 'Admin not configured' });

    const cb = Buffer.from(code.toString());
    const ab = Buffer.from(adminCode);
    const valid = cb.length === ab.length && crypto.timingSafeEqual(cb, ab);

    if (!valid) {
      logger.warn({ component: 'AdminVerify', ip: req.ip }, 'Invalid admin code attempt');
      return res.status(401).json({ error: 'Invalid code' });
    }

    const sessionToken = createSession({ ip: req.ip, ua: req.headers['user-agent'] });

    res.cookie('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 ore
    });

    logger.info({ component: 'AdminVerify', ip: req.ip }, '✅ Admin session created');
    return res.json({ ok: true, sessionToken });
  } catch (e) {
    logger.error({ component: 'AdminVerify', err: e.message }, 'Verify error');
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../app/admin.html'));
});
app.get('/admin/', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../app/admin.html'));
});
app.get('/admin/*', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../app/admin.html'));
});

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════
app.use('/api/auth',                  authRouter);
app.use('/api/vision',                visionRouter);
app.use('/api/mobile/v1',             mobileApiRouter);
app.use('/api/admin',                 adminAuth, adminApiRouter);
app.use('/api/admin',                 adminAuth, adminMonitorRouter);
app.use('/api/admin/revenue',         adminAuth, adminRevenueRouter);
app.use('/api/admin/users',           adminAuth, adminUsersRouter);
app.use('/api/admin/visitors',        adminAuth, adminVisitorsRouter);
app.use('/api/admin/alerts',          adminAuth, adminAlertsRouter);
app.use('/api/admin/pricing',         adminAuth, adminPricingRouter);
app.use('/api/admin/config',          adminAuth, adminConfigRouter);
app.use('/api/admin/history',         adminAuth, adminHistoryRouter);
app.use('/api/admin/self',            adminAuth, selfDevRouter);   // 🆕 Self-dev: key audit, weather test, brain status
app.use('/api',                       chatRouter);
app.use('/api',                       voiceRouter);
app.use('/api/referral',              referralRouter);
app.use('/api',                       toolsApiRouter);
app.use('/api/developer',             developerRouter);
app.use('/api/legal',                 legalApiRouter);
app.use('/api/payments',              paymentsRouter);
app.use('/api/pricing',               pricingRouter);
app.use('/api/config',                configRouter);
app.use('/api',                       identityRouter);
app.use('/api/contact',               contactRouter);
app.use('/api/workspace',             workspaceRouter);
app.use('/api/refund',                refundRouter);
app.use('/api/brain',                 brainApiRouter);

// ═══════════════════════════════════════════════════════════════
// MEMORY SESSION CLEAR (beacon-safe)
// ═══════════════════════════════════════════════════════════════
app.post('/api/memory/clear-session', express.json(), (req, res) => {
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
// VISITOR TRACKING
// ═══════════════════════════════════════════════════════════════
app.post('/api/visitor/ping', express.json(), async (req, res) => {
  try {
    const { fingerprint } = req.body;
    if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 200) {
      return res.json({ ok: false });
    }

    const ip =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    const country = req.headers['cf-ipcountry'] || req.session?.geo?.country || null;
    const ua = req.headers['user-agent'] || '';
    const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Other';

    if (supabaseAdmin) {
      const { data: existing } = await supabaseAdmin
        .from('visitors')
        .select('id')
        .eq('fingerprint', fingerprint)
        .single();

      if (existing) {
        await supabaseAdmin
          .from('visitors')
          .update({ last_seen: new Date().toISOString(), ip, country, browser })
          .eq('fingerprint', fingerprint);
      } else {
        await supabaseAdmin.from('visitors').insert({
          fingerprint,
          ip,
          country,
          browser,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        });
      }
    }

    return res.json({ ok: true });
  } catch (e) {
    logger.debug({ component: 'Visitor', err: e.message }, 'Ping error');
    return res.json({ ok: false });
  }
});

app.post('/api/visitor/time', express.json(), async (req, res) => {
  try {
    const { fingerprint, duration } = req.body;
    if (!fingerprint || !duration) return res.json({ ok: false });

    if (supabaseAdmin) {
      await supabaseAdmin.rpc('increment_visitor_time', { fp: fingerprint, secs: duration }).catch(() => {
        supabaseAdmin
          .from('visitors')
          .update({ time_spent: duration })
          .eq('fingerprint', fingerprint)
          .catch(() => {});
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

// ═══════════════════════════════════════════════════════════════
// PAGE VIEWS
// ═══════════════════════════════════════════════════════════════
app.post('/api/pageview', express.json(), async (req, res) => {
  try {
    const { path: pagePath, fingerprint, referrer } = req.body;
    if (!pagePath) return res.json({ ok: false });

    if (supabaseAdmin) {
      await supabaseAdmin.from('page_views').insert({
        path: pagePath.substring(0, 200),
        fingerprint: fingerprint?.substring(0, 200) || null,
        referrer: referrer?.substring(0, 500) || null,
        ip: req.headers['cf-connecting-ip'] || req.ip || null,
        country: req.headers['cf-ipcountry'] || null,
        created_at: new Date().toISOString(),
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

// ═══════════════════════════════════════════════════════════════
// FRONTEND ERRORS
// ═══════════════════════════════════════════════════════════════
app.post('/api/frontend-error', express.json(), async (req, res) => {
  try {
    const { message: errMsg, stack, url, line, col } = req.body;
    logger.warn({ component: 'FrontendError', errMsg, url, line, col, stack: stack?.substring(0, 500) }, 'Frontend error reported');
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false });
  }
});

app.get('/api/admin/frontend-errors', adminAuth, (req, res) => {
  res.json({ errors: [], message: 'Frontend errors logged to server logs' });
});

// ═══════════════════════════════════════════════════════════════
// CODE SHIELD STATUS (admin only)
// ═══════════════════════════════════════════════════════════════
app.get('/api/admin/shield-status', adminAuth, (req, res) => {
  res.json({ ok: true, shield: codeShield.getStatus() });
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD (admin)
// ═══════════════════════════════════════════════════════════════
app.get('/dashboard', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../app/admin.html'));
});

// ═══════════════════════════════════════════════════════════════
// SPA FALLBACK — toate rutele necunoscute → index.html
// ═══════════════════════════════════════════════════════════════
app.get('*', (req, res, next) => {
  const p = req.path;
  // Nu servi SPA pentru rute admin sau API
  if (p.startsWith('/api/') || p.startsWith('/admin')) return next();
  // Nu servi SPA pentru fișiere cu extensie (assets)
  if (path.extname(p)) return next();
  res.sendFile(path.join(__dirname, '../app/index.html'));
});

// ═══════════════════════════════════════════════════════════════
// 404 HANDLER
// ═══════════════════════════════════════════════════════════════
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, '../app/index.html'));
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLER
// ═══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ component: 'Server', err: err.message, path: req.path }, 'Unhandled error');
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Internal server error');
});

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO (pentru live features)
// ═══════════════════════════════════════════════════════════════
try {
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });
  app.locals.io = io;

  io.on('connection', (socket) => {
    logger.debug({ component: 'SocketIO', id: socket.id }, 'Client connected');
    socket.on('disconnect', () => {
      logger.debug({ component: 'SocketIO', id: socket.id }, 'Client disconnected');
    });
  });

  // ── Attach voice/live namespaces to Socket.io ──
  if (typeof setupRealtimeVoice === 'function') {
    setupRealtimeVoice(io, app.locals);
    logger.info({ component: 'Server' }, '🎙️ Voice Realtime namespace attached (/voice-realtime)');
  }
  if (typeof setupLiveChat === 'function') {
    setupLiveChat(io, app.locals);
    logger.info({ component: 'Server' }, '🔴 Live Chat namespace attached (/live)');
  }
} catch (e) {
  logger.warn({ component: 'SocketIO', err: e.message }, 'Socket.IO not available');
}

// ═══════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════
async function start() {
  try {
    // Run DB migrations
    logger.info({ component: 'Server' }, '🔄 Running database migrations...');
    await runMigrations();
    logger.info({ component: 'Server' }, '✅ Migrations complete');
  } catch (e) {
    logger.warn({ component: 'Server', err: e.message }, 'Migrations failed — continuing');
  }

  const PORT = parseInt(process.env.PORT || '3000', 10);
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(
      { component: 'Server', port: PORT, env: process.env.NODE_ENV || 'development' },
      `🚀 KelionAI v3 running on port ${PORT}`
    );
    logger.info({ component: 'Server' }, `🛡️ Code Shield: ${codeShield.getStatus().filesProtected} files protected`);
    logger.info({ component: 'Server' }, `🤖 Brain: 18 agents ready (Claude Code on all avatars)`);
    logger.info({ component: 'Server' }, `🌤️ Weather: Open-Meteo live (GPS + IP fallback, no API key)`);
    logger.info({ component: 'Server' }, `🔑 API Key Audit: scheduled in 10s`);
  });

  // ── VoiceStream folosește WebSocket nativ (nu Socket.io) ──
  if (typeof setupVoiceStream === 'function') {
    setupVoiceStream(server, app.locals);
    logger.info({ component: 'Server' }, '🎤 Voice Stream WebSocket attached (/api/voice/stream)');
  }

  // ── Start scheduler (self-healing, credit checks, AI health) ──
  try {
    const { supabaseAdmin } = app.locals;
    scheduler.start(supabaseAdmin);
    app.locals.scheduler = scheduler;
    app.locals.alerts    = alerts;
    logger.info({ component: 'Server' }, '⏰ Scheduler started (healing/6h, credits/30m, AI-health/15m)');
  } catch (e) {
    logger.warn({ component: 'Server', err: e.message }, 'Scheduler failed to start — continuing');
  }
}

start().catch((e) => {
  logger.error({ component: 'Server', err: e.message }, '💥 Fatal startup error');
  process.exit(1);
});

// ── Graceful shutdown ──
process.on('SIGTERM', () => {
  logger.info({ component: 'Server' }, 'SIGTERM received — graceful shutdown');
  server.close(() => {
    logger.info({ component: 'Server' }, 'Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info({ component: 'Server' }, 'SIGINT received — graceful shutdown');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  logger.error({ component: 'Server', err: err.message, stack: err.stack?.substring(0, 500) }, '💥 Uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ component: 'Server', reason: String(reason).substring(0, 200) }, '💥 Unhandled rejection');
});

