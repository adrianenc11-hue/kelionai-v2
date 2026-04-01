-- ============================================================
-- KelionAI v2 - Supabase RLS Security Fix
-- Enable Row Level Security on ALL 38 public tables
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ============================================================
-- STEP 1: Enable RLS on all tables
-- ============================================================

ALTER TABLE public.user_cloned_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_graph ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedural_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semantic_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedding_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_installed_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autonomous_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloned_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heal_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_clones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Allow service_role full access to ALL tables
-- (Your backend uses service_role key, so it needs unrestricted access)
-- ============================================================

-- users
CREATE POLICY "service_role_all_users" ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);

-- conversations
CREATE POLICY "service_role_all_conversations" ON public.conversations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- messages
CREATE POLICY "service_role_all_messages" ON public.messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- subscription_plans
CREATE POLICY "service_role_all_subscription_plans" ON public.subscription_plans FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_usage
CREATE POLICY "service_role_all_user_usage" ON public.user_usage FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ai_providers
CREATE POLICY "service_role_all_ai_providers" ON public.ai_providers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_cloned_voices
CREATE POLICY "service_role_all_user_cloned_voices" ON public.user_cloned_voices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_tools
CREATE POLICY "service_role_all_brain_tools" ON public.brain_tools FOR ALL TO service_role USING (true) WITH CHECK (true);

-- visitors
CREATE POLICY "service_role_all_visitors" ON public.visitors FOR ALL TO service_role USING (true) WITH CHECK (true);

-- knowledge_graph
CREATE POLICY "service_role_all_knowledge_graph" ON public.knowledge_graph FOR ALL TO service_role USING (true) WITH CHECK (true);

-- security_log
CREATE POLICY "service_role_all_security_log" ON public.security_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- procedural_memory
CREATE POLICY "service_role_all_procedural_memory" ON public.procedural_memory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- semantic_memory
CREATE POLICY "service_role_all_semantic_memory" ON public.semantic_memory FOR ALL TO service_role USING (true) WITH CHECK (true);

-- embedding_cache
CREATE POLICY "service_role_all_embedding_cache" ON public.embedding_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- market_patterns
CREATE POLICY "service_role_all_market_patterns" ON public.market_patterns FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_installed_agents
CREATE POLICY "service_role_all_user_installed_agents" ON public.user_installed_agents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_profiles
CREATE POLICY "service_role_all_brain_profiles" ON public.brain_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_metrics
CREATE POLICY "service_role_all_brain_metrics" ON public.brain_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

-- marketplace_agents
CREATE POLICY "service_role_all_marketplace_agents" ON public.marketplace_agents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_usage
CREATE POLICY "service_role_all_brain_usage" ON public.brain_usage FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_projects
CREATE POLICY "service_role_all_brain_projects" ON public.brain_projects FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_procedures
CREATE POLICY "service_role_all_brain_procedures" ON public.brain_procedures FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_plugins
CREATE POLICY "service_role_all_brain_plugins" ON public.brain_plugins FOR ALL TO service_role USING (true) WITH CHECK (true);

-- autonomous_tasks
CREATE POLICY "service_role_all_autonomous_tasks" ON public.autonomous_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- tenants
CREATE POLICY "service_role_all_tenants" ON public.tenants FOR ALL TO service_role USING (true) WITH CHECK (true);

-- brain_admin_sessions
CREATE POLICY "service_role_all_brain_admin_sessions" ON public.brain_admin_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- chat_feedback
CREATE POLICY "service_role_all_chat_feedback" ON public.chat_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

-- payments
CREATE POLICY "service_role_all_payments" ON public.payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- generated_documents
CREATE POLICY "service_role_all_generated_documents" ON public.generated_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- cloned_voices
CREATE POLICY "service_role_all_cloned_voices" ON public.cloned_voices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- user_credits
CREATE POLICY "service_role_all_user_credits" ON public.user_credits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- scan_reports
CREATE POLICY "service_role_all_scan_reports" ON public.scan_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

-- heal_jobs
CREATE POLICY "service_role_all_heal_jobs" ON public.heal_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- contact_messages
CREATE POLICY "service_role_all_contact_messages" ON public.contact_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- refund_requests
CREATE POLICY "service_role_all_refund_requests" ON public.refund_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- alert_logs
CREATE POLICY "service_role_all_alert_logs" ON public.alert_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- referral_uses
CREATE POLICY "service_role_all_referral_uses" ON public.referral_uses FOR ALL TO service_role USING (true) WITH CHECK (true);

-- voice_clones
CREATE POLICY "service_role_all_voice_clones" ON public.voice_clones FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- STEP 3: User-level policies for authenticated users
-- (Users can only access their own data via Supabase client)
-- ============================================================

-- Users can read their own profile
CREATE POLICY "users_read_own" ON public.users FOR SELECT TO authenticated USING (auth.uid()::text = id::text);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated USING (auth.uid()::text = id::text);

-- Users can read/write their own conversations
CREATE POLICY "conversations_user_access" ON public.conversations FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Users can read/write messages in their own conversations
CREATE POLICY "messages_user_access" ON public.messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid()::text = c.user_id::text))
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND auth.uid()::text = c.user_id::text));

-- Subscription plans are readable by everyone (public info)
CREATE POLICY "subscription_plans_public_read" ON public.subscription_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "subscription_plans_anon_read" ON public.subscription_plans FOR SELECT TO anon USING (true);

-- Users can read their own usage
CREATE POLICY "user_usage_read_own" ON public.user_usage FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);

-- Users can read their own payments
CREATE POLICY "payments_read_own" ON public.payments FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);

-- Users can read their own cloned voices
CREATE POLICY "user_cloned_voices_access" ON public.user_cloned_voices FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "cloned_voices_access" ON public.cloned_voices FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY "voice_clones_access" ON public.voice_clones FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Users can read their own credits
CREATE POLICY "user_credits_read_own" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);

-- Users can read their own generated documents
CREATE POLICY "generated_documents_access" ON public.generated_documents FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Users can read their own refund requests
CREATE POLICY "refund_requests_read_own" ON public.refund_requests FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);

-- Users can read their own installed agents
CREATE POLICY "user_installed_agents_access" ON public.user_installed_agents FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Chat feedback - users can create and read their own
CREATE POLICY "chat_feedback_access" ON public.chat_feedback FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Contact messages - anyone authenticated can insert
CREATE POLICY "contact_messages_insert" ON public.contact_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "contact_messages_anon_insert" ON public.contact_messages FOR INSERT TO anon WITH CHECK (true);

-- Marketplace agents - public read
CREATE POLICY "marketplace_agents_public_read" ON public.marketplace_agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "marketplace_agents_anon_read" ON public.marketplace_agents FOR SELECT TO anon USING (true);

-- AI providers - public read (for model selection)
CREATE POLICY "ai_providers_public_read" ON public.ai_providers FOR SELECT TO authenticated USING (true);

-- Brain tools - public read
CREATE POLICY "brain_tools_public_read" ON public.brain_tools FOR SELECT TO authenticated USING (true);

-- Brain profiles - users read their own
CREATE POLICY "brain_profiles_access" ON public.brain_profiles FOR ALL TO authenticated USING (auth.uid()::text = user_id::text) WITH CHECK (auth.uid()::text = user_id::text);

-- Brain usage - users read their own
CREATE POLICY "brain_usage_read_own" ON public.brain_usage FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text);

-- Referral uses - users read their own
CREATE POLICY "referral_uses_access" ON public.referral_uses FOR ALL TO authenticated USING (auth.uid()::text = user_id::text OR auth.uid()::text = referred_user_id::text);

-- ============================================================
-- STEP 4: Admin-only tables (no direct user access needed)
-- Only service_role can access these (already covered by Step 2)
-- No additional policies needed for:
--   visitors, knowledge_graph, security_log, procedural_memory,
--   semantic_memory, embedding_cache, market_patterns, brain_metrics,
--   brain_projects, brain_procedures, brain_plugins, autonomous_tasks,
--   tenants, brain_admin_sessions, scan_reports, heal_jobs, alert_logs
-- ============================================================

-- ============================================================
-- DONE! All 38 tables now have RLS enabled.
-- service_role (backend) has full access to everything.
-- authenticated users can only access their own data.
-- anon users can only read public data (plans, marketplace).
-- ============================================================
