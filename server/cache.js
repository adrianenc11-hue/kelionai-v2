// ═══════════════════════════════════════════════════════════════
// KelionAI — Cache Layer
// Redis (via REDIS_URL env) with graceful fallback to in-memory TTL
// Used for: session tokens, usage counters, weather cache
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

// ── In-memory fallback store ─────────────────────────────────
const _memStore = new Map();
let _redisClient = null;
let _redisAvailable = false;

// ── Cleanup interval: removes expired entries from memStore ────
const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _memStore.entries()) {
    if (now > entry.expires) _memStore.delete(key);
  }
}, 60 * 1000); // cleanup every minute
_cleanupInterval.unref();

/**
 * Initializes Redis if REDIS_URL is set.
 * Automatically falls back to in-memory if Redis is unavailable.
 */
async function initCache() {
  if (!process.env.REDIS_URL) {
    logger.info(
      { component: "Cache" },
      "📦 Cache: in-memory mode (no REDIS_URL)",
    );
    return;
  }
  try {
    // Dynamic import — redis is optional
    const { createClient } = require("redis");
    _redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => (retries > 3 ? false : retries * 500),
      },
    });
    _redisClient.on("error", (err) => {
      if (_redisAvailable)
        logger.warn(
          { component: "Cache", err: err.message },
          "⚠️ Redis error — falling back to memory",
        );
      _redisAvailable = false;
    });
    _redisClient.on("ready", () => {
      _redisAvailable = true;
      logger.info({ component: "Cache" }, "✅ Cache: Redis connected");
    });
    await _redisClient.connect();
  } catch (e) {
    logger.warn(
      { component: "Cache", err: e.message },
      "⚠️ Redis unavailable — using in-memory cache",
    );
    _redisClient = null;
    _redisAvailable = false;
  }
}

/**
 * Gets a value from cache.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function cacheGet(key) {
  // Try Redis
  if (_redisClient && _redisAvailable) {
    try {
      const val = await _redisClient.get(key);
      return val ? JSON.parse(val) : null;
    } catch {
      _redisAvailable = false;
    }
  }
  // Fallback in-memory
  const entry = _memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    _memStore.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Saves a value to cache with TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - default 300 (5 minutes)
 */
async function cacheSet(key, value, ttlSeconds = 300) {
  // Try Redis
  if (_redisClient && _redisAvailable) {
    try {
      await _redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
      return;
    } catch {
      _redisAvailable = false;
    }
  }
  // Fallback in-memory
  _memStore.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/**
 * Deletes a key from cache.
 * @param {string} key
 */
async function cacheDel(key) {
  if (_redisClient && _redisAvailable) {
    try {
      await _redisClient.del(key);
      return;
    } catch {
      _redisAvailable = false;
    }
  }
  _memStore.delete(key);
}

/**
 * Returns cache stats (for /api/health).
 */
function getCacheStats() {
  return {
    backend: _redisAvailable ? "redis" : "memory",
    memStoreSize: _memStore.size,
    redisConnected: _redisAvailable,
  };
}

module.exports = {
  initCache,
  cacheGet,
  cacheSet,
  cacheDel,
  getCacheStats,
  _cleanupInterval,
};
