import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const dbPath = process.env.DB_PATH || './data/kelion.db';
let db;

export async function initDb() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  await db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_id TEXT UNIQUE, email TEXT, name TEXT)');
  return db;
}

export function getDb() { return db; }
export async function getUserByGoogleId(id) { return await db.get('SELECT * FROM users WHERE google_id = ?', [id]); }
export async function createUser(data) { 
  const result = await db.run('INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)', [data.google_id, data.email, data.name]);
  return { id: result.lastID, ...data };
}
