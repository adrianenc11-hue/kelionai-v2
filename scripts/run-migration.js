// Run pgvector migration via Supabase Management API
// Usage: node run-migration.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Set SUPABASE_URL and SUPABASE_SERVICE_KEY in environment');
  process.exit(1);
}

const sql = fs.readFileSync(path.join(__dirname, 'migrations', '004_pgvector_integral_memory.sql'), 'utf8');

// Split SQL by semicolons, filter empty
const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 5);

async function run() {
  console.log(`🚀 Running ${statements.length} SQL statements against ${SUPABASE_URL}...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    process.stdout.write(`[${i + 1}/${statements.length}] ${preview}... `);

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ query: stmt }),
      });

      if (r.ok) {
        console.log('✅');
      } else {
        // Try direct SQL via pg endpoint
        const r2 = await fetch(`${SUPABASE_URL}/pg/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ query: stmt + ';' }),
        });
        if (r2.ok) {
          console.log('✅');
        } else {
          const err = await r2.text().catch(() => '');
          console.log(`⚠️ ${r2.status} — ${err.substring(0, 100)}`);
        }
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
  }
  console.log('\n🏁 Migration complete!');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
