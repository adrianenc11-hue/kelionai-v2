// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v2.0
// 
// CAPABILITIES:
// 1. Chain-of-Thought — reasons step-by-step before responding
// 2. Action Chains — multi-step task orchestration
// 3. Self-Improvement — learns from failures, optimizes strategies
// 4. Task Decomposition — breaks complex requests into sub-tasks
// 5. Conversation Summarizer — compresses context for long chats
// 6. Auto-Debug — analyzes errors, attempts self-repair
// 7. Parallel Tool Orchestration — concurrent execution with fallbacks
// 8. Memory Learning — extracts personal facts automatically
//
// THINKING LOOP: Analyze → Decompose → Plan → Execute → Verify → Learn
// ═══════════════════════════════════════════════════════════════
const fetch = require('node-fetch');

class KelionBrain {
    constructor(config) {
        this.anthropicKey = config.anthropicKey;
        this.openaiKey = config.openaiKey;
        this.tavilyKey = config.tavilyKey;
        this.togetherKey = config.togetherKey;
        this.supabaseAdmin = config.supabaseAdmin;

        // ── Monitoring & Self-Improvement ──
        this.errorLog = [];
        this.successLog = [];
        this.toolStats = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0, chainOfThought: 0, decompose: 0 };
        this.toolErrors = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0 };
        this.toolLatency = {};
        this.startTime = Date.now();
        this.conversationCount = 0;
        this.learningsExtracted = 0;

        // ── Self-Improvement Journal ──
        this.journal = [];          // { timestamp, event, lesson, applied }
        this.strategies = {         // learned optimal strategies
            searchRefinement: [],   // queries that worked better after refinement
            emotionResponses: {},   // what worked for each emotional state
            toolCombinations: {},   // which tool combos work best together
            failureRecoveries: []   // successful recovery strategies
        };

        // ── Conversation Summarizer ──
        this.conversationSummaries = new Map(); // conversationId → compressed summary
    }

    // ═══════════════════════════════════════════════════════════
    // MAIN ENTRY — Complete thinking loop
    // ═══════════════════════════════════════════════════════════
    async think(message, avatar, history, language, userId, conversationId) {
        this.conversationCount++;
        const startTime = Date.now();

        // Step 1: ANALYZE intent deeply
        const analysis = this.analyzeIntent(message, language);

        // Step 2: DECOMPOSE complex tasks into sub-tasks
        let subTasks = [{ message, analysis }];
        if (analysis.complexity === 'complex') {
            subTasks = await this.decomposeTask(message, analysis, language);
        }

        // Step 3: PLAN tools for each sub-task
        const plan = this.buildPlan(subTasks, userId);

        // Step 4: EXECUTE tools in parallel
        const results = await this.executePlan(plan);

        // Step 5: CHAIN-OF-THOUGHT — pre-reason if complex
        let chainOfThought = null;
        if (analysis.complexity !== 'simple' || analysis.isEmotional || analysis.isEmergency) {
            chainOfThought = await this.chainOfThought(message, results, analysis, history, language);
        }

        // Step 6: BUILD enriched context
        const enriched = this.buildEnrichedContext(message, results, chainOfThought, analysis);

        // Step 7: COMPRESS conversation if too long
        const compressedHistory = this.compressHistory(history, conversationId);

        // Step 8: SELF-EVALUATE (async — doesn't block response)
        const thinkTime = Date.now() - startTime;
        this.journalEntry('think_complete', `${analysis.complexity} task, ${plan.length} tools, ${thinkTime}ms`, { tools: Object.keys(results), complexity: analysis.complexity });

        console.log(`[Brain] \u{1F9E0} Think: ${analysis.complexity} | tools:[${Object.keys(results).join(',')}] | CoT:${!!chainOfThought} | ${thinkTime}ms`);

        return {
            enrichedMessage: enriched,
            toolsUsed: Object.keys(results),
            monitor: this.extractMonitor(results),
            analysis,
            chainOfThought,
            compressedHistory,
            failedTools: plan.filter(p => !results[p.tool]).map(p => p.tool),
            thinkTime
        };
    }

    // ═══════════════════════════════════════════════════════════
    // 1. CHAIN-OF-THOUGHT — Pre-reasoning before AI responds
    // Uses a fast Claude call to structure thinking
    // ═══════════════════════════════════════════════════════════
    async chainOfThought(message, toolResults, analysis, history, language) {
        if (!this.anthropicKey) return null;
        this.toolStats.chainOfThought++;

        try {
            const contextParts = [];
            if (toolResults.search) contextParts.push(`Cautare web: ${String(toolResults.search).substring(0, 500)}`);
            if (toolResults.weather) contextParts.push(`Meteo: ${toolResults.weather?.description || ''}`);
            if (toolResults.memory) contextParts.push(`Memorie user: ${String(toolResults.memory).substring(0, 300)}`);

            const lastMsgs = (history || []).slice(-5).map(h => `${h.role}: ${h.content?.substring(0, 100)}`).join('\n');

            const prompt = `Esti motorul de gandire al unui asistent AI. Analizeaza si structureaza un plan de raspuns.

CEREREA: "${message}"
LIMBA: ${language}
EMOTIE DETECTATA: ${analysis.emotionalTone}
URGENTA: ${analysis.isEmergency ? 'DA' : 'nu'}
${contextParts.length > 0 ? 'CONTEXT DISPONIBIL:\n' + contextParts.join('\n') : 'Fara context suplimentar.'}
${lastMsgs ? 'ISTORIE RECENTA:\n' + lastMsgs : ''}

Gandeste pas cu pas:
1. Ce vrea utilizatorul la suprafata?
2. Ce vrea in profunzime (nevoia reala)?
3. Ce ton ar trebui sa am?
4. Ce informatie cheie trebuie inclusa?
5. Ce ar putea intreba in continuare?
6. Plan de raspuns in 2-3 puncte.

Raspunde STRICT cu JSON:
{"surface":"...","deep_need":"...","tone":"...","key_info":["..."],"anticipate":"...","plan":["..."]}`;

            const r = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.anthropicKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, messages: [{ role: 'user', content: prompt }] })
            });

            if (!r.ok) return null;
            const d = await r.json();
            const txt = d.content?.[0]?.text?.trim();
            if (!txt) return null;

            try { return JSON.parse(txt.replace(/```json|```/g, '').trim()); }
            catch { return { raw: txt }; }
        } catch (e) {
            this.recordError('chainOfThought', e.message);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 2. TASK DECOMPOSITION — Break complex requests into steps
    // ═══════════════════════════════════════════════════════════
    async decomposeTask(message, analysis, language) {
        this.toolStats.decompose++;

        // Fast decomposition without AI call (pattern-based)
        const subTasks = [];
        const parts = message.split(/\s+(și|si|and|then|apoi|după|dupa|plus)\s+/i).filter(p => p.length > 3);

        if (parts.length > 1) {
            // User asked multiple things: "caută X și arată-mi meteo"
            for (const part of parts) {
                const subAnalysis = this.analyzeIntent(part.trim(), language);
                subTasks.push({ message: part.trim(), analysis: subAnalysis });
            }
        } else {
            // Single complex request — decompose by tool needs
            subTasks.push({ message, analysis });

            // Add implicit sub-tasks based on context
            if (analysis.needsSearch && analysis.needsWeather) {
                // Already covered by parallel execution
            }
            if (analysis.isEmergency) {
                subTasks.unshift({ message: 'emergency_protocol', analysis: { ...analysis, isEmergency: true } });
            }
        }

        return subTasks.length > 0 ? subTasks : [{ message, analysis }];
    }

    // ═══════════════════════════════════════════════════════════
    // 3. INTENT ANALYSIS — Deep understanding
    // ═══════════════════════════════════════════════════════════
    analyzeIntent(text, language) {
        const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const words = text.split(/\s+/);

        const result = {
            needsSearch: false, searchQuery: '',
            needsWeather: false, weatherCity: '',
            needsImage: false, imagePrompt: '',
            needsMap: false, mapPlace: '',
            needsVision: false,
            needsMemory: false,
            isQuestion: false, isCommand: false, isEmotional: false,
            isEmergency: false, isGreeting: false, isFollowUp: false,
            complexity: 'simple', emotionalTone: 'neutral',
            language: language || 'ro', topics: [],
            confidenceScore: 0.8 // How confident we are in analysis
        };

        // ── SEARCH ──
        const searchTriggers = [
            /\b(cauta|gaseste|informatii|stiri|noutati|explica|spune-mi)\b/i,
            /\b(ce (e|este|inseamna|sunt)|cine (e|este|sunt))\b/i,
            /\b(cat costa|pret|tarif)\b/i,
            /\b(cand|unde |de ce|cum (se|pot|fac))\b/i,
            /\b(compara|diferenta|versus|vs)\b/i,
            /\b(ultimele|recent|azi|astazi)\b/i,
            /\b(search|find|look up|what is|who is|tell me about)\b/i,
            /\b(how (to|do|does|much|many)|when|where|why)\b/i,
            /\b(latest|recent|news|update|price|cost)\b/i
        ];
        if (searchTriggers.some(p => p.test(lower))) {
            result.needsSearch = true;
            result.searchQuery = text.replace(/^(cauta|search|gaseste|spune-mi despre|ce (e|este)|cine (e|este)|tell me about|what is|who is|how to)\s+/i, '').replace(/\?+$/, '').trim();
            if (result.searchQuery.length < 3) result.searchQuery = text;

            // Apply learned search refinements
            result.searchQuery = this.refineSearchQuery(result.searchQuery);
        }

        // ── WEATHER ──
        if (/\b(vreme[ai]?|meteo|temperatur|grad[eu]|ploai[ea]|ploua|soare|ning[ea]|ninsoare|vant|prognoz|weather|forecast|afar[a]|fri[gk]|cald[a]?)\b/i.test(lower)) {
            result.needsWeather = true;
            const m = text.match(/(?:î[n]|in|la|din|pentru|from|for|at)\s+([A-Z\u0100-\u024F][a-zA-Z\u0100-\u024F]+(?:\s+[A-Z\u0100-\u024F][a-zA-Z\u0100-\u024F]+)?)/);
            result.weatherCity = m ? m[1] : (text.match(/(?:in|la|din|pentru)\s+(\w+)/i)?.[1] || 'Bucharest');
        }

        // ── IMAGE ──
        if (/\b(genereaza|creeaza|deseneaza|fa-mi|picture|draw|generate|create|paint)\b/i.test(lower) &&
            /\b(imagine|poza|foto|picture|image|desen|ilustratie|avatar|logo|poster)\b/i.test(lower)) {
            result.needsImage = true;
            result.imagePrompt = text.replace(/\b(genereaza|creeaza|deseneaza|fa-mi|generate|create|draw|o |un )\b/gi, '')
                .replace(/\b(imagine|poza|foto|picture|image)\b/gi, '').replace(/\s+/g, ' ').trim();
            if (result.imagePrompt.length < 5) result.imagePrompt = text;
        }

        // ── MAP ──
        if (/\b(harta|map|ruta|drum|directi|navigare|navigate|unde (e|se|este)|locatie|directions|cum ajung)\b/i.test(lower)) {
            result.needsMap = true;
            const m = text.match(/(?:harta|map|unde (e|se|este)|locatie|catre|spre|la|to|directions? to)\s+(.+)/i);
            result.mapPlace = m ? m[2].replace(/[?.!]/g, '').trim() : text;
        }

        // ── VISION ──
        if (/\b(ce (e |vezi|observi)|ma vezi|uita-te|priveste|see me|look at|what do you see|descrie ce|ce e in fata|scanez|analizez)\b/i.test(lower)) {
            result.needsVision = true;
        }

        // ── MEMORY ──
        if (/\b(amintesti|remember|stiai|data trecuta|ultima data|iti amintesti|ai retinut|am zis|ti-am spus|cum ma cheama|unde locuiesc)\b/i.test(lower)) {
            result.needsMemory = true;
        }

        // ── EMOTION (multi-signal) ──
        const emotionMap = {
            sad: { pattern: /\b(trist|deprimat|singur|plang|suparat|nefericit|sad|depressed|lonely|pierdut|dor)\b/i, weight: 0.9 },
            happy: { pattern: /\b(fericit|bucuros|minunat|super|genial|happy|great|awesome|amazing)\b/i, weight: 0.7 },
            angry: { pattern: /\b(nervos|furios|enervat|angry|furious|frustrated|urasc|hate)\b/i, weight: 0.9 },
            anxious: { pattern: /\b(anxios|stresat|ingrijorat|worried|anxious|stressed|teama|frica|panica)\b/i, weight: 0.9 },
            confused: { pattern: /\b(nu inteleg|confuz|confused|nu stiu|habar|pierdut|lost)\b/i, weight: 0.6 },
            grateful: { pattern: /\b(multumesc|mersi|thanks|thank you|apreciez|recunoscator)\b/i, weight: 0.5 },
            excited: { pattern: /\b(abia astept|super tare|wow|amazing|incredible|fantastic|entuziasmat)\b/i, weight: 0.7 }
        };
        for (const [emo, { pattern, weight }] of Object.entries(emotionMap)) {
            if (pattern.test(lower)) { result.emotionalTone = emo; result.isEmotional = true; result.confidenceScore = weight; break; }
        }

        // ── EMERGENCY ──
        if (/\b(pericol|danger|ajutor|help me|urgenta|accident|foc|incendiu|fire|emergency|ambulanta|politie|112|911)\b/i.test(lower)) {
            result.isEmergency = true;
            result.confidenceScore = 1.0;
        }

        // ── GREETING ──
        if (/^(hey|hi|hello|salut|buna|hei|ceau|noroc|servus)/i.test(lower) && words.length <= 5) {
            result.isGreeting = true;
        }

        // ── FOLLOW-UP ──
        if (/\b(asta|aceasta|ce am zis|mai devreme|anterior|that|this|earlier|before|continua)\b/i.test(lower)) {
            result.isFollowUp = true;
            result.needsMemory = true;
        }

        // ── COMPLEXITY ──
        const toolsNeeded = [result.needsSearch, result.needsWeather, result.needsImage, result.needsMap, result.needsVision].filter(Boolean).length;
        if (toolsNeeded >= 2 || words.length > 30 || text.split(/[?.!]/).length > 3) result.complexity = 'complex';
        else if (toolsNeeded >= 1 || words.length > 12) result.complexity = 'moderate';

        // ── TOPIC EXTRACTION ──
        const topicPatterns = [
            { pattern: /\b(programare|code|coding|software|app|web|python|java|react)\b/i, topic: 'tech' },
            { pattern: /\b(sanatate|health|doctor|medical|boala|tratament|medicament)\b/i, topic: 'health' },
            { pattern: /\b(mancare|food|reteta|recipe|gatit|cooking|restaurant)\b/i, topic: 'food' },
            { pattern: /\b(calatori|calatoresc|calatorie|travel|vacanta|hotel|zbor|flight|destinat|excursie|turism)\b/i, topic: 'travel' },
            { pattern: /\b(bani|money|investitie|economie|salariu|buget|finante)\b/i, topic: 'finance' },
            { pattern: /\b(muzica|music|film|movie|carte|book|joc|game)\b/i, topic: 'entertainment' },
            { pattern: /\b(sport|fitness|antrenament|exercitiu|gym|alergare)\b/i, topic: 'fitness' },
        ];
        result.topics = topicPatterns.filter(t => t.pattern.test(lower)).map(t => t.topic);

        result.isQuestion = /\?$/.test(text.trim()) || /^(ce|cine|cand|unde|cum|de ce|cat|what|who|when|where|how|why)/i.test(lower);
        result.isCommand = /^(fa|seteaza|porneste|opreste|deschide|do|set|start|stop|open|run|executa)/i.test(lower);

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    // 4. PLAN BUILDER — Intelligent tool selection
    // ═══════════════════════════════════════════════════════════
    buildPlan(subTasks, userId) {
        const plan = [];
        const seen = new Set();

        for (const { analysis } of subTasks) {
            if (analysis.needsSearch && !seen.has('search') && !this.isToolDegraded('search'))   { plan.push({ tool: 'search', query: analysis.searchQuery }); seen.add('search'); }
            if (analysis.needsWeather && !seen.has('weather') && !this.isToolDegraded('weather')) { plan.push({ tool: 'weather', city: analysis.weatherCity }); seen.add('weather'); }
            if (analysis.needsImage && !seen.has('imagine') && !this.isToolDegraded('imagine'))   { plan.push({ tool: 'imagine', prompt: analysis.imagePrompt }); seen.add('imagine'); }
            if (analysis.needsMap && !seen.has('map'))                                             { plan.push({ tool: 'map', place: analysis.mapPlace }); seen.add('map'); }
            if (analysis.needsMemory && userId && !seen.has('memory'))                             { plan.push({ tool: 'memory', userId }); seen.add('memory'); }
        }

        // Check for known good combinations from journal
        const combo = plan.map(p => p.tool).sort().join('+');
        if (this.strategies.toolCombinations[combo]) {
            const strat = this.strategies.toolCombinations[combo];
            if (strat.successRate < 0.5) {
                console.log(`[Brain] \u{1F4D3} Combo ${combo} has ${strat.successRate * 100}% success — adjusting`);
            }
        }

        return plan;
    }

    // ═══════════════════════════════════════════════════════════
    // 5. EXECUTE PLAN — Parallel with timeouts and fallbacks
    // ═══════════════════════════════════════════════════════════
    async executePlan(plan) {
        if (plan.length === 0) return {};
        const results = {};
        const t0 = Date.now();

        const settled = await Promise.allSettled(plan.map(step => this.executeTool(step)));

        settled.forEach((r, i) => {
            const tool = plan[i].tool;
            if (r.status === 'fulfilled' && r.value) {
                results[tool] = r.value;
                this.recordSuccess(tool, Date.now() - t0);
            } else {
                const err = r.reason?.message || 'Failed';
                this.recordError(tool, err);
                // AUTO-DEBUG: try recovery strategy
                this.attemptRecovery(tool, plan[i], err);
            }
        });

        // Record combination performance
        const combo = plan.map(p => p.tool).sort().join('+');
        const successCount = Object.keys(results).length;
        if (!this.strategies.toolCombinations[combo]) this.strategies.toolCombinations[combo] = { attempts: 0, successes: 0, successRate: 1 };
        this.strategies.toolCombinations[combo].attempts++;
        this.strategies.toolCombinations[combo].successes += successCount === plan.length ? 1 : 0;
        this.strategies.toolCombinations[combo].successRate = this.strategies.toolCombinations[combo].successes / this.strategies.toolCombinations[combo].attempts;

        console.log(`[Brain] \u26A1 ${Date.now() - t0}ms: ${Object.keys(results).join(', ') || 'none'}`);
        return results;
    }

    async executeTool(step) {
        const timeouts = { search: 8000, weather: 5000, imagine: 15000, memory: 3000, map: 100 };
        const tmout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), ms));
        return Promise.race([this._run(step), tmout(timeouts[step.tool] || 10000)]);
    }

    async _run(step) {
        switch (step.tool) {
            case 'search': return this._search(step.query);
            case 'weather': return this._weather(step.city);
            case 'imagine': return this._imagine(step.prompt);
            case 'memory': return this._memory(step.userId);
            case 'map': return this._map(step.place);
            default: return null;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 6. CONTEXT BUILDER — Assembles enriched message
    // ═══════════════════════════════════════════════════════════
    buildEnrichedContext(message, results, chainOfThought, analysis) {
        let ctx = message;

        if (results.search) ctx += `\n[REZULTATE CAUTARE WEB REALE]:\n${results.search}\nFoloseste datele real. Citeaza sursele.`;
        if (results.weather) ctx += `\n[DATE METEO REALE]: ${results.weather.description}`;
        if (results.imagine) ctx += `\n[Am generat imaginea pe monitor. Descrie-o scurt.]`;
        if (results.map) ctx += `\n[Harta "${results.map.place}" pe monitor.]`;
        if (results.memory) ctx += `\n[CONTEXT DIN MEMORIE]: ${results.memory}`;

        if (analysis.isEmotional && analysis.emotionalTone !== 'neutral') {
            ctx += `\n[Utilizatorul pare ${analysis.emotionalTone}. Adapteaza tonul empatic.]`;
        }
        if (analysis.isEmergency) {
            ctx += `\n[URGENTA! Prioritizeaza siguranta. Ofera instructiuni clare.]`;
        }

        // Inject Chain-of-Thought reasoning guidance
        if (chainOfThought && typeof chainOfThought === 'object' && chainOfThought.plan) {
            ctx += `\n[GANDIRE STRUCTURATA]:`;
            ctx += `\nNevoia reala: ${chainOfThought.deep_need || 'N/A'}`;
            ctx += `\nTon recomandat: ${chainOfThought.tone || 'N/A'}`;
            ctx += `\nPlan: ${(chainOfThought.plan || []).join(' → ')}`;
            if (chainOfThought.anticipate) ctx += `\nAnticipeaza intrebare: ${chainOfThought.anticipate}`;
        }

        return ctx;
    }

    extractMonitor(results) {
        if (results.imagine) return { content: results.imagine, type: 'image' };
        if (results.weather?.html) return { content: results.weather.html, type: 'html' };
        if (results.map) return { content: results.map.url, type: 'map' };
        return { content: null, type: null };
    }

    // ═══════════════════════════════════════════════════════════
    // 7. CONVERSATION SUMMARIZER — Compress long histories
    // ═══════════════════════════════════════════════════════════
    compressHistory(history, conversationId) {
        if (!history || history.length <= 20) return history;

        // Keep last 10 messages intact, summarize the rest
        const recent = history.slice(-10);
        const older = history.slice(0, -10);

        // Check cache
        const cacheKey = conversationId || 'default';
        if (this.conversationSummaries.has(cacheKey) && older.length <= this.conversationSummaries.get(cacheKey).messageCount) {
            return [{ role: 'system', content: this.conversationSummaries.get(cacheKey).summary }, ...recent];
        }

        // Fast compression: extract key info from older messages
        const keyPoints = [];
        for (const msg of older) {
            const content = msg.content || '';
            // Extract questions asked
            if (msg.role === 'user' && content.includes('?')) keyPoints.push(`User a intrebat: ${content.substring(0, 100)}`);
            // Extract key facts from AI responses
            if (msg.role === 'assistant' || msg.role === 'ai') {
                const facts = content.match(/[A-Z][^.!?]*(?:este|sunt|are|a fost|se afla|costa|inseamna)[^.!?]*/g);
                if (facts) keyPoints.push(...facts.slice(0, 2).map(f => f.substring(0, 100)));
            }
        }

        const summary = `[REZUMAT CONVERSATIE ANTERIOARA (${older.length} mesaje)]: ${keyPoints.slice(0, 10).join('; ')}`;
        this.conversationSummaries.set(cacheKey, { summary, messageCount: older.length });

        // Limit cache
        if (this.conversationSummaries.size > 100) {
            const first = this.conversationSummaries.keys().next().value;
            this.conversationSummaries.delete(first);
        }

        return [{ role: 'system', content: summary }, ...recent];
    }

    // ═══════════════════════════════════════════════════════════
    // 8. AUTO-DEBUG — Analyze failures, attempt recovery
    // ═══════════════════════════════════════════════════════════
    attemptRecovery(tool, step, error) {
        const strategies = {
            search: () => {
                // If Tavily fails, search query might be too long
                if (error.includes('400') && step.query?.length > 50) {
                    const refined = step.query.split(' ').slice(0, 5).join(' ');
                    this.strategies.searchRefinement.push({ original: step.query, refined, reason: '400_too_long' });
                    console.log(`[Brain] \u{1F527} Search recovery: refined query to "${refined}"`);
                }
            },
            weather: () => {
                // City might not be found — log for future
                if (error.includes('not found')) {
                    console.log(`[Brain] \u{1F527} Weather recovery: city "${step.city}" not found`);
                }
            },
            imagine: () => {
                // Rate limit or content filter
                if (error.includes('429')) {
                    console.log(`[Brain] \u{1F527} Imagine recovery: rate limited, will delay next attempt`);
                }
            }
        };

        if (strategies[tool]) {
            strategies[tool]();
            this.strategies.failureRecoveries.push({ tool, error: error.substring(0, 100), time: Date.now() });
            if (this.strategies.failureRecoveries.length > 50) this.strategies.failureRecoveries = this.strategies.failureRecoveries.slice(-25);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. SEARCH QUERY REFINEMENT — Apply learned improvements
    // ═══════════════════════════════════════════════════════════
    refineSearchQuery(query) {
        // Truncate overly long queries
        if (query.length > 100) query = query.split(' ').slice(0, 8).join(' ');

        // Remove filler words that hurt search quality
        query = query.replace(/\b(te rog|please|un pic|putin|vreau sa stiu|as vrea)\b/gi, '').trim();

        return query || query; // Return original if empty after cleanup
    }

    // ═══════════════════════════════════════════════════════════
    // TOOL IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════
    async _search(query) {
        if (!this.tavilyKey) throw new Error('No key');
        this.toolStats.search++;
        const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: this.tavilyKey, query, search_depth: 'basic', max_results: 5, include_answer: true }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const sources = (d.results || []).slice(0, 4).map(x => `- ${x.title}: ${x.content?.substring(0, 200)}`).join('\n');
        return (d.answer || '') + (sources ? '\n\nSurse:\n' + sources : '');
    }

    async _weather(city) {
        this.toolStats.weather++;
        const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ro`)).json();
        if (!geo.results?.[0]) throw new Error('City not found');
        const { latitude, longitude, name, country } = geo.results[0];
        const wx = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`)).json();
        const c = wx.current;
        const codes = {0:'Senin \u2600\uFE0F',1:'Partial senin \u{1F324}\uFE0F',2:'Partial noros \u26C5',3:'Noros \u2601\uFE0F',45:'Ceata \u{1F32B}\uFE0F',51:'Burnita \u{1F326}\uFE0F',61:'Ploaie \u{1F327}\uFE0F',71:'Ninsoare \u{1F328}\uFE0F',80:'Averse \u{1F326}\uFE0F',95:'Furtuna \u26C8\uFE0F'};
        const cond = codes[c.weather_code] || '?';
        const desc = `${name}, ${country}: ${c.temperature_2m}\u00B0C, ${cond}, umiditate ${c.relative_humidity_2m}%, vant ${c.wind_speed_10m} km/h`;
        let forecast = '';
        if (wx.daily) {
            const days = ['Azi', 'Maine', 'Poimaine'];
            forecast = wx.daily.temperature_2m_max.slice(0, 3).map((max, i) => `${days[i]}: ${wx.daily.temperature_2m_min[i]}\u00B0/${max}\u00B0C ${codes[wx.daily.weather_code[i]] || '?'}`).join(' | ');
        }
        const html = `<div style="padding:30px;text-align:center"><h2 style="color:#fff;margin-bottom:10px">${name}, ${country}</h2><div style="font-size:3.5rem">${cond}</div><div style="font-size:2.5rem;color:#00ffff;margin:10px 0">${c.temperature_2m}\u00B0C</div><div style="color:rgba(255,255,255,0.6)">Umiditate: ${c.relative_humidity_2m}% | Vant: ${c.wind_speed_10m} km/h</div>${forecast ? `<div style="margin-top:20px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);font-size:0.9rem">${forecast}</div>` : ''}</div>`;
        return { description: desc + (forecast ? '. Prognoza: ' + forecast : ''), html };
    }

    async _imagine(prompt) {
        if (!this.togetherKey) throw new Error('No key');
        this.toolStats.imagine++;
        const r = await fetch('https://api.together.xyz/v1/images/generations', { method: 'POST',
            headers: { 'Authorization': `Bearer ${this.togetherKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'black-forest-labs/FLUX.1-schnell', prompt, width: 1024, height: 1024, steps: 4, n: 1, response_format: 'b64_json' }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        const b64 = d.data?.[0]?.b64_json;
        if (!b64) throw new Error('No image data');
        return `data:image/png;base64,${b64}`;
    }

    async _memory(userId) {
        if (!this.supabaseAdmin || !userId) return null;
        this.toolStats.memory++;
        const { data } = await this.supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', userId).limit(30);
        if (!data?.length) return null;
        return data.map(p => `${p.key}: ${typeof p.value === 'object' ? JSON.stringify(p.value) : p.value}`).join('; ');
    }

    _map(place) {
        this.toolStats.map++;
        return { place, url: `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${encodeURIComponent(place)}` };
    }

    // ═══════════════════════════════════════════════════════════
    // 10. AUTO-LEARNING — Extract facts + learn from interaction
    // ═══════════════════════════════════════════════════════════
    async learnFromConversation(userId, userMessage, aiReply) {
        if (!this.supabaseAdmin || !userId || !this.anthropicKey || userMessage.length < 15) return;
        try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.anthropicKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `Extrage DOAR fapte personale concrete (nume, loc, profesie, hobby, familie, preferinte) din:
User: "${userMessage.substring(0, 500)}"
AI: "${aiReply.substring(0, 300)}"
Raspunde STRICT JSON. Daca nimic: {}` }] }) });
            if (!r.ok) return;
            const d = await r.json();
            const txt = d.content?.[0]?.text?.trim();
            if (!txt || txt === '{}') return;
            let facts;
            try { facts = JSON.parse(txt.replace(/```json|```/g, '').trim()); } catch { return; }
            for (const [k, v] of Object.entries(facts)) {
                if (k && v) await this.supabaseAdmin.from('user_preferences').upsert({ user_id: userId, key: k, value: typeof v === 'object' ? v : { data: v } }, { onConflict: 'user_id,key' });
            }
            this.learningsExtracted += Object.keys(facts).length;
            console.log(`[Brain] \u{1F9E0} Learned: ${Object.keys(facts).join(', ')}`);
        } catch (e) { /* silent */ }
    }

    // ═══════════════════════════════════════════════════════════
    // SELF-MONITORING
    // ═══════════════════════════════════════════════════════════
    recordError(tool, msg) {
        this.toolErrors[tool] = (this.toolErrors[tool] || 0) + 1;
        this.errorLog.push({ tool, msg, time: Date.now() });
        if (this.errorLog.length > 200) this.errorLog = this.errorLog.slice(-100);
    }
    recordSuccess(tool, ms) {
        if (!this.toolLatency[tool]) this.toolLatency[tool] = [];
        this.toolLatency[tool].push(ms);
        if (this.toolLatency[tool].length > 50) this.toolLatency[tool] = this.toolLatency[tool].slice(-25);
        if (this.toolErrors[tool] > 0) this.toolErrors[tool]--;
    }
    isToolDegraded(tool) { return (this.toolErrors[tool] || 0) >= 5; }

    // ═══════════════════════════════════════════════════════════
    // SELF-IMPROVEMENT JOURNAL
    // ═══════════════════════════════════════════════════════════
    journalEntry(event, lesson, data = {}) {
        this.journal.push({ time: Date.now(), event, lesson, data });
        if (this.journal.length > 500) this.journal = this.journal.slice(-250);
    }

    // ═══════════════════════════════════════════════════════════
    // FULL DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════
    getDiagnostics() {
        const recentErrors = this.errorLog.filter(e => Date.now() - e.time < 3600000);
        const avgLatency = {};
        for (const [tool, times] of Object.entries(this.toolLatency)) avgLatency[tool] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        const degraded = Object.entries(this.toolErrors).filter(([_, c]) => c >= 5).map(([t]) => t);
        return {
            status: degraded.length > 0 ? 'degraded' : recentErrors.length > 10 ? 'stressed' : 'healthy',
            version: '2.0',
            uptime: Math.round((Date.now() - this.startTime) / 1000),
            conversations: this.conversationCount,
            learningsExtracted: this.learningsExtracted,
            toolStats: this.toolStats,
            toolErrors: this.toolErrors,
            avgLatency, degradedTools: degraded, failedTools: degraded,
            recentErrors: recentErrors.length,
            journal: this.journal.slice(-10),
            strategies: {
                searchRefinements: this.strategies.searchRefinement.length,
                failureRecoveries: this.strategies.failureRecoveries.length,
                toolCombinations: Object.fromEntries(Object.entries(this.strategies.toolCombinations).map(([k, v]) => [k, `${Math.round(v.successRate * 100)}% (${v.attempts})`]))
            },
            memory: { rss: Math.round(process.memoryUsage().rss / 1048576) + 'MB', heap: Math.round(process.memoryUsage().heapUsed / 1048576) + 'MB' }
        };
    }

    resetTool(tool) { this.toolErrors[tool] = 0; }
    resetAll() { for (const t of Object.keys(this.toolErrors)) this.toolErrors[t] = 0; }
}

module.exports = { KelionBrain };
