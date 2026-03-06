-- ═══════════════════════════════════════════════════════════════
-- KelionAI — AI Cost Tracking + Page Views
-- ═══════════════════════════════════════════════════════════════

-- AI costs per request
CREATE TABLE IF NOT EXISTS ai_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'guest',
  provider TEXT NOT NULL,
  model TEXT,
  endpoint TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_costs_user ON ai_costs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_costs_date ON ai_costs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_costs_provider ON ai_costs(provider);

-- Page views for traffic tracking
CREATE TABLE IF NOT EXISTS page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT,
  path TEXT DEFAULT '/',
  user_agent TEXT,
  country TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views(created_at);

-- Enable RLS
ALTER TABLE ai_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "admin_read_ai_costs" ON ai_costs FOR SELECT USING (true);
CREATE POLICY "service_insert_ai_costs" ON ai_costs FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_read_page_views" ON page_views FOR SELECT USING (true);
CREATE POLICY "service_insert_page_views" ON page_views FOR INSERT WITH CHECK (true);
