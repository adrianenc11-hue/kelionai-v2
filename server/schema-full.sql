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
    language TEXT DEFAULT 'ro',
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
    language TEXT DEFAULT 'ro',
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
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cancelled', 'past_due')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
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
