'use strict';
/**
 * Database layer — Supabase (PostgreSQL) via REST API.
 * All public functions are async and preserve the same signatures.
 */

const fetch = require('node-fetch');

const SUPABASE_URL         = process.env.SUPABASE_URL         || 'https://nqlobybfwmtkmsqadqqr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbG9ieWJmd210a21zcWFkcXFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3MzAyMiwiZXhwIjoyMDg3NDQ5MDIyfQ.AngYdhgIOXas4UssEP1ENLiZCW9CYPgecvYej3PvLOQ';

const BASE_HEADERS = {
  'apikey':        SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type':  'application/json',
  'Prefer':        'return=representation',
};

async function sbQuery(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function findByGoogleId(googleId) {
  const rows = await sbQuery(`users?google_id=eq.${encodeURIComponent(googleId)}&limit=1`);
  return (rows && rows[0]) || null;
}

async function findByEmail(email) {
  const rows = await sbQuery(`users?email=eq.${encodeURIComponent(email)}&limit=1`);
  return (rows && rows[0]) || null;
}

async function findById(id) {
  const rows = await sbQuery(`users?id=eq.${encodeURIComponent(id)}&limit=1`);
  return (rows && rows[0]) || null;
}

async function findAll() {
  return await sbQuery('users?order=created_at.desc');
}

async function upsertUser(profile) {
  const { v4: uuidv4 } = require('uuid');
  const existing = await findByGoogleId(profile.googleId);
  const id  = existing ? existing.id : uuidv4();
  const now = new Date().toISOString();

  const payload = {
    id,
    google_id:     profile.googleId,
    email:         profile.email,
    name:          profile.name,
    picture:       profile.picture || null,
    avatar_url:    profile.picture || null,
    updated_at:    now,
    last_signed_in: now,
  };

  if (!existing) {
    payload.created_at          = now;
    payload.subscription_tier   = 'free';
    payload.subscription_status = 'active';
    payload.role                = 'user';
    payload.login_method        = 'google';
  }

  await sbQuery('users', {
    method:  'POST',
    headers: { ...BASE_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body:    JSON.stringify(payload),
  });

  return findByGoogleId(profile.googleId);
}

async function insertUser({ email, password, name, role = 'user' }) {
  const now = new Date().toISOString();
  const rows = await sbQuery('users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password_hash:       password,
      name,
      role,
      subscription_tier:   'free',
      subscription_status: 'active',
      login_method:        'local',
      created_at:          now,
      updated_at:          now,
      last_signed_in:      now,
    }),
  });
  return (rows && rows[0]) || null;
}

async function updateProfile(id, data) {
  const rows = await sbQuery(`users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body:   JSON.stringify({ name: data.name, updated_at: new Date().toISOString() }),
  });
  return (rows && rows[0]) || findById(id);
}

async function updateSubscription(id, data) {
  const patch = { updated_at: new Date().toISOString() };
  if (data.subscription_tier       !== undefined) patch.subscription_tier       = data.subscription_tier;
  if (data.subscription_status     !== undefined) patch.subscription_status     = data.subscription_status;
  if (data.subscription_expires_at !== undefined) patch.subscription_expires_at = data.subscription_expires_at;
  if (data.stripe_customer_id      !== undefined) patch.stripe_customer_id      = data.stripe_customer_id;

  const rows = await sbQuery(`users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body:   JSON.stringify(patch),
  });
  return (rows && rows[0]) || findById(id);
}

async function updateRole(id, role) {
  const rows = await sbQuery(`users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body:   JSON.stringify({ role, updated_at: new Date().toISOString() }),
  });
  return (rows && rows[0]) || findById(id);
}

// ---------------------------------------------------------------------------
// Usage logs
// ---------------------------------------------------------------------------

async function getUsageToday(userId) {
  // Supabase user_usage: messages_this_month resets monthly via last_reset_date
  const rows = await sbQuery(`user_usage?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  if (!rows || !rows[0]) return 0;
  const row = rows[0];
  const now = new Date();
  const resetDate = row.last_reset_date ? new Date(row.last_reset_date) : null;
  const sameMonth = resetDate &&
    resetDate.getFullYear() === now.getFullYear() &&
    resetDate.getMonth() === now.getMonth();
  return sameMonth ? (row.messages_this_month || 0) : 0;
}

async function incrementUsage(userId) {
  const rows = await sbQuery(`user_usage?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  const now = new Date();
  const nowISO = now.toISOString();
  if (!rows || !rows[0]) {
    await sbQuery('user_usage', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        messages_this_month: 1,
        voice_minutes_this_month: 0,
        last_reset_date: nowISO,
        created_at: nowISO,
        updated_at: nowISO,
      }),
    });
  } else {
    const row = rows[0];
    const resetDate = row.last_reset_date ? new Date(row.last_reset_date) : null;
    const sameMonth = resetDate &&
      resetDate.getFullYear() === now.getFullYear() &&
      resetDate.getMonth() === now.getMonth();
    const newCount = sameMonth ? (row.messages_this_month || 0) + 1 : 1;
    await sbQuery(`user_usage?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        messages_this_month: newCount,
        last_reset_date: sameMonth ? row.last_reset_date : nowISO,
        updated_at: nowISO,
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------

async function createReferralCode(userId) {
  const { v4: uuidv4 } = require('uuid');
  const code      = uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const now       = new Date().toISOString();

  const rows = await sbQuery('referral_codes', {
    method: 'POST',
    body:   JSON.stringify({ code, referrer_id: userId, expires_at: expiresAt, used: false, created_at: now }),
  });
  return (rows && rows[0]) || { code, expires_at: expiresAt };
}

async function findReferralCode(code) {
  const rows = await sbQuery(`referral_codes?code=eq.${encodeURIComponent(code)}&limit=1`);
  return (rows && rows[0]) || null;
}

async function useReferralCode(code, newUserId) {
  const ref = await findReferralCode(code);
  if (!ref)              throw new Error('Referral code not found');
  if (ref.used)          throw new Error('Referral code already used');
  if (new Date(ref.expires_at) < new Date()) throw new Error('Referral code expired');

  await sbQuery(`referral_codes?code=eq.${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body:   JSON.stringify({ used: true, used_by: newUserId, used_at: new Date().toISOString() }),
  });

  // Extend referrer subscription by 5 days
  const referrer = await findById(ref.referrer_id);
  if (referrer) {
    const base = referrer.subscription_expires_at
      ? new Date(referrer.subscription_expires_at)
      : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + 5);
    await updateSubscription(ref.referrer_id, { subscription_expires_at: base.toISOString() });
  }

  return ref;
}

console.log('[db] Supabase PostgreSQL layer loaded.');

module.exports = {
  findByGoogleId,
  findByEmail,
  findById,
  findAll,
  upsertUser,
  insertUser,
  updateProfile,
  updateSubscription,
  updateRole,
  getUsageToday,
  incrementUsage,
  createReferralCode,
  findReferralCode,
  useReferralCode,
};
