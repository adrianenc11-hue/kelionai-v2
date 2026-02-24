-- KelionAI v2 — Supabase Schema
-- Rulează în: https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/sql

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

CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_prefs_user ON user_preferences(user_id);

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql';

DROP TRIGGER IF EXISTS conversations_updated ON conversations;
CREATE TRIGGER conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_conv" ON conversations FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "own_msg" ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid() OR user_id IS NULL));
CREATE POLICY "own_prefs" ON user_preferences FOR ALL USING (auth.uid() = user_id);

SELECT '✅ KelionAI schema OK' AS status;
