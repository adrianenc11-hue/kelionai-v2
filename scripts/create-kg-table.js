// Create knowledge_graph table in Supabase
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function createTable() {
  // Try to insert a dummy row — if table doesn't exist, Supabase returns error
  const { error: testError } = await supabase.from('knowledge_graph').select('id').limit(1);

  if (testError && testError.message.includes('does not exist')) {
    console.log('Table does not exist. Please create it via Supabase Dashboard SQL Editor:');
    console.log(`
CREATE TABLE IF NOT EXISTS knowledge_graph (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_from TEXT NOT NULL,
  entity_to TEXT NOT NULL,
  relationship TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.8,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, entity_from, entity_to, relationship)
);
CREATE INDEX IF NOT EXISTS idx_kg_user_id ON knowledge_graph(user_id);
CREATE INDEX IF NOT EXISTS idx_kg_entity_from ON knowledge_graph(entity_from);
    `);

    // Try via RPC if available
    const { error: rpcError } = await supabase.rpc('exec_sql', {
      sql: `CREATE TABLE IF NOT EXISTS knowledge_graph (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        user_id TEXT NOT NULL,
        entity_from TEXT NOT NULL,
        entity_to TEXT NOT NULL,
        relationship TEXT NOT NULL,
        confidence FLOAT DEFAULT 0.8,
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, entity_from, entity_to, relationship)
      );`,
    });

    if (rpcError) {
      console.log('RPC not available. Creating via direct REST...');
      // Alternative: use fetch to hit Supabase SQL endpoint
      const _resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/`, {
        method: 'GET',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }).catch(() => null);
      console.log('Manual SQL needed. Copy the SQL above into Supabase Dashboard → SQL Editor.');
    } else {
      console.log('✅ knowledge_graph table created!');
    }
  } else if (!testError) {
    console.log('✅ knowledge_graph table already exists!');
  } else {
    console.log('Error:', testError.message);
  }
}

createTable().catch((e) => console.error(e));
