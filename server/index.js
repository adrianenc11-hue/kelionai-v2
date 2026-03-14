// ═══════════════════════════════════════════════════════════════
// KelionAI v2.5 — BRAIN-POWERED SERVER
// Autonomous thinking, self-repair, auto-learning
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const http = require('http');

// Verify Node.js version — native fetch available from Node 18+
if (!globalThis.fetch) {
  throw new Error('Node.js 18+ required for native fetch. Current: ' + process.version);
}
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
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
const { initCache, cacheGet, cacheSet, getCacheStats } = require('./cache');
const { runMigration } = require('./migrate');
const { KelionBrain } = require('./brain');
const { validateEnv, setupGracefulShutdown, smokeTest } = require('./startup-checks');

const logger = require('./logger');
const { router: paymentsRouter } = require('./payments');
const legalRouter = require('./legal');
const { router: referralRouter } = require('./referral');
const {
  router: messengerRouter,
  getStats: getMessengerStats,
  notifySubscribersNews,
  setSupabase: setMessengerSupabase,
} = require('./messenger');
const { router: telegramRouter, broadcastNews, setSupabase: setTelegramSupabase } = require('./telegram');
const { router: whatsappRouter, setSupabase: setWhatsappSupabase } = require('./whatsapp');
const fbPage = require('./facebook-page');
const instagram = require('./instagram');
const developerRouter = require('./routes/developer');
const {
  ipBlacklistMiddleware,
  _compressionMiddleware,
  staticCacheMiddleware,
  gracefulDegradationMiddleware,
  getCircuitStats,
  getBlacklistStats,
  getLoadStats,
  getQueueStats,
  circuitAllow,
  circuitSuccess,
  circuitFailure,
  enqueueTask,
} = require('./scalability');

// ═══ EXTRACTED ROUTE MODULES ═══
const chatRouter = require('./routes/chat');
const voiceRouter = require('./routes/voice');
const searchRouter = require('./routes/search');
const weatherRouter = require('./routes/weather');
const visionRouter = require('./routes/vision');
const imagesRouter = require('./routes/images');
const authRouter = require('./routes/auth');
const adminApiRouter = require('./routes/admin');
const { adminAuth } = require('./middleware/auth');
const healthRouter = require('./routes/health');
const translateRouter = require('./routes/translate');
const exportRouter = require('./routes/export');
const identityRouter = require('./routes/identity');
const voiceCloneRouter = require('./routes/voice-clone');
const messengerBot = require('./messenger');
const instagramBot = require('./instagram');
const tradingRouter = require('./trading');
const { router: marketplaceRouter } = require('./agent-marketplace');
const { router: pluginRouter, restorePlugins: _restorePlugins } = require('./plugin-system');
const autonomousRunner = require('./autonomous-runner');
const ollama = require('./ai-providers/ollama');
const { tenantMiddleware } = require('./middleware/tenant');
const multimodalRouter = require('./routes/multimodal');
const browserAgent = require('./browser-agent');
const quickWins = require('./quick-wins');
const sharedSessions = require('./shared-sessions');

const app = express();
app.set('trust proxy', 1);

// ═══ LEVEL 2-4 SCALABILITY MIDDLEWARE ═══
app.use(ipBlacklistMiddleware); // Auto-ban abusive IPs (>500 req/min)
app.use(gracefulDegradationMiddleware); // 503 when overloaded
app.use(staticCacheMiddleware); // Cache-Control headers for static files

// ═══ HTTPS FORCE REDIRECT ═══
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.hostname}${req.url}`);
  }
  next();
});

// ═══ CSP NONCE MIDDLEWARE — generates unique nonce per request ═══
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use((req, res, next) => {
  // Skip Helmet CSP for admin pages (they need inline scripts)
  if (req.path.startsWith('/admin')) return next();
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-eval'", // Required by Three.js (uses new Function() for shaders)
          (req, res) => `'nonce-${res.locals.cspNonce}'`,
          // Required CDNs with pinned versions
          'https://cdn.jsdelivr.net',
          'https://browser.sentry-cdn.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc: [
          "'self'",
          'blob:',
          'https://api.openai.com',
          'https://generativelanguage.googleapis.com',
          'https://api.elevenlabs.io',
          'https://api.groq.com',
          'https://api.perplexity.ai',
          'https://api.tavily.com',
          'https://google.serper.dev',
          'https://api.duckduckgo.com',
          'https://api.together.xyz',
          'https://api.deepseek.com',
          'https://geocoding-api.open-meteo.com',
          'https://api.open-meteo.com',
          'https://storage.googleapis.com',
          'https://tfhub.dev',
          'https://www.kaggle.com',
          'https://*.sentry.io',
          'https://*.ingest.sentry.io',
          'https://fonts.googleapis.com',
          'https://fonts.gstatic.com',
          'https://*.supabase.co',
        ],
        frameSrc: [
          "'self'",
          'https://www.youtube.com',
          'https://youtube.com',
          'https://open.spotify.com',
          'https://www.google.com',
          'https://maps.google.com',
          'https://*.google.com',
        ],
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        scriptSrcAttr: ["'unsafe-inline'"], // Required for admin panel onclick handlers
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })(req, res, next);
});

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : null;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!allowedOrigins) return callback(null, true);
      if (!origin) return callback(null, true);
      const env = process.env.NODE_ENV || 'development';
      if (env !== 'production' && (origin.startsWith('http://localhost') || origin.startsWith('https://127.'))) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  })
);

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
// Messenger webhook needs raw body for HMAC-SHA256 validation
app.use('/api/messenger/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '25mb' }));

// ═══ HTTP REQUEST LOGGING + TRAFFIC TRACKING ═══
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        component: 'HTTP',
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('user-agent'),
      },
      `${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
    // Track page views for admin traffic panel (skip API/static/health/bots)
    if (
      req.method === 'GET' &&
      !req.path.startsWith('/api/') &&
      !req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?|map|json|webmanifest)$/i) &&
      supabaseAdmin
    ) {
      // Skip health checks, service worker, and bot traffic
      const ua = (req.get('user-agent') || '').toLowerCase();
      const isBot = /bot|crawl|spider|node-fetch|uptimerobot|healthcheck|pingdom|monitoring|curl|wget/i.test(ua);
      const isHealth =
        req.path === '/health' || req.path === '/sw.js' || req.path === '/manifest.json' || req.path === '/favicon.svg';
      if (!isBot && !isHealth) {
        const realIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
        // Skip internal IPs entirely
        if (
          realIp === process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          '127.0.0.1' ||
          realIp === '::1' ||
          realIp === '::ffff:127.0.0.1'
        )
          return;

        // Country from CDN headers first, then IP geolocation
        let country = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || null;

        // Async insert — resolve country via ip-api.com if not from CDN
        const insertView = async () => {
          if (!country && realIp !== 'unknown') {
            // Check cache first
            if (!global._geoCache) global._geoCache = {};
            if (global._geoCache[realIp]) {
              country = global._geoCache[realIp];
            } else {
              try {
                const geoR = await fetch(
                  'https://ip-api.com/json/' + encodeURIComponent(realIp) + '?fields=countryCode',
                  { signal: AbortSignal.timeout(2000) }
                );
                if (geoR.ok) {
                  const geoD = await geoR.json();
                  country = geoD.countryCode || null;
                  if (country) global._geoCache[realIp] = country;
                  // Keep cache small
                  const keys = Object.keys(global._geoCache);
                  if (keys.length > 500) {
                    for (let i = 0; i < 200; i++) delete global._geoCache[keys[i]];
                  }
                }
              } catch (_e) {
                /* geo lookup failed — ok, insert without */
              }
            }
          }
          const { error } = await supabaseAdmin.from('page_views').insert({
            ip: realIp,
            path: req.path,
            user_agent: (req.get('user-agent') || '').substring(0, 300),
            country: country,
            referrer: (req.get('referer') || req.get('referrer') || '').substring(0, 500) || null,
          });
          if (error)
            logger.warn({ component: 'PageViews', err: error.message, code: error.code }, 'page_views insert failed');
        };
        insertView().catch((e) => {
          logger.warn({ component: 'PageViews', err: e.message }, 'page_views insert exception');
        });
      }
    }
  });
  next();
});

// ═══ RATE LIMITING ═══
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/admin/') || req.path.startsWith('/admin'),
});

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const metrics = require('./metrics');
app.use(metrics.metricsMiddleware);
// ═══ BUILD INFO (Truth Guard) ═══
const _buildSha = (() => {
  try {
    return require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown';
  }
})();
const _buildEnv = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development';
app.use((req, res, next) => {
  res.setHeader('x-build-sha', _buildSha.slice(0, 8));
  res.setHeader('x-build-env', _buildEnv);
  next();
});

app.get(
  '/metrics',
  adminAuth,
  asyncHandler(async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  })
);
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    service: 'kelionai',
    env: _buildEnv,
    commit: _buildSha.slice(0, 8),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
// Read index.html once at startup, injecting Sentry DSN if configured
const _rawHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const _indexHtml = process.env.SENTRY_DSN
  ? _rawHtml.replace(
      '<meta name="sentry-dsn" content="">',
      `<meta name="sentry-dsn" content="${process.env.SENTRY_DSN.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
    )
  : _rawHtml;

// Read 404.html once at startup (for admin stealth)
const _raw404Html = fs.existsSync(path.join(__dirname, '..', 'app', '404.html'))
  ? fs.readFileSync(path.join(__dirname, '..', 'app', '404.html'), 'utf8')
  : '<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>';

// Serve main app with CSP nonce injection (express.static skips index.html for /)
app.get('/', (req, res) => {
  const nonce = res.locals.cspNonce || '';
  const html = _indexHtml.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
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
  const html = _rawOnboarding.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
  res.type('html').send(html);
});

// Serve reset-password with CSP nonce injection
app.get('/reset-password.html', (req, res) => {
  if (!_rawResetPassword) return res.redirect('/');
  const nonce = res.locals.cspNonce || '';
  const html = _rawResetPassword.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
  res.type('html').send(html);
});

// Admin panel — read from disk each request (prevents stale HTML after deploy)
const _adminHtmlPath = path.join(__dirname, '..', 'app', 'admin', 'index.html');
app.get('/admin', (req, res) => {
  try {
    const html = fs.readFileSync(_adminHtmlPath, 'utf8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html);
  } catch (_e) {
    res.status(404).send('Admin page not found');
  }
});
app.get('/admin/', (req, res) => {
  try {
    const html = fs.readFileSync(_adminHtmlPath, 'utf8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html);
  } catch (_e) {
    res.status(404).send('Admin page not found');
  }
});
// Admin trading page — serve with relaxed CSP (before express.static)
const _rawTradingHtml = fs.existsSync(path.join(__dirname, '..', 'app', 'admin', 'trading.html'))
  ? fs.readFileSync(path.join(__dirname, '..', 'app', 'admin', 'trading.html'), 'utf8')
  : null;
app.get('/admin/trading.html', (req, res) => {
  if (!_rawTradingHtml) return res.status(404).send('Trading page not found');
  // Override CSP to allow inline scripts for admin pages
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://*.tradingview.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.tradingview.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https: http:; " +
      "connect-src 'self' https:; " +
      "frame-src 'self' https://*.tradingview.com blob:; " +
      "child-src 'self' https://*.tradingview.com blob:;"
  );
  res.type('html').send(_rawTradingHtml);
});
// Force no-cache on JS/CSS/HTML so deploys take effect immediately
// IMPORTANT: must be BEFORE express.static so headers are set
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css|html)$/)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use('/admin', express.static(path.join(__dirname, '..', 'app', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'app')));
app.use('/api', globalLimiter);
const PORT = process.env.PORT || 3000;
const memFallback = Object.create(null);

// Cleanup memFallback every hour to prevent memory leaks
const _memCleanupInterval = setInterval(
  () => {
    const keys = Object.keys(memFallback);
    if (keys.length > 1000) {
      // Keep only the most recent 500 entries
      const toDelete = keys.slice(0, keys.length - 500);
      for (const k of toDelete) delete memFallback[k];
      logger.info({ component: 'Memory', removed: toDelete.length, remaining: 500 }, 'memFallback cleanup');
    }
  },
  60 * 60 * 1000
);
_memCleanupInterval.unref();

// ═══ BRAIN INITIALIZATION ═══
const brain = new KelionBrain({
  geminiKey: process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  groqKey: process.env.GROQ_API_KEY,
  perplexityKey: process.env.PERPLEXITY_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
  serperKey: process.env.SERPER_API_KEY,
  togetherKey: process.env.TOGETHER_API_KEY,
  googleMapsKey: process.env.GOOGLE_MAPS_KEY,
  supabaseAdmin,
});
logger.info({ component: 'Brain' }, '🧠 Engine initialized');
validateEnv();

// ═══ BRAIN STATE PERSISTENCE ═══
// Save toolStats, journal, strategies to Supabase so they survive deploys
async function saveBrainState() {
  if (!supabaseAdmin || !brain) return;
  try {
    const state = {
      toolStats: brain.toolStats || {},
      toolErrors: brain.toolErrors || {},
      journal: (brain.journal || []).slice(-50),
      strategies: brain.strategies || {},
      savedAt: new Date().toISOString(),
    };
    await supabaseAdmin.from('metrics_snapshots').insert({
      metric_type: 'brain_state',
      metric_name: 'full_state_snapshot',
      value: 1,
      labels: state,
      created_at: new Date().toISOString(),
    });
    logger.info({ component: 'Brain' }, '💾 Brain state saved to Supabase');
  } catch (e) {
    logger.warn({ component: 'Brain', err: e.message }, 'Brain state save failed');
  }
}

/**
 * restoreBrainState
 * @returns {*}
 */
async function restoreBrainState() {
  if (!supabaseAdmin || !brain) return;
  try {
    const { data } = await supabaseAdmin
      .from('metrics_snapshots')
      .select('labels, created_at')
      .eq('metric_type', 'brain_state')
      .eq('metric_name', 'full_state_snapshot')
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0 && data[0].labels) {
      const s = data[0].labels;
      if (s.toolStats) {
        // Merge — keep existing keys, add saved values
        Object.entries(s.toolStats).forEach(([k, v]) => {
          brain.toolStats[k] = (brain.toolStats[k] || 0) + (v || 0);
        });
      }
      if (s.toolErrors) {
        Object.entries(s.toolErrors).forEach(([k, v]) => {
          brain.toolErrors[k] = (brain.toolErrors[k] || 0) + (v || 0);
        });
      }
      if (s.journal && Array.isArray(s.journal)) {
        brain.journal = [...s.journal, ...(brain.journal || [])];
      }
      if (s.strategies) brain.strategies = { ...s.strategies, ...(brain.strategies || {}) };
      logger.info({ component: 'Brain', savedAt: s.savedAt }, '🔄 Brain state restored from Supabase');
    } else {
      logger.info({ component: 'Brain' }, 'No previous brain state found — fresh start');
    }
  } catch (e) {
    logger.warn({ component: 'Brain', err: e.message }, 'Brain state restore failed');
  }
}

// Restore state immediately
restoreBrainState();

// Periodic save every 5 minutes
const _brainSaveInterval = setInterval(saveBrainState, 5 * 60 * 1000);
_brainSaveInterval.unref();

// Graceful shutdown — save state before exit
process.on('SIGTERM', async () => {
  logger.info({ component: 'Server' }, '🛑 SIGTERM received — saving brain state...');
  await saveBrainState();
  process.exit(0);
});
process.on('SIGINT', async () => {
  logger.info({ component: 'Server' }, '🛑 SIGINT received — saving brain state...');
  await saveBrainState();
  process.exit(0);
});

// ═══ AUTH HELPER ═══
async function getUserFromToken(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  // Use supabaseAdmin (service_role) for token verification — anon key cannot verify other users' tokens
  const client = supabaseAdmin || supabase;
  if (!client) return null;
  try {
    const {
      data: { user },
    } = await client.auth.getUser(h.split(' ')[1]);
    return user;
  } catch {
    return null;
  }
}

// ═══ SHARE HELPERS VIA app.locals (for all route modules) ═══
app.locals.getUserFromToken = getUserFromToken;
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;
app.locals.brain = brain;

// ═══ MESSENGER + INSTAGRAM + WHATSAPP + TELEGRAM INTEGRATION ═══
messengerBot.setSupabase(supabaseAdmin || supabase);
instagramBot.setBrain(brain);
instagramBot.setSupabase(supabaseAdmin || supabase);
setWhatsappSupabase(supabaseAdmin || supabase);
setTelegramSupabase(supabaseAdmin || supabase);

app.locals.memFallback = memFallback;

// ═══ ROUTE MODULES ═══
app.use('/api/auth', authRouter);
app.use('/api', chatRouter);
app.use('/api', voiceRouter);
app.use('/api/voice', voiceRouter); // alias: /api/voice/voices also works
app.use('/api/search', searchRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/vision', visionRouter);
app.use('/api/imagine', imagesRouter);
app.use('/api/admin', adminApiRouter);
app.use('/api/health', healthRouter);
app.use('/api/referral', referralRouter);
app.use('/api', identityRouter);
app.use('/api', voiceCloneRouter);
app.use('/api/export', exportRouter);
app.use('/api', translateRouter);

// ═══ MESSENGER + INSTAGRAM WEBHOOKS ═══
app.use('/api/messenger', messengerBot.router);
app.use('/api/instagram', instagramBot.router);
app.use('/api/trading', tradingRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/plugins', pluginRouter);
app.use('/api/multimodal', multimodalRouter);

// ═══ v3.3 TENANT MIDDLEWARE ═══
app.use(tenantMiddleware);

// ═══ v3.4 OLLAMA / LOCAL AI ROUTES ═══
app.get('/api/admin/models', adminAuth, async (_req, res) => {
  const available = await ollama.checkStatus();
  const models = available ? await ollama.listModels() : { models: [] };
  res.json({ available, ...models });
});
app.post('/api/admin/models/pull', adminAuth, express.json(), async (req, res) => {
  const result = await ollama.pullModel(req.body.model);
  res.json(result);
});
app.post('/api/admin/models/delete', adminAuth, express.json(), async (req, res) => {
  const result = await ollama.deleteModel(req.body.model);
  res.json(result);
});
app.post('/api/admin/models/test', adminAuth, express.json(), async (req, res) => {
  const result = await ollama.chat(req.body.prompt || 'Hello', {
    model: req.body.model,
  });
  res.json(result);
});
app.get('/api/ai/status', async (_req, res) => {
  const localAvailable = await ollama.checkStatus();
  res.json({
    local: {
      available: localAvailable,
      provider: 'ollama',
      model: ollama.defaultModel,
    },
    cloud: {
      available: true,
      providers: ['openai', 'gemini', 'groq'].filter((p) => {
        const keys = {
          openai: 'OPENAI_API_KEY',
          gemini: 'GOOGLE_AI_KEY',
          groq: 'GROQ_API_KEY',
        };
        return !!process.env[keys[p]];
      }),
    },
    mode: localAvailable ? 'hybrid' : 'cloud',
  });
});

// ═══ QUICK WINS API (Bookmarks, Templates, Webhooks, Rate Limits) ═══
app.get('/api/bookmarks', async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  res.json(quickWins.getBookmarks(user?.id || 'anonymous'));
});
app.post('/api/bookmarks', express.json(), async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  res.json(quickWins.addBookmark(user?.id || 'anonymous', req.body));
});
app.delete('/api/bookmarks/:id', async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  const ok = quickWins.deleteBookmark(user?.id || 'anonymous', req.params.id);
  res.json({ ok });
});

app.get('/api/templates', (_req, res) => res.json(quickWins.getTemplates()));
app.get('/api/templates/:id', (req, res) => {
  const t = quickWins.getTemplate(req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Template not found' });
});
app.post('/api/templates', adminAuth, express.json(), (req, res) => {
  res.json(quickWins.createTemplate(req.body));
});
app.delete('/api/templates/:id', adminAuth, (req, res) => {
  res.json({ ok: quickWins.deleteTemplate(req.params.id) });
});

app.get('/api/webhooks', adminAuth, (_req, res) => res.json(quickWins.getWebhooks()));
app.post('/api/webhooks', adminAuth, express.json(), (req, res) => {
  res.json(quickWins.registerWebhook(req.body));
});
app.delete('/api/webhooks/:id', adminAuth, (req, res) => {
  res.json({ ok: quickWins.deleteWebhook(req.params.id) });
});

app.get('/api/rate-limits', adminAuth, (_req, res) => res.json(quickWins.getRateLimitStats()));

// ═══ AUTONOMOUS TASKS API ═══
app.post('/api/autonomous/start', express.json(), async (req, res) => {
  try {
    const user = await getUserFromToken(req).catch(() => null);
    const userId = user?.id || req.body.userId || 'anonymous';
    const result = await autonomousRunner.startTask(brain, userId, req.body.goal, req.body.options);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/autonomous/status/:taskId', (req, res) => {
  const status = autonomousRunner.getTaskStatus(req.params.taskId);
  if (!status) return res.status(404).json({ error: 'Task not found' });
  res.json(status);
});
app.post('/api/autonomous/cancel/:taskId', async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  const result = autonomousRunner.cancelTask(req.params.taskId, user?.id || 'anonymous');
  res.json(result);
});
app.get('/api/autonomous/tasks', async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  res.json({ tasks: autonomousRunner.getUserTasks(user?.id || 'anonymous') });
});

// ═══ COMPUTER USE API (Browser Agent) ═══
app.post('/api/browser/navigate', express.json(), async (req, res) => {
  try {
    const result = await browserAgent.navigate(req.body.url, req.body.options);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/browser/click', express.json(), async (req, res) => {
  const result = await browserAgent.click(req.body.sessionId, req.body.selector);
  res.json(result);
});
app.post('/api/browser/type', express.json(), async (req, res) => {
  const result = await browserAgent.type(req.body.sessionId, req.body.selector, req.body.text);
  res.json(result);
});
app.post('/api/browser/submit', express.json(), async (req, res) => {
  const result = await browserAgent.submitForm(req.body.sessionId, req.body.formSelector, req.body.data);
  res.json(result);
});
app.get('/api/browser/screenshot/:sessionId', async (req, res) => {
  const result = await browserAgent.screenshot(req.params.sessionId);
  res.json(result);
});
app.post('/api/browser/extract', express.json(), async (req, res) => {
  const result = await browserAgent.extract(req.body.sessionId, req.body.selectors);
  res.json(result);
});
app.get('/api/browser/status', (_req, res) => {
  res.json({
    fullMode: browserAgent.isFullMode(),
    engine: browserAgent.isFullMode() ? 'puppeteer' : 'fetch-fallback',
  });
});

// ═══ SHARED SESSIONS API (Real-time Collaboration) ═══
app.post('/api/sessions/create', express.json(), async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  const result = sharedSessions.createRoom(user?.id || 'anonymous', req.body);
  res.json(result);
});
app.post('/api/sessions/join', express.json(), async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  const result = sharedSessions.joinRoom(req.body.roomId, user?.id || 'anonymous', req.body.name || user?.email);
  res.json(result);
});
app.post('/api/sessions/leave', express.json(), async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  sharedSessions.leaveRoom(req.body.roomId, user?.id || 'anonymous');
  res.json({ success: true });
});
app.post('/api/sessions/message', express.json(), async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  const result = sharedSessions.sendMessage(
    req.body.roomId,
    user?.id || 'anonymous',
    req.body.content,
    req.body.type || 'user'
  );
  res.json(result);
});
app.get('/api/sessions/:roomId', (req, res) => {
  const info = sharedSessions.getRoomInfo(req.params.roomId);
  if (!info) return res.status(404).json({ error: 'Room not found' });
  res.json(info);
});
app.get('/api/sessions', async (req, res) => {
  const user = await getUserFromToken(req).catch(() => null);
  res.json({
    myRooms: sharedSessions.getUserRooms(user?.id || 'anonymous'),
    publicRooms: sharedSessions.listPublicRooms(),
  });
});

// Alias: /api/admin/health → /api/health (audit fix)
app.use('/api/admin/health', healthRouter);

// Alias: /api/admin/media-history → proxy to /api/media/history
app.get('/api/admin/media-history', (req, res) => {
  // ═══ TEMPORARILY DISABLED (trial period) ═══
  // }
  // Forward to media history route
  const supabaseAdmin = req.app.locals.supabaseAdmin;
  if (!supabaseAdmin) return res.json({ media: [] });
  supabaseAdmin
    .from('media_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
    .then(({ data, error }) => {
      if (error) return res.status(500).json({ error: error.message });
      res.json({ media: data || [], count: (data || []).length });
    })
    .catch((e) => res.status(500).json({ error: e.message }));
});
// ═══ #155: FRONTEND ERROR CAPTURE ENDPOINT ═══
const _frontendErrors = [];
const _errorPatterns = new Map(); // track recurring errors
app.post('/api/brain/errors', express.json(), (req, res) => {
  const { type, message, source, line, url, timestamp } = req.body || {};
  if (!message) return res.status(400).json({ error: 'No message' });

  const err = {
    type,
    message: String(message).substring(0, 500),
    source,
    line,
    url,
    timestamp,
    ip: req.ip,
  };
  _frontendErrors.push(err);
  if (_frontendErrors.length > 200) _frontendErrors.splice(0, 100); // keep last 100

  // Track patterns for self-healing
  const key = `${source}:${line}:${message.substring(0, 50)}`;
  const count = (_errorPatterns.get(key) || 0) + 1;
  _errorPatterns.set(key, count);

  // #154: Self-Healing Brain — log critical patterns
  if (count >= 5) {
    logger.warn({ component: 'SelfHeal', key, count, message }, '🔴 Recurring frontend error detected — needs fix');
    // Store in Supabase for brain analysis
    if (supabaseAdmin) {
      supabaseAdmin
        .from('brain_memory')
        .insert({
          user_id: '00000000-0000-0000-0000-000000000000',
          memory_type: 'error_pattern',
          content: `RECURRING ERROR (${count}x): ${message} at ${source}:${line}`,
          context: { source, line, url, count },
          importance: 9,
        })
        .then()
        .catch((err) => {
          console.error(err);
        });
    }
  }

  logger.info({ component: 'FrontendError', type, source, line }, message);
  res.json({ ok: true });
});

// #154: Self-Healing Brain — Admin endpoint to view error patterns
app.get('/api/admin/frontend-errors', adminAuth, (req, res) => {
  const patterns = [];
  _errorPatterns.forEach((count, key) => {
    patterns.push({ key, count });
  });
  patterns.sort((a, b) => b.count - a.count);
  res.json({
    total: _frontendErrors.length,
    recentErrors: _frontendErrors.slice(-20),
    patterns: patterns.slice(0, 30),
  });
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
      <button class="hc-export" onclick="exportHC()">Export JSON</button>
      <button class="hc-close" onclick="document.getElementById('hc-modal').style.display='none'">Close</button>
    </div>
  </div>
</div>
<script>
var _adminSecret=sessionStorage.getItem('kelion_admin_secret')||'';
var _hcData=null;
/**
 * adminHdrs
 * @returns {*}
 */
function adminHdrs(){return _adminSecret?{'x-admin-secret':_adminSecret}:{};}
/**
 * load
 * @returns {*}
 */
async function load(){
  try{
    const r=await fetch('/api/brain',{headers:adminHdrs()});
    const d=await r.json();
    const g=document.getElementById('grid');
    const statusClass=d.status==='healthy'?'good':d.status==='degraded'?'bad':'warn';
    g.textContent =\`
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
  }catch{document.getElementById('grid').textContent ='<div class="card"><div class="stat bad">OFFLINE</div></div>';}
}
/**
 * esc
 * @param {*} s
 * @returns {*}
 */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
/**
 * ic
 * @param {*} ok
 * @returns {*}
 */
function ic(ok){return ok?'<span class="hc-ok">✅</span>':'<span class="hc-err">❌</span>';}
/**
 * renderHC
 * @param {*} d
 * @returns {*}
 */
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
    h+='<div class="hc-section"><h3>⚠️ Recommendations</h3>';
    for(const r of d.recommendations){h+='<div class="hc-rec">'+esc(r)+'</div>';}
    h+='</div>';
  }
  return h;
}
/**
 * runHealthCheck
 * @returns {*}
 */
async function runHealthCheck(){
  const modal=document.getElementById('hc-modal');
  const body=document.getElementById('hc-body');
  modal.style.display='flex';
  body.textContent ='<div style="text-align:center;color:#00ffff;padding:40px;font-size:1.1rem">⏳ Checking...</div>';
  try{
    const r=await fetch('/api/admin/health-check',{headers:adminHdrs()});
    const d=await r.json();
    if(r.status===401){body.textContent ='<div style="color:#ff4444;padding:20px">❌ Unauthorized. Set admin secret in sessionStorage (kelion_admin_secret).</div>';return;}
    _hcData=d;
    body.textContent =renderHC(d);
  }catch(e){body.textContent ='<div style="color:#ff4444;padding:20px">❌ Error: '+esc(e.message)+'</div>';}
}
/**
 * exportHC
 * @returns {*}
 */
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

// ═══ PAYMENTS, LEGAL, MESSENGER & DEVELOPER ROUTES ═══
app.use('/api/payments', paymentsRouter);
app.use('/api/legal', legalRouter);

// ═══ GDPR ROUTES ═══
app.get('/api/gdpr/consent-status', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.json({ consented: false, categories: {} });
    if (!supabaseAdmin) return res.json({ consented: false, categories: {} });
    const { data } = await supabaseAdmin
      .from('user_preferences')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'gdpr_consent')
      .maybeSingle();
    res.json(
      data?.value || {
        consented: false,
        categories: { essential: true, analytics: false, marketing: false },
      }
    );
  } catch {
    res.json({ consented: false, categories: { essential: true } });
  }
});
app.post('/api/gdpr/export', express.json(), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });
    const { data: prefs } = await supabaseAdmin.from('user_preferences').select('*').eq('user_id', user.id);
    const { data: convos } = await supabaseAdmin.from('conversations').select('id, created_at').eq('user_id', user.id);
    res.json({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      preferences: prefs || [],
      conversations: convos || [],
    });
  } catch {
    res.status(500).json({ error: 'Export error' });
  }
});
app.post('/api/gdpr/delete', express.json(), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });
    // Mark for deletion (actual deletion requires admin approval)
    await supabaseAdmin.from('user_preferences').upsert(
      {
        user_id: user.id,
        key: 'gdpr_delete_requested',
        value: { requestedAt: new Date().toISOString() },
      },
      { onConflict: 'user_id,key' }
    );
    res.json({
      success: true,
      message: 'Deletion request received. Your data will be removed within 30 days as per GDPR.',
    });
  } catch {
    res.status(500).json({ error: 'Delete request error' });
  }
});
app.use('/api/messenger', messengerRouter);
app.use('/api/telegram', express.json(), telegramRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/instagram', instagram.router);
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
// Auto-detect Instagram Business Account ID from Graph API
app.get('/api/media/instagram/detect-account', async (req, res) => {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return res.status(400).json({ error: 'No FB_PAGE_ACCESS_TOKEN set' });
  try {
    const results = {};

    // Method 1: Direct /me with Page Token → gets page info + IG account
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,instagram_business_account&access_token=${token}`
    );
    const meData = await meRes.json();
    results.method1_me = meData;

    if (meData.instagram_business_account?.id) {
      return res.json({
        found: true,
        instagramAccountId: meData.instagram_business_account.id,
        pageName: meData.name,
        pageId: meData.id,
        instruction: `Set INSTAGRAM_ACCOUNT_ID=${meData.instagram_business_account.id} in Railway env vars`,
      });
    }

    // Method 2: Try with explicit FB_PAGE_ID if set
    const pageId = process.env.FB_PAGE_ID;
    if (pageId) {
      const pgRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account,name&access_token=${token}`
      );
      const pgData = await pgRes.json();
      results.method2_pageId = pgData;

      if (pgData.instagram_business_account?.id) {
        return res.json({
          found: true,
          instagramAccountId: pgData.instagram_business_account.id,
          pageName: pgData.name,
          pageId: pageId,
          instruction: `Set INSTAGRAM_ACCOUNT_ID=${pgData.instagram_business_account.id} in Railway env vars`,
        });
      }
    }

    // Method 3: List accounts (works with User Token only)
    const acctRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account&access_token=${token}`
    );
    const acctData = await acctRes.json();
    results.method3_accounts = acctData.error ? { error: acctData.error.message } : acctData;

    if (acctData.data) {
      for (const page of acctData.data) {
        if (page.instagram_business_account?.id) {
          return res.json({
            found: true,
            instagramAccountId: page.instagram_business_account.id,
            pageName: page.name,
            pageId: page.id,
            instruction: `Set INSTAGRAM_ACCOUNT_ID=${page.instagram_business_account.id} in Railway env vars`,
          });
        }
      }
    }

    res.json({
      found: false,
      instruction:
        'Could not auto-detect. Check that your FB Page is connected to an Instagram Business Account in Meta Business Suite.',
      debug: results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/media/status', adminAuth, (req, res) => {
  res.json({
    messenger: {
      hasToken: !!process.env.FB_PAGE_ACCESS_TOKEN,
      health: '/api/messenger/health',
    },
    telegram: {
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      health: '/api/telegram/health',
    },
    facebook: fbPage.getHealth(),
    instagram: instagram.getHealth(),
    news: {
      scheduler: 'active',
      hours: [5, 12, 18],
      endpoint: '/api/news/public',
    },
  });
});

// ═══ MEDIA PUBLISH ENDPOINT ═══
app.post('/api/media/publish', adminAuth, async (req, res) => {
  try {
    const { platform, content, imageUrl, caption } = req.body;
    if (!platform || !content) {
      return res.status(400).json({ error: 'platform and content are required' });
    }

    const results = {};

    if (platform === 'facebook' || platform === 'all') {
      try {
        const fbResult = await fbPage.publish({
          message: content,
          link: imageUrl,
        });
        results.facebook = { success: true, data: fbResult };
      } catch (e) {
        results.facebook = { success: false, error: e.message };
      }
    }

    if (platform === 'instagram' || platform === 'all') {
      try {
        const igResult = await instagram.publish({
          caption: caption || content,
          imageUrl: imageUrl,
        });
        results.instagram = { success: true, data: igResult };
      } catch (e) {
        results.instagram = { success: false, error: e.message };
      }
    }

    res.json({ published: true, platform, results });
  } catch (e) {
    res.status(500).json({ error: 'Publish failed: ' + e.message });
  }
});

// ═══ VOICE CLONE LIST (alias for /api/voice/clone GET) ═══
app.get('/api/voice-clone/list', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);
    if (!user || !supabaseAdmin) return res.json({ voices: [] });

    const { data } = await supabaseAdmin
      .from('user_preferences')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'cloned_voice_id');

    const voices = (data || [])
      .filter((d) => d.value && d.value.voice_id)
      .map((d) => ({
        voiceId: d.value.voice_id,
        name: d.value.name,
        createdAt: d.value.created_at,
      }));

    res.json({ voices });
  } catch {
    res.json({ voices: [] });
  }
});

// ═══ RADIO STATIONS ENDPOINT ═══
app.get('/api/radio/stations', (req, res) => {
  res.json({
    stations: [
      {
        name: 'RadioZU',
        url: 'https://www.radiozu.ro',
        country: 'RO',
        genre: 'Pop/Dance',
      },
      {
        name: 'Kiss FM',
        url: 'https://www.kissfm.ro',
        country: 'RO',
        genre: 'Pop/Hits',
      },
      {
        name: 'Spotify',
        url: 'https://open.spotify.com',
        country: 'Global',
        genre: 'All',
      },
    ],
  });
});

// ═══ COOKIE CONSENT ENDPOINT ═══
app.post(
  '/api/cookie-consent',
  express.json(),
  asyncHandler(async (req, res) => {
    const { analytics = false, marketing = false, functional = true, sessionId } = req.body;
    const user = req.app.locals.getUserFromToken ? await req.app.locals.getUserFromToken(req) : null;
    try {
      await supabaseAdmin.from('cookie_consents').insert({
        user_id: user?.id || null,
        session_id: sessionId || req.headers['x-session-id'] || null,
        analytics,
        marketing,
        functional,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']?.substring(0, 200),
        created_at: new Date().toISOString(),
      });
      res.json({
        success: true,
        consent: { analytics, marketing, functional },
      });
    } catch {
      res.status(500).json({ error: 'Failed to save consent' });
    }
  })
);

// ═══ PUBLISH NEWS TO ALL MEDIA (admin trigger) ═══
app.post(
  '/api/media/publish-news',
  adminAuth,
  express.json(),
  asyncHandler(async (req, res) => {
    const articles = req.body.articles || [];
    const results = { facebook: null, telegram: null };
    if (articles.length > 0) {
      results.facebook = await fbPage.publishNewsBatch(articles, req.body.maxPosts || 3);
      await broadcastNews(articles);
      results.telegram = 'broadcasted';
    }
    res.json({ success: true, results });
  })
);

// POST /api/ticker/disable — save ticker preference (Premium only)
app.post(
  '/api/ticker/disable',
  asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    if (!user || !supabaseAdmin) return res.status(401).json({ error: 'Auth required' });
    const { data: sub } = await supabaseAdmin.from('subscriptions').select('plan').eq('user_id', user.id).single();
    if (sub?.plan !== 'premium') return res.status(403).json({ error: 'Premium only' });
    await supabaseAdmin
      .from('user_preferences')
      .upsert({ user_id: user.id, key: 'ticker_disabled', value: req.body.disabled }, { onConflict: 'user_id,key' });
    res.json({ success: true });
  })
);

// ═══ NEWS BOT ═══
const newsModule = require('./news');
// Public endpoint — no auth required (for frontend news widget)
app.get('/api/news/public', (req, res) => {
  const allReq = Object.assign({}, req, { url: '/latest', query: req.query });
  newsModule.router.handle(allReq, res, () => {
    res.json({
      articles: [],
      total: 0,
      message: 'No articles cached yet. RSS fetches at 05:00, 12:00, 18:00 RO time.',
    });
  });
});
app.use('/api/news', adminAuth, newsModule.router);
newsModule.setSupabase(supabaseAdmin);
newsModule.setBrain(brain);
newsModule.restoreCache();
setMessengerSupabase(supabaseAdmin);
setTelegramSupabase(supabaseAdmin);
setWhatsappSupabase(supabaseAdmin);
instagram.setSupabase(supabaseAdmin);

// ═══ AUTO-PUBLISH: when news fetches, distribute to all media ═══
newsModule.onNewsFetched(async (articles) => {
  logger.info({ component: 'MediaAutoPublish', count: articles.length }, '📢 Auto-publishing news...');
  // Facebook Page (top 3 articles)
  try {
    await fbPage.publishNewsBatch(articles, 3);
  } catch (e) {
    logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'FB Page publish failed');
  }
  // Telegram channel broadcast
  try {
    await broadcastNews(articles);
  } catch (e) {
    logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Telegram broadcast failed');
  }
  // Instagram auto-publish (top article with image)
  try {
    const topArticle = articles.find((a) => a.imageUrl || a.image_url) || articles[0];
    if (topArticle && instagram.publishNewsBatch) {
      await instagram.publishNewsBatch([topArticle], 1);
    }
  } catch (e) {
    logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Instagram publish failed');
  }
  // Messenger subscribers notification
  try {
    await notifySubscribersNews(articles);
  } catch (e) {
    logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Messenger subscribers notification failed');
  }
});

// ═══ STORE ARTICLES REF IN app.locals for Telegram bot ═══
app.locals._getNewsArticles = newsModule.getArticlesArray;

// ═══ TRADING BOT (admin only) ═══
app.use('/api/trading', adminAuth, require('./trading'));

// ═══ K1 BRAIN CHAT (admin only — direct brain access) ═══
app.use('/api/admin/brain-chat', adminAuth, require('./routes/brain-chat'));

// ═══ REAL-TIME ENGINE + MARKET LEARNER + FOREX ═══
const wsEngine = require('./ws-engine');
const marketLearner = require('./market-learner');
const forexEngine = require('./forex-engine');

// Initialize with Supabase
if (app.locals.supabaseAdmin) {
  wsEngine.setSupabase(app.locals.supabaseAdmin);
  marketLearner
    .init(app.locals.supabaseAdmin)
    .catch((e) => logger.warn({ err: e.message }, 'MarketLearner init warning'));
  const perfTracker = require('./performance-tracker');
  perfTracker.init(app.locals.supabaseAdmin);
}
wsEngine.start();
app.locals.wsEngine = wsEngine;
app.locals.marketLearner = marketLearner;
app.locals.forexEngine = forexEngine;

// ── Forex routes ──
app.get('/api/trading/forex/session', adminAuth, (req, res) => {
  res.json(forexEngine.getCurrentSession());
});
app.get('/api/trading/forex/pairs', adminAuth, (req, res) => {
  res.json({
    pairs: forexEngine.getAllPairs(),
    bestNow: forexEngine.getBestPairsNow(),
  });
});
app.post('/api/trading/forex/lot-size', adminAuth, (req, res) => {
  const { pair, balance, riskPct, slPips } = req.body || {};
  res.json(forexEngine.calculateLotSize(pair, balance || 10000, riskPct || 1, slPips || 20));
});
app.post('/api/trading/forex/check', adminAuth, (req, res) => {
  const { pair, direction, bid, ask } = req.body || {};
  res.json(forexEngine.preTradeCheck(pair, direction, bid, ask));
});
app.get('/api/trading/forex/account', adminAuth, async (req, res) => {
  res.json(await forexEngine.getAccountSummary());
});

// ── WS Engine stats ──
app.get('/api/trading/ws-stats', adminAuth, (req, res) => {
  res.json(wsEngine.getStats());
});
app.get('/api/trading/ws-prices', adminAuth, (req, res) => {
  res.json(wsEngine.getAllPrices());
});
app.get('/api/trading/ws-candles/:asset/:tf?', adminAuth, (req, res) => {
  const candles = wsEngine.getCandles(req.params.asset, req.params.tf || '1m', 100);
  res.json({
    asset: req.params.asset,
    tf: req.params.tf || '1m',
    candles,
    count: candles.length,
  });
});

// ── Learner routes ──
app.get('/api/trading/learner', adminAuth, (req, res) => {
  res.json(marketLearner.getReport());
});
app.get('/api/trading/learner/weights', adminAuth, (req, res) => {
  res.json(marketLearner.getWeights());
});
app.post('/api/trading/learner/save', adminAuth, async (req, res) => {
  await marketLearner.saveState();
  res.json({ success: true, message: 'Learning state saved' });
});

// ═══ SPORTS BOT — REMOVED (no real utility without betting integration) ═══

// GET /api/media/history — Media history from brain
app.get('/api/media/history', async (req, res) => {
  const { supabaseAdmin } = req.app.locals;
  if (!supabaseAdmin) return res.status(503).json({ error: 'No database connection' });
  try {
    const { data, error } = await supabaseAdmin
      .from('media_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ media: data || [], count: (data || []).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WebSocket endpoints — placeholder so Express doesn't 404 before upgrade
app.get('/api/voice-stream', (req, res) => {
  res.status(426).json({ error: 'Upgrade to WebSocket required' });
});
// Note: /api/voice-realtime removed — now handled by Socket.io (/voice-realtime namespace)

// 404 for unknown API routes — must come before the catch-all
app.use('/api', (req, res, _next) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// (admin panel handlers already registered above, before express.static)

// ═══ PUBLIC PAGE REDIRECTS (trailing-slash canonical) ═══
app.get('/privacy', (req, res) => res.redirect(301, '/privacy/'));
app.get('/terms', (req, res) => res.redirect(301, '/terms/'));
app.get('/gdpr', (req, res) => res.redirect(301, '/gdpr/'));
app.get('/cookie-policy', (req, res) => res.redirect(301, '/cookie-policy/'));
app.get('/premium', (req, res) => res.redirect(301, '/pricing/'));
app.get('/refund-policy', (req, res) => res.redirect(301, '/refund-policy/'));

// ═══ STANDALONE LEGAL PAGES — explicit handlers (not relying on express.static) ═══
const _legalPages = {};
for (const page of ['privacy', 'terms', 'gdpr', 'cookie-policy', 'refund-policy']) {
  const filePath = path.join(__dirname, '..', 'app', page, 'index.html');
  if (fs.existsSync(filePath)) {
    _legalPages[page] = fs.readFileSync(filePath, 'utf8');
    logger.info({ component: 'Routes' }, `Legal page loaded: /${page}/`);
  }
}

app.get('/privacy/', (req, res) => {
  if (!_legalPages.privacy) return res.status(404).type('html').send(_raw404Html);
  res.type('html').send(_legalPages.privacy);
});
app.get('/terms/', (req, res) => {
  if (!_legalPages.terms) return res.status(404).type('html').send(_raw404Html);
  res.type('html').send(_legalPages.terms);
});
app.get('/gdpr/', (req, res) => {
  if (!_legalPages.gdpr) return res.status(404).type('html').send(_raw404Html);
  res.type('html').send(_legalPages.gdpr);
});
app.get('/cookie-policy/', (req, res) => {
  if (!_legalPages['cookie-policy']) return res.status(404).type('html').send(_raw404Html);
  res.type('html').send(_legalPages['cookie-policy']);
});
app.get('/refund-policy/', (req, res) => {
  if (!_legalPages['refund-policy']) return res.status(404).type('html').send(_raw404Html);
  res.type('html').send(_legalPages['refund-policy']);
});

// ═══ SPA ROUTE WHITELIST — only serve index.html for known UI routes ═══
const SPA_ROUTES = new Set([
  '/',
  '/app',
  '/login',
  '/signup',
  '/pricing',
  '/pricing/',
  '/onboarding',
  '/settings',
  '/developer',
  '/landing',
  '/error',
]);

app.get('*', (req, res) => {
  // Only serve SPA for whitelisted UI routes — everything else is 404
  if (!SPA_ROUTES.has(req.path)) {
    return res.status(404).type('html').send(_raw404Html);
  }
  const nonce = res.locals.cspNonce || '';
  const html = _indexHtml.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
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
      error: statusCode === 500 ? 'Internal server error' : err.message,
    });
  }
  logger.error({ component: 'Error', method: req.method, path: req.path, err: err.stack }, err.message);
  res.status(statusCode).json({
    error: err.message,
    stack: err.stack,
    details: err.details || undefined,
  });
});

// ═══ STARTUP ═══
function logConfigHealth() {
  const checks = [
    {
      name: 'FB_PAGE_ACCESS_TOKEN',
      set: !!process.env.FB_PAGE_ACCESS_TOKEN,
      for: 'Messenger Bot',
    },
    {
      name: 'FB_APP_SECRET',
      set: !!process.env.FB_APP_SECRET,
      for: 'Messenger Security',
    },
    {
      name: 'FB_VERIFY_TOKEN',
      set: !!process.env.FB_VERIFY_TOKEN,
      for: 'Messenger Webhook',
    },
    {
      name: 'FB_PAGE_ID',
      set: !!process.env.FB_PAGE_ID,
      for: 'Facebook Page Posts',
    },
    {
      name: 'TELEGRAM_BOT_TOKEN',
      set: !!process.env.TELEGRAM_BOT_TOKEN,
      for: 'Telegram Bot',
    },
    {
      name: 'OPENAI_API_KEY',
      set: !!process.env.OPENAI_API_KEY,
      for: 'AI Brain (OpenAI)',
    },
    {
      name: 'GROQ_API_KEY',
      set: !!process.env.GROQ_API_KEY,
      for: 'AI Brain (Groq)',
    },
    { name: 'SUPABASE_URL', set: !!process.env.SUPABASE_URL, for: 'Database' },
    {
      name: 'SUPABASE_SERVICE_KEY',
      set: !!process.env.SUPABASE_SERVICE_KEY,
      for: 'Database Admin',
    },
    {
      name: 'ELEVENLABS_API_KEY',
      set: !!process.env.ELEVENLABS_API_KEY,
      for: 'Voice TTS',
    },
    {
      name: 'INSTAGRAM_ACCOUNT_ID',
      set: !!process.env.INSTAGRAM_ACCOUNT_ID,
      for: 'Instagram Posts',
    },
    {
      name: 'STRIPE_SECRET_KEY',
      set: !!process.env.STRIPE_SECRET_KEY,
      for: 'Payments',
    },
  ];
  const missing = checks.filter((c) => !c.set);
  const configured = checks.filter((c) => c.set);

  logger.info(
    {
      component: 'Config',
      configured: configured.length,
      total: checks.length,
    },
    `✅ ${configured.length}/${checks.length} secrets configured`
  );

  if (missing.length > 0) {
    missing.forEach((m) => {
      logger.warn(
        { component: 'Config', secret: m.name, service: m.for },
        `⚠️ Missing: ${m.name} — ${m.for} will not work`
      );
    });
  }
}

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    logger.fatal({ component: 'Process', err: err.stack }, 'Uncaught Exception: ' + err.message);
    // DO NOT exit — keep server alive, Railway will restart if truly broken
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ component: 'Process', reason: String(reason) }, 'Unhandled Rejection: ' + reason);
    // DO NOT exit — keep server alive
  });

  // ── Create HTTP server for WebSocket support ──
  const server = http.createServer(app);

  // ── Create Socket.io server (used by voice-first) ──
  const { Server: SocketIOServer } = require('socket.io');
  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Attach Voice Stream WebSocket (classic pipeline — stays raw WS) ──
  const { setupVoiceStream } = require('./routes/voice-stream');
  setupVoiceStream(server, app.locals);
  logger.info({ component: 'VoiceStream' }, 'WebSocket voice pipeline mounted on /api/voice-stream');

  // ── Attach Voice-First (OpenAI Realtime) via Socket.io ──
  const { setupRealtimeVoice } = require('./routes/voice-realtime');
  setupRealtimeVoice(io, app.locals);
  logger.info({ component: 'VoiceRealtime' }, 'Socket.io voice-first mounted on /voice-realtime namespace');

  // ── Attach Collaboration WebSocket ──
  const { setupCollaboration } = require('./collaboration');
  setupCollaboration(server);

  setupGracefulShutdown(server);

  runMigration()
    .then((migrated) => {
      logConfigHealth();
      // Initialize cache layer (Redis if REDIS_URL set, else in-memory)
      initCache().catch((e) => logger.warn({ err: e.message }, 'Cache init warning'));
      app.locals.cacheGet = cacheGet;
      app.locals.cacheSet = cacheSet;
      app.locals.getCacheStats = getCacheStats;
      // Scalability stats + functions
      app.locals.getCircuitStats = getCircuitStats;
      app.locals.getBlacklistStats = getBlacklistStats;
      app.locals.getLoadStats = getLoadStats;
      app.locals.getQueueStats = getQueueStats;
      app.locals.circuitAllow = circuitAllow;
      app.locals.circuitSuccess = circuitSuccess;
      app.locals.circuitFailure = circuitFailure;
      app.locals.enqueueTask = enqueueTask;
      // Prevent Railway proxy timeouts
      server.keepAliveTimeout = 65000; // 65s (Railway proxy = 60s)
      server.headersTimeout = 70000; // 70s > keepAliveTimeout
      server.listen(
        PORT,
        process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          '127.0.0.1',
        () => {
          logger.info(
            {
              component: 'Server',
              port: PORT,
              ai: {
                gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
                gpt4o: !!process.env.OPENAI_API_KEY,
                deepseek: !!process.env.DEEPSEEK_API_KEY,
              },
              tts: !!process.env.ELEVENLABS_API_KEY,
              voiceStream: true,
              payments: !!process.env.STRIPE_SECRET_KEY,
              db: !!supabaseAdmin,
              migration: !!migrated,
            },
            'KelionAI v2.5 started on port ' + PORT + ' (with voice streaming)'
          );
          // Smoke test internal routes (async, non-blocking)
          smokeTest(PORT).catch((err) => {
            console.error(err);
          });

          // Self-ping keepalive — prevent Railway idle sleep (every 4 min)
          const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
          setInterval(
            () => {
              fetch(`${APP_URL}/api/health`).catch((err) => {
                console.error(err);
              });
            },
            4 * 60 * 1000
          ).unref();
          // Auto-register Telegram webhook
          if (process.env.TELEGRAM_BOT_TOKEN && process.env.APP_URL) {
            const webhookUrl = `${process.env.APP_URL}/api/telegram/webhook`;
            fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: webhookUrl }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.ok) logger.info({ component: 'Telegram' }, `✅ Webhook registered: ${webhookUrl}`);
                else logger.warn({ component: 'Telegram', error: data.description }, '❌ Webhook registration failed');
              })
              .catch((e) => logger.error({ component: 'Telegram', err: e.message }, 'Webhook registration error'));
          }
        }
      );
    })
    .catch(() => {
      logger.error({ component: 'Server' }, 'Migration error');
      server.listen(
        PORT,
        process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          '127.0.0.1',
        () => logger.info({ component: 'Server', port: PORT }, 'KelionAI v2.5 on port ' + PORT + ' (migration failed)')
      );
    });
}

/**
 * undefined
 * @returns {*}
 */
module.exports = app;
// deploy trigger
