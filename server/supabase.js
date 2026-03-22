const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

if (!process.env.SUPABASE_URL) {
  throw new Error('SUPABASE_URL lipsește');
}
if (!process.env.SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_ANON_KEY lipsește');
}
if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_KEY lipsește');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

logger.info({ component: 'Supabase' }, '✅ Client și admin inițializați');

module.exports = { supabase, supabaseAdmin };
