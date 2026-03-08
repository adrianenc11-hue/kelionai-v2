// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain Table Migration
// Auto-creates required Supabase tables on every startup
// Safe: uses IF NOT EXISTS — runs every deploy, zero risk
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

const MIGRATIONS = [
    {
        name: "brain_profiles",
        sql: `CREATE TABLE IF NOT EXISTS brain_profiles (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      profession TEXT,
      interests JSONB DEFAULT '[]'::jsonb,
      communication_style TEXT DEFAULT 'neutral',
      expertise_level TEXT DEFAULT 'general',
      top_topics JSONB DEFAULT '[]'::jsonb,
      preferred_languages JSONB DEFAULT '[]'::jsonb,
      emotional_baseline TEXT DEFAULT 'neutral',
      timezone TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    },
    {
        name: "brain_learnings",
        sql: `CREATE TABLE IF NOT EXISTS brain_learnings (
      pattern_key TEXT PRIMARY KEY,
      complexity TEXT,
      topics TEXT,
      best_tools JSONB DEFAULT '[]'::jsonb,
      success_rate FLOAT DEFAULT 0.5,
      avg_latency INT DEFAULT 0,
      count INT DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    },
    {
        name: "brain_metrics",
        sql: `CREATE TABLE IF NOT EXISTS brain_metrics (
      id BIGSERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      uptime_sec INT,
      conversations INT,
      error_rate FLOAT,
      memory_mb INT,
      tool_stats JSONB,
      tool_errors JSONB
    );`,
    },
    {
        name: "brain_facts",
        sql: `CREATE TABLE IF NOT EXISTS brain_facts (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      fact TEXT NOT NULL,
      category TEXT DEFAULT 'knowledge',
      importance INT DEFAULT 5,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    },
];

async function runMigrations(supabaseAdmin) {
    if (!supabaseAdmin) {
        logger.warn({ component: "Migration" }, "No supabaseAdmin — skipping migrations");
        return { success: false, reason: "no_client" };
    }

    const results = [];
    for (const m of MIGRATIONS) {
        try {
            const { error } = await supabaseAdmin.rpc("exec_sql", { query: m.sql }).single();
            if (error) {
                // rpc may not exist, try direct query via REST
                // Supabase JS client doesn't support raw SQL, so we use a different approach
                // We'll try inserting/selecting to verify table exists
                const { error: testError } = await supabaseAdmin.from(m.name).select("*").limit(0);
                if (testError && testError.code === "42P01") {
                    // Table doesn't exist — log warning
                    results.push({ table: m.name, status: "MISSING", note: "Create manually in Supabase SQL Editor" });
                    logger.warn({ component: "Migration", table: m.name },
                        `⚠️ Table ${m.name} missing — create in Supabase Dashboard > SQL Editor`);
                } else {
                    results.push({ table: m.name, status: "OK" });
                }
            } else {
                results.push({ table: m.name, status: "CREATED" });
            }
        } catch (e) {
            // Check if table exists by trying to query it
            try {
                const { error: testErr } = await supabaseAdmin.from(m.name).select("*").limit(0);
                if (testErr && testErr.message && testErr.message.includes("does not exist")) {
                    results.push({ table: m.name, status: "MISSING" });
                    logger.warn({ component: "Migration", table: m.name },
                        `⚠️ Table ${m.name} does not exist — Brain will work but without persistence`);
                } else {
                    results.push({ table: m.name, status: "OK" });
                }
            } catch (e2) {
                results.push({ table: m.name, status: "UNKNOWN", error: e2.message });
            }
        }
    }

    const ok = results.filter(r => r.status === "OK" || r.status === "CREATED").length;
    const missing = results.filter(r => r.status === "MISSING").length;

    if (missing > 0) {
        logger.warn({ component: "Migration", ok, missing, tables: results },
            `⚠️ Brain tables: ${ok} OK, ${missing} MISSING — run SQL in Supabase Dashboard`);
    } else {
        logger.info({ component: "Migration", ok },
            `✅ Brain tables: all ${ok} verified`);
    }

    return { success: missing === 0, results };
}

// Export the SQL for manual creation
function getManualSQL() {
    return MIGRATIONS.map(m => `-- ${m.name}\n${m.sql}`).join("\n\n");
}

module.exports = { runMigrations, getManualSQL, MIGRATIONS };
