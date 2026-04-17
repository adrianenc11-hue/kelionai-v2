'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const dbPath = process.env.DB_PATH || './data/kelion.db';
let db;

async function initDb() {
  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Users table with full schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE,
      email TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      subscription_tier TEXT DEFAULT 'free',
      subscription_status TEXT DEFAULT 'active',
      usage_today INTEGER DEFAULT 0,
      usage_reset_date TEXT,
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      stripe_customer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add password_hash column if missing (for existing DBs)
  const cols = await db.all("PRAGMA table_info(users)");
  if (!cols.find(c => c.name === 'password_hash')) {
    await db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }

  // Create index for faster lookups
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)');

  // Referrals table — tracks issued referral codes and their usage
  await db.exec(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      owner_id INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      used_by INTEGER,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (used_by)   REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_referrals_owner ON referrals(owner_id)');

  return db;
}

function getDb() { return db; }

async function getUserByGoogleId(googleId) {
  return await db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);
}

async function getUserById(id) {
  return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

async function getUserByEmail(email) {
  return await db.get('SELECT * FROM users WHERE email = ?', [email]);
}

async function createUser(data) { 
  const result = await db.run(
    'INSERT INTO users (google_id, email, name, picture, referral_code) VALUES (?, ?, ?, ?, ?)',
    [data.google_id, data.email, data.name, data.picture, data.referral_code || generateReferralCode()]
  );
  return { id: result.lastID, ...data };
}

async function updateUser(id, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  await db.run(`UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
  return getUserById(id);
}

async function upsertUser(data) {
  const existing = await getUserByGoogleId(data.google_id);
  if (existing) {
    return await updateUser(existing.id, data);
  }
  return await createUser(data);
}

async function incrementUsage(userId, minutes = 1) {
  const today = new Date().toDateString();
  const user = await getUserById(userId);
  
  if (!user) return null;

  // Reset if new day
  if (user.usage_reset_date !== today) {
    await db.run('UPDATE users SET usage_today = ?, usage_reset_date = ? WHERE id = ?', [minutes, today, userId]);
    return { ...user, usage_today: minutes, usage_reset_date: today };
  }

  // Increment
  await db.run('UPDATE users SET usage_today = usage_today + ? WHERE id = ?', [minutes, userId]);
  return getUserById(userId);
}

/**
 * Atomic check-and-increment of daily usage.
 * Returns true if increment succeeded (within limit), false if limit would be exceeded.
 * Prevents race conditions on concurrent requests.
 *
 * @param {number} userId
 * @param {number|null} dailyLimit - null or undefined means unlimited
 * @param {number} minutes - amount to increment (default 1)
 * @returns {Promise<boolean>}
 */
async function tryIncrementUsage(userId, dailyLimit, minutes = 1) {
  const today = new Date().toDateString();

  // Unlimited plan — just reset-or-increment atomically
  if (dailyLimit == null) {
    const sql = `UPDATE users
                 SET usage_today = CASE WHEN usage_reset_date = ? THEN usage_today + ? ELSE ? END,
                     usage_reset_date = ?
                 WHERE id = ?`;
    const res = await db.run(sql, [today, minutes, minutes, today, userId]);
    return (res && (res.changes ?? res.rowCount ?? 0)) > 0;
  }

  // Limited plan — conditional atomic update.
  // Allowed when: new day (reset) OR current + minutes <= limit
  const sql = `UPDATE users
               SET usage_today = CASE WHEN usage_reset_date = ? THEN usage_today + ? ELSE ? END,
                   usage_reset_date = ?
               WHERE id = ?
                 AND (usage_reset_date != ? OR usage_today + ? <= ?)`;
  const res = await db.run(sql, [today, minutes, minutes, today, userId, today, minutes, dailyLimit]);
  return (res && (res.changes ?? res.rowCount ?? 0)) > 0;
}

async function getAllUsers() {
  return await db.all('SELECT * FROM users ORDER BY created_at DESC');
}

async function deleteUser(id) {
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

async function insertUser({ email, password_hash, name, role = 'user' }) {
  const existing = await getUserByEmail(email);
  if (existing) return null;

  const result = await db.run(
    'INSERT INTO users (email, password_hash, name, role, referral_code) VALUES (?, ?, ?, ?, ?)',
    [email, password_hash, name, role, generateReferralCode()]
  );

  return await getUserById(result.lastID);
}

async function findByEmail(email) {
  return getUserByEmail(email);
}

async function findById(id) {
  return getUserById(id);
}

async function findByGoogleId(googleId) {
  return getUserByGoogleId(googleId);
}

async function findAll() {
  return getAllUsers();
}

async function updateProfile(id, { name }) {
  return updateUser(id, { name });
}

async function updateRole(id, role) {
  return updateUser(id, { role });
}

async function updateSubscription(id, data) {
  return updateUser(id, data);
}

async function updateStripeCustomerId(id, stripeCustomerId) {
  return updateUser(id, { stripe_customer_id: stripeCustomerId });
}

async function findByStripeCustomerId(cid) {
  return db.get('SELECT * FROM users WHERE stripe_customer_id = ?', [cid]);
}

async function getUsageToday(userId) {
  const user = await getUserById(userId);
  if (!user) return 0;
  const today = new Date().toDateString();
  if (user.usage_reset_date !== today) return 0;
  return user.usage_today || 0;
}

async function createReferralCode(ownerId) {
  const expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
  // Retry on the rare UNIQUE collision
  for (let i = 0; i < 5; i++) {
    const code = generateShortCode();
    try {
      const result = await db.run(
        'INSERT INTO referrals (code, owner_id, expires_at) VALUES (?, ?, ?)',
        [code, ownerId, expires_at]
      );
      return { id: result.lastID, code, owner_id: ownerId, used: 0, used_by: null, expires_at };
    } catch (err) {
      if (!/UNIQUE/i.test(err.message || '')) throw err;
    }
  }
  throw new Error('Failed to generate unique referral code');
}

async function findReferralCode(code) {
  if (!code) return null;
  const row = await db.get('SELECT * FROM referrals WHERE code = ?', [code]);
  return row || null;
}

async function useReferralCode(code, userId) {
  const ref = await findReferralCode(code);
  if (!ref) throw new Error('Referral code not found');
  if (ref.used) throw new Error('Referral code already used');
  if (ref.owner_id === userId) throw new Error('Cannot use your own referral code');
  if (ref.expires_at && new Date(ref.expires_at).getTime() < Date.now()) {
    throw new Error('Referral code expired');
  }
  await db.run(
    'UPDATE referrals SET used = 1, used_by = ? WHERE code = ?',
    [userId, code]
  );
  // Track on user profile as well
  await db.run('UPDATE users SET referred_by = ? WHERE id = ?', [code, userId]);
  return { ...ref, used: 1, used_by: userId };
}

function sanitizeUser(user) {
  if (!user) return user;
  const clean = { ...user };
  delete clean.password_hash;
  return clean;
}

function generateReferralCode() {
  return 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Short 8-char alphanumeric code used for referral transactions
function generateShortCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

module.exports = {
  initDb,
  getDb,
  getUserByGoogleId,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  upsertUser,
  incrementUsage,
  tryIncrementUsage,
  getAllUsers,
  deleteUser,
  insertUser,
  findByEmail,
  findById,
  findByGoogleId,
  findAll,
  updateProfile,
  updateRole,
  updateSubscription,
  updateStripeCustomerId,
  findByStripeCustomerId,
  getUsageToday,
  createReferralCode,
  findReferralCode,
  useReferralCode,
  sanitizeUser,
};
