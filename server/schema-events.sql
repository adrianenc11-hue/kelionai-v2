-- Events/Birthdays table
CREATE TABLE IF NOT EXISTS user_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,              -- "Mom's Birthday", "Wedding Anniversary"
    event_date DATE NOT NULL,         -- the date (year optional)
    year_repeats BOOLEAN DEFAULT true, -- repeats every year
    category TEXT DEFAULT 'birthday', -- 'birthday'|'anniversary'|'reminder'|'other'
    person_name TEXT,                 -- who it's for
    notes TEXT,
    reminder_days INTEGER DEFAULT 3,  -- remind X days before
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_user ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON user_events(event_date);
