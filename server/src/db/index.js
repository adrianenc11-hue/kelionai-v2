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
  // Stage 3 — M13: Passkey credentials stored as JSON array
  if (!cols.find(c => c.name === 'passkey_credentials')) {
    await db.exec("ALTER TABLE users ADD COLUMN passkey_credentials TEXT DEFAULT '[]'");
  }
  // Stage 3 — passkey registration challenges (short-lived, in-memory would also work
  // but we want them to survive a single dev-server reload)
  if (!cols.find(c => c.name === 'current_webauthn_challenge')) {
    await db.exec("ALTER TABLE users ADD COLUMN current_webauthn_challenge TEXT");
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

  // Stage 3 — M14/M15: Long-term memory store. One row per extracted fact
  // about the user. We keep it simple (no embeddings yet — retrieval dumps
  // the most-recent-N facts into the system prompt, which fits within
  // Gemini Live's budget for typical user memory sizes).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fact',
      fact TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_memory_items_user ON memory_items(user_id, created_at DESC)');

  // Stage 5 — M23: Web Push subscriptions. One row per device/browser; a
  // single user may have several (phone + laptop). endpoint is unique.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth_secret TEXT NOT NULL,
      user_agent TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_sent_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id, enabled)');

  // Stage 5 — M25: log of proactive pings sent so we don't spam & can debug.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      body TEXT,
      reason TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_proactive_log_user ON proactive_log(user_id, created_at DESC)');

  return db;
}

// Stage 3 — memory helpers
async function addMemoryItems(userId, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const inserted = [];
  for (const it of items) {
    if (!it || !it.fact || typeof it.fact !== 'string') continue;
    const fact = it.fact.trim().slice(0, 500);
    if (!fact) continue;
    const kind = (it.kind && typeof it.kind === 'string') ? it.kind.slice(0, 40) : 'fact';
    // De-dupe: skip if identical fact already exists for this user
    const dup = await db.get(
      'SELECT id FROM memory_items WHERE user_id = ? AND fact = ? LIMIT 1',
      [userId, fact]
    );
    if (dup) continue;
    const r = await db.run(
      'INSERT INTO memory_items (user_id, kind, fact) VALUES (?, ?, ?)',
      [userId, kind, fact]
    );
    inserted.push({ id: r.lastID, user_id: userId, kind, fact });
  }
  return inserted;
}

async function listMemoryItems(userId, limit = 100) {
  return db.all(
    'SELECT id, kind, fact, created_at FROM memory_items WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );
}

async function deleteMemoryItem(userId, id) {
  const r = await db.run('DELETE FROM memory_items WHERE id = ? AND user_id = ?', [id, userId]);
  return r.changes > 0;
}

async function clearMemoryForUser(userId) {
  const r = await db.run('DELETE FROM memory_items WHERE user_id = ?', [userId]);
  return r.changes;
}

// Stage 3 — passkey helpers
async function getUserPasskeys(userId) {
  const row = await db.get('SELECT passkey_credentials FROM users WHERE id = ?', [userId]);
  if (!row || !row.passkey_credentials) return [];
  try {
    const arr = JSON.parse(row.passkey_credentials);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function addPasskey(userId, credential) {
  const existing = await getUserPasskeys(userId);
  // De-dupe by credentialID
  const filtered = existing.filter(c => c.credentialID !== credential.credentialID);
  filtered.push(credential);
  await db.run(
    'UPDATE users SET passkey_credentials = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(filtered), userId]
  );
  return filtered;
}

async function updatePasskeyCounter(userId, credentialID, counter) {
  const existing = await getUserPasskeys(userId);
  const updated = existing.map(c =>
    c.credentialID === credentialID ? { ...c, counter } : c
  );
  await db.run(
    'UPDATE users SET passkey_credentials = ? WHERE id = ?',
    [JSON.stringify(updated), userId]
  );
}

async function findUserByCredentialId(credentialID) {
  // SQLite has no JSON search out of the box; scan users.
  // Fine for current scale. Switch to a dedicated credentials table if it grows.
  const rows = await db.all('SELECT id, passkey_credentials FROM users WHERE passkey_credentials IS NOT NULL');
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.passkey_credentials || '[]');
      if (arr.find(c => c.credentialID === credentialID)) {
        return getUserById(r.id);
      }
    } catch { /* ignore */ }
  }
  return null;
}

async function setWebauthnChallenge(userId, challenge) {
  await db.run(
    'UPDATE users SET current_webauthn_challenge = ? WHERE id = ?',
    [challenge, userId]
  );
}

async function consumeWebauthnChallenge(userId) {
  const row = await db.get(
    'SELECT current_webauthn_challenge FROM users WHERE id = ?',
    [userId]
  );
  if (row) {
    await db.run(
      'UPDATE users SET current_webauthn_challenge = NULL WHERE id = ?',
      [userId]
    );
  }
  return row?.current_webauthn_challenge || null;
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
  // Strip WebAuthn / passkey secrets — current_webauthn_challenge is an active
  // registration/authentication challenge whose leak enables replay attacks,
  // and passkey_credentials contains credential IDs + public keys that are
  // considered sensitive metadata. Neither is needed on the client.
  delete clean.passkey_credentials;
  delete clean.current_webauthn_challenge;
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
  // Stage 3 — memory
  addMemoryItems,
  listMemoryItems,
  deleteMemoryItem,
  clearMemoryForUser,
  // Stage 3 — passkey
  getUserPasskeys,
  addPasskey,
  updatePasskeyCounter,
  findUserByCredentialId,
  setWebauthnChallenge,
  consumeWebauthnChallenge,
  // Stage 5 — push + proactive
  upsertPushSubscription,
  listPushSubscriptionsForUser,
  listActivePushSubscriptions,
  deletePushSubscription,
  disablePushSubscriptionByEndpoint,
  markPushSent,
  logProactive,
  recentProactiveForUser,
};

// ─── Stage 5 helpers ────────────────────────────────────────────────
async function upsertPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
  const existing = await db.get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  if (existing) {
    await db.run(
      'UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth_secret = ?, user_agent = ?, enabled = 1 WHERE endpoint = ?',
      [userId, p256dh, auth, userAgent || null, endpoint]
    );
    return existing.id;
  }
  const r = await db.run(
    'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_secret, user_agent) VALUES (?, ?, ?, ?, ?)',
    [userId, endpoint, p256dh, auth, userAgent || null]
  );
  return r.lastID;
}

async function listPushSubscriptionsForUser(userId) {
  return db.all('SELECT id, endpoint, p256dh, auth_secret, enabled, created_at, last_sent_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function listActivePushSubscriptions() {
  return db.all('SELECT id, user_id, endpoint, p256dh, auth_secret FROM push_subscriptions WHERE enabled = 1');
}

async function deletePushSubscription(userId, endpoint) {
  const r = await db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint]);
  return r.changes > 0;
}

async function disablePushSubscriptionByEndpoint(endpoint) {
  await db.run('UPDATE push_subscriptions SET enabled = 0 WHERE endpoint = ?', [endpoint]);
}

async function markPushSent(id) {
  await db.run('UPDATE push_subscriptions SET last_sent_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

async function logProactive({ userId, kind, title, body, reason, delivered }) {
  await db.run(
    'INSERT INTO proactive_log (user_id, kind, title, body, reason, delivered) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, kind, title || null, body || null, reason || null, delivered ? 1 : 0]
  );
}

async function recentProactiveForUser(userId, sinceMs) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  return db.all(
    "SELECT id, kind, title, created_at FROM proactive_log WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC",
    [userId, since]
  );
}
