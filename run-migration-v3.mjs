import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

async function run() {
  const conn = await mysql.createConnection(DATABASE_URL);
  
  const sqls = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_closed BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_closed_at TIMESTAMP NULL`,
  ];

  for (const sql of sqls) {
    try {
      await conn.execute(sql);
      console.log('OK:', sql.substring(0, 60));
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.message?.includes('Duplicate column')) {
        console.log('SKIP (exists):', sql.substring(0, 60));
      } else {
        console.error('FAIL:', sql.substring(0, 60), err.message);
      }
    }
  }

  await conn.end();
  console.log('Migration v3 done');
}

run().catch(console.error);
