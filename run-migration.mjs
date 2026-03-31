import mysql from 'mysql2/promise';

async function run() {
  console.log('Running migration...');
  const url = process.env.DATABASE_URL;
  const conn = await mysql.createConnection(url);
  
  try {
    // Add trial columns to users
    try {
      await conn.execute(`ALTER TABLE users ADD COLUMN trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
      console.log('  Added trial_start_date');
    } catch(e) { console.log('  trial_start_date already exists or error:', e.message); }
    
    try {
      await conn.execute(`ALTER TABLE users ADD COLUMN trial_expired BOOLEAN DEFAULT FALSE`);
      console.log('  Added trial_expired');
    } catch(e) { console.log('  trial_expired already exists or error:', e.message); }
    
    // Create daily_usage table
    await conn.execute(`CREATE TABLE IF NOT EXISTS daily_usage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      date VARCHAR(10) NOT NULL,
      minutes_used INT DEFAULT 0 NOT NULL,
      messages_count INT DEFAULT 0 NOT NULL,
      last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    console.log('  Created daily_usage table');
    
    console.log('Migration complete!');
  } finally {
    await conn.end();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
