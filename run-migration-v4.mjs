import postgres from 'postgres';

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('SUPABASE_DATABASE_URL or DATABASE_URL not set');
  process.exit(1);
}

async function run() {
  const sql = postgres(DATABASE_URL, { ssl: 'require' });

  const sqls = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1`,
  ];

  for (const query of sqls) {
    try {
      await sql.unsafe(query);
      console.log('OK:', query.substring(0, 80));
    } catch (err) {
      if (err.message?.includes('already exists') || err.code === '42701') {
        console.log('SKIP (exists):', query.substring(0, 80));
      } else {
        console.error('FAIL:', query.substring(0, 80), err.message);
      }
    }
  }

  await sql.end();
  console.log('Migration v4 done');
}

run().catch(console.error);
