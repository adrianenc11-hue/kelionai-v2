import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

let _supabase: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceKey) return null;
  if (!_supabase) {
    _supabase = createClient(ENV.supabaseUrl, ENV.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _supabase;
}
