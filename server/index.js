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

        // Fallback to OpenAI TTS
        if (!audioBuffer && process.env.OPENAI_API_KEY) {
            try {
                const voice = avatar === 'kira' ? 'nova' : 'onyx';
                const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: 'tts-1',
                        input: text,
                        voice: voice,
                        response_format: 'mp3'
                    })
                });

                if (resp.ok) {
                    audioBuffer = await resp.buffer();
                    console.log('[SPEAK] OpenAI TTS OK —', audioBuffer.length, 'bytes');
                } else {
                    const errText = await resp.text();
                    console.error('[SPEAK] OpenAI TTS failed:', resp.status, errText);
                }
            } catch (e) {
                console.error('[SPEAK] OpenAI TTS error:', e.message);
            }
        }

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

// ─── 3. LISTEN — Speech to Text (Whisper) ───────────────────
app.post('/api/listen', async (req, res) => {
    try {
        const { audio } = req.body; // base64 encoded audio
        if (!audio) return res.status(400).json({ error: 'Audio lipsă' });
        if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OpenAI neconfigurat' });

        const audioBuffer = Buffer.from(audio, 'base64');
        const form = new FormData();
        form.append('file', audioBuffer, { filename: 'audio.webm', contentType: 'audio/webm' });
        form.append('model', 'whisper-1');
        // Don't force language — let Whisper auto-detect

        const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            body: form
        });
        const data = await resp.json();
        res.json({ text: data.text || '', language: 'ro' });
    } catch (e) {
        console.error('[LISTEN] Error:', e.message);
        res.status(500).json({ error: 'Eroare STT' });
    }
});

// ─── 4. VISION — Camera Analysis ────────────────────────────
app.post('/api/vision', async (req, res) => {
    try {
        const { image, avatar = 'kelion' } = req.body; // base64 image
        if (!image) return res.status(400).json({ error: 'Imagine lipsă' });
        if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OpenAI neconfigurat' });

        const visionPrompt = `Ești OCHII unei persoane. Fă o analiză completă a ce vezi în imagine.
Descrie: obiecte, persoane, text vizibil, culori, distanțe aproximative.
Dacă observi ORICE risc de navigație (trepte, obstacole, mașini, denivelări), 
începe OBLIGATORIU cu: "ATENȚIE:" sau "PERICOL:"
Răspunde în limba română, clar și detaliat.`;

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: visionPrompt },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }
                    ]
                }]
            })
        });
        const data = await resp.json();
        const description = data.choices?.[0]?.message?.content || 'Nu am putut analiza imaginea.';
        res.json({ description, avatar });
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

// ─── 6. IMAGINE — Generate Image (DALL-E 3) ─────────────────
app.post('/api/imagine', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: 'Prompt lipsă' });
        if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OpenAI neconfigurat' });

        const resp = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt,
                n: 1,
                size: '1024x1024',
                quality: 'standard'
            })
        });
        const data = await resp.json();
        res.json({ url: data.data?.[0]?.url || null });
    } catch (e) {
        console.error('[IMAGINE] Error:', e.message);
        res.status(500).json({ error: 'Eroare generare imagine' });
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
            ai: !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
            tts: !!process.env.ELEVENLABS_API_KEY,
            stt: !!process.env.OPENAI_API_KEY,
            vision: !!process.env.OPENAI_API_KEY,
            search: !!process.env.TAVILY_API_KEY,
            memory: true
        }
    });
});

// ─── Fallback — serve index.html ────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'app', 'index.html'));
});

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  KelionAI v2 — Server running`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`══════════════════════════════════════════`);
    console.log(`  AI:     ${process.env.ANTHROPIC_API_KEY ? '✅ Claude' : '❌'} | ${process.env.OPENAI_API_KEY ? '✅ GPT-4o' : '❌'}`);
    console.log(`  TTS:    ${process.env.ELEVENLABS_API_KEY ? '✅ ElevenLabs' : '❌'}`);
    console.log(`  Search: ${process.env.TAVILY_API_KEY ? '✅ Tavily' : '❌'}`);
    console.log(`══════════════════════════════════════════\n`);
});
