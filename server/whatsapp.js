// ═══════════════════════════════════════════════════════════════
// KelionAI v2.5 — WHATSAPP BOT (Cloud API)
// Text + Audio (STT/TTS) + Video (camera analysis)
// Webhook: https://kelionai.app/api/whatsapp/webhook
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const FormData = require('form-data');
const logger = require('./logger');

const router = express.Router();

// ═══ CONFIG ═══
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'kelionai_wa_verify_2026';
const GRAPH_API = 'https://graph.facebook.com/v21.0';

// ═══ STATS ═══
const stats = { messagesReceived: 0, repliesSent: 0, activeUsers: new Set() };

// ═══ STARTUP VALIDATION ═══
if (!WA_TOKEN) {
    logger.warn({ component: 'WhatsApp' }, 'WhatsApp token not set. Set WA_ACCESS_TOKEN (or WHATSAPP_TOKEN) — bot will not send messages');
}
if (!PHONE_NUMBER_ID) {
    logger.warn({ component: 'WhatsApp' }, 'WhatsApp Phone Number ID not set. Set WA_PHONE_NUMBER_ID — bot will not send messages');
}

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
    // Script-based detection first (unambiguous)
    if (/[\u0600-\u06FF]/.test(text)) return 'ar';
    if (/[\u0590-\u05FF]/.test(text)) return 'he';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/[\u0400-\u04FF]/.test(text)) {
        if (/\b(я|ти|він|вона|ми|ви|вони|привіт|дякую|так|ні)\b/.test(text)) return 'uk';
        return 'ru';
    }
    // Latin-based detection
    if (/\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)) return 'en';
    if (/\b(și|sau|este|sunt|pentru|care|cum|unde|vreau|poți|bună|salut|mulțumesc)\b/.test(t)) return 'ro';
    if (/\b(ich|du|er|sie|wir|ist|sind|mit|für|auf|hallo|danke|bitte|wie|was)\b/.test(t)) return 'de';
    if (/\b(je|tu|il|elle|nous|est|avec|pour|dans|bonjour|merci|oui|non|comment)\b/.test(t)) return 'fr';
    if (/\b(yo|tú|él|ella|nosotros|hola|gracias|sí|cómo|para)\b/.test(t)) return 'es';
    if (/\b(io|tu|lui|lei|noi|ciao|grazie|sì|come|sono)\b/.test(t)) return 'it';
    if (/\b(eu|tu|ele|ela|nós|olá|obrigado|sim|não|como|para)\b/.test(t)) return 'pt';
    if (/\b(ik|jij|hij|zij|wij|hallo|dank|ja|nee|hoe)\b/.test(t)) return 'nl';
    if (/\b(ja|ty|on|ona|my|cześć|dziękuję|tak|nie|jak)\b/.test(t)) return 'pl';
    if (/\b(ben|sen|bu|için|ile|merhaba|teşekkür|evet|hayır)\b/.test(t)) return 'tr';
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

// ═══ ADMIN KEYWORD BLACKLIST ═══
const ADMIN_KEYWORDS = /\b(admin|administrator|dashboard|panou\s*admin|setări\s*admin|settings\s*admin|admin\s*panel|admin\s*mode|deschide\s*admin)\b/i;

// ═══ GROUP STATE — for smart intervention ═══
const groupState = new Map(); // chatId -> { lastActivity, unansweredQuestions, lastIntervention }
const GROUP_INTERVENTION_COOLDOWN = 5 * 60 * 1000;  // 5 minutes
const GROUP_PAUSE_THRESHOLD = 2 * 60 * 1000;         // 2 minutes

function updateGroupState(chatId, text) {
    const state = groupState.get(chatId) || { lastActivity: 0, unansweredQuestions: [], lastIntervention: 0 };
    state.lastActivity = Date.now();
    // Track unanswered questions (messages ending with ?)
    if (text && text.trim().endsWith('?')) {
        state.unansweredQuestions.push({ text, time: Date.now() });
        if (state.unansweredQuestions.length > 5) state.unansweredQuestions.shift();
    }
    groupState.set(chatId, state);
}

function shouldIntervene(chatId, isDirectlyAddressed) {
    if (isDirectlyAddressed) return true;
    const state = groupState.get(chatId);
    if (!state) return false;
    // Cooldown: don't intervene more than once per 5 minutes
    if (state.lastIntervention && Date.now() - state.lastIntervention < GROUP_INTERVENTION_COOLDOWN) return false;
    // Intervene only if there's been a pause > 2 min and there are unanswered questions
    if (Date.now() - state.lastActivity > GROUP_PAUSE_THRESHOLD && state.unansweredQuestions.length > 0) {
        return true;
    }
    return false;
}

function getInterventionPrefix(lang) {
    const prefixes = {
        ro: 'Scuzați că intervin, dar cred că pot ajuta cu asta... ',
        en: 'Sorry to jump in, but I might be able to help with that... ',
        es: 'Disculpen la interrupción, pero creo que puedo ayudar... ',
        fr: 'Excusez-moi d\'intervenir, mais je peux peut-être aider... ',
        de: 'Entschuldigung, dass ich mich einmische, aber ich kann vielleicht helfen... ',
        it: 'Scusate se mi intrometto, ma credo di poter aiutare... ',
        pt: 'Desculpem a intromissão, mas talvez eu possa ajudar... ',
        nl: 'Sorry dat ik me erbij mengt, maar ik kan misschien helpen... ',
        pl: 'Przepraszam, że się wtrącam, ale może mogę pomóc... ',
        ru: 'Извините, что вмешиваюсь, но я, возможно, могу помочь... ',
        ja: '割り込んですみませんが、お手伝いできるかもしれません... ',
        zh: '打扰一下，我或许可以帮上忙... '
    };
    return prefixes[lang] || prefixes.en;
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
async function sendAudioMessage(to, mediaId) {
    if (!WA_TOKEN || !PHONE_NUMBER_ID) return;
    const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'audio',
            audio: { id: mediaId }
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
    try {
        // Step 1: get media URL
        const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
        });
        if (!metaRes.ok) {
            logger.error({ component: 'WhatsApp', mediaId, status: metaRes.status }, 'Failed to get media URL');
            return null;
        }
        const meta = await metaRes.json();

        // Step 2: download binary
        const dataRes = await fetch(meta.url, {
            headers: { 'Authorization': `Bearer ${WA_TOKEN}` }
        });
        if (!dataRes.ok) {
            logger.error({ component: 'WhatsApp', mediaId, status: dataRes.status }, 'Failed to download media');
            return null;
        }
        return dataRes.buffer();
    } catch (e) {
        logger.error({ component: 'WhatsApp', mediaId, err: e.message }, 'downloadMedia error');
        return null;
    }
}

// ═══ UPLOAD MEDIA TO WHATSAPP ═══
async function uploadMedia(buffer, mimeType) {
    if (!WA_TOKEN || !PHONE_NUMBER_ID) return null;
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'audio.ogg', contentType: mimeType || 'audio/ogg' });
        form.append('messaging_product', 'whatsapp');
        const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${WA_TOKEN}`, ...form.getHeaders() },
            body: form
        });
        if (res.ok) {
            const data = await res.json();
            return data.id || null;
        }
        logger.error({ component: 'WhatsApp', status: res.status }, 'Media upload failed');
    } catch (e) {
        logger.error({ component: 'WhatsApp', err: e.message }, 'uploadMedia error');
    }
    return null;
}

// ═══ SPEECH-TO-TEXT (Whisper via OpenAI or Groq) ═══
async function transcribeAudio(audioBuffer, mimeType) {
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.GROQ_API_KEY
        ? 'https://api.groq.com/openai/v1'
        : 'https://api.openai.com/v1';

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
async function generateSpeech(text, lang, character) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return null;
    const voiceId = character === 'kira'
        ? (process.env.ELEVENLABS_VOICE_KIRA || 'EXAVITQu4vr4xnSDxMaL')
        : (process.env.ELEVENLABS_VOICE_KELION || 'VR6AewLTigWG4xSOukaG');

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
        let body;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) :
                Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
        } catch (parseErr) {
            logger.error({ component: 'WhatsApp', err: parseErr.message }, 'Failed to parse request body');
            return;
        }

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
                                if (!userText) userText = '[Could not transcribe voice message]';
                            }
                        } catch (e) {
                            logger.error({ component: 'WhatsApp', err: e.message }, 'Audio processing failed');
                            userText = '[Audio processing error]';
                        }
                    } else if (msgType === 'video') {
                        // Video → analyze (extract audio, transcribe)
                        try {
                            const videoBuffer = await downloadMedia(msg.video.id);
                            if (videoBuffer) {
                                userText = await analyzeVideo(videoBuffer);
                                if (!userText) userText = '[Could not analyze video]';
                            }
                        } catch (e) {
                            logger.error({ component: 'WhatsApp', err: e.message }, 'Video processing failed');
                            userText = '[Video processing error]';
                        }
                    } else if (msgType === 'image') {
                        try {
                            const imageBuffer = await downloadMedia(msg.image.id);
                            if (imageBuffer) {
                                const caption = msg.image.caption || '';
                                const apiKey = process.env.OPENAI_API_KEY;
                                if (apiKey) {
                                    const base64Image = imageBuffer.toString('base64');
                                    const safeCaption = caption.replace(/["\\\n\r]/g, ' ').slice(0, 500);
                                    const userPrompt = safeCaption
                                        ? `The user sent this image with text: "${safeCaption}". Describe what you see, identify people, objects, places, text.`
                                        : 'Describe in detail what you see in this image. Identify people, objects, places, visible text, colors, actions.';
                                    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            model: 'gpt-4o',
                                            messages: [{ role: 'user', content: [
                                                { type: 'text', text: userPrompt },
                                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' } }
                                            ]}],
                                            max_tokens: 1000
                                        })
                                    });
                                    if (visionRes.ok) {
                                        const visionData = await visionRes.json();
                                        userText = (visionData.choices?.[0]?.message?.content) || caption || 'I received an image.';
                                    } else {
                                        userText = caption || 'I received an image but could not analyze it.';
                                    }
                                } else {
                                    userText = caption || 'I received an image.';
                                }
                            } else {
                                userText = msg.image.caption || 'I received an image but could not download it.';
                            }
                        } catch (e) {
                            logger.error({ component: 'WhatsApp', err: e.message }, 'Image processing failed');
                            userText = msg.image.caption || '[Image processing error]';
                        }
                    } else {
                        continue; // Skip unsupported types
                    }

                    if (!userText) continue;

                    // ═══ ADMIN KEYWORD BLACKLIST — total silence for non-owners ═══
                    if (ADMIN_KEYWORDS.test(userText)) continue;

                    // ═══ DETERMINE CHAT TYPE & CHARACTER ═══
                    const isGroup = isGroupChat(msg);
                    const chatId = isGroup ? (msg.group_id || phone) : phone;

                    // Always store message in conversation history (listening mode)
                    addToHistory(chatId, contactName || phone, userText);

                    // Update group state for smart intervention
                    if (isGroup) updateGroupState(chatId, userText);

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

                    // ═══ GROUP LOGIC: respond only when addressed or for polite intervention ═══
                    if (isGroup) {
                        const addressed = getAddressedCharacter(userText);
                        if (!shouldIntervene(chatId, !!addressed)) {
                            // Not addressed and no polite intervention warranted → stay silent
                            continue;
                        }
                        // Set active character for this response
                        if (addressed) chatCharacter.set(chatId, addressed);
                        // Mark intervention time
                        const gs = groupState.get(chatId);
                        if (gs) { gs.lastIntervention = Date.now(); gs.unansweredQuestions = []; }
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
                    const detectedLangForPrompt = detectLanguage(userText);
                    const prompt = context
                        ? `[Conversation context:\n${context}]\n\nUser: ${userText}`
                        : userText;

                    if (brain) {
                        try {
                            const timeout = new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Brain timeout')), 15000)
                            );
                            const result = await Promise.race([
                                brain.think(prompt, character, [], detectedLangForPrompt || 'auto'),
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

                    // Prefix polite intervention phrase for unsolicited group responses
                    if (isGroup && !getAddressedCharacter(userText)) {
                        const lang = detectedLangForPrompt || 'en';
                        reply = getInterventionPrefix(lang) + reply;
                    }

                    // Send text response always
                    await sendTextMessage(phone, reply);
                    stats.repliesSent++;

                    // If voice message → also send audio response
                    if (respondWithAudio) {
                        try {
                            const speechBuffer = await generateSpeech(reply, null, character);
                            if (speechBuffer) {
                                const mediaId = await uploadMedia(speechBuffer, 'audio/ogg');
                                if (mediaId) {
                                    await sendAudioMessage(phone, mediaId);
                                } else {
                                    logger.warn({ component: 'WhatsApp' }, 'TTS audio upload failed, text-only response sent');
                                }
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
