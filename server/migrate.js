// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Auto Migration
// Runs on server startup — creates tables if they don't exist
// Uses direct PostgreSQL connection (node-postgres)
// ═══════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const logger = require('./logger');
const { API_ENDPOINTS } = require('./config/models');

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
    language TEXT DEFAULT 'en',
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

-- Add missing columns for face recognition + admin role
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS face_reference TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 100;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- ═══ USAGE TRACKING (per-user/fingerprint daily quotas) ═══
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    identifier TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'chat',
    count INTEGER DEFAULT 1,
    date TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(identifier, type, date)
);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_id ON usage_tracking(identifier, type, date);

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

-- Remove restrictive memory_type constraint (brain can use any type)
ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check;

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

-- ═══ BRAIN TOOLS REGISTRY (central engine — all external endpoints) ═══
CREATE TABLE IF NOT EXISTS brain_tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT DEFAULT 'POST',
    auth_type TEXT DEFAULT 'api_key',
    auth_env_key TEXT,
    priority INT DEFAULT 1,
    fallback_tool_id TEXT,
    is_active BOOLEAN DEFAULT true,
    cost_per_call NUMERIC DEFAULT 0,
    success_rate FLOAT DEFAULT 1.0,
    avg_latency_ms INT DEFAULT 0,
    total_calls INT DEFAULT 0,
    total_errors INT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fix brain_tools columns if table existed with old schema
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'api_key';
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS auth_env_key TEXT;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS priority INT DEFAULT 1;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS fallback_tool_id TEXT;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS cost_per_call NUMERIC DEFAULT 0;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS success_rate FLOAT DEFAULT 1.0;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS avg_latency_ms INT DEFAULT 0;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS total_calls INT DEFAULT 0;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS total_errors INT DEFAULT 0;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS rate_limit INTEGER NOT NULL DEFAULT 100;
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS endpoint TEXT NOT NULL DEFAULT '';
ALTER TABLE brain_tools ADD COLUMN IF NOT EXISTS method TEXT DEFAULT 'POST';

CREATE INDEX IF NOT EXISTS idx_brain_tools_cat ON brain_tools(category, priority);

-- Seed brain tools (ON CONFLICT = skip if already exists)
INSERT INTO brain_tools (id, name, category, endpoint, method, auth_type, auth_env_key, priority, fallback_tool_id, config) VALUES
    ('serper_search', 'Google Search (Serper)', 'search', '${API_ENDPOINTS.SERPER}/search', 'POST', 'api_key', 'SERPER_API_KEY', 1, 'tavily_search', '{"header":"X-API-KEY"}'),
    ('tavily_search', 'Tavily Search', 'search', '${API_ENDPOINTS.TAVILY}/search', 'POST', 'api_key', 'TAVILY_API_KEY', 2, 'perplexity_search', '{}'),
    ('perplexity_search', 'Perplexity Search', 'search', '${API_ENDPOINTS.PERPLEXITY}/chat/completions', 'POST', 'bearer', 'PERPLEXITY_API_KEY', 3, NULL, '{}'),
    ('open_meteo_geo', 'OpenMeteo Geocoding', 'weather', '${API_ENDPOINTS.OPEN_METEO_GEO}/search', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('open_meteo_forecast', 'OpenMeteo Forecast', 'weather', '${API_ENDPOINTS.OPEN_METEO}/forecast', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('open_meteo_reverse', 'OpenMeteo Reverse Geo', 'weather', '${API_ENDPOINTS.OPEN_METEO_GEO}/reverse', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('ip_api', 'IP Geolocation', 'geo', '${API_ENDPOINTS.IP_API}', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('youtube_search', 'YouTube Search', 'media', '${API_ENDPOINTS.YOUTUBE}/results', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('youtube_embed', 'YouTube Embed', 'media', '${API_ENDPOINTS.YOUTUBE}/embed', 'GET', 'none', NULL, 1, NULL, '{}'),
    ('google_search', 'Google Web Search', 'search', '${API_ENDPOINTS.GOOGLE_SEARCH}', 'GET', 'none', NULL, 4, NULL, '{}'),
    ('google_maps', 'Google Maps Embed', 'maps', '${API_ENDPOINTS.GOOGLE_MAPS}/place', 'GET', 'api_key', 'GOOGLE_MAPS_KEY', 1, 'openstreetmap', '{}'),
    ('openstreetmap', 'OpenStreetMap Search', 'maps', '${API_ENDPOINTS.OSM}/search', 'GET', 'none', NULL, 2, NULL, '{}'),
    ('newsdata_api', 'NewsData.io', 'news', '${API_ENDPOINTS.NEWSDATA}/news', 'GET', 'api_key', 'NEWSDATA_API_KEY', 1, NULL, '{}')
ON CONFLICT (id) DO NOTHING;

-- ═══ BRAIN USAGE (quota per user per month) ═══
CREATE TABLE IF NOT EXISTS brain_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    month TEXT NOT NULL,
    message_count INT DEFAULT 0,
    tool_calls INT DEFAULT 0,
    tokens_used INT DEFAULT 0,
    cost_usd NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_brain_usage_user ON brain_usage(user_id, month);

-- ═══ BRAIN PROJECTS (Project Memory — what projects the user has) ═══
CREATE TABLE IF NOT EXISTS brain_projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    tech_stack JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'active',
    notes TEXT,
    files_touched JSONB DEFAULT '[]'::jsonb,
    last_activity TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_brain_projects_user ON brain_projects(user_id, last_activity DESC);

-- ═══ BRAIN PROCEDURES (Procedural Memory — how tasks were solved) ═══
CREATE TABLE IF NOT EXISTS brain_procedures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'global',
    task_type TEXT NOT NULL,
    task_description TEXT NOT NULL,
    solution_steps JSONB DEFAULT '[]'::jsonb,
    tools_used JSONB DEFAULT '[]'::jsonb,
    success BOOLEAN DEFAULT true,
    duration_ms INT DEFAULT 0,
    complexity TEXT DEFAULT 'medium',
    reuse_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brain_procedures_type ON brain_procedures(task_type, success);
CREATE INDEX IF NOT EXISTS idx_brain_procedures_user ON brain_procedures(user_id, created_at DESC);

-- ═══ TIER 1: AGENT MARKETPLACE ═══
CREATE TABLE IF NOT EXISTS marketplace_agents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    persona TEXT NOT NULL,
    tools JSONB DEFAULT '[]'::jsonb,
    model TEXT DEFAULT 'auto',
    icon TEXT DEFAULT '🤖',
    is_public BOOLEAN DEFAULT false,
    creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    installs INTEGER DEFAULT 0,
    rating NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fix marketplace_agents columns if table existed with partial schema
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS tools JSONB DEFAULT '[]'::jsonb;
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS model TEXT DEFAULT 'auto';
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '🤖';
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS installs INTEGER DEFAULT 0;
ALTER TABLE marketplace_agents ADD COLUMN IF NOT EXISTS rating NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_marketplace_public ON marketplace_agents(is_public, installs DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_creator ON marketplace_agents(creator_id);

CREATE TABLE IF NOT EXISTS user_installed_agents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES marketplace_agents(id) ON DELETE CASCADE,
    installed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_installed_agents_user ON user_installed_agents(user_id);

-- ═══ TIER 1: PLUGIN SYSTEM ═══
CREATE TABLE IF NOT EXISTS brain_plugins (
    id TEXT PRIMARY KEY,
    manifest JSONB NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
    installed_by TEXT,
    installed_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brain_plugins_status ON brain_plugins(status);

-- ═══ TIER 0: AUTONOMOUS TASKS ═══
CREATE TABLE IF NOT EXISTS autonomous_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    current_step INTEGER DEFAULT 0,
    steps JSONB DEFAULT '[]'::jsonb,
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_autonomous_user ON autonomous_tasks(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_status ON autonomous_tasks(status);

-- ═══ TIER 1: WHITE-LABEL TENANTS ═══
CREATE TABLE IF NOT EXISTS tenants (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT 'default',
    logo_url TEXT,
    primary_color TEXT DEFAULT '#6366f1',
    secondary_color TEXT DEFAULT '#06b6d4',
    default_avatar TEXT DEFAULT 'kira',
    default_language TEXT DEFAULT 'en',
    max_messages_per_day INTEGER DEFAULT 50,
    features JSONB DEFAULT '{}',
    custom_system_prompt TEXT,
    hide_branding BOOLEAN DEFAULT false,
    custom_footer TEXT,
    is_active BOOLEAN DEFAULT true,
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain);
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active);

-- ═══ K1 BRAIN ADMIN SESSIONS (persistent memory — NEVER deleted) ═══
CREATE TABLE IF NOT EXISTS brain_admin_sessions (
    id TEXT PRIMARY KEY,
    messages JSONB DEFAULT '[]'::jsonb,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brain_admin_sessions_updated ON brain_admin_sessions(updated_at DESC);

-- ═══ MISSING COLUMN: messages.source (used by saveConv in chat.js) ═══
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';

-- ═══ MISSING COLUMN: brain_memory.metadata (used by safe write guards + knowledge seed) ═══
ALTER TABLE brain_memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ═══ FIX DEFAULTS: language columns should default to 'en' not 'ro' ═══
ALTER TABLE conversations ALTER COLUMN language SET DEFAULT 'en';
ALTER TABLE messages ALTER COLUMN language SET DEFAULT 'en';
DO $fix_defaults$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'preferred_language') THEN
    EXECUTE 'ALTER TABLE profiles ALTER COLUMN preferred_language SET DEFAULT ''en''';
  END IF;
END $fix_defaults$;

-- ═══ MISSING COLUMN: page_views.referrer (used by traffic tracking in index.js) ═══
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer TEXT;

-- ═══ VISITORS (used by /api/track/visit in index.js) ═══
CREATE TABLE IF NOT EXISTS visitors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    ip TEXT,
    country TEXT,
    city TEXT,
    browser TEXT,
    device TEXT,
    os TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    language TEXT,
    timezone TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    photo TEXT,
    pages_visited JSONB DEFAULT '[]'::jsonb,
    total_visits INTEGER DEFAULT 1,
    total_time_sec INTEGER DEFAULT 0,
    status TEXT DEFAULT 'potential',
    first_seen TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now(),
    UNIQUE(fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_visitors_fingerprint ON visitors(fingerprint);
CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC);

-- Function for incrementing visitor time (used by beacon endpoint)
CREATE OR REPLACE FUNCTION increment_visitor_time(fp TEXT, secs INTEGER)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE visitors SET total_time_sec = total_time_sec + secs, last_seen = now() WHERE fingerprint = fp;
END; $$;

-- ═══ CHAT FEEDBACK (used by /api/chat/feedback in chat.js) ═══
CREATE TABLE IF NOT EXISTS chat_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    conversation_id UUID,
    message_index INTEGER DEFAULT 0,
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_user ON chat_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_conv ON chat_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_feedback_date ON chat_feedback(created_at DESC);

-- ═══ USAGE TRACKING (used by checkUsage/incrementUsage in payments.js) ═══
CREATE TABLE IF NOT EXISTS usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'chat',
    count INTEGER DEFAULT 0,
    date TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, type, date)
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, type, date);

-- ═══ PAYMENTS (used by /api/admin/revenue in admin.js) ═══
CREATE TABLE IF NOT EXISTS payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    amount NUMERIC NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'usd',
    plan TEXT DEFAULT 'pro',
    status TEXT DEFAULT 'completed',
    stripe_payment_intent_id TEXT,
    stripe_invoice_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ═══ GENERATED DOCUMENTS (used by _generateDocument in brain.js) ═══
CREATE TABLE IF NOT EXISTS generated_documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT DEFAULT 'markdown',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_docs_user ON generated_documents(user_id, created_at DESC);

-- ═══ EXEC_SQL RPC (necesară pentru auto-migration) ═══
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE query; END;
$$;

-- ═══ EMBEDDING CACHE (persist top embeddings) ═══
CREATE TABLE IF NOT EXISTS embedding_cache (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    text_hash TEXT NOT NULL UNIQUE,
    text_preview TEXT NOT NULL,
    embedding vector(1536),
    dims INTEGER DEFAULT 1536,
    hit_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(text_hash);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_hits ON embedding_cache(hit_count DESC);

-- ═══ CLONED VOICES (multiple per user, one active at a time) ═══
CREATE TABLE IF NOT EXISTS cloned_voices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    elevenlabs_voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT false,
    sample_duration_sec INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cloned_voices_user ON cloned_voices(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloned_voices_active ON cloned_voices(user_id, is_active) WHERE is_active = true;

CREATE OR REPLACE FUNCTION upsert_embedding_cache(p_text_hash TEXT, p_text_preview TEXT, p_embedding vector, p_dims INTEGER DEFAULT 1536)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO embedding_cache (text_hash, text_preview, embedding, dims)
    VALUES (p_text_hash, p_text_preview, p_embedding, p_dims)
    ON CONFLICT (text_hash) DO UPDATE SET hit_count = embedding_cache.hit_count + 1, last_used_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION load_top_embeddings(p_limit INTEGER DEFAULT 1000)
RETURNS TABLE (text_hash TEXT, text_preview TEXT, embedding vector, dims INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY SELECT ec.text_hash, ec.text_preview, ec.embedding, ec.dims FROM embedding_cache ec ORDER BY ec.hit_count DESC LIMIT p_limit;
END;
$$;

-- ═══ DEDUCT CREDITS RPC (atomic, race-condition safe) ═══
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount INTEGER DEFAULT 1)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current INTEGER;
  v_new     INTEGER;
BEGIN
  -- Lock the row for update
  SELECT credits INTO v_current
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'credits_left', 0, 'reason', 'user_not_found');
  END IF;

  IF v_current < p_amount THEN
    RETURN json_build_object('ok', false, 'credits_left', v_current, 'reason', 'insufficient_credits');
  END IF;

  v_new := v_current - p_amount;

  UPDATE profiles
  SET credits = v_new, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN json_build_object('ok', true, 'credits_left', v_new);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_credits(UUID, INTEGER) TO service_role;

-- ═══ REFERRAL CODES (HMAC-signed, full lifecycle) ═══
CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sent','redeemed','expired')),
    recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    recipient_email TEXT,
    sender_bonus_applied BOOLEAN DEFAULT false,
    receiver_bonus_applied BOOLEAN DEFAULT false,
    sender_bonus_days INTEGER DEFAULT 0,
    receiver_bonus_days INTEGER DEFAULT 0,
    sent_at TIMESTAMPTZ,
    redeemed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_sender ON referral_codes(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_status ON referral_codes(status);
CREATE INDEX IF NOT EXISTS idx_referral_codes_recipient ON referral_codes(recipient_email);

-- ═══ REFUND REQUESTS ═══
CREATE TABLE IF NOT EXISTS refund_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    plan TEXT NOT NULL,
    billing_cycle TEXT NOT NULL DEFAULT 'annual',
    subscription_start TIMESTAMPTZ,
    months_used INTEGER DEFAULT 0,
    refund_amount_usd NUMERIC(10,2) DEFAULT 0,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    stripe_customer_id TEXT,
    stripe_sub_id TEXT,
    stripe_refund_id TEXT,
    admin_note TEXT,
    processed_at TIMESTAMPTZ,
    processed_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refund_requests_user ON refund_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status, created_at DESC);

-- ═══ SCAN REPORTS (Self-Healing Engine) ═══
CREATE TABLE IF NOT EXISTS scan_reports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'healthy',
    issues_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    report_json JSONB DEFAULT '{}',
    ai_analysis JSONB,
    duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_reports_date ON scan_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_reports_score ON scan_reports(score);

-- ═══ HEAL JOBS (Self-Healing log) ═══
CREATE TABLE IF NOT EXISTS heal_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fix TEXT NOT NULL,
    issue_json JSONB DEFAULT '{}',
    success BOOLEAN DEFAULT false,
    message TEXT,
    actions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_heal_jobs_date ON heal_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heal_jobs_fix ON heal_jobs(fix, success);

-- ═══ CONTACT MESSAGES (Contact form inbox) ═══
CREATE TABLE IF NOT EXISTS contact_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ref_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    department TEXT DEFAULT 'Support',
    phone TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    status TEXT DEFAULT 'unread' CHECK (status IN ('unread','read','replied','archived')),
    reply_text TEXT,
    replied_at TIMESTAMPTZ,
    replied_by TEXT,
    read_at TIMESTAMPTZ,
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email);
CREATE INDEX IF NOT EXISTS idx_contact_messages_dept ON contact_messages(department);
CREATE INDEX IF NOT EXISTS idx_contact_messages_ref ON contact_messages(ref_number);

-- ═══ WORKSPACE FILES (File upload + AI analysis) ═══
CREATE TABLE IF NOT EXISTS workspace_files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    size_bytes INTEGER DEFAULT 0,
    file_hash TEXT,
    description TEXT,
    tags JSONB DEFAULT '[]',
    status TEXT DEFAULT 'ready' CHECK (status IN ('uploading','ready','analyzing','analyzed','error')),
    ai_analysis JSONB,
    analyzed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_files_user ON workspace_files(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_files_category ON workspace_files(user_id, category);
CREATE INDEX IF NOT EXISTS idx_workspace_files_hash ON workspace_files(file_hash);

-- ═══ BRAIN SELF LOG (Self-development engine log) ═══
CREATE TABLE IF NOT EXISTS brain_self_log (
    id TEXT DEFAULT gen_random_uuid()::text PRIMARY KEY,
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brain_self_log_type ON brain_self_log(type);

-- Fix brain_self_log columns if created with old schema
ALTER TABLE brain_self_log ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE brain_self_log ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';
ALTER TABLE brain_self_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE brain_self_log ALTER COLUMN id TYPE TEXT USING id::text;

-- ═══ PROCEDURAL MEMORY (Brain learned patterns) ═══
CREATE TABLE IF NOT EXISTS procedural_memory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    pattern_type TEXT NOT NULL DEFAULT 'routing_success',
    trigger_context TEXT,
    action_taken TEXT,
    outcome TEXT,
    tools_used JSONB DEFAULT '[]',
    success_count INTEGER DEFAULT 0,
    confidence NUMERIC DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_procedural_memory_user ON procedural_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_procedural_memory_pattern ON procedural_memory(pattern_type);

-- Fix procedural_memory columns if created with old schema
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS pattern_type TEXT DEFAULT 'routing_success';
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS trigger_context TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS tools_used JSONB DEFAULT '[]';
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0.5;

-- ═══ ALERT LOGS (toate alertele trimise de sistem) ═══
CREATE TABLE IF NOT EXISTS alert_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    alert_type TEXT NOT NULL,           -- 'credit_low' | 'new_user' | 'ai_status' | 'healing' | 'critical_error' | 'payment'
    subject TEXT NOT NULL,
    recipient_email TEXT,
    user_id UUID,
    user_email TEXT,
    status TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'failed' | 'skipped'
    error_msg TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_logs_date ON alert_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_type ON alert_logs(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_status ON alert_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_user ON alert_logs(user_id);

-- ═══ ALERT LOGS: add missing columns ═══
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS unread_flag BOOLEAN DEFAULT true;
-- Normalize status to include 'unread'/'read' alongside 'sent'/'failed'
-- We use a separate approach: status can be 'unread'|'read'|'sent'|'failed'|'skipped'
-- Add index for unread queries
CREATE INDEX IF NOT EXISTS idx_alert_logs_unread ON alert_logs(status) WHERE status = 'unread';

-- ═══ SUBSCRIPTIONS: add billing_cycle column if missing ═══
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly';

-- ═══ DANGER EVENTS (Safety learning — permanent memory of detected hazards) ═══
CREATE TABLE IF NOT EXISTS danger_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    danger_level TEXT NOT NULL DEFAULT 'warning' CHECK (danger_level IN ('immediate', 'warning', 'caution')),
    danger_type TEXT NOT NULL DEFAULT 'unknown',
    description TEXT NOT NULL,
    environment TEXT,
    location_hint TEXT,
    action_taken TEXT,
    user_response TEXT,
    false_alarm BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_danger_events_user ON danger_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_danger_events_type ON danger_events(danger_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_danger_events_level ON danger_events(danger_level);

`;

async function runMigration() {
  // Build connection string from Supabase URL or explicit DB vars
  let connectionString = process.env.DATABASE_URL;

  if (!connectionString && process.env.SUPABASE_URL) {
    // Extract project ref from Supabase URL
    const match = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) {
      const ref = match[1];
      const password = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
      if (!password) {
        logger.warn({ component: 'Migration' }, '⚠️ No DB password configured — skipping migration');
        return false;
      }
      connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
    }
  }

  if (!connectionString) {
    const logFn = process.env.NODE_ENV === 'production' ? logger.warn : logger.info;
    logFn.call(logger, { component: 'Migration' }, '⚠️ No database connection — skipping migration');
    return false;
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    logger.info({ component: 'Migration' }, '🔄 Running database migration...');
    // Split SQL respecting $tag$ ... $tag$ blocks ($$, $fix_defaults$, etc)
    const statements = [];
    let buf = '';
    let inBlock = false;
    let blockTag = '';
    for (const line of MIGRATION_SQL.split('\n')) {
      buf += line + '\n';
      const trimmed = line.trim();
      if (!inBlock) {
        // Detect start of dollar-quoted block: DO $$, LANGUAGE plpgsql AS $$, $fix_defaults$, etc
        const startMatch = trimmed.match(/(\$[a-zA-Z_]*\$)\s*(?:BEGIN|DECLARE)?/);
        if (startMatch && !trimmed.endsWith(startMatch[1] + ';')) {
          inBlock = true;
          blockTag = startMatch[1];
        } else if (trimmed.endsWith(';')) {
          statements.push(buf.trim());
          buf = '';
        }
      } else {
        // Check for end of block: END; $$; or END $tag$;
        if (trimmed.includes(blockTag) && trimmed.endsWith(';')) {
          inBlock = false;
          blockTag = '';
          statements.push(buf.trim());
          buf = '';
        }
      }
    }
    if (buf.trim()) statements.push(buf.trim());

    let migOk = 0,
      migFail = 0;
    for (const stmt of statements) {
      // Strip leading comments and blank lines before checking
      const cleaned = stmt.replace(/^(\s*--[^\n]*\n|\s*\n)*/g, '').trim();
      if (cleaned.length < 3) continue;
      try {
        await pool.query(stmt);
        migOk++;
      } catch (stmtErr) {
        migFail++;
        logger.debug({ component: 'Migration', err: stmtErr.message.substring(0, 120) }, '⚠️ Statement skipped');
      }
    }
    logger.info(
      { component: 'Migration', ok: migOk, skipped: migFail },
      `✅ Migration: ${migOk} OK, ${migFail} skipped out of ${migOk + migFail} statements`
    );

    // ── POST-MIGRATION: Verify every table actually works ──
    const ALL_TABLES = [
      'conversations',
      'messages',
      'user_preferences',
      'api_keys',
      'admin_logs',
      'profiles',
      'media_history',
      'cookie_consents',
      'metrics_snapshots',
      'ai_costs',
      'page_views',
      'subscriptions',
      'referrals',
      'admin_codes',
      'brain_memory',
      'learned_facts',
      'market_patterns',
      'brain_profiles',
      'brain_learnings',
      'brain_metrics',
      'brain_tools',
      'brain_usage',
      'brain_projects',
      'brain_procedures',
      'marketplace_agents',
      'user_installed_agents',
      'brain_plugins',
      'autonomous_tasks',
      'tenants',
      'brain_admin_sessions',
      'visitors',
      'chat_feedback',
      'usage',
      'payments',
      'generated_documents',
      'embedding_cache',
      'referral_codes',
      'refund_requests',
      'scan_reports',
      'heal_jobs',
      'contact_messages',
      'workspace_files',
      'brain_self_log',
      'alert_logs',
      'usage_tracking',
      'danger_events',
    ];

    const healthy = [];
    const broken = [];

    for (const table of ALL_TABLES) {
      try {
        const result = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table} LIMIT 1`);
        const count = parseInt(result.rows[0]?.cnt || '0', 10);
        healthy.push({ table, rows: count });
      } catch (e) {
        broken.push({ table, error: e.message.substring(0, 100) });
      }
    }

    if (broken.length > 0) {
      logger.warn(
        { component: 'Migration', broken },
        `⚠️ ${broken.length} tables BROKEN: ${broken.map((b) => b.table).join(', ')}`
      );
    }
    logger.info(
      {
        component: 'Migration',
        healthy: healthy.length,
        broken: broken.length,
      },
      `✅ Health check: ${healthy.length} OK, ${broken.length} broken out of ${ALL_TABLES.length} tables`
    );

    return true;
  } catch (e) {
    logger.error({ component: 'Migration', err: e.message }, '❌ Migration failed');
    logger.warn({ component: 'Migration' }, '⚠️ Server will continue without persistent storage');
    return false;
  } finally {
    await pool.end();
  }
}

module.exports = { runMigration };
