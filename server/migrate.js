// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Auto Migration
// Runs on server startup — creates tables if they don't exist
// Uses direct PostgreSQL connection (node-postgres)
// ═══════════════════════════════════════════════════════════════
const { Pool } = require('pg');
const logger = require('./logger');

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

CREATE TABLE IF NOT EXISTS events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'event',
    date DATE NOT NULL,
    recurring BOOLEAN DEFAULT false,
    notes TEXT,
    remind_days_before INTEGER DEFAULT 3,
    last_reminded DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS journal (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    mood INTEGER CHECK (mood BETWEEN 1 AND 5),
    best_moment TEXT,
    improvements TEXT,
    goals TEXT,
    free_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_journal_user_date ON journal(user_id, date);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own events') THEN
        CREATE POLICY "Users own events" ON events FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users own journal') THEN
        CREATE POLICY "Users own journal" ON journal FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;
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
        logger.warn({ component: 'Migration' }, '⚠️ No database connection — skipping migration');
        return false;
    }

    const pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
    });

    try {
        logger.info({ component: 'Migration' }, '�� Running database migration...');
        await pool.query(MIGRATION_SQL);
        logger.info({ component: 'Migration' }, '✅ Tables created/verified: conversations, messages, user_preferences, events, journal');
        logger.info({ component: 'Migration' }, '✅ RLS policies applied');
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
