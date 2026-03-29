// Debug: run migration statements one by one and show errors
const { Pool } = require('pg');
require('dotenv').config();

const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password = process.env.DB_PASSWORD;
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });

// Load the same MIGRATION_SQL from migrate.js
delete require.cache[require.resolve('../server/migrate')];
// We need to extract MIGRATION_SQL — read the file directly
const fs = require('fs');
const src = fs.readFileSync('server/migrate.js', 'utf8');
const match = src.match(/const MIGRATION_SQL = `([\s\S]*?)`;/);
if (!match) { console.log('Cannot extract MIGRATION_SQL'); process.exit(1); }
const SQL = match[1];

// Split respecting $tag$ blocks
const statements = [];
let buf = '';
let inBlock = false;
let blockTag = '';
for (const line of SQL.split('\n')) {
  buf += line + '\n';
  const trimmed = line.trim();
  if (!inBlock) {
    const startMatch = trimmed.match(/(\$[a-zA-Z_]*\$)\s*(?:BEGIN|DECLARE)?/);
    if (startMatch && !trimmed.endsWith(startMatch[1] + ';')) {
      inBlock = true;
      blockTag = startMatch[1];
    } else if (trimmed.endsWith(';')) {
      statements.push(buf.trim());
      buf = '';
    }
  } else {
    if (trimmed.includes(blockTag) && trimmed.endsWith(';')) {
      inBlock = false;
      blockTag = '';
      statements.push(buf.trim());
      buf = '';
    }
  }
}
if (buf.trim()) statements.push(buf.trim());

(async () => {
  let ok = 0, fail = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (stmt.length < 3 || /^--/.test(stmt)) continue;
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    try {
      await pool.query(stmt);
      ok++;
    } catch (e) {
      fail++;
      console.log(`[FAIL #${i}] ${e.message.substring(0, 100)}`);
      console.log(`  STMT: ${preview}...`);
      console.log('');
    }
  }
  console.log(`\n=== DONE: ${ok} OK, ${fail} FAILED out of ${ok + fail} ===`);
  await pool.end();
})();
