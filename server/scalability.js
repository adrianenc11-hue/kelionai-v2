// ═══════════════════════════════════════════════════════════════
// KelionAI — Scalability Middleware
// Circuit breaker, IP blacklist, compression, static cache,
// graceful degradation, request queue
// ═══════════════════════════════════════════════════════════════
'use strict';

const zlib = require('zlib');
const logger = require('./logger');

// ── 1. CIRCUIT BREAKER ──────────────────────────────────────
// Tracks failure rates for external services (AI providers, APIs)
// If failures exceed threshold, circuit opens → fast-fail for cooldown period
const _circuits = {};

/**
 * getCircuit
 * @param {*} name
 * @returns {*}
 */
function getCircuit(name) {
  if (!_circuits[name]) {
    _circuits[name] = {
      name,
      state: 'closed', // closed=normal, open=failing, half-open=testing
      failures: 0,
      successes: 0,
      lastFailure: 0,
      threshold: 5, // failures before opening
      cooldown: 30000, // ms before trying again (30s)
      halfOpenMax: 2, // test requests in half-open
    };
  }
  return _circuits[name];
}

/**
 * circuitAllow
 * @param {*} name
 * @returns {*}
 */
function circuitAllow(name) {
  const c = getCircuit(name);
  if (c.state === 'closed') return true;
  if (c.state === 'open') {
    if (Date.now() - c.lastFailure > c.cooldown) {
      c.state = 'half-open';
      c.successes = 0;
      return true;
    }
    return false;
  }
  // half-open: allow limited requests
  return c.successes < c.halfOpenMax;
}

/**
 * circuitSuccess
 * @param {*} name
 * @returns {*}
 */
function circuitSuccess(name) {
  const c = getCircuit(name);
  c.successes++;
  if (c.state === 'half-open' && c.successes >= c.halfOpenMax) {
    c.state = 'closed';
    c.failures = 0;
    logger.info({ component: 'CircuitBreaker' }, `✅ ${name} circuit CLOSED (recovered)`);
  }
}

/**
 * circuitFailure
 * @param {*} name
 * @returns {*}
 */
function circuitFailure(name) {
  const c = getCircuit(name);
  c.failures++;
  c.lastFailure = Date.now();
  if (c.failures >= c.threshold && c.state !== 'open') {
    c.state = 'open';
    logger.warn({ component: 'CircuitBreaker' }, `🔴 ${name} circuit OPEN (${c.failures} failures)`);
  }
}

/**
 * getCircuitStats
 * @returns {*}
 */
function getCircuitStats() {
  const stats = {};
  for (const [name, c] of Object.entries(_circuits)) {
    stats[name] = {
      state: c.state,
      failures: c.failures,
      successes: c.successes,
    };
  }
  return stats;
}

// ── 2. IP BLACKLIST (Auto-ban abusive IPs) ──────────────────
const _ipCounts = new Map(); // ip → { count, firstSeen }
const _blacklist = new Set();
const IP_WINDOW = 60 * 1000; // 1 minute window
const IP_MAX = 500; // max requests per window
const BAN_DURATION = 60 * 60 * 1000; // 1 hour ban
const _banExpiry = new Map(); // ip → unban timestamp

// Cleanup every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, exp] of _banExpiry.entries()) {
      if (now > exp) {
        _blacklist.delete(ip);
        _banExpiry.delete(ip);
      }
    }
    // Reset counters
    for (const [ip, data] of _ipCounts.entries()) {
      if (now - data.firstSeen > IP_WINDOW) _ipCounts.delete(ip);
    }
  },
  5 * 60 * 1000
);

/**
 * ipBlacklistMiddleware
 * @param {*} req
 * @param {*} res
 * @param {*} next
 * @returns {*}
 */
function ipBlacklistMiddleware(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  // Whitelisted
  if (
    ip === process.env.HOST_IP ||
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
    process.env.HOST_IP || "127.0.0.1" ||
    ip === '::1'
  )
    return next();
  // Banned?
  if (_blacklist.has(ip)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.', retryAfter: 3600 });
  }
  // Count
  const now = Date.now();
  let data = _ipCounts.get(ip);
  if (!data || now - data.firstSeen > IP_WINDOW) {
    data = { count: 0, firstSeen: now };
    _ipCounts.set(ip, data);
  }
  data.count++;
  if (data.count > IP_MAX) {
    _blacklist.add(ip);
    _banExpiry.set(ip, now + BAN_DURATION);
    logger.warn({ component: 'IPBlacklist', ip, count: data.count }, `🚫 IP ${ip} auto-banned (${data.count} req/min)`);
    return res.status(429).json({ error: 'Rate limit exceeded. Banned for 1 hour.' });
  }
  next();
}

/**
 * getBlacklistStats
 * @returns {*}
 */
function getBlacklistStats() {
  return {
    banned: _blacklist.size,
    tracked: _ipCounts.size,
    list: Array.from(_blacklist),
  };
}

// ── 3. COMPRESSION MIDDLEWARE ───────────────────────────────
// Gzip/Deflate for responses > 1KB
function compressionMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip') && !acceptEncoding.includes('deflate')) return next();

  const originalWrite = res.write;
  const originalEnd = res.end;
  const chunks = [];
  let ended = false;

  res.write = function (chunk) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };

  res.end = function (chunk) {
    if (ended) return;
    ended = true;
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    // Skip small responses and already-compressed content
    const ct = res.getHeader('content-type') || '';
    if (body.length < 1024 || ct.includes('image/') || ct.includes('video/') || ct.includes('audio/')) {
      res.setHeader('content-length', body.length);
      originalWrite.call(res, body);
      originalEnd.call(res);
      return;
    }

    const encoding = acceptEncoding.includes('gzip') ? 'gzip' : 'deflate';
    const compress = encoding === 'gzip' ? zlib.gzipSync : zlib.deflateSync;

    try {
      const compressed = compress(body);
      res.setHeader('content-encoding', encoding);
      res.setHeader('content-length', compressed.length);
      res.removeHeader('content-length'); // let chunked
      res.setHeader('content-encoding', encoding);
      res.setHeader('vary', 'Accept-Encoding');
      originalWrite.call(res, compressed);
      originalEnd.call(res);
    } catch (_e) {
      // Fallback: send uncompressed
      originalWrite.call(res, body);
      originalEnd.call(res);
    }
  };

  next();
}

// ── 4. STATIC CACHE HEADERS ─────────────────────────────────
function staticCacheMiddleware(req, res, next) {
  const url = req.url;
  if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|webp|gif|ico|glb|gltf|mp3|wav)(\?|$)/i.test(url)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
  } else if (/\.(html?)(\?|$)/i.test(url)) {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  }
  next();
}

// ── 5. GRACEFUL DEGRADATION ─────────────────────────────────
// When server is under heavy load, return cached/simplified responses
let _requestsInFlight = 0;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '200', 10);

/**
 * gracefulDegradationMiddleware
 * @param {*} req
 * @param {*} res
 * @param {*} next
 * @returns {*}
 */
function gracefulDegradationMiddleware(req, res, next) {
  _requestsInFlight++;
  res.on('finish', () => {
    _requestsInFlight--;
  });

  if (_requestsInFlight > MAX_CONCURRENT) {
    // Only degrade API requests, not static files
    if (req.url.startsWith('/api/')) {
      _requestsInFlight--;
      return res.status(503).json({
        error: 'Server is under heavy load. Please try again in a few seconds.',
        retryAfter: 5,
      });
    }
  }
  next();
}

/**
 * getLoadStats
 * @returns {*}
 */
function getLoadStats() {
  return {
    requestsInFlight: _requestsInFlight,
    maxConcurrent: MAX_CONCURRENT,
    loadPercent: Math.round((_requestsInFlight / MAX_CONCURRENT) * 100),
  };
}

// ── 6. TASK QUEUE (in-memory, lightweight) ──────────────────
// For heavy operations: trading analysis, image generation, etc.
const _taskQueue = [];
let _taskRunning = 0;
const MAX_PARALLEL_TASKS = parseInt(process.env.MAX_PARALLEL_TASKS || '3', 10);

/**
 * enqueueTask
 * @param {*} name
 * @param {*} fn
 * @returns {*}
 */
async function enqueueTask(name, fn) {
  return new Promise((resolve, reject) => {
    _taskQueue.push({ name, fn, resolve, reject, enqueued: Date.now() });
    _processQueue();
  });
}

/**
 * _processQueue
 * @returns {*}
 */
async function _processQueue() {
  while (_taskRunning < MAX_PARALLEL_TASKS && _taskQueue.length > 0) {
    const task = _taskQueue.shift();
    _taskRunning++;
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (e) {
      task.reject(e);
    } finally {
      _taskRunning--;
      if (_taskQueue.length > 0) setImmediate(_processQueue);
    }
  }
}

/**
 * getQueueStats
 * @returns {*}
 */
function getQueueStats() {
  return {
    pending: _taskQueue.length,
    running: _taskRunning,
    maxParallel: MAX_PARALLEL_TASKS,
  };
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  // Circuit breaker
  circuitAllow,
  circuitSuccess,
  circuitFailure,
  getCircuitStats,
  // IP blacklist
  ipBlacklistMiddleware,
  getBlacklistStats,
  // Compression
  compressionMiddleware,
  // Static cache
  staticCacheMiddleware,
  // Graceful degradation
  gracefulDegradationMiddleware,
  getLoadStats,
  // Task queue
  enqueueTask,
  getQueueStats,
};
