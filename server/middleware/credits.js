// ═══════════════════════════════════════════════════════════════
// KelionAI — Credits Middleware
// Deducts credits per AI request and alerts when credits are low
// Usage: router.post('/chat', deductCredit(1), handler)
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('../logger');

const CREDIT_ALERT_THRESHOLD = parseInt(process.env.CREDIT_ALERT_THRESHOLD || '10');
// Track which users we've already alerted this session (in-memory dedup)
const _alertedUsers = new Set();

/**
 * Middleware factory: deducts `cost` credits from the authenticated user.
 * If user has insufficient credits → 402 Payment Required.
 * If credits drop below threshold → sends email alert (non-blocking).
 *
 * @param {number} cost - Credits to deduct (default: 1)
 */
function deductCredit(cost = 1) {
  return async function creditMiddleware(req, res, next) {
    // Skip if no auth or no DB
    const { supabaseAdmin } = req.app.locals;
    const userId = req.user?.id;
    if (!userId || !supabaseAdmin) return next();

    try {
      // Atomic decrement using RPC (avoids race conditions)
      const { data, error } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: userId,
        p_amount:  cost,
      });

      if (error) {
        // RPC not available — fallback to manual read/write
        logger.debug({ component: 'Credits', err: error.message }, 'RPC unavailable, using fallback');
        return _fallbackDeduct(req, res, next, supabaseAdmin, userId, cost);
      }

      // data = { ok: bool, credits_left: int }
      if (data && !data.ok) {
        return res.status(402).json({
          error:       'Insufficient credits',
          creditsLeft: data.credits_left ?? 0,
          code:        'CREDITS_EXHAUSTED',
        });
      }

      const creditsLeft = data?.credits_left ?? 0;
      req.creditsLeft   = creditsLeft;

      // Alert if below threshold (non-blocking, deduplicated)
      _maybeAlert(req, userId, creditsLeft).catch(() => {});

      return next();
    } catch (e) {
      logger.warn({ component: 'Credits', err: e.message }, 'Credit deduction error — allowing request');
      return next(); // fail-open to not block users on DB errors
    }
  };
}

async function _fallbackDeduct(req, res, next, supabaseAdmin, userId, cost) {
  try {
    // Read current credits
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits, plan, email')
      .eq('id', userId)
      .single();

    const current = profile?.credits ?? 0;

    if (current < cost) {
      return res.status(402).json({
        error:       'Insufficient credits',
        creditsLeft: current,
        code:        'CREDITS_EXHAUSTED',
      });
    }

    const newCredits = current - cost;

    // Update credits
    await supabaseAdmin
      .from('profiles')
      .update({ credits: newCredits, updated_at: new Date().toISOString() })
      .eq('id', userId);

    req.creditsLeft = newCredits;

    // Alert if below threshold
    _maybeAlert(req, userId, newCredits, profile?.email, profile?.plan).catch(() => {});

    return next();
  } catch (e) {
    logger.warn({ component: 'Credits', err: e.message }, 'Fallback credit deduction failed — allowing request');
    return next();
  }
}

async function _maybeAlert(req, userId, creditsLeft, email, plan) {
  if (creditsLeft > CREDIT_ALERT_THRESHOLD) return;

  // Deduplicate: alert once per user per server restart
  const alertKey = `${userId}:${creditsLeft <= 0 ? 'zero' : 'low'}`;
  if (_alertedUsers.has(alertKey)) return;
  _alertedUsers.add(alertKey);

  try {
    // Get user email if not provided
    if (!email) {
      const { supabaseAdmin } = req.app.locals;
      if (supabaseAdmin) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('email, plan')
          .eq('id', userId)
          .single();
        email = data?.email;
        plan  = data?.plan;
      }
    }

    if (!email) return;

    const alerts = require('../alerts');
    await alerts.alertCreditLow({
      userId,
      email,
      creditsLeft,
      plan:      plan || 'free',
      threshold: CREDIT_ALERT_THRESHOLD,
    });
  } catch (e) {
    logger.debug({ component: 'Credits', err: e.message }, 'Credit alert failed');
  }
}

/**
 * Check credits without deducting (for info endpoints).
 */
async function getCredits(supabaseAdmin, userId) {
  if (!supabaseAdmin || !userId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('credits, plan')
      .eq('id', userId)
      .single();
    return data;
  } catch (_e) { return null; }
}

module.exports = { deductCredit, getCredits };