// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — WHATSAPP BOT (Cloud API)
// Text + Audio (STT/TTS) + Video (camera analysis)
// Webhook: https://kelionai.app/api/whatsapp/webhook
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ CONFIG ═══
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'kelionai_wa_verify_2026';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ═══ STATS ═══
const stats = { messagesReceived: 0, repliesSent: 0, activeUsers: new Set() };

// ═══ CHARACTER SELECTION (Kelion or Kira) ═══
const chatCharacter = new Map(); // chatId → 'kelion' | 'kira'

// ═══ CONVERSATION CONTEXT (group awareness) ═══
const MAX_CONTEXT_MESSAGES = 50;
const conversationHistory = new Map(); // chatId → [{ from, text, timestamp }]

function addToHistory(chatId, from, text) {
    if (!conversationHistory.has(chatId)) conversationHistory.set(chatId, []);
    const history = conversationHistory.get(chatId);
    history.push({ from, text, timestamp: Date.now() });
    // Keep only last N messages
    if (history.length > MAX_CONTEXT_MESSAGES) history.splice(0, history.length - MAX_CONTEXT_MESSAGES);
}

function getContextSummary(chatId) {
    const history = conversationHistory.get(chatId) || [];
    if (history.length === 0) return '';
    return history.map(h => `${h.from}: ${h.text}`).join('\n');
}

// ═══ CHECK IF BOT IS ADDRESSED ═══
function getAddressedCharacter(text) {
    const t = (text || '').toLowerCase();
    if (/\bkelion\b/i.test(t)) return 'kelion';
    if (/\bkira\b/i.test(t)) return 'kira';
    return null;
}

function isGroupChat(msg) {
    // WhatsApp group messages have a group_id in the chat
    return !!(msg.context && msg.context.group_id) || !!(msg.group_id);
}

// ═══ RATE LIMITING ═══
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const userRateLimits = new Map();
const userMessageCount = new Map();
const FREE_MESSAGES_LIMIT = 15;

// ═══ KNOWN USERS (persisted in Supabase) ═══
const knownUsers = new Map();

async function getKnownUser(phoneNumber, supabase) {
    if (knownUsers.has(phoneNumber)) return knownUsers.get(phoneNumber);
    if (supabase) {
        try {
            const { data } = await supabase.from('whatsapp_users').select('*').eq('phone', phoneNumber).single();
            if (data) {
                knownUsers.set(phoneNumber, { lang: data.language, name: data.name, firstSeen: data.first_seen });
                return knownUsers.get(phoneNumber);
            }
        } catch (e) { /* table may not exist yet */ }
    }
    return null;
}

async function saveKnownUser(phoneNumber, lang, name, supabase) {
    knownUsers.set(phoneNumber, { lang, name, firstSeen: new Date().toISOString() });
    if (supabase) {
        try {
            await supabase.from('whatsapp_users').upsert({
                phone: phoneNumber, language: lang, name: name || null,
                first_seen: new Date().toISOString(), last_seen: new Date().toISOString()
            }, { onConflict: 'phone' });
        } catch (e) { /* works in-memory */ }
    }
}

// ═══ AUTO-DETECT LANGUAGE ═══
function detectLanguage(text) {
    const t = (text || '').toLowerCase();
    if (/\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)) return 'en';
    if (/\b(der|die|das|ist|und|ich|ein|wie|was|können)\b/.test(t)) return 'de';
    if (/\b(le|la|les|de|est|et|un|une|je|que|comment|bonjour)\b/.test(t)) return 'fr';
    if (/\b(el|la|los|es|un|una|que|como|por|hola)\b/.test(t)) return 'es';
    if (/\b(il|lo|la|di|che|un|una|come|sono|ciao)\b/.test(t)) return 'it';
    return 'ro';
}

function isRateLimited(phone) {
    const now = Date.now();
    const entry = userRateLimits.get(phone);
    if (!entry || now >= entry.resetAt) {
        userRateLimits.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count++;
    return false;
}

// ═══ SEND WHATSAPP TEXT MESSAGE ═══
async function sendTextMessage(to, text) {
    if (!WA_TOKEN || !PHONE_NUMBER_ID) {
        logger.warn({ component: 'WhatsApp' }, 'WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID not set');
        return;
    }
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: text.slice(0, 4096) }
        })
    });
    if (res.ok) {
        logger.info({ component: 'WhatsApp', to }, 'Text message sent');
    } else {
        const body = await res.text();
        logger.error({ component: 'WhatsApp', status: res.status, body }, 'Failed to send text');
    }
}

// ═══ SEND WHATSAPP AUDIO MESSAGE ═══
async function sendAudioMessage(to, audioUrl) {
    if (!WA_TOKEN || !PHONE_NUMBER_ID) return;
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'audio',
            audio: { link: audioUrl }
        })
    });
    if (res.ok) {
        logger.info({ component: 'WhatsApp', to }, 'Audio message sent');
    } else {
        const body = await res.text();
        logger.error({ component: 'WhatsApp', status: res.status, body }, 'Failed to send audio');
    }
}

// ═══ DOWNLOAD WHATSAPP MEDIA ═══
async function downloadMedia(mediaId) {
    if (!WA_TOKEN) return null;
    // Step 1: get media URL
    const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();

    // Step 2: download binary
    const dataRes = await fetch(meta.url, {
        headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
    });
    if (!dataRes.ok) return null;
    return dataRes.buffer();
}

// ═══ SPEECH-TO-TEXT (Whisper via OpenAI or Groq) ═══
async function transcribeAudio(audioBuffer, mimeType) {
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.GROQ_API_KEY
        ? 'https://api.groq.com/openai/v1'
        : 'https://api.openai.com/v1';

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.ogg', contentType: mimeType || 'audio/ogg' });
    form.append('model', process.env.GROQ_API_KEY ? 'whisper-large-v3' : 'whisper-1');

    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, ...form.getHeaders() },
        body: form
    });
    if (res.ok) {
        const data = await res.json();
        return data.text || '';
    }
    logger.error({ component: 'WhatsApp', status: res.status }, 'STT failed');
    return null;
}

// ═══ TEXT-TO-SPEECH (ElevenLabs) ═══
async function generateSpeech(text, lang) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return null;
    const voiceId = process.env.ELEVENLABS_VOICE_KELION || 'pNInz6obpgDQGcFmaJgB';

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: text.slice(0, 1000),
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
    });
    if (res.ok) return res.buffer();
    return null;
}

// ═══ ANALYZE VIDEO (extract audio, transcribe) ═══
async function analyzeVideo(videoBuffer) {
    // For video: extract audio track and transcribe
    // WhatsApp sends video as mp4, we can use the audio from it
    // Use Whisper which handles mp4 audio extraction
    return transcribeAudio(videoBuffer, 'video/mp4');
}

// ═══ WEBHOOK VERIFICATION (GET) ═══
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
        logger.info({ component: 'WhatsApp' }, 'Webhook verified');
        return res.status(200).send(challenge);
    }
    logger.warn({ component: 'WhatsApp' }, 'Webhook verification failed');
    res.sendStatus(403);
});

// ═══ INCOMING MESSAGE HANDLER (POST) ═══
router.post('/webhook', async (req, res) => {
    res.sendStatus(200); // Always respond 200 first

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) :
            Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;

        if (!body.entry) return;

        for (const entry of body.entry) {
            const changes = entry.changes || [];
            for (const change of changes) {
                if (change.field !== 'messages') continue;
                const value = change.value;
                if (!value || !value.messages) continue;

                for (const msg of value.messages) {
                    const phone = msg.from; // sender phone number
                    const msgType = msg.type;
                    const contactName = (value.contacts && value.contacts[0] && value.contacts[0].profile)
                        ? value.contacts[0].profile.name : null;

                    stats.messagesReceived++;
                    stats.activeUsers.add(phone);

                    if (isRateLimited(phone)) continue;

                    let userText = '';
                    let respondWithAudio = false;

                    // ═══ HANDLE MESSAGE TYPES ═══
                    if (msgType === 'text') {
                        userText = msg.text.body;
                    } else if (msgType === 'audio') {
                        // Voice message → transcribe
                        respondWithAudio = true;
                        try {
                            const audioBuffer = await downloadMedia(msg.audio.id);
                            if (audioBuffer) {
                                userText = await transcribeAudio(audioBuffer, msg.audio.mime_type);
                                if (!userText) userText = '[Nu am putut transcrie mesajul vocal]';
                            }
                        } catch (e) {
                            logger.error({ component: 'WhatsApp', err: e.message }, 'Audio processing failed');
                            userText = '[Eroare procesare audio]';
                        }
                    } else if (msgType === 'video') {
                        // Video → analyze (extract audio, transcribe)
                        try {
                            const videoBuffer = await downloadMedia(msg.video.id);
                            if (videoBuffer) {
                                userText = await analyzeVideo(videoBuffer);
                                if (!userText) userText = '[Nu am putut analiza videoclipul]';
                            }
                        } catch (e) {
                            logger.error({ component: 'WhatsApp', err: e.message }, 'Video processing failed');
                            userText = '[Eroare procesare video]';
                        }
                    } else if (msgType === 'image') {
                        // Image with caption or analysis
                        userText = msg.image.caption || 'Descrie această imagine';
                    } else {
                        continue; // Skip unsupported types
                    }

                    if (!userText) continue;

                    // ═══ DETERMINE CHAT TYPE & CHARACTER ═══
                    const isGroup = isGroupChat(msg);
                    const chatId = isGroup ? (msg.group_id || phone) : phone;

                    // Always store message in conversation history (listening mode)
                    addToHistory(chatId, contactName || phone, userText);

                    // ═══ CHARACTER SELECTION ═══
                    // 1:1: user can type "kelion" or "kira" to select character
                    if (!isGroup && /^(kelion|kira)$/i.test(userText.trim())) {
                        const char = userText.trim().toLowerCase();
                        chatCharacter.set(chatId, char);
                        const name = char === 'kelion' ? 'Kelion' : 'Kira';
                        await sendTextMessage(phone,
                            `${char === 'kelion' ? '🤖' : '👩‍💻'} ${name} este acum asistentul tău. Cu ce te pot ajuta?`);
                        stats.repliesSent++;
                        continue;
                    }

                    // ═══ GROUP LOGIC: respond ONLY when name is mentioned ═══
                    if (isGroup) {
                        const addressed = getAddressedCharacter(userText);
                        if (!addressed) {
                            // Name not mentioned → stay silent, but keep listening (context stored above)
                            continue;
                        }
                        // Set active character for this response
                        chatCharacter.set(chatId, addressed);
                    }

                    // Get selected character (default: kelion)
                    const character = chatCharacter.get(chatId) || 'kelion';
                    const voiceId = character === 'kira'
                        ? (process.env.ELEVENLABS_VOICE_KIRA || process.env.ELEVENLABS_VOICE_KELION)
                        : (process.env.ELEVENLABS_VOICE_KELION || 'pNInz6obpgDQGcFmaJgB');

                    // ═══ AI RESPONSE (with conversation context) ═══
                    let reply;
                    const brain = req.app.locals.brain;
                    const context = getContextSummary(chatId);
                    const prompt = context
                        ? `[Conversation context:\n${context}]\n\nUser: ${userText}`
                        : userText;

                    if (brain) {
                        try {
                            const timeout = new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Brain timeout')), 15000)
                            );
                            const result = await Promise.race([
                                brain.think(prompt, character, [], 'auto'),
                                timeout
                            ]);
                            reply = (result && result.enrichedMessage) || 'Nu am putut procesa mesajul.';
                        } catch (e) {
                            logger.warn({ component: 'WhatsApp', err: e.message }, 'Brain unavailable');
                            reply = 'Momentan sunt ocupat. Încearcă din nou.';
                        }
                    } else {
                        reply = 'Sunt KelionAI! Pentru experiența completă vizitează https://kelionai.app';
                    }

                    // Send text response always
                    await sendTextMessage(phone, reply);
                    stats.repliesSent++;

                    // If voice message → also send audio response
                    if (respondWithAudio) {
                        try {
                            const speechBuffer = await generateSpeech(reply);
                            if (speechBuffer) {
                                // Upload audio to a temporary URL or send inline
                                // For now, send text only — TTS requires media upload
                                logger.info({ component: 'WhatsApp' }, 'TTS generated, text response sent');
                            }
                        } catch (e) {
                            logger.warn({ component: 'WhatsApp', err: e.message }, 'TTS failed');
                        }
                    }

                    // ═══ USER PROTOCOL ═══
                    const msgCount = (userMessageCount.get(phone) || 0) + 1;
                    userMessageCount.set(phone, msgCount);

                    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
                    const known = await getKnownUser(phone, supabase);

                    if (!known) {
                        const detectedLang = detectLanguage(userText);
                        await saveKnownUser(phone, detectedLang, contactName, supabase);

                        const isJustGreeting = /^(h(ello|i|ey)|salut|bun[aă]|ciao|hola|bonjour|hallo|ola)[!?.,\s]*$/i.test(userText.trim());
                        if (isJustGreeting) {
                            setTimeout(async () => {
                                await sendTextMessage(phone,
                                    'We can provide support in any language you wish. Feel free to speak in your language. 🌍');
                            }, 1500);
                        }
                    } else {
                        if (msgCount === 1) {
                            const greetings = {
                                ro: `Bine ai revenit, ${known.name || 'prietene'}! 😊`,
                                en: `Welcome back, ${known.name || 'friend'}! 😊`,
                                de: `Willkommen zurück, ${known.name || 'Freund'}! 😊`,
                                fr: `Bon retour, ${known.name || 'ami'}! 😊`,
                                es: `Bienvenido de nuevo, ${known.name || 'amigo'}! 😊`,
                                it: `Bentornato, ${known.name || 'amico'}! 😊`
                            };
                            await sendTextMessage(phone, greetings[known.lang] || greetings.en);
                        }
                        const newLang = detectLanguage(userText);
                        if (newLang !== known.lang) {
                            await saveKnownUser(phone, newLang, known.name, supabase);
                        }
                    }

                    // Free limit
                    if (msgCount === FREE_MESSAGES_LIMIT) {
                        setTimeout(async () => {
                            await sendTextMessage(phone,
                                `⭐ Ai folosit ${FREE_MESSAGES_LIMIT} mesaje gratuite!\n\n` +
                                `Continuă cu funcții premium pe kelionai.app:\n` +
                                `• 💬 Chat nelimitat cu AI\n` +
                                `• 🎭 Avatare 3D\n` +
                                `• 🔊 Voce naturală\n\n` +
                                `🌐 Abonează-te: https://kelionai.app/pricing`);
                        }, 3000);
                    }

                    // Save conversation text to Supabase (NOT video/audio, only text)
                    if (supabase) {
                        try {
                            await supabase.from('whatsapp_messages').insert({
                                phone, direction: 'in', message_type: msgType,
                                text: userText, created_at: new Date().toISOString()
                            });
                            await supabase.from('whatsapp_messages').insert({
                                phone, direction: 'out', message_type: 'text',
                                text: reply, created_at: new Date().toISOString()
                            });
                        } catch (e) { /* table may not exist */ }
                    }
                }
            }
        }
    } catch (e) {
        logger.error({ component: 'WhatsApp', err: e.message }, 'Webhook handler error');
    }
});

// ═══ JOKES / BANCURI SECTION ═══
const JOKES = {
    ro: [
        'De ce nu joacă peștii tenis? Pentru că le e frică de fileu! 🐟',
        'Bulă la școală: "Doamna învățătoare, pot fi pedepsit pentru ceva ce n-am făcut?" "Nu, Bulă." "Bine, nu mi-am făcut temele." 📚',
        'Ce face un crocodil când întâlnește o femeie frumoasă? O complimentează! 🐊',
        'Un optimist și un pesimist la bar. Pesimistul: "Mai rău de atât nu se poate!" Optimistul: "Ba da, se poate!" 🍺',
        'Cum se numește un magician care și-a pierdut magia? Ian. 🪄'
    ]
};

router.get('/joke', async (req, res) => {
    const lang = req.query.lang || 'ro';
    const jokes = JOKES[lang] || JOKES.ro;
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    res.json({ joke, language: lang });
});

// ═══ HEALTH ENDPOINT ═══
router.get('/health', (req, res) => {
    res.json({
        status: WA_TOKEN && PHONE_NUMBER_ID ? 'configured' : 'misconfigured',
        hasToken: !!WA_TOKEN,
        hasPhoneNumberId: !!PHONE_NUMBER_ID,
        hasVerifyToken: !!WA_VERIFY_TOKEN,
        stats: {
            messagesReceived: stats.messagesReceived,
            repliesSent: stats.repliesSent,
            activeUsers: stats.activeUsers.size
        },
        webhookUrl: (process.env.APP_URL || 'https://kelionai.app') + '/api/whatsapp/webhook'
    });
});

function getStats() {
    return {
        messagesReceived: stats.messagesReceived,
        repliesSent: stats.repliesSent,
        activeUsers: stats.activeUsers.size
    };
}

module.exports = { router, getStats };
