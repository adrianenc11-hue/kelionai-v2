-- Migration 007: Fix brain tables (missing tables + column mismatches)
-- Date: 2026-03-29

-- 1. Fix memory_type constraint — add 'text', 'visual', 'audio'
ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check;
ALTER TABLE brain_memory ADD CONSTRAINT brain_memory_memory_type_check
  CHECK (memory_type IN ('general', 'conversation', 'fact', 'preference', 'skill', 'emotion', 'context', 'system', 'golden_knowledge', 'write_lesson', 'file_write', 'scheduled_task', 'text', 'visual', 'audio'));

-- 2. Fix procedural_memory columns — drop old, add new
ALTER TABLE procedural_memory DROP COLUMN IF EXISTS procedure_name;
ALTER TABLE procedural_memory DROP COLUMN IF EXISTS steps;
ALTER TABLE procedural_memory DROP COLUMN IF EXISTS last_used;
ALTER TABLE procedural_memory DROP COLUMN IF EXISTS success_rate;
ALTER TABLE procedural_memory DROP COLUMN IF EXISTS context;

ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS pattern_type TEXT NOT NULL DEFAULT 'routing_success';
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS trigger_context TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS tools_used JSONB DEFAULT '[]';
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0;
ALTER TABLE procedural_memory ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0.5;

CREATE INDEX IF NOT EXISTS idx_procedural_memory_pattern ON procedural_memory(pattern_type);

-- 3. Create danger_events table
CREATE TABLE IF NOT EXISTS danger_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id TEXT,
    danger_type TEXT NOT NULL,
    danger_level TEXT DEFAULT 'low',
    description TEXT,
    false_alarm BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_danger_events_user ON danger_events(user_id);
CREATE INDEX IF NOT EXISTS idx_danger_events_type ON danger_events(danger_type);

ALTER TABLE danger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_only" ON danger_events FOR ALL USING (false);

-- 4. Create brain_self_log table
CREATE TABLE IF NOT EXISTS brain_self_log (
    id TEXT DEFAULT gen_random_uuid()::text PRIMARY KEY,
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_self_log_type ON brain_self_log(type);

ALTER TABLE brain_self_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_only" ON brain_self_log FOR ALL USING (false);
