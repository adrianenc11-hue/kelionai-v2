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
      id           TEXT PRIMARY KEY,           -- UUID
      google_id    TEXT UNIQUE NOT NULL,
      email        TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      picture      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
  `);
}

migrate();

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const stmtFindByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?');
const stmtFindById       = db.prepare('SELECT * FROM users WHERE id = ?');

const stmtUpsert = db.prepare(`
  INSERT INTO users (id, google_id, email, name, picture, created_at, updated_at)
  VALUES (@id, @google_id, @email, @name, @picture, datetime('now'), datetime('now'))
  ON CONFLICT(google_id) DO UPDATE SET
    email      = excluded.email,
    name       = excluded.name,
    picture    = excluded.picture,
    updated_at = datetime('now')
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

module.exports = { db, findByGoogleId, findById, upsertUser };
