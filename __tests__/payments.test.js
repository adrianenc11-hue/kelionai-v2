'use strict';

const { checkUsage, incrementUsage, PLAN_LIMITS } = require('../server/payments');

describe('PLAN_LIMITS', () => {
    test('has all required plans defined', () => {
        expect(PLAN_LIMITS).toHaveProperty('guest');
        expect(PLAN_LIMITS).toHaveProperty('free');
        expect(PLAN_LIMITS).toHaveProperty('pro');
        expect(PLAN_LIMITS).toHaveProperty('premium');
    });

    test('each plan has chat, search, image, vision, tts fields', () => {
        for (const plan of ['guest', 'free', 'pro', 'premium']) {
            expect(PLAN_LIMITS[plan]).toHaveProperty('chat');
            expect(PLAN_LIMITS[plan]).toHaveProperty('search');
            expect(PLAN_LIMITS[plan]).toHaveProperty('image');
            expect(PLAN_LIMITS[plan]).toHaveProperty('vision');
            expect(PLAN_LIMITS[plan]).toHaveProperty('tts');
            expect(PLAN_LIMITS[plan]).toHaveProperty('name');
        }
    });

    test('guest limits are smaller than free limits', () => {
        expect(PLAN_LIMITS.guest.chat).toBeLessThan(PLAN_LIMITS.free.chat);
        expect(PLAN_LIMITS.guest.search).toBeLessThan(PLAN_LIMITS.free.search);
        expect(PLAN_LIMITS.guest.image).toBeLessThan(PLAN_LIMITS.free.image);
        expect(PLAN_LIMITS.guest.vision).toBeLessThan(PLAN_LIMITS.free.vision);
        expect(PLAN_LIMITS.guest.tts).toBeLessThan(PLAN_LIMITS.free.tts);
    });

    test('free chat limit is 10', () => {
        expect(PLAN_LIMITS.free.chat).toBe(10);
    });

    test('pro chat limit is 100', () => {
        expect(PLAN_LIMITS.pro.chat).toBe(100);
    });

    test('premium limits are -1 (unlimited)', () => {
        expect(PLAN_LIMITS.premium.chat).toBe(-1);
        expect(PLAN_LIMITS.premium.search).toBe(-1);
        expect(PLAN_LIMITS.premium.image).toBe(-1);
        expect(PLAN_LIMITS.premium.vision).toBe(-1);
        expect(PLAN_LIMITS.premium.tts).toBe(-1);
    });
});

describe('checkUsage', () => {
    test('returns allowed:true when supabaseAdmin is null (graceful degradation)', async () => {
        const result = await checkUsage('user-123', 'chat', null);
        expect(result.allowed).toBe(true);
    });

    test('returns allowed:true for guest with no supabaseAdmin', async () => {
        const result = await checkUsage(null, 'chat', null);
        expect(result.allowed).toBe(true);
    });

    test('returns plan:guest (not free) for null userId', async () => {
        const result = await checkUsage(null, 'chat', null);
        expect(result.plan).toBe('guest');
    });

    test('returns allowed:true for premium plan (unlimited)', async () => {
        // Mock supabaseAdmin that returns an active premium subscription
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            eq: () => ({ single: async () => ({ data: { count: 9999 } }) }),
                            single: async () => ({ data: { plan: 'premium', status: 'active', stripe_subscription_id: 's_1', current_period_end: new Date(Date.now() + 86400000).toISOString() } })
                        })
                    })
                })
            })
        };
        const result = await checkUsage('premium-user', 'chat', mockSupabase);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(-1);
    });

    test('returns allowed:false when count >= limit', async () => {
        // Mock supabaseAdmin: free plan, chat count = 10 (at limit)
        const mockSupabase = {
            from: (table) => ({
                select: () => ({
                    eq: (col, val) => ({
                        eq: (col2, val2) => ({
                            eq: (col3, val3) => ({
                                single: async () => {
                                    if (table === 'subscriptions') return { data: null };
                                    // usage table: return count = 10
                                    return { data: { count: 10 } };
                                }
                            }),
                            single: async () => {
                                if (table === 'subscriptions') return { data: null };
                                return { data: { count: 10 } };
                            }
                        })
                    })
                })
            })
        };
        const result = await checkUsage('free-user', 'chat', mockSupabase);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBeLessThanOrEqual(0);
    });

    test('returns allowed:true when count < limit', async () => {
        // Mock supabaseAdmin: free plan, chat count = 5 (below limit of 10)
        const mockSupabase = {
            from: (table) => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: async () => {
                                    if (table === 'subscriptions') return { data: null };
                                    return { data: { count: 5 } };
                                }
                            }),
                            single: async () => {
                                if (table === 'subscriptions') return { data: null };
                                return { data: { count: 5 } };
                            }
                        })
                    })
                })
            })
        };
        const result = await checkUsage('free-user', 'chat', mockSupabase);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThan(0);
    });
});

describe('incrementUsage', () => {
    test('does nothing when supabaseAdmin is null', async () => {
        // Should not throw
        await expect(incrementUsage('user-123', 'chat', null)).resolves.toBeUndefined();
    });

    test('inserts new record when no existing entry', async () => {
        let inserted = null;
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: async () => ({ data: null })
                            })
                        })
                    })
                }),
                insert: (data) => { inserted = data; return Promise.resolve({}); },
                update: () => ({ eq: () => Promise.resolve({}) })
            })
        };
        await incrementUsage('user-123', 'chat', mockSupabase);
        expect(inserted).not.toBeNull();
        expect(inserted.count).toBe(1);
        expect(inserted.type).toBe('chat');
    });

    test('updates count when existing entry found', async () => {
        let updatedCount = null;
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            eq: () => ({
                                single: async () => ({ data: { id: 'row-1', count: 3 } })
                            })
                        })
                    })
                }),
                update: (data) => { updatedCount = data.count; return { eq: () => Promise.resolve({}) }; },
                insert: () => Promise.resolve({})
            })
        };
        await incrementUsage('user-123', 'chat', mockSupabase);
        expect(updatedCount).toBe(4);
    });
});
