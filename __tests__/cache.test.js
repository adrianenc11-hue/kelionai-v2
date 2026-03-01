'use strict';

const { cacheGet, cacheSet, cacheDel, getCacheStats } = require('../server/cache');

describe('cacheSet / cacheGet', () => {
    test('stores and retrieves a string value', async () => {
        await cacheSet('test:str', 'hello', 60);
        const val = await cacheGet('test:str');
        expect(val).toBe('hello');
    });

    test('stores and retrieves an object value', async () => {
        const obj = { foo: 'bar', num: 42 };
        await cacheSet('test:obj', obj, 60);
        const val = await cacheGet('test:obj');
        expect(val).toEqual(obj);
    });

    test('stores and retrieves a number value', async () => {
        await cacheSet('test:num', 123, 60);
        const val = await cacheGet('test:num');
        expect(val).toBe(123);
    });

    test('returns null for a key that was never set', async () => {
        const val = await cacheGet('test:nonexistent:xyz');
        expect(val).toBeNull();
    });

    test('overwrites a previously set value', async () => {
        await cacheSet('test:overwrite', 'first', 60);
        await cacheSet('test:overwrite', 'second', 60);
        const val = await cacheGet('test:overwrite');
        expect(val).toBe('second');
    });

    test('returns null for an expired entry', async () => {
        const key = 'test:ttl:' + Date.now();
        // Set a 1-second TTL, then wait 1.1s for expiry
        await cacheSet(key, 'expires', 1);
        await new Promise(r => setTimeout(r, 1100));
        const val = await cacheGet(key);
        expect(val).toBeNull();
    });
});

describe('cacheDel', () => {
    test('deletes a previously set key', async () => {
        await cacheSet('test:del', 'value', 60);
        await cacheDel('test:del');
        const val = await cacheGet('test:del');
        expect(val).toBeNull();
    });

    test('deleting a non-existent key does not throw', async () => {
        await expect(async () => { await cacheDel('test:nothere:abc'); }).not.toThrow();
    });
});

describe('getCacheStats', () => {
    test('returns an object with backend, memStoreSize and redisConnected', () => {
        const stats = getCacheStats();
        expect(stats).toHaveProperty('backend');
        expect(stats).toHaveProperty('memStoreSize');
        expect(stats).toHaveProperty('redisConnected');
    });

    test('backend is "memory" when no Redis is configured', () => {
        const stats = getCacheStats();
        // Without REDIS_URL, backend should be memory
        expect(stats.backend).toBe('memory');
    });

    test('redisConnected is false when no Redis is configured', () => {
        const stats = getCacheStats();
        expect(stats.redisConnected).toBe(false);
    });

    test('memStoreSize is a non-negative number', () => {
        const stats = getCacheStats();
        expect(typeof stats.memStoreSize).toBe('number');
        expect(stats.memStoreSize).toBeGreaterThanOrEqual(0);
    });

    test('memStoreSize increases after setting a new key', async () => {
        const before = getCacheStats().memStoreSize;
        await cacheSet('test:size:unique:' + Date.now(), 'v', 60);
        const after = getCacheStats().memStoreSize;
        expect(after).toBeGreaterThan(before);
    });
});
