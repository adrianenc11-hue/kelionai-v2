// ═══════════════════════════════════════════════════════════════
// KelionAI — Payments module (plan limits, usage tracking)
// Exports: PLAN_LIMITS, checkUsage, incrementUsage, getUserPlan
// ZERO hardcode — toate limitele vin din server/config/app.js → .env
// ═══════════════════════════════════════════════════════════════
'use strict';
const logger = require('./logger');
const { PLAN_CONFIG } = require('./config/app');

// ── PLAN_LIMITS — structura compatibilă cu codul existent ──
// Extrage doar câmpul `limits` din fiecare plan
const PLAN_LIMITS = Object.fromEntries(
  Object.entries(PLAN_CONFIG).map(([key, plan]) => [
    key,
    {
      name:   plan.name,
      chat:   plan.limits.chat,
      search: plan.limits.search,
      image:  plan.limits.image,
      vision: plan.limits.vision,
      tts:    plan.limits.tts,
    },
  ])
);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getUserPlan(userId, supabaseAdmin) {
  if (!userId || !supabaseAdmin) return 'guest';
  try {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status, stripe_subscription_id, current_period_end')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    if (!sub) return 'free';
    if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
      return 'free';
    }
    return sub.plan || 'free';
  } catch (err) {
    logger.warn({ component: 'Payments', err: err.message }, 'getUserPlan failed, defaulting to free');
    return 'free';
  }
}

async function checkUsage(userId, type, supabaseAdmin, fingerprint) {
  const plan = userId ? await getUserPlan(userId, supabaseAdmin) : 'guest';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const limit = limits[type] ?? 0;

  if (process.env.DISABLE_USAGE_ENFORCEMENT === 'true') {
    return { allowed: true, plan, limit, used: 0, remaining: -1 };
  }

  if (limit === -1) {
    return { allowed: true, plan, limit: -1, used: 0, remaining: -1 };
  }

  if (!supabaseAdmin) {
    return { allowed: true, plan, limit, used: 0, remaining: limit };
  }

  try {
    const lookupId = userId || fingerprint || 'anon';
    const { data } = await supabaseAdmin
      .from('usage')
      .select('count')
      .eq('user_id', lookupId)
      .eq('type', type)
      .eq('date', todayDate())
      .single();
    const used = data?.count || 0;
    const remaining = limit - used;
    return { allowed: remaining > 0, plan, limit, used, remaining: Math.max(0, remaining) };
  } catch (err) {
    logger.warn({ component: 'Payments', err: err.message }, 'checkUsage query failed, allowing access');
    return { allowed: true, plan, limit, used: 0, remaining: limit };
  }
}

async function incrementUsage(userId, type, supabaseAdmin, fingerprint) {
  if (!supabaseAdmin) return;
  const lookupId = userId || fingerprint || 'anon';
  const date = todayDate();
  try {
    const { data } = await supabaseAdmin
      .from('usage')
      .select('id, count')
      .eq('user_id', lookupId)
      .eq('type', type)
      .eq('date', date)
      .single();
    if (data) {
      await supabaseAdmin
        .from('usage')
        .update({ count: data.count + 1 })
        .eq('id', data.id);
    } else {
      await supabaseAdmin.from('usage').insert({ user_id: lookupId, type, count: 1, date });
    }
  } catch (err) {
    logger.debug({ component: 'Payments', err: err.message }, 'incrementUsage best-effort failed');
  }
}

module.exports = { PLAN_LIMITS, checkUsage, incrementUsage, getUserPlan };