-- ═══════════════════════════════════════════════════════════════
-- KelionAI — Memory-to-Supabase Migration
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ═══ MESSENGER MESSAGES (conversation history) ═══
CREATE TABLE IF NOT EXISTS messenger_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sender_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messenger_msg_sender ON messenger_messages(sender_id, created_at DESC);

-- ═══ TELEGRAM MESSAGES (conversation history) ═══
CREATE TABLE IF NOT EXISTS telegram_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telegram_msg_chat ON telegram_messages(chat_id, created_at DESC);

-- ═══ Add character + message_count columns to existing bot user tables ═══
ALTER TABLE messenger_users ADD COLUMN IF NOT EXISTS character TEXT DEFAULT 'kelion';
ALTER TABLE messenger_users ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS character TEXT DEFAULT 'kelion';
ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

-- ═══ RLS ═══
ALTER TABLE messenger_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_only" ON messenger_messages FOR ALL USING (false);
CREATE POLICY IF NOT EXISTS "service_only" ON telegram_messages FOR ALL USING (false);

-- ═══ Auto-cleanup: delete bot messages older than 7 days ═══
-- Run via pg_cron:
-- SELECT cron.schedule('cleanup-bot-messages', '0 4 * * *', $$
--   DELETE FROM messenger_messages WHERE created_at < NOW() - INTERVAL '7 days';
--   DELETE FROM telegram_messages WHERE created_at < NOW() - INTERVAL '7 days';
--   DELETE FROM whatsapp_messages WHERE created_at < NOW() - INTERVAL '7 days';
-- $$);
