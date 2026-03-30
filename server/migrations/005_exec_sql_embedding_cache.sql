-- ═══════════════════════════════════════════════════════════════
-- KelionAI — Migration 005: exec_sql RPC
-- Funcție necesară pentru auto-migration și auto-upgrade
-- Folosită în memory-vector.js pentru ALTER TABLE / CREATE INDEX
-- ═══════════════════════════════════════════════════════════════

-- exec_sql — execută SQL dinamic (SECURITY DEFINER = admin rights)
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  EXECUTE query;
END;
$$;

-- Embedding cache persist (top embeddings salvate în DB)
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

-- Funcție pentru upsert embedding cache
CREATE OR REPLACE FUNCTION upsert_embedding_cache(
    p_text_hash TEXT,
    p_text_preview TEXT,
    p_embedding vector,
    p_dims INTEGER DEFAULT 1536
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO embedding_cache (text_hash, text_preview, embedding, dims)
    VALUES (p_text_hash, p_text_preview, p_embedding, p_dims)
    ON CONFLICT (text_hash) DO UPDATE SET
        hit_count = embedding_cache.hit_count + 1,
        last_used_at = now();
END;
$$;

-- Funcție pentru load cache (top N cele mai folosite)
CREATE OR REPLACE FUNCTION load_top_embeddings(p_limit INTEGER DEFAULT 1000)
RETURNS TABLE (text_hash TEXT, text_preview TEXT, embedding vector, dims INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT ec.text_hash, ec.text_preview, ec.embedding, ec.dims
    FROM embedding_cache ec
    ORDER BY ec.hit_count DESC
    LIMIT p_limit;
END;
$$;
