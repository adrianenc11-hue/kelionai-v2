// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — REFERRAL SYSTEM v2
// HMAC-signed codes, bonus logic, email sending
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { validate, referralSendInviteSchema, referralVerifySchema, referralRedeemSchema } = require('./validation');

const router = express.Router();

// ═══ CONSTANTS ═══
const CODE_EXPIRY_DAYS = parseInt(process.env.REFERRAL_EXPIRY_DAYS) || 14;
const MAX_ACTIVE_CODES_PER_MONTH = 5;
const SENDER_BONUS_DAYS = 10;
const RECEIVER_BONUS_DAYS = 5;
const MAX_INVITE_EMAILS_PER_HOUR = 3;

// ═══ RATE LIMITERS ═══
const generateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many code generation requests. Please try again later.' }
});

const inviteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: MAX_INVITE_EMAILS_PER_HOUR,
    message: { error: 'Too many invite emails sent. Please try again later.' }
});

// ═══ HMAC CODE GENERATION ═══

function getReferralSecret() {
    const secret = process.env.REFERRAL_SECRET || process.env.SESSION_SECRET;
    if (!secret) {
        logger.warn({ component: 'Referral' }, '⚠️  No REFERRAL_SECRET or SESSION_SECRET set — referral codes use insecure fallback. Set one of these env vars in production.');
        return 'kelion-referral-secret';
    }
    return secret;
}

/**
 * Generate a secure HMAC-signed referral code.
 * Format: KEL-{userId_4chars}-{timestamp_hex_6chars}-{HMAC_10chars}
 */
function generateSecureReferralCode(userId) {
    const userFragment = userId.replace(/-/g, '').slice(0, 4);
    const tsHex = (Math.floor(Date.now() / 1000) & 0xFFFFFF).toString(16).padStart(6, '0');
    const payload = `${userFragment}-${tsHex}`;
    const hmac = crypto.createHmac('sha256', getReferralSecret())
        .update(payload)
        .digest('hex')
        .slice(0, 10)
        .toUpperCase();
    return `KEL-${userFragment}-${tsHex}-${hmac}`;
}

/**
 * Verify a referral code's HMAC signature and optionally check expiry.
 * Returns { valid, userFragment, tsHex, isExpired }
 */
function verifyReferralCode(code) {
    if (!code || typeof code !== 'string') return { valid: false };

    const parts = code.split('-');
    // Format: KEL-{4chars}-{6chars}-{10chars}
    if (parts.length !== 4) return { valid: false };
    const [prefix, userFragment, tsHex, providedHmac] = parts;
    if (prefix !== 'KEL') return { valid: false };
    if (!/^[0-9a-fA-F]{4}$/.test(userFragment)) return { valid: false };
    if (!/^[0-9a-fA-F]{6}$/.test(tsHex)) return { valid: false };
    if (!providedHmac || providedHmac.length !== 10) return { valid: false };

    const payload = `${userFragment}-${tsHex}`;
    const expectedHmac = crypto.createHmac('sha256', getReferralSecret())
        .update(payload)
        .digest('hex')
        .slice(0, 10)
        .toUpperCase();

    const hmacValid = crypto.timingSafeEqual(
        Buffer.from(providedHmac.toUpperCase()),
        Buffer.from(expectedHmac)
    );
    if (!hmacValid) return { valid: false };

    // Check expiry — tsHex is low 24 bits of Unix timestamp in seconds
    const codeTs = parseInt(tsHex, 16);
    const nowLow24 = Math.floor(Date.now() / 1000) & 0xFFFFFF;
    // Compute age handling 24-bit wrap-around (~194 days >> CODE_EXPIRY_DAYS)
    let age = nowLow24 - codeTs;
    if (age < 0) age += 0x1000000;
    const expirySeconds = CODE_EXPIRY_DAYS * 24 * 60 * 60;
    const isExpired = age > expirySeconds;

    return { valid: true, userFragment, tsHex, isExpired };
}

/**
 * Hash a code for storage (prevents exposing codes in DB queries).
 */
function hashCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Mask an email address: j***@gmail.com
 */
function maskEmail(email) {
    if (!email || !email.includes('@')) return '***';
    const [local, domain] = email.split('@');
    return local.charAt(0) + '***@' + domain;
}

// ═══ EMAIL SENDING ═══

let nodemailerTransport = null;

function getMailTransport() {
    if (nodemailerTransport) return nodemailerTransport;
    try {
        const nodemailer = require('nodemailer');
        if (process.env.SENDGRID_API_KEY) {
            nodemailerTransport = nodemailer.createTransport({
                host: 'smtp.sendgrid.net',
                port: 587,
                auth: {
                    user: 'apikey',
                    pass: process.env.SENDGRID_API_KEY
                }
            });
            logger.info({ component: 'Referral' }, 'Email transport: SendGrid');
        } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            nodemailerTransport = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            logger.info({ component: 'Referral' }, 'Email transport: SMTP');
        } else {
            // Development fallback: log to console
            nodemailerTransport = nodemailer.createTransport({ jsonTransport: true });
            logger.info({ component: 'Referral' }, 'Email transport: console (dev mode)');
        }
    } catch (e) {
        logger.warn({ component: 'Referral', err: e.message }, 'nodemailer unavailable');
    }
    return nodemailerTransport;
}

async function sendInviteEmail({ to, senderName, code, expiresAt }) {
    const appUrl = process.env.APP_URL || 'https://kelionai.app';
    const inviteLink = `${appUrl}/?invite=${encodeURIComponent(code)}`;
    const expiryDate = new Date(expiresAt).toLocaleDateString('ro-RO');

    const subject = `${senderName} te invită să încerci KelionAI`;
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a1a;color:#e0e0e0;margin:0;padding:20px">
<div style="max-width:520px;margin:0 auto;background:#12122a;border-radius:16px;padding:32px;border:1px solid rgba(0,255,255,0.15)">
  <h1 style="color:#00ffff;font-size:1.5rem;margin:0 0 8px">🎁 Invitație KelionAI</h1>
  <p style="color:#aaa;margin:0 0 24px">de la prietenul tău <strong style="color:#fff">${senderName}</strong></p>
  <p style="margin:0 0 16px">Ai primit o invitație personală la <strong style="color:#00ffff">KelionAI</strong> — asistentul AI cu avatare 3D.</p>
  <p style="margin:0 0 24px">Folosind această invitație, vei primi <strong style="color:#00ff88">+${RECEIVER_BONUS_DAYS} zile gratuit</strong> la prima ta subscripție!</p>
  <div style="background:#0a0a1a;border:2px solid #00ffff;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px">
    <div style="color:#888;font-size:0.8rem;margin-bottom:8px">CODUL TĂU DE INVITAȚIE</div>
    <div style="font-size:1.4rem;font-weight:bold;color:#00ffff;letter-spacing:2px;font-family:monospace">${code}</div>
    <div style="color:#666;font-size:0.75rem;margin-top:8px">Expiră pe ${expiryDate}</div>
  </div>
  <div style="text-align:center;margin:0 0 24px">
    <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#00ffff,#00ff88);color:#000;font-weight:bold;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:1rem">
      🚀 Încearcă KelionAI
    </a>
  </div>
  <p style="color:#666;font-size:0.78rem;text-align:center;margin:0">
    Codul este valabil ${CODE_EXPIRY_DAYS} zile. Un singur cod per cont.
  </p>
</div>
</body>
</html>`;

    const transport = getMailTransport();
    if (!transport) {
        logger.info({ component: 'Referral', to, code }, '[DEV] Invite email would be sent');
        return;
    }

    const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@kelionai.app';

    try {
        const info = await transport.sendMail({ from, to, subject, html });
        // If jsonTransport (dev mode), log the message
        if (info.message) {
            logger.info({ component: 'Referral', to, code }, '[DEV] Invite email:\n' + info.message);
        }
        logger.info({ component: 'Referral', to }, 'Invite email sent');
    } catch (e) {
        logger.warn({ component: 'Referral', err: e.message, to }, 'Failed to send invite email');
        throw e;
    }
}

// ═══ BONUS APPLICATION ═══

/**
 * Apply referral bonuses after a successful first payment.
 * Called from the Stripe webhook (checkout.session.completed).
 * NEVER downgrades an existing plan — only extends period.
 */
async function applyReferralBonus(code, recipientUserId, supabaseAdmin) {
    if (!code || !recipientUserId || !supabaseAdmin) return;

    try {
        const { data: refCode } = await supabaseAdmin
            .from('referral_codes')
            .select('id, sender_id, status, receiver_bonus_applied, sender_bonus_applied, recipient_id')
            .eq('code', code)
            .single();

        if (!refCode) return;
        if (refCode.status !== 'redeemed') return;
        if (refCode.receiver_bonus_applied && refCode.sender_bonus_applied) return;

        const now = new Date();

        // ── Apply RECEIVER bonus (+5 days) ──
        if (!refCode.receiver_bonus_applied) {
            await extendSubscription(recipientUserId, RECEIVER_BONUS_DAYS, supabaseAdmin);
            await supabaseAdmin.from('referral_codes')
                .update({ receiver_bonus_applied: true, updated_at: now.toISOString() })
                .eq('id', refCode.id);
            logger.info({ component: 'Referral', userId: recipientUserId, days: RECEIVER_BONUS_DAYS }, '✅ Receiver bonus applied');
        }

        // ── Apply SENDER bonus (+10 days) ──
        if (!refCode.sender_bonus_applied) {
            await extendSubscription(refCode.sender_id, SENDER_BONUS_DAYS, supabaseAdmin);
            await supabaseAdmin.from('referral_codes')
                .update({ sender_bonus_applied: true, updated_at: now.toISOString() })
                .eq('id', refCode.id);
            logger.info({ component: 'Referral', userId: refCode.sender_id, days: SENDER_BONUS_DAYS }, '✅ Sender bonus applied');
        }
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'applyReferralBonus error');
    }
}

// Plan rank used to prevent downgrades (exported for testability)
const PLAN_RANK = { free: 0, pro: 1, premium: 2, enterprise: 2 };

/**
 * Extend a user's subscription by N days without downgrading their plan.
 */
async function extendSubscription(userId, days, supabaseAdmin) {

    const { data: existing } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, current_period_end, stripe_subscription_id')
        .eq('user_id', userId)
        .single();

    const msToAdd = days * 24 * 60 * 60 * 1000;
    const now = new Date();

    if (existing && existing.status === 'active' && existing.stripe_subscription_id) {
        // Extend existing paid subscription period
        const base = new Date(existing.current_period_end) > now
            ? new Date(existing.current_period_end)
            : now;
        const newEnd = new Date(base.getTime() + msToAdd);
        await supabaseAdmin.from('subscriptions')
            .update({ current_period_end: newEnd.toISOString(), updated_at: now.toISOString() })
            .eq('user_id', userId);
    } else if (existing && existing.status === 'active') {
        // Has active subscription (non-Stripe / referral) — extend it
        const base = existing.current_period_end && new Date(existing.current_period_end) > now
            ? new Date(existing.current_period_end)
            : now;
        const newEnd = new Date(base.getTime() + msToAdd);
        // Never downgrade: give at least 'pro' for bonus, keep premium if they have it
        const currentRank = PLAN_RANK[existing.plan] || 0;
        const bonusPlan = currentRank >= PLAN_RANK.premium ? existing.plan : 'pro';
        await supabaseAdmin.from('subscriptions')
            .update({ plan: bonusPlan, current_period_end: newEnd.toISOString(), updated_at: now.toISOString() })
            .eq('user_id', userId);
    } else {
        // Free user — create temporary Pro subscription
        const newEnd = new Date(now.getTime() + msToAdd);
        await supabaseAdmin.from('subscriptions').upsert({
            user_id: userId,
            plan: 'pro',
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: newEnd.toISOString(),
            source: 'referral'
        }, { onConflict: 'user_id' });
    }
}

// ═══ ROUTES ═══

// POST /api/referral/generate — generate a new HMAC-signed code
router.post('/generate', generateLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        // Check max codes this calendar month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { data: activeCodes } = await supabaseAdmin
            .from('referral_codes')
            .select('id')
            .eq('sender_id', user.id)
            .in('status', ['active', 'pending_send', 'sent'])
            .gte('created_at', startOfMonth.toISOString());

        const activeCount = activeCodes ? activeCodes.length : 0;
        if (activeCount >= MAX_ACTIVE_CODES_PER_MONTH) {
            return res.status(429).json({
                error: `Maximum ${MAX_ACTIVE_CODES_PER_MONTH} active codes per month reached.`,
                codesRemainingThisMonth: 0
            });
        }

        const code = generateSecureReferralCode(user.id);
        const codeHash = hashCode(code);
        const expiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const { error: insertError } = await supabaseAdmin.from('referral_codes').insert({
            sender_id: user.id,
            code,
            code_hash: codeHash,
            status: 'active',
            expires_at: expiresAt,
            sender_bonus_days: SENDER_BONUS_DAYS,
            receiver_bonus_days: RECEIVER_BONUS_DAYS
        });

        if (insertError) {
            logger.error({ component: 'Referral', err: insertError.message }, 'Failed to insert referral code');
            return res.status(500).json({ error: 'Failed to generate referral code' });
        }

        logger.info({ component: 'Referral', userId: user.id, code }, '🎁 New referral code generated');
        res.json({
            code,
            expiresAt,
            codesRemainingThisMonth: MAX_ACTIVE_CODES_PER_MONTH - activeCount - 1
        });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'Generate error');
        res.status(500).json({ error: 'Failed to generate referral code' });
    }
});

// POST /api/referral/send-invite — send invite email for a code
router.post('/send-invite', inviteLimiter, validate(referralSendInviteSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { code, email } = req.body;
        if (!code || !email) return res.status(400).json({ error: 'code and email are required' });

        // Validate code belongs to sender, is active/not expired
        const { data: refCode } = await supabaseAdmin
            .from('referral_codes')
            .select('id, status, expires_at, sender_id')
            .eq('code', code)
            .eq('sender_id', user.id)
            .single();

        if (!refCode) return res.status(404).json({ error: 'Code not found or does not belong to you' });
        if (!['active', 'pending_send'].includes(refCode.status)) {
            return res.status(400).json({ error: 'Code is not available for sending' });
        }
        if (new Date(refCode.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Code has expired' });
        }

        const senderName = user.user_metadata?.full_name || user.email.split('@')[0];

        await sendInviteEmail({ to: email, senderName, code, expiresAt: refCode.expires_at });

        // Update code status
        await supabaseAdmin.from('referral_codes')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                recipient_email: email,
                updated_at: new Date().toISOString()
            })
            .eq('id', refCode.id);

        res.json({ success: true, message: 'Invitation sent' });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'Send invite error');
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

// POST /api/referral/verify — public endpoint, verify code HMAC + DB
router.post('/verify', validate(referralVerifySchema), async (req, res) => {
    try {
        const { supabaseAdmin } = req.app.locals;
        const { code } = req.body;
        if (!code) return res.status(400).json({ valid: false, error: 'Code is required' });

        const verification = verifyReferralCode(code);
        if (!verification.valid) return res.json({ valid: false });
        if (verification.isExpired) return res.json({ valid: false, reason: 'expired' });

        if (!supabaseAdmin) {
            // No DB — trust HMAC only
            return res.json({ valid: true });
        }

        const { data: refCode } = await supabaseAdmin
            .from('referral_codes')
            .select('id, status, expires_at, sender_id, sender_bonus_days, receiver_bonus_days')
            .eq('code', code)
            .single();

        if (!refCode) return res.json({ valid: false, reason: 'not_found' });
        if (refCode.status === 'redeemed') return res.json({ valid: false, reason: 'already_redeemed' });
        if (refCode.status === 'revoked') return res.json({ valid: false, reason: 'revoked' });
        if (refCode.status === 'expired') return res.json({ valid: false, reason: 'expired' });
        if (new Date(refCode.expires_at) < new Date()) return res.json({ valid: false, reason: 'expired' });

        // Get sender name
        let senderName = 'A friend';
        try {
            const { data: sender } = await supabaseAdmin.auth.admin.getUserById(refCode.sender_id);
            if (sender?.user) {
                senderName = sender.user.user_metadata?.full_name || sender.user.email?.split('@')[0] || 'A friend';
            }
        } catch (_e) {}

        res.json({
            valid: true,
            expiresAt: refCode.expires_at,
            senderName,
            receiverBonusDays: refCode.receiver_bonus_days || RECEIVER_BONUS_DAYS
        });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'Verify error');
        res.status(500).json({ valid: false, error: 'Verification error' });
    }
});

// POST /api/referral/redeem — redeem a referral code (auth required)
router.post('/redeem', validate(referralRedeemSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Code is required' });

        // HMAC verification
        const verification = verifyReferralCode(code);
        if (!verification.valid) return res.status(400).json({ error: 'Invalid referral code' });
        if (verification.isExpired) return res.status(400).json({ error: 'Referral code has expired' });

        // DB lookup
        const { data: refCode } = await supabaseAdmin
            .from('referral_codes')
            .select('id, sender_id, status, expires_at, recipient_id')
            .eq('code', code)
            .single();

        if (!refCode) return res.status(404).json({ error: 'Referral code not found' });
        if (refCode.status === 'redeemed') return res.status(400).json({ error: 'Referral code has already been redeemed' });
        if (refCode.status === 'revoked') return res.status(400).json({ error: 'Referral code has been revoked' });
        if (refCode.status === 'expired') return res.status(400).json({ error: 'Referral code has expired' });
        if (new Date(refCode.expires_at) < new Date()) return res.status(400).json({ error: 'Referral code has expired' });

        // Self-referral check
        if (refCode.sender_id === user.id) {
            return res.status(400).json({ error: 'You cannot use your own referral code' });
        }

        // Check if this user already redeemed a code
        const { data: alreadyRedeemed } = await supabaseAdmin
            .from('referral_codes')
            .select('id')
            .eq('recipient_id', user.id)
            .eq('status', 'redeemed')
            .single();

        if (alreadyRedeemed) {
            return res.status(400).json({ error: 'You have already redeemed a referral code' });
        }

        // Mark as redeemed — store recipient_id
        await supabaseAdmin.from('referral_codes')
            .update({
                status: 'redeemed',
                recipient_id: user.id,
                redeemed_at: new Date().toISOString(),
                redeemed_via: 'web',
                updated_at: new Date().toISOString()
            })
            .eq('id', refCode.id);

        // Check if user already has active paid subscription → apply bonus immediately
        const { data: existingSub } = await supabaseAdmin
            .from('subscriptions')
            .select('plan, status, stripe_subscription_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single();

        if (existingSub && existingSub.stripe_subscription_id) {
            // Already paid — apply receiver bonus immediately
            await applyReferralBonus(code, user.id, supabaseAdmin);
            return res.json({
                success: true,
                message: `Code accepted! +${RECEIVER_BONUS_DAYS} bonus days have been added to your subscription.`
            });
        }

        logger.info({ component: 'Referral', userId: user.id, code }, '🎁 Referral code redeemed');
        res.json({
            success: true,
            message: 'Code accepted! Bonus will be applied to your subscription.'
        });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'Redeem error');
        res.status(500).json({ error: 'Redeem error' });
    }
});

// GET /api/referral/my-codes — list sender's codes
router.get('/my-codes', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { data: codes } = await supabaseAdmin
            .from('referral_codes')
            .select('id, code, status, recipient_email, created_at, expires_at, redeemed_at, sender_bonus_days, receiver_bonus_days, sender_bonus_applied, receiver_bonus_applied')
            .eq('sender_id', user.id)
            .order('created_at', { ascending: false });

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const mappedCodes = (codes || []).map(c => ({
            ...c,
            recipient_email: c.recipient_email ? maskEmail(c.recipient_email) : null
        }));

        const activeCodesCount = mappedCodes.filter(c =>
            ['active', 'pending_send', 'sent'].includes(c.status) &&
            new Date(c.expires_at) > new Date()
        ).length;

        const totalBonusDaysEarned = (codes || [])
            .filter(c => c.sender_bonus_applied)
            .reduce((sum, c) => sum + (c.sender_bonus_days || 0), 0);

        res.json({
            codes: mappedCodes,
            totalBonusDaysEarned,
            activeCodesCount,
            maxCodesPerMonth: MAX_ACTIVE_CODES_PER_MONTH
        });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'My-codes error');
        res.status(500).json({ error: 'Failed to fetch referral codes' });
    }
});

// GET /api/referral/my-bonuses — bonus history
router.get('/my-bonuses', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        // Bonuses as sender
        const { data: sentCodes } = await supabaseAdmin
            .from('referral_codes')
            .select('id, code, sender_bonus_days, sender_bonus_applied, redeemed_at, updated_at')
            .eq('sender_id', user.id)
            .eq('sender_bonus_applied', true);

        // Bonuses as receiver
        const { data: receivedCodes } = await supabaseAdmin
            .from('referral_codes')
            .select('id, code, receiver_bonus_days, receiver_bonus_applied, redeemed_at, updated_at')
            .eq('recipient_id', user.id)
            .eq('receiver_bonus_applied', true);

        const senderBonusDays = (sentCodes || []).reduce((s, c) => s + (c.sender_bonus_days || 0), 0);
        const receiverBonusDays = (receivedCodes || []).reduce((s, c) => s + (c.receiver_bonus_days || 0), 0);

        const events = [
            ...(sentCodes || []).map(c => ({
                type: 'sender',
                code: c.code,
                bonusDays: c.sender_bonus_days || 0,
                date: c.redeemed_at || c.updated_at
            })),
            ...(receivedCodes || []).map(c => ({
                type: 'receiver',
                code: c.code,
                bonusDays: c.receiver_bonus_days || 0,
                date: c.redeemed_at || c.updated_at
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({
            senderBonusDays,
            receiverBonusDays,
            totalBonusDays: senderBonusDays + receiverBonusDays,
            events
        });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'My-bonuses error');
        res.status(500).json({ error: 'Failed to fetch bonus history' });
    }
});

// DELETE /api/referral/revoke/:codeId — revoke a code
router.delete('/revoke/:codeId', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Authentication required' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

        const { codeId } = req.params;
        if (!codeId) return res.status(400).json({ error: 'Code ID is required' });

        const { data: refCode } = await supabaseAdmin
            .from('referral_codes')
            .select('id, sender_id, status')
            .eq('id', codeId)
            .eq('sender_id', user.id)
            .single();

        if (!refCode) return res.status(404).json({ error: 'Code not found' });
        if (!['active', 'pending_send', 'sent'].includes(refCode.status)) {
            return res.status(400).json({ error: 'Only active or sent codes can be revoked' });
        }

        await supabaseAdmin.from('referral_codes')
            .update({ status: 'revoked', updated_at: new Date().toISOString() })
            .eq('id', codeId);

        logger.info({ component: 'Referral', userId: user.id, codeId }, 'Code revoked');
        res.json({ success: true, message: 'Code revoked successfully' });
    } catch (e) {
        logger.error({ component: 'Referral', err: e.message }, 'Revoke error');
        res.status(500).json({ error: 'Failed to revoke code' });
    }
});

module.exports = {
    router,
    generateSecureReferralCode,
    verifyReferralCode,
    applyReferralBonus,
    hashCode,
    CODE_EXPIRY_DAYS,
    MAX_ACTIVE_CODES_PER_MONTH,
    SENDER_BONUS_DAYS,
    RECEIVER_BONUS_DAYS
};
