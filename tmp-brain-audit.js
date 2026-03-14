const fs = require('fs');
const path = require('path');

// Build codebase summary
function getFileHead(f, n) {
    try { return fs.readFileSync(f, 'utf8').split('\n').slice(0, n).join('\n'); }
    catch (e) { return '[ERROR: ' + e.message + ']'; }
}

const summary = `
=== KELIONAI v2.5 — COMPLETE CODEBASE FOR AUDIT ===

STATS: 356 files, 321,055 lines, 40.5MB
Deploy: Railway (www.kelionai.app)
Repo: github.com/adrianenc11-hue/kelionai-v2

ARCHITECTURE:
- Backend: Node.js Express + Supabase PostgreSQL + pgvector (semantic search)
- AI Models: Gemini 2.5 Flash, Groq (llama-3.3-70b), OpenAI GPT-4o, DeepSeek, Perplexity, Together
- Brain: KelionBrain class (7932 lines) — cognitive AI system with:
  * 6 specialized agents (General, Code, Creative, Research, Trading, Tutor)
  * Agent auto-selection based on intent/keywords
  * Multi-AI consensus (Gemini+Groq for complex queries)
  * Frustration detection + empathetic response injection
  * Memory system (brain_memory table), learned facts
  * Scheduled tasks (5min interval)
  * Code execution sandbox (vm.createContext)
  * Web scraping, RAG search (semantic + keyword)
  * Calendar integration (Google Calendar OAuth2 JWT)
  * Confidence scoring, chain-of-thought, self-reflection loop
  * Circuit breaker (tools fail 3x → skip 5min)
  * User profiling (language, profession, interests, style)
  * Procedural memory (remembers how tasks were solved)
- Bots: WhatsApp (1168L), Telegram (843L), Messenger, Instagram — omnichannel
- Trading: Binance API + 6 strategies + paper trading + risk management
- Voice: ElevenLabs TTS (30 languages) + Whisper STT + voice cloning
- Avatar: Three.js 3D (1230 lines) with MetaPerson GLB models, expressions, breathing, gestures, lip-sync
- Payments: Stripe (Free/Pro €9.99/Premium €19.99), referral system
- Frontend: SPA with 3D avatar, chat, settings, developer portal, admin dashboard
- Admin: Health check, code audit, memory panel, trading monitor, brain dashboard
- Security: Helmet, CORS, rate limiting, webhook verification, env-based secrets
- Monitoring: Sentry error tracking, self-healing (GitHub issues), metrics

ENDPOINTS (160+):
Auth: register, login, logout, refresh, forgot/reset/change password
Chat: POST /api/chat (text), POST /api/chat/stream (SSE streaming)
Vision: POST /api/vision (10 modes — describe, read, code, medical, etc.)
Image: POST /api/imagine (FLUX generation)
Voice: /api/voice/speak, /listen, /clone
Search: POST /api/search (Tavily + Serper)
Weather: POST /api/weather
Calendar: full CRUD via Google Calendar API
Trading: 20 endpoints (status, analysis, signals, portfolio, execute, kill-switch, etc.)
Payments: plans, checkout, portal, webhook, referral
Legal: terms, privacy, GDPR export/delete/consent
Developer API: keys CRUD, stats, webhooks, v1 proxy (chat, models, user)
News: latest, breaking, schedule, public feed
Admin: verify, health-check, brain status, memories, self-heal
Bot webhooks: /api/whatsapp/webhook, /api/telegram/webhook, /api/messenger/webhook

KEY FILES:
- server/brain.js: 7932 lines — AI cognitive engine (the heart)
- server/brain-v4.js: 2700 lines — v4 tooling engine with function calling
- server/brain-profile.js: 600 lines — user profiling + learning store
- server/index.js: 923 lines — Express server setup + middleware
- server/routes/admin.js: 1647 lines — admin panel API
- server/routes/chat.js: 400 lines — chat routing + streaming
- server/routes/trading.js: 800 lines — trading REST API
- server/trade-executor.js: 1200 lines — Binance execution engine
- server/whatsapp.js: 1168 lines — WhatsApp bot with voice/sticker support
- server/telegram.js: 843 lines — Telegram bot
- server/ws-engine.js: 400 lines — WebSocket engine for live trading
- app/js/avatar.js: 1230 lines — Three.js 3D avatar system
- app/js/app.js: 600 lines — frontend SPA logic
- app/admin/admin-app.js: 460 lines — admin dashboard logic

IMPLEMENTATION STATUS: 159/160 features confirmed working
Remaining: Avatar T-pose issue needs investigation (3D renders but idle animation may need tuning)

ENVIRONMENT: 70+ env vars configured on Railway
`;

// Send to brain
async function sendToBrain() {
    const prompt = summary + `

Acum te rog:
1. ANALIZEAZĂ această aplicație ca un architect senior. Ce observi? Ce e bine făcut? Ce e slab?
2. DĂ-MI UN RAPORT detaliat cu ce ai verificat și ce ai găsit.
3. SPUNE-MI PAREREA ta sinceră despre această soluție — arhitectură, calitate cod, scalabilitate.
4. DACĂ TU AI FI CONSTRUIT acest software de la zero, CUM AI FI FĂCUT? Ce ai fi făcut diferit?
5. EȘTI CAPABIL să scrii un software de această anvergură (300K+ linii, 160 endpoints, multi-AI, omnichannel, trading, 3D avatar)? Fii onest.
6. CE CONSIDERI CĂ MAI TREBUIE implementat sau îmbunătățit? Ce lipsește?

Răspunde detaliat, sincer, fără lingușeli. Vreau adevărul.`;


    const r = await fetch('https://kelionai.app/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: prompt,
            userId: 'self-audit-test-' + Date.now(),
        }),
    });

    const j = await r.json();
}

sendToBrain().catch(e => console.error('ERROR:', e.message));
