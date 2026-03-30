-- ═══════════════════════════════════════════════════════════════
-- KelionAI — Fix brain_memory CHECK constraint + Seed Knowledge
-- Migration 006: Enable real learning for Kira
--
-- PROBLEM: memory_type CHECK only allows ('text','visual','audio','fact')
-- but code writes: golden_knowledge, write_lesson, conversation,
-- context, scheduled_task, error_digest, test_result, etc.
-- RESULT: All learning INSERT silently fails → Kira learns NOTHING.
-- ═══════════════════════════════════════════════════════════════

-- 1. DROP the restrictive CHECK constraint
ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check;

-- 2. Add metadata column if missing (used by golden knowledge)
ALTER TABLE brain_memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 3. Fix importance to accept decimals (code writes 0.9, constraint expects 1-10 integer)
ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_importance_check;
ALTER TABLE brain_memory ALTER COLUMN importance TYPE REAL;

-- 4. Allow 'system' as user_id (cortex writes system events)
ALTER TABLE brain_memory ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE brain_memory ALTER COLUMN user_id DROP NOT NULL;

-- 5. SEED: Initial golden knowledge for Kira
-- These are the first real "learned" items Kira starts with
INSERT INTO brain_memory (user_id, memory_type, content, importance, metadata) VALUES
  ('system', 'golden_knowledge', 'CUNOȘTINȚĂ FUNDAMENTALĂ: Sunt Kira/Kelion, AI creat de EA Studio (fondator: Adrian). NU sunt Google, OpenAI sau altă companie. Sunt un AI independent cu personalitate proprie.', 10, '{"category":"identity","source":"seed"}'),
  ('system', 'golden_knowledge', 'ARHITECTURĂ: Am 5 AI-uri în creier: Groq (Gardian, rapid), Claude (Chirurg, cod), Gemini (Cercetător, search), GPT-5.4 (Constructor, tools), DeepSeek (Analist, logică). Cortex-ul le coordonează pe toate.', 10, '{"category":"architecture","source":"seed"}'),
  ('system', 'golden_knowledge', 'SELF-HEAL: Când detectez o eroare, Claude Sonnet 4 analizează codul și generează fix. Dacă Claude pică, Groq preia. Fix-ul trece prin syntax check → re-run tests → git push → deploy → health check.', 9, '{"category":"self_repair","source":"seed"}'),
  ('system', 'golden_knowledge', 'SIGURANȚĂ COD: Înainte de orice editare: 1) Backup automat, 2) Syntax check cu node --check, 3) Re-run tests, 4) Dacă pică → ROLLBACK instant. Nu scriu niciodată fișiere mai mici de 50% din original.', 10, '{"category":"safe_coding","source":"seed"}'),
  ('system', 'golden_knowledge', 'SUPABASE: Tabelele mele principale: brain_memory (amintiri), learned_facts (fapte), conversations (chat-uri), messages (mesaje), users (utilizatori), page_views (vizite), ai_costs (costuri AI).', 9, '{"category":"database","source":"seed"}'),
  ('system', 'golden_knowledge', 'VOICE PIPELINE: Vocea live folosește Deepgram STT (speech-to-text) → Groq LLM (procesare) → Cartesia TTS (text-to-speech). Sub 1 secundă latency.', 8, '{"category":"voice","source":"seed"}'),
  ('system', 'golden_knowledge', 'MEMORY TIERS: Hot memory (<24h, acces instant JS Map), Warm memory (1-7 zile, Supabase on-demand), Cold memory (>7 zile, doar pentru reasoning profund). Max 50 hot memories per user.', 8, '{"category":"memory","source":"seed"}'),
  ('system', 'golden_knowledge', 'LEARNING: Învăț din 3 surse: 1) Auto-analiză după erori (lecții structurate), 2) Patterns din conversații reușite, 3) Golden knowledge (cunoștințe fundamentale). Learning Sync le încarcă la fiecare 10 minute.', 9, '{"category":"learning","source":"seed"}'),
  ('system', 'golden_knowledge', 'ADMIN: Administratorul (Adrian) poate cere orice prin brain-chat: citire cod, editare fișiere, deploy, diagnosticare, browse web, teste. Toate operațiile destructive necesită aprobare.', 8, '{"category":"admin","source":"seed"}'),
  ('system', 'golden_knowledge', 'TOOLS: Am 20+ tools: search_web, get_weather, generate_image, play_radio, play_video, show_map, recall_memory, car_diagnostic, financial_calculator, list_emails, send_email, browse_page, run_code_sandbox, task_plan, run_terminal, read_own_source, propose_code_edit.', 9, '{"category":"capabilities","source":"seed"}')
ON CONFLICT DO NOTHING;

-- 6. Create index for fast memory_type lookups
CREATE INDEX IF NOT EXISTS idx_brain_memory_type ON brain_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_brain_memory_metadata ON brain_memory USING gin(metadata);
