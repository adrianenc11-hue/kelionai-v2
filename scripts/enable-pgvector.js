#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI — Enable pgvector for semantic memory
// Run once: node scripts/enable-pgvector.js
// ═══════════════════════════════════════════════════════════════
"use strict";

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function migrate() {
    console.log("🧠 Enabling pgvector for semantic memory...\n");

    // Step 1: Enable pgvector extension
    console.log("1. Enabling pgvector extension...");
    const { error: extErr } = await supabase.rpc("exec_sql", {
        sql: "CREATE EXTENSION IF NOT EXISTS vector;",
    });
    // If RPC doesn't exist, user needs to run it manually in Supabase SQL Editor
    if (extErr) {
        console.log(
            "⚠️  Cannot run SQL via RPC. Please run this in Supabase SQL Editor:\n",
        );
        console.log("   CREATE EXTENSION IF NOT EXISTS vector;");
        console.log(
            "   ALTER TABLE brain_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);",
        );
        console.log(
            "   CREATE INDEX IF NOT EXISTS brain_memory_embedding_idx ON brain_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);",
        );
        console.log(
            "\n   -- Function for similarity search:",
        );
        console.log(`   CREATE OR REPLACE FUNCTION match_memories(
     query_embedding vector(1536),
     match_user_id uuid,
     match_type text,
     match_count int DEFAULT 10,
     match_threshold float DEFAULT 0.3
   ) RETURNS TABLE (
     id uuid,
     content text,
     context jsonb,
     importance int,
     created_at timestamptz,
     similarity float
   ) LANGUAGE plpgsql AS $$
   BEGIN
     RETURN QUERY
     SELECT
       bm.id,
       bm.content,
       bm.context,
       bm.importance,
       bm.created_at,
       1 - (bm.embedding <=> query_embedding) as similarity
     FROM brain_memory bm
     WHERE bm.user_id = match_user_id
       AND bm.memory_type = match_type
       AND bm.embedding IS NOT NULL
       AND 1 - (bm.embedding <=> query_embedding) > match_threshold
     ORDER BY bm.embedding <=> query_embedding
     LIMIT match_count;
   END;
   $$;`);
        console.log("\n\nThen run this script again to verify.");
        return;
    }

    console.log("   ✅ pgvector extension enabled");

    // Step 2: Add embedding column
    console.log("2. Adding embedding column to brain_memory...");
    await supabase.rpc("exec_sql", {
        sql: "ALTER TABLE brain_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);",
    });
    console.log("   ✅ embedding column added");

    // Step 3: Create index
    console.log("3. Creating IVFFlat index...");
    await supabase.rpc("exec_sql", {
        sql: "CREATE INDEX IF NOT EXISTS brain_memory_embedding_idx ON brain_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);",
    });
    console.log("   ✅ index created");

    // Step 4: Create similarity search function
    console.log("4. Creating match_memories function...");
    await supabase.rpc("exec_sql", {
        sql: `CREATE OR REPLACE FUNCTION match_memories(
      query_embedding vector(1536),
      match_user_id uuid,
      match_type text,
      match_count int DEFAULT 10,
      match_threshold float DEFAULT 0.3
    ) RETURNS TABLE (
      id uuid, content text, context jsonb, importance int, created_at timestamptz, similarity float
    ) LANGUAGE plpgsql AS $$
    BEGIN
      RETURN QUERY SELECT bm.id, bm.content, bm.context, bm.importance, bm.created_at,
        1 - (bm.embedding <=> query_embedding) as similarity
      FROM brain_memory bm
      WHERE bm.user_id = match_user_id AND bm.memory_type = match_type
        AND bm.embedding IS NOT NULL AND 1 - (bm.embedding <=> query_embedding) > match_threshold
      ORDER BY bm.embedding <=> query_embedding LIMIT match_count;
    END; $$;`,
    });
    console.log("   ✅ match_memories function created");

    console.log("\n🎉 pgvector enabled! Semantic memory is ready.");
    console.log('   Brain will now use embeddings for "understanding" memories.\n');
}

migrate().catch(console.error);
