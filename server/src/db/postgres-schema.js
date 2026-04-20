'use strict';

// Idempotent Postgres DDL that mirrors the SQLite schema defined in
// `server/src/db/index.js`. Applied on every boot when DATABASE_URL is
// set (e.g. Supabase Postgres). Safe to re-run — every statement uses
// `IF NOT EXISTS` semantics.

module.exports = `
CREATE TABLE IF NOT EXISTS users (
  id                         BIGSERIAL PRIMARY KEY,
  google_id                  TEXT UNIQUE,
  email                      TEXT NOT NULL,
  name                       TEXT,
  picture                    TEXT,
  password_hash              TEXT,
  role                       TEXT DEFAULT 'user',
  subscription_tier          TEXT DEFAULT 'free',
  subscription_status        TEXT DEFAULT 'active',
  usage_today                INTEGER DEFAULT 0,
  usage_reset_date           TEXT,
  referral_code              TEXT UNIQUE,
  referred_by                TEXT,
  stripe_customer_id         TEXT,
  passkey_credentials        TEXT DEFAULT '[]',
  current_webauthn_challenge TEXT,
  credits_balance_minutes    INTEGER NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_google_id     ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

CREATE TABLE IF NOT EXISTS referrals (
  id         BIGSERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used       INTEGER NOT NULL DEFAULT 0,
  used_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_referrals_code  ON referrals(code);
CREATE INDEX IF NOT EXISTS idx_referrals_owner ON referrals(owner_id);

CREATE TABLE IF NOT EXISTS memory_items (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'fact',
  fact       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_memory_items_user ON memory_items(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth_secret  TEXT NOT NULL,
  user_agent   TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id, enabled);

CREATE TABLE IF NOT EXISTS proactive_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT,
  body       TEXT,
  reason     TEXT,
  delivered  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_proactive_log_user ON proactive_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_minutes          INTEGER NOT NULL,
  amount_cents           INTEGER,
  currency               TEXT DEFAULT 'gbp',
  kind                   TEXT NOT NULL,
  stripe_session_id      TEXT,
  stripe_payment_intent  TEXT,
  note                   TEXT,
  created_at             TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_session
  ON credit_transactions(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS visitor_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  path        TEXT,
  ip          TEXT,
  country     TEXT,
  user_agent  TEXT,
  referer     TEXT,
  user_id     BIGINT,
  user_email  TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitor_events_ts ON visitor_events(ts DESC);
`;
