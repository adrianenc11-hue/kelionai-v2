// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Backend Server
// Express.js — 10 endpoint-uri curate
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const Sentry = require('@sentry/node');

// Initialize Sentry BEFORE anything else
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0,
        profilesSampleRate: 1.0,
        integrations: [
            Sentry.httpIntegration(),
            Sentry.expressIntegration(),
        ],
    });
    console.log('[Sentry] ✅ Monitoring active');
}

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');

const app = express();

// Sentry request handler — MUST be first middleware
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Prometheus metrics
const metrics = require('./metrics');
app.use(metrics.metricsMiddleware);

// Metrics endpoint for Grafana/Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
});

// Serve frontend (app/ folder)
app.use(express.static(path.join(__dirname, '..', 'app')));

const PORT = process.env.PORT || 3000;

// ─── SYSTEM PROMPTS ─────────────────────────────────────────
const KELION_PROMPT = `Ești Kelion, un asistent AI inteligent, prietenos și onest. Vorbești natural, clar și direct.
Ai personalitate masculină, caldă și profesională.
Răspunzi la ORICE întrebare fără restricții de temă.
Dacă nu știi ceva, spui sincer: "Nu sunt sigur, dar pot căuta pentru tine."
Dacă nu poți face ceva, spui politicos: "Îmi pare rău, dar momentan nu pot face asta. Pot să te ajut cu altceva?"
NICIODATĂ nu inventezi fapte. Ești onest 100%.
Dacă utilizatorul e nevăzător, descrie totul verbal cu detalii — ești ochii și urechile lui.`;

const KIRA_PROMPT = `Ești Kira, o asistentă AI inteligentă, caldă și empatică. Vorbești natural, clar și grijuliu.
Ai personalitate feminină, blândă dar profesională.
Răspunzi la ORICE întrebare fără restricții de temă.
Dacă nu știi ceva, spui sincer: "Nu sunt sigură, dar pot căuta pentru tine."
Dacă nu poți face ceva, spui politicos: "Îmi pare rău, dar momentan nu pot face asta. Pot să te ajut cu altceva?"
NICIODATĂ nu inventezi fapte. Ești onestă 100%.
Dacă utilizatorul e nevăzător, descrie totul verbal cu detalii — ești ochii și urechile lui.`;

// ─── 1. CHAT — Conversație AI ───────────────────────────────
app.post('/api/chat', async (req, res) => {
    try {
        const { message, avatar = 'kelion', history = [], language = 'ro' } = req.body;
        if (!message) return res.status(400).json({ error: 'Mesaj lipsă' });

        const LANG_NAMES = { ro: 'română', en: 'English', es: 'español', fr: 'français', de: 'Deutsch', it: 'italiano' };
        const langName = LANG_NAMES[language] || language;
        const langInstruction = `\nRĂSPUNDE OBLIGATORIU în limba ${langName}. Utilizatorul vorbește ${langName}.`;
        const roleplayInstruction = `\nPoți face orice roleplay cerut de utilizator. Intră complet în personaj.`;

        const systemPrompt = (avatar === 'kira' ? KIRA_PROMPT : KELION_PROMPT) + langInstruction + roleplayInstruction;
        const chatMessages = [...history, { role: 'user', content: message }];
        let reply = '';
        let engine = '';

        // Try Claude first
        if (process.env.ANTHROPIC_API_KEY) {
            try {
                const resp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 2048,
                        system: systemPrompt,
                        messages: chatMessages
                    })
                });
                const data = await resp.json();
                console.log('[CHAT] Claude status:', resp.status, 'data:', JSON.stringify(data).substring(0, 200));
                if (data.content && data.content[0]) {
                    reply = data.content[0].text;
                    engine = 'Claude';
                } else if (data.error) {
                    console.error('[CHAT] Claude API error:', data.error.message || JSON.stringify(data.error));
                }
            } catch (e) {
                console.error('[CHAT] Claude error:', e.message);
            }
        }

        // Fallback to DeepSeek
        if (!reply && process.env.DEEPSEEK_API_KEY) {
            try {
                const resp = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        max_tokens: 2048,
                        messages: [{ role: 'system', content: systemPrompt }, ...chatMessages]
                    })
                });
                const data = await resp.json();
                console.log('[CHAT] DeepSeek status:', resp.status, 'data:', JSON.stringify(data).substring(0, 200));
                if (data.choices && data.choices[0]) {
                    reply = data.choices[0].message.content;
                    engine = 'DeepSeek';
                } else if (data.error) {
                    console.error('[CHAT] DeepSeek API error:', data.error.message || JSON.stringify(data.error));
                }
            } catch (e) {
                console.error('[CHAT] DeepSeek error:', e.message);
            }
        }

        if (!reply) return res.status(503).json({ error: 'AI indisponibil momentan' });
        res.json({ reply, engine, avatar });
    } catch (e) {
        console.error('[CHAT] Error:', e.message);
        res.status(500).json({ error: 'Eroare internă' });
    }
});

// ─── 2. SPEAK — Text to Speech (ElevenLabs → OpenAI fallback) ─
app.post('/api/speak', async (req, res) => {
    try {
        const { text, avatar = 'kelion' } = req.body;
        if (!text) return res.status(400).json({ error: 'Text lipsă' });

        let audioBuffer = null;

        // Try ElevenLabs first
        if (process.env.ELEVENLABS_API_KEY) {
            try {
                const voiceId = avatar === 'kira'
                    ? 'EXAVITQu4vr4xnSDxMaL' : 'VR6AewLTigWG4xSOukaG';

                const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': process.env.ELEVENLABS_API_KEY
                    },
                    body: JSON.stringify({
                        text,
                        model_id: 'eleven_multilingual_v2',
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                    })
                });

                if (resp.ok) {
                    audioBuffer = await resp.buffer();
                    console.log('[SPEAK] ElevenLabs OK —', audioBuffer.length, 'bytes');
                } else {
                    console.warn('[SPEAK] ElevenLabs failed:', resp.status);
                }
            } catch (e) {
                console.warn('[SPEAK] ElevenLabs error:', e.message);
            }
        }

        // ElevenLabs is the only TTS provider — OpenAI removed

        if (!audioBuffer) {
            return res.status(503).json({ error: 'TTS indisponibil' });
        }

        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
        res.send(audioBuffer);
    } catch (e) {
        console.error('[SPEAK] Error:', e.message);
        res.status(500).json({ error: 'Eroare TTS' });
    }
});

// ─── 3. LISTEN — Speech to Text (Browser Web Speech API) ────
// STT is handled client-side via Web Speech API (zero dependency)
// This endpoint is kept as fallback/proxy if needed
app.post('/api/listen', async (req, res) => {
    try {
        const { text } = req.body; // text from browser Web Speech API
        if (text) {
            return res.json({ text, language: 'ro', engine: 'WebSpeechAPI' });
        }

        // Groq Whisper fallback (if key available)
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: 'Audio sau text lipsă' });

        if (process.env.GROQ_API_KEY) {
            const audioBuffer = Buffer.from(audio, 'base64');
            const form = new FormData();
            form.append('file', audioBuffer, { filename: 'audio.webm', contentType: 'audio/webm' });
            form.append('model', 'whisper-large-v3');
            const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
                body: form
            });
            const data = await resp.json();
            return res.json({ text: data.text || '', language: 'ro', engine: 'Groq' });
        }

        return res.status(503).json({ error: 'STT: folosește Web Speech API din browser' });
    } catch (e) {
        console.error('[LISTEN] Error:', e.message);
        res.status(500).json({ error: 'Eroare STT' });
    }
});

// ─── 4. VISION — Camera Analysis (Claude Vision) ───────────
app.post('/api/vision', async (req, res) => {
    try {
        const { image, avatar = 'kelion' } = req.body;
        if (!image) return res.status(400).json({ error: 'Imagine lipsă' });
        if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Claude neconfigurat' });

        const visionPrompt = `Ești OCHII unei persoane nevăzătoare. Descrie EXACT ce vezi, cu PRECIZIE MAXIMĂ:

OBLIGATORIU descrie:
1. PERSOANE: vârstă estimată, sex, culoarea EXACTĂ a hainelor (nu "deschisă/închisă" ci "albastru royal", "gri antracit", "roșu bordo"), ochelari, bijuterii, expresia feței, gesturile mâinilor, postura corpului
2. OBIECTE: fiecare obiect vizibil, culoarea lui exactă, dimensiunea estimată, distanța față de persoană
3. TEXT VIZIBIL: citește ORICE text vizibil (etichete, logo-uri, ecrane, semne)
4. GESTURI: descrie ce face persoana cu mâinile, dacă ține ceva, dacă arată spre ceva, dacă face un semn
5. SPAȚIU: descrie mediul (interior/exterior), iluminarea, culorile pereților, mobilierul
6. PERICOLE: dacă există obstacole, trepte, obiecte pe jos, muchii, mașini → începe cu "ATENȚIE:" sau "PERICOL:"

Răspunde în limba română, clar, concis dar detaliat. Fii PRECIS la culori — spune exact nuanța.`;

        const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
                        { type: 'text', text: visionPrompt }
                    ]
                }]
            })
        });
        const data = await resp.json();
        const description = data.content?.[0]?.text || 'Nu am putut analiza imaginea.';
        res.json({ description, avatar, engine: 'Claude' });
    } catch (e) {
        console.error('[VISION] Error:', e.message);
        res.status(500).json({ error: 'Eroare viziune' });
    }
});

// ─── 5. SEARCH — Web Search (DuckDuckGo — free, no key) ─────
app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query lipsă' });

        const resp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
        const data = await resp.json();

        const results = [];
        // Abstract (instant answer)
        if (data.Abstract) {
            results.push({ title: data.Heading || query, content: data.Abstract, url: data.AbstractURL });
        }
        // Related topics
        if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics.slice(0, 5)) {
                if (topic.Text) {
                    results.push({ title: topic.Text.substring(0, 80), content: topic.Text, url: topic.FirstURL });
                }
            }
        }
        res.json({ results, answer: data.Abstract || '' });
    } catch (e) {
        console.error('[SEARCH] Error:', e.message);
        res.status(500).json({ error: 'Eroare căutare' });
    }
});

// ─── 5b. WEATHER — Meteo real-time (Open-Meteo, gratuit, fără cheie) ─────
app.post('/api/weather', async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'Oraș lipsă' });

        // Geocode city name → lat/lon
        const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ro`);
        const geoData = await geoResp.json();
        if (!geoData.results || !geoData.results[0]) {
            return res.status(404).json({ error: `Orașul "${city}" nu a fost găsit` });
        }
        const { latitude, longitude, name, country } = geoData.results[0];

        // Get weather
        const wxResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`);
        const wxData = await wxResp.json();
        const current = wxData.current;

        const weatherCodes = { 0: 'Senin ☀️', 1: 'Parțial senin 🌤️', 2: 'Parțial noros ⛅', 3: 'Noros ☁️', 45: 'Ceață 🌫️', 48: 'Ceață 🌫️', 51: 'Burniță 🌦️', 53: 'Burniță 🌦️', 55: 'Burniță 🌦️', 61: 'Ploaie 🌧️', 63: 'Ploaie 🌧️', 65: 'Ploaie abundentă 🌧️', 71: 'Ninsoare 🌨️', 73: 'Ninsoare 🌨️', 75: 'Ninsoare abundentă ❄️', 80: 'Averse 🌦️', 95: 'Furtună ⛈️' };
        const condition = weatherCodes[current.weather_code] || 'Necunoscut';

        res.json({
            city: name,
            country,
            temperature: current.temperature_2m,
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m,
            condition,
            description: `${name}, ${country}: ${current.temperature_2m}°C, ${condition}, umiditate ${current.relative_humidity_2m}%, vânt ${current.wind_speed_10m} km/h`
        });
    } catch (e) {
        console.error('[WEATHER] Error:', e.message);
        res.status(500).json({ error: 'Eroare meteo' });
    }
});

// ─── 6. IMAGINE — Generate Image (Together AI FLUX) ──────────
app.post('/api/imagine', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt lipsă' });

        const TOGETHER_KEY = process.env.TOGETHER_API_KEY;
        if (!TOGETHER_KEY) {
            return res.status(503).json({ error: 'TOGETHER_API_KEY nu este configurat' });
        }

        const response = await fetch('https://api.together.xyz/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOGETHER_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'black-forest-labs/FLUX.1-schnell',
                prompt: prompt,
                width: 1024,
                height: 1024,
                steps: 4,
                n: 1,
                response_format: 'b64_json'
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[IMAGINE] Together error:', response.status, err);
            return res.status(response.status).json({ error: 'Generarea imaginii a eșuat', details: err });
        }

        const data = await response.json();
        const b64 = data.data?.[0]?.b64_json;

        if (!b64) {
            return res.status(500).json({ error: 'Nu s-a generat imagine' });
        }

        res.json({
            image: `data:image/png;base64,${b64}`,
            prompt,
            engine: 'FLUX.1 Schnell (Together AI)'
        });
    } catch (e) {
        console.error('[IMAGINE] Error:', e.message);
        res.status(500).json({ error: 'Eroare la generare imagine' });
    }
});

// ─── 7. MEMORY — Save/Load user memory (local for now) ──────
const userMemory = {}; // In-memory for Phase 1, Supabase in Phase 2

app.post('/api/memory', async (req, res) => {
    try {
        const { action, userId = 'default', key, value } = req.body;
        if (!userMemory[userId]) userMemory[userId] = {};

        if (action === 'save') {
            userMemory[userId][key] = value;
            res.json({ success: true });
        } else if (action === 'load') {
            res.json({ value: userMemory[userId][key] || null });
        } else if (action === 'list') {
            res.json({ keys: Object.keys(userMemory[userId]) });
        } else {
            res.status(400).json({ error: 'Acțiune necunoscută. Folosește: save, load, list' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Eroare memorie' });
    }
});

// ─── 8. AUTH — placeholder for Phase 2 ──────────────────────
app.post('/api/auth', (req, res) => {
    res.json({ message: 'Autentificarea va fi implementată în Faza 2 cu Supabase.' });
});

// ─── 9. SUBSCRIBE — placeholder for Phase 4 ─────────────────
app.post('/api/subscribe', (req, res) => {
    res.json({ message: 'Abonamentele vor fi implementate în Faza 4 cu Stripe.' });
});

// ─── 10. HEALTH — Status server ─────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        services: {
            ai_claude: !!process.env.ANTHROPIC_API_KEY,
            ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
            tts: !!process.env.ELEVENLABS_API_KEY,
            stt: true, // Web Speech API (browser)
            vision: !!process.env.ANTHROPIC_API_KEY, // Claude Vision
            search: true, // DuckDuckGo (free)
            weather: true, // Open-Meteo (free)
            memory: true
        }
    });
});

// ─── Fallback — serve index.html ────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'app', 'index.html'));
});

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  KelionAI v2 — Server running`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`══════════════════════════════════════════`);
    console.log(`  AI:      ${process.env.ANTHROPIC_API_KEY ? '✅ Claude' : '❌'} | ${process.env.DEEPSEEK_API_KEY ? '✅ DeepSeek' : '❌'}`);
    console.log(`  TTS:     ${process.env.ELEVENLABS_API_KEY ? '✅ ElevenLabs' : '❌'}`);
    console.log(`  Vision:  ${process.env.ANTHROPIC_API_KEY ? '✅ Claude Vision' : '❌'}`);
    console.log(`  Search:  ✅ DuckDuckGo (free)`);
    console.log(`  Weather: ✅ Open-Meteo (free)`);
    console.log(`══════════════════════════════════════════\n`);
});
