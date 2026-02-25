// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v1.0
// Autonomous thinking: Analyze → Plan → Execute → Verify → Learn
// Self-repair, parallel tool orchestration, memory extraction
// ═══════════════════════════════════════════════════════════════
const fetch = require('node-fetch');

class KelionBrain {
    constructor(config) {
        this.anthropicKey = config.anthropicKey;
        this.openaiKey = config.openaiKey;
        this.tavilyKey = config.tavilyKey;
        this.togetherKey = config.togetherKey;
        this.supabaseAdmin = config.supabaseAdmin;
        
        // Self-monitoring
        this.errorLog = [];
        this.toolStats = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0 };
        this.toolErrors = { search: 0, weather: 0, imagine: 0, vision: 0, memory: 0, map: 0 };
        this.toolLatency = {};
        this.startTime = Date.now();
        this.conversationCount = 0;
        this.learningsExtracted = 0;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: ANALYZE — Deep intent understanding
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
            isQuestion: false,
            isCommand: false,
            isEmotional: false,
            isEmergency: false,
            isGreeting: false,
            isFollowUp: false,
            complexity: 'simple',
            emotionalTone: 'neutral',
            language: language || 'ro'
        };

        // ─── SEARCH ──────────────────────────────────────────
        const searchTriggers = [
            /\b(cauta|gaseste|informatii|stiri|noutati|explica|spune-mi)\b/i,
            /\b(ce (e|este|inseamna|sunt)|cine (e|este|sunt))\b/i,
            /\b(cat costa|pret|tarif)\b/i,
            /\b(cand|unde |de ce|cum (se|pot|fac))\b/i,
            /\b(compara|diferenta|versus|vs)\b/i,
            /\b(ultimele|recent|azi|astazi)\b/i,
            /\b(search|find|look up|what is|who is|tell me about)\b/i,
            /\b(how (to|do|does|much|many)|when|where|why)\b/i,
            /\b(latest|recent|news|update|price|cost)\b/i,
            /\b(compare|difference|between)\b/i
        ];
        if (searchTriggers.some(p => p.test(lower))) {
            result.needsSearch = true;
            result.searchQuery = text.replace(/^(cauta|search|gaseste|spune-mi despre|ce (e|este)|cine (e|este)|tell me about|what is|who is|how to)\s+/i, '').replace(/\?+$/, '').trim();
            if (result.searchQuery.length < 3) result.searchQuery = text;
        }

        // ─── WEATHER ─────────────────────────────────────────
        if (/\b(vreme|meteo|temperatur|grad[eu]|ploaie|ploua|soare|ninge|vant|prognoz|weather|forecast|afara|frig|cald)\b/i.test(lower)) {
            result.needsWeather = true;
            const cityPatterns = [
                /(?:in|la|din|pentru|from|for|at)\s+([A-Z][a-zA-Z\u0100-\u024F]+(?:\s+[A-Z][a-zA-Z\u0100-\u024F]+)?)/,
                /(?:in|la|din|pentru)\s+(\w+)/i
            ];
            for (const p of cityPatterns) {
                const m = text.match(p);
                if (m) { result.weatherCity = m[1]; break; }
            }
            if (!result.weatherCity) result.weatherCity = 'Bucharest';
        }

        // ─── IMAGE GENERATION ────────────────────────────────
        if (/\b(genereaza|creeaza|deseneaza|fa-mi|picture|draw|generate|create|paint)\b/i.test(lower) &&
            /\b(imagine|poza|foto|picture|image|desen|ilustratie|avatar|logo|poster)\b/i.test(lower)) {
            result.needsImage = true;
            result.imagePrompt = text.replace(/\b(genereaza|creeaza|deseneaza|fa-mi|generate|create|draw|o |un )\b/gi, '').replace(/\b(imagine|poza|foto|picture|image)\b/gi, '').replace(/\s+/g, ' ').trim();
            if (result.imagePrompt.length < 5) result.imagePrompt = text;
        }

        // ─── MAP ─────────────────────────────────────────────
        if (/\b(harta|map|ruta|drum|directi|navigare|navigate|unde (e|se|este)|locatie|directions|cum ajung)\b/i.test(lower)) {
            result.needsMap = true;
            const m = text.match(/(?:harta|map|unde (e|se|este)|locatie|catre|spre|la|to|directions? to)\s+(.+)/i);
            result.mapPlace = m ? m[2].replace(/[?.!]/g, '').trim() : text;
        }

        // ─── VISION ──────────────────────────────────────────
        if (/\b(ce (e |vezi|observi)|ma vezi|uita-te|priveste|see me|look at|what do you see|descrie ce|ce e in fata|scanez|analizez)\b/i.test(lower)) {
            result.needsVision = true;
        }

        // ─── MEMORY RECALL ───────────────────────────────────
        if (/\b(amintesti|remember|stiai|data trecuta|ultima data|iti amintesti|ai retinut|am zis|ti-am spus|cum ma cheama|unde locuiesc)\b/i.test(lower)) {
            result.needsMemory = true;
        }

        // ─── EMOTION ─────────────────────────────────────────
        const emotions = {
            sad: /\b(trist|deprimat|singur|plang|suparat|nefericit|sad|depressed|lonely)\b/i,
            happy: /\b(fericit|bucuros|minunat|super|genial|happy|great|awesome|multumesc)\b/i,
            angry: /\b(nervos|furios|enervat|angry|furious|frustrated|urasc)\b/i,
            anxious: /\b(anxios|stresat|ingrijorat|worried|anxious|stressed|teama|frica)\b/i,
            confused: /\b(nu inteleg|confuz|confused|nu stiu|habar)\b/i
        };
        for (const [emo, pat] of Object.entries(emotions)) {
            if (pat.test(lower)) { result.emotionalTone = emo; result.isEmotional = true; break; }
        }

        // ─── EMERGENCY ───────────────────────────────────────
        if (/\b(pericol|danger|ajutor|help me|urgenta|accident|foc|incendiu|fire|emergency|ambulanta)\b/i.test(lower)) {
            result.isEmergency = true;
        }

        // ─── GREETING ────────────────────────────────────────
        if (/^(hey|hi|hello|salut|buna|hei|ceau|noroc)/i.test(lower) && words.length <= 5) {
            result.isGreeting = true;
        }

        // ─── FOLLOW-UP ──────────────────────────────────────
        if (/\b(asta|aceasta|ce am zis|mai devreme|anterior|that|this|earlier|before)\b/i.test(lower)) {
            result.isFollowUp = true;
            result.needsMemory = true;
        }

        // ─── COMPLEXITY ──────────────────────────────────────
        const toolsNeeded = [result.needsSearch, result.needsWeather, result.needsImage, result.needsMap, result.needsVision].filter(Boolean).length;
        if (toolsNeeded >= 2 || words.length > 30) result.complexity = 'complex';
        else if (toolsNeeded >= 1 || words.length > 12) result.complexity = 'moderate';

        result.isQuestion = /\?$/.test(text.trim()) || /^(ce|cine|cand|unde|cum|de ce|cat|what|who|when|where|how|why)/i.test(lower);
        result.isCommand = /^(fa|seteaza|porneste|opreste|deschide|do|set|start|stop|open|run)/i.test(lower);

        return result;
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: THINK — Plan + Execute tools in parallel
    // ═══════════════════════════════════════════════════════════
    async think(message, avatar, history, language, userId) {
        this.conversationCount++;
        const analysis = this.analyzeIntent(message, language);
        const plan = [];
        const results = {};

        if (analysis.needsSearch && !this.isToolDegraded('search'))   plan.push({ tool: 'search', query: analysis.searchQuery });
        if (analysis.needsWeather && !this.isToolDegraded('weather')) plan.push({ tool: 'weather', city: analysis.weatherCity });
        if (analysis.needsImage && !this.isToolDegraded('imagine'))   plan.push({ tool: 'imagine', prompt: analysis.imagePrompt });
        if (analysis.needsMap)                                         plan.push({ tool: 'map', place: analysis.mapPlace });
        if (analysis.needsMemory && userId)                            plan.push({ tool: 'memory', userId });

        if (plan.length > 0) {
            console.log(`[Brain] \u{1F9E0} Plan: ${plan.map(p => p.tool).join(' + ')} | ${analysis.complexity}`);
            const t0 = Date.now();
            const settled = await Promise.allSettled(plan.map(s => this.executeTool(s)));
            settled.forEach((r, i) => {
                const tool = plan[i].tool;
                if (r.status === 'fulfilled' && r.value) { results[tool] = r.value; this.recordSuccess(tool, Date.now() - t0); }
                else { this.recordError(tool, r.reason?.message || 'Failed'); }
            });
            console.log(`[Brain] \u26A1 ${Date.now() - t0}ms: ${Object.keys(results).join(', ') || 'none'}`);
        }

        let enriched = '';
        const monitor = { content: null, type: null };

        if (results.search) enriched += `\n[REZULTATE CAUTARE WEB REALE]:\n${results.search}\nFoloseste datele. Citeaza surse.`;
        if (results.weather) { enriched += `\n[DATE METEO REALE]: ${results.weather.description}`; monitor.content = results.weather.html; monitor.type = 'html'; }
        if (results.imagine) { enriched += `\n[Am generat imaginea pe monitor. Descrie-o scurt.]`; monitor.content = results.imagine; monitor.type = 'image'; }
        if (results.map) { enriched += `\n[Harta "${results.map.place}" pe monitor.]`; monitor.content = results.map.url; monitor.type = 'map'; }
        if (results.memory) enriched += `\n[CONTEXT DIN MEMORIE]: ${results.memory}`;
        if (analysis.isEmotional) enriched += `\n[Utilizatorul pare ${analysis.emotionalTone}. Adapteaza tonul.]`;
        if (analysis.isEmergency) enriched += `\n[URGENTA! Prioritizeaza siguranta.]`;

        return {
            enrichedMessage: enriched ? message + enriched : message,
            toolsUsed: Object.keys(results),
            monitor,
            analysis,
            failedTools: plan.filter(p => !results[p.tool]).map(p => p.tool)
        };
    }

    // ═══════════════════════════════════════════════════════════
    // TOOL RUNNERS
    // ═══════════════════════════════════════════════════════════
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
    // SELF-REPAIR
    // ═══════════════════════════════════════════════════════════
    recordError(tool, msg) { this.toolErrors[tool] = (this.toolErrors[tool] || 0) + 1; this.errorLog.push({ tool, msg, time: Date.now() }); if (this.errorLog.length > 200) this.errorLog = this.errorLog.slice(-100); console.warn(`[Brain] \u26A0\uFE0F ${tool} err(${this.toolErrors[tool]}): ${msg}`); }
    recordSuccess(tool, ms) { if (!this.toolLatency[tool]) this.toolLatency[tool] = []; this.toolLatency[tool].push(ms); if (this.toolLatency[tool].length > 50) this.toolLatency[tool] = this.toolLatency[tool].slice(-25); if (this.toolErrors[tool] > 0) this.toolErrors[tool]--; }
    isToolDegraded(tool) { return (this.toolErrors[tool] || 0) >= 5; }

    // ═══════════════════════════════════════════════════════════
    // AUTO-LEARNING
    // ═══════════════════════════════════════════════════════════
    async learnFromConversation(userId, userMessage, aiReply) {
        if (!this.supabaseAdmin || !userId || !this.anthropicKey || userMessage.length < 15) return;
        try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.anthropicKey, 'anthropic-version': '2023-06-01' },
                body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `Extrage DOAR fapte personale concrete (nume, loc, profesie, hobby, familie) din:
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
    // DIAGNOSTICS
    // ═══════════════════════════════════════════════════════════
    getDiagnostics() {
        const recentErrors = this.errorLog.filter(e => Date.now() - e.time < 3600000);
        const avgLatency = {};
        for (const [tool, times] of Object.entries(this.toolLatency)) avgLatency[tool] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        const degraded = Object.entries(this.toolErrors).filter(([_, c]) => c >= 5).map(([t]) => t);
        return { status: degraded.length > 0 ? 'degraded' : recentErrors.length > 10 ? 'stressed' : 'healthy', uptime: Math.round((Date.now() - this.startTime) / 1000), conversations: this.conversationCount, learningsExtracted: this.learningsExtracted, toolStats: this.toolStats, toolErrors: this.toolErrors, avgLatency, degradedTools: degraded, failedTools: degraded, recentErrors: recentErrors.length, memory: { rss: Math.round(process.memoryUsage().rss / 1048576) + 'MB', heap: Math.round(process.memoryUsage().heapUsed / 1048576) + 'MB' } };
    }

    resetTool(tool) { this.toolErrors[tool] = 0; }
    resetAll() { for (const t of Object.keys(this.toolErrors)) this.toolErrors[t] = 0; }
}

module.exports = { KelionBrain };
