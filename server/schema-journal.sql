-- Journal entries table
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 5),  -- 1=terrible, 5=amazing
    best_moment TEXT,
    improvements TEXT,
    goals TEXT,
    free_text TEXT,       -- additional free-form notes
    tags TEXT[],          -- ['work', 'family', 'health']
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, entry_date)  -- one entry per day
);

CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date);

-- Mood trend view
CREATE OR REPLACE VIEW mood_trends AS
SELECT user_id,
    DATE_TRUNC('week', entry_date) as week,
    AVG(mood_score) as avg_mood,
    COUNT(*) as entries,
    MIN(entry_date) as week_start
FROM journal_entries
GROUP BY user_id, DATE_TRUNC('week', entry_date);
