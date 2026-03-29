-- ═══════════════════════════════════════════════════════════════
-- KelionAI v2.3 — FULL DATABASE SCHEMA (Supabase)
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ═══ CONVERSATIONS ═══
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    avatar TEXT DEFAULT 'kelion',
    title TEXT,
    language TEXT DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- ═══ MESSAGES ═══
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    source TEXT DEFAULT 'web',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- ═══ USER PREFERENCES (Memory) ═══
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_prefs_user ON user_preferences(user_id);

-- ═══ SUBSCRIPTIONS (Stripe) ═══
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'premium', 'enterprise')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cancelled', 'canceled', 'past_due')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    source TEXT DEFAULT 'stripe',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions(status);

-- ═══ USAGE TRACKING ═══
-- user_id is TEXT (not UUID) to support both authenticated users (UUID) and guests (literal 'guest')
CREATE TABLE IF NOT EXISTS usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL, -- UUID for authenticated users, 'guest' for unauthenticated users
    type TEXT NOT NULL CHECK (type IN ('chat', 'search', 'image', 'vision', 'tts')),
    date DATE DEFAULT CURRENT_DATE,
    count INTEGER DEFAULT 0,
    UNIQUE(user_id, type, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, date);

-- ═══ REFERRALS (legacy — kept for backward compat, no longer used for new codes) ═══
CREATE TABLE IF NOT EXISTS referrals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    redeemed_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON referrals(user_id);

-- ═══ REFERRAL CODES v2 (HMAC-signed, relational) ═══
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    code_hash TEXT NOT NULL,
    recipient_email TEXT,
    recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'pending_send', 'sent', 'redeemed', 'expired', 'revoked')),
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    redeemed_at TIMESTAMPTZ,
    redeemed_via TEXT,
    sender_bonus_days INTEGER DEFAULT 0,
    receiver_bonus_days INTEGER DEFAULT 0,
    sender_bonus_applied BOOLEAN DEFAULT FALSE,
    receiver_bonus_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refcodes_sender ON referral_codes(sender_id);
CREATE INDEX IF NOT EXISTS idx_refcodes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_refcodes_hash ON referral_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_refcodes_status ON referral_codes(status);
CREATE INDEX IF NOT EXISTS idx_refcodes_recipient ON referral_codes(recipient_email);
CREATE INDEX IF NOT EXISTS idx_refcodes_expires ON referral_codes(expires_at);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_referral_codes"
    ON referral_codes FOR ALL
    USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- ═══ WEBHOOK IDEMPOTENCY (persistent across restarts) ═══
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_date ON processed_webhook_events(processed_at);
-- Cleanup: DELETE FROM processed_webhook_events WHERE processed_at < NOW() - INTERVAL '30 days';

-- ═══ BRAIN LEARNINGS ═══
CREATE TABLE IF NOT EXISTS brain_learnings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    category TEXT,
    lesson TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learnings_user ON brain_learnings(user_id);

-- ═══ BRAIN MEMORY (AI persistent memory) ═══
CREATE TABLE IF NOT EXISTS brain_memory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    memory_type TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    importance NUMERIC DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_memory_user ON brain_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_memory_type ON brain_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_brain_memory_date ON brain_memory(created_at DESC);

ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check;
ALTER TABLE brain_memory ADD CONSTRAINT brain_memory_memory_type_check
  CHECK (memory_type IN ('general', 'conversation', 'fact', 'preference', 'skill', 'emotion', 'context', 'system', 'golden_knowledge', 'write_lesson', 'file_write', 'scheduled_task'));

-- ═══ AUTO-UPDATE updated_at ═══
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conversations_updated') THEN
        CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_subscriptions_updated') THEN
        CREATE TRIGGER trg_subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prefs_updated') THEN
        CREATE TRIGGER trg_prefs_updated BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END;
$$;

-- ═══ ROW LEVEL SECURITY ═══
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY IF NOT EXISTS "users_own_conversations" ON conversations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_messages" ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY IF NOT EXISTS "users_own_prefs" ON user_preferences FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_subs" ON subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "users_own_referrals" ON referrals FOR ALL USING (auth.uid() = user_id);

-- Service role bypasses RLS (used by server)
-- This is automatic with supabaseAdmin client

-- ═══ CLEANUP: Auto-delete old guest usage (>30 days) ═══
-- Run periodically via Supabase cron or pg_cron
-- SELECT cron.schedule('cleanup-guest-usage', '0 3 * * *', $$DELETE FROM usage WHERE user_id = 'guest' AND date < CURRENT_DATE - INTERVAL '30 days'$$);

COMMENT ON TABLE subscriptions IS 'Stripe subscription tracking — plans: free, pro (€9.99), premium (€19.99)';
COMMENT ON TABLE usage IS 'Daily usage counters per user — limits: guest(5/3/1), free(10/5/2), pro(100/50/20), premium(unlimited)';
COMMENT ON TABLE referrals IS 'Referral codes KEL-XXXXXX — both users get 7 days Pro';

-- ═══ NEWS CACHE ═══
CREATE TABLE IF NOT EXISTS news_cache (
    id TEXT PRIMARY KEY DEFAULT 'latest',
    data JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ ADMIN LOGS ═══
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',
    source TEXT DEFAULT 'chat',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);

-- ═══ ADMIN CODES ═══
CREATE TABLE IF NOT EXISTS admin_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'promo',
    value TEXT,
    uses_remaining INTEGER DEFAULT 1,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_codes_code ON admin_codes(code);

-- ═══ TRADES ═══
CREATE TABLE IF NOT EXISTS trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity DECIMAL,
    price DECIMAL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed', 'cancelled')),
    exchange TEXT DEFAULT 'binance',
    order_id TEXT,
    pnl DECIMAL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);

-- ═══ PROFILES (Face Recognition / Identity) ═══
CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    display_name TEXT,
    role TEXT DEFAULT 'user',
    face_reference TEXT,
    preferred_language TEXT DEFAULT 'en',
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_profiles" ON profiles FOR ALL USING (auth.uid() = user_id);

-- ═══ API KEYS (Developer Access) ═══
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    name TEXT DEFAULT 'Default',
    permissions JSONB DEFAULT '{"chat": true, "search": true}',
    rate_limit INTEGER DEFAULT 100,
    request_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_api_keys" ON api_keys FOR ALL USING (auth.uid() = user_id);

-- ═══ MEDIA HISTORY (Monitor Activity Log) ═══
CREATE TABLE IF NOT EXISTS media_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'guest',
    type TEXT NOT NULL CHECK (type IN ('url', 'radio', 'video', 'webNav', 'image', 'map')),
    url TEXT,
    title TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_history_user ON media_history(user_id);
CREATE INDEX IF NOT EXISTS idx_media_history_type ON media_history(type);
CREATE INDEX IF NOT EXISTS idx_media_history_created ON media_history(created_at DESC);

-- ═══ TELEGRAM USERS ═══
CREATE TABLE IF NOT EXISTS telegram_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    language TEXT DEFAULT 'ro',
    chat_id TEXT,
    is_subscribed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_users_uid ON telegram_users(user_id);

-- ═══ WHATSAPP USERS ═══
CREATE TABLE IF NOT EXISTS whatsapp_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    language TEXT DEFAULT 'ro',
    is_subscribed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone);

-- ═══ WHATSAPP MESSAGES ═══
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone, created_at DESC);

-- ═══ TRADE INTELLIGENCE ═══
CREATE TABLE IF NOT EXISTS trade_intelligence (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset TEXT NOT NULL DEFAULT 'BTC',
    analysis_type TEXT NOT NULL,
    result JSONB DEFAULT '{}',
    sentiment_score NUMERIC DEFAULT 0,
    confidence NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_intel_asset ON trade_intelligence(asset, created_at DESC);

-- ═══ COOKIE CONSENTS (GDPR) ═══
CREATE TABLE IF NOT EXISTS cookie_consents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    session_id TEXT,
    functional BOOLEAN DEFAULT true,
    analytics BOOLEAN DEFAULT false,
    marketing BOOLEAN DEFAULT false,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user ON cookie_consents(user_id);

-- ═══ METRICS SNAPSHOTS (Prometheus/Grafana) ═══
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    metric_type TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value NUMERIC NOT NULL,
    labels JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metrics_snap_type ON metrics_snapshots(metric_type, created_at DESC);

-- ═══ PAYMENTS (Stripe invoice records) ═══
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'eur',
    plan TEXT,
    status TEXT DEFAULT 'completed',
    stripe_payment_intent_id TEXT,
    stripe_invoice_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- ═══ CLONED VOICES (ElevenLabs voice cloning) ═══
CREATE TABLE IF NOT EXISTS cloned_voices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    elevenlabs_voice_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    sample_duration_sec INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloned_voices_user ON cloned_voices(user_id);

-- ═══ CHAT FEEDBACK (thumbs up/down) ═══
CREATE TABLE IF NOT EXISTS chat_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    conversation_id UUID,
    message_index INTEGER DEFAULT 0,
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_conv ON chat_feedback(conversation_id);

-- ═══ SYSTEM MONITOR (health snapshots) ═══
CREATE TABLE IF NOT EXISTS system_monitor (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    snapshot JSONB DEFAULT '{}',
    health_score NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_monitor_created ON system_monitor(created_at DESC);

-- ═══ PAGE VIEWS (analytics) ═══
CREATE TABLE IF NOT EXISTS page_views (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ip TEXT,
    path TEXT,
    user_agent TEXT,
    country TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_views_ip ON page_views(ip);

-- ═══ AI COSTS (provider cost tracking) ═══
CREATE TABLE IF NOT EXISTS ai_costs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT,
    cost_usd NUMERIC DEFAULT 0,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_costs_provider ON ai_costs(provider);
CREATE INDEX IF NOT EXISTS idx_ai_costs_created ON ai_costs(created_at DESC);

-- ═══ VISITORS (fingerprint-based tracking) ═══
CREATE TABLE IF NOT EXISTS visitors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    ip TEXT,
    country TEXT,
    city TEXT,
    device TEXT,
    browser TEXT,
    os TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    language TEXT,
    timezone TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    pages_visited JSONB DEFAULT '[]',
    total_visits INTEGER DEFAULT 1,
    total_time_sec INTEGER DEFAULT 0,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'potential',
    converted_user_id UUID,
    notes TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint ON visitors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(status);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC);

-- ═══ LEARNED FACTS (Brain AI knowledge) ═══
CREATE TABLE IF NOT EXISTS learned_facts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    fact TEXT NOT NULL,
    category TEXT,
    source TEXT,
    confidence NUMERIC DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learned_facts_user ON learned_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_learned_facts_confidence ON learned_facts(confidence DESC);

-- ═══ PROCEDURAL MEMORY (Brain learned procedures) ═══
CREATE TABLE IF NOT EXISTS procedural_memory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    procedure_name TEXT NOT NULL,
    steps JSONB DEFAULT '[]',
    last_used TIMESTAMPTZ DEFAULT NOW(),
    success_rate NUMERIC DEFAULT 0,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_procedural_memory_user ON procedural_memory(user_id);

-- ═══ TENANTS (multi-tenancy) ═══
CREATE TABLE IF NOT EXISTS tenants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    domain TEXT UNIQUE,
    name TEXT,
    is_active BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);

-- ═══ CONTACT MESSAGES ═══
CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Anonymous',
    email TEXT NOT NULL,
    subject TEXT DEFAULT 'No subject',
    message TEXT NOT NULL,
    ref_number TEXT UNIQUE NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_email ON contact_messages(email);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at DESC);

-- ═══ RPC FUNCTIONS ═══

-- Atomically increment visitor time
CREATE OR REPLACE FUNCTION increment_visitor_time(fp TEXT, secs INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE visitors SET total_time_sec = total_time_sec + secs, last_seen = NOW()
    WHERE fingerprint = fp;
END;
$$ LANGUAGE plpgsql;

-- Atomically increment API key request count
CREATE OR REPLACE FUNCTION increment_api_key_count(key_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE api_keys SET request_count = COALESCE(request_count, 0) + 1, last_used_at = NOW()
    WHERE id = key_id;
END;
$$ LANGUAGE plpgsql;

-- ═══ RLS — Service-role only tables ═══
-- These tables are accessed exclusively by the server (supabaseAdmin / service_role).
-- RLS is enabled with explicit deny-all policies, so anon/authenticated roles are blocked.
-- Service_role bypasses RLS automatically.

ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE cookie_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloned_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_monitor ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE learned_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedural_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all policies (blocks anon + authenticated)
CREATE POLICY IF NOT EXISTS "service_only" ON processed_webhook_events FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON brain_learnings FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON news_cache FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON admin_logs FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON trades FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON media_history FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON telegram_users FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON whatsapp_users FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON whatsapp_messages FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON trade_intelligence FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON cookie_consents FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON metrics_snapshots FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON payments FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON chat_feedback FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON system_monitor FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON page_views FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON ai_costs FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON visitors FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON learned_facts FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON procedural_memory FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON tenants FOR ALL USING (false);

-- Users own cloned_voices
CREATE POLICY IF NOT EXISTS "users_own_cloned_voices" ON cloned_voices FOR ALL USING (auth.uid() = user_id);

-- FK: brain_learnings.user_id → auth.users
ALTER TABLE brain_learnings
    ADD CONSTRAINT fk_brain_learnings_user
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
