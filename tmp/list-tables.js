const { Pool } = require('pg');
require('dotenv').config();
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const pool = new Pool({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false }
});
pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
  .then(r => { console.log(r.rows.length + ' tables:'); r.rows.forEach(x => console.log('  ' + x.table_name)); pool.end(); })
  .catch(e => { console.log('ERR:', e.message); pool.end(); });
