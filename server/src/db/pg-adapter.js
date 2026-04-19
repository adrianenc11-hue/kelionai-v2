'use strict';

// Postgres driver that exposes the same `.run / .get / .all / .exec`
// surface as the `sqlite` (node-sqlite3) wrapper used elsewhere in the
// codebase. This lets `server/src/db/index.js` swap between SQLite and
// Supabase Postgres based on a single env var (`DATABASE_URL`) without
// changing a single caller.
//
// Semantics preserved:
//   - `?`  parameter placeholders are auto-converted to `$1, $2, ...`
//   - `INSERT` statements without an explicit `RETURNING` clause get
//     `RETURNING id` appended so `result.lastID` keeps working.
//   - `result.changes` mirrors sqlite's `rowCount`.
//   - `PRAGMA table_info(<t>)` is rewritten to a portable
//     `information_schema.columns` query (used only during schema
//     migration bootstrapping — the values still come back with a
//     `.name` column).
//   - `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
//     (used by the purge endpoints) is rewritten to an equivalent
//     `pg_tables` lookup.
//   - `BEGIN IMMEDIATE` is mapped to plain `BEGIN` so the legacy SQLite
//     transaction code keeps working — but note that Postgres transactions
//     *must* be run on a single connection (see `connect()` below).

const { Pool, types: pgTypes } = require('pg');

// node-postgres parses BIGINT/int8 (OID 20) as a JS string by default to avoid
// precision loss. Our primary keys stay well under 2^53 for the foreseeable
// future, and downstream code (JWT issuance, id comparisons, route params)
// was written against SQLite's numeric ids — so cast int8 to Number to keep
// behaviour identical.
pgTypes.setTypeParser(20, (val) => (val == null ? val : Number(val)));

function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Map common Postgres errors to strings that sqlite-style code recognizes.
// UNIQUE violations in the codebase are detected via `/UNIQUE/i.test(err.message)`
// so we prefix a UNIQUE tag onto pg's "duplicate key value" message.
function normalizeError(err) {
  if (!err || typeof err !== 'object') return err;
  if (err.code === '23505' && !/UNIQUE/i.test(err.message || '')) {
    const wrapped = new Error('UNIQUE constraint failed: ' + err.message);
    wrapped.original = err;
    wrapped.code = err.code;
    return wrapped;
  }
  return err;
}

const PRAGMA_RE = /^\s*PRAGMA\s+table_info\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*$/i;
const SQLITE_MASTER_RE =
  /^\s*SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\?\s*$/i;

function rewriteSql(sql) {
  // PRAGMA table_info(<t>)  →  information_schema lookup
  const m = PRAGMA_RE.exec(sql);
  if (m) {
    return {
      sql: "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
      params: [m[1]],
      isPragma: true,
    };
  }
  // SELECT name FROM sqlite_master WHERE type='table' AND name = ?  →  pg_tables
  if (SQLITE_MASTER_RE.test(sql)) {
    return {
      sql: "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename = $1",
      isPragma: false,
      passthrough: false,
    };
  }
  // Map SQLite-only BEGIN IMMEDIATE to plain BEGIN (no deferred-write locking in PG).
  if (/^\s*BEGIN\s+IMMEDIATE\s*;?\s*$/i.test(sql)) {
    return { sql: 'BEGIN', isPragma: false };
  }
  return { sql: toPgParams(sql), isPragma: false };
}

function shouldAppendReturningId(sql) {
  if (!/^\s*INSERT\s+INTO/i.test(sql)) return false;
  if (/\bRETURNING\b/i.test(sql)) return false;
  return true;
}

function createPgAdapter(connectionString) {
  const pool = new Pool({
    connectionString,
    // Supabase's pooler serves via TLS with a cert chain that Node doesn't
    // trust out of the box; we rely on the connection string's auth and
    // mark the server cert as accepted to match the server-side behaviour.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 8),
    idleTimeoutMillis: 30_000,
  });

  pool.on('error', (err) => {
    // Swallow idle-client errors so a transient network blip doesn't crash
    // the whole server.
    console.warn('[pg] idle client error:', err && err.message);
  });

  async function exec(sql) {
    // Multi-statement DDL goes through as-is; no parameter substitution.
    try {
      await pool.query(sql);
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async function run(sql, params = []) {
    if (params != null && !Array.isArray(params)) params = [params];
    const rewritten = rewriteSql(sql);
    let finalSql = rewritten.sql;
    let finalParams = rewritten.params || params || [];
    if (!rewritten.isPragma && shouldAppendReturningId(finalSql)) {
      finalSql += ' RETURNING id';
    }
    try {
      const r = await pool.query(finalSql, finalParams);
      return {
        lastID: r.rows && r.rows[0] ? r.rows[0].id : undefined,
        changes: r.rowCount,
      };
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async function get(sql, params = []) {
    if (params != null && !Array.isArray(params)) params = [params];
    const rewritten = rewriteSql(sql);
    const finalParams = rewritten.params || params || [];
    try {
      const r = await pool.query(rewritten.sql, finalParams);
      return r.rows[0];
    } catch (e) {
      throw normalizeError(e);
    }
  }

  async function all(sql, params = []) {
    if (params != null && !Array.isArray(params)) params = [params];
    const rewritten = rewriteSql(sql);
    const finalParams = rewritten.params || params || [];
    try {
      const r = await pool.query(rewritten.sql, finalParams);
      return r.rows;
    } catch (e) {
      throw normalizeError(e);
    }
  }

  // For code that needs a real transaction on a single connection
  // (see `addCreditsTransaction` in db/index.js). Returns a pg client
  // plus sqlite-style helpers that operate on that client.
  async function connect() {
    const client = await pool.connect();
    async function cExec(sql) {
      try { await client.query(sql); } catch (e) { throw normalizeError(e); }
    }
    async function cRun(sql, params = []) {
      if (params != null && !Array.isArray(params)) params = [params];
      const rewritten = rewriteSql(sql);
      let finalSql = rewritten.sql;
      let finalParams = rewritten.params || params || [];
      if (!rewritten.isPragma && shouldAppendReturningId(finalSql)) {
        finalSql += ' RETURNING id';
      }
      try {
        const r = await client.query(finalSql, finalParams);
        return { lastID: r.rows && r.rows[0] ? r.rows[0].id : undefined, changes: r.rowCount };
      } catch (e) { throw normalizeError(e); }
    }
    async function cGet(sql, params = []) {
      if (params != null && !Array.isArray(params)) params = [params];
      const rewritten = rewriteSql(sql);
      const finalParams = rewritten.params || params || [];
      try {
        const r = await client.query(rewritten.sql, finalParams);
        return r.rows[0];
      } catch (e) { throw normalizeError(e); }
    }
    return {
      run: cRun,
      get: cGet,
      exec: cExec,
      release: () => client.release(),
      _client: client,
    };
  }

  return {
    run,
    get,
    all,
    exec,
    connect,
    _pool: pool,
    _isPg: true,
    async close() {
      try { await pool.end(); } catch { /* ignore */ }
    },
  };
}

module.exports = { createPgAdapter };
