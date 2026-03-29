-- ═══════════════════════════════════════════════════════════════
-- KelionAI — Brain Memory Tables
-- Migration 004: Unified memory system (text + visual + audio + facts)
-- ═══════════════════════════════════════════════════════════════

-- 1. Unified brain memory (all memory types in one table)
CREATE TABLE IF NOT EXISTS brain_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('text','visual','audio','fact')),
  content TEXT NOT NULL,
  media_url TEXT,
  context JSONB DEFAULT '{}',
  importance SMALLINT DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_brain_memory_user_type ON brain_memory(user_id, memory_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_memory_importance ON brain_memory(user_id, importance DESC);

-- 2. Learned facts (extracted knowledge from conversations)
CREATE TABLE IF NOT EXISTS learned_facts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  source TEXT,
  confidence REAL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  category TEXT CHECK (category IN ('preference','personal','knowledge','skill','relationship')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learned_facts_user ON learned_facts(user_id, category, created_at DESC);

-- RLS (service_role only — brain writes server-side)
ALTER TABLE brain_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE learned_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_brain_memory" ON brain_memory
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_learned_facts" ON learned_facts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
