'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(config.dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                      TEXT PRIMARY KEY,
      google_id               TEXT UNIQUE,
      email                   TEXT UNIQUE NOT NULL,
      name                    TEXT NOT NULL,
      picture                 TEXT,
      avatar_url              TEXT,
      role                    TEXT NOT NULL DEFAULT 'user',
      password_hash           TEXT,
      subscription_tier       TEXT NOT NULL DEFAULT 'free',
      subscription_status     TEXT NOT NULL DEFAULT 'active',
      subscription_expires_at TEXT,
      stripe_customer_id      TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);

    CREATE TABLE IF NOT EXISTS usage_logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date    TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, date);

    CREATE TABLE IF NOT EXISTS referral_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT UNIQUE NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      used       INTEGER NOT NULL DEFAULT 0,
      used_by    TEXT REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
  `);

  const cols = db.pragma('table_info(users)').map((c) => c.name);
  const additions = [
    ['avatar_url',              'TEXT'],
    ['role',                    "TEXT NOT NULL DEFAULT 'user'"],
    ['password_hash',           'TEXT'],
    ['subscription_tier',       "TEXT NOT NULL DEFAULT 'free'"],
    ['subscription_status',     "TEXT NOT NULL DEFAULT 'active'"],
    ['subscription_expires_at', 'TEXT'],
    ['stripe_customer_id',      'TEXT'],
    ['last_login_at',           'TEXT'],
  ];
  for (const [col, def] of additions) {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
    }
  }
}

migrate();

// ---------------------------------------------------------------------------
// Prepared statements — users
// ---------------------------------------------------------------------------

const stmtFindByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?');
const stmtFindById       = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtFindByEmail    = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtFindAll        = db.prepare('SELECT * FROM users ORDER BY created_at DESC');

const stmtUpsertGoogle = db.prepare(`
  INSERT INTO users (id, google_id, email, name, picture, created_at, updated_at, last_login_at)
  VALUES (@id, @google_id, @email, @name, @picture, datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT(google_id) DO UPDATE SET
    email         = excluded.email,
    name          = excluded.name,
    picture       = excluded.picture,
    updated_at    = datetime('now'),
    last_login_at = datetime('now')
`);

const stmtInsertLocalUser = db.prepare(`
  INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
  VALUES (@id, @email, @name, @password_hash, @role, datetime('now'), datetime('now'))
`);

const stmtUpdateProfile = db.prepare(`
  UPDATE users SET name = @name, updated_at = datetime('now') WHERE id = @id
`);

const stmtUpdateSubscription = db.prepare(`
  UPDATE users
  SET subscription_tier       = @subscription_tier,
      subscription_status     = @subscription_status,
      subscription_expires_at = @subscription_expires_at,
      updated_at              = datetime('now')
  WHERE id = @id
`);

const stmtUpdateRole = db.prepare(`
  UPDATE users SET role = @role, updated_at = datetime('now') WHERE id = @id
`);

const stmtUpdateStripeCustomerId = db.prepare(`
  UPDATE users SET stripe_customer_id = @stripe_customer_id, updated_at = datetime('now') WHERE id = @id
`);

const stmtFindByStripeCustomerId = db.prepare(
  'SELECT * FROM users WHERE stripe_customer_id = ?'
);

// ---------------------------------------------------------------------------
// Prepared statements — usage_logs
// ---------------------------------------------------------------------------

const stmtGetUsageToday = db.prepare(
  "SELECT count FROM usage_logs WHERE user_id = ? AND date = date('now')"
);

const stmtIncrementUsage = db.prepare(`
  INSERT INTO usage_logs (user_id, date, count) VALUES (?, date('now'), 1)
  ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
`);

// ---------------------------------------------------------------------------
// Prepared statements — referral_codes
// ---------------------------------------------------------------------------

const stmtCreateReferralCode = db.prepare(`
  INSERT INTO referral_codes (code, owner_id, expires_at) VALUES (@code, @owner_id, @expires_at)
`);

const stmtFindReferralCode = db.prepare(
  'SELECT * FROM referral_codes WHERE code = ?'
);

const stmtMarkReferralUsed = db.prepare(`
  UPDATE referral_codes SET used = 1, used_by = @used_by WHERE code = @code AND used = 0
`);

const stmtExtendSubscription = db.prepare(`
  UPDATE users
  SET subscription_expires_at = datetime(COALESCE(subscription_expires_at, datetime('now')), '+5 days'),
      updated_at = datetime('now')
  WHERE id = @id
`);

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

function findByGoogleId(googleId) {
  return stmtFindByGoogleId.get(googleId);
}

function findById(id) {
  return stmtFindById.get(id);
}

function findByEmail(email) {
  return stmtFindByEmail.get(email);
}

function findAll() {
  return stmtFindAll.all();
}

/**
 * Create or update a user from Google OAuth profile data.
 */
function upsertUser(profile) {
  const { v4: uuidv4 } = require('uuid');
  let user = stmtFindByGoogleId.get(profile.googleId);
  stmtUpsertGoogle.run({
    id:        user ? user.id : uuidv4(),
    google_id: profile.googleId,
    email:     profile.email,
    name:      profile.name,
    picture:   profile.picture || null,
  });
  return stmtFindByGoogleId.get(profile.googleId);
}

/**
 * Insert a brand-new local (email/password) user.
 */
function insertUser({ email, password_hash, name, role = 'user' }) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  stmtInsertLocalUser.run({ id, email, name, password_hash, role });
  return stmtFindById.get(id);
}

function updateProfile(id, data) {
  stmtUpdateProfile.run({ id, name: data.name });
  return stmtFindById.get(id);
}

function updateRole(id, role) {
  stmtUpdateRole.run({ id, role });
  return stmtFindById.get(id);
}

function updateSubscription(id, data) {
  stmtUpdateSubscription.run({
    id,
    subscription_tier:       data.subscription_tier,
    subscription_status:     data.subscription_status,
    subscription_expires_at: data.subscription_expires_at || null,
  });
  return stmtFindById.get(id);
}

function updateStripeCustomerId(id, stripeCustomerId) {
  stmtUpdateStripeCustomerId.run({ id, stripe_customer_id: stripeCustomerId });
}

function findByStripeCustomerId(stripeCustomerId) {
  return stmtFindByStripeCustomerId.get(stripeCustomerId);
}

function getUsageToday(userId) {
  const row = stmtGetUsageToday.get(userId);
  return row ? row.count : 0;
}

function incrementUsage(userId) {
  stmtIncrementUsage.run(userId);
}

/**
 * Generate a new referral code for a user (expires in 30 days).
 */
function createReferralCode(ownerId) {
  const { v4: uuidv4 } = require('uuid');
  const code = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  stmtCreateReferralCode.run({ code, owner_id: ownerId, expires_at: expiresAt });
  return stmtFindReferralCode.get(code);
}

/**
 * Find a referral code by its string value.
 */
function findReferralCode(code) {
  return stmtFindReferralCode.get(code);
}

/**
 * Mark a referral code as used and extend the referrer's subscription by 5 days.
 * Throws if the code is invalid, already used, or expired.
 */
function useReferralCode(code, usedByUserId) {
  const ref = stmtFindReferralCode.get(code);
  if (!ref) throw new Error('Referral code not found');
  if (ref.used) throw new Error('Referral code already used');
  if (new Date(ref.expires_at) < new Date()) throw new Error('Referral code expired');
  if (ref.owner_id === usedByUserId) throw new Error('Cannot use your own referral code');

  const applyReferral = db.transaction(() => {
    stmtMarkReferralUsed.run({ code, used_by: usedByUserId });
    stmtExtendSubscription.run({ id: ref.owner_id });
  });
  applyReferral();
}

module.exports = {
  db,
  findByGoogleId,
  findById,
  findByEmail,
  findAll,
  upsertUser,
  insertUser,
  updateProfile,
  updateRole,
  updateSubscription,
  updateStripeCustomerId,
  findByStripeCustomerId,
  getUsageToday,
  incrementUsage,
  createReferralCode,
  findReferralCode,
  useReferralCode,
};
