// Debug: test which CREATE TABLE statements fail
const { Pool } = require('pg');
require('dotenv').config();

const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const password = process.env.DB_PASSWORD;
const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });

const tables = [
  'market_patterns', 'brain_profiles', 'brain_learnings', 'brain_metrics',
  'brain_tools', 'brain_usage', 'brain_projects', 'brain_procedures',
  'marketplace_agents', 'user_installed_agents', 'brain_plugins',
  'autonomous_tasks', 'tenants', 'brain_admin_sessions',
  'chat_feedback', 'payments', 'generated_documents', 'cloned_voices'
];

(async () => {
  // First check which tables exist
  for (const t of tables) {
    try {
      await pool.query(`SELECT 1 FROM ${t} LIMIT 0`);
      console.log(`[EXISTS] ${t}`);
    } catch (e) {
      console.log(`[MISSING] ${t}`);
    }
  }

  // Try creating a simple table to test permissions
  console.log('\n--- Testing simple CREATE TABLE ---');
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS _test_perm (id SERIAL PRIMARY KEY)`);
    console.log('[OK] Simple table creation works');
    await pool.query(`DROP TABLE IF EXISTS _test_perm`);
  } catch (e) {
    console.log(`[FAIL] ${e.message}`);
  }

  // Try creating market_patterns (no FK references)
  console.log('\n--- Testing market_patterns ---');
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS market_patterns (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      asset TEXT NOT NULL,
      timeframe TEXT,
      pattern_type TEXT NOT NULL,
      context JSONB DEFAULT '{}',
      outcome TEXT,
      confidence NUMERIC DEFAULT 0.5,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
    console.log('[OK] market_patterns created');
  } catch (e) {
    console.log(`[FAIL] ${e.message}`);
  }

  // Try marketplace_agents (has FK to auth.users)
  console.log('\n--- Testing marketplace_agents (has auth.users FK) ---');
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_agents (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name TEXT NOT NULL,
      persona TEXT NOT NULL,
      creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
    console.log('[OK] marketplace_agents with FK');
  } catch (e) {
    console.log(`[FAIL with FK] ${e.message}`);
    // Try without FK
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS marketplace_agents (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        creator_id UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      )`);
      console.log('[OK] marketplace_agents WITHOUT FK');
    } catch (e2) {
      console.log(`[FAIL without FK] ${e2.message}`);
    }
  }

  await pool.end();
})();
