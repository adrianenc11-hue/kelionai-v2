// ═══════════════════════════════════════════════════════════════
// KelionAI — Cache Layer
// Redis (via REDIS_URL env) cu fallback graceful la in-memory TTL
// Folosit pentru: session tokens, usage counters, weather cache
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

// ── In-memory fallback store ─────────────────────────────────
const _memStore = new Map();
let _redisClient = null;
let _redisAvailable = false;

// ── Cleanup interval: elimină entri expirate din memStore ────
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _memStore.entries()) {
        if (now > entry.expires) _memStore.delete(key);
    }
}, 60 * 1000); // cleanup la fiecare minut

/**
 * Inițializează Redis dacă REDIS_URL este setat.
 * Fallback automat la in-memory dacă Redis nu e disponibil.
 */
async function initCache() {
    if (!process.env.REDIS_URL) {
        logger.info({ component: 'Cache' }, '📦 Cache: in-memory mode (no REDIS_URL)');
        return;
    }
    try {
        // Dynamic import — redis e opțional
        const { createClient } = require('redis');
        _redisClient = createClient({
            url: process.env.REDIS_URL,
            socket: { connectTimeout: 3000, reconnectStrategy: (retries) => retries > 3 ? false : retries * 500 }
        });
        _redisClient.on('error', (err) => {
            if (_redisAvailable) logger.warn({ component: 'Cache', err: err.message }, '⚠️ Redis error — falling back to memory');
            _redisAvailable = false;
        });
        _redisClient.on('ready', () => {
            _redisAvailable = true;
            logger.info({ component: 'Cache' }, '✅ Cache: Redis conectat');
        });
        await _redisClient.connect();
    } catch (e) {
        logger.warn({ component: 'Cache', err: e.message }, '⚠️ Redis unavailable — using in-memory cache');
        _redisClient = null;
        _redisAvailable = false;
    }
}

/**
 * Obține o valoare din cache.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function cacheGet(key) {
    // Încearcă Redis
    if (_redisClient && _redisAvailable) {
        try {
            const val = await _redisClient.get(key);
            return val ? JSON.parse(val) : null;
        } catch (e) {
            _redisAvailable = false;
        }
    }
    // Fallback in-memory
    const entry = _memStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { _memStore.delete(key); return null; }
    return entry.value;
}

/**
 * Salvează o valoare în cache cu TTL.
 * @param {string} key
 * @param {any} value
 * @param {number} ttlSeconds - default 300 (5 minute)
 */
async function cacheSet(key, value, ttlSeconds = 300) {
    // Încearcă Redis
    if (_redisClient && _redisAvailable) {
        try {
            await _redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
            return;
        } catch (e) {
            _redisAvailable = false;
        }
    }
    // Fallback in-memory
    _memStore.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/**
 * Șterge o cheie din cache.
 * @param {string} key
 */
async function cacheDel(key) {
    if (_redisClient && _redisAvailable) {
        try { await _redisClient.del(key); return; } catch (e) { _redisAvailable = false; }
    }
    _memStore.delete(key);
}

/**
 * Returnează stats despre cache (pentru /api/health).
 */
function getCacheStats() {
    return {
        backend: _redisAvailable ? 'redis' : 'memory',
        memStoreSize: _memStore.size,
        redisConnected: _redisAvailable
    };
}

module.exports = { initCache, cacheGet, cacheSet, cacheDel, getCacheStats };
