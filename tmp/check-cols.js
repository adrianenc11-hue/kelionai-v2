const { Pool } = require('pg');
require('dotenv').config();
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const pool = new Pool({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Check brain_tools columns
  const bt = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='brain_tools' ORDER BY ordinal_position");
  console.log('brain_tools columns:', bt.rows.map(r => r.column_name).join(', '));

  // Check marketplace_agents columns
  const ma = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='marketplace_agents' ORDER BY ordinal_position");
  console.log('marketplace_agents columns:', ma.rows.map(r => r.column_name).join(', '));

  await pool.end();
})();
