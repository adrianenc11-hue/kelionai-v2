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
  //
  // Audit M8 (tier / last_affirmed_at / archived_at) — the consolidator
  // in services/memoryConsolidator.js reads these columns to detect
  // duplicates, contradictions, and stale notes, then flips the tier
  // or archives rows in place. See that file for the full rationale.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fact',
      fact TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'recent',
      last_affirmed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME,
      archived_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // Idempotent migrations for existing rows. On Postgres these are
  // handled inside postgres-schema.js with `ADD COLUMN IF NOT EXISTS`;
  // here we read PRAGMA table_info because the SQLite dialect does
  // not support the IF NOT EXISTS suffix on ALTER TABLE.
  const memCols = await db.all('PRAGMA table_info(memory_items)');
  if (!memCols.find((c) => c.name === 'tier')) {
    await db.exec("ALTER TABLE memory_items ADD COLUMN tier TEXT NOT NULL DEFAULT 'recent'");
  }
  if (!memCols.find((c) => c.name === 'last_affirmed_at')) {
    await db.exec('ALTER TABLE memory_items ADD COLUMN last_affirmed_at DATETIME');
    await db.exec('UPDATE memory_items SET last_affirmed_at = created_at WHERE last_affirmed_at IS NULL');
  }
  if (!memCols.find((c) => c.name === 'archived_at')) {
    await db.exec('ALTER TABLE memory_items ADD COLUMN archived_at DATETIME');
  }
  if (!memCols.find((c) => c.name === 'archived_reason')) {
    await db.exec('ALTER TABLE memory_items ADD COLUMN archived_reason TEXT');
  }
  // Audit M9 — memory subject tagging. Before this, every extracted
  // fact was blindly attributed to the signed-in user, which caused
  // the "memory mixing" bug: the extractor stored "Ioana is a vet
  // tech" on Adrian's profile when Adrian mentioned his sister Ioana.
  // Persona then introduced Adrian as a vet tech.
  //
  // The fix is structural: every row now carries
  //   subject       — "self" when the fact is about the signed-in user,
  //                   "other" when it's about a third party they
  //                   mentioned. Default 'self' preserves behaviour
  //                   for pre-migration rows.
  //   subject_name  — name of the "other" person (NULL for self).
  //                   Lets the retrieval layer group "facts about
  //                   Ioana" separately from "facts about Adrian".
  //   confidence    — 0.0 … 1.0 score emitted by the extractor.
  //                   Low-confidence rows are stored but hidden from
  //                   the persona until reinforced.
  if (!memCols.find((c) => c.name === 'subject')) {
    await db.exec("ALTER TABLE memory_items ADD COLUMN subject TEXT NOT NULL DEFAULT 'self'");
  }
  if (!memCols.find((c) => c.name === 'subject_name')) {
    await db.exec('ALTER TABLE memory_items ADD COLUMN subject_name TEXT');
  }
  if (!memCols.find((c) => c.name === 'confidence')) {
    await db.exec('ALTER TABLE memory_items ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0');
  }
  await db.exec('CREATE INDEX IF NOT EXISTS idx_memory_items_user ON memory_items(user_id, created_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_memory_items_user_live ON memory_items(user_id, archived_at, tier)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_memory_items_user_subject ON memory_items(user_id, subject, archived_at)');

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
      kind TEXT NOT NULL,                       -- 'topup' | 'consume' | 'bonus' | 'refund' | 'admin_grant'
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      idempotency_key TEXT,                     -- caller-supplied key for non-Stripe dedupe (admin grants, auto-topup retries)
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC)');
  // Guard against double-fulfillment when Stripe retries webhooks.
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_session ON credit_transactions(stripe_session_id) WHERE stripe_session_id IS NOT NULL');
  // Legacy DBs predate the `idempotency_key` column — add it if missing
  // (SQLite ALTER TABLE ADD COLUMN is safe on an existing table). The
  // unique partial index lets callers pass a stable key (admin grants,
  // retry-safe auto-topups) and have duplicate writes collapse into
  // a no-op, the same way Stripe webhook replays already do.
  try {
    const cols = await db.all("PRAGMA table_info('credit_transactions')");
    if (Array.isArray(cols) && !cols.some((c) => c.name === 'idempotency_key')) {
      await db.exec('ALTER TABLE credit_transactions ADD COLUMN idempotency_key TEXT');
    }
  } catch (_) { /* postgres path handled in postgres-schema.js */ }
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idem ON credit_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL');

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

  // PR #8/N — Memory of Actions. One row per real tool invocation so
  // Kelion can (a) avoid redoing something it already did this session
  // and (b) answer user questions like "did you email that yet?" or
  // "what did you search for just now?". Feeds `get_action_history`
  // which the voice model calls when it needs to check prior steps
  // instead of re-running a tool blindly.
  //
  // `args_summary` and `result_summary` are short capped strings (not
  // the raw JSON) so the table stays cheap to scan even after a heavy
  // session. Both are sanitised at write time in `logAction` below —
  // secrets, long URLs, passport numbers etc. never land here.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS action_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      args_summary TEXT,
      result_summary TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE INDEX IF NOT EXISTS idx_action_history_user ON action_history(user_id, created_at DESC)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_action_history_session ON action_history(user_id, session_id, created_at DESC)');

  // Dev Studio (DS-1) — per-user Python project workspaces. Each row
  // is one "project" Kelion can read/write into by voice. Files live
  // inline as a JSON blob (path → {content,size,updated_at}) so the
  // whole project round-trips in a single SELECT, keeping autosave
  // cheap. Quotas (5 MB/file, 50 MB/project, 1 GB/user) are enforced
  // in writeStudioFile below and mirrored in the Postgres DDL.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS studio_workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      files TEXT NOT NULL DEFAULT '{}',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_workspaces_user_name ON studio_workspaces(user_id, name)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_studio_workspaces_user ON studio_workspaces(user_id, updated_at DESC)');

  // Audit M7 — cross-instance consume state for the H1 silent-bypass
  // cap. The in-memory `consumeStateByUser` Map in routes/credits.js
  // is per-process — if Railway scales horizontally, a tampered
  // client can bounce between instances and reset its silent streak
  // on each hop, re-opening the H1 bypass. We persist the tiny per-
  // user policy state (lastBillableAt, silentStreak, silentSince) so
  // every instance sees the same counters. Payload is three integers
  // per user, written at most once per /consume call (~1/min/user).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS credits_consume_state (
      user_id INTEGER PRIMARY KEY,
      last_billable_at INTEGER NOT NULL DEFAULT 0,
      silent_streak    INTEGER NOT NULL DEFAULT 0,
      silent_since     INTEGER NOT NULL DEFAULT 0,
      updated_at       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // GC helper index — eviction scans by `updated_at` to drop rows
  // that haven't touched /consume in > TTL.
  await db.exec('CREATE INDEX IF NOT EXISTS idx_credits_consume_state_updated ON credits_consume_state(updated_at)');

  return db;
}

// Stage 3 — memory helpers
//
// Audit M8 note — every function here treats `archived_at IS NULL`
// as the "live" set. Archived rows stay in the table so the user
// can restore them from the admin panel; they just stop being
// injected into Kelion's prompt. `addMemoryItems` now also re-
// affirms (bumps last_affirmed_at) on an exact dup instead of
// silently dropping it — that drives the consolidator's promotion
// pass in services/memoryConsolidator.js.
// Audit M9 — normalise the subject fields the extractor emits. Anything
// not 'other' collapses to 'self' so a malformed extraction can never
// poison the signed-in user's profile. subject_name is only kept for
// 'other' rows — it's meaningless for self.
function _normalizeSubject(raw) {
  const kind = (raw && typeof raw.subject === 'string')
    ? raw.subject.trim().toLowerCase()
    : 'self';
  const subject = kind === 'other' ? 'other' : 'self';
  const name = (subject === 'other' && typeof raw?.subject_name === 'string')
    ? raw.subject_name.trim().slice(0, 120) || null
    : null;
  // confidence clamps to [0, 1]; NaN / missing defaults to 1.0 so the
  // legacy extractor (no confidence field) keeps promoting rows.
  let conf = Number(raw?.confidence);
  if (!Number.isFinite(conf)) conf = 1.0;
  conf = Math.max(0, Math.min(1, conf));
  return { subject, subject_name: name, confidence: conf };
}

async function addMemoryItems(userId, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const inserted = [];
  for (const it of items) {
    if (!it || !it.fact || typeof it.fact !== 'string') continue;
    const fact = it.fact.trim().slice(0, 500);
    if (!fact) continue;
    const kind = (it.kind && typeof it.kind === 'string') ? it.kind.slice(0, 40) : 'fact';
    const { subject, subject_name, confidence } = _normalizeSubject(it);
    // De-dupe: identical fact + same subject bumps last_affirmed_at.
    // Scoping the dedupe to (user_id, fact, subject, subject_name)
    // matters — "works as a vet" about the user AND about their
    // sister Ioana are two legitimately distinct rows.
    const dup = await db.get(
      `SELECT id FROM memory_items
         WHERE user_id = ? AND fact = ? AND subject = ?
           AND COALESCE(subject_name,'') = COALESCE(?,'')
           AND archived_at IS NULL
         LIMIT 1`,
      [userId, fact, subject, subject_name]
    );
    if (dup) {
      await db.run(
        'UPDATE memory_items SET last_affirmed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [dup.id, userId]
      );
      continue;
    }
    const r = await db.run(
      `INSERT INTO memory_items (user_id, kind, fact, tier, subject, subject_name, confidence)
       VALUES (?, ?, ?, 'recent', ?, ?, ?)`,
      [userId, kind, fact, subject, subject_name, confidence]
    );
    inserted.push({ id: r.lastID, user_id: userId, kind, fact, subject, subject_name, confidence });
  }
  return inserted;
}

// Live items only, core-tier first so the persona prompt leads
// with durable identity even if the newest rows are noisy one-off
// context notes.
//
// Audit M9 — callers can now filter by subject. Default keeps the
// pre-migration behaviour (return everything) so existing admin and
// consolidator code paths don't change shape. The persona injection
// uses the new `subject` option to keep "self" and "other" rows in
// separate prompt sections.
async function listMemoryItems(userId, limit = 100, opts = {}) {
  const { subject = null } = opts || {};
  const params = [userId];
  let where = 'user_id = ? AND archived_at IS NULL';
  if (subject === 'self' || subject === 'other') {
    where += ' AND subject = ?';
    params.push(subject);
  }
  params.push(limit);
  return db.all(
    `SELECT id, kind, fact, tier, subject, subject_name, confidence,
            last_affirmed_at, created_at
       FROM memory_items
      WHERE ${where}
      ORDER BY CASE WHEN tier = 'core' THEN 0 ELSE 1 END,
               created_at DESC
      LIMIT ?`,
    params
  );
}

// Full row (live + archived) for admin panel / consolidation.
async function listAllMemoryItems(userId, limit = 500) {
  return db.all(
    `SELECT id, kind, fact, tier, subject, subject_name, confidence,
            last_affirmed_at, archived_at, archived_reason, created_at
       FROM memory_items
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
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

// Audit M8 — tier / archive helpers used by the consolidator.
// All three are idempotent and scoped to (userId, id) so they
// cannot accidentally touch another user's row.
async function archiveMemoryItem(userId, id, reason) {
  const r = await db.run(
    `UPDATE memory_items
        SET archived_at = CURRENT_TIMESTAMP,
            archived_reason = ?
      WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
    [reason ? String(reason).slice(0, 200) : null, id, userId]
  );
  return r.changes > 0;
}

async function restoreMemoryItem(userId, id) {
  const r = await db.run(
    `UPDATE memory_items
        SET archived_at = NULL,
            archived_reason = NULL,
            last_affirmed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND archived_at IS NOT NULL`,
    [id, userId]
  );
  return r.changes > 0;
}

async function setMemoryItemTier(userId, id, tier) {
  const safe = tier === 'core' || tier === 'recent' ? tier : 'recent';
  const r = await db.run(
    `UPDATE memory_items
        SET tier = ?
      WHERE id = ? AND user_id = ?`,
    [safe, id, userId]
  );
  return r.changes > 0;
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

// PR #8/N — Memory of Actions helpers. Every real tool invocation the
// voice / text model routes through `executeRealTool` lands here with a
// short, sanitised summary so Kelion can later answer "did I already
// do X this session?" without re-running the tool. Write path is
// best-effort (swallows errors) because losing a history row must
// never break the live action itself.
//
// Size caps:
//   tool_name      ≤  60
//   session_id     ≤  80
//   args_summary   ≤ 300
//   result_summary ≤ 500
// Retention: unbounded; admin can prune manually with a DELETE. The
// voice model only ever reads the most recent 40 rows via listRecentActions.
async function logAction({ userId, sessionId, toolName, args, resultSummary, ok = true, durationMs = null }) {
  if (!userId || !toolName) return null;
  try {
    const safeSession = sessionId ? String(sessionId).slice(0, 80) : null;
    // Sanitise args down to a compact "k=v, k2=v2" string capped at
    // 300 chars. We deliberately drop any field whose key hints at a
    // secret (password, token, key, secret, auth, cookie) and never
    // store raw base64 blobs or HTML/JSON payloads — only primitives
    // and short strings survive. This mirrors the existing audit
    // logging discipline from voice_clone_events / credit_transactions.
    let argsSummary = null;
    if (args && typeof args === 'object') {
      const parts = [];
      for (const [k, v] of Object.entries(args)) {
        if (!k) continue;
        if (/password|token|key|secret|auth|cookie|bearer|otp|pin/i.test(k)) continue;
        let vs;
        if (v == null) vs = '';
        else if (typeof v === 'number' || typeof v === 'boolean') vs = String(v);
        else if (typeof v === 'string') vs = v.length > 80 ? v.slice(0, 77) + '…' : v;
        else continue; // skip objects / arrays / blobs — they'd blow the cap anyway
        parts.push(`${k}=${vs}`);
        if (parts.join(', ').length >= 260) break;
      }
      argsSummary = parts.join(', ').slice(0, 300) || null;
    }
    const safeResult = resultSummary
      ? String(resultSummary).slice(0, 500)
      : null;
    const dur = Number.isFinite(durationMs) ? Math.max(0, Math.min(10 * 60_000, durationMs | 0)) : null;
    const r = await db.run(
      `INSERT INTO action_history
         (user_id, session_id, tool_name, ok, args_summary, result_summary, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        safeSession,
        String(toolName).slice(0, 60),
        ok ? 1 : 0,
        argsSummary,
        safeResult,
        dur,
      ]
    );
    return { id: r.lastID };
  } catch (err) {
    // Never let an audit failure break the live action. Write path is
    // intentionally lossy — the worst case is the voice model forgets
    // it did something, which is survivable; a 500 on the tool call
    // would be user-visible.
    if (process.env.NODE_ENV !== 'test') {
      console.error('[action_history] logAction failed:', err?.message);
    }
    return null;
  }
}

async function listRecentActions(userId, { limit = 40, sessionId = null } = {}) {
  if (!userId) return [];
  const cappedLimit = Math.max(1, Math.min(200, Number(limit) || 40));
  if (sessionId) {
    return db.all(
      `SELECT id, session_id, tool_name, ok, args_summary, result_summary, duration_ms, created_at
         FROM action_history
        WHERE user_id = ? AND session_id = ?
        ORDER BY id DESC LIMIT ?`,
      [userId, String(sessionId).slice(0, 80), cappedLimit]
    );
  }
  return db.all(
    `SELECT id, session_id, tool_name, ok, args_summary, result_summary, duration_ms, created_at
       FROM action_history
      WHERE user_id = ?
      ORDER BY id DESC LIMIT ?`,
    [userId, cappedLimit]
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
  // Defense-in-depth dedupe. The client-side autosave loop advances its
  // cursor unconditionally after each successful POST, but on flaky
  // networks (retry with the same payload), and on legacy clients that
  // predate the cursor fix, the same (role, content) pair can arrive
  // back-to-back — which is how the orphan/duplicate-message threads
  // ended up on prod. If the most recent row on this conversation
  // matches exactly, return it instead of inserting a duplicate. The
  // lookup is a cheap single-row index scan on (conversation_id, id DESC).
  const lastRow = await db.get(
    'SELECT id, role, content, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1',
    [conversationId]
  );
  if (lastRow && lastRow.role === cleanRole && lastRow.content === cleanContent) {
    return {
      id: lastRow.id,
      conversation_id: conversationId,
      role: lastRow.role,
      content: lastRow.content,
      created_at: lastRow.created_at,
    };
  }
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

// Whitelist of columns updateUser() may touch. Column identifiers are
// interpolated into the UPDATE SQL (they cannot be parameterised), so
// any caller that ever forwards `req.body` unsanitised would otherwise
// become a SQL-injection on `users`. Callers today all whitelist their
// own keys, but enforcing the list here turns a latent footgun into a
// compile-time-style guarantee — unknown keys throw before any SQL is
// emitted. Columns that are managed by their own helpers (credits
// ledger, passkey challenges, timestamps) are intentionally excluded.
const UPDATE_USER_ALLOWED_COLUMNS = new Set([
  'google_id',
  'email',
  'name',
  'picture',
  'password_hash',
  'role',
  'subscription_tier',
  'subscription_status',
  'usage_today',
  'usage_reset_date',
  'referral_code',
  'referred_by',
  'stripe_customer_id',
  'preferred_language',
  'cloned_voice_id',
  'cloned_voice_consent_at',
  'cloned_voice_consent_version',
  'cloned_voice_enabled',
]);

async function updateUser(id, data) {
  if (!data || typeof data !== 'object') {
    throw new Error('updateUser: data must be an object');
  }
  const keys = Object.keys(data);
  const unknown = keys.filter((k) => !UPDATE_USER_ALLOWED_COLUMNS.has(k));
  if (unknown.length) {
    throw new Error(`updateUser: unknown column(s) rejected: ${unknown.join(', ')}`);
  }
  if (keys.length === 0) {
    // No-op update — avoid emitting invalid SQL (`SET  , updated_at = …`).
    return getUserById(id);
  }
  const fields = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => data[k]);
  await db.run(
    `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...values, id],
  );
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
    // studio_workspaces carries a UNIQUE(user_id, name) index, so a
    // plain UPDATE SET user_id would blow up if both users have a
    // project with the same name. Rename any source workspace whose
    // name already exists on the target before the bulk move. The
    // ` (merged)` suffix is unique per attempt; if that's also taken,
    // we fall back to ` (merged <sourceId>)` which cannot collide
    // because sourceId is unique DB-wide. Merging is admin-triggered
    // and rare, so we prioritise zero-data-loss over pretty names.
    const tgtNameRows = await db.all(
      'SELECT name FROM studio_workspaces WHERE user_id = ?',
      [targetId]
    );
    const tgtNames = new Set(tgtNameRows.map((r) => String(r.name)));
    const srcWs = await db.all(
      'SELECT id, name FROM studio_workspaces WHERE user_id = ?',
      [sourceId]
    );
    for (const row of srcWs) {
      if (!tgtNames.has(String(row.name))) {
        tgtNames.add(String(row.name));
        continue;
      }
      // Collision. Pick a unique new name, keeping within
      // MAX_STUDIO_NAME_LEN so the row still passes our own writers.
      let candidate = `${row.name} (merged)`;
      if (tgtNames.has(candidate)) candidate = `${row.name} (merged ${sourceId})`;
      if (candidate.length > MAX_STUDIO_NAME_LEN) {
        const suffix = ` (merged ${sourceId})`;
        const base = String(row.name).slice(0, MAX_STUDIO_NAME_LEN - suffix.length);
        candidate = `${base}${suffix}`;
      }
      await db.run(
        'UPDATE studio_workspaces SET name = ? WHERE id = ?',
        [candidate, row.id]
      );
      tgtNames.add(candidate);
    }
    const swMove = await db.run(
      'UPDATE studio_workspaces SET user_id = ? WHERE user_id = ?',
      [targetId, sourceId]
    );
    counts.studio_workspaces = Number((swMove && (swMove.changes || swMove.rowCount)) || 0);

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

// ─── Audit M7 — cross-instance consume state ────────────────────────
//
// Per-user policy state for the H1 silent-bypass cap, persisted in
// `credits_consume_state` so every process instance sees the same
// counters. Read: one SELECT per /consume call. Write: one upsert
// per decision transition. Payload is three integers per user.
//
// The in-memory Map in routes/credits.js is now a tiny L1 cache — if
// a write to the DB fails we still have the per-process state, so
// the cap can't collapse silently on transient DB hiccups.

async function getConsumeState(userId) {
  if (!userId && userId !== 0) return null;
  const row = await db.get(
    `SELECT last_billable_at AS lastBillableAt,
            silent_streak    AS silentStreak,
            silent_since     AS silentSince,
            updated_at       AS updatedAt
     FROM credits_consume_state
     WHERE user_id = ?`,
    [userId]
  );
  if (!row) return null;
  return {
    lastBillableAt: Number(row.lastBillableAt) || 0,
    silentStreak:   Number(row.silentStreak)   || 0,
    silentSince:    Number(row.silentSince)    || 0,
    updatedAt:      Number(row.updatedAt)      || 0,
  };
}

async function saveConsumeState(userId, state, nowMs) {
  if (!userId && userId !== 0) return;
  const s = state || {};
  const lastBillableAt = Number(s.lastBillableAt) || 0;
  const silentStreak   = Number(s.silentStreak)   || 0;
  const silentSince    = Number(s.silentSince)    || 0;
  const updatedAt      = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  // `INSERT ... ON CONFLICT DO UPDATE` is supported by sqlite ≥3.24
  // (packaged sqlite3@5 ships 3.40+) and by Postgres. One round-trip
  // whether the row exists or not, safe under race between instances.
  //
  // The explicit `RETURNING user_id` clause is load-bearing on
  // Postgres: our pg-adapter auto-appends ` RETURNING id` to every
  // INSERT that has no RETURNING of its own, and `credits_consume_state`
  // has no `id` column (user_id IS the primary key). Without our own
  // RETURNING clause the upsert would fail in production clusters
  // (M7 fix effectively disabled — flagged P1 by Codex on #186). The
  // clause is harmless on SQLite (ignored when lastID isn't read) and
  // compiles identically on Postgres, so a single SQL string works
  // across both dialects.
  await db.run(
    `INSERT INTO credits_consume_state
       (user_id, last_billable_at, silent_streak, silent_since, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_billable_at = excluded.last_billable_at,
       silent_streak    = excluded.silent_streak,
       silent_since     = excluded.silent_since,
       updated_at       = excluded.updated_at
     RETURNING user_id`,
    [userId, lastBillableAt, silentStreak, silentSince, updatedAt]
  );
}

async function gcConsumeStateRows(cutoffMs) {
  const cutoff = Number.isFinite(cutoffMs) ? Number(cutoffMs) : 0;
  const r = await db.run(
    'DELETE FROM credits_consume_state WHERE updated_at < ?',
    [cutoff]
  );
  return (r && typeof r.changes === 'number') ? r.changes : 0;
}

// ─── Dev Studio (DS-1) — per-user Python project workspaces ─────────
//
// Each row is one "project" Kelion can read/write into by voice. The
// `files` column is a JSON object (path → {content,size,updated_at})
// serialized as TEXT. The same schema works identically on SQLite and
// Postgres because we never query into the blob — writeStudioFile
// replaces the whole map atomically.
//
// Quotas (enforced below; writes past any cap return a structured
// `RangeError` the route layer maps to 413):
//   • MAX_STUDIO_FILE_BYTES      — 5 MB per file (post-UTF-8 encode)
//   • MAX_STUDIO_WORKSPACE_BYTES — 50 MB per project
//   • MAX_STUDIO_USER_BYTES      — 1 GB per user (sum of all projects)
//   • MAX_STUDIO_FILES_PER_WS    — 500 files per project
//   • MAX_STUDIO_NAME_LEN        — 120 chars, reasonable project name
//   • MAX_STUDIO_PATH_LEN        — 512 chars, reasonable repo-style path

const MAX_STUDIO_FILE_BYTES      = 5 * 1024 * 1024;
const MAX_STUDIO_WORKSPACE_BYTES = 50 * 1024 * 1024;
const MAX_STUDIO_USER_BYTES      = 1024 * 1024 * 1024;
const MAX_STUDIO_FILES_PER_WS    = 500;
const MAX_STUDIO_NAME_LEN        = 120;
const MAX_STUDIO_PATH_LEN        = 512;

// Only forward-slash repo-style paths are allowed. We explicitly reject:
//   • absolute paths (leading /)
//   • parent traversal (".." segment)
//   • Windows drive letters or backslashes
//   • NUL bytes and any other C0 control char
//   • empty segments ("foo//bar") and trailing slashes
function sanitizeStudioPath(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_STUDIO_PATH_LEN) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(trimmed)) return null;
  if (trimmed.startsWith('/')) return null;
  if (trimmed.endsWith('/')) return null;
  const parts = trimmed.split('/');
  for (const seg of parts) {
    if (!seg || seg === '.' || seg === '..') return null;
  }
  return trimmed;
}

function sanitizeStudioName(raw) {
  if (typeof raw !== 'string') return null;
  // Reject control chars on the *raw* value — we check before trim()
  // because trim() silently strips leading/trailing \n\t\r, which
  // would mask a caller trying to smuggle newlines into a project
  // name (chat-log spoofing, filesystem odd-paths, etc.).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_STUDIO_NAME_LEN) return null;
  return trimmed;
}

function parseStudioFiles(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function studioBlobSize(files) {
  let total = 0;
  for (const key of Object.keys(files)) {
    const entry = files[key];
    const size = entry && typeof entry.size === 'number'
      ? entry.size
      : Buffer.byteLength(String(entry?.content ?? ''), 'utf8');
    total += size;
  }
  return total;
}

function quotaError(code, message, extra = {}) {
  const err = new RangeError(message);
  err.studioQuota = code;
  Object.assign(err, extra);
  return err;
}

async function listStudioWorkspaces(userId, limit = 50) {
  const safe = Math.max(1, Math.min(500, limit));
  const rows = await db.all(
    `SELECT id, name, size_bytes, created_at, updated_at
     FROM studio_workspaces
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT ?`,
    [userId, safe]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    size_bytes: Number(r.size_bytes || 0),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

async function createStudioWorkspace(userId, name) {
  const clean = sanitizeStudioName(name);
  if (!clean) throw quotaError('NAME_INVALID', 'workspace name is invalid');
  try {
    const r = await db.run(
      'INSERT INTO studio_workspaces (user_id, name, files, size_bytes) VALUES (?, ?, ?, ?)',
      [userId, clean, '{}', 0]
    );
    return {
      id: r.lastID,
      user_id: userId,
      name: clean,
      files: {},
      size_bytes: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  } catch (err) {
    if (err && /UNIQUE/i.test(err.message || '')) {
      throw quotaError('NAME_DUP', 'workspace name already exists');
    }
    throw err;
  }
}

async function assertStudioOwner(userId, workspaceId) {
  const row = await db.get(
    'SELECT id, user_id FROM studio_workspaces WHERE id = ?',
    [workspaceId]
  );
  if (!row) return null;
  if (Number(row.user_id) !== Number(userId)) return null;
  return row;
}

async function getStudioWorkspace(userId, workspaceId) {
  const row = await db.get(
    `SELECT id, user_id, name, files, size_bytes, created_at, updated_at
     FROM studio_workspaces
     WHERE id = ? AND user_id = ?`,
    [workspaceId, userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    files: parseStudioFiles(row.files),
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getStudioWorkspaceByName(userId, name) {
  const clean = sanitizeStudioName(name);
  if (!clean) return null;
  const row = await db.get(
    `SELECT id, user_id, name, files, size_bytes, created_at, updated_at
     FROM studio_workspaces
     WHERE user_id = ? AND name = ?`,
    [userId, clean]
  );
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    files: parseStudioFiles(row.files),
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function renameStudioWorkspace(userId, workspaceId, newName) {
  const clean = sanitizeStudioName(newName);
  if (!clean) throw quotaError('NAME_INVALID', 'workspace name is invalid');
  const own = await assertStudioOwner(userId, workspaceId);
  if (!own) return false;
  try {
    const r = await db.run(
      'UPDATE studio_workspaces SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [clean, workspaceId]
    );
    return r.changes > 0;
  } catch (err) {
    if (err && /UNIQUE/i.test(err.message || '')) {
      throw quotaError('NAME_DUP', 'workspace name already exists');
    }
    throw err;
  }
}

async function deleteStudioWorkspace(userId, workspaceId) {
  const own = await assertStudioOwner(userId, workspaceId);
  if (!own) return false;
  const r = await db.run('DELETE FROM studio_workspaces WHERE id = ?', [workspaceId]);
  return r.changes > 0;
}

async function getUserStudioUsage(userId) {
  const row = await db.get(
    `SELECT COUNT(*) AS workspaces,
            COALESCE(SUM(size_bytes), 0) AS total_bytes
     FROM studio_workspaces
     WHERE user_id = ?`,
    [userId]
  );
  return {
    workspaces: Number(row?.workspaces || 0),
    total_bytes: Number(row?.total_bytes || 0),
    quota_bytes: MAX_STUDIO_USER_BYTES,
  };
}

// Serialize concurrent writes per workspace so two autosaves in flight
// can't race on the JSON blob (last-write-wins but one overwrite
// clobbering the other's file is worse). Queue per-workspace keyed by id.
//
// The cleanup step compares against a SINGLE Promise object stored in
// the Map — `next.catch(() => null)` creates a NEW promise each call
// so we build `stored` once and reuse it for both the Map value and
// the `finally` identity check. Without this, the `delete` never
// fires and every workspace that receives a write keeps a permanent
// Map entry (real leak, not just theoretical).
const studioWriteQueues = new Map();
function serializeStudioWrite(workspaceId, fn) {
  const prev = studioWriteQueues.get(workspaceId) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  const stored = next.catch(() => null).finally(() => {
    if (studioWriteQueues.get(workspaceId) === stored) {
      studioWriteQueues.delete(workspaceId);
    }
  });
  studioWriteQueues.set(workspaceId, stored);
  return next;
}

// Test-only: inspect live queue size (used by studio-workspaces.test.js
// to assert the leak-fix: Map size returns to 0 after the tail of a
// write chain settles).
function __getStudioWriteQueuesSizeForTests() {
  return studioWriteQueues.size;
}

async function writeStudioFile(userId, workspaceId, filePath, content) {
  const cleanPath = sanitizeStudioPath(filePath);
  if (!cleanPath) throw quotaError('PATH_INVALID', 'file path is invalid');
  if (typeof content !== 'string') {
    throw quotaError('CONTENT_INVALID', 'file content must be a string');
  }
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_STUDIO_FILE_BYTES) {
    throw quotaError('FILE_TOO_BIG', 'file exceeds 5 MB cap', {
      size, limit: MAX_STUDIO_FILE_BYTES,
    });
  }
  return serializeStudioWrite(workspaceId, async () => {
    const ws = await getStudioWorkspace(userId, workspaceId);
    if (!ws) return null;
    const prev = ws.files[cleanPath];
    const prevSize = prev ? Number(prev.size || 0) : 0;
    const newWsSize = Number(ws.size_bytes || 0) - prevSize + size;
    if (newWsSize > MAX_STUDIO_WORKSPACE_BYTES) {
      throw quotaError('WORKSPACE_FULL', 'workspace exceeds 50 MB cap', {
        size: newWsSize, limit: MAX_STUDIO_WORKSPACE_BYTES,
      });
    }
    const fileCount = Object.keys(ws.files).length + (prev ? 0 : 1);
    if (fileCount > MAX_STUDIO_FILES_PER_WS) {
      throw quotaError('TOO_MANY_FILES', 'workspace exceeds file-count cap', {
        files: fileCount, limit: MAX_STUDIO_FILES_PER_WS,
      });
    }
    // User-level soft cap — sum of ALL workspaces excluding this one's old size.
    const usage = await getUserStudioUsage(userId);
    const otherBytes = Number(usage.total_bytes || 0) - Number(ws.size_bytes || 0);
    if (otherBytes + newWsSize > MAX_STUDIO_USER_BYTES) {
      throw quotaError('USER_QUOTA', 'user storage quota exceeded', {
        size: otherBytes + newWsSize, limit: MAX_STUDIO_USER_BYTES,
      });
    }
    const updated = {
      ...ws.files,
      [cleanPath]: {
        content,
        size,
        updated_at: new Date().toISOString(),
      },
    };
    const r = await db.run(
      `UPDATE studio_workspaces
         SET files = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [JSON.stringify(updated), newWsSize, workspaceId, userId]
    );
    if (r.changes === 0) return null;
    return {
      path: cleanPath,
      size,
      workspace_size_bytes: newWsSize,
      updated_at: new Date().toISOString(),
    };
  });
}

async function deleteStudioFile(userId, workspaceId, filePath) {
  const cleanPath = sanitizeStudioPath(filePath);
  if (!cleanPath) throw quotaError('PATH_INVALID', 'file path is invalid');
  return serializeStudioWrite(workspaceId, async () => {
    const ws = await getStudioWorkspace(userId, workspaceId);
    if (!ws) return null;
    const prev = ws.files[cleanPath];
    if (!prev) return { deleted: false, workspace_size_bytes: ws.size_bytes };
    const prevSize = Number(prev.size || 0);
    const updated = { ...ws.files };
    delete updated[cleanPath];
    const newWsSize = Math.max(0, Number(ws.size_bytes || 0) - prevSize);
    const r = await db.run(
      `UPDATE studio_workspaces
         SET files = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [JSON.stringify(updated), newWsSize, workspaceId, userId]
    );
    if (r.changes === 0) return null;
    return { deleted: true, workspace_size_bytes: newWsSize };
  });
}

async function readStudioFile(userId, workspaceId, filePath) {
  const cleanPath = sanitizeStudioPath(filePath);
  if (!cleanPath) return null;
  const ws = await getStudioWorkspace(userId, workspaceId);
  if (!ws) return null;
  const entry = ws.files[cleanPath];
  if (!entry) return null;
  return {
    path: cleanPath,
    content: String(entry.content ?? ''),
    size: Number(entry.size || 0),
    updated_at: entry.updated_at || ws.updated_at,
  };
}

function listStudioFiles(workspace) {
  if (!workspace || !workspace.files) return [];
  return Object.keys(workspace.files).sort().map((path) => ({
    path,
    size: Number(workspace.files[path].size || 0),
    updated_at: workspace.files[path].updated_at || workspace.updated_at,
  }));
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
  listAllMemoryItems,
  deleteMemoryItem,
  clearMemoryForUser,
  // Audit M8 — consolidator writes
  archiveMemoryItem,
  restoreMemoryItem,
  setMemoryItemTier,
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
  // PR #8/N — Memory of Actions
  logAction,
  listRecentActions,
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
  getCreditTopupByPaymentIntent,
  listCreditTransactions,
  listRecentCreditTransactions,
  getCreditRevenueSummary,
  // Audit M7 — cross-instance consume state
  getConsumeState,
  saveConsumeState,
  gcConsumeStateRows,
  // Visitor analytics
  recordVisitorEvent,
  listRecentVisitors,
  getVisitorStats,
  // Dev Studio (DS-1) — per-user Python project workspaces
  listStudioWorkspaces,
  createStudioWorkspace,
  getStudioWorkspace,
  getStudioWorkspaceByName,
  renameStudioWorkspace,
  deleteStudioWorkspace,
  getUserStudioUsage,
  writeStudioFile,
  deleteStudioFile,
  readStudioFile,
  listStudioFiles,
  sanitizeStudioPath,
  sanitizeStudioName,
  MAX_STUDIO_FILE_BYTES,
  MAX_STUDIO_WORKSPACE_BYTES,
  MAX_STUDIO_USER_BYTES,
  MAX_STUDIO_FILES_PER_WS,
  MAX_STUDIO_NAME_LEN,
  MAX_STUDIO_PATH_LEN,
  __getStudioWriteQueuesSizeForTests,
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
  idempotencyKey = null,
  note = null,
  // Audit M3 — refunds MUST be able to push the balance below zero. If
  // a user has already consumed minutes from a top-up that Stripe
  // later refunds (chargeback, manual refund, subscription cancel),
  // the ledger still has to invert — otherwise reports, audits, and
  // `creditsBalance` diverge from reality. The next top-up naturally
  // pulls the balance back above zero. Default remains false so
  // consumption paths keep their safety net.
  allowNegative = false,
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
        if (next < 0 && !allowNegative) { await c.exec('ROLLBACK'); throw new Error('insufficient credits'); }
        await c.run('UPDATE users SET credits_balance_minutes = ? WHERE id = ?', [next, userId]);
        await c.run(
          `INSERT INTO credit_transactions
           (user_id, delta_minutes, amount_cents, currency, kind, stripe_session_id, stripe_payment_intent, idempotency_key, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, deltaMinutes, amountCents, currency, kind, stripeSessionId, stripePaymentIntent, idempotencyKey, note],
        );
        await c.exec('COMMIT');
        return { balance: next, previous: current, deltaMinutes };
      } catch (err) {
        try { await c.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        if (/UNIQUE/i.test(err && err.message) && (stripeSessionId || idempotencyKey)) {
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
      if (next < 0 && !allowNegative) {
        // Refuse to go negative; caller should check balance first.
        await db.run('ROLLBACK');
        throw new Error('insufficient credits');
      }
      await db.run('UPDATE users SET credits_balance_minutes = ? WHERE id = ?', [next, userId]);
      await db.run(
        `INSERT INTO credit_transactions
         (user_id, delta_minutes, amount_cents, currency, kind, stripe_session_id, stripe_payment_intent, idempotency_key, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, deltaMinutes, amountCents, currency, kind, stripeSessionId, stripePaymentIntent, idempotencyKey, note],
      );
      await db.run('COMMIT');
      return { balance: next, previous: current, deltaMinutes };
    } catch (err) {
      try { await db.run('ROLLBACK'); } catch (_) { /* ignore */ }
      // UNIQUE stripe_session_id OR idempotency_key → duplicate
      // write (webhook retry, double-click on admin grant, retried
      // auto-topup). Treat as idempotent no-op and return the
      // current balance so the caller sees a successful response.
      if (/UNIQUE/i.test(err && err.message) && (stripeSessionId || idempotencyKey)) {
        const balance = await getCreditsBalance(userId);
        return { balance, previous: balance, deltaMinutes: 0, duplicate: true };
      }
      throw err;
    }
  });
}

/**
 * Audit M3 — look up the original top-up row for a Stripe PaymentIntent.
 * Used by the `charge.refunded` webhook handler to compute how many
 * minutes to invert from the ledger (proportional to the refunded
 * amount vs the original charge). Returns `null` when the PaymentIntent
 * is unknown to us — either the charge was never fulfilled
 * (checkout.session.completed never arrived) or the refund is for a
 * charge created outside the credits flow.
 *
 * Matches against `kind = 'topup'` explicitly so a previous partial
 * refund on the same PaymentIntent doesn't mask the original top-up.
 */
async function getCreditTopupByPaymentIntent(paymentIntent) {
  if (!paymentIntent || typeof paymentIntent !== 'string') return null;
  const row = await db.get(
    `SELECT id, user_id, delta_minutes, amount_cents, currency,
            stripe_session_id, stripe_payment_intent, idempotency_key,
            kind, note, created_at
       FROM credit_transactions
      WHERE stripe_payment_intent = ? AND kind = 'topup'
      ORDER BY created_at ASC
      LIMIT 1`,
    [paymentIntent],
  );
  return row || null;
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
