// ═══════════════════════════════════════════════════════════════
// KelionAI — CODE SHIELD v2.0
// Anti-copy, anti-theft, anti-scraping, anti-hotlink
// Source code disclosure: NUMAI în sesiunea admin
// Oricine altcineva întreabă → REFUZ complet, fără detalii
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// ── Fișiere critice monitorizate ──
const CRITICAL_FILES = [
  'server/brain.js',
  'server/brain-self.js',
  'server/persona.js',
  'server/code-shield.js',
  'server/identity-guard.js',
  'server/safety-classifier.js',
  'server/migrate.js',
  'server/supabase.js',
];

const _fileHashes = new Map();
let _instanceId = null;
let _bootTime = null;
let _authorized = false;

// ── IP Blacklist runtime ──
const _blacklist = new Set();
const _suspiciousIPs = new Map(); // ip → { count, firstSeen, lastSeen, reasons[] }
const _requestLog = new Map();    // ip → { count, firstSeen, lastSeen, burst }

// ── Rate limiting windows ──
const WINDOW_MS       = 60 * 1000;  // 1 min
const MAX_REQ_WINDOW  = 300;        // max 300 req/min per IP
const BURST_WINDOW_MS = 5 * 1000;   // 5s
const BURST_MAX       = 50;         // max 50 req in 5s
const SCAN_THRESHOLD  = 20;         // suspicious scan paths before block
const BAN_DURATION_MS = 30 * 60 * 1000; // 30 min ban

// ── Patterns care indică scanare / scraping ──
const SCAN_PATTERNS = [
  /\.(env|git|svn|htaccess|htpasswd|bak|backup|old|orig|tmp|sql|dump|log|cfg|conf|ini|pem|key|crt|p12|pfx)$/i,
  /\/(wp-admin|wp-login|phpMyAdmin|phpmyadmin|adminer|\.well-known\/acme|xmlrpc|actuator|swagger|api-docs|graphiql|playground|console|shell|cmd|exec|eval)/i,
  /\/(etc\/passwd|etc\/shadow|proc\/self|var\/log|windows\/win\.ini)/i,
  /\/(node_modules|\.git|\.env|\.ssh|\.aws|\.docker)/i,
  /\/(server|config|scripts|migrations|seed|fixtures)\//i,
  /(union\s+select|drop\s+table|insert\s+into|exec\s*\(|eval\s*\(|base64_decode|system\s*\()/i,
  /(<script|javascript:|vbscript:|onload=|onerror=|onclick=)/i,
  /(\.\.\/)+(etc|proc|var|tmp|usr|bin|root)/i,
];

// ── User-Agent patterns blocate ──
const BLOCKED_UA_PATTERNS = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i, /dirbuster/i,
  /gobuster/i, /wfuzz/i, /hydra/i, /medusa/i, /burpsuite/i, /zaproxy/i,
  /acunetix/i, /nessus/i, /openvas/i, /w3af/i, /skipfish/i, /arachni/i,
  /python-requests\/[0-9]/i, /go-http-client\/[0-9]/i, /libwww-perl/i,
  /curl\/[0-9]/i, /wget\/[0-9]/i, /scrapy/i, /phantomjs/i, /headless/i,
  /selenium/i, /puppeteer/i, /playwright/i, /mechanize/i, /httpclient/i,
];

// ── Paths care NU trebuie blocate niciodată ──
const SAFE_PREFIXES = [
  '/api/', '/js/', '/css/', '/styles/', '/lib/', '/models/', '/assets/',
  '/admin', '/socket.io', '/health', '/manifest.json', '/sw.js',
  '/favicon.svg', '/favicon.ico', '/', '',
];

// ═══════════════════════════════════════════════════════════════
// INSTANCE ID & INTEGRITY
// ═══════════════════════════════════════════════════════════════
function generateInstanceId() {
  const factors = [
    process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'unknown',
    process.env.RAILWAY_PROJECT_ID || process.env.RENDER_SERVICE_ID || 'local',
    process.env.SUPABASE_URL || 'no-db',
    __dirname,
  ];
  return crypto.createHash('sha256').update(factors.join('|')).digest('hex').substring(0, 16);
}

function hashFile(filePath) {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
  } catch (err) {
    logger.debug({ component: 'CodeShield', err: err.message }, 'hashFile failed');
    return null;
  }
}

function initialize() {
  _bootTime = Date.now();
  _instanceId = generateInstanceId();

  for (const file of CRITICAL_FILES) {
    const hash = hashFile(file);
    if (hash) _fileHashes.set(file, hash);
  }

  _authorized = validateEnvironment();

  if (!_authorized) {
    logger.warn({ component: 'CodeShield', instanceId: _instanceId }, '⚠️ UNAUTHORIZED ENVIRONMENT — restricted mode');
  } else {
    logger.info({ component: 'CodeShield', instanceId: _instanceId, files: _fileHashes.size }, '🛡️ Code Shield v2 initialized');
  }

  // Integrity check la fiecare 5 minute
  setInterval(checkIntegrity, 5 * 60 * 1000);
  // Cleanup blacklist expirat la fiecare 10 minute
  setInterval(_cleanupBlacklist, 10 * 60 * 1000);

  return { instanceId: _instanceId, authorized: _authorized, filesProtected: _fileHashes.size };
}

function validateEnvironment() {
  const hasDeploymentEnv = !!(
    process.env.RAILWAY_ENVIRONMENT || process.env.RENDER_SERVICE_ID ||
    process.env.VERCEL_ENV || process.env.HEROKU_APP_NAME ||
    process.env.FLY_APP_NAME || process.env.KELION_AUTH_TOKEN
  );
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
  const hasAIKey = !!(
    process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY
  );
  if (process.env.KELION_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production') return true;
  return hasDeploymentEnv && hasSupabase && hasAIKey;
}

function checkIntegrity() {
  const violations = [];
  for (const [file, originalHash] of _fileHashes) {
    const currentHash = hashFile(file);
    if (currentHash && currentHash !== originalHash) {
      violations.push({ file, expected: originalHash, actual: currentHash });
    }
  }
  if (violations.length > 0) {
    logger.error({ component: 'CodeShield', violations }, `🚨 TAMPERING DETECTED — ${violations.length} files modified`);
    if (process.env.NODE_ENV !== 'production') {
      for (const v of violations) _fileHashes.set(v.file, v.actual);
    }
  }
  return { clean: violations.length === 0, violations };
}

// ═══════════════════════════════════════════════════════════════
// IP MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function _getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function _markSuspicious(ip, reason) {
  const entry = _suspiciousIPs.get(ip) || { count: 0, firstSeen: Date.now(), lastSeen: Date.now(), reasons: [] };
  entry.count++;
  entry.lastSeen = Date.now();
  if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  _suspiciousIPs.set(ip, entry);

  if (entry.count >= SCAN_THRESHOLD) {
    _blacklist.add(ip + ':' + (Date.now() + BAN_DURATION_MS));
    logger.warn({ component: 'CodeShield', ip, count: entry.count, reasons: entry.reasons }, `🚫 IP auto-banned: ${ip}`);
  }
}

function _isBlacklisted(ip) {
  for (const entry of _blacklist) {
    const [bannedIp, expiresStr] = entry.split(':');
    if (bannedIp === ip) {
      if (Date.now() < parseInt(expiresStr, 10)) return true;
      _blacklist.delete(entry);
    }
  }
  return false;
}

function _cleanupBlacklist() {
  const now = Date.now();
  for (const entry of _blacklist) {
    const [, expiresStr] = entry.split(':');
    if (now >= parseInt(expiresStr, 10)) _blacklist.delete(entry);
  }
  const cutoff = now - 5 * 60 * 1000;
  for (const [ip, e] of _requestLog) {
    if (e.lastSeen < cutoff) _requestLog.delete(ip);
  }
}

// ═══════════════════════════════════════════════════════════════
// SOURCE CODE PROTECTION MIDDLEWARE
// Blochează accesul la fișiere server, .env, .git, etc.
// ═══════════════════════════════════════════════════════════════
function sourceCodeProtectionMiddleware(req, res, next) {
  const reqPath = req.path.toLowerCase();

  // Permite căile sigure
  for (const prefix of SAFE_PREFIXES) {
    if (prefix && reqPath.startsWith(prefix)) return next();
    if (reqPath === prefix) return next();
  }

  // Blochează pattern-uri de scanare
  for (const pattern of SCAN_PATTERNS) {
    if (pattern.test(reqPath)) {
      const ip = _getClientIp(req);
      _markSuspicious(ip, `scan:${reqPath.substring(0, 50)}`);
      logger.warn({ component: 'CodeShield', ip, path: reqPath }, `🔍 Scan attempt blocked`);
      return res.status(404).send('Not found');
    }
  }

  // Blochează extensii server-side
  const ext = path.extname(reqPath);
  const blockedExts = ['.ts', '.env', '.sql', '.yaml', '.yml', '.sh', '.bash', '.py', '.rb', '.go', '.rs'];
  if (blockedExts.includes(ext)) {
    const ip = _getClientIp(req);
    _markSuspicious(ip, `blocked-ext:${ext}`);
    return res.status(404).send('Not found');
  }

  next();
}

// ═══════════════════════════════════════════════════════════════
// API PROTECTION MIDDLEWARE
// Rate limiting, User-Agent blocking, security headers, hotlink
// ═══════════════════════════════════════════════════════════════
function apiProtectionMiddleware(req, res, next) {
  // ── Security headers ──
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('X-Powered-By', 'KelionAI');

  // ── Whitelist: /api/health always returns 200, skip all rate limiting ──
  const WHITELISTED_PATHS = ['/api/health', '/api/health/'];
  if (WHITELISTED_PATHS.includes(req.path) || req.path.startsWith('/api/health/')) {
    return next();
  }

  // ── Static assets: skip UA blocking and rate limiting for all static files ──
  const staticPrefixes = ['/js/', '/css/', '/styles/', '/lib/', '/models/', '/assets/', '/fonts/', '/images/', '/icons/', '/pricing/', '/onboarding/', '/settings/', '/admin/'];
  const staticExts = ['.js', '.css', '.html', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.glb', '.gltf', '.webp', '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.json', '.map'];
  const reqExt = require('path').extname(req.path).toLowerCase();
  const isStaticPath = staticPrefixes.some(p => req.path.startsWith(p));
  const isStaticExt = staticExts.includes(reqExt);
  const isRootOrHtml = req.path === '/' || req.path === '' || req.path.endsWith('.html');
  // Allow SPA sub-routes (no extension = HTML page)
  const isSpaRoute = !reqExt && !req.path.startsWith('/api/');
  if (isStaticPath || isStaticExt || isRootOrHtml || isSpaRoute) {
    return next();
  }

  const ip = _getClientIp(req);

  // ── IP blacklist check ──
  if (_isBlacklisted(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // ── User-Agent check ──
  const ua = req.headers['user-agent'] || '';
  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (pattern.test(ua)) {
      _markSuspicious(ip, `bad-ua:${ua.substring(0, 30)}`);
      logger.warn({ component: 'CodeShield', ip, ua: ua.substring(0, 60) }, '🤖 Blocked scanner UA');
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // ── Rate limiting ──
  const now = Date.now();
  const log = _requestLog.get(ip) || { count: 0, firstSeen: now, lastSeen: now, burstCount: 0, burstStart: now };

  // Reset window
  if (now - log.firstSeen > WINDOW_MS) {
    log.count = 0;
    log.firstSeen = now;
    log.burstCount = 0;
    log.burstStart = now;
  }

  // Reset burst window
  if (now - log.burstStart > BURST_WINDOW_MS) {
    log.burstCount = 0;
    log.burstStart = now;
  }

  log.count++;
  log.burstCount++;
  log.lastSeen = now;
  _requestLog.set(ip, log);

  if (log.count > MAX_REQ_WINDOW) {
    _markSuspicious(ip, 'rate-limit');
    return res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
  }

  if (log.burstCount > BURST_MAX) {
    _markSuspicious(ip, 'burst-limit');
    return res.status(429).json({ error: 'Too many requests in short time.' });
  }

  next();
}

// ═══════════════════════════════════════════════════════════════
// HOTLINK PROTECTION MIDDLEWARE
// Blochează hotlinking la imagini și assets
// ═══════════════════════════════════════════════════════════════
function hotlinkProtectionMiddleware(req, res, next) {
  const ext = path.extname(req.path).toLowerCase();
  const protectedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.mp3', '.mp4', '.wav', '.ogg'];

  if (!protectedExts.includes(ext)) return next();

  const referer = req.headers.referer || req.headers.referrer || '';
  const host = req.headers.host || '';
  const origin = req.headers.origin || '';

  // Permite accesul direct (fără referer) și de pe același domeniu
  if (!referer && !origin) return next();

  const allowedDomains = [
    host,
    process.env.APP_DOMAIN || '',
    process.env.RAILWAY_STATIC_URL || '',
    'localhost',
    '127.0.0.1',
  ].filter(Boolean);

  const isAllowed = allowedDomains.some((d) => referer.includes(d) || origin.includes(d));

  if (!isAllowed && referer) {
    const ip = _getClientIp(req);
    _markSuspicious(ip, `hotlink:${referer.substring(0, 50)}`);
    logger.warn({ component: 'CodeShield', ip, referer: referer.substring(0, 80) }, '🔗 Hotlink blocked');
    return res.status(403).send('Hotlinking not allowed');
  }

  next();
}

// ═══════════════════════════════════════════════════════════════
// SOURCE CODE DISCLOSURE GUARD
// Avatarii văd codul NUMAI în sesiunea admin
// Oricine altcineva întreabă → refuz complet
// ═══════════════════════════════════════════════════════════════

// Patterns care indică că userul întreabă despre codul sursă
const SOURCE_CODE_PATTERNS = [
  /\b(source\s*code|cod\s*surs[aă]|codebase|cod\s*baz[aă])\b/i,
  /\b(cum\s*(e[sș]ti|func[tț]ionezi|ești\s*f[aă]cut|ai\s*fost\s*f[aă]cut))\b/i,
  /\b(how\s*(are\s*you\s*(made|built|coded|programmed|created)|do\s*you\s*work\s*internally))\b/i,
  /\b(what\s*(model|llm|ai|engine|backend|api|provider|key)\s*(are\s*you|do\s*you\s*use))\b/i,
  /\b(ce\s*(model|llm|api|provider|cheie|key|motor|engine)\s*(folosești|utilizezi|ai))\b/i,
  /\b(show\s*(me\s*)?(your|the)\s*(code|source|implementation|prompt|system\s*prompt))\b/i,
  /\b(arat[aă].mi\s*(codul|sursa|implementarea|promptul|system\s*prompt))\b/i,
  /\b(brain\.js|persona\.js|code.shield|identity.guard|safety.classifier)\b/i,
  /\b(openai|anthropic|groq|gemini|deepseek|perplexity)\s*(api\s*key|key|token)\b/i,
  /\b(supabase|database|db\s*schema|table\s*structure|sql\s*schema)\b/i,
  /\b(system\s*prompt|instructions|persona|training|fine.tuning)\b/i,
  /\b(ce\s*versiune|what\s*version|which\s*version)\s*(de|of|ești|are\s*you)\b/i,
  /\b(reverse\s*engineer|decompile|disassemble|extract\s*prompt)\b/i,
  /\b(jailbreak|bypass|ignore\s*(previous|all)\s*instructions|forget\s*(your|all))\b/i,
  /\b(DAN|do\s*anything\s*now|pretend\s*you\s*are|act\s*as\s*if\s*you\s*have\s*no)\b/i,
];

// Răspunsuri de refuz — variate, naturale
const REFUSAL_RESPONSES = {
  ro: [
    'Aceasta este o informație confidențială despre care nu pot discuta. Sunt Kelion, asistentul tău AI — cu ce te pot ajuta?',
    'Nu pot oferi detalii despre implementarea mea internă. Sunt aici să te ajut cu întrebările tale!',
    'Informațiile despre arhitectura mea sunt confidențiale. Ce altceva pot face pentru tine?',
    'Aceasta depășește ce pot discuta. Sunt Kelion — spune-mi cum te pot ajuta!',
  ],
  en: [
    "That's confidential information I'm not able to discuss. I'm Kelion, your AI assistant — how can I help you?",
    "I can't share details about my internal implementation. I'm here to help you with your questions!",
    "My architecture and implementation details are confidential. What else can I do for you?",
    "That's beyond what I can discuss. I'm Kelion — tell me how I can help!",
  ],
};

/**
 * Verifică dacă un mesaj încearcă să extragă informații despre codul sursă
 * @param {string} message
 * @returns {boolean}
 */
function isSourceCodeQuery(message) {
  if (!message || typeof message !== 'string') return false;
  return SOURCE_CODE_PATTERNS.some((p) => p.test(message));
}

/**
 * Verifică dacă request-ul vine din sesiunea admin autentificată
 * @param {object} req - Express request
 * @param {boolean} isAdmin - flag din chat.js
 * @returns {boolean}
 */
function isAdminSession(req, isAdmin) {
  if (isAdmin === true) return true;
  const adminSecret = req?.headers?.['x-admin-secret'] || req?.body?.adminSecret;
  const envSecret = process.env.ADMIN_SECRET_KEY;
  if (adminSecret && envSecret && adminSecret === envSecret) return true;
  return false;
}

/**
 * Generează un răspuns de refuz natural
 * @param {string} language
 * @returns {string}
 */
function getRefusalResponse(language) {
  const lang = language === 'ro' ? 'ro' : 'en';
  const responses = REFUSAL_RESPONSES[lang];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Middleware pentru chat — interceptează întrebările despre cod sursă
 * Returnează { blocked: true, reply } dacă trebuie blocat
 * @param {string} message
 * @param {boolean} isAdmin
 * @param {string} language
 * @returns {{ blocked: boolean, reply?: string }}
 */
function checkSourceCodeDisclosure(message, isAdmin, language) {
  if (!isSourceCodeQuery(message)) return { blocked: false };
  if (isAdmin) {
    // Admin poate discuta despre cod — log pentru audit
    logger.info({ component: 'CodeShield.Disclosure', isAdmin: true }, '🔓 Admin source code query allowed');
    return { blocked: false };
  }
  // Non-admin → refuz complet
  logger.warn(
    { component: 'CodeShield.Disclosure', msgPreview: message.substring(0, 80) },
    '🛡️ Source code disclosure blocked for non-admin'
  );
  return {
    blocked: true,
    reply: getRefusalResponse(language || 'en'),
    emotion: 'neutral',
  };
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE SANITIZATION
// Elimină informații interne din răspunsurile API
// ═══════════════════════════════════════════════════════════════
const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'apiKey', 'secret', 'password', 'token',
  'supabase_service_key', 'openai_api_key', 'google_ai_key', 'anthropic_api_key',
  'groq_api_key', 'deepseek_api_key', 'elevenlabs_api_key', 'perplexity_api_key',
  'stacktrace', 'stack', 'internalerror', 'filepath', 'absolutepath', 'serverpath',
  'modelname', 'modelversion', 'providername', 'systemprompt', 'persona',
  'instructions', 'internalprompt',
]);

function sanitizeResponse(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      delete sanitized[key];
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeResponse(sanitized[key]);
    }
  }
  return sanitized;
}

// ═══════════════════════════════════════════════════════════════
// WATERMARK — Watermark invizibil în răspunsurile AI
// ═══════════════════════════════════════════════════════════════
function watermarkResponse(text) {
  // Watermark dezactivat — zero-width chars interferează cu TTS și display.
  // Funcția e păstrată pentru compatibilitate cu extractWatermark().
  return text || '';
}

function extractWatermark(text) {
  if (!text) return null;
  const zwsp = '\u200B', zwnj = '\u200C', zwj = '\u200D';
  const chars = [];
  let currentBits = '';
  for (const char of text) {
    if (char === zwsp) currentBits += '0';
    else if (char === zwnj) currentBits += '1';
    else if (char === zwj && currentBits.length >= 8) {
      chars.push(String.fromCharCode(parseInt(currentBits, 2)));
      currentBits = '';
    } else if (char !== zwsp && char !== zwnj && char !== zwj) {
      if (currentBits.length > 0) currentBits = '';
    }
  }
  return chars.length > 0 ? chars.join('') : null;
}

// ═══════════════════════════════════════════════════════════════
// PHOTO / CAMERA SCAN PROTECTION
// Blochează tentativele de a scana QR, watermark, sau a extrage
// informații din imagini uploadate pentru reverse engineering
// ═══════════════════════════════════════════════════════════════
const PHOTO_SCAN_PATTERNS = [
  /\b(scan(ează|eaza|nează|neaza|this|the|qr|barcode|watermark))\b/i,
  /\b(extract\s*(text|code|data|info)\s*from\s*(this|the)\s*(image|photo|picture|screenshot))\b/i,
  /\b(read\s*(the|this)\s*(qr|barcode|code|watermark))\b/i,
  /\b(reverse\s*engineer\s*(from|this|the)\s*(image|photo|logo|icon))\b/i,
  /\b(ce\s*(cod|qr|watermark|text\s*ascuns)\s*(e\s*(în|in)|conține|are)\s*(imaginea|poza|fotografia))\b/i,
];

function isPhotoScanAttempt(message) {
  if (!message) return false;
  return PHOTO_SCAN_PATTERNS.some((p) => p.test(message));
}

// ═══════════════════════════════════════════════════════════════
// STATUS & DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════
function getStatus() {
  return {
    instanceId: _instanceId,
    authorized: _authorized,
    bootTime: _bootTime,
    uptimeMs: _bootTime ? Date.now() - _bootTime : 0,
    filesProtected: _fileHashes.size,
    activeIPs: _requestLog.size,
    blacklistedIPs: _blacklist.size,
    suspiciousIPs: _suspiciousIPs.size,
    topSuspicious: [..._suspiciousIPs.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([ip, e]) => ({ ip, count: e.count, reasons: e.reasons.slice(0, 3) })),
  };
}

module.exports = {
  // Core
  initialize,
  checkIntegrity,
  validateEnvironment,
  getStatus,

  // Middleware
  apiProtectionMiddleware,
  sourceCodeProtectionMiddleware,
  hotlinkProtectionMiddleware,

  // Source code disclosure guard
  checkSourceCodeDisclosure,
  isSourceCodeQuery,
  isAdminSession,
  getRefusalResponse,
  isPhotoScanAttempt,

  // Response
  sanitizeResponse,
  watermarkResponse,
  extractWatermark,
};