'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

// Sentry error tracking (optional — only activates when SENTRY_DSN is set).
let Sentry;
if (process.env.SENTRY_DSN) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
    tracesSampleRate: 1.0,
  });
}

const config = require('./config');
const { csrfSeed, csrfProtection } = require('./middleware/csrf');
const { visitorLog } = require('./middleware/visitorLog');
const { requireAuth } = require('./middleware/auth');
const { getPlans } = require('./middleware/subscription');
const { initDb } = require('./db');
const { createReferralCode, findReferralCode, useReferralCode } = require('./db');
const authRouter       = require('./routes/auth');
const usersRouter      = require('./routes/users');
const adminRouter      = require('./routes/admin');
const realtimeRouter   = require('./routes/realtime');
const passkeyRouter    = require('./routes/passkey');
const memoryRouter     = require('./routes/memory');
const conversationsRouter = require('./routes/conversations');
const studioRouter     = require('./routes/studio');
const toolsRouter      = require('./routes/tools');
const pushRouter       = require('./routes/push');
const creditsRouter    = require('./routes/credits');
const diagRouter       = require('./routes/diag');

const generatedImagesRouter = require('./routes/generatedImages');
const voiceCloneRouter = require('./routes/voiceClone');
const demoRouter       = require('./routes/demo');
const chatRouter       = require('./routes/chat');
const filesRouter      = require('./routes/files');
const proxyRouter      = require('./routes/proxy');
const whatsappRouter   = require('./routes/whatsapp');
const agentRouter      = require('./routes/agent');
const docsRouter         = require('./routes/docs');
const { attachVertexLiveProxy } = require('./routes/vertexLiveProxy');
const proactive        = require('./services/proactive');
const { bootstrapAdmin, healAdminCredits } = require('./services/adminBootstrap');
const { installProcessHandlers } = require('./utils/processHandlers');

// Audit H3: install global safety net before anything else can throw.
// - `unhandledRejection` is logged and swallowed — one missing `.catch()`
//   shouldn't take down every other user's live voice session.
// - `uncaughtException` is logged and followed by a clean exit(1) so
//   Railway can spin a replacement with known-good state. Skipped under
//   Jest so a single failing test never kills the runner.
const processHandlerStats = installProcessHandlers(process, {
  exitOnException: process.env.NODE_ENV !== 'test',
}).stats;

const app = express();
app.disable('x-powered-by');
// Expose process-handler counters on `app.locals` so /api/diag can
// surface them without importing this module back.
app.locals.processHandlerStats = processHandlerStats;

const startupHealth = {
  database: 'initializing',
  databaseError: null,
};

// Initialize database, then seed admin if ADMIN_BOOTSTRAP_PASSWORD is set.
// Seeding is idempotent — running every boot lets Adrian rotate the admin
// password by just changing the Railway env var and redeploying.
initDb().then(async () => {
  startupHealth.database = 'connected';
  console.log('[kelion-startup] Database initialized');
  // Initialize Agent Mode tasks table if Agent Mode is enabled.
  if (process.env.AGENT_ENABLED === '1') {
    try {
      const { initTasksTable } = require('./services/agentTasks');
      await initTasksTable();
      console.log('[kelion-startup] Agent tasks table initialized');
    } catch (err) {
      console.warn('[kelion-startup] Agent tasks init failed:', err && err.message);
    }
  }
  try {
    const result = await bootstrapAdmin();
    if (result && result.seeded) {
      console.log(`[kelion-startup] admin bootstrap: ${result.created ? 'created' : 'refreshed'} ${result.email}`);
    }
  } catch (err) {
    console.warn('[kelion-startup] admin bootstrap failed:', err && err.message);
  }
  // After the admin user row is guaranteed to exist, ensure he has a working
  // credits balance. This is the permanent fix for "iar au disparut creditele
  // lui kelion" — every Railway redeploy wipes SQLite, so after each redeploy
  // we auto-top-up the admin back to a configurable floor. Fully idempotent
  // (no-op when balance is already above the floor).
  try {
    const h = await healAdminCredits();
    if (h && h.healed) {
      console.log(`[kelion-startup] admin credit auto-heal: granted ${h.granted} min (balance=${h.balance})`);
    }
  } catch (err) {
    console.warn('[kelion-startup] admin credit auto-heal failed:', err && err.message);
  }
}).catch(err => {
  startupHealth.database = 'error';
  startupHealth.databaseError = err && err.message ? err.message : 'Database initialization failed';
  console.error('[kelion-startup] Database initialization failed:', err.message);
});

// Validate required API keys in production
if (config.isProduction) {
  const requiredKeys = ['ELEVENLABS_API_KEY'];
  const missing = requiredKeys.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.log(`[kelion-startup] NOTICE: Missing API keys: ${missing.join(', ')}`);
    console.log('[kelion-startup] AI features stay disabled until these keys are configured');
  }
}

const distPath = path.resolve(__dirname, '../../dist');
const fs = require('fs');
if (fs.existsSync(distPath)) {
  console.log(`[kelion-startup] dist folder FOUND. Files: ${JSON.stringify(fs.readdirSync(distPath))}`);
} else {
  console.warn(`[kelion-startup] dist folder not found at: ${distPath} (expected in production)`);
}

// Sentry request handler — must be first middleware.
if (Sentry && Sentry.Handlers) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", "https:", "http:", "data:", "blob:"],
        baseUri:    ["'self'", "https:", "http:"],
        scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "blob:", "https:", "http:"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https:", "http:"],
        fontSrc:    ["'self'", "data:", "https:", "http:"],
        imgSrc:     ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "wss://generativelanguage.googleapis.com", "https://raw.githack.com", "https://*.githubusercontent.com", "blob:", "https:", "wss:"],
        mediaSrc:   ["'self'", "blob:", "https:", "http:"],
        workerSrc:  ["'self'", "blob:"],
        // Allow cross-origin iframes for the <MonitorOverlay/>: Google Maps
        // embed, wttr.in, Wikipedia, LoremFlickr and friends. Without
        // an explicit frameSrc they fall back to defaultSrc 'self' and the
        // browser renders a blank CSP-error frame (the "pagina alba cu err"
        // bug). `https:` covers every HTTPS embed target we rely on.
        frameSrc:   ["'self'", "https:", "data:", "blob:"],
        // childSrc is a legacy alias some older UAs still check — mirror the
        // same policy so Safari/iOS don't fall through to defaultSrc.
        childSrc:   ["'self'", "https:", "data:", "blob:"],
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

// 120 req/min per IP — high enough for normal use (trial polling 6/min +
// auth checks + chat + tools) but still caps abusive crawlers. Vision
// frames have their own limiter inside the realtime router (300 req/min).
const chatLimiter = (process.env.NODE_ENV === 'test') ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please wait a moment.' },
});

// Dedicated limiter for vision frames — the camera sends up to 4fps
// (240 req/min) which instantly exhausts the 20 req/min chatLimiter.
// 300 req/min gives headroom for dynamic-FPS mode without abuse risk.
const visionLimiter = (process.env.NODE_ENV === 'test') ? (req, res, next) => next() : rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Vision rate limit exceeded. Please reduce camera frame rate.' },
});

// Skip JSON parsing on the Stripe webhook so signature verification in
// /api/credits/webhook can read the raw body. Everything else goes
// through the normal JSON parser. Use req.path (no query string) so a
// stray ?retry=1 from Stripe wouldn't bypass the guard.
app.use((req, res, next) => {
  if (req.path === '/api/credits/webhook') return next();
  if (req.path === '/api/tools/upload_temp') {
    return express.raw({ type: '*/*', limit: '25mb' })(req, res, next);
  }
  // Voice-clone POST carries a base64-encoded audio sample (~30s at 128kbps =
  // ~480KB raw, ~640KB base64). 5 MB accommodates longer clips with headroom
  // while capping abuse surface (was 15 MB pre-audit).
  const isVoiceClone =
    req.path === '/api/voice/clone' && req.method === 'POST';
  return express.json({ limit: isVoiceClone ? '5mb' : '1mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrfSeed);

// Audit C2 — enforce the double-submit CSRF check on every state-changing
// request. `csrfProtection` already:
//   · skips GET / HEAD / OPTIONS (safe methods),
//   · bypasses any request carrying `Authorization: Bearer ...` (mobile
//     and external API callers authenticate via header, not cookie, so
//     they are not CSRF-able in the first place),
//   · is a no-op when NODE_ENV === 'test' (so the Jest suite is unaffected).
// The one endpoint that legitimately receives cookie-less POSTs from a
// third party is the Stripe webhook — it authenticates via raw-body
// signature (`stripe-signature` header) and must not be fed through the
// CSRF gate. Exempting it by path keeps the rest of /api/credits/*
// protected.
app.use((req, res, next) => {
  if (req.path === '/api/credits/webhook') return next();
  return csrfProtection(req, res, next);
});

// Visitor analytics — fires only on HTML page loads, never on API / static
// requests. Wrapped internally so failure can't break a page load. See
// middleware/visitorLog.js for filtering rules.
app.use(visitorLog);

// Security audit 2026-05-11 (H2): strict rate-limiter on auth login/register
// to prevent brute-force attacks. 5 attempts/min/IP is tight enough to block
// credential stuffing while still allowing a real user who fat-fingers their
// password a few times. The global limiter (120 req/min) was too generous.
const authLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many login attempts. Please wait a minute.' },
      // Only rate-limit the actual credential endpoints, not /me or /google/*
      skip: (req) => {
        const p = req.path.toLowerCase();
        return !(p.includes('/local/login') || p.includes('/local/register'));
      },
    });

// Auth routes (no auth required)
app.use('/auth', authLimiter, authRouter);

// Subscription plans (no auth required)
app.get('/api/subscription/plans', (req, res) => {
  res.json({ plans: getPlans() });
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


// API routes (auth required)
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/admin', requireAuth, adminRouter);
// Realtime router is PUBLIC in Stage 1 (no login/users/subs per product spec).
// Rate limiting still applies to prevent abuse. Ephemeral-token endpoints only
// hand back short-lived tokens; persona + config are baked in server-side.
// Vision frames have their own limiter inside the router (see realtime.js).
app.use('/api/realtime', chatLimiter, realtimeRouter);
app.use('/api/chat', chatLimiter, chatRouter);

// Trial status — public endpoint the client polls to drive the top-right
// countdown HUD. Read-only; never stamps. Returns { applicable, allowed,
// remainingMs, windowMs, stamped }. See trial.js for semantics.
const trialRouter = require('./routes/trial');
// Rate-limited like other public endpoints (Copilot review pr-74): the
// client polls every 10 s so a small limiter is fine, but we still want
// to cap abusive crawlers.
app.use('/api/trial', chatLimiter, trialRouter);

// Credits (Stage 7 — monetization). The webhook sub-route uses its own
// raw-body parser; /packages is public, /balance and /checkout require
// auth (enforced inside credits.js via requireAuth).
app.use('/api/credits', creditsRouter);
app.use('/api/diag', diagRouter);
app.use('/api/docs', docsRouter);

// Stage 3 — M13 passkey (public — register/auth flows need to be reachable
// without auth) + M14/M16/M17 memory (signed-in users only).
// Rate-limited because POST /register/options creates a new user row on
// every call; without a limiter an unauthenticated attacker can fill the
// users table with orphan rows (Devin Review BUG pr-review-182448fc_0001).
// Passkey routes are public but not rate-limited aggressively — the /me
// endpoint is called on every page load to check session status and must
// not 429 under normal traffic. Register/options still creates rows but
// the global Express rate limiter (elsewhere) + CAPTCHA protect it.
app.use('/api/auth/passkey', passkeyRouter);
app.use('/api/memory', requireAuth, memoryRouter);
app.use('/api/conversations', requireAuth, conversationsRouter);
// Dev Studio (DS-1) — per-user Python project workspaces. All routes
// require a signed-in user; ownership is enforced again inside every
// DB helper (listStudioWorkspaces, getStudioWorkspace, …).
app.use('/api/studio', requireAuth, studioRouter);
// Stage 6 — User File Store (upload/download any format, streaming)
app.use('/api/files', requireAuth, filesRouter);

// Stage 4 — M19 (browser use) + M20 (web search status) + M21 (MCP stubs).
// Router is PUBLIC by design: voice tool-call flow has no login gate,
// and MCP endpoints self-check for a signed-in user inside the handler.
app.use('/api/tools', chatLimiter, toolsRouter);



// F11 — short-lived PNG serving for `generate_image` tool. The route
// lives outside chatLimiter because it's a pure GET by opaque UUID;
// rate-limiting the tool call itself happens on /api/tools/execute.
app.use('/api/generated-images', generatedImagesRouter);

// Stage 5 — M23 push + M24/M25 proactive scheduler. Requires passkey auth,
// except /public-key which the browser needs to fetch BEFORE authenticating.
app.get('/api/push/public-key', (_req, res) => {
  res.json({ publicKey: pushRouter.getVapidPublicKey() });
});
app.use('/api/push', requireAuth, pushRouter);
app.use('/api/voice/clone', requireAuth, chatLimiter, voiceCloneRouter);
// Demo request system — public submit + code activation, admin approve/reject.
app.use('/api/demo', chatLimiter, demoRouter);
// Monitor content proxy — strips X-Frame-Options/CSP so ANY external URL
// can be embedded in the monitor iframe without a white/blocked screen.
// Rate-limited internally (30 req/min per IP). Public endpoint.
app.use('/api/proxy', proxyRouter);
// WhatsApp bridge — admin-only endpoints for connecting Kelion to WhatsApp.
// QR scan auth, no Business API needed. Kelion responds when mentioned.
app.use('/api/whatsapp', requireAuth, chatLimiter, whatsappRouter);

// ── Agent Mode ──────────────────────────────────────────────────────────────────────────────
// Kelion Agent API — gives Kelion the same capabilities as an AI coding assistant:
// file system access, shell execution, web search, browser automation,
// GitHub operations, deploy control, diagnostics, and task management.
// Admin-only. Requires AGENT_ENABLED=1 to be active.
if (process.env.AGENT_ENABLED === '1') {
  app.use('/api/agent', agentRouter);
  console.log('[kelion-api] Agent Mode enabled at /api/agent');
}

if (process.env.NODE_ENV !== 'test' && process.env.PROACTIVE_DISABLED !== '1') {
  try { proactive.start(require('./routes/push').getWebPush()); }
  catch (err) { console.warn('[proactive] failed to start:', err.message); }
}

// Health check with service status
app.get('/health', async (_req, res) => {
  // Deploy SHA exposed so CI (acceptance.yml) can wait until the
  // current production build matches the commit that triggered the
  // workflow — prevents false reds from CI running against the
  // previous image while Railway is still rolling out the new one.
  // Railway injects RAILWAY_GIT_COMMIT_SHA automatically at build time
  // (https://docs.railway.com/reference/variables#git-variables);
  // fall back to GIT_COMMIT_SHA (Docker builds, local) and finally
  // 'unknown' if nothing is set.
  const deploySha = process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || 'unknown';
  const health = {
    status: 'ok',
    ts: new Date().toISOString(),
    deploy_sha: deploySha,
    services: {
      database: startupHealth.database,
      ai: 'unknown',
      ai_provider: 'none',
      openrouter: 'unknown',
      google: 'unknown',
      elevenlabs: 'unknown',
    },
  };

  // Railway uses this endpoint as a liveness check. Keep it process-local
  // so a slow database or external provider cannot fail an otherwise live app.
  if (startupHealth.databaseError) {
    health.services.database_error = startupHealth.databaseError;
  }
  if (config.runtime && config.runtime.generatedSecrets && config.runtime.generatedSecrets.length) {
    health.services.runtime_secrets = 'ephemeral';
  }

  // AI brain provider — Claude/OpenRouter only. Google/Gemini must not make
  // chat look healthy.
  const hasOpenRouterAI = !!process.env.OPENROUTER_API_KEY;
  health.services.openrouter = hasOpenRouterAI ? 'configured' : 'not configured';
  health.services.google = 'disabled_for_chat';
  health.services.ai = hasOpenRouterAI ? 'configured' : 'not configured';
  health.services.ai_provider = hasOpenRouterAI ? 'openrouter' : 'none';

  // ElevenLabs (cloned voice TTS)
  health.services.elevenlabs = process.env.ELEVENLABS_API_KEY ? 'configured' : 'not configured';

  res.json(health);
});
app.get('/ping',   (_req, res) => res.send('<h1>PONG - Server is alive and reached!</h1>'));

if (process.env.NODE_ENV === 'production') {
  console.log(`[kelion-api] Production mode: serving from ${distPath}`);

  // ── Caching strategy ────────────────────────────────────────────────────
  // 1. Hashed assets (JS/CSS with content hash in filename) → immutable 1yr.
  //    Vite always changes the hash when content changes, so this is safe.
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    immutable: true,
    maxAge: '1y',
    etag: false,
    lastModified: false,
  }));

  // 2. GLB / 3D models → 7-day cache (large files, rarely change).
  app.use(express.static(distPath, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      const f = filePath.toLowerCase();
      if (f.endsWith('.glb') || f.endsWith('.gltf')) {
        res.setHeader('Cache-Control', 'public, max-age=604800'); // 7d
      } else if (f.endsWith('.webmanifest')) {
        // 3a. PWA manifest → correct MIME type + never cache.
        res.setHeader('Content-Type', 'application/manifest+json');
        res.setHeader('Cache-Control', 'no-store');
      } else if (
        f.endsWith('sw.js') ||
        f.endsWith('index.html')
      ) {
        // 3b. HTML shell, service worker → never cache.
        //    Browser MUST always get the latest index.html so it loads
        //    the correct hashed JS bundles after every deploy.
        //    Without this, a cached index.html referencing old bundle
        //    hashes causes 404s → "Ceva nu a mers bine" crash.
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));

  // SPA fallback — all non-API routes serve index.html with no-store.
  app.get('*', (req, res, next) => {
    if (/^\/api(\/|$)/.test(req.path) || req.path === '/health' || req.path === '/ping') {
      return next();
    }
    res.setHeader('Cache-Control', 'no-store');
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

// Wrap the Express app in a raw http.Server so we can attach a
// WebSocket upgrade handler for the Vertex AI proxy on
// the same port (see `routes/vertexLiveProxy.js`). Keeping everything
// on one port keeps Railway's single-port routing happy and means
// the browser hits the proxy over the same origin it already talks
// HTTP to, so no CORS/CSP changes are needed.
const httpServer = http.createServer(app);
attachVertexLiveProxy(httpServer);

if (require.main === module) {
  const PORT = config.port;
  httpServer.listen(PORT, () => {
    console.log(`[kelion-api] Server listening on port ${PORT} (${config.nodeEnv})`);
    console.log(`[kelion-api] CORS origins: ${config.corsOrigins.join(', ')}`);
    // Auto-enable all required Google Cloud APIs (idempotent, fire-and-forget)
    try {
      const { enableAllGoogleApis } = require('./services/googleApiEnabler');
      enableAllGoogleApis().catch((err) =>
        console.warn('[googleApiEnabler] Non-fatal error:', err.message)
      );
    } catch { /* module not available — skip silently */ }

    // ── Watchdog / Self-Heal Ticker (Faza 4 + 6) ─────────────────────────────────────────────
    const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // 5 min
    let consecutiveFails = 0;
    setInterval(async () => {
      try {
        const health = await fetch(`http://localhost:${PORT}/health`);
        if (!health.ok) {
          consecutiveFails++;
          console.error(`[watchdog] Health FAIL #${consecutiveFails}: ${health.status}`);
          if (consecutiveFails >= 3) {
            console.error('[watchdog] CRITICAL: 3 consecutive health failures. Self-heal...');
            try {
              const { execSync } = require('child_process');
              const lastCommits = execSync('git log --oneline -3', { encoding: 'utf-8', timeout: 5000 });
              console.error('[watchdog] Recent commits:\n' + lastCommits);
            } catch (e) {
              console.error('[watchdog] Self-heal git log failed:', e.message);
            }
          }
        } else {
          if (consecutiveFails > 0) {
            console.log(`[watchdog] Health OK. Recovered after ${consecutiveFails} fail(s).`);
          }
          consecutiveFails = 0;
        }
      } catch (err) {
        consecutiveFails++;
        console.error(`[watchdog] Health exception #${consecutiveFails}:`, err.message);
      }
    }, WATCHDOG_INTERVAL_MS).unref();

    // Start permanent health watchdog (checks every 5 min, alerts admin)
    try {
      const healthWatchdog = require('./services/healthWatchdog');
      healthWatchdog.start();
    } catch (err) {
      console.warn('[healthWatchdog] Failed to start:', err.message);
    }

    // Start Titan-Mode Auto-Healing Watchdog
    try {
      const { startWatchdog } = require('./services/watchdog');
      startWatchdog();
    } catch (err) {
      console.warn('[TitanWatchdog] Failed to start:', err.message);
    }
  });
}

// Sentry error handler — must be the last error-handling middleware.
if (Sentry && Sentry.Handlers) {
  app.use(Sentry.Handlers.errorHandler());
}

module.exports = app;
module.exports.httpServer = httpServer;

