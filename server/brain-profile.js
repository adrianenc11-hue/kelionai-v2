// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain Profile Module
// User profiling, long-term memory, and learning persistence
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

// ── UserProfile — aggregated user intelligence ──
class UserProfile {
    constructor(userId) {
        this.userId = userId;
        this.language = "ro";
        this.timezone = null;
        this.name = null;
        this.profession = null;
        this.interests = [];
        this.communicationStyle = "neutral"; // formal, casual, technical, friendly
        this.expertiseLevel = "general";     // beginner, general, expert
        this.preferredAvatar = "kelion";
        this.plan = "free";
        this.totalMessages = 0;
        this.topTopics = [];           // [{topic, count}]
        this.preferredLanguages = [];  // [{lang, count}]
        this.emotionalBaseline = "neutral";
        this.lastSeen = null;
        this.firstSeen = null;
        this.facts = [];               // extracted personal facts
        this.loadedAt = null;
    }

    // Build profile from Supabase data
    static async load(userId, supabase) {
        const profile = new UserProfile(userId);
        if (!supabase || !userId) return profile;

        try {
            // 1. Load user data from profiles table
            const { data: userData } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", userId)
                .single();

            if (userData) {
                profile.name = userData.full_name || userData.display_name || null;
                profile.plan = userData.plan || "free";
                profile.language = userData.language || "ro";
                profile.preferredAvatar = userData.preferred_avatar || "kelion";
                profile.firstSeen = userData.created_at;
                profile.totalMessages = userData.message_count || 0;
            }

            // 2. Load stored profile from brain_profiles table
            const { data: brainProfile } = await supabase
                .from("brain_profiles")
                .select("*")
                .eq("user_id", userId)
                .single();

            if (brainProfile) {
                profile.profession = brainProfile.profession || null;
                profile.interests = brainProfile.interests || [];
                profile.communicationStyle = brainProfile.communication_style || "neutral";
                profile.expertiseLevel = brainProfile.expertise_level || "general";
                profile.topTopics = brainProfile.top_topics || [];
                profile.preferredLanguages = brainProfile.preferred_languages || [];
                profile.emotionalBaseline = brainProfile.emotional_baseline || "neutral";
                profile.timezone = brainProfile.timezone || null;
            }

            // 3. Load personal facts
            const { data: facts } = await supabase
                .from("brain_facts")
                .select("fact, category")
                .eq("user_id", userId)
                .order("importance", { ascending: false })
                .limit(20);

            if (facts) profile.facts = facts;

            profile.lastSeen = new Date().toISOString();
            profile.loadedAt = Date.now();

            logger.info({ component: "BrainProfile", userId, name: profile.name, topics: profile.topTopics.length },
                "Profile loaded");

        } catch (e) {
            logger.warn({ component: "BrainProfile", userId, err: e.message }, "Profile load failed (tables may not exist)");
        }

        return profile;
    }

    // Save/update profile to Supabase
    async save(supabase) {
        if (!supabase || !this.userId) return;
        try {
            await supabase.from("brain_profiles").upsert({
                user_id: this.userId,
                profession: this.profession,
                interests: this.interests,
                communication_style: this.communicationStyle,
                expertise_level: this.expertiseLevel,
                top_topics: this.topTopics,
                preferred_languages: this.preferredLanguages,
                emotional_baseline: this.emotionalBaseline,
                timezone: this.timezone,
                updated_at: new Date().toISOString(),
            }, { onConflict: "user_id" });
        } catch (e) {
            logger.warn({ component: "BrainProfile", err: e.message }, "Profile save failed");
        }
    }

    // Extract profile updates from a conversation
    updateFromConversation(message, language, analysis) {
        // Track language usage
        if (language) {
            const existing = this.preferredLanguages.find(l => l.lang === language);
            if (existing) existing.count++;
            else this.preferredLanguages.push({ lang: language, count: 1 });
            this.preferredLanguages.sort((a, b) => b.count - a.count);
            this.language = this.preferredLanguages[0]?.lang || language;
        }

        // Track topics
        if (analysis && analysis.topics) {
            for (const topic of analysis.topics) {
                const existing = this.topTopics.find(t => t.topic === topic);
                if (existing) existing.count++;
                else this.topTopics.push({ topic, count: 1 });
            }
            this.topTopics.sort((a, b) => b.count - a.count);
            if (this.topTopics.length > 20) this.topTopics = this.topTopics.slice(0, 20);
        }

        // Detect communication style from message patterns
        const lower = (message || "").toLowerCase();
        if (/\b(please|thank|kindly|would you)\b/i.test(message)) this.communicationStyle = "formal";
        else if (/\b(yo|sup|hey|lol|haha)\b/i.test(lower)) this.communicationStyle = "casual";
        else if (/\b(api|function|algorithm|database|code|server|deploy)\b/i.test(lower)) this.communicationStyle = "technical";

        // Detect expertise level
        if (/\b(implement|refactor|architecture|microservic|kubernetes|docker|ci\/cd)\b/i.test(lower)) {
            this.expertiseLevel = "expert";
        } else if (/\b(how do i|what is|explain|help me|can you)\b/i.test(lower)) {
            this.expertiseLevel = "general";
        }

        // Detect profession hints
        const professionHints = [
            { pattern: /\b(programm|develop|cod(e|ing)|software|engineer)\b/i, prof: "developer" },
            { pattern: /\b(design|ui|ux|figma|photoshop)\b/i, prof: "designer" },
            { pattern: /\b(market|seo|brand|campaign|advertis)\b/i, prof: "marketer" },
            { pattern: /\b(trad(e|ing)|invest|stock|crypto|bitcoin|forex)\b/i, prof: "trader" },
            { pattern: /\b(student|learn|university|school|homework)\b/i, prof: "student" },
            { pattern: /\b(business|startup|entrepreneur|ceo|founder)\b/i, prof: "entrepreneur" },
        ];
        for (const hint of professionHints) {
            if (hint.pattern.test(lower)) {
                this.profession = hint.prof;
                break;
            }
        }

        this.totalMessages++;
    }

    // Generate context string for AI prompt injection
    toContextString() {
        const parts = [];
        if (this.name) parts.push(`User name: ${this.name}`);
        if (this.profession) parts.push(`Profession: ${this.profession}`);
        if (this.interests.length) parts.push(`Interests: ${this.interests.slice(0, 5).join(", ")}`);
        if (this.topTopics.length) parts.push(`Frequent topics: ${this.topTopics.slice(0, 5).map(t => t.topic).join(", ")}`);
        parts.push(`Communication style: ${this.communicationStyle}`);
        parts.push(`Expertise: ${this.expertiseLevel}`);
        parts.push(`Plan: ${this.plan}`);
        parts.push(`Messages: ${this.totalMessages}`);
        if (this.facts.length) {
            parts.push(`Known facts: ${this.facts.slice(0, 8).map(f => f.fact).join("; ")}`);
        }
        return parts.length > 0 ? `[USER PROFILE] ${parts.join(" | ")}` : "";
    }
}

// ── Learning Store — persists patterns and strategies ──
class LearningStore {
    constructor() {
        this.patterns = [];         // { input_pattern, best_tools, success_rate, count }
        this.toolPerformance = {};  // { tool: { successes, failures, avgLatency } }
        this.circuitBreakers = {};  // { tool: { failures, lastFail, open } }
    }

    // Load learned patterns from Supabase
    async load(supabase) {
        if (!supabase) return;
        try {
            const { data } = await supabase
                .from("brain_learnings")
                .select("*")
                .order("success_rate", { ascending: false })
                .limit(100);
            if (data) this.patterns = data;
        } catch (e) {
            logger.warn({ component: "LearningStore", err: e.message }, "Load failed (table may not exist)");
        }
    }

    // Record outcome of a conversation
    async recordOutcome(analysis, toolsUsed, success, latency, supabase) {
        // Update tool performance in memory
        for (const tool of toolsUsed) {
            if (!this.toolPerformance[tool]) {
                this.toolPerformance[tool] = { successes: 0, failures: 0, totalLatency: 0, count: 0 };
            }
            const perf = this.toolPerformance[tool];
            if (success) perf.successes++;
            else perf.failures++;
            perf.totalLatency += latency;
            perf.count++;
        }

        // Find or create pattern entry
        const complexity = analysis?.complexity || "simple";
        const topics = (analysis?.topics || []).sort().join(",");
        const key = `${complexity}:${topics}`;

        const existing = this.patterns.find(p => p.pattern_key === key);
        if (existing) {
            existing.count = (existing.count || 0) + 1;
            existing.success_rate = success
                ? Math.min(1, (existing.success_rate || 0.5) + 0.05)
                : Math.max(0, (existing.success_rate || 0.5) - 0.1);
            existing.best_tools = toolsUsed;
            existing.avg_latency = Math.round((existing.avg_latency * (existing.count - 1) + latency) / existing.count);
        } else {
            this.patterns.push({
                pattern_key: key,
                complexity,
                topics,
                best_tools: toolsUsed,
                success_rate: success ? 0.8 : 0.3,
                avg_latency: latency,
                count: 1,
            });
        }

        // Persist to Supabase (async, non-blocking)
        if (supabase) {
            try {
                await supabase.from("brain_learnings").upsert({
                    pattern_key: key,
                    complexity,
                    topics,
                    best_tools: toolsUsed,
                    success_rate: existing ? existing.success_rate : (success ? 0.8 : 0.3),
                    avg_latency: existing ? existing.avg_latency : latency,
                    count: existing ? existing.count : 1,
                    updated_at: new Date().toISOString(),
                }, { onConflict: "pattern_key" });
            } catch (e) { /* ignore persistence failures */ }
        }
    }

    // Get recommended tools for a given analysis
    recommendTools(analysis) {
        const complexity = analysis?.complexity || "simple";
        const topics = (analysis?.topics || []).sort().join(",");
        const key = `${complexity}:${topics}`;
        const match = this.patterns.find(p => p.pattern_key === key && p.success_rate > 0.6);
        return match ? match.best_tools : null;
    }

    // Circuit breaker: check if a tool should be skipped
    isToolBlocked(tool) {
        const cb = this.circuitBreakers[tool];
        if (!cb || !cb.open) return false;
        // Auto-reset after 5 minutes
        if (Date.now() - cb.lastFail > 5 * 60 * 1000) {
            cb.open = false;
            cb.failures = 0;
            return false;
        }
        return true;
    }

    // Record tool failure for circuit breaker
    recordToolFailure(tool) {
        if (!this.circuitBreakers[tool]) {
            this.circuitBreakers[tool] = { failures: 0, lastFail: 0, open: false };
        }
        const cb = this.circuitBreakers[tool];
        cb.failures++;
        cb.lastFail = Date.now();
        if (cb.failures >= 3) {
            cb.open = true;
            logger.warn({ component: "CircuitBreaker", tool, failures: cb.failures },
                `🔴 Circuit breaker OPEN for ${tool} — skipping for 5 min`);
        }
    }

    // Record tool success (reset circuit breaker)
    recordToolSuccess(tool) {
        if (this.circuitBreakers[tool]) {
            this.circuitBreakers[tool].failures = 0;
            this.circuitBreakers[tool].open = false;
        }
    }
}

// ── Autonomous Monitor — periodic self-checks ──
class AutonomousMonitor {
    constructor(brain) {
        this.brain = brain;
        this.interval = null;
        this.lastHealthCheck = null;
        this.alerts = []; // { type, message, timestamp, resolved }
    }

    start(intervalMs = 30 * 60 * 1000) { // default 30 min
        if (this.interval) return;
        this.interval = setInterval(() => this.run(), intervalMs);
        logger.info({ component: "AutonomousMonitor" }, "🤖 Autonomous monitor started (30min loop)");
        // Run first check after 60s
        setTimeout(() => this.run(), 60000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async run() {
        try {
            const report = this.healthCheck();
            this.lastHealthCheck = report;

            // Check for anomalies
            if (report.errorRate > 0.3) {
                this.alert("high_error_rate", `Error rate at ${(report.errorRate * 100).toFixed(0)}% — investigate tools`);
            }
            if (report.memoryMB > 400) {
                this.alert("high_memory", `Memory at ${report.memoryMB}MB — approaching limits`);
            }

            // Persist metrics (async)
            if (this.brain.supabaseAdmin) {
                try {
                    await this.brain.supabaseAdmin.from("brain_metrics").insert({
                        timestamp: new Date().toISOString(),
                        uptime_sec: report.uptimeSec,
                        conversations: report.conversations,
                        error_rate: report.errorRate,
                        memory_mb: report.memoryMB,
                        tool_stats: report.toolStats,
                        tool_errors: report.toolErrors,
                    });
                } catch (e) { /* table may not exist */ }
            }

            logger.info({ component: "AutonomousMonitor", errorRate: report.errorRate, conversations: report.conversations },
                `🤖 Health check: ${report.conversations} convos, ${(report.errorRate * 100).toFixed(0)}% errors, ${report.memoryMB}MB mem`);

        } catch (e) {
            logger.warn({ component: "AutonomousMonitor", err: e.message }, "Health check failed");
        }
    }

    healthCheck() {
        const brain = this.brain;
        const totalOps = Object.values(brain.toolStats).reduce((a, b) => a + b, 0) || 1;
        const totalErrors = Object.values(brain.toolErrors).reduce((a, b) => a + b, 0);
        const mem = process.memoryUsage();

        return {
            uptimeSec: Math.round((Date.now() - brain.startTime) / 1000),
            conversations: brain.conversationCount,
            errorRate: totalErrors / totalOps,
            memoryMB: Math.round(mem.rss / 1024 / 1024),
            heapMB: Math.round(mem.heapUsed / 1024 / 1024),
            toolStats: { ...brain.toolStats },
            toolErrors: { ...brain.toolErrors },
            circuitBreakers: brain.learningStore ? Object.keys(brain.learningStore.circuitBreakers)
                .filter(k => brain.learningStore.circuitBreakers[k].open) : [],
            alerts: this.alerts.filter(a => !a.resolved).length,
            checkedAt: new Date().toISOString(),
        };
    }

    alert(type, message) {
        // Don't spam same alert
        const recent = this.alerts.find(a => a.type === type && !a.resolved && Date.now() - new Date(a.timestamp).getTime() < 30 * 60 * 1000);
        if (recent) return;

        this.alerts.push({ type, message, timestamp: new Date().toISOString(), resolved: false });
        logger.warn({ component: "AutonomousMonitor", type }, `⚠️ ALERT: ${message}`);

        // Keep alerts manageable
        if (this.alerts.length > 50) this.alerts = this.alerts.slice(-30);
    }

    getStatus() {
        return {
            running: !!this.interval,
            lastCheck: this.lastHealthCheck,
            activeAlerts: this.alerts.filter(a => !a.resolved),
            totalAlerts: this.alerts.length,
        };
    }
}

module.exports = { UserProfile, LearningStore, AutonomousMonitor };
