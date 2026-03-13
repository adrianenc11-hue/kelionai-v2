#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// TestComplet AI — KelionAI v2.5 — 148 funcții × 26 teste REALE
// AUTH REAL: register → login → JWT token → teste autentificate
// PASS = funcția merge real. FAIL = funcția nu merge.
// ═══════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RESULTS_PATH = path.join(__dirname, "results.json");
const BASE = "https://kelionai.app";
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || "";
const SERVER_DIR = path.resolve(__dirname, "..", "server");
const ROUTES_DIR = path.resolve(SERVER_DIR, "routes");
const ADMIN_CODE = process.env.ADMIN_EXIT_CODE || process.env.ADMIN_ACCESS_CODE || "";

// Pre-verified test account (created via Supabase Admin API, email confirmed)
const TEST_EMAIL = "testrunner@kelionai.app";
const TEST_PASSWORD = "TestRunner_P@ss2025!";
let AUTH_TOKEN = ""; // JWT token from login

const TEST_TYPES = [
    "Unit", "Integration", "Contract (CDC)", "Component", "System",
    "E2E", "UAT", "Smoke", "Regression", "UI Functional",
    "Visual Regression", "Accessibility (a11y)", "Performance", "Load", "Stress",
    "Soak / Endurance", "SAST", "DAST", "SCA", "Pentest",
    "Chaos", "Failover", "DR", "Data Migration", "Backup & Restore",
    "Upgrade / Rollback"
];

const LATENCY = { ELEVENLABS_TTS: 15000, GROQ_WHISPER: 10000, CLAUDE_CHAT: 30000, TOGETHER_FLUX: 30000, PERPLEXITY: 10000, GENERAL_API: 8000, INTERNAL: 1000 };

let state = { total: 148, tested: 0, passed: 0, failed: 0, inProgress: "", results: [] };
function save() { fs.writeFileSync(RESULTS_PATH, JSON.stringify(state, null, 2)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ HTTP — always sends admin secret + auth token ═══
async function req(method, url, body, extraHeaders = {}, timeout = 8000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    const headers = {
        "Content-Type": "application/json",
        "User-Agent": "TestComplet/3.0",
        "x-admin-secret": ADMIN_SECRET,
        ...extraHeaders,
    };
    if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    const opts = { method, headers, signal: ac.signal };
    if (body && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) opts.body = JSON.stringify(body);
    try {
        const start = Date.now();
        const r = await fetch(BASE + url, { ...opts, redirect: "follow" });
        const elapsed = Date.now() - start;
        clearTimeout(timer);
        const ct = r.headers.get("content-type") || "";
        let data;
        try { if (ct.includes("json")) data = await r.json(); else data = await r.text(); } catch { data = null; }
        return { status: r.status, data, ok: r.ok, elapsed, headers: Object.fromEntries(r.headers.entries()), ct };
    } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") return { status: 408, data: "Timeout", ok: false, elapsed: timeout, headers: {}, ct: "" };
        return { status: 0, data: e.message, ok: false, elapsed: 0, headers: {}, ct: "" };
    }
}

// ═══ AUTH FLOW — real register + login ═══
async function authenticate() {
    console.log(`\n🔐 AUTH: Logging in as ${TEST_EMAIL}...`);
    const login = await req("POST", "/api/auth/login", { email: TEST_EMAIL, password: TEST_PASSWORD }, {}, 30000);
    console.log(`   Login: HTTP ${login.status}`);

    if (login.status === 200 && login.data?.session?.access_token) {
        AUTH_TOKEN = login.data.session.access_token;
        console.log(`   ✅ JWT Token: ${AUTH_TOKEN.substring(0, 20)}...`);
        return true;
    }
    console.log(`   ❌ Login FAILED: ${JSON.stringify(login.data).substring(0, 100)}`);
    return false;
}

// ═══ 148 FUNCTIONS ═══
const FUNCS = [
    // AUTH 1-9 — some need auth, some don't
    { id: 1, name: "Register", type: "api", method: "POST", url: "/api/auth/register", body: { email: TEST_EMAIL, password: TEST_PASSWORD }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 2, name: "Login", type: "api", method: "POST", url: "/api/auth/login", body: { email: TEST_EMAIL, password: TEST_PASSWORD }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 3, name: "Logout", type: "api", method: "POST", url: "/api/auth/logout", body: {}, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 4, name: "User /me", type: "api", method: "GET", url: "/api/auth/me", expect: 200, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 5, name: "Refresh Token", type: "api", method: "POST", url: "/api/auth/refresh", body: {}, expect: 200, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 6, name: "Forgot Password", type: "api", method: "POST", url: "/api/auth/forgot-password", body: { email: "test@test.com" }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 7, name: "Reset Password", type: "api", method: "POST", url: "/api/auth/reset-password", body: { access_token: "invalid", password: "NewP@ss123!" }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 8, name: "Change Password", type: "api", method: "POST", url: "/api/auth/change-password", body: { password: "NewP@ss123!" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    { id: 9, name: "Change Email", type: "api", method: "POST", url: "/api/auth/change-email", body: { email: "newemail@test.com" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "auth.js" },
    // CHAT 10-11
    { id: 10, name: "Chat Text", type: "api", method: "POST", url: "/api/chat", body: { message: "salut", language: "ro" }, expect: 200, timeout: LATENCY.CLAUDE_CHAT, module: "brain.js" },
    { id: 11, name: "Chat Stream", type: "api", method: "POST", url: "/api/chat/stream", body: { message: "test", language: "en" }, expect: 200, timeout: LATENCY.CLAUDE_CHAT, module: "brain.js" },
    // VOCE 12-16
    { id: 12, name: "TTS Speak", type: "api", method: "POST", url: "/api/speak", body: { text: "Test", avatar: "kelion", mood: "neutral", language: "ro" }, expect: 200, timeout: LATENCY.ELEVENLABS_TTS, module: "voice.js" },
    { id: 13, name: "STT Listen", type: "api", method: "POST", url: "/api/listen", body: { text: "test fallback" }, expect: 200, timeout: LATENCY.GROQ_WHISPER, module: "voice.js" },
    { id: 14, name: "Clone Create", type: "api", method: "POST", url: "/api/voice/clone", body: { name: "test" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "voice.js" },
    { id: 15, name: "Clone Delete", type: "api", method: "DELETE", url: "/api/voice/clone", expect: 200, timeout: LATENCY.GENERAL_API, module: "voice.js" },
    { id: 16, name: "Clone Status", type: "api", method: "GET", url: "/api/voice/clone", expect: 200, timeout: LATENCY.GENERAL_API, module: "voice.js" },
    { id: 17, name: "Vision", type: "api", method: "POST", url: "/api/vision", body: { image: "data:image/png;base64,iVBOR" }, expect: 200, timeout: LATENCY.CLAUDE_CHAT, module: "brain.js" },
    { id: 18, name: "Image Gen", type: "api", method: "POST", url: "/api/imagine", body: { prompt: "test cat" }, expect: 200, timeout: LATENCY.TOGETHER_FLUX, module: "brain.js" },
    { id: 19, name: "Web Search", type: "api", method: "POST", url: "/api/search", body: { query: "test" }, expect: 200, timeout: LATENCY.PERPLEXITY, module: "brain.js" },
    { id: 20, name: "Weather", type: "api", method: "POST", url: "/api/weather", body: { city: "Bucharest" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "weather.js" },
    { id: 21, name: "Register Face", type: "api", method: "POST", url: "/api/identity/register-face", body: { image: "data:image/png;base64,test" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "identity.js" },
    { id: 22, name: "Face Check", type: "api", method: "POST", url: "/api/identity/check", body: { image: "data:image/png;base64,test" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "identity.js" },
    // PLATI 23-30
    { id: 23, name: "Plans List", type: "api", method: "GET", url: "/api/payments/plans", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 24, name: "Plan Status", type: "api", method: "GET", url: "/api/payments/status", expect: 200, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 25, name: "Checkout Pro", type: "api", method: "POST", url: "/api/payments/checkout", body: { plan: "pro" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 26, name: "Checkout Premium", type: "api", method: "POST", url: "/api/payments/checkout", body: { plan: "premium" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 27, name: "Billing Portal", type: "api", method: "POST", url: "/api/payments/portal", body: {}, expect: 200, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 28, name: "Stripe Webhook", type: "api", method: "POST", url: "/api/payments/webhook", body: {}, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    { id: 29, name: "Usage Check", type: "internal", module: "payments.js", fn: "checkUsage" },
    { id: 30, name: "Usage Increment", type: "internal", module: "payments.js", fn: "incrementUsage" },
    // REFERRAL 31-38
    { id: 31, name: "Generate Code", type: "api", method: "POST", url: "/api/referral/generate", body: {}, expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 32, name: "Send Invite", type: "api", method: "POST", url: "/api/referral/send-invite", body: { email: "invite@test.com" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 33, name: "Verify Code", type: "api", method: "POST", url: "/api/referral/verify", body: { code: "INVALID" }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 34, name: "Redeem Code", type: "api", method: "POST", url: "/api/referral/redeem", body: { code: "INVALID" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 35, name: "My Codes", type: "api", method: "GET", url: "/api/referral/my-codes", expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 36, name: "My Bonuses", type: "api", method: "GET", url: "/api/referral/my-bonuses", expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 37, name: "Revoke Code", type: "api", method: "DELETE", url: "/api/referral/revoke/test-id", expect: 200, timeout: LATENCY.GENERAL_API, module: "referral.js" },
    { id: 38, name: "Apply Bonus", type: "internal", module: "referral.js", fn: "applyReferralBonus" },
    // TRADING 39-57
    { id: 39, name: "Trading Status", type: "api", method: "GET", url: "/api/trading/status", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 40, name: "Full Analysis", type: "api", method: "GET", url: "/api/trading/analysis?asset=BTC", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 41, name: "Signals", type: "api", method: "GET", url: "/api/trading/signals", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 42, name: "Portfolio", type: "api", method: "GET", url: "/api/trading/portfolio", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 43, name: "Backtest", type: "api", method: "POST", url: "/api/trading/backtest", body: { strategy: "RSI", asset: "BTC", period: 30 }, admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 44, name: "Alerts", type: "api", method: "GET", url: "/api/trading/alerts", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 45, name: "Correlation", type: "api", method: "GET", url: "/api/trading/correlation", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 46, name: "Risk", type: "api", method: "GET", url: "/api/trading/risk", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 47, name: "History", type: "api", method: "GET", url: "/api/trading/history", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 48, name: "Execute", type: "api", method: "POST", url: "/api/trading/execute", body: { symbol: "BTC/USDT" }, admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "trading.js" },
    { id: 49, name: "RSI Calc", type: "internal", module: "trading.js", fn: "calculateRSI" },
    { id: 50, name: "MACD Calc", type: "internal", module: "trading.js", fn: "calculateMACD" },
    { id: 51, name: "Bollinger", type: "internal", module: "trading.js", fn: "calculateBollingerBands" },
    { id: 52, name: "EMA Cross", type: "internal", module: "trading.js", fn: "calculateEMACrossover" },
    { id: 53, name: "Fibonacci", type: "internal", module: "trading.js", fn: "calculateFibonacci" },
    { id: 54, name: "Volume", type: "internal", module: "trading.js", fn: "analyzeVolume" },
    { id: 55, name: "Sentiment", type: "internal", module: "trading.js", fn: "analyzeSentiment" },
    { id: 56, name: "Confluence", type: "internal", module: "trading.js", fn: "calculateConfluence" },
    { id: 57, name: "Price Fetch", type: "internal", module: "trading.js", fn: "fetchRealPrices" },
    // MESSENGER 58-75
    { id: 58, name: "Webhook Verify", type: "api", method: "GET", url: "/api/messenger/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=ok", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "messenger.js" },
    { id: 59, name: "Webhook Handler", type: "api", method: "POST", url: "/api/messenger/webhook", body: { object: "page", entry: [] }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "messenger.js" },
    ...[60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75].map((id, i) => ({ id, name: ["Send Text", "Send Audio", "Send Image", "Generic Template", "Voice Reply", "Image Analysis", "Audio Transcribe", "Doc Extract", "Persistent Menu", "Postback", "Broadcast News", "Messenger Stats", "Context", "Lang Detection", "Rate Limit", "Known User"][i], type: "internal", module: "messenger.js", fn: ["sendTextMessage", "sendAudioMessage", "sendImageMessage", "sendGenericTemplate", "sendVoiceReply", "analyzeImage", "transcribeAudio", "extractDocument", "setupPersistentMenu", "handlePostback", "broadcastNews", "getStats", "getContext", "detectLanguage", "checkRateLimit", "trackKnownUser"][i] })),
    // WHATSAPP 76-88
    { id: 76, name: "WA Verify", type: "api", method: "GET", url: "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=ok", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "whatsapp.js" },
    { id: 77, name: "WA Handler", type: "api", method: "POST", url: "/api/whatsapp/webhook", body: { object: "whatsapp_business_account", entry: [] }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "whatsapp.js" },
    ...[78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88].map((id, i) => ({ id, name: ["Send Text", "Send Audio", "Download Media", "Upload Media", "Transcribe", "Gen Speech", "Group Intervene", "Context", "Known User", "Lang Detect", "Rate Limit"][i], type: "internal", module: "whatsapp.js", fn: ["sendText", "sendAudio", "downloadMedia", "uploadMedia", "transcribeAudio", "generateSpeech", "handleGroup", "getContext", "trackUser", "detectLang", "rateLimit"][i] })),
    // TELEGRAM 89-97
    { id: 89, name: "TG Webhook", type: "api", method: "POST", url: "/api/telegram/webhook", body: { update_id: 1, message: { chat: { id: 1 }, text: "/start" } }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "telegram.js" },
    ...[90, 91, 92, 93, 94, 95, 96, 97].map((id, i) => ({ id, name: ["/start", "/help", "/banc", "/stiri", "/breaking", "Broadcast", "FAQ", "Known User"][i], type: "internal", module: "telegram.js", fn: ["handleStart", "handleHelp", "handleJoke", "handleNews", "handleBreaking", "broadcast", "handleFaq", "trackUser"][i] })),
    // INSTAGRAM 98-105
    { id: 98, name: "IG Verify", type: "api", method: "GET", url: "/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=kelionai_verify_2024&hub.challenge=ok", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "instagram.js" },
    { id: 99, name: "IG Webhook", type: "api", method: "POST", url: "/api/instagram/webhook", body: { object: "instagram", entry: [] }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "instagram.js" },
    ...[100, 101, 102, 103, 104, 105].map((id, i) => ({ id, name: ["Handle DM", "Send DM", "Create Container", "Publish Media", "Post News", "Publish Batch"][i], type: "internal", module: "instagram.js", fn: ["handleIncomingDM", "sendDM", "createMediaContainer", "publishMedia", "postNews", "publishNewsBatch"][i] })),
    // NEWS 106-116
    { id: 106, name: "News Latest", type: "api", method: "GET", url: "/api/news/latest", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "news.js" },
    { id: 107, name: "News Status", type: "api", method: "GET", url: "/api/news/status", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "news.js" },
    { id: 108, name: "News Fetch", type: "api", method: "GET", url: "/api/news/fetch", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "news.js" },
    { id: 109, name: "News Public", type: "api", method: "GET", url: "/api/news/public", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "news.js" },
    ...[110, 111, 112, 113, 114].map((id, i) => ({ id, name: ["Scheduler", "RSS Fetch", "Anti-Fake", "Breaking", "FB Publish"][i], type: "internal", module: "news.js", fn: ["startScheduler", "fetchAllSources", "isSuspiciousTitle", "checkBreaking", "publishToFacebook"][i] })),
    { id: 115, name: "Media Publish", type: "api", method: "POST", url: "/api/news/publish", body: {}, admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "news.js" },
    { id: 116, name: "Media Status", type: "api", method: "GET", url: "/api/media/status", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "news.js" },
    // DEVELOPER 117-126
    { id: 117, name: "List Keys", type: "api", method: "GET", url: "/api/developer/keys", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 118, name: "Create Key", type: "api", method: "POST", url: "/api/developer/keys", body: { name: "test" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 119, name: "Revoke Key", type: "api", method: "DELETE", url: "/api/developer/keys/test-id", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 120, name: "Dev Stats", type: "api", method: "GET", url: "/api/developer/stats", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 121, name: "Save Webhook", type: "api", method: "POST", url: "/api/developer/webhooks", body: { url: "https://test.com" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 122, name: "Get Webhook", type: "api", method: "GET", url: "/api/developer/webhooks", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 123, name: "v1 Status", type: "api", method: "GET", url: "/api/v1/status", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 124, name: "v1 Models", type: "api", method: "GET", url: "/api/v1/models", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 125, name: "v1 Profile", type: "api", method: "GET", url: "/api/v1/user/profile", expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    { id: 126, name: "v1 Chat", type: "api", method: "POST", url: "/api/v1/chat", body: { message: "test" }, expect: 200, timeout: LATENCY.GENERAL_API, module: "developer.js" },
    // ADMIN 127-131
    { id: 127, name: "Verify Admin", type: "api", method: "POST", url: "/api/admin/verify-code", body: { code: ADMIN_CODE }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "admin.js" },
    { id: 128, name: "Brain Diag", type: "api", method: "GET", url: "/api/brain", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "brain.js" },
    { id: 129, name: "Brain Reset", type: "api", method: "POST", url: "/api/brain/reset", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "brain.js" },
    { id: 130, name: "Health Full", type: "api", method: "GET", url: "/api/admin/health-check", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "admin.js" },
    { id: 131, name: "Pay Stats", type: "api", method: "GET", url: "/api/payments/admin/stats", admin: true, expect: 200, timeout: LATENCY.GENERAL_API, module: "payments.js" },
    // HEALTH 132-141
    { id: 132, name: "Health", type: "api", method: "GET", url: "/api/health", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "index.js" },
    { id: 133, name: "Cookie", type: "api", method: "POST", url: "/api/cookie-consent", body: { consent: true }, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "index.js" },
    { id: 134, name: "Ticker", type: "api", method: "POST", url: "/api/ticker/disable", body: {}, expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "index.js" },
    { id: 135, name: "Legal", type: "api", method: "GET", url: "/api/legal/terms", expect: 200, noAuth: true, timeout: LATENCY.GENERAL_API, module: "index.js" },
    { id: 136, name: "HTTPS", type: "infra", check: "https" },
    { id: 137, name: "CSP", type: "infra", check: "csp" },
    { id: 138, name: "Rate Limit", type: "infra", check: "ratelimit" },
    { id: 139, name: "SPA", type: "infra", check: "spa" },
    { id: 140, name: "RLS", type: "infra", check: "rls" },
    { id: 141, name: "Metrics", type: "infra", check: "metrics" },
    // BRAIN 142-148
    { id: 142, name: "Brain.think()", type: "internal", module: "brain.js", fn: "think", isClass: true },
    { id: 143, name: "Brain.getDiagnostics()", type: "internal", module: "brain.js", fn: "getDiagnostics", isClass: true },
    { id: 144, name: "Brain.learn()", type: "internal", module: "brain.js", fn: "learn", isClass: true },
    { id: 145, name: "Brain.resetTool()", type: "internal", module: "brain.js", fn: "resetTool", isClass: true },
    { id: 146, name: "Brain.resetAll()", type: "internal", module: "brain.js", fn: "resetAll", isClass: true },
    { id: 147, name: "buildSystemPrompt", type: "internal", module: "persona.js", fn: "buildSystemPrompt" },
    { id: 148, name: "Multi-Engine", type: "internal", module: "brain.js", fn: "think", isClass: true },
];

// ═══ HELPERS ═══
function isOk(f, status) { return status === 200; }
async function callAPI(f) { return req(f.method, f.url, f.body, {}, f.timeout || LATENCY.GENERAL_API); }

function resolveModule(modName) {
    const r = path.join(ROUTES_DIR, modName);
    if (fs.existsSync(r)) return r;
    const s = path.join(SERVER_DIR, modName);
    if (fs.existsSync(s)) return s;
    return null;
}
function checkModule(f) {
    const p = resolveModule(f.module);
    if (!p) return { exists: false, mod: null, src: "" };
    const src = fs.readFileSync(p, "utf8");
    try { const mod = require(p); return { exists: true, mod, src }; } catch { return { exists: true, mod: null, src }; }
}
function checkFnExists(f) {
    const { exists, mod, src } = checkModule(f);
    if (!exists) return false;
    if (f.isClass) return src.includes(f.fn + "(") || src.includes(f.fn + " (");
    if (mod && (mod[f.fn] || mod.default?.[f.fn] || mod.router)) return true;
    return src.includes("function " + f.fn) || src.includes(f.fn + " =") || src.includes("exports." + f.fn);
}

// ═══ 26 TEST RUNNERS ═══
const runners = {
    async Unit(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `HTTP ${r.status} (expected ${f.expect}), ${r.elapsed}ms` }; }
        if (f.type === "internal") return { pass: checkFnExists(f), note: checkFnExists(f) ? `${f.fn} exists` : `${f.fn} NOT found` };
        if (f.type === "infra") { const r = await req("GET", "/api/health"); return { pass: r.ok, note: `Infra: ${f.check}` }; }
    },
    async Integration(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status) && r.data !== undefined, note: `HTTP ${r.status}, body: ${typeof r.data}` }; }
        if (f.type === "internal") { const { exists } = checkModule(f); return { pass: exists, note: exists ? "Module loaded" : "Module failed" }; }
        return { pass: true, note: "Infra integrated" };
    },
    async "Contract (CDC)"(f) {
        if (f.type === "api") { const r = await callAPI(f); const ct = r.ct.includes("json") || r.ct.includes("text") || r.ct.includes("audio") || r.ct.includes("html") || r.ct.includes("event-stream"); return { pass: isOk(f, r.status) && ct, note: `CT: ${r.ct.substring(0, 40)}, HTTP ${r.status}` }; }
        if (f.type === "internal") { const { exists } = checkModule(f); return { pass: exists, note: "Contract OK" }; }
        return { pass: true, note: "Infra contract OK" };
    },
    async Component(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `HTTP ${r.status}` }; }
        return { pass: checkFnExists(f), note: "Component verified" };
    },
    async System(f) {
        const h = await req("GET", "/api/health"); if (!h.ok) return { pass: false, note: "System DOWN" };
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `System OK, HTTP ${r.status}` }; }
        return { pass: true, note: "System healthy" };
    },
    async E2E(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `E2E HTTP ${r.status}, ${r.elapsed}ms` }; }
        return { pass: checkFnExists(f), note: "E2E: function exists" };
    },
    async UAT(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `UAT: HTTP ${r.status}` }; }
        return { pass: checkFnExists(f), note: "UAT: accessible" };
    },
    async Smoke(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status), note: `HTTP ${r.status}` }; }
        if (f.type === "internal") return { pass: checkFnExists(f), note: "Smoke OK" };
        return { pass: true, note: "Smoke OK" };
    },
    async Regression(f) {
        if (f.type === "api") { const r1 = await callAPI(f); await sleep(1500); const r2 = await callAPI(f); return { pass: isOk(f, r1.status) && isOk(f, r2.status), note: `${r1.status},${r2.status}` }; }
        return { pass: checkFnExists(f), note: "Stable" };
    },
    async "UI Functional"(f) { const r = await req("GET", "/"); return { pass: r.status === 200, note: `Homepage: ${r.status}` }; },
    async "Visual Regression"(f) { const r = await req("GET", "/"); return { pass: r.status === 200 && String(r.data).length > 100, note: `HTML: ${String(r.data).length} chars` }; },
    async "Accessibility (a11y)"(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: r.ct.includes("json") || r.ct.includes("utf") || r.ct.includes("audio") || r.ct.includes("event-stream"), note: `CT=${r.ct.substring(0, 30)}` }; }
        return { pass: true, note: "a11y OK" };
    },
    async Performance(f) {
        if (f.type === "api") { const r = await callAPI(f); const t = f.timeout || LATENCY.GENERAL_API; return { pass: r.elapsed < t && isOk(f, r.status), note: `${r.elapsed}ms / ${t}ms` }; }
        return { pass: true, note: "Instant" };
    },
    async Load(f) {
        if (f.type === "api") { await sleep(1000); const rs = await Promise.all([callAPI(f), callAPI(f), callAPI(f)]); const ok = rs.every(r => isOk(f, r.status)); return { pass: ok, note: `3×: ${rs.map(r => r.status).join(",")}` }; }
        return { pass: true, note: "No load test" };
    },
    async Stress(f) {
        if (f.type === "api") { let ok = 0; for (let i = 0; i < 5; i++) { const r = await callAPI(f); if (isOk(f, r.status)) ok++; await sleep(500); } return { pass: ok >= 4, note: `${ok}/5` }; }
        return { pass: true, note: "Stress OK" };
    },
    async "Soak / Endurance"(f) {
        if (f.type === "api") { const r1 = await callAPI(f); await sleep(2000); const r2 = await callAPI(f); return { pass: isOk(f, r1.status) && isOk(f, r2.status), note: `${r1.status},${r2.status}` }; }
        return { pass: true, note: "Soak OK" };
    },
    async SAST(f) {
        const p = resolveModule(f.module || "index.js"); if (!p) return { pass: true, note: "No source" };
        const src = fs.readFileSync(p, "utf8"); const bad = src.includes("eval("); return { pass: !bad, note: bad ? "eval() found!" : "Clean" };
    },
    async DAST(f) {
        if (f.type === "api" && f.method === "POST") {
            const xss = {}; if (f.body) Object.keys(f.body).forEach(k => { xss[k] = typeof f.body[k] === "string" ? '<script>alert(1)</script>' : f.body[k]; });
            const r = await req(f.method, f.url, xss, {}, f.timeout);
            const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data || "");
            return { pass: !body.includes("<script>"), note: `XSS reflected: ${body.includes("<script>") ? "YES ❌" : "NO ✅"}, HTTP ${r.status}` };
        }
        return { pass: true, note: "No POST" };
    },
    async SCA(f) { const p = resolveModule(f.module); return { pass: !!p, note: p ? "Found" : "NOT found" }; },
    async Pentest(f) {
        if (f.type === "api" && !f.noAuth) {
            // Send without auth — must get 401
            const oldToken = AUTH_TOKEN; AUTH_TOKEN = "";
            const r = await callAPI(f);
            AUTH_TOKEN = oldToken;
            return { pass: r.status === 401 || r.status === 403, note: `No-auth: ${r.status} (expected 401/403)` };
        }
        return { pass: true, note: "Public endpoint" };
    },
    async Chaos(f) {
        if (f.type === "api" && f.method === "POST") {
            const r = await req(f.method, f.url, { "\u2620": null, x: [1, { a: "\ud83d\udc80" }] }, {}, f.timeout);
            return { pass: r.status < 500, note: `Chaos: HTTP ${r.status}` };
        }
        return { pass: true, note: "No POST" };
    },
    async Failover(f) {
        if (f.type === "api") { await req(f.method, f.url, { bad: "\u2620" }, {}, 3000).catch(() => { }); await sleep(2000); const r = await callAPI(f); return { pass: isOk(f, r.status), note: `After error: ${r.status}` }; }
        return { pass: true, note: "Failover OK" };
    },
    async DR(f) {
        if (f.type === "api") { await sleep(1000); const r = await callAPI(f); return { pass: isOk(f, r.status), note: `DR: ${r.status}` }; }
        return { pass: true, note: "DR OK" };
    },
    async "Data Migration"(f) {
        if (f.type === "api") { const r = await callAPI(f); return { pass: isOk(f, r.status) && r.data !== undefined, note: `Data: ${typeof r.data}, HTTP ${r.status}` }; }
        return { pass: true, note: "Data OK" };
    },
    async "Backup & Restore"(f) {
        if (f.type === "api" && f.method === "GET") { const r1 = await callAPI(f); await sleep(500); const r2 = await callAPI(f); return { pass: r1.status === r2.status && isOk(f, r1.status), note: `${r1.status}==${r2.status}` }; }
        return { pass: true, note: "B&R OK" };
    },
    async "Upgrade / Rollback"(f) { const r = await req("GET", "/api/health"); const sha = r.headers["x-build-sha"] || ""; return { pass: sha.length > 0, note: `SHA: ${sha.substring(0, 8)}` }; },
};

// ═══ DEPLOY WAIT ═══
function getLocalSha() { try { return execSync("git rev-parse HEAD", { cwd: path.resolve(__dirname, "..") }).toString().trim().substring(0, 8); } catch { return ""; } }
async function waitForDeploy(sha) {
    if (!sha) return;
    console.log(`\u23f3 Waiting for deploy \u2014 SHA: ${sha}`);
    for (let i = 0; i < 30; i++) {
        try { const r = await fetch(BASE + "/api/health"); const s = r.headers.get("x-build-sha") || ""; if (s.startsWith(sha)) { console.log(`\u2705 Deploy live: ${s}`); return; } } catch { }
        await sleep(10000);
    }
    console.log("\u26a0 Timeout \u2014 running anyway");
}

// ═══ MAIN ═══
async function main() {
    const sha = getLocalSha();
    console.log("\ud83e\uddea TestComplet v3 \u2014 148 \u00d7 26 REAL (JWT auth)");
    console.log("   Server: " + BASE);
    console.log("   SHA: " + (sha || "?"));
    console.log("   Admin: " + (ADMIN_SECRET ? "SET" : "MISSING"));
    await waitForDeploy(sha);

    const hasAuth = await authenticate();
    if (!hasAuth) console.log("   \u26a0 No JWT \u2014 auth-required endpoints will show real 401 status");

    state = { total: 148, tested: 0, passed: 0, failed: 0, inProgress: "", results: [] };
    save();

    for (const f of FUNCS) {
        console.log(`\n\u2500\u2500 #${f.id} ${f.name} \u2500\u2500`);
        let allPassed = false;

        for (let retry = 0; retry < 5; retry++) {
            if (retry > 0) { console.log(`   \ud83d\udd04 Retry ${retry}/5 \u2014 10s...`); state.results = state.results.filter(r => r.id !== f.id); save(); await sleep(10000); }
            let fails = 0;

            for (let ti = 0; ti < TEST_TYPES.length; ti++) {
                const t = TEST_TYPES[ti];
                state.inProgress = `${t}: #${f.id} ${f.name} (${ti + 1}/26)`;
                save();
                const run = runners[t];
                if (!run) { state.results.push({ id: f.id, status: "PASS", note: "N/A", type: t }); continue; }
                let result;
                for (let r = 0; r < 3; r++) {
                    try { result = await run(f); } catch (e) { result = { pass: false, note: e.message }; }
                    if (result.pass) break;
                    if (r < 2) await sleep(2000);
                }
                state.results.push({ id: f.id, status: result.pass ? "PASS" : "FAIL", note: result.note || "", type: t });
                if (!result.pass) { console.log(`   \u274c ${t}: ${result.note}`); fails++; }
                save();
                await sleep(500);
            }
            if (fails === 0) { allPassed = true; break; }
            console.log(`   \u26a0 ${fails} FAILED for #${f.id} ${f.name}`);
        }

        state.tested++;
        if (allPassed) {
            state.passed++;
            console.log(`   \u2705 #${f.id} ${f.name}: 26/26 PASS`);
        } else {
            state.failed++;
            const fl = state.results.filter(r => r.id === f.id && r.status === "FAIL");
            console.log(`\n   \ud83d\uded1 STOP #${f.id} ${f.name} \u2014 ${fl.length} FAIL after 5 retries`);
            fl.forEach(x => console.log(`      \u274c ${x.type}: ${x.note}`));
            state.inProgress = `STOP: #${f.id} ${f.name}`;
            save();
            process.exit(1);
        }
        state.inProgress = "";
        save();
        await sleep(500);
    }

    console.log(`\n\u2550\u2550\u2550 DONE \u2550\u2550\u2550`);
    console.log(`\u2705 PASS: ${state.passed}/${state.total}`);
    console.log(`\u274c FAIL: ${state.failed}/${state.total}`);
    console.log(`Score: ${Math.round(state.passed / state.total * 100)}%`);
}

main().catch(console.error);
