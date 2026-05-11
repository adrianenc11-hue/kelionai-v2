'use strict';

const { initDb } = require('./db');
require('dotenv').config({ path: './server/.env' });

async function checkDb() {
  console.log('=== DB HEALTH CHECK ===');
  try {
    const db = await initDb();
    const res = await db.get('SELECT CURRENT_TIMESTAMP as now');
    console.log('✅ DB Connected:', res.now);
    
    // Check tables
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);
    console.log('Tables found:', tableNames.join(', '));
    
    const requiredTables = ['users', 'voice_clones', 'memory_items', 'credit_transactions'];
    for (const table of requiredTables) {
      if (tableNames.includes(table)) {
        console.log(`✅ ${table} table exists`);
      } else {
        console.warn(`⚠️ ${table} table MISSING`);
      }
    }
  } catch (err) {
    console.error('❌ DB Connection FAILED:', err.message);
  }
}

checkDb().catch(console.error);
