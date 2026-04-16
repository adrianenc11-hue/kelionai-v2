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
  const code = generateReferralCode();
  return { code, owner_id: ownerId, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
}

async function findReferralCode(code) {
  return null; // Simplified — needs referral table
}

async function useReferralCode(code, userId) {
  // Simplified — needs referral table
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
