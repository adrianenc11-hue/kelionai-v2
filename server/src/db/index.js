'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { createPgAdapter } = require('./pg-adapter');
const POSTGRES_DDL = require('./postgres-schema');

// When DATABASE_URL is set we route every query through a Postgres
// (Supabase) connection pool instead of the local SQLite file. The
// adapter exposes the same `.run / .get / .all / .exec` surface so the
// rest of this module (and every caller) keeps working untouched.
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_POSTGRES = !!DATABASE_URL;

const dbPath = process.env.DB_PATH || './data/kelion.db';
let db;

// One-shot boot log so we can tell at a glance whether the SQLite file is
// being created on an ephemeral layer (bad — everything wipes on redeploy)
// or on a persistent volume (good — credits + memories survive restarts).
// We also one-time migrate from the legacy /data/kelion.db location used
// by older Dockerfile builds so nothing is lost on the first deploy after
// this change.
function logAndMigrateDbLocation() {
  try {
    const absPath = path.resolve(dbPath);
    const dir = path.dirname(absPath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const legacyPath = '/data/kelion.db';
    const targetExists = fs.existsSync(absPath);
    const legacyExists = fs.existsSync(legacyPath);
    if (!targetExists && legacyExists && legacyPath !== absPath) {
      try {
        fs.copyFileSync(legacyPath, absPath);
        console.log(`[db] migrated legacy SQLite ${legacyPath} -> ${absPath}`);
      } catch (err) {
        console.warn(`[db] legacy migration failed (continuing fresh):`, err && err.message);
      }
    }
    console.log(`[db] using SQLite at ${absPath} (exists=${fs.existsSync(absPath)})`);
  } catch (err) {
    console.warn('[db] startup location check failed:', err && err.message);
  }
}

async function initDb() {
  if (USE_POSTGRES) {
    console.log('[db] using Postgres via DATABASE_URL (Supabase)');
    db = createPgAdapter(DATABASE_URL);
    // Apply idempotent schema. Safe to call on every boot.
    await db.exec(POSTGRES_DDL);
    return db;
  }

  logAndMigrateDbLocation();

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
  // F8 — preferred language (BCP-47 short, e.g. 'ro', 'en', 'fr'). Captured
  // from the browser's Accept-Language on first login and kept in sync via
  // /api/me/language so Kelion greets the user in their native tongue on
  // every new session instead of forcing the default-English opener each
  // time. We also mirror it as a `locale` memory_item so chat.js picks it
  // up through the existing `listMemoryItems` injection — that keeps
  // chat.js at zero lines modified while still making the model see it.
  if (!cols.find(c => c.name === 'preferred_language')) {
    await db.exec('ALTER TABLE users ADD COLUMN preferred_language TEXT');
  }

  // Voice clone — opt-in ElevenLabs Instant Voice Cloning. The user
  // records ~60s in the browser, explicitly consents, and we upload the
  // sample to ElevenLabs which returns a voice_id. That id is stored
  // here and used by /api/tts instead of the default library voice when
  // `cloned_voice_enabled = 1`. Consent is timestamped so we can prove
  // it during GDPR / BIPA audits; `cloned_voice_consent_version` pins
  // the exact ToS/privacy text the user agreed to (bumped every time
  // the copy changes). Deleting the clone NULLs the first three
  // columns but keeps `voice_clone_events` audit rows intact.
  if (!cols.find(c => c.name === 'cloned_voice_id')) {
    await db.exec('ALTER TABLE users ADD COLUMN cloned_voice_id TEXT');
  }
  if (!cols.find(c => c.name === 'cloned_voice_consent_at')) {
    await db.exec('ALTER TABLE users ADD COLUMN cloned_voice_consent_at DATETIME');
  }
  if (!cols.find(c => c.name === 'cloned_voice_consent_version')) {
    await db.exec('ALTER TABLE users ADD COLUMN cloned_voice_consent_version TEXT');
  }
  if (!cols.find(c => c.name === 'cloned_voice_enabled')) {
    await db.exec('ALTER TABLE users ADD COLUMN cloned_voice_enabled INTEGER NOT NULL DEFAULT 0');
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

  // Stage 7 — Monetization: per-user Kelion-Live credit balance measured in
  // whole minutes (1 credit = 1 min of voice + tools). User tops up via
  // Stripe Checkout; each completed session consumes credits based on its
  // duration. We store the running balance directly on users (cheap read
  // in the voice loop) and an immutable ledger for audit / admin dashboard.
  if (!cols.find(c => c.name === 'credits_balance_minutes')) {
    await db.exec('ALTER TABLE users ADD COLUMN credits_balance_minutes INTEGER NOT NULL DEFAULT 0');
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta_minutes INTEGER NOT NULL,           -- + for top-up, - for consumption
      amount_cents INTEGER,                     -- Minor units (e.g. GBP pence) charged by Stripe (null for consumption)
      currency TEXT DEFAULT 'gbp',
      kind TEXT NOT NULL,                       -- 'topup' | 'consume' | 'bonus' | 'refund'
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC)');
  // Guard against double-fulfillment when Stripe retries webhooks.
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_session ON credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL');

  // Visitor analytics — Adrian 2026-04-20: "nu vad buton vizite reale cine a
  // vizitat situl, ip tara restul datelor lor". One row per SPA page load
  // (not per API call — we explicitly do NOT log API hits). Country comes
  // from the CDN header (`cf-ipcountry`, `x-vercel-ip-country`, etc) if
  // available; we never do external IP→country lookups on the hot path.
  // IP is stored for admin audit — admin dashboard only, never exposed to
  // end users. Old rows are pruned opportunistically in `listRecentVisitors`.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      path TEXT,
      ip TEXT,
      country TEXT,
      user_agent TEXT,
      referer TEXT,
      user_id INTEGER,
      user_email TEXT
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_visitor_events_ts ON visitor_events(ts DESC)');

  // Conversation history — persists the text chat transcript so a
  // signed-in user can return later and pick up where they left off.
  // One row per thread in `conversations`, one row per turn in
  // `conversation_messages`. Guests get localStorage-only persistence
  // (handled on the client in src/lib/conversationStore.js).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC)');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conversation_messages(conversation_id, id)');

  // Voice clone audit log. One row per create / delete / enable / disable
  // / synthesize event so we can prove when the user consented, prove the
  // voice was deleted on request, and triage any claim of unauthorised
  // use. Never pruned automatically — admins can archive manually.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS voice_clone_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      voice_id TEXT,
      consent_version TEXT,
      ip TEXT,
      user_agent TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_voice_clone_events_user ON voice_clone_events(user_id, created_at DESC)');

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

// ─── Voice clone helpers ──────────────────────────────────────────
// Thin wrappers around the `users` voice-clone columns plus the
// `voice_clone_events` audit log. The ElevenLabs call itself lives in
// `services/voiceClone.js` — this file only owns the DB side.

async function setClonedVoice(userId, voiceId, consentVersion) {
  if (!userId || !voiceId) return null;
  await db.run(
    `UPDATE users
       SET cloned_voice_id = ?,
           cloned_voice_consent_at = CURRENT_TIMESTAMP,
           cloned_voice_consent_version = ?,
           cloned_voice_enabled = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    [voiceId, consentVersion || null, userId]
  );
  return getClonedVoice(userId);
}

async function clearClonedVoice(userId) {
  if (!userId) return null;
  await db.run(
    `UPDATE users
       SET cloned_voice_id = NULL,
           cloned_voice_consent_at = NULL,
           cloned_voice_consent_version = NULL,
           cloned_voice_enabled = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    [userId]
  );
  return true;
}

async function setClonedVoiceEnabled(userId, enabled) {
  if (!userId) return null;
  await db.run(
    `UPDATE users SET cloned_voice_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [enabled ? 1 : 0, userId]
  );
  return getClonedVoice(userId);
}

async function getClonedVoice(userId) {
  if (!userId) return null;
  const row = await db.get(
    `SELECT cloned_voice_id           AS voiceId,
            cloned_voice_consent_at   AS consentAt,
            cloned_voice_consent_version AS consentVersion,
            cloned_voice_enabled      AS enabled
       FROM users WHERE id = ?`,
    [userId]
  );
  if (!row) return null;
  return {
    voiceId: row.voiceId || null,
    consentAt: row.consentAt || null,
    consentVersion: row.consentVersion || null,
    enabled: Boolean(row.enabled) && Boolean(row.voiceId),
  };
}

async function logVoiceCloneEvent({ userId, action, voiceId, consentVersion, ip, userAgent, note }) {
  if (!userId || !action) return null;
  const r = await db.run(
    `INSERT INTO voice_clone_events
       (user_id, action, voice_id, consent_version, ip, user_agent, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      String(action).slice(0, 40),
      voiceId || null,
      consentVersion || null,
      ip ? String(ip).slice(0, 64) : null,
      userAgent ? String(userAgent).slice(0, 400) : null,
      note ? String(note).slice(0, 500) : null,
    ]
  );
  return { id: r.lastID };
}

async function listVoiceCloneEvents(userId, limit = 50) {
  if (!userId) return [];
  return db.all(
    `SELECT id, action, voice_id, consent_version, ip, user_agent, note, created_at
       FROM voice_clone_events WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
}

// F8 — preferred language helpers.
//
// `setPreferredLanguage` persists the short BCP-47 primary tag on the
// users row AND mirrors it as a `locale` memory_item. The memory row is
// what chat.js / realtime.js already inject into the persona via
// `listMemoryItems`, so every provider (text + OpenAI Realtime + Gemini
// Live) sees the fact without chat.js being touched.
//
// Older `locale` rows for the same user are pruned first so the persona
// never receives contradictory "Preferred language: English" +
// "Preferred language: Romanian" lines after the user changes it.
async function setPreferredLanguage(userId, shortTag, factText) {
  if (!userId || !shortTag) return null;
  await db.run(
    'UPDATE users SET preferred_language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [shortTag, userId]
  );
  if (factText && typeof factText === 'string') {
    await db.run('DELETE FROM memory_items WHERE user_id = ? AND kind = ?', [userId, 'locale']);
    await db.run(
      'INSERT INTO memory_items (user_id, kind, fact) VALUES (?, ?, ?)',
      [userId, 'locale', factText.slice(0, 500)]
    );
  }
  return getUserById(userId);
}

async function getPreferredLanguage(userId) {
  if (!userId) return null;
  const row = await db.get('SELECT preferred_language FROM users WHERE id = ?', [userId]);
  return (row && row.preferred_language) || null;
}

// ─── Conversation history helpers ────────────────────────────────
// Signed-in users get server-side persistence of the chat transcript.
// Guests fall back to client localStorage (see src/lib/conversationStore.js).
// Titles default to a short slice of the first user message so the
// history list is scannable without forcing the LLM to title each thread.

const MAX_CONV_TITLE   = 120;
const MAX_MSG_CONTENT  = 16_000; // generous — fits long pasted code/URLs
const MAX_CONV_PER_USR = 500;    // guardrail; pruned opportunistically
const MAX_MSGS_PER_CONV = 4_000; // huge threads get trimmed on read

async function createConversation(userId, title) {
  const clean = (typeof title === 'string' ? title.trim() : '').slice(0, MAX_CONV_TITLE) || null;
  const r = await db.run(
    'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
    [userId, clean]
  );
  return {
    id: r.lastID,
    user_id: userId,
    title: clean,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function assertConversationOwner(userId, conversationId) {
  const row = await db.get(
    'SELECT id, user_id FROM conversations WHERE id = ?',
    [conversationId]
  );
  if (!row) return null;
  if (String(row.user_id) !== String(userId)) return null;
  return row;
}

async function appendConversationMessage(userId, conversationId, role, content) {
  const own = await assertConversationOwner(userId, conversationId);
  if (!own) return null;
  const cleanRole    = String(role || '').slice(0, 20) || 'user';
  const cleanContent = String(content || '').slice(0, MAX_MSG_CONTENT);
  if (!cleanContent) return null;
  const r = await db.run(
    'INSERT INTO conversation_messages (conversation_id, role, content) VALUES (?, ?, ?)',
    [conversationId, cleanRole, cleanContent]
  );
  await db.run(
    'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [conversationId]
  );
  return {
    id: r.lastID,
    conversation_id: conversationId,
    role: cleanRole,
    content: cleanContent,
    created_at: new Date().toISOString(),
  };
}

async function listConversations(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(MAX_CONV_PER_USR, Number(limit) || 50));
  return db.all(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.user_id = ?
     ORDER BY c.updated_at DESC
     LIMIT ?`,
    [userId, safeLimit]
  );
}

async function getConversationWithMessages(userId, conversationId) {
  const own = await assertConversationOwner(userId, conversationId);
  if (!own) return null;
  const meta = await db.get(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?',
    [conversationId]
  );
  const messages = await db.all(
    `SELECT id, role, content, created_at
     FROM conversation_messages
     WHERE conversation_id = ?
     ORDER BY id ASC
     LIMIT ?`,
    [conversationId, MAX_MSGS_PER_CONV]
  );
  return { ...meta, messages };
}

async function updateConversationTitle(userId, conversationId, title) {
  const own = await assertConversationOwner(userId, conversationId);
  if (!own) return false;
  const clean = (typeof title === 'string' ? title.trim() : '').slice(0, MAX_CONV_TITLE) || null;
  const r = await db.run(
    'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [clean, conversationId]
  );
  return r.changes > 0;
}

async function deleteConversation(userId, conversationId) {
  const own = await assertConversationOwner(userId, conversationId);
  if (!own) return false;
  const r = await db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
  return r.changes > 0;
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

// ─── Visitor analytics helpers ─────────────────────────────────────
// Adrian 2026-04-20: "nu vad buton vizite reale cine a vizitat situl,
// ip tara restul datelor lor". One row per SPA page load, admin-only.
async function recordVisitorEvent({
  path: pPath = null,
  ip = null,
  country = null,
  userAgent = null,
  referer = null,
  userId = null,
  userEmail = null,
} = {}) {
  try {
    await db.run(
      `INSERT INTO visitor_events (path, ip, country, user_agent, referer, user_id, user_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [pPath, ip, country, userAgent, referer, userId, userEmail]
    );
  } catch (err) {
    // Never let analytics failures break a page load.
    console.warn('[db] recordVisitorEvent failed:', err && err.message);
  }
}

async function listRecentVisitors(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  try {
    return await db.all(
      `SELECT id, ts, path, ip, country, user_agent, referer, user_id, user_email
       FROM visitor_events
       ORDER BY ts DESC
       LIMIT ?`,
      [safeLimit]
    );
  } catch (err) {
    console.warn('[db] listRecentVisitors failed:', err && err.message);
    return [];
  }
}

async function getVisitorStats({ windowHours = 24 } = {}) {
  // Lightweight aggregate for the admin dashboard header. Safe to call
  // on every refresh — all operations are indexed on `ts`.
  const safeHours = Math.min(24 * 30, Math.max(1, Number(windowHours) || 24));
  try {
    const since = new Date(Date.now() - safeHours * 3600 * 1000).toISOString();
    const [totalRow, uniqueRow, topCountries] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM visitor_events WHERE ts >= ?', [since]),
      db.get('SELECT COUNT(DISTINCT ip) AS n FROM visitor_events WHERE ts >= ? AND ip IS NOT NULL', [since]),
      db.all(
        `SELECT country, COUNT(*) AS n
         FROM visitor_events
         WHERE ts >= ? AND country IS NOT NULL AND country <> ''
         GROUP BY country
         ORDER BY n DESC
         LIMIT 5`,
        [since]
      ),
    ]);
    return {
      windowHours: safeHours,
      totalVisits: Number((totalRow && totalRow.n) || 0),
      uniqueIps: Number((uniqueRow && uniqueRow.n) || 0),
      topCountries: Array.isArray(topCountries) ? topCountries : [],
    };
  } catch (err) {
    console.warn('[db] getVisitorStats failed:', err && err.message);
    return { windowHours: safeHours, totalVisits: 0, uniqueIps: 0, topCountries: [] };
  }
}

// ─── User de-duplication helpers ──────────────────────────────────
// Adrian 2026-04-22: audit found adrianenc11@gmail.com sitting as two
// separate rows (id=5 from a Google sign-in, id=6 from a later local
// sign-up with the same email). The admin panel needs a way to list
// those and merge them into a single canonical user so credits and
// conversation history don't stay split.
async function findDuplicateUsers() {
  // Lower-cased email match is the right key — GSI / passwords / etc.
  // each create a row, but a human only owns one address. SQLite and
  // Postgres both understand LOWER().
  try {
    const rows = await db.all(
      `SELECT LOWER(email) AS email_key, COUNT(*) AS n
       FROM users
       WHERE email IS NOT NULL AND email <> ''
       GROUP BY LOWER(email)
       HAVING COUNT(*) > 1
       ORDER BY n DESC`
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const groups = [];
    for (const r of rows) {
      const peers = await db.all(
        'SELECT * FROM users WHERE LOWER(email) = ? ORDER BY created_at ASC, id ASC',
        [r.email_key]
      );
      groups.push({
        email: r.email_key,
        count: Number(r.n) || peers.length,
        users: peers.map(sanitizeUser),
      });
    }
    return groups;
  } catch (err) {
    console.warn('[db] findDuplicateUsers failed:', err && err.message);
    return [];
  }
}

// Move every FK'd row from sourceId to targetId, then remove the
// source user row. Runs inside a single SQLite transaction so a
// partial failure rolls everything back. Returns a structured
// summary of how many rows moved per table so the admin UI can
// show the result without a second round-trip.
async function mergeUsers(sourceId, targetId) {
  if (!sourceId || !targetId) throw new Error('sourceId and targetId are required');
  if (String(sourceId) === String(targetId)) throw new Error('source and target must differ');
  const src = await getUserById(sourceId);
  const tgt = await getUserById(targetId);
  if (!src) throw new Error(`source user ${sourceId} not found`);
  if (!tgt) throw new Error(`target user ${targetId} not found`);
  // Guard — only allow merging rows that belong to the same human.
  // Checking the lowercased email here means Google-linked + local
  // signup rows can still collapse, but two completely different
  // emails cannot be force-merged through this path.
  if (String(src.email || '').toLowerCase() !== String(tgt.email || '').toLowerCase()) {
    throw new Error('refusing to merge users with different email addresses');
  }
  const counts = {};
  // Tables that carry `user_id` FK → plain UPDATE move.
  const userIdTables = [
    'memory_items',
    'push_subscriptions',
    'proactive_log',
    'credit_transactions',
    'conversations',
    'visitor_events',
    // Biometric-consent audit rows — merging must preserve the trail
    // (ON DELETE CASCADE would otherwise wipe them when the source row
    // is removed at the end of this transaction).
    'voice_clone_events',
  ];
  // Referral rows carry two FK columns (`owner_id`, `used_by`) — move
  // both independently. `used_by` can be null (unredeemed code) so
  // the update is safe on both columns.
  await db.exec('BEGIN');
  try {
    for (const t of userIdTables) {
      const r = await db.run(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`, [targetId, sourceId]);
      counts[t] = Number((r && (r.changes || r.rowCount)) || 0);
    }
    const refOwner = await db.run(
      'UPDATE referrals SET owner_id = ? WHERE owner_id = ?',
      [targetId, sourceId]
    );
    const refUsed = await db.run(
      'UPDATE referrals SET used_by = ? WHERE used_by = ?',
      [targetId, sourceId]
    );
    counts.referrals_owner = Number((refOwner && (refOwner.changes || refOwner.rowCount)) || 0);
    counts.referrals_used_by = Number((refUsed && (refUsed.changes || refUsed.rowCount)) || 0);
    // Merge the users row itself: keep the target, but copy over
    // whichever useful fields only the source had. This matters when
    // the source row is the Google-linked one and the target is a
    // later local signup (or vice versa) — we don't want to lose
    // `google_id` or `stripe_customer_id` just because the target
    // was created without them.
    const fillIfEmpty = {};
    if (!tgt.google_id && src.google_id) fillIfEmpty.google_id = src.google_id;
    if (!tgt.picture && src.picture) fillIfEmpty.picture = src.picture;
    if (!tgt.stripe_customer_id && src.stripe_customer_id) {
      fillIfEmpty.stripe_customer_id = src.stripe_customer_id;
    }
    if (!tgt.password_hash && src.password_hash) {
      fillIfEmpty.password_hash = src.password_hash;
    }
    if (!tgt.referral_code && src.referral_code) {
      fillIfEmpty.referral_code = src.referral_code;
    }
    // Voice-clone state: if the target has no clone but the source
    // does, carry it (plus consent metadata + enabled flag) so we
    // don't orphan the voice_id on the ElevenLabs side after merge.
    if (!tgt.cloned_voice_id && src.cloned_voice_id) {
      fillIfEmpty.cloned_voice_id = src.cloned_voice_id;
      if (src.cloned_voice_consent_at) {
        fillIfEmpty.cloned_voice_consent_at = src.cloned_voice_consent_at;
      }
      if (src.cloned_voice_consent_version) {
        fillIfEmpty.cloned_voice_consent_version = src.cloned_voice_consent_version;
      }
      fillIfEmpty.cloned_voice_enabled = Number(src.cloned_voice_enabled || 0);
    }
    // credits_balance_minutes lives on users: sum instead of picking.
    const srcBalance = Number(src.credits_balance_minutes || 0);
    if (srcBalance > 0) {
      const tgtBalance = Number(tgt.credits_balance_minutes || 0);
      fillIfEmpty.credits_balance_minutes = tgtBalance + srcBalance;
    }
    if (Object.keys(fillIfEmpty).length > 0) {
      const fields = Object.keys(fillIfEmpty).map(k => `${k} = ?`).join(', ');
      const values = Object.values(fillIfEmpty);
      await db.run(
        `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...values, targetId]
      );
    }
    // Finally drop the source user. `conversation_messages` does not
    // have a direct `user_id` column — it cascades via
    // `conversation_id → conversations.user_id` which we've already
    // repointed — so the DELETE below only removes the row itself.
    const del = await db.run('DELETE FROM users WHERE id = ?', [sourceId]);
    counts.users_deleted = Number((del && (del.changes || del.rowCount)) || 0);
    await db.exec('COMMIT');
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
  return {
    sourceId,
    targetId,
    email: tgt.email,
    moved: counts,
    target: sanitizeUser(await getUserById(targetId)),
  };
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
  // F3 — admin user de-duplication
  findDuplicateUsers,
  mergeUsers,
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
  // F8 — preferred language
  setPreferredLanguage,
  getPreferredLanguage,
  // Voice clone
  setClonedVoice,
  clearClonedVoice,
  setClonedVoiceEnabled,
  getClonedVoice,
  logVoiceCloneEvent,
  listVoiceCloneEvents,
  // Conversation history
  createConversation,
  appendConversationMessage,
  listConversations,
  getConversationWithMessages,
  updateConversationTitle,
  deleteConversation,
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
  // Stage 7 — credits / monetization
  getCreditsBalance,
  addCreditsTransaction,
  listCreditTransactions,
  listRecentCreditTransactions,
  getCreditRevenueSummary,
  // Visitor analytics
  recordVisitorEvent,
  listRecentVisitors,
  getVisitorStats,
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

// ─── Stage 7 — Monetization (credits) ────────────────────────────
async function getCreditsBalance(userId) {
  const row = await db.get('SELECT credits_balance_minutes FROM users WHERE id = ?', [userId]);
  return row ? Number(row.credits_balance_minutes || 0) : 0;
}

// In-process serializer for credit transactions. sqlite3's driver
// serializes individual statements but NOT multi-statement transactions,
// so two concurrent BEGIN IMMEDIATE calls can interleave. Devin Review
// flagged this at commit 39043d96. We guard the whole transaction body
// with a tiny promise chain so callers queue behind each other.
let creditsTxnQueue = Promise.resolve();
function serializeCreditsTxn(fn) {
  const next = creditsTxnQueue.then(() => fn());
  // Keep the chain alive even if fn throws — otherwise a rejection would
  // break every subsequent call.
  creditsTxnQueue = next.catch(() => {});
  return next;
}

/**
 * Atomically add `deltaMinutes` to a user's balance and write a ledger
 * row. Use a positive `deltaMinutes` for top-ups / bonuses and a
 * negative one for consumption. Returns the new balance.
 *
 * Stripe guarantees webhook at-least-once delivery, so top-up callers
 * should pass a unique `stripe_session_id` — the UNIQUE index on that
 * column rejects duplicates and we treat the collision as "already
 * fulfilled" and no-op.
 */
function addCreditsTransaction({
  userId,
  deltaMinutes,
  amountCents = null,
  currency = 'gbp',
  kind,
  stripeSessionId = null,
  stripePaymentIntent = null,
  note = null,
}) {
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
    return Promise.reject(new Error('deltaMinutes must be a non-zero number'));
  }
  if (!kind || typeof kind !== 'string') {
    return Promise.reject(new Error('kind is required'));
  }
  return serializeCreditsTxn(async () => {
    // Postgres path: must use a single pooled client for the transaction,
    // otherwise each query lands on a different connection and BEGIN /
    // COMMIT don't apply.
    if (db && db._isPg) {
      const c = await db.connect();
      try {
        await c.exec('BEGIN');
        const row = await c.get('SELECT credits_balance_minutes FROM users WHERE id = ?', [userId]);
        if (!row) { await c.exec('ROLLBACK'); throw new Error('user not found'); }
        const current = Number(row.credits_balance_minutes || 0);
        const next = current + deltaMinutes;
        if (next < 0) { await c.exec('ROLLBACK'); throw new Error('insufficient credits'); }
        await c.run('UPDATE users SET credits_balance_minutes = ? WHERE id = ?', [next, userId]);
        await c.run(
          `INSERT INTO credit_transactions
           (user_id, delta_minutes, amount_cents, currency, kind, stripe_session_id, stripe_payment_intent, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, deltaMinutes, amountCents, currency, kind, stripeSessionId, stripePaymentIntent, note],
        );
        await c.exec('COMMIT');
        return { balance: next, previous: current, deltaMinutes };
      } catch (err) {
        try { await c.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        if (/UNIQUE/i.test(err && err.message) && stripeSessionId) {
          const balance = await getCreditsBalance(userId);
          return { balance, previous: balance, deltaMinutes: 0, duplicate: true };
        }
        throw err;
      } finally {
        try { c.release(); } catch (_) { /* ignore */ }
      }
    }

    // SQLite path (original behaviour).
    try {
      await db.run('BEGIN IMMEDIATE');
      const row = await db.get('SELECT credits_balance_minutes FROM users WHERE id = ?', [userId]);
      if (!row) {
        await db.run('ROLLBACK');
        throw new Error('user not found');
      }
      const current = Number(row.credits_balance_minutes || 0);
      const next = current + deltaMinutes;
      if (next < 0) {
        // Refuse to go negative; caller should check balance first.
        await db.run('ROLLBACK');
        throw new Error('insufficient credits');
      }
      await db.run('UPDATE users SET credits_balance_minutes = ? WHERE id = ?', [next, userId]);
      await db.run(
        `INSERT INTO credit_transactions
         (user_id, delta_minutes, amount_cents, currency, kind, stripe_session_id, stripe_payment_intent, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, deltaMinutes, amountCents, currency, kind, stripeSessionId, stripePaymentIntent, note],
      );
      await db.run('COMMIT');
      return { balance: next, previous: current, deltaMinutes };
    } catch (err) {
      try { await db.run('ROLLBACK'); } catch (_) { /* ignore */ }
      // UNIQUE stripe_session_id → duplicate webhook delivery. Treat as idempotent.
      if (/UNIQUE/i.test(err && err.message) && stripeSessionId) {
        const balance = await getCreditsBalance(userId);
        return { balance, previous: balance, deltaMinutes: 0, duplicate: true };
      }
      throw err;
    }
  });
}

async function listCreditTransactions(userId, limit = 50) {
  return db.all(
    `SELECT id, delta_minutes, amount_cents, currency, kind, stripe_session_id, note, created_at
     FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

/**
 * Admin-only — list the most recent N credit transactions across ALL
 * users. Joins on `users` to surface the human-readable email/name so
 * the admin "Live Usage" panel can render a single flat feed without
 * N+1 lookups. Supports filtering by `kind` (e.g. 'consumption',
 * 'topup', 'admin_grant') so the refund UI can show only the grants
 * Adrian issued, and the abuse monitor can show only consumption.
 *
 * Used by /api/admin/credits/ledger.
 */
async function listRecentCreditTransactions({ limit = 50, kind = null, sinceMs = null } = {}) {
  const cappedLimit = Math.min(500, Math.max(1, Number(limit) || 50));
  const params = [];
  const where = [];
  if (kind) {
    where.push('t.kind = ?');
    params.push(kind);
  }
  if (sinceMs) {
    where.push('t.created_at > ?');
    params.push(new Date(Number(sinceMs)).toISOString());
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT t.id, t.user_id, t.delta_minutes, t.amount_cents, t.currency,
           t.kind, t.stripe_session_id, t.note, t.created_at,
           u.email AS user_email, u.name AS user_name,
           u.credits_balance_minutes AS user_balance
      FROM credit_transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT ?`;
  params.push(cappedLimit);
  return db.all(sql, params);
}

/**
 * Admin-only — aggregate revenue + minutes sold in the last `sinceDays`.
 * Used by the business dashboard.
 */
async function getCreditRevenueSummary(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const row = await db.get(
    `SELECT
       COUNT(CASE WHEN kind = 'topup' THEN 1 END) AS topups,
       COALESCE(SUM(CASE WHEN delta_minutes > 0 THEN delta_minutes ELSE 0 END), 0) AS minutes_sold,
       COALESCE(SUM(CASE WHEN kind = 'topup' AND amount_cents IS NOT NULL THEN amount_cents ELSE 0 END), 0) AS revenue_cents,
       COALESCE(SUM(CASE WHEN delta_minutes < 0 THEN -delta_minutes ELSE 0 END), 0) AS minutes_consumed
     FROM credit_transactions
     WHERE created_at > ? AND kind IN ('topup', 'consume')`,
    [since],
  );
  return {
    sinceDays,
    topups: Number(row?.topups || 0),
    minutesSold: Number(row?.minutes_sold || 0),
    minutesConsumed: Number(row?.minutes_consumed || 0),
    revenueCents: Number(row?.revenue_cents || 0),
  };
}
