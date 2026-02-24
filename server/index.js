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
