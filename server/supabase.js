'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

// ── Fallback: no Supabase credentials ──
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_KEY) {
  const logFn = process.env.NODE_ENV === 'production' ? logger.warn : logger.info;
  logFn.call(logger, { component: 'Supabase' }, '⚠️ SUPABASE_URL/ANON_KEY/SERVICE_KEY lipsesc — DB disabled');

  // Stub getUserFromToken that always returns null (guest mode)
  async function getUserFromToken(req) {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) return null;
    return null; // No DB — treat as guest
  }

  module.exports = { supabase: null, supabaseAdmin: null, getUserFromToken };
} else {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  logger.info({ component: 'Supabase' }, '✅ Client și admin inițializați');

  /**
   * Extract and verify a Supabase JWT from the Authorization header.
   * Returns the user object or null if invalid/expired.
   */
  async function getUserFromToken(req) {
    try {
      const auth = req.headers['authorization'] || '';
      if (!auth.startsWith('Bearer ')) return null;

      const token = auth.slice(7).trim();
      if (!token) return null;

      // Use supabaseAdmin to get user — bypasses RLS, works with service key
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data?.user) {
        // Check if token expired
        if (error?.message?.toLowerCase().includes('expired')) {
          return { _tokenExpired: true };
        }
        return null;
      }

      return data.user;
    } catch (err) {
      logger.debug({ component: 'Supabase', err: err.message }, 'getUserFromToken error');
      return null;
    }
  }

  module.exports = { supabase, supabaseAdmin, getUserFromToken };
}