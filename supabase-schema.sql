-- ============================================================
-- KelionAI - PostgreSQL Schema for Supabase
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Drop existing tables (safe order due to FKs)
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS user_usage CASCADE;
DROP TABLE IF EXISTS ai_providers CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop existing enums
DROP TYPE IF EXISTS role CASCADE;
DROP TYPE IF EXISTS subscription_tier CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;
DROP TYPE IF EXISTS message_role CASCADE;
DROP TYPE IF EXISTS ai_provider CASCADE;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE role AS ENUM ('user', 'admin');
CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'past_due', 'trialing');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE ai_provider AS ENUM ('openai', 'google', 'groq', 'anthropic', 'deepseek');

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  open_id VARCHAR(64) NOT NULL UNIQUE,
  name TEXT,
  email VARCHAR(320),
  password_hash TEXT,
  login_method VARCHAR(64),
  role role NOT NULL DEFAULT 'user',
  avatar_url TEXT,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_tier subscription_tier NOT NULL DEFAULT 'free',
  subscription_status subscription_status DEFAULT 'active',
  language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_signed_in TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  primary_ai_model VARCHAR(50) DEFAULT 'gpt-4',
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role message_role NOT NULL,
  content TEXT,
  ai_model VARCHAR(50),
  tokens INTEGER,
  metadata JSON,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE subscription_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  tier subscription_tier NOT NULL,
  stripe_price_id VARCHAR(255) NOT NULL,
  monthly_price NUMERIC(10, 2),
  yearly_price NUMERIC(10, 2),
  messages_per_month INTEGER,
  voice_minutes_per_month INTEGER,
  features JSON,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE user_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages_this_month INTEGER DEFAULT 0,
  voice_minutes_this_month INTEGER DEFAULT 0,
  last_reset_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  provider ai_provider NOT NULL,
  model VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  metadata JSON,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_user_usage_user_id ON user_usage(user_id);
CREATE INDEX idx_users_open_id ON users(open_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- SEED: Subscription Plans
-- ============================================================

INSERT INTO subscription_plans (name, tier, stripe_price_id, monthly_price, yearly_price, messages_per_month, voice_minutes_per_month, features, is_active)
VALUES
  ('Free', 'free', 'price_free', 0, 0, 50, 10, '["50 messages/month", "10 min voice/month", "Basic access"]', true),
  ('Pro', 'pro', 'price_pro_placeholder', 9.99, 99.99, 500, 120, '["500 messages/month", "120 min voice/month", "Priority support", "All AI models"]', true),
  ('Premium', 'enterprise', 'price_premium_placeholder', 19.99, 199.99, -1, -1, '["Unlimited messages", "Unlimited voice", "Priority support", "All AI models", "API access"]', true);
