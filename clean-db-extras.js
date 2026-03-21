require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
async function run() {
  console.log('Deleting extra attack data...');
  const paths = ['/.aws/credentials', '/config.phpinfo', '/_profiler/phpinfo', '/phpinfo', '/env', '/robots.txt'];
  for (const p of paths) {
    await supabase.from('visitors').delete().eq('path', p);
  }
  console.log('Done cleaning extra attacks.');
}
run();
