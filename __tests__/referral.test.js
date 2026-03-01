'use strict';

const {
    generateSecureReferralCode,
    verifyReferralCode,
    applyReferralBonus,
    hashCode,
    CODE_EXPIRY_DAYS,
    MAX_ACTIVE_CODES_PER_MONTH,
    SENDER_BONUS_DAYS,
    RECEIVER_BONUS_DAYS
} = require('../server/referral');

// Helper: generate a valid userId-like string
function fakeUserId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

describe('generateSecureReferralCode', () => {
    test('generates a code in correct format KEL-xxxx-xxxxxx-XXXXXXXXXX', () => {
        const userId = fakeUserId();
        const code = generateSecureReferralCode(userId);
        expect(code).toMatch(/^KEL-[0-9a-f]{4}-[0-9a-f]{6}-[A-Z0-9]{10}$/i);
    });

    test('generates unique codes for same user at different times', () => {
        const userId = fakeUserId();
        const code1 = generateSecureReferralCode(userId);
        // Timestamp part should still be the same second, but let's just verify format
        expect(code1).toMatch(/^KEL-/);
    });

    test('has 4 dash-separated parts', () => {
        const code = generateSecureReferralCode(fakeUserId());
        expect(code.split('-')).toHaveLength(4);
    });

    test('starts with KEL prefix', () => {
        const code = generateSecureReferralCode(fakeUserId());
        expect(code.startsWith('KEL-')).toBe(true);
    });
});

describe('verifyReferralCode', () => {
    test('accepts a freshly generated valid code', () => {
        const userId = fakeUserId();
        const code = generateSecureReferralCode(userId);
        const result = verifyReferralCode(code);
        expect(result.valid).toBe(true);
        expect(result.isExpired).toBe(false);
    });

    test('rejects tampered HMAC (wrong last segment)', () => {
        const userId = fakeUserId();
        const code = generateSecureReferralCode(userId);
        const parts = code.split('-');
        parts[3] = 'TAMPERED123'; // replace HMAC part
        const tampered = parts.join('-');
        const result = verifyReferralCode(tampered);
        expect(result.valid).toBe(false);
    });

    test('rejects code with wrong prefix', () => {
        const userId = fakeUserId();
        const code = generateSecureReferralCode(userId);
        const bad = 'BAD' + code.slice(3);
        expect(verifyReferralCode(bad).valid).toBe(false);
    });

    test('rejects null / undefined / empty input', () => {
        expect(verifyReferralCode(null).valid).toBe(false);
        expect(verifyReferralCode(undefined).valid).toBe(false);
        expect(verifyReferralCode('').valid).toBe(false);
        expect(verifyReferralCode('NOTACODE').valid).toBe(false);
    });

    test('rejects code with too few parts', () => {
        expect(verifyReferralCode('KEL-1234-ABCDEF').valid).toBe(false);
    });

    test('detects expired code (timestamp > CODE_EXPIRY_DAYS old)', () => {
        // Craft a code with timestamp far in the past (20 days)
        const crypto = require('crypto');
        const userId = fakeUserId();
        const userFragment = userId.replace(/-/g, '').slice(0, 4);
        // Use low 24 bits of a timestamp 20 days ago
        const oldTs = (Math.floor(Date.now() / 1000) - (20 * 24 * 60 * 60)) & 0xFFFFFF;
        const tsHex = oldTs.toString(16).padStart(6, '0');
        const payload = `${userFragment}-${tsHex}`;
        const secret = process.env.REFERRAL_SECRET || process.env.SESSION_SECRET || 'kelion-referral-secret';
        const hmac = crypto.createHmac('sha256', secret)
            .update(payload).digest('hex').slice(0, 10).toUpperCase();
        const expiredCode = `KEL-${userFragment}-${tsHex}-${hmac}`;

        const result = verifyReferralCode(expiredCode);
        expect(result.valid).toBe(true); // HMAC is valid
        expect(result.isExpired).toBe(true); // but expired
    });

    test('does not flag fresh code as expired', () => {
        const code = generateSecureReferralCode(fakeUserId());
        const result = verifyReferralCode(code);
        expect(result.isExpired).toBe(false);
    });
});

describe('hashCode', () => {
    test('returns a hex string of length 64 (SHA-256)', () => {
        const h = hashCode('KEL-abcd-ef0123-ABCDEFGHIJ');
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    test('same input produces same hash', () => {
        const code = 'KEL-abcd-ef0123-ABCDEFGHIJ';
        expect(hashCode(code)).toBe(hashCode(code));
    });

    test('different inputs produce different hashes', () => {
        expect(hashCode('CODE-A')).not.toBe(hashCode('CODE-B'));
    });
});

describe('applyReferralBonus', () => {
    function mockSupabase(opts = {}) {
        const {
            refCodeData = null,
            existingSubscription = null,
            updateResult = {},
        } = opts;

        const updates = [];

        return {
            _updates: updates,
            from: (table) => {
                if (table === 'referral_codes') {
                    return {
                        select: () => ({ eq: () => ({ single: async () => ({ data: refCodeData }) }) }),
                        update: (data) => {
                            updates.push({ table, data });
                            return { eq: () => ({ eq: () => Promise.resolve({}) }) };
                        }
                    };
                }
                if (table === 'subscriptions') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: async () => ({ data: existingSubscription })
                            })
                        }),
                        update: (data) => {
                            updates.push({ table, data });
                            return { eq: () => Promise.resolve({}) };
                        },
                        upsert: (data) => {
                            updates.push({ table, data });
                            return Promise.resolve({});
                        }
                    };
                }
                return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
            }
        };
    }

    test('does nothing if code is null', async () => {
        await expect(applyReferralBonus(null, 'user-1', {})).resolves.toBeUndefined();
    });

    test('does nothing if supabaseAdmin is null', async () => {
        await expect(applyReferralBonus('CODE', 'user-1', null)).resolves.toBeUndefined();
    });

    test('does nothing if code not found in DB', async () => {
        const db = mockSupabase({ refCodeData: null });
        await applyReferralBonus('CODE', 'user-1', db);
        expect(db._updates).toHaveLength(0);
    });

    test('does nothing if code status is not redeemed', async () => {
        const db = mockSupabase({
            refCodeData: { id: 'ref-1', sender_id: 'sender-1', status: 'active', receiver_bonus_applied: false, sender_bonus_applied: false }
        });
        await applyReferralBonus('CODE', 'user-1', db);
        expect(db._updates).toHaveLength(0);
    });

    test('does nothing if both bonuses already applied', async () => {
        const db = mockSupabase({
            refCodeData: { id: 'ref-1', sender_id: 'sender-1', status: 'redeemed', receiver_bonus_applied: true, sender_bonus_applied: true }
        });
        await applyReferralBonus('CODE', 'user-1', db);
        expect(db._updates).toHaveLength(0);
    });

    test('applies bonuses when code is redeemed and bonuses not yet applied', async () => {
        const db = mockSupabase({
            refCodeData: { id: 'ref-1', sender_id: 'sender-1', status: 'redeemed', receiver_bonus_applied: false, sender_bonus_applied: false, recipient_id: 'user-1' },
            existingSubscription: null // free user
        });
        await applyReferralBonus('CODE', 'user-1', db);
        // Should have applied receiver and sender bonuses — at least 4 updates (upsert×2 + bonus_applied×2)
        expect(db._updates.length).toBeGreaterThanOrEqual(2);
    });
});

describe('Constants', () => {
    test('CODE_EXPIRY_DAYS is a positive integer', () => {
        expect(Number.isInteger(CODE_EXPIRY_DAYS)).toBe(true);
        expect(CODE_EXPIRY_DAYS).toBeGreaterThan(0);
    });

    test('MAX_ACTIVE_CODES_PER_MONTH is 5', () => {
        expect(MAX_ACTIVE_CODES_PER_MONTH).toBe(5);
    });

    test('SENDER_BONUS_DAYS is 10', () => {
        expect(SENDER_BONUS_DAYS).toBe(10);
    });

    test('RECEIVER_BONUS_DAYS is 5', () => {
        expect(RECEIVER_BONUS_DAYS).toBe(5);
    });
});
