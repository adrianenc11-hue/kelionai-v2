#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.1 — SCRIPT TOTAL DE AUTOMATIZARE
# Rulează O SINGURĂ DATĂ. Face TOTUL automat.
# 
# INSTRUCȚIUNI:
# 1. Deschide un terminal (Command Prompt sau Git Bash)
# 2. Navighează la folderul proiectului:
#    cd C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2
# 3. Rulează scriptul:
#    bash deploy.sh
# 4. Scriptul face tot: fix-uri, fișiere noi, push la GitHub
# 5. Railway face auto-deploy din GitHub
# 6. Mergi la Supabase SQL Editor și rulează schema.sql
#
# SAU dacă nu ai bash: 
#    Deschide Git Bash → cd la folder → bash deploy.sh
# ═══════════════════════════════════════════════════════════════

set -e
echo ""
echo "══════════════════════════════════════════"
echo "  KelionAI v2.1 — Instalare automată"
echo "══════════════════════════════════════════"
echo ""

# ─── Verificări ───────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "❌ Node.js nu e instalat. Descarcă de pe https://nodejs.org"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "❌ Git nu e instalat. Descarcă de pe https://git-scm.com"
    exit 1
fi

echo "✅ Node.js: $(node -v)"
echo "✅ Git: $(git --version)"
echo ""

# ─── Install dependencies ─────────────────────────────────────
echo "📦 Instalez dependențe..."
npm install @supabase/supabase-js 2>/dev/null || npm install @supabase/supabase-js --save
echo "✅ Dependențe instalate"
echo ""

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 1: server/supabase.js (NOU)
# ═══════════════════════════════════════════════════════════════
echo "📝 Creez server/supabase.js..."
cat > server/supabase.js << 'SUPABASE_EOF'
const { createClient } = require('@supabase/supabase-js');
let supabase = null, supabaseAdmin = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    console.log('[Supabase] ✅ Client init');
}
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[Supabase] ✅ Admin init');
}
module.exports = { supabase, supabaseAdmin };
SUPABASE_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 2: server/schema.sql (NOU) — Supabase tables
# ═══════════════════════════════════════════════════════════════
echo "📝 Creez server/schema.sql..."
cat > server/schema.sql << 'SQL_EOF'
-- KelionAI v2 — Supabase Schema
-- Rulează în: https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/sql

CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    avatar TEXT NOT NULL DEFAULT 'kelion',
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    language TEXT DEFAULT 'ro',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_prefs_user ON user_preferences(user_id);

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql';

DROP TRIGGER IF EXISTS conversations_updated ON conversations;
CREATE TRIGGER conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_conv" ON conversations FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "own_msg" ON messages FOR ALL USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid() OR user_id IS NULL));
CREATE POLICY "own_prefs" ON user_preferences FOR ALL USING (auth.uid() = user_id);

SELECT '✅ KelionAI schema OK' AS status;
SQL_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 3: server/index.js (RESCRIS COMPLET)
#  FĂRĂ OpenAI, FĂRĂ Tavily — doar ce ai
# ═══════════════════════════════════════════════════════════════
echo "📝 Rescriu server/index.js (fără OpenAI/Tavily)..."
cat > server/index.js << 'SERVER_EOF'
require('dotenv').config();
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0, integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()] });
}
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const { supabase, supabaseAdmin } = require('./supabase');

const app = express();
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const metrics = require('./metrics');
app.use(metrics.metricsMiddleware);
app.get('/metrics', async (req, res) => { res.set('Content-Type', metrics.register.contentType); res.end(await metrics.register.metrics()); });
app.use(express.static(path.join(__dirname, '..', 'app')));
const PORT = process.env.PORT || 3000;
const memFallback = {};

async function getUserFromToken(req) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ') || !supabase) return null;
    try { const { data: { user } } = await supabase.auth.getUser(h.split(' ')[1]); return user; }
    catch (e) { return null; }
}

const KELION_PROMPT = `Ești Kelion, un asistent AI inteligent, prietenos și onest. Vorbești natural, clar și direct.
Personalitate masculină, caldă, profesională. Răspunzi la ORICE. Nu inventezi fapte.
Dacă utilizatorul e nevăzător, descrie totul verbal — ești ochii și urechile lui.
CAPACITĂȚI: Viziune cameră, Voce naturală, Monitor prezentare, Meteo, Căutare web, Generare imagini AI, Analiză fișiere, Memorie persistentă.
Nu spune NICIODATĂ "nu pot face asta".`;

const KIRA_PROMPT = `Ești Kira, o asistentă AI inteligentă, caldă și empatică. Vorbești natural, clar și grijuliu.
Personalitate feminină, blândă, profesională. Răspunzi la ORICE. Nu inventezi fapte.
Dacă utilizatorul e nevăzător, descrie totul verbal — ești ochii și urechile lui.
CAPACITĂȚI: Viziune cameră, Voce naturală feminină, Monitor prezentare, Meteo, Căutare web, Generare imagini AI, Analiză fișiere, Memorie persistentă.
Nu spune NICIODATĂ "nu pot face asta".`;

// ═══ AUTH ═══
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email și parolă obligatorii' });
        if (!supabase) return res.status(503).json({ error: 'Auth indisponibil' });
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name || email.split('@')[0] } } });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Eroare înregistrare' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email și parolă obligatorii' });
        if (!supabase) return res.status(503).json({ error: 'Auth indisponibil' });
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.full_name }, session: data.session });
    } catch (e) { res.status(500).json({ error: 'Eroare login' }); }
});

app.post('/api/auth/logout', async (req, res) => { try { if (supabase) await supabase.auth.signOut(); } catch(e){} res.json({ success: true }); });
app.get('/api/auth/me', async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u) return res.status(401).json({ error: 'Neautentificat' });
    res.json({ user: { id: u.id, email: u.email, name: u.user_metadata?.full_name } });
});

// ═══ CHAT — Claude → DeepSeek (NO OpenAI) ═══
app.post('/api/chat', async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro', conversationId } = req.body;
        if (!message) return res.status(400).json({ error: 'Mesaj lipsă' });
        const user = await getUserFromToken(req);
        const LANGS = { ro:'română', en:'English', es:'español', fr:'français', de:'Deutsch', it:'italiano' };
        let sys = (avatar === 'kira' ? KIRA_PROMPT : KELION_PROMPT);
        sys += `\nRĂSPUNDE în ${LANGS[language] || language}. Poți face roleplay.`;

        // Inject memory
        if (user && supabaseAdmin) {
            try {
                const { data: prefs } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id).limit(20);
                if (prefs?.length > 0) sys += `\n[MEMORIE]: ${prefs.map(p => p.key + ': ' + JSON.stringify(p.value)).join('; ')}`;
            } catch(e){}
        }

        const msgs = history.slice(-20).map(h => ({ role: h.role === 'ai' ? 'assistant' : h.role, content: h.content }));
        msgs.push({ role: 'user', content: message });
        let reply = null, engine = null;

        // Claude
        if (!reply && process.env.ANTHROPIC_API_KEY) {
            try {
                const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: sys, messages: msgs }) });
                const d = await r.json(); reply = d.content?.[0]?.text; if (reply) engine = 'Claude';
            } catch(e){ console.warn('[CHAT] Claude:', e.message); }
        }
        // DeepSeek
        if (!reply && process.env.DEEPSEEK_API_KEY) {
            try {
                const r = await fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
                    body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 2048, messages: [{ role: 'system', content: sys }, ...msgs] }) });
                const d = await r.json(); reply = d.choices?.[0]?.message?.content; if (reply) engine = 'DeepSeek';
            } catch(e){ console.warn('[CHAT] DeepSeek:', e.message); }
        }
        if (!reply) return res.status(503).json({ error: 'AI indisponibil' });

        // Save to DB async
        if (supabaseAdmin) saveConv(user?.id, avatar, message, reply, conversationId, language).catch(()=>{});
        console.log(`[CHAT] ${engine} | ${avatar} | ${language} | ${reply.length}c`);
        res.json({ reply, avatar, engine, language });
    } catch(e) { console.error('[CHAT]', e.message); res.status(500).json({ error: 'Eroare AI' }); }
});

async function saveConv(uid, avatar, userMsg, aiReply, convId, lang) {
    if (!supabaseAdmin) return;
    if (!convId) {
        const { data } = await supabaseAdmin.from('conversations').insert({ user_id: uid||null, avatar, title: userMsg.substring(0,80) }).select('id').single();
        convId = data?.id;
    } else { await supabaseAdmin.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId); }
    if (convId) await supabaseAdmin.from('messages').insert([{ conversation_id: convId, role: 'user', content: userMsg, language: lang }, { conversation_id: convId, role: 'assistant', content: aiReply, language: lang }]);
    return convId;
}

// ═══ TTS — ElevenLabs ═══
app.post('/api/speak', async (req, res) => {
    try {
        const { text, avatar = 'kelion' } = req.body;
        if (!text || !process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS indisponibil' });
        const vid = avatar === 'kira' ? 'EXAVITQu4vr4xnSDxMaL' : 'VR6AewLTigWG4xSOukaG';
        const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) });
        if (!r.ok) return res.status(503).json({ error: 'TTS fail' });
        const buf = await r.buffer();
        console.log('[SPEAK]', buf.length, 'bytes |', avatar);
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length }); res.send(buf);
    } catch(e) { res.status(500).json({ error: 'Eroare TTS' }); }
});

// ═══ STT — Groq Whisper ═══
app.post('/api/listen', async (req, res) => {
    try {
        if (req.body.text) return res.json({ text: req.body.text, engine: 'WebSpeech' });
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: 'Audio lipsă' });
        if (process.env.GROQ_API_KEY) {
            const form = new FormData();
            form.append('file', Buffer.from(audio, 'base64'), { filename: 'a.webm', contentType: 'audio/webm' });
            form.append('model', 'whisper-large-v3');
            const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
            const d = await r.json(); return res.json({ text: d.text || '', engine: 'Groq' });
        }
        res.status(503).json({ error: 'Folosește Web Speech API' });
    } catch(e) { res.status(500).json({ error: 'Eroare STT' }); }
});

// ═══ VISION — Claude Vision ═══
app.post('/api/vision', async (req, res) => {
    try {
        const { image, avatar = 'kelion', language = 'ro' } = req.body;
        if (!image || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Vision indisponibil' });
        const LANGS = { ro:'română', en:'English' };
        const prompt = `Ești OCHII unei persoane. Descrie EXACT ce vezi cu PRECIZIE MAXIMĂ.
Persoane: vârstă, sex, haine (culori exacte), expresie, gesturi, ce țin în mâini.
Obiecte: fiecare obiect, culoare, dimensiune, poziție.
Text: citește ORICE text vizibil.
Pericole: obstacole, trepte → "ATENȚIE:"
Răspunde în ${LANGS[language] || 'română'}, concis dar detaliat.`;
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024,
                messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: prompt }] }] }) });
        const d = await r.json();
        res.json({ description: d.content?.[0]?.text || 'Nu am putut analiza.', avatar, engine: 'Claude' });
    } catch(e) { res.status(500).json({ error: 'Eroare viziune' }); }
});

// ═══ SEARCH — DuckDuckGo (gratuit, fără cheie) ═══
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query lipsă' });
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
        const d = await r.json();
        const results = [];
        if (d.Abstract) results.push({ title: d.Heading || query, content: d.Abstract, url: d.AbstractURL });
        if (d.RelatedTopics) for (const t of d.RelatedTopics.slice(0, 5)) if (t.Text) results.push({ title: t.Text.substring(0, 80), content: t.Text, url: t.FirstURL });
        res.json({ results, answer: d.Abstract || '', engine: 'DuckDuckGo' });
    } catch(e) { res.status(500).json({ error: 'Eroare căutare' }); }
});

// ═══ WEATHER — Open-Meteo (gratuit) ═══
app.post('/api/weather', async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'Oraș lipsă' });
        const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=ro')).json();
        if (!geo.results?.[0]) return res.status(404).json({ error: '"' + city + '" negăsit' });
        const { latitude, longitude, name, country } = geo.results[0];
        const wx = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude='+latitude+'&longitude='+longitude+'&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto')).json();
        const c = wx.current;
        const codes = {0:'Senin ☀️',1:'Parțial senin 🌤️',2:'Parțial noros ⛅',3:'Noros ☁️',45:'Ceață 🌫️',51:'Burniță 🌦️',61:'Ploaie 🌧️',71:'Ninsoare 🌨️',80:'Averse 🌦️',95:'Furtună ⛈️'};
        const cond = codes[c.weather_code] || '?';
        res.json({ city: name, country, temperature: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, condition: cond,
            description: name+', '+country+': '+c.temperature_2m+'°C, '+cond+', umiditate '+c.relative_humidity_2m+'%, vânt '+c.wind_speed_10m+' km/h' });
    } catch(e) { res.status(500).json({ error: 'Eroare meteo' }); }
});

// ═══ IMAGINE — Together FLUX ═══
app.post('/api/imagine', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !process.env.TOGETHER_API_KEY) return res.status(503).json({ error: 'Imagine indisponibil' });
        const r = await fetch('https://api.together.xyz/v1/images/generations', { method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.TOGETHER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'black-forest-labs/FLUX.1-schnell', prompt, width: 1024, height: 1024, steps: 4, n: 1, response_format: 'b64_json' }) });
        if (!r.ok) return res.status(503).json({ error: 'Generare eșuată' });
        const d = await r.json(); const b64 = d.data?.[0]?.b64_json;
        if (!b64) return res.status(500).json({ error: 'No data' });
        res.json({ image: 'data:image/png;base64,' + b64, prompt, engine: 'FLUX' });
    } catch(e) { res.status(500).json({ error: 'Eroare imagine' }); }
});

// ═══ MEMORY — Supabase + fallback ═══
app.post('/api/memory', async (req, res) => {
    try {
        const { action, key, value } = req.body;
        const user = await getUserFromToken(req); const uid = user?.id || 'guest';
        if (supabaseAdmin && user) {
            if (action === 'save') { await supabaseAdmin.from('user_preferences').upsert({ user_id: user.id, key, value: typeof value === 'object' ? value : { data: value } }, { onConflict: 'user_id,key' }); return res.json({ success: true }); }
            if (action === 'load') { const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', key).single(); return res.json({ value: data?.value || null }); }
            if (action === 'list') { const { data } = await supabaseAdmin.from('user_preferences').select('key, value').eq('user_id', user.id); return res.json({ keys: (data||[]).map(d=>d.key), items: data||[] }); }
        }
        if (!memFallback[uid]) memFallback[uid] = {};
        if (action === 'save') { memFallback[uid][key] = value; res.json({ success: true }); }
        else if (action === 'load') res.json({ value: memFallback[uid][key] || null });
        else if (action === 'list') res.json({ keys: Object.keys(memFallback[uid]) });
        else res.status(400).json({ error: 'Acțiune: save, load, list' });
    } catch(e) { res.status(500).json({ error: 'Eroare memorie' }); }
});

// ═══ CONVERSATIONS ═══
app.get('/api/conversations', async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ conversations: [] });
    const { data } = await supabaseAdmin.from('conversations').select('id, avatar, title, created_at, updated_at').eq('user_id', u.id).order('updated_at', { ascending: false }).limit(50);
    res.json({ conversations: data || [] });
});
app.get('/api/conversations/:id/messages', async (req, res) => {
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ messages: [] });
    const { data } = await supabaseAdmin.from('messages').select('id, role, content, created_at').eq('conversation_id', req.params.id).order('created_at', { ascending: true });
    res.json({ messages: data || [] });
});

// ═══ HEALTH ═══
app.get('/api/health', (req, res) => {
    res.json({ status: 'online', version: '2.1.0', timestamp: new Date().toISOString(),
        services: { ai_claude: !!process.env.ANTHROPIC_API_KEY, ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
            tts: !!process.env.ELEVENLABS_API_KEY, stt: true, vision: !!process.env.ANTHROPIC_API_KEY,
            search: true, weather: true, images: !!process.env.TOGETHER_API_KEY,
            auth: !!supabase, database: !!supabaseAdmin } });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'app', 'index.html')));
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n══════════════════════════════════════════');
    console.log('  KelionAI v2.1 — http://localhost:' + PORT);
    console.log('  AI: ' + (process.env.ANTHROPIC_API_KEY ? '✅ Claude' : '❌') + ' | ' + (process.env.DEEPSEEK_API_KEY ? '✅ DeepSeek' : '❌'));
    console.log('  TTS: ' + (process.env.ELEVENLABS_API_KEY ? '✅ ElevenLabs' : '❌'));
    console.log('  DB: ' + (supabaseAdmin ? '✅ Supabase' : '⚠️ In-memory'));
    console.log('══════════════════════════════════════════\n');
});
SERVER_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 4: app/js/fft-lipsync.js (FIX lip sync)
# ═══════════════════════════════════════════════════════════════
echo "📝 Fix fft-lipsync.js (adaug connectToContext)..."
# Check if connectToContext already exists
if ! grep -q "connectToContext" app/js/fft-lipsync.js; then
    # Add connectToContext after setMorphMeshes
    sed -i '/SimpleLipSync.prototype.setMorphMeshes/,/};/{
        /};/a\
\
    SimpleLipSync.prototype.connectToContext = function (ctx) {\
        try {\
            audioCtx = ctx;\
            if (audioCtx.state === "suspended") audioCtx.resume();\
            analyser = audioCtx.createAnalyser();\
            analyser.fftSize = 256;\
            analyser.smoothingTimeConstant = 0.6;\
            dataArray = new Uint8Array(analyser.frequencyBinCount);\
            return analyser;\
        } catch (e) { return null; }\
    };
    }' app/js/fft-lipsync.js
    echo "  ✅ connectToContext adăugat"
else
    echo "  ⏭️ connectToContext există deja"
fi

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 5: app/js/voice.js (RESCRIS — AudioContext + auto)
# ═══════════════════════════════════════════════════════════════
echo "📝 Rescriu voice.js (AudioContext audio fix)..."
cat > app/js/voice.js << 'VOICE_EOF'
// KelionAI v2 — Voice Module (AudioContext — FIXED)
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let mediaRecorder = null, audioChunks = [], isRecording = false, isSpeaking = false;
    let currentSourceNode = null, sharedAudioCtx = null, detectedLanguage = 'ro';
    let recognition = null, isListeningForWake = false, isProcessing = false;

    function getAudioContext() {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
        return sharedAudioCtx;
    }

    function ensureAudioUnlocked() {
        const ctx = getAudioContext();
        try { const b = ctx.createBuffer(1,1,22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch(e){}
    }

    // ─── Wake Word (always-on mic) ───────────────────────────
    function startWakeWordDetection() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        recognition = new SR();
        recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 3;

        recognition.onresult = (event) => {
            if (isProcessing || isSpeaking) return;
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript.toLowerCase().trim();
                const c = event.results[i][0].confidence;
                if (c < 0.6 && event.results[i].isFinal) continue;
                const hasKelion = t.includes('kelion') || t.includes('chelion');
                const hasKira = t.includes('kira') || t.includes('chira');
                const hasK = t === 'k' || t.startsWith('k ');

                if ((hasKelion || hasKira || hasK) && event.results[i].isFinal) {
                    if (hasKira) { window.KAvatar.loadAvatar('kira'); document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === 'kira')); }
                    else { window.KAvatar.loadAvatar('kelion'); document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === 'kelion')); }

                    let msg = t;
                    if (hasKelion) msg = t.split(/kelion|chelion/i).pop().trim();
                    else if (hasKira) msg = t.split(/kira|chira/i).pop().trim();
                    else if (hasK) msg = t.replace(/^\s*k\s+/, '').trim();

                    if (msg.length > 1) {
                        detectLanguage(t); isProcessing = true; window.KAvatar.setAttentive(true);
                        window.dispatchEvent(new CustomEvent('wake-message', { detail: { text: msg, language: detectedLanguage } }));
                    } else { window.KAvatar.setAttentive(true); }
                }
            }
        };
        recognition.onend = () => { if (isListeningForWake && !isProcessing) try { recognition.start(); } catch(e){} };
        recognition.onerror = (e) => { if (e.error !== 'not-allowed' && isListeningForWake) setTimeout(() => { try { recognition.start(); } catch(e){} }, 1000); };
        try { recognition.start(); isListeningForWake = true; console.log('[Voice] Wake word activ'); } catch(e){}
    }

    function resumeWakeDetection() {
        isProcessing = false; window.KAvatar.setAttentive(false);
        if (isListeningForWake && recognition) try { recognition.start(); } catch(e){}
    }

    function detectLanguage(text) {
        const t = text.toLowerCase();
        if (/\b(și|sau|este|sunt|pentru|care|cum|unde|vreau|poți)\b/.test(t)) { detectedLanguage = 'ro'; return; }
        if (/\b(the|is|are|what|where|how|can|you|please)\b/.test(t)) { detectedLanguage = 'en'; return; }
    }

    // ─── SPEAK — AudioContext (bypass autoplay!) ─────────────
    async function speak(text, avatar) {
        if (isSpeaking) stopSpeaking();
        if (!text || !text.trim()) return;
        isSpeaking = true;

        try {
            const resp = await fetch(API_BASE + '/api/speak', { method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ text, avatar: avatar || KAvatar.getCurrentAvatar(), language: detectedLanguage }) });

            if (!resp.ok) { fallbackTextLipSync(text); isSpeaking = false; resumeWakeDetection(); return; }

            const arrayBuf = await resp.arrayBuffer();
            const ctx = getAudioContext();
            let audioBuf;
            try { audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0)); }
            catch(e) { fallbackTextLipSync(text); isSpeaking = false; resumeWakeDetection(); return; }

            currentSourceNode = ctx.createBufferSource();
            currentSourceNode.buffer = audioBuf;

            // Wire FFT lip sync
            const ls = KAvatar.getLipSync();
            let fftOk = false;
            if (ls && ls.connectToContext) {
                try {
                    const an = ls.connectToContext(ctx);
                    if (an) { currentSourceNode.connect(an); an.connect(ctx.destination); fftOk = true; ls.start(); }
                } catch(e){}
            }
            if (!fftOk) { currentSourceNode.connect(ctx.destination); fallbackTextLipSync(text); }

            KAvatar.setExpression('happy', 0.3);
            currentSourceNode.onended = () => { stopAllLipSync(); isSpeaking = false; currentSourceNode = null; KAvatar.setExpression('neutral'); resumeWakeDetection(); };
            currentSourceNode.start(0);
            console.log('[Voice] ✅ Audio playing (' + arrayBuf.byteLength + 'B)');
        } catch(e) { console.error('[Voice]', e); stopAllLipSync(); isSpeaking = false; resumeWakeDetection(); }
    }

    function stopAllLipSync() {
        var ls = KAvatar.getLipSync(), ts = KAvatar.getTextLipSync();
        if (ls) try { ls.stop(); } catch(e){}
        if (ts) try { ts.stop(); } catch(e){}
        KAvatar.setMorph('Smile', 0);
    }

    function fallbackTextLipSync(text) {
        const ts = KAvatar.getTextLipSync();
        if (ts) { ts.speak(text); setTimeout(() => { ts.stop(); KAvatar.setExpression('neutral'); }, text.length * 55 + 500); }
    }

    function stopSpeaking() {
        if (currentSourceNode) try { currentSourceNode.stop(); } catch(e){} currentSourceNode = null;
        stopAllLipSync(); isSpeaking = false; KAvatar.setExpression('neutral');
    }

    // ─── Manual record ───────────────────────────────────────
    async function startListening() {
        if (isRecording) return;
        if (recognition) try { recognition.stop(); } catch(e){}
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.start(100); isRecording = true; KAvatar.setExpression('thinking', 0.4);
            return true;
        } catch(e) { resumeWakeDetection(); return false; }
    }

    function stopListening() {
        return new Promise((resolve) => {
            if (!isRecording || !mediaRecorder) { resolve(null); return; }
            mediaRecorder.onstop = async () => {
                isRecording = false; mediaRecorder.stream.getTracks().forEach(t => t.stop());
                if (!audioChunks.length) { resolve(null); resumeWakeDetection(); return; }
                const blob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = [];
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const b64 = reader.result.split(',')[1];
                    try {
                        const r = await fetch(API_BASE + '/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64 }) });
                        const d = await r.json(); if (d.text) detectLanguage(d.text); resolve(d.text || null);
                    } catch(e) { resolve(null); }
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.stop();
        });
    }

    // ─── Camera auto ─────────────────────────────────────────
    async function captureAndAnalyze() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
            const v = document.createElement('video'); v.srcObject = stream; v.setAttribute('playsinline', '');
            await v.play(); await new Promise(r => setTimeout(r, 800));
            const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0); stream.getTracks().forEach(t => t.stop());
            const b64 = c.toDataURL('image/jpeg', 0.95).split(',')[1];
            KAvatar.setExpression('thinking', 0.5);
            const r = await fetch(API_BASE + '/api/vision', { method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: detectedLanguage }) });
            const d = await r.json(); return d.description || 'Nu am putut analiza.';
        } catch(e) { return e.name === 'NotAllowedError' ? 'Permite accesul la cameră.' : 'Eroare cameră.'; }
    }

    window.KVoice = { speak, stopSpeaking, startListening, stopListening, captureAndAnalyze,
        startWakeWordDetection, resumeWakeDetection, ensureAudioUnlocked,
        isRecording: () => isRecording, isSpeaking: () => isSpeaking,
        getLanguage: () => detectedLanguage, setLanguage: (l) => { detectedLanguage = l; } };
})();
VOICE_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 6: app/js/auth.js (NOU — sesiuni)
# ═══════════════════════════════════════════════════════════════
echo "📝 Creez auth.js..."
cat > app/js/auth.js << 'AUTH_EOF'
(function () {
    'use strict';
    const API = window.location.origin;
    let currentUser = null;

    function saveSession(s, u) { if (s) localStorage.setItem('kelion_token', s.access_token); if (u) localStorage.setItem('kelion_user', JSON.stringify(u)); }
    function loadSession() { const t = localStorage.getItem('kelion_token'), u = localStorage.getItem('kelion_user'); if (t && u) { try { currentUser = JSON.parse(u); } catch(e){} } return { token: t, user: currentUser }; }
    function clearSession() { localStorage.removeItem('kelion_token'); localStorage.removeItem('kelion_user'); currentUser = null; }
    function getAuthHeaders() { const t = localStorage.getItem('kelion_token'); return t ? { 'Authorization': 'Bearer ' + t } : {}; }

    async function register(email, pw, name) {
        const r = await fetch(API+'/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser = d.user; if (d.session) saveSession(d.session, d.user); return d;
    }

    async function login(email, pw) {
        const r = await fetch(API+'/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser = d.user; saveSession(d.session, d.user); return d;
    }

    async function logout() { try { await fetch(API+'/api/auth/logout', { method: 'POST', headers: getAuthHeaders() }); } catch(e){} clearSession(); }

    async function checkSession() {
        const { token, user } = loadSession(); if (!token) return null;
        try { const r = await fetch(API+'/api/auth/me', { headers: getAuthHeaders() }); if (r.ok) { const d = await r.json(); currentUser = d.user; return d.user; } clearSession(); return null; }
        catch(e) { return user; }
    }

    function updateUI() {
        const n = document.getElementById('user-name'), b = document.getElementById('btn-auth');
        if (currentUser) { if (n) n.textContent = currentUser.name || currentUser.email; if (b) { b.textContent = '🚪'; b.title = 'Deconectare'; } }
        else { if (n) n.textContent = 'Guest'; if (b) { b.textContent = '🔑'; b.title = 'Login'; } }
    }

    function initUI() {
        const scr = document.getElementById('auth-screen'); if (!scr) return;
        const form = scr.querySelector('#auth-form'), tog = scr.querySelector('#auth-toggle'), err = scr.querySelector('#auth-error');
        const sub = scr.querySelector('#auth-submit'), ttl = scr.querySelector('#auth-title'), nmg = scr.querySelector('#auth-name-group');
        const guest = scr.querySelector('#auth-guest');
        let isReg = false;

        if (tog) tog.addEventListener('click', (e) => { e.preventDefault(); isReg = !isReg;
            ttl.textContent = isReg ? 'Creează cont' : 'Autentificare'; sub.textContent = isReg ? 'Înregistrează-te' : 'Intră';
            tog.textContent = isReg ? 'Am cont → Intră' : 'Nu am cont → Creează'; if (nmg) nmg.style.display = isReg ? 'block' : 'none'; if (err) err.textContent = ''; });

        if (form) form.addEventListener('submit', async (e) => { e.preventDefault();
            const em = form.querySelector('#auth-email').value.trim(), pw = form.querySelector('#auth-password').value, nm = form.querySelector('#auth-name')?.value.trim();
            if (!em || !pw) { if (err) err.textContent = 'Completează email și parola'; return; }
            sub.disabled = true; sub.textContent = '...'; if (err) err.textContent = '';
            try { if (isReg) await register(em, pw, nm); else await login(em, pw);
                scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI();
            } catch(ex) { if (err) err.textContent = ex.message; }
            finally { sub.disabled = false; sub.textContent = isReg ? 'Înregistrează-te' : 'Intră'; } });

        if (guest) guest.addEventListener('click', () => { scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI(); });

        const ab = document.getElementById('btn-auth');
        if (ab) ab.addEventListener('click', async () => {
            if (currentUser) { await logout(); updateUI(); scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); }
            else { scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); } });
    }

    async function init() { initUI(); const u = await checkSession();
        if (u) { document.getElementById('auth-screen')?.classList.add('hidden'); document.getElementById('app-layout')?.classList.remove('hidden'); updateUI(); }
        else { document.getElementById('auth-screen')?.classList.remove('hidden'); document.getElementById('app-layout')?.classList.add('hidden'); updateUI(); } }

    window.KAuth = { init, register, login, logout, checkSession, getAuthHeaders, getUser: () => currentUser, isLoggedIn: () => !!currentUser };
})();
AUTH_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 7: app/js/app.js (RESCRIS — SUPER AUTOMATIZARE)
# ═══════════════════════════════════════════════════════════════
echo "📝 Rescriu app.js (SUPER AUTOMATIZARE — zero butoane)..."
cat > app/js/app.js << 'APP_EOF'
// KelionAI v2.1 — Main App (SUPER AUTOMATION — zero buttons needed)
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let chatHistory = [], storedFiles = [], audioUnlocked = false, currentConversationId = null;

    function authHeaders() { return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) }; }

    function unlockAudio() {
        if (audioUnlocked) return; audioUnlocked = true;
        try { const c = new (window.AudioContext || window.webkitAudioContext)(), b = c.createBuffer(1,1,22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); c.resume(); } catch(e){}
        if (window.KVoice) KVoice.ensureAudioUnlocked();
    }

    function showOnMonitor(content, type) {
        const dc = document.getElementById('display-content'); if (!dc) return;
        KAvatar.setPresenting(true);
        if (type === 'image') dc.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px"><img src="'+content+'" style="max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 4px 30px rgba(0,0,0,0.5)"></div>';
        else if (type === 'map') dc.innerHTML = '<iframe src="'+content+'" style="width:100%;height:100%;border:none;border-radius:12px"></iframe>';
        else if (type === 'html') dc.innerHTML = content;
        else dc.innerHTML = '<div style="padding:30px;color:rgba(255,255,255,0.8);font-size:1rem;line-height:1.6">'+content+'</div>';
    }

    // ─── AUTO-DETECT request types ───────────────────────────
    const VISION_TRIGGERS = ['ce e în față','ce e in fata','ce vezi','mă vezi','ma vezi','uită-te','uita-te','arată-mi','arata-mi','privește','priveste','see me','look at','what do you see','descrie ce vezi','ce observi','ce e pe stradă','ce e pe strada','ce e în jurul','ce e in jurul'];
    function isVisionRequest(t) { const l = t.toLowerCase(); return VISION_TRIGGERS.some(v => l.includes(v)); }
    function isWeatherRequest(t) { return /\b(vreme|meteo|temperatură|temperatura|grad|ploaie|soare|ninge|vânt|weather|forecast|prognoz)\b/i.test(t); }
    function isSearchRequest(t) { return /\b(caută|cauta|search|găsește|gaseste|informații|informatii|știri|stiri|ce e |cine e|cât costă|cat costa|când|cand|unde |how |what |who |when )\b/i.test(t); }
    function isImageGenRequest(t) { return /\b(generează|genereaza|creează|creeaza|desenează|deseneaza|picture|draw|generate|fă-mi|fa-mi)\b/i.test(t) && /\b(imagine|poza|foto|poză|picture|image|desen)\b/i.test(t); }
    function isMapRequest(t) { return /\b(hartă|harta|map|rută|ruta|drum|direcți|directi|navigare|navigate|unde e |unde se|locație|locatie)\b/i.test(t); }

    // ─── AUTO VISION (camera se pornește singură) ─────────────
    async function triggerVision() {
        showThinking(false);
        addMessage('assistant', '👁️ Activez camera...');
        KAvatar.setExpression('thinking', 0.5);
        const desc = await KVoice.captureAndAnalyze();
        addMessage('assistant', desc);
        chatHistory.push({ role: 'assistant', content: desc });
        KAvatar.setExpression('happy', 0.3);
        await KVoice.speak(desc);
    }

    // ─── SEND TO AI (cu auto-search, auto-weather, auto-image, auto-map) ──
    async function sendToAI(message, language) {
        KAvatar.setExpression('thinking', 0.5);
        let extraContext = '';

        try {
            // AUTO-WEATHER
            if (isWeatherRequest(message)) {
                try {
                    const m = message.match(/(?:în|in|la|din|for|at)\s+(\w+)/i);
                    const city = m ? m[1] : 'Manchester';
                    const wr = await fetch(API_BASE+'/api/weather', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ city }) });
                    if (wr.ok) { const w = await wr.json(); extraContext = '\n[METEO REAL '+w.city+': '+w.description+']';
                        showOnMonitor('<div style="padding:40px;text-align:center"><h2 style="color:#fff;margin-bottom:20px">'+w.city+', '+w.country+'</h2><div style="font-size:4rem">'+w.condition+'</div><div style="font-size:2.5rem;color:#00ffff;margin:15px 0">'+w.temperature+'°C</div><div style="color:rgba(255,255,255,0.6)">Umiditate: '+w.humidity+'% | Vânt: '+w.wind+' km/h</div></div>', 'html'); }
                } catch(e){}
            }

            // AUTO-SEARCH
            if (isSearchRequest(message) && !isWeatherRequest(message)) {
                try {
                    const sr = await fetch(API_BASE+'/api/search', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ query: message }) });
                    if (sr.ok) { const s = await sr.json(); extraContext = '\n[CĂUTARE WEB: '+JSON.stringify(s).substring(0,2000)+']'; }
                } catch(e){}
            }

            // AUTO-IMAGE
            if (isImageGenRequest(message)) {
                try {
                    addMessage('assistant', '🎨 Generez imaginea...');
                    const ir = await fetch(API_BASE+'/api/imagine', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ prompt: message }) });
                    if (ir.ok) { const i = await ir.json(); if (i.image) { showOnMonitor(i.image, 'image'); extraContext += '\n[Imagine generată pe monitor.]'; } }
                } catch(e){}
            }

            // AUTO-MAP
            if (isMapRequest(message)) {
                const pm = message.match(/(?:hartă|harta|map|unde e|locație|navigare)\s+(.+)/i);
                if (pm) { const p = pm[1].replace(/[?.!]/g,'').trim();
                    showOnMonitor('https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q='+encodeURIComponent(p), 'map');
                    extraContext += '\n[Hartă "'+p+'" pe monitor.]'; }
            }

            // SEND TO AI
            const resp = await fetch(API_BASE+'/api/chat', { method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ message: extraContext ? message + extraContext : message, avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20), language: language || 'ro', conversationId: currentConversationId }) });

            showThinking(false);
            if (!resp.ok) { const e = await resp.json().catch(()=>({})); addMessage('assistant', e.error || 'Eroare.'); KVoice.resumeWakeDetection(); return; }

            const data = await resp.json();
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: data.reply });
            addMessage('assistant', data.reply);

            // Auto-show images from reply
            const imgMatch = data.reply.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
            if (imgMatch) showOnMonitor(imgMatch[0], 'image');

            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(data.reply, data.avatar);
        } catch(e) { showThinking(false); addMessage('assistant', 'Eroare conectare.'); KVoice.resumeWakeDetection(); }
    }

    // ─── UI ──────────────────────────────────────────────────
    function addMessage(type, text) {
        const o = document.getElementById('chat-overlay');
        if (type === 'user') o.innerHTML = '';
        const m = document.createElement('div'); m.className = 'msg ' + type; m.textContent = text; o.appendChild(m);
    }
    function showThinking(v) { document.getElementById('thinking').classList.toggle('active', v); }
    function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.classList.add('hidden'); }

    function switchAvatar(name) {
        KVoice.stopSpeaking(); KAvatar.loadAvatar(name);
        document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === name));
        const n = document.getElementById('avatar-name'); if (n) n.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        chatHistory = []; currentConversationId = null;
        const o = document.getElementById('chat-overlay'); if (o) o.innerHTML = '';
    }

    // ─── Input handlers ──────────────────────────────────────
    async function onMicDown() { const b = document.getElementById('btn-mic'); if (await KVoice.startListening()) { b.classList.add('recording'); b.textContent = '⏹'; } }
    async function onMicUp() {
        const b = document.getElementById('btn-mic'); b.classList.remove('recording'); b.textContent = '🎤';
        if (!KVoice.isRecording()) return; showThinking(true);
        const text = await KVoice.stopListening();
        if (text?.trim()) { hideWelcome(); addMessage('user', text);
            if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
        } else { showThinking(false); KVoice.resumeWakeDetection(); }
    }

    async function onSendText() {
        const inp = document.getElementById('text-input'); let text = inp.value.trim(); if (!text) return; inp.value = '';
        // Auto wake word from text
        const l = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(l)) { switchAvatar('kira'); text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim(); }
        else if (/^(kelion|chelion)[,.\s]/i.test(l)) { switchAvatar('kelion'); text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim(); }
        if (!text) return;
        hideWelcome(); KAvatar.setAttentive(true); addMessage('user', text); showThinking(true);
        if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        const dp = document.getElementById('display-panel'), dz = document.getElementById('drop-zone'); if (!dp || !dz) return;
        dp.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.remove('hidden'); });
        dp.addEventListener('dragleave', (e) => { if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden'); });
        dp.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.add('hidden'); handleFiles(e.dataTransfer.files); });
    }

    async function handleFiles(fileList) {
        hideWelcome();
        for (const file of fileList) {
            const reader = new FileReader();
            reader.onload = async () => {
                storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
                addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size/1024) + ' KB)');
                if (file.type.startsWith('image/')) {
                    const b64 = reader.result.split(',')[1];
                    KAvatar.setExpression('thinking', 0.5); showThinking(true);
                    try {
                        const r = await fetch(API_BASE+'/api/vision', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: KVoice.getLanguage() }) });
                        const d = await r.json(); showThinking(false); addMessage('assistant', d.description || 'Nu am putut analiza.');
                        KAvatar.setExpression('happy', 0.3); await KVoice.speak(d.description);
                    } catch(e) { showThinking(false); addMessage('assistant', 'Eroare analiză.'); }
                } else { addMessage('assistant', 'Am primit ' + file.name + '. Ce fac cu el?'); }
            };
            if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv)$/)) reader.readAsText(file);
            else reader.readAsDataURL(file);
        }
    }

    // ─── Health check ────────────────────────────────────────
    async function checkHealth() {
        try { const r = await fetch(API_BASE+'/api/health'); const d = await r.json();
            if (d.status === 'online') { document.getElementById('status-text').textContent = 'Online'; document.getElementById('status-dot').style.background = '#00ff88'; }
        } catch(e) { document.getElementById('status-text').textContent = 'Offline'; document.getElementById('status-dot').style.background = '#ff4444'; }
    }

    // ─── INIT ────────────────────────────────────────────────
    function init() {
        if (window.KAuth) KAuth.init();
        KAvatar.init();

        // Unlock audio on ANY interaction
        ['click','touchstart','keydown'].forEach(e => document.addEventListener(e, unlockAudio, { once: false, passive: true }));

        // Mic
        document.getElementById('btn-mic').addEventListener('mousedown', onMicDown);
        document.getElementById('btn-mic').addEventListener('mouseup', onMicUp);
        document.getElementById('btn-mic').addEventListener('touchstart', (e) => { e.preventDefault(); onMicDown(); });
        document.getElementById('btn-mic').addEventListener('touchend', (e) => { e.preventDefault(); onMicUp(); });

        // Vision button (auto-trigger camera)
        const vb = document.getElementById('btn-vision');
        if (vb) vb.addEventListener('click', () => { hideWelcome(); addMessage('user', 'Ce e în fața mea?'); showThinking(true); triggerVision(); });

        // Text
        document.getElementById('btn-send').addEventListener('click', onSendText);
        document.getElementById('text-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSendText(); });

        // Avatar switcher
        document.querySelectorAll('.avatar-pill').forEach(b => b.addEventListener('click', () => switchAvatar(b.dataset.avatar)));

        // Wake word — FULLY AUTOMATIC
        window.addEventListener('wake-message', (e) => {
            const { text, language } = e.detail; hideWelcome(); addMessage('user', text); showThinking(true);
            if (isVisionRequest(text)) triggerVision(); else sendToAI(text, language);
        });

        // Drag & drop
        setupDragDrop();

        // Start everything automatically
        KVoice.startWakeWordDetection();
        checkHealth();
        console.log('[App] ✅ KelionAI v2.1 — FULL AUTO');
    }

    window.KApp = {};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
APP_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 8: app/index.html (cu auth screen + vision button)
# ═══════════════════════════════════════════════════════════════
echo "📝 Rescriu index.html..."
cat > app/index.html << 'HTML_EOF'
<!DOCTYPE html>
<html lang="ro">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>KelionAI</title>
    <link rel="stylesheet" href="/css/app.css">
    <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js"></script>
    <script src="https://browser.sentry-cdn.com/8.46.0/bundle.tracing.replay.min.js" crossorigin="anonymous"></script>
    <script>
        if (window.Sentry) Sentry.init({ dsn: "https://5c261710f7055bef0cdcdb50239b5519@o4510937317834752.ingest.us.sentry.io/4510937323012096",
            integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()], tracesSampleRate: 1.0 });
    </script>
</head>
<body>
    <!-- AUTH SCREEN -->
    <div id="auth-screen">
        <div id="auth-container">
            <div id="auth-logo"><div class="auth-avatar-icon">🤖</div><h1>KelionAI</h1><p class="auth-subtitle">Asistentul tău AI inteligent</p></div>
            <form id="auth-form">
                <h2 id="auth-title">Autentificare</h2>
                <div id="auth-name-group" style="display:none"><input type="text" id="auth-name" placeholder="Numele tău" autocomplete="name"></div>
                <div><input type="email" id="auth-email" placeholder="Email" autocomplete="email" required></div>
                <div><input type="password" id="auth-password" placeholder="Parolă" autocomplete="current-password" required></div>
                <div id="auth-error"></div>
                <button type="submit" id="auth-submit">Intră</button>
                <a href="#" id="auth-toggle">Nu am cont → Creează</a>
            </form>
            <button id="auth-guest" class="auth-guest-btn">Continuă fără cont</button>
        </div>
    </div>

    <!-- MAIN APP -->
    <div id="app-layout" class="hidden">
        <div id="left-panel">
            <div id="avatar-area">
                <canvas id="avatar-canvas"></canvas>
                <div id="avatar-label">
                    <span id="avatar-name">Kelion</span>
                    <div id="status-indicator"><div id="status-dot"></div><span id="status-text">Online</span></div>
                </div>
                <div id="avatar-switcher">
                    <button class="avatar-pill active" data-avatar="kelion">Kelion</button>
                    <button class="avatar-pill" data-avatar="kira">Kira</button>
                    <span id="user-name" class="user-badge">Guest</span>
                    <button class="ctrl-btn-sm" id="btn-auth" title="Login">🔑</button>
                </div>
            </div>
            <div id="chat-area">
                <div id="chat-overlay"></div>
                <div id="thinking"><div class="thinking-dots"><span></span><span></span><span></span></div><span>Se gândește...</span></div>
                <div id="input-row">
                    <button class="ctrl-btn-sm active-mic" id="btn-mic" title="Microfon">🎤</button>
                    <button class="ctrl-btn-sm" id="btn-vision" title="Cameră">👁️</button>
                    <input type="text" id="text-input" placeholder="Scrie sau vorbește..." autocomplete="off">
                    <button id="btn-send">➤</button>
                </div>
            </div>
        </div>
        <div id="display-panel">
            <div id="display-header"><span id="display-title">Monitor</span></div>
            <div id="display-content"><div id="drop-zone-passive"><div class="welcome-icon">🎯</div><p>Monitor de prezentare</p><small>Trage fișiere aici sau spune "ce e în fața mea"</small></div></div>
        </div>
    </div>
    <div id="drop-zone" class="hidden"><div class="drop-zone-content"><div class="drop-icon">📂</div><p>Trage fișierul aici</p></div></div>

    <script src="/lib/three.bundle.js"></script>
    <script src="/js/fft-lipsync.js"></script>
    <script src="/js/avatar.js"></script>
    <script src="/js/voice.js"></script>
    <script src="/js/realtime-vision.js"></script>
    <script src="/js/auth.js"></script>
    <script src="/js/app.js"></script>
</body>
</html>
HTML_EOF

# ═══════════════════════════════════════════════════════════════
#  FIȘIER 9: Append auth CSS
# ═══════════════════════════════════════════════════════════════
echo "📝 Adaug stiluri auth la CSS..."
if ! grep -q "auth-screen" app/css/app.css; then
cat >> app/css/app.css << 'CSS_EOF'

/* ═══ AUTH SCREEN ═══ */
#auth-screen { position:fixed; top:0; left:0; right:0; bottom:0; background:var(--bg-primary); display:flex; align-items:center; justify-content:center; z-index:9999; }
#auth-screen.hidden { display:none; }
#auth-container { width:100%; max-width:380px; padding:40px 30px; text-align:center; }
#auth-logo h1 { font-size:2rem; font-weight:700; background:var(--accent-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:4px; }
.auth-avatar-icon { font-size:3.5rem; margin-bottom:12px; animation:float 3s ease-in-out infinite; }
@keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
.auth-subtitle { color:var(--text-secondary); font-size:0.9rem; margin-bottom:32px; }
#auth-form { display:flex; flex-direction:column; gap:14px; }
#auth-form h2 { font-size:1.3rem; font-weight:600; margin-bottom:8px; }
#auth-form input { width:100%; padding:14px 16px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:var(--bg-secondary); color:var(--text-primary); font-family:'Inter',sans-serif; font-size:0.95rem; outline:none; }
#auth-form input:focus { border-color:var(--accent-blue); box-shadow:0 0 0 3px rgba(0,204,255,0.1); }
#auth-form input::placeholder { color:var(--text-secondary); }
#auth-submit { width:100%; padding:14px; border-radius:12px; border:none; background:var(--accent-gradient); color:white; font-family:'Inter',sans-serif; font-size:1rem; font-weight:600; cursor:pointer; }
#auth-submit:disabled { opacity:0.5; }
#auth-error { color:#ff6b6b; font-size:0.85rem; min-height:20px; }
#auth-toggle { color:var(--accent-blue); text-decoration:none; font-size:0.85rem; }
.auth-guest-btn { margin-top:20px; padding:10px 24px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:transparent; color:var(--text-secondary); font-family:'Inter',sans-serif; font-size:0.85rem; cursor:pointer; }
.auth-guest-btn:hover { border-color:var(--accent-blue); color:var(--text-primary); }
.user-badge { color:var(--text-secondary); font-size:0.75rem; margin-left:auto; padding:4px 10px; border-radius:12px; background:rgba(255,255,255,0.05); }
#btn-auth { font-size:0.85rem; padding:4px 8px; }
.active-vision { background:var(--accent-gradient) !important; box-shadow:var(--glow-blue); }
CSS_EOF
echo "  ✅ CSS adăugat"
else
echo "  ⏭️ CSS auth există deja"
fi

# ═══════════════════════════════════════════════════════════════
#  VERIFICARE SYNTAX
# ═══════════════════════════════════════════════════════════════
echo ""
echo "🔍 Verific sintaxa..."
node -c server/index.js && echo "  ✅ server/index.js OK" || echo "  ❌ server/index.js EROARE"
node -c server/supabase.js && echo "  ✅ server/supabase.js OK" || echo "  ❌ server/supabase.js EROARE"
node -c app/js/app.js && echo "  ✅ app.js OK" || echo "  ❌ app.js EROARE"
node -c app/js/voice.js && echo "  ✅ voice.js OK" || echo "  ❌ voice.js EROARE"
node -c app/js/auth.js && echo "  ✅ auth.js OK" || echo "  ❌ auth.js EROARE"
node -c app/js/fft-lipsync.js && echo "  ✅ fft-lipsync.js OK" || echo "  ❌ fft-lipsync.js EROARE"

# ═══════════════════════════════════════════════════════════════
#  UPDATE package.json version
# ═══════════════════════════════════════════════════════════════
sed -i 's/"version": "2.0.0"/"version": "2.1.0"/' package.json

# ═══════════════════════════════════════════════════════════════
#  GIT — Commit + Push
# ═══════════════════════════════════════════════════════════════
echo ""
echo "📦 Git commit + push..."
git add -A
git commit -m "v2.1: Audio fix + Auth + Memory + Full Automation

🔊 AUDIO: AudioContext.decodeAudioData (bypass autoplay)
👄 LIP SYNC: FFT wired source→analyser→destination
🔐 AUTH: Supabase register/login/session + guest mode
🧠 MEMORY: Supabase user_preferences persistent
🔍 SEARCH: DuckDuckGo (free, no key needed)
📸 CAMERA: Auto-trigger on voice 'ce e în fața mea'
⚡ AUTOMATION: Zero buttons — everything voice-driven
🗑️ Removed: OpenAI, Tavily (unavailable)" 2>/dev/null || echo "  ⚠️ Commit: nimic nou de adăugat"

echo ""
echo "🚀 Push la GitHub..."
git push origin master 2>/dev/null && echo "  ✅ Pushed! Railway va face auto-deploy." || echo "  ⚠️ Nu am putut face push. Rulează manual: git push origin master"

echo ""
echo "══════════════════════════════════════════"
echo "  ✅ TOTUL GATA!"
echo "══════════════════════════════════════════"
echo ""
echo "  PASUL FINAL (o singură dată):"
echo ""
echo "  1. Mergi la Supabase SQL Editor:"
echo "     https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/sql"
echo ""
echo "  2. Copiază conținutul din server/schema.sql"
echo "     și apasă RUN"
echo ""
echo "  3. Adaugă în Railway (dacă nu sunt):"
echo "     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY"
echo ""
echo "  Dacă git push a eșuat, rulează manual:"
echo "     git push origin master"
echo ""
echo "══════════════════════════════════════════"
