// ═══════════════════════════════════════════════════════════════
// KelionAI — Referral module (HMAC-signed codes, bonus system)
// Exports: generateSecureReferralCode, verifyReferralCode,
//          applyReferralBonus, hashCode, constants
// ═══════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const logger = require('./logger');

const CODE_EXPIRY_DAYS = 14;
const MAX_ACTIVE_CODES_PER_MONTH = 5;
const SENDER_BONUS_DAYS = 10;
const RECEIVER_BONUS_DAYS = 5;

function getSecret() {
  const secret = process.env.REFERRAL_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    logger.warn(
      { component: 'Referral' },
      'No REFERRAL_SECRET or SESSION_SECRET set - using fallback. Set in .env for production!'
    );
    return 'kelion-referral-dev-only';
  }
  return secret;
}

/**
 * Generate an HMAC-signed referral code: KEL-{userFragment}-{tsHex}-{HMAC}
 */
function generateSecureReferralCode(userId) {
  const userFragment = userId.replace(/-/g, '').slice(0, 4);
  const tsHex = (Math.floor(Date.now() / 1000) & 0xffffff).toString(16).padStart(6, '0');
  const payload = `${userFragment}-${tsHex}`;
  const hmac = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 10).toUpperCase();
  return `KEL-${userFragment}-${tsHex}-${hmac}`;
}

/**
 * Verify referral code structure + HMAC + expiration
 */
function verifyReferralCode(code) {
  if (!code || typeof code !== 'string') return { valid: false, isExpired: false };

  const parts = code.split('-');
  if (parts.length !== 4 || parts[0] !== 'KEL') return { valid: false, isExpired: false };

  const userFragment = parts[1];
  const tsHex = parts[2];
  const providedHmac = parts[3];

  const payload = `${userFragment}-${tsHex}`;
  const expectedHmac = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();

  if (providedHmac.toUpperCase() !== expectedHmac) return { valid: false, isExpired: false };

  // Check expiration
  const ts = parseInt(tsHex, 16);
  const nowSec = Math.floor(Date.now() / 1000) & 0xffffff;
  let ageSec = nowSec - ts;
  if (ageSec < 0) ageSec += 0x1000000; // handle 24-bit wrap
  const isExpired = ageSec > CODE_EXPIRY_DAYS * 24 * 60 * 60;

  return { valid: true, isExpired };
}

/**
 * SHA-256 hash of a referral code (for DB storage)
 */
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Apply referral bonuses after payment succeeds
 */
async function applyReferralBonus(code, userId, supabaseAdmin) {
  if (!code || !userId || !supabaseAdmin) return;

  try {
    const { data: ref } = await supabaseAdmin
      .from('referral_codes')
      .select('id, sender_id, status, receiver_bonus_applied, sender_bonus_applied, recipient_id')
      .eq('code', code)
      .single();

    if (!ref) return;
    if (ref.status !== 'redeemed') return;
    if (ref.receiver_bonus_applied && ref.sender_bonus_applied) return;

    const now = new Date().toISOString();

    // Apply receiver bonus
    if (!ref.receiver_bonus_applied) {
      const receiverId = ref.recipient_id || userId;
      const { data: recSub } = await supabaseAdmin
        .from('subscriptions')
        .select('current_period_end')
        .eq('user_id', receiverId)
        .single();
      const baseEnd = recSub?.current_period_end ? new Date(recSub.current_period_end) : new Date();
      const newEnd = new Date(baseEnd.getTime() + RECEIVER_BONUS_DAYS * 24 * 60 * 60 * 1000);
      await supabaseAdmin
        .from('subscriptions')
        .upsert(
          { user_id: receiverId, current_period_end: newEnd.toISOString(), updated_at: now },
          { onConflict: 'user_id' }
        );
      await supabaseAdmin
        .from('referral_codes')
        .update({ receiver_bonus_applied: true, receiver_bonus_days: RECEIVER_BONUS_DAYS, updated_at: now })
        .eq('id', ref.id);
    }

    // Apply sender bonus
    if (!ref.sender_bonus_applied) {
      const { data: sndSub } = await supabaseAdmin
        .from('subscriptions')
        .select('current_period_end')
        .eq('user_id', ref.sender_id)
        .single();
      const baseEnd = sndSub?.current_period_end ? new Date(sndSub.current_period_end) : new Date();
      const newEnd = new Date(baseEnd.getTime() + SENDER_BONUS_DAYS * 24 * 60 * 60 * 1000);
      await supabaseAdmin
        .from('subscriptions')
        .upsert(
          { user_id: ref.sender_id, current_period_end: newEnd.toISOString(), updated_at: now },
          { onConflict: 'user_id' }
        );
      await supabaseAdmin
        .from('referral_codes')
        .update({ sender_bonus_applied: true, sender_bonus_days: SENDER_BONUS_DAYS, updated_at: now })
        .eq('id', ref.id);
    }
  } catch (err) {
    logger.warn({ component: 'Referral', err: err.message }, 'applyReferralBonus best-effort failed');
  }
}

module.exports = {
  generateSecureReferralCode,
  verifyReferralCode,
  applyReferralBonus,
  hashCode,
  CODE_EXPIRY_DAYS,
  MAX_ACTIVE_CODES_PER_MONTH,
  SENDER_BONUS_DAYS,
  RECEIVER_BONUS_DAYS,
};
