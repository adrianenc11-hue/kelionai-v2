// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v4.0
// CLAUDE TOOL CALLING — No more 5-layer pipeline
// Claude decides which tools to call, executes them, responds directly
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");
const { MODELS } = require("./config/models");
const { buildSystemPrompt } = require("./persona");

// ── Tool Definitions for Claude ──
const TOOL_DEFINITIONS = [
    {
        name: "search_web",
        description: "Search the internet for current, real-time information. Use for news, facts, prices, events, people, anything requiring up-to-date data.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query in the user's language" },
            },
            required: ["query"],
        },
    },
    {
        name: "get_weather",
        description: "Get current weather and forecast for a city.",
        input_schema: {
            type: "object",
            properties: {
                city: { type: "string", description: "City name, e.g. 'București', 'London'" },
            },
            required: ["city"],
        },
    },
    {
        name: "generate_image",
        description: "Generate an image from a text description using AI (DALL-E).",
        input_schema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Detailed description of the image to generate, in English" },
            },
            required: ["prompt"],
        },
    },
    {
        name: "play_radio",
        description: "Play a live radio station. Available: Kiss FM, Europa FM, Radio ZU, Digi FM, Magic FM, Rock FM, Pro FM, Virgin Radio, Gold FM, Radio Guerrilla, Romantic FM, BBC, CNN, Jazz FM, Classical, Chill, Lo-Fi, Dance, Electronica, Ambient.",
        input_schema: {
            type: "object",
            properties: {
                station: { type: "string", description: "Station name like 'Kiss FM', 'Europa FM', 'Jazz FM', 'Lo-fi'" },
            },
            required: ["station"],
        },
    },
    {
        name: "play_video",
        description: "Search and play a video (YouTube, Netflix, etc.) on the user's screen.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "What to search for, e.g. 'relaxing music', 'cat videos'" },
            },
            required: ["query"],
        },
    },
    {
        name: "open_website",
        description: "Open a website or web page on the user's screen/monitor.",
        input_schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Full URL or search term to navigate to" },
            },
            required: ["url"],
        },
    },
    {
        name: "get_news",
        description: "Get latest news articles, optionally filtered by topic.",
        input_schema: {
            type: "object",
            properties: {
                topic: { type: "string", description: "News topic: 'general', 'tech', 'business', 'sports', 'science', 'health'" },
            },
            required: ["topic"],
        },
    },
    {
        name: "check_system_health",
        description: "Check the health status of all KelionAI systems, APIs, and services.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_trading_intelligence",
        description: "Get cryptocurrency/stock trading analysis, signals, and market intelligence.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "show_map",
        description: "Show a location on Google Maps.",
        input_schema: {
            type: "object",
            properties: {
                place: { type: "string", description: "Place name or address" },
            },
            required: ["place"],
        },
    },
    {
        name: "get_legal_info",
        description: "Get legal information: terms of service, privacy policy, GDPR, refund policy.",
        input_schema: {
            type: "object",
            properties: {
                document: { type: "string", description: "Which document: 'terms', 'privacy', 'gdpr', 'refund', 'cookie'" },
            },
            required: ["document"],
        },
    },
    {
        name: "recall_memory",
        description: "Recall what you remember about the user from past conversations.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
];

// ── Tool executor: maps tool names to brain methods ──
async function executeTool(brain, toolName, toolInput, userId) {
    try {
        switch (toolName) {
            case "search_web":
                return await brain._search(toolInput.query);
            case "get_weather":
                return await brain._weather(toolInput.city);
            case "generate_image":
                return await brain._imagine(toolInput.prompt);
            case "play_radio":
                return await brain._radio(toolInput.station);
            case "play_video":
                return await brain._video(toolInput.query);
            case "open_website":
                return brain._webNav ? await brain._webNav(toolInput.url) : await brain._openURL(toolInput.url);
            case "get_news":
                return await brain._newsAction(toolInput.topic || "general");
            case "check_system_health":
                return await brain._healthCheck();
            case "get_trading_intelligence":
                return await brain._tradeIntelligence();
            case "show_map":
                return await brain._map(toolInput.place);
            case "get_legal_info":
                return await brain._legalAction(toolInput.document);
            case "recall_memory":
                return await brain._memory(userId);
            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (e) {
        logger.warn({ component: "BrainV4", tool: toolName, err: e.message }, `Tool ${toolName} failed`);
        brain.recordError(toolName, e.message);
        return { error: e.message };
    }
}

// ── Extract monitor data from tool results ──
function extractMonitor(toolResults) {
    for (const r of toolResults) {
        if (r.result && typeof r.result === "object") {
            if (r.result.monitorURL) return { content: r.result.monitorURL, type: "url" };
            if (r.result.mapURL) return { content: r.result.mapURL, type: "map" };
            if (r.result.imageUrl) return { content: r.result.imageUrl, type: "image" };
            if (r.result.radioURL || r.result.streamUrl) return { content: r.result.radioURL || r.result.streamUrl, type: "radio" };
            if (r.result.videoURL || r.result.youtubeURL) return { content: r.result.videoURL || r.result.youtubeURL, type: "video" };
        }
    }
    return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: thinkV4 — Claude Tool Calling loop
// ═══════════════════════════════════════════════════════════════
async function thinkV4(brain, message, avatar, history, language, userId, conversationId, mediaData = {}, isAdmin = false) {
    brain.conversationCount++;
    const startTime = Date.now();
    brain._currentMediaData = mediaData || {};

    try {
        // ── 1. Quota check ──
        const quota = await brain.checkQuota(userId);
        if (!quota.allowed) {
            const upgradeMsg = language === "ro"
                ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
                : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
            return { enrichedMessage: upgradeMsg, toolsUsed: [], monitor: { content: null, type: null }, analysis: { complexity: "simple", language }, thinkTime: Date.now() - startTime, confidence: 1.0 };
        }

        // ── 2. Load memory + profile (parallel) ──
        const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
            brain.loadMemory(userId, "text", 20, message),
            brain.loadMemory(userId, "visual", 5, message),
            brain.loadMemory(userId, "audio", 5, message),
            brain.loadFacts(userId, 20),
            brain._loadProfileCached(userId),
        ]);
        const memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
        const profileContext = profile ? profile.toContextString() : "";

        // ── 3. Emotion detection (fast, no AI needed) ──
        const lower = message.toLowerCase();
        let emotionalTone = "neutral";
        let emotionHint = "";
        for (const [emo, { pattern, responseHint }] of Object.entries(brain.constructor.EMOTION_MAP || {})) {
            if (pattern.test(lower)) {
                emotionalTone = emo;
                emotionHint = responseHint || "";
                break;
            }
        }
        const frustration = brain.constructor.detectFrustration ? brain.constructor.detectFrustration(message) : 0;
        if (frustration > 0.6) {
            emotionHint = "User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.";
        }

        // ── 4. Build system prompt with FULL context ──
        const memoryBlock = [profileContext, memoryContext].filter(Boolean).join(" || ");
        const emotionBlock = emotionHint ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}` : "";
        const systemPrompt = buildSystemPrompt(avatar, language, memoryBlock + emotionBlock, "", null);

        // ── 5. Prepare messages for Claude ──
        // Compress history to last 20 messages max
        const recentHistory = (history || []).slice(-20).map(h => ({
            role: h.role === "user" ? "user" : "assistant",
            content: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
        }));

        // Handle vision: if image is provided, add it to the message
        const userContent = [];
        if (mediaData.imageBase64) {
            userContent.push({
                type: "image",
                source: { type: "base64", media_type: mediaData.imageMimeType || "image/jpeg", data: mediaData.imageBase64 },
            });
        }
        userContent.push({ type: "text", text: message });

        const claudeMessages = [...recentHistory, { role: "user", content: userContent.length === 1 ? message : userContent }];

        // ── 6. CALL CLAUDE WITH TOOLS ──
        // First call: Claude decides what tools to use
        let toolsUsed = [];
        let toolResults = [];
        let finalResponse = "";
        let totalTokens = 0;
        const MAX_TOOL_ROUNDS = 3; // Prevent infinite loops

        let currentMessages = claudeMessages;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const claudeBody = {
                model: MODELS.ANTHROPIC_CHAT,
                max_tokens: 2048,
                system: systemPrompt,
                messages: currentMessages,
                tools: TOOL_DEFINITIONS,
            };

            const r = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": brain.anthropicKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(claudeBody),
            });

            if (!r.ok) {
                const errText = await r.text().catch(() => "unknown");
                throw new Error(`Claude API ${r.status}: ${errText.substring(0, 200)}`);
            }

            const response = await r.json();
            totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

            // Check stop reason
            if (response.stop_reason === "end_turn" || response.stop_reason !== "tool_use") {
                // Claude finished — extract text response
                finalResponse = response.content
                    .filter(b => b.type === "text")
                    .map(b => b.text)
                    .join("\n");
                break;
            }

            // Claude wants to use tools
            const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
            if (toolUseBlocks.length === 0) {
                finalResponse = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
                break;
            }

            // Execute all requested tools in parallel
            const toolPromises = toolUseBlocks.map(async (block) => {
                const result = await executeTool(brain, block.name, block.input, userId);
                toolsUsed.push(block.name);
                toolResults.push({ name: block.name, result });
                brain.toolStats[block.name] = (brain.toolStats[block.name] || 0) + 1;
                return {
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: typeof result === "string" ? result : JSON.stringify(result).substring(0, 4000),
                };
            });

            const toolResultBlocks = await Promise.all(toolPromises);

            // Add assistant response + tool results to conversation
            currentMessages = [
                ...currentMessages,
                { role: "assistant", content: response.content },
                { role: "user", content: toolResultBlocks },
            ];
        }

        // ── 7. Post-processing ──
        const thinkTime = Date.now() - startTime;

        // Save memory (async, non-blocking)
        brain.saveMemory(userId, "text", message, { response: finalResponse.substring(0, 200) }, 5).catch(() => { });
        brain.learnFromConversation(userId, message, finalResponse).catch(() => { });
        if (profile) {
            profile.updateFromConversation(message, language, { emotionalTone, topics: [] });
            profile.save(brain.supabaseAdmin).catch(() => { });
        }

        // Track usage
        brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch(() => { });

        // Confidence
        let confidence = 0.7;
        if (toolsUsed.length > 0) confidence += 0.15;
        if (toolsUsed.length > 2) confidence += 0.1;
        confidence = Math.min(1.0, confidence);

        logger.info(
            { component: "BrainV4", tools: toolsUsed, rounds: toolResults.length, thinkTime, tokens: totalTokens },
            `🧠 V4 Think: ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`,
        );

        return {
            enrichedMessage: finalResponse,
            enrichedContext: finalResponse,
            toolsUsed,
            monitor: extractMonitor(toolResults),
            analysis: {
                complexity: toolsUsed.length > 1 ? "complex" : "simple",
                emotionalTone,
                language: language || "ro",
                topics: [],
                isEmotional: emotionalTone !== "neutral",
                frustrationLevel: frustration,
            },
            chainOfThought: null, // Claude does it internally
            compressedHistory: recentHistory,
            failedTools: toolResults.filter(r => r.result?.error).map(r => r.name),
            thinkTime,
            confidence,
            sourceTags: toolsUsed.length > 0 ? ["VERIFIED", ...toolsUsed.map(t => `SOURCE:${t}`)] : ["ASSUMPTION"],
            agent: "v4-claude-tools",
            profileLoaded: !!profile,
        };
    } catch (e) {
        const thinkTime = Date.now() - startTime;
        brain.recordError("thinkV4", e.message);
        logger.error({ component: "BrainV4", err: e.message, thinkTime }, `🧠 V4 Think failed: ${e.message}`);

        // FALLBACK to v3 think
        logger.info({ component: "BrainV4" }, "⚠️ Falling back to v3 think");
        try {
            return await brain.think(message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
        } catch (e2) {
            return {
                enrichedMessage: message,
                toolsUsed: [],
                monitor: { content: null, type: null },
                analysis: { complexity: "simple", language: language || "ro", emotionalTone: "neutral", topics: [] },
                chainOfThought: null,
                compressedHistory: history || [],
                failedTools: [],
                thinkTime,
                confidence: 0.3,
            };
        }
    }
}

module.exports = { thinkV4, TOOL_DEFINITIONS };
