// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Auto Migration
// Runs on server startup — creates tables if they don't exist
// Uses direct PostgreSQL connection (node-postgres)
// ═══════════════════════════════════════════════════════════════
const { Pool } = require("pg");
const logger = require("./logger");

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    avatar TEXT NOT NULL DEFAULT 'kelion',
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    language TEXT DEFAULT 'ro',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_preferences(user_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own convos') THEN
        CREATE POLICY "Users own convos" ON conversations FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own msgs') THEN
        CREATE POLICY "Users own msgs" ON messages FOR ALL USING (
            conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid() OR user_id IS NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own prefs') THEN
        CREATE POLICY "Users own prefs" ON user_preferences FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'My API Key',
    key TEXT NOT NULL UNIQUE,
    key_preview TEXT NOT NULL,
    rate_limit INTEGER NOT NULL DEFAULT 100,
    request_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

CREATE OR REPLACE FUNCTION increment_api_key_count(key_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE api_keys SET request_count = request_count + 1, last_used_at = now() WHERE id = key_id;
END; $$;

-- ═══ ADMIN LOGS ═══
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    admin_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action, created_at DESC);

-- ═══ TRADES ═══
CREATE TABLE IF NOT EXISTS trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT DEFAULT 'admin',
    asset TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    amount NUMERIC NOT NULL DEFAULT 0,
    price NUMERIC NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'executed',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, created_at DESC);

-- ═══ PROFILES (Face Recognition) ═══
CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    display_name TEXT,
    face_encoding JSONB,
    avatar_url TEXT,
    bio TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);

-- ═══ MEDIA HISTORY (Monitor Activity) ═══
CREATE TABLE IF NOT EXISTS media_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'guest',
    type TEXT NOT NULL,
    url TEXT,
    title TEXT,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
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
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_users_uid ON telegram_users(user_id);

-- ═══ WHATSAPP USERS ═══
CREATE TABLE IF NOT EXISTS whatsapp_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    language TEXT DEFAULT 'ro',
    is_subscribed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone);

-- ═══ WHATSAPP MESSAGES ═══
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    phone TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
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
    created_at TIMESTAMPTZ DEFAULT now()
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
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user ON cookie_consents(user_id);

-- ═══ METRICS SNAPSHOTS (Prometheus/Grafana) ═══
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    metric_type TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value NUMERIC NOT NULL,
    labels JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metrics_snap_type ON metrics_snapshots(metric_type, created_at DESC);

-- ═══ AI COST TRACKING ═══
CREATE TABLE IF NOT EXISTS ai_costs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'guest',
    provider TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_costs_user ON ai_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_costs_date ON ai_costs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_costs_provider ON ai_costs(provider);

-- ═══ PAGE VIEWS (Traffic) ═══
CREATE TABLE IF NOT EXISTS page_views (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ip TEXT,
    path TEXT DEFAULT '/',
    user_agent TEXT,
    country TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views(created_at);

-- ═══ SUBSCRIPTIONS (CRITICĂ — plăți, abonamente, refund) ═══
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ═══ REFERRALS ═══
CREATE TABLE IF NOT EXISTS referrals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    used_by UUID,
    bonus_days INTEGER DEFAULT 0,
    redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);

-- ═══ ADMIN CODES ═══
CREATE TABLE IF NOT EXISTS admin_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'promo',
    value TEXT,
    uses_remaining INTEGER DEFAULT 1,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_codes_code ON admin_codes(code);

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

-- ═══ LEARNED FACTS (AI knowledge base) ═══
CREATE TABLE IF NOT EXISTS learned_facts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'general',
    fact TEXT NOT NULL,
    source TEXT,
    confidence NUMERIC DEFAULT 0.8,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learned_facts_cat ON learned_facts(category);

-- ═══ MESSENGER USERS ═══
CREATE TABLE IF NOT EXISTS messenger_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id TEXT NOT NULL UNIQUE,
    name TEXT,
    language TEXT DEFAULT 'ro',
    character TEXT DEFAULT 'kelion',
    message_count INTEGER DEFAULT 0,
    is_subscribed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messenger_users_sid ON messenger_users(sender_id);

CREATE OR REPLACE FUNCTION increment_messenger_message_count(p_sender_id TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE messenger_users SET message_count = message_count + 1, updated_at = now() WHERE sender_id = p_sender_id;
END; $$;

-- ═══ MESSENGER MESSAGES ═══
CREATE TABLE IF NOT EXISTS messenger_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messenger_messages_sid ON messenger_messages(sender_id, created_at DESC);

-- ═══ MESSENGER SUBSCRIBERS ═══
CREATE TABLE IF NOT EXISTS messenger_subscribers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id TEXT NOT NULL UNIQUE,
    active BOOLEAN DEFAULT true,
    subscribed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messenger_subs_sid ON messenger_subscribers(sender_id);

-- ═══ TELEGRAM MESSAGES ═══
CREATE TABLE IF NOT EXISTS telegram_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat ON telegram_messages(chat_id, created_at DESC);

-- ═══ MARKET CANDLES (Trading — unlimited storage) ═══
CREATE TABLE IF NOT EXISTS market_candles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    open_time TIMESTAMPTZ NOT NULL,
    close_time TIMESTAMPTZ,
    open NUMERIC NOT NULL,
    high NUMERIC NOT NULL,
    low NUMERIC NOT NULL,
    close NUMERIC NOT NULL,
    volume NUMERIC DEFAULT 0,
    ticks INTEGER DEFAULT 0,
    UNIQUE(asset, timeframe, open_time)
);
CREATE INDEX IF NOT EXISTS idx_market_candles_asset ON market_candles(asset, timeframe, open_time DESC);

-- ═══ MARKET LEARNINGS (AI trading adaptive weights) ═══
CREATE TABLE IF NOT EXISTS market_learnings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_learnings_type ON market_learnings(type, created_at DESC);

-- ═══ MARKET PATTERNS (pattern recognition memory) ═══
CREATE TABLE IF NOT EXISTS market_patterns (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset TEXT NOT NULL,
    timeframe TEXT,
    pattern_type TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    outcome TEXT,
    confidence NUMERIC DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_patterns_asset ON market_patterns(asset, pattern_type);
CREATE INDEX IF NOT EXISTS idx_market_patterns_type ON market_patterns(pattern_type, created_at DESC);

-- ═══ BRAIN v3.0 — INTELLIGENCE TABLES ═══

-- User profiling (learned from conversations)
CREATE TABLE IF NOT EXISTS brain_profiles (
    user_id TEXT PRIMARY KEY,
    profession TEXT,
    interests JSONB DEFAULT '[]'::jsonb,
    communication_style TEXT DEFAULT 'neutral',
    expertise_level TEXT DEFAULT 'general',
    top_topics JSONB DEFAULT '[]'::jsonb,
    preferred_languages JSONB DEFAULT '[]'::jsonb,
    emotional_baseline TEXT DEFAULT 'neutral',
    timezone TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Pattern learning (what tools work for which tasks)
CREATE TABLE IF NOT EXISTS brain_learnings (
    pattern_key TEXT PRIMARY KEY,
    complexity TEXT,
    topics TEXT,
    best_tools JSONB DEFAULT '[]'::jsonb,
    success_rate FLOAT DEFAULT 0.5,
    avg_latency INT DEFAULT 0,
    count INT DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Autonomous monitor metrics (health snapshots)
CREATE TABLE IF NOT EXISTS brain_metrics (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT now(),
    uptime_sec INT,
    conversations INT,
    error_rate FLOAT,
    memory_mb INT,
    tool_stats JSONB,
    tool_errors JSONB
);
CREATE INDEX IF NOT EXISTS idx_brain_metrics_ts ON brain_metrics(timestamp DESC);

-- Add user_id column to learned_facts if missing (for per-user facts)
DO $$ BEGIN
    ALTER TABLE learned_facts ADD COLUMN IF NOT EXISTS user_id TEXT;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_learned_facts_user ON learned_facts(user_id);

`;

async function runMigration() {
    // Build connection string from Supabase URL or explicit DB vars
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString && process.env.SUPABASE_URL) {
        // Extract project ref from Supabase URL
        const match = process.env.SUPABASE_URL.match(
            /https:\/\/([^.]+)\.supabase\.co/,
        );
        if (match) {
            const ref = match[1];
            const password =
                process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
            if (!password) {
                logger.warn(
                    { component: "Migration" },
                    "⚠️ No DB password configured — skipping migration",
                );
                return false;
            }
            connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
        }
    }

    if (!connectionString) {
        logger.warn(
            { component: "Migration" },
            "⚠️ No database connection — skipping migration",
        );
        return false;
    }

    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
    });

    try {
        logger.info({ component: "Migration" }, "🔄 Running database migration...");
        await pool.query(MIGRATION_SQL);
        logger.info({ component: "Migration" }, "✅ CREATE TABLE IF NOT EXISTS — all 35+ tables processed");

        // ── POST-MIGRATION: Verify every table actually works ──
        const ALL_TABLES = [
            "conversations", "messages", "user_preferences", "api_keys",
            "admin_logs", "trades", "profiles", "media_history",
            "telegram_users", "whatsapp_users", "whatsapp_messages",
            "trade_intelligence", "cookie_consents", "metrics_snapshots",
            "ai_costs", "page_views", "subscriptions", "referrals",
            "admin_codes", "brain_memory", "learned_facts",
            "messenger_users", "messenger_messages", "messenger_subscribers",
            "telegram_messages", "market_candles", "market_learnings", "market_patterns",
            "brain_profiles", "brain_learnings", "brain_metrics",
        ];

        const healthy = [];
        const broken = [];

        for (const table of ALL_TABLES) {
            try {
                const result = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table} LIMIT 1`);
                const count = parseInt(result.rows[0]?.cnt || "0", 10);
                healthy.push({ table, rows: count });
            } catch (e) {
                broken.push({ table, error: e.message.substring(0, 100) });
            }
        }

        if (broken.length > 0) {
            logger.warn(
                { component: "Migration", broken },
                `⚠️ ${broken.length} tables BROKEN: ${broken.map(b => b.table).join(", ")}`,
            );
        }
        logger.info(
            { component: "Migration", healthy: healthy.length, broken: broken.length },
            `✅ Health check: ${healthy.length} OK, ${broken.length} broken out of ${ALL_TABLES.length} tables`,
        );

        return true;
    } catch (e) {
        logger.error(
            { component: "Migration", err: e.message },
            "❌ Migration failed",
        );
        logger.warn(
            { component: "Migration" },
            "⚠️ Server will continue without persistent storage",
        );
        return false;
    } finally {
        await pool.end();
    }
}

module.exports = { runMigration };
