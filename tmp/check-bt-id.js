const { Pool } = require('pg');
require('dotenv').config();
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const pool = new Pool({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  // Check brain_tools id column type
  const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='brain_tools' AND column_name='id'");
  console.log('brain_tools.id type:', r.rows[0]?.data_type);
  
  // Check if any rows exist
  const cnt = await pool.query("SELECT count(*) as c FROM brain_tools");
  console.log('brain_tools rows:', cnt.rows[0].c);
  
  await pool.end();
})();
