"use strict";

/**
 * K1 DEEP MEMORY FABRIC — Memorie vie
 * 
 * Triple Memory Architecture:
 * - HOT  (RAM/Cache)  — ultimele 10 min, ~1ms access
 * - WARM (Supabase)   — ultimele 90 zile, ~50ms access
 * - COLD (Supabase)   — tot istoricul, ~200ms access
 * 
 * Attention Mechanism:
 * relevance = semantic_match × recency_decay × importance × user_preference
 * 
 * Forgetting Engine:
 * - Conversații >90 zile → comprimare în summary
 * - Fapte contrazise → deprecated
 * - Duplicate → merge
 */

const logger = require("pino")({ name: "k1-memory" });

// ═══════════════════════════════════════════════════════════════
// HOT MEMORY — Cache rapid în RAM (ultimele 10 minute)
// ═══════════════════════════════════════════════════════════════

const hotMemory = [];
const MAX_HOT = 50;

function addToHot(entry) {
    const item = {
        id: Date.now(),
        content: entry.content || entry,
        type: entry.type || "message",      // message, fact, decision, learning
        domain: entry.domain || "general",
        importance: entry.importance || 5,   // 1-10
        timestamp: new Date().toISOString(),
        source: entry.source || "user",
        tags: entry.tags || [],
    };
    hotMemory.push(item);
    if (hotMemory.length > MAX_HOT) hotMemory.shift();
    return item;
}

function getHot(limit = 10) {
    return hotMemory.slice(-limit);
}

function searchHot(query) {
    const lower = query.toLowerCase();
    return hotMemory
        .filter(m => m.content.toLowerCase().includes(lower))
        .sort((a, b) => b.importance - a.importance);
}

// ═══════════════════════════════════════════════════════════════
// WARM MEMORY — Supabase (ultimele 90 zile cu retrieval inteligent)
// ═══════════════════════════════════════════════════════════════

/**
 * Salvează memorie în Supabase (warm storage)
 */
async function saveToWarm(supabase, entry) {
    if (!supabase) return null;
    try {
        const record = {
            content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
            type: entry.type || "message",
            domain: entry.domain || "general",
            importance: entry.importance || 5,
            tags: entry.tags || [],
            source: entry.source || "system",
            metadata: entry.metadata || {},
            created_at: new Date().toISOString(),
            expires_at: entry.expires_at || null, // null = nu expiră
        };

        const { data, error } = await supabase
            .from("k1_memory")
            .insert(record)
            .select()
            .single();

        if (error) {
            // Tabelul poate să nu existe încă
            if (error.code === "42P01") {
                logger.info("[K1-Memory] Tabelul k1_memory nu există — creez...");
                await createMemoryTable(supabase);
                return saveToWarm(supabase, entry); // Retry
            }
            logger.warn({ err: error.message }, "[K1-Memory] Eroare la salvare warm");
            return null;
        }

        logger.debug({ id: data?.id, type: record.type }, "[K1-Memory] Salvat în warm memory");
        return data;
    } catch (e) {
        logger.warn({ err: e.message }, "[K1-Memory] Eroare salvare");
        return null;
    }
}

/**
 * Attention-based retrieval — returnează cele mai relevante memorii
 */
async function retrieve(supabase, query, options = {}) {
    const {
        limit = 10,
        domain = null,
        maxAge = 90,       // zile
        minImportance = 1,
        types = null,       // ["fact", "decision", "learning"]
    } = options;

    // 1. Caută în HOT memory mai întâi (~1ms)
    const hotResults = searchHot(query)
        .filter(m => !domain || m.domain === domain)
        .slice(0, 3);

    // 2. Caută în WARM memory (Supabase, ~50ms)
    let warmResults = [];
    if (supabase) {
        try {
            let queryBuilder = supabase
                .from("k1_memory")
                .select("*")
                .gte("importance", minImportance)
                .gte("created_at", new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000).toISOString())
                .order("importance", { ascending: false })
                .order("created_at", { ascending: false })
                .limit(limit * 2); // Fetch more, then rank

            if (domain) queryBuilder = queryBuilder.eq("domain", domain);
            if (types) queryBuilder = queryBuilder.in("type", types);

            // Text search (basic — fără pgvector)
            if (query) {
                queryBuilder = queryBuilder.ilike("content", `%${query.slice(0, 50)}%`);
            }

            const { data, error } = await queryBuilder;
            if (!error && data) warmResults = data;
        } catch (e) {
            logger.debug({ err: e.message }, "[K1-Memory] Warm query failed");
        }
    }

    // 3. Rank cu attention mechanism
    const now = Date.now();
    const allResults = [...hotResults, ...warmResults].map(m => {
        const age = (now - new Date(m.timestamp || m.created_at).getTime()) / (1000 * 60 * 60); // ore
        const recencyDecay = Math.exp(-age / (24 * 7)); // Decay la 1 săptămână
        const importanceWeight = (m.importance || 5) / 10;

        // Keyword match score (simplu, fără embeddings)
        const queryWords = query.toLowerCase().split(/\s+/);
        const contentLower = (m.content || "").toLowerCase();
        const matchedWords = queryWords.filter(w => w.length > 2 && contentLower.includes(w));
        const semanticScore = queryWords.length > 0 ? matchedWords.length / queryWords.length : 0;

        const relevance = semanticScore * 0.4 + recencyDecay * 0.3 + importanceWeight * 0.3;

        return { ...m, relevance: Math.round(relevance * 100) / 100, source: m.id > 1e12 ? "hot" : "warm" };
    });

    // Sort by relevance, deduplicate
    allResults.sort((a, b) => b.relevance - a.relevance);

    // Deduplicate by content
    const seen = new Set();
    const unique = allResults.filter(m => {
        const key = (m.content || "").slice(0, 100);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return unique.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════
// FORGETTING ENGINE — Uită intenționat ce nu contează
// ═══════════════════════════════════════════════════════════════

/**
 * Cleanup: comprimă memorii vechi, șterge neimportante
 */
async function forget(supabase, options = {}) {
    if (!supabase) return { status: "no_supabase" };

    const {
        maxAge = 90,          // Comprimă memorii > N zile
        minImportance = 3,    // Șterge memorii < N importanță
    } = options;

    const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000).toISOString();
    let deleted = 0;
    let compressed = 0;
    let archived = 0;

    try {
        // 1. Archive important memories to COLD before forgetting
        archived = await archiveToCold(supabase, { maxAge: 30 });

        // 2. Șterge memorii vechi neimportante
        const { data: old } = await supabase
            .from("k1_memory")
            .delete()
            .lt("importance", minImportance)
            .lt("created_at", cutoff)
            .select("id");

        deleted = old?.length || 0;

        // 3. Comprimă memorii vechi importante → summary
        const { data: toCompress } = await supabase
            .from("k1_memory")
            .select("*")
            .gte("importance", minImportance)
            .lt("created_at", cutoff)
            .limit(50);

        if (toCompress && toCompress.length > 5) {
            const summary = toCompress.map(m => m.content.slice(0, 100)).join(" | ");
            await saveToWarm(supabase, {
                content: `[COMPRESSED ${toCompress.length} memories] ${summary.slice(0, 500)}`,
                type: "compressed",
                importance: 7,
                domain: "system",
                tags: ["compressed", "auto"],
            });

            // Șterge originalele comprimate
            const ids = toCompress.map(m => m.id);
            await supabase.from("k1_memory").delete().in("id", ids);
            compressed = toCompress.length;
        }
    } catch (e) {
        logger.warn({ err: e.message }, "[K1-Memory] Forgetting engine error");
    }

    logger.info({ deleted, compressed, archived }, "[K1-Memory] 🧹 Forgetting cycle complete");
    return { deleted, compressed, archived };
}

// ═══════════════════════════════════════════════════════════════
// COLD MEMORY — Long-term archive (summarized, forever)
// ═══════════════════════════════════════════════════════════════

/**
 * Archive warm memories older than N days into cold summaries
 */
async function archiveToCold(supabase, options = {}) {
    if (!supabase) return 0;
    const { maxAge = 30 } = options;
    const cutoff = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Get old important warm memories not yet archived
        const { data: oldWarm } = await supabase
            .from("k1_memory")
            .select("*")
            .gte("importance", 5)
            .lt("created_at", cutoff)
            .neq("type", "cold_archive")
            .neq("type", "compressed")
            .order("created_at", { ascending: true })
            .limit(100);

        if (!oldWarm || oldWarm.length < 3) return 0;

        // Group by domain and summarize
        const byDomain = {};
        for (const m of oldWarm) {
            const d = m.domain || "general";
            if (!byDomain[d]) byDomain[d] = [];
            byDomain[d].push(m);
        }

        let archived = 0;
        for (const [domain, memories] of Object.entries(byDomain)) {
            if (memories.length < 2) continue;

            // Create cold archive summary
            const contentParts = memories.map(m =>
                `[${m.type}] ${(m.content || "").slice(0, 150)}`
            );
            const avgImportance = Math.round(memories.reduce((s, m) => s + (m.importance || 5), 0) / memories.length);
            const dateRange = `${memories[0].created_at?.slice(0, 10)} → ${memories[memories.length - 1].created_at?.slice(0, 10)}`;

            await supabase.from("k1_memory").insert({
                content: `[COLD ARCHIVE | ${domain} | ${dateRange} | ${memories.length} items]\n${contentParts.join("\n")}`.slice(0, 2000),
                type: "cold_archive",
                domain,
                importance: Math.max(avgImportance, 6),
                tags: ["cold", "archive", "auto"],
                source: "forgetting-engine",
                metadata: { originalCount: memories.length, dateRange, archivedAt: new Date().toISOString() },
                created_at: new Date().toISOString(),
            });

            // Delete originals
            const ids = memories.map(m => m.id);
            await supabase.from("k1_memory").delete().in("id", ids);
            archived += memories.length;
        }

        if (archived > 0) {
            logger.info({ archived }, "[K1-Memory] ❄️ Cold archive created");
        }
        return archived;
    } catch (e) {
        logger.warn({ err: e.message }, "[K1-Memory] Cold archive error");
        return 0;
    }
}

/**
 * Search COLD memory archives
 */
async function searchCold(supabase, query, options = {}) {
    if (!supabase || !query) return [];
    const { limit = 5 } = options;
    try {
        const { data } = await supabase
            .from("k1_memory")
            .select("*")
            .in("type", ["cold_archive", "compressed"])
            .ilike("content", `%${query.slice(0, 50)}%`)
            .order("importance", { ascending: false })
            .limit(limit);
        return data || [];
    } catch {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════
// UTILS — Helpers
// ═══════════════════════════════════════════════════════════════

async function createMemoryTable(supabase) {
    try {
        await supabase.rpc("exec_sql", {
            sql: `
        CREATE TABLE IF NOT EXISTS k1_memory (
          id BIGSERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'message',
          domain VARCHAR(50) DEFAULT 'general',
          importance INTEGER DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
          tags TEXT[] DEFAULT '{}',
          source VARCHAR(50) DEFAULT 'system',
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_k1_memory_domain ON k1_memory(domain);
        CREATE INDEX IF NOT EXISTS idx_k1_memory_type ON k1_memory(type);
        CREATE INDEX IF NOT EXISTS idx_k1_memory_importance ON k1_memory(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_k1_memory_created ON k1_memory(created_at DESC);
      `
        });
        logger.info("[K1-Memory] Tabel k1_memory creat cu succes");
    } catch (e) {
        logger.warn({ err: e.message }, "[K1-Memory] Nu am putut crea tabelul (creează-l manual)");
    }
}

function getStats() {
    return {
        hotCount: hotMemory.length,
        hotMaxCapacity: MAX_HOT,
        oldestHot: hotMemory[0]?.timestamp || null,
        newestHot: hotMemory[hotMemory.length - 1]?.timestamp || null,
        tiers: ["hot (RAM)", "warm (Supabase 30d)", "cold (archive forever)"],
    };
}

module.exports = {
    addToHot,
    getHot,
    searchHot,
    saveToWarm,
    retrieve,
    forget,
    archiveToCold,
    searchCold,
    getStats,
    createMemoryTable,
};
