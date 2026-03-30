// ═══════════════════════════════════════════════════════════════
// KelionAI — Referral API Routes
// POST /generate, POST /send-invite, GET /code, GET /my-codes,
// POST /verify, POST /redeem, DELETE /revoke/:codeId, GET /my-bonuses
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const {
  generateSecureReferralCode,
  verifyReferralCode,
  applyReferralBonus,
  hashCode,
  CODE_EXPIRY_DAYS,
  MAX_ACTIVE_CODES_PER_MONTH,
  RECEIVER_BONUS_DAYS,
} = require('../referral');

const router = express.Router();

// Rate limiters
const referralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many referral requests. Try again later.' },
});
const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many invite emails. Try again later.' },
});

router.use(referralLimiter);

// ─── Helper: require authenticated user ───
async function requireUser(req, res) {
  const { getUserFromToken } = req.app.locals;
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    return user;
  } catch (err) {
    logger.warn({ component: 'Referral', err: err.message }, 'Auth check failed');
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
}

// ─── GET /code — Get or generate a referral code for the current user ───
router.get('/code', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Check for existing active code
    const { data: existing } = await supabaseAdmin
      .from('referral_codes')
      .select('code, expires_at, status')
      .eq('sender_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      return res.json({ code: existing.code, expiresAt: existing.expires_at });
    }

    // Generate new code
    const code = generateSecureReferralCode(user.id);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await supabaseAdmin.from('referral_codes').insert({
      sender_id: user.id,
      code,
      code_hash: hashCode(code),
      status: 'active',
      expires_at: expiresAt,
    });

    logger.info({ component: 'Referral', userId: user.id }, 'Generated referral code via GET /code');
    return res.json({ code, expiresAt });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'GET /code failed');
    return res.status(500).json({ error: 'Failed to get referral code' });
  }
});

// ─── POST /generate — Generate a new referral code ───
router.post('/generate', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Check monthly limit
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from('referral_codes')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', user.id)
      .gte('created_at', monthStart.toISOString());

    if (count >= MAX_ACTIVE_CODES_PER_MONTH) {
      return res.status(429).json({
        error: `Maximum ${MAX_ACTIVE_CODES_PER_MONTH} codes per month reached`,
        codesRemainingThisMonth: 0,
      });
    }

    const code = generateSecureReferralCode(user.id);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await supabaseAdmin.from('referral_codes').insert({
      sender_id: user.id,
      code,
      code_hash: hashCode(code),
      status: 'active',
      expires_at: expiresAt,
    });

    logger.info({ component: 'Referral', userId: user.id }, 'Generated referral code');
    return res.json({
      code,
      expiresAt,
      codesRemainingThisMonth: MAX_ACTIVE_CODES_PER_MONTH - (count + 1),
    });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'POST /generate failed');
    return res.status(500).json({ error: 'Failed to generate code' });
  }
});

// ─── POST /send-invite — Send referral invite email (real email via mailer) ───
router.post('/send-invite', sendLimiter, async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { email, code } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Referral code required' });
    }

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Verify the code belongs to this user and is active
    const { data: ref } = await supabaseAdmin
      .from('referral_codes')
      .select('id, status')
      .eq('sender_id', user.id)
      .eq('code', code)
      .eq('status', 'active')
      .single();

    if (!ref) {
      return res.status(404).json({ error: 'Code not found or already used' });
    }

    // Check if already sent to this email
    const { data: alreadySent } = await supabaseAdmin
      .from('referral_codes')
      .select('id')
      .eq('sender_id', user.id)
      .eq('recipient_email', email)
      .in('status', ['sent', 'redeemed'])
      .single();

    if (alreadySent) {
      return res.status(409).json({ error: 'An invite was already sent to this email address.' });
    }

    // Get sender display name
    let senderName = user.email;
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();
      if (profile?.display_name) senderName = profile.display_name;
    } catch (_e) { /* use email as fallback */ }

    // Update code with recipient info
    await supabaseAdmin
      .from('referral_codes')
      .update({
        recipient_email: email,
        status:          'sent',
        sent_at:         new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      })
      .eq('id', ref.id);

    // Send real email via mailer
    const { sendReferralInvite } = require('../mailer');
    const mailResult = await sendReferralInvite({
      to:         email,
      senderName,
      code,
      appUrl:     process.env.APP_URL || `${req.protocol}://${req.get('host')}`,
    });

    logger.info({ component: 'Referral', userId: user.id, email, mailOk: mailResult.ok }, 'Referral invite sent');
    return res.json({
      success:   true,
      emailSent: mailResult.ok,
      message:   mailResult.ok
        ? `Invitația a fost trimisă la ${email}`
        : `Invitația a fost înregistrată pentru ${email} (email în configurare)`,
    });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'POST /send-invite failed');
    return res.status(500).json({ error: 'Failed to send invite' });
  }
});

// ─── POST /verify — Verify a referral code ───
router.post('/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code required', valid: false });
    }

    const result = verifyReferralCode(code);
    return res.json({
      valid: result.valid && !result.isExpired,
      isExpired: result.isExpired,
    });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'POST /verify failed');
    return res.status(500).json({ error: 'Verification failed', valid: false });
  }
});

// ─── POST /redeem — Redeem a referral code ───
router.post('/redeem', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code required' });
    }

    const check = verifyReferralCode(code);
    if (!check.valid) return res.status(400).json({ error: 'Invalid code format' });
    if (check.isExpired) return res.status(400).json({ error: 'Code has expired' });

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Find the active code
    const { data: ref } = await supabaseAdmin
      .from('referral_codes')
      .select('id, sender_id, status')
      .eq('code', code)
      .in('status', ['active', 'sent'])
      .single();

    if (!ref) return res.status(404).json({ error: 'Code not found or already redeemed' });
    if (ref.sender_id === user.id) return res.status(400).json({ error: 'Cannot redeem your own code' });

    // Mark as redeemed
    await supabaseAdmin
      .from('referral_codes')
      .update({
        status: 'redeemed',
        recipient_id: user.id,
        redeemed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ref.id);

    // Apply bonuses
    await applyReferralBonus(code, user.id, supabaseAdmin);

    logger.info({ component: 'Referral', userId: user.id, code }, 'Code redeemed');
    return res.json({
      success: true,
      bonusDays: RECEIVER_BONUS_DAYS,
      message: `Code redeemed! You earned ${RECEIVER_BONUS_DAYS} bonus days.`,
    });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'POST /redeem failed');
    return res.status(500).json({ error: 'Failed to redeem code' });
  }
});

// ─── GET /my-codes — List user's referral codes ───
router.get('/my-codes', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { data: codes } = await supabaseAdmin
      .from('referral_codes')
      .select(
        'id, code, status, recipient_email, expires_at, created_at, redeemed_at, sender_bonus_days, receiver_bonus_days'
      )
      .eq('sender_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.json({ codes: codes || [] });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'GET /my-codes failed');
    return res.status(500).json({ error: 'Failed to fetch codes' });
  }
});

// ─── GET /stats — Public referral stats (total referrals, top referrers) ───
router.get('/stats', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ totalReferrals: 0, totalCodes: 0, topReferrers: [] });

    const [codesRes, referralsRes] = await Promise.all([
      supabaseAdmin.from('referral_codes').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('referral_codes').select('code, uses_count, bonus_credits').order('uses_count', { ascending: false }).limit(10),
    ]);

    const totalCodes = codesRes.count || 0;
    const totalReferrals = (referralsRes.data || []).reduce((sum, r) => sum + (r.uses_count || 0), 0);
    const topReferrers = (referralsRes.data || [])
      .filter(r => r.uses_count > 0)
      .slice(0, 5)
      .map(r => ({ code: r.code.substring(0, 4) + '****', uses: r.uses_count, bonusCredits: r.bonus_credits }));

    return res.json({ totalReferrals, totalCodes, topReferrers });
  } catch (e) {
    logger.warn({ component: 'Referral.Stats', err: e.message }, 'Stats failed');
    return res.json({ totalReferrals: 0, totalCodes: 0, topReferrers: [] });
  }
});

router.get('/my-bonuses', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Sum bonus days where user is sender
    const { data: senderBonuses } = await supabaseAdmin
      .from('referral_codes')
      .select('sender_bonus_days')
      .eq('sender_id', user.id)
      .eq('sender_bonus_applied', true);

    // Sum bonus days where user is receiver
    const { data: receiverBonuses } = await supabaseAdmin
      .from('referral_codes')
      .select('receiver_bonus_days')
      .eq('recipient_id', user.id)
      .eq('receiver_bonus_applied', true);

    const senderTotal = (senderBonuses || []).reduce((sum, r) => sum + (r.sender_bonus_days || 0), 0);
    const receiverTotal = (receiverBonuses || []).reduce((sum, r) => sum + (r.receiver_bonus_days || 0), 0);

    return res.json({
      totalBonusDays: senderTotal + receiverTotal,
      senderBonusDays: senderTotal,
      receiverBonusDays: receiverTotal,
    });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'GET /my-bonuses failed');
    return res.status(500).json({ error: 'Failed to fetch bonuses' });
  }
});

// ─── DELETE /revoke/:codeId — Revoke an active code ───
router.delete('/revoke/:codeId', async (req, res) => {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { codeId } = req.params;
    if (!codeId) return res.status(400).json({ error: 'Code ID required' });

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { data: ref } = await supabaseAdmin
      .from('referral_codes')
      .select('id, status')
      .eq('id', codeId)
      .eq('sender_id', user.id)
      .single();

    if (!ref) return res.status(404).json({ error: 'Code not found' });
    if (ref.status === 'redeemed') return res.status(400).json({ error: 'Cannot revoke a redeemed code' });

    await supabaseAdmin
      .from('referral_codes')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('id', ref.id);

    logger.info({ component: 'Referral', userId: user.id, codeId }, 'Code revoked');
    return res.json({ success: true });
  } catch (err) {
    logger.error({ component: 'Referral', err: err.message }, 'DELETE /revoke failed');
    return res.status(500).json({ error: 'Failed to revoke code' });
  }
});

module.exports = router;
