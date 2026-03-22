const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in server/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMemory() {
  const { data, error } = await supabase
    .from('brain_admin_sessions')
    .select('*')
    .eq('session_id', 'admin-k1-master-session-002');
    
  if (error) {
    console.error("Error fetching memory:", error);
  } else {
    console.log("=== MEMORY PERSISTENCE CHECK ===");
    if(data && data.length > 0) {
       console.log("Memory Array Length:", data[0].history ? data[0].history.length : 0);
       console.log("Last Message Saved:", JSON.stringify(data[0].history[data[0].history.length - 1], null, 2));
    } else {
       console.log("No memory found for session.");
    }
  }
}

checkMemory();
