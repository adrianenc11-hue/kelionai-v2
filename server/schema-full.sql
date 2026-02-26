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
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
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
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'premium')),
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
CREATE TABLE IF NOT EXISTS usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('chat', 'search', 'image', 'vision', 'tts')),
    date DATE DEFAULT CURRENT_DATE,
    count INTEGER DEFAULT 0,
    UNIQUE(user_id, type, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, date);

-- ═══ REFERRALS ═══
CREATE TABLE IF NOT EXISTS referrals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL,
    redeemed_by JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON referrals(user_id);

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

-- ═══ EVENTS (Birthday & Events Tracker) ═══
CREATE TABLE IF NOT EXISTS events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    event_date DATE NOT NULL,
    type TEXT DEFAULT 'birthday',
    recurring BOOLEAN DEFAULT true,
    notes TEXT,
    reminder_days INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_events" ON events FOR ALL USING (auth.uid() = user_id);

-- ═══ JOURNAL ENTRIES (Daily Journal) ═══
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    mood INTEGER NOT NULL CHECK (mood >= 1 AND mood <= 10),
    best_moment TEXT,
    improvements TEXT,
    goals TEXT,
    free_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "users_own_journal" ON journal_entries FOR ALL USING (auth.uid() = user_id);
