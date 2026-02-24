const { createClient } = require('@supabase/supabase-js');
let supabase = null, supabaseAdmin = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('[Supabase] ✅ Client init');
}
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[Supabase] ✅ Admin init');
}
module.exports = { supabase, supabaseAdmin };
