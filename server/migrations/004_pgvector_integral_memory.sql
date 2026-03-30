-- ═══════════════════════════════════════════════════════════════
-- KelionAI — Memorie Integrală (Layer 4 din Schema Antropic Integral)
-- pgvector extension + tabele + funcții de semantic search
-- Dimensiune: 1536 (text-embedding-3-large truncat — HNSW pe Free tier)
-- Rulează în Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Activare pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Adăugare coloană embedding la brain_memory (dacă nu există)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'brain_memory' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE brain_memory ADD COLUMN embedding vector(1536);
  END IF;
END $$;

-- 3. Index HNSW pentru căutare rapidă (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_brain_memory_embedding
  ON brain_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Index compus pentru filtrare rapidă user + tip
CREATE INDEX IF NOT EXISTS idx_brain_memory_user_type
  ON brain_memory (user_id, memory_type, created_at DESC);

-- 5. Tabel pentru memorie procedurală (pattern-uri învățate)
CREATE TABLE IF NOT EXISTS procedural_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'solution',
  trigger_context TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  outcome TEXT,
  tools_used TEXT[] DEFAULT '{}',
  success_count INTEGER DEFAULT 1,
  fail_count INTEGER DEFAULT 0,
  confidence FLOAT DEFAULT 0.5,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_procedural_user
  ON procedural_memory (user_id, pattern_type, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_procedural_embedding
  ON procedural_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 6. Tabel pentru memorie semantică (fapte permanente cu embedding)
CREATE TABLE IF NOT EXISTS semantic_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'global',
  category TEXT NOT NULL DEFAULT 'knowledge',
  fact TEXT NOT NULL,
  source TEXT DEFAULT 'conversation',
  confidence FLOAT DEFAULT 0.7,
  access_count INTEGER DEFAULT 0,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sem_confidence_range CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_semantic_user_cat
  ON semantic_memory (user_id, category, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_semantic_embedding
  ON semantic_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════════════════════════
-- FUNCȚII RPC pentru semantic search
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_user_id TEXT,
  match_type TEXT DEFAULT NULL,
  match_count INTEGER DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  id UUID, content TEXT, memory_type TEXT, importance INTEGER,
  context JSONB, created_at TIMESTAMPTZ, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT bm.id, bm.content, bm.memory_type, bm.importance, bm.context, bm.created_at,
    1 - (bm.embedding <=> query_embedding) AS similarity
  FROM brain_memory bm
  WHERE bm.user_id = match_user_id AND bm.embedding IS NOT NULL
    AND (match_type IS NULL OR bm.memory_type = match_type)
    AND 1 - (bm.embedding <=> query_embedding) > match_threshold
  ORDER BY bm.embedding <=> query_embedding LIMIT match_count;
END; $$;

CREATE OR REPLACE FUNCTION match_procedures(
  query_embedding vector(1536),
  match_user_id TEXT,
  match_count INTEGER DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  id UUID, pattern_type TEXT, trigger_context TEXT, action_taken TEXT,
  outcome TEXT, tools_used TEXT[], confidence FLOAT, success_count INTEGER, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT pm.id, pm.pattern_type, pm.trigger_context, pm.action_taken, pm.outcome,
    pm.tools_used, pm.confidence, pm.success_count,
    1 - (pm.embedding <=> query_embedding) AS similarity
  FROM procedural_memory pm
  WHERE pm.user_id = match_user_id AND pm.embedding IS NOT NULL AND pm.confidence > 0.3
    AND 1 - (pm.embedding <=> query_embedding) > match_threshold
  ORDER BY pm.embedding <=> query_embedding LIMIT match_count;
END; $$;

CREATE OR REPLACE FUNCTION match_semantic(
  query_embedding vector(1536),
  match_user_id TEXT DEFAULT 'global',
  match_category TEXT DEFAULT NULL,
  match_count INTEGER DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.35
)
RETURNS TABLE (
  id UUID, fact TEXT, category TEXT, source TEXT, confidence FLOAT, similarity FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT sm.id, sm.fact, sm.category, sm.source, sm.confidence,
    1 - (sm.embedding <=> query_embedding) AS similarity
  FROM semantic_memory sm
  WHERE (sm.user_id = match_user_id OR sm.user_id = 'global') AND sm.embedding IS NOT NULL
    AND (match_category IS NULL OR sm.category = match_category)
    AND 1 - (sm.embedding <=> query_embedding) > match_threshold
  ORDER BY sm.embedding <=> query_embedding LIMIT match_count;
END; $$;

CREATE OR REPLACE FUNCTION update_procedure_outcome(
  proc_id UUID,
  was_success BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF was_success THEN
    UPDATE procedural_memory SET success_count = success_count + 1,
      confidence = LEAST(1.0, confidence + 0.05), last_used_at = now() WHERE id = proc_id;
  ELSE
    UPDATE procedural_memory SET fail_count = fail_count + 1,
      confidence = GREATEST(0.0, confidence - 0.1), last_used_at = now() WHERE id = proc_id;
  END IF;
END; $$;
