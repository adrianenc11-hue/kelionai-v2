-- Provider credits table — stores current credit balance per AI provider
CREATE TABLE IF NOT EXISTS provider_credits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL UNIQUE,
    credit_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by TEXT DEFAULT 'admin'
);

-- Insert defaults for all providers
INSERT INTO provider_credits (provider, credit_usd) VALUES
    ('OpenAI', 5.00),
    ('Google', 0.00),
    ('Groq', 0.00),
    ('Perplexity', 5.00),
    ('Together', 5.00),
    ('ElevenLabs', 5.00),
    ('DeepSeek', 2.00),
    ('Tavily', 0.00),
    ('Serper', 0.00)
ON CONFLICT (provider) DO NOTHING;

-- RLS
ALTER TABLE provider_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_full_access_provider_credits" ON provider_credits
    FOR ALL USING (true) WITH CHECK (true);
