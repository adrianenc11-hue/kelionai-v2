import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const dbPath = process.env.DB_PATH || './data/kelion.db';
let db;

export async function initDb() {
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

  // Create index for faster lookups
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)');

  return db;
}

export function getDb() { return db; }

export async function getUserByGoogleId(googleId) {
  return await db.get('SELECT * FROM users WHERE google_id = ?', [googleId]);
}

export async function getUserById(id) {
  return await db.get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function getUserByEmail(email) {
  return await db.get('SELECT * FROM users WHERE email = ?', [email]);
}

export async function createUser(data) { 
  const result = await db.run(
    'INSERT INTO users (google_id, email, name, picture, referral_code) VALUES (?, ?, ?, ?, ?)',
    [data.google_id, data.email, data.name, data.picture, data.referral_code || generateReferralCode()]
  );
  return { id: result.lastID, ...data };
}

export async function updateUser(id, data) {
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  await db.run(`UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id]);
  return getUserById(id);
}

export async function upsertUser(data) {
  const existing = await getUserByGoogleId(data.google_id);
  if (existing) {
    return await updateUser(existing.id, data);
  }
  return await createUser(data);
}

export async function incrementUsage(userId, minutes = 1) {
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

export async function getAllUsers() {
  return await db.all('SELECT * FROM users ORDER BY created_at DESC');
}

export async function deleteUser(id) {
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

function generateReferralCode() {
  return 'REF' + Math.random().toString(36).substring(2, 8).toUpperCase();
}
