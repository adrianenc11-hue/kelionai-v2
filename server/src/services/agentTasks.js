'use strict';

const { getDb } = require('../db');

function _db() {
  const db = getDb();
  if (!db) throw new Error('Database not available');
  return db;
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
  const allowed = ['title', 'description', 'status', 'priority'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (updates[key] != null) {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if (fields.length === 0) return { ok: false, error: 'No valid fields to update.' };
  values.push(id);
  await db.run(
    `UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  return { ok: true };
}

async function getTasks(status = null) {
  const db = _db();
  let rows;
  if (status) {
    rows = await db.all(`SELECT * FROM agent_tasks WHERE status = ? ORDER BY created_at DESC`, [status]);
  } else {
    rows = await db.all(`SELECT * FROM agent_tasks ORDER BY created_at DESC`);
  }
  return { ok: true, tasks: rows };
}

async function deleteTask(id) {
  const db = _db();
  await db.run(`DELETE FROM agent_tasks WHERE id = ?`, [id]);
  return { ok: true };
}

async function initTasksTable() {
  const db = _db();
  if (db._isPg) {
    // Postgres: agent_tasks is already created by postgres-schema.js
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
      created_at TEXT,
      updated_at TEXT
    )
  `);
}

module.exports = { createTask, updateTask, getTasks, deleteTask, initTasksTable };
