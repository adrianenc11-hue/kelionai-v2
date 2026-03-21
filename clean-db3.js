require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
async function run() {
  console.log('Deleting attack data from visitors table...');
  const { data: d1, error: e1 } = await supabase.from('visitors').delete().like('path', '%.php%');
  const { data: d2, error: e2 } = await supabase.from('visitors').delete().like('path', '%.ini%');
  const { data: d3, error: e3 } = await supabase.from('visitors').delete().like('path', '%.env%');
  const { data: d4, error: e4 } = await supabase.from('visitors').delete().like('path', '%/.git%');
  console.log('Done cleaning attacks.');
}
run();
