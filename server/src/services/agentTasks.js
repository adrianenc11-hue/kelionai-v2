'use strict';

const { getDb } = require('../db');

// Columns that store JSON state (Postgres: JSONB; SQLite: TEXT-serialized).
// Kept in one place so serialize/deserialize stay in sync.
const JSON_FIELDS = ['narratives', 'logs', 'plan', 'modified_paths', 'backups'];

function _db() {
  const db = getDb();
  if (!db) throw new Error('Database not available');
  return db;
}

// Serialize a JS value for storage. Postgres JSONB accepts JS objects directly
// via the pg driver, but the project's db wrapper passes strings — match it.
function _serialize(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val); } catch { return null; }
}

// Parse a JSON column. Postgres returns objects already; SQLite returns strings.
function _parse(val) {
  if (val == null) return null;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

function _hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of JSON_FIELDS) {
    if (k in out) out[k] = _parse(out[k]);
  }
  // Camel-case alias for the UI consumer.
  if ('modified_paths' in out) out.modifiedPaths = out.modified_paths;
  if ('status_detail' in out) out.statusDetail = out.status_detail;
  return out;
}

async function createTask({ title, description, parentId = null, priority = 'normal' }) {
  const db = _db();
  const result = await db.run(
    `INSERT INTO agent_tasks (title, description, parent_id, priority, status, created_at)
     VALUES (?, ?, ?, ?, 'not_started', datetime('now'))`,
    [title, description, parentId, priority]
  );
  return { ok: true, id: result.lastID };
}

async function updateTask(id, updates) {
  const db = _db();
  const allowed = [
    'title', 'description', 'status', 'priority', 'status_detail',
    'narratives', 'logs', 'plan', 'modified_paths', 'backups',
    'approved_commit', 'approved_push',
  ];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(JSON_FIELDS.includes(key) ? _serialize(updates[key]) : updates[key]);
  }
  if (fields.length === 0) return { ok: false, error: 'No valid fields to update.' };
  values.push(id);
  await db.run(
    `UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return { ok: true };
}

async function getTask(id) {
  const db = _db();
  const row = await db.get(`SELECT * FROM agent_tasks WHERE id = ?`, [id]);
  return { ok: !!row, task: _hydrate(row) };
}

async function getTasks(status = null) {
  const db = _db();
  let rows;
  if (status) {
    rows = await db.all(`SELECT * FROM agent_tasks WHERE status = ? ORDER BY created_at DESC`, [status]);
  } else {
    rows = await db.all(`SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 100`);
  }
  return { ok: true, tasks: (rows || []).map(_hydrate) };
}

async function deleteTask(id) {
  const db = _db();
  await db.run(`DELETE FROM agent_tasks WHERE id = ?`, [id]);
  return { ok: true };
}

async function initTasksTable() {
  const db = _db();
  if (db._isPg) {
    // Postgres: agent_tasks (+ runtime state columns) is created by postgres-schema.js
    return;
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      parent_id INTEGER REFERENCES agent_tasks(id),
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'not_started',
      status_detail TEXT,
      narratives TEXT DEFAULT '[]',
      logs TEXT DEFAULT '[]',
      plan TEXT,
      modified_paths TEXT DEFAULT '[]',
      backups TEXT DEFAULT '{}',
      approved_commit INTEGER DEFAULT 0,
      approved_push INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  // Idempotent migrations for existing SQLite DBs that pre-date Faza 7.
  const cols = [
    "ALTER TABLE agent_tasks ADD COLUMN status_detail TEXT",
    "ALTER TABLE agent_tasks ADD COLUMN narratives TEXT DEFAULT '[]'",
    "ALTER TABLE agent_tasks ADD COLUMN logs TEXT DEFAULT '[]'",
    "ALTER TABLE agent_tasks ADD COLUMN plan TEXT",
    "ALTER TABLE agent_tasks ADD COLUMN modified_paths TEXT DEFAULT '[]'",
    "ALTER TABLE agent_tasks ADD COLUMN backups TEXT DEFAULT '{}'",
    "ALTER TABLE agent_tasks ADD COLUMN approved_commit INTEGER DEFAULT 0",
    "ALTER TABLE agent_tasks ADD COLUMN approved_push INTEGER DEFAULT 0",
  ];
  for (const sql of cols) {
    try { await db.exec(sql); } catch { /* column already exists */ }
  }
}

module.exports = { createTask, updateTask, getTask, getTasks, deleteTask, initTasksTable };
