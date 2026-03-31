import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const url = new URL(DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: parseInt(url.port) || 4000,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  // Referral codes table
  `CREATE TABLE IF NOT EXISTS referral_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    sender_user_id INT NOT NULL,
    recipient_email VARCHAR(320) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_by INT DEFAULT NULL,
    used_at TIMESTAMP DEFAULT NULL,
    bonus_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  // Refund status enum not needed in MySQL, just use varchar
  // Refund requests table
  `CREATE TABLE IF NOT EXISTS refund_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    stripe_subscription_id VARCHAR(255),
    billing_cycle VARCHAR(10) NOT NULL,
    subscription_start_date TIMESTAMP DEFAULT NULL,
    months_elapsed INT DEFAULT 0,
    refund_amount DECIMAL(10,2) DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    reason TEXT,
    admin_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP DEFAULT NULL
  )`,
  // Add subscription_start_date and billing_cycle to users if not exists
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(10) DEFAULT 'monthly'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_bonus_days INT DEFAULT 0`,
];

for (const sql of migrations) {
  try {
    await conn.execute(sql);
    console.log("OK:", sql.slice(0, 60) + "...");
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message?.includes('Duplicate column')) {
      console.log("SKIP (already exists):", sql.slice(0, 60) + "...");
    } else {
      console.error("FAIL:", sql.slice(0, 60), err.message);
    }
  }
}

await conn.end();
console.log("Migration v2 complete!");
