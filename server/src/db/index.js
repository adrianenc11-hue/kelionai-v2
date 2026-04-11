'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

// Ensure the directory for the DB file exists
const dbDir = path.dirname(path.resolve(config.dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(config.dbPath));

// Enable WAL mode for better concurrent-read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Run schema migrations (idempotent).
 */
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                     TEXT PRIMARY KEY,           -- UUID
      google_id              TEXT UNIQUE NOT NULL,
      email                  TEXT UNIQUE NOT NULL,
      name                   TEXT NOT NULL,
      picture                TEXT,
      avatar_url             TEXT,
      subscription_tier      TEXT NOT NULL DEFAULT 'free',
      subscription_status    TEXT NOT NULL DEFAULT 'active',
      subscription_expires_at TEXT,
      stripe_customer_id     TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at          TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);

    CREATE TABLE IF NOT EXISTS usage_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,              -- YYYY-MM-DD
      count      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, date);
  `);

  // Add new columns to existing users table if they don't exist yet (migration safety)
  const cols = db.pragma('table_info(users)').map((c) => c.name);
  const additions = [
    ['avatar_url',              'TEXT'],
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
// Prepared statements
// ---------------------------------------------------------------------------

const stmtFindByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?');
const stmtFindById       = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtFindAll        = db.prepare('SELECT * FROM users ORDER BY created_at DESC');

const stmtUpsert = db.prepare(`
  INSERT INTO users (id, google_id, email, name, picture, created_at, updated_at, last_login_at)
  VALUES (@id, @google_id, @email, @name, @picture, datetime('now'), datetime('now'), datetime('now'))
  ON CONFLICT(google_id) DO UPDATE SET
    email         = excluded.email,
    name          = excluded.name,
    picture       = excluded.picture,
    updated_at    = datetime('now'),
    last_login_at = datetime('now')
`);

const stmtUpdateProfile = db.prepare(`
  UPDATE users
  SET name = @name, updated_at = datetime('now')
  WHERE id = @id
`);

const stmtUpdateSubscription = db.prepare(`
  UPDATE users
  SET subscription_tier      = @subscription_tier,
      subscription_status    = @subscription_status,
      subscription_expires_at = @subscription_expires_at,
      updated_at             = datetime('now')
  WHERE id = @id
`);

const stmtUpdateStripeCustomerId = db.prepare(`
  UPDATE users
  SET stripe_customer_id = @stripe_customer_id,
      updated_at         = datetime('now')
  WHERE id = @id
`);

const stmtFindByStripeCustomerId = db.prepare(
  'SELECT * FROM users WHERE stripe_customer_id = ?'
);

// Usage logs
const stmtGetUsageToday = db.prepare(`
  SELECT count FROM usage_logs WHERE user_id = ? AND date = date('now')
`);

const stmtIncrementUsage = db.prepare(`
  INSERT INTO usage_logs (user_id, date, count)
  VALUES (?, date('now'), 1)
  ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
`);

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Find a user by their Google subject ID.
 * @param {string} googleId
 * @returns {object|undefined}
 */
function findByGoogleId(googleId) {
  return stmtFindByGoogleId.get(googleId);
}

/**
 * Find a user by their internal UUID.
 * @param {string} id
 * @returns {object|undefined}
 */
function findById(id) {
  return stmtFindById.get(id);
}

/**
 * Return all users ordered by created_at desc.
 * @returns {object[]}
 */
function findAll() {
  return stmtFindAll.all();
}

/**
 * Create or update a user from Google profile data.
 * Returns the user row after the upsert.
 *
 * @param {{ googleId: string, email: string, name: string, picture?: string }} profile
 * @returns {object}
 */
function upsertUser(profile) {
  const { v4: uuidv4 } = require('uuid');

  // Try to find existing user first (to preserve the id)
  let user = stmtFindByGoogleId.get(profile.googleId);

  stmtUpsert.run({
    id:        user ? user.id : uuidv4(),
    google_id: profile.googleId,
    email:     profile.email,
    name:      profile.name,
    picture:   profile.picture || null,
  });

  return stmtFindByGoogleId.get(profile.googleId);
}

/**
 * Update a user's display name.
 * @param {string} id
 * @param {{ name: string }} data
 * @returns {object|undefined}
 */
function updateProfile(id, data) {
  stmtUpdateProfile.run({ id, name: data.name });
  return stmtFindById.get(id);
}

/**
 * Update a user's Stripe customer ID.
 * @param {string} id
 * @param {string} stripeCustomerId
 */
function updateStripeCustomerId(id, stripeCustomerId) {
  stmtUpdateStripeCustomerId.run({ id, stripe_customer_id: stripeCustomerId });
}

/**
 * Find a user by their Stripe customer ID.
 * @param {string} stripeCustomerId
 * @returns {object|undefined}
 */
function findByStripeCustomerId(stripeCustomerId) {
  return stmtFindByStripeCustomerId.get(stripeCustomerId);
}

/**
 * Update a user's subscription.
 * @param {string} id
 * @param {{ subscription_tier: string, subscription_status: string, subscription_expires_at: string|null }} data
 * @returns {object|undefined}
 */
function updateSubscription(id, data) {
  stmtUpdateSubscription.run({
    id,
    subscription_tier:       data.subscription_tier,
    subscription_status:     data.subscription_status,
    subscription_expires_at: data.subscription_expires_at || null,
  });
  return stmtFindById.get(id);
}

/**
 * Get today's usage count for a user.
 * @param {string} userId
 * @returns {number}
 */
function getUsageToday(userId) {
  const row = stmtGetUsageToday.get(userId);
  return row ? row.count : 0;
}

/**
 * Increment today's usage count for a user by 1.
 * @param {string} userId
 */
function incrementUsage(userId) {
  stmtIncrementUsage.run(userId);
}

module.exports = { db, findByGoogleId, findById, findAll, upsertUser, updateProfile, updateSubscription, updateStripeCustomerId, findByStripeCustomerId, getUsageToday, incrementUsage };
