// KelionAI v2.4 — MESSENGER BOT (Full AI: Text + Audio + Video + Image + Documents)
// Webhook: https://kelionai.app/api/messenger/webhook
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// STATS
const stats = { messagesReceived: 0, repliesSent: 0, activeSenders: new Set() };

// CHARACTER SELECTION
const chatCharacter = new Map();

// CONVERSATION CONTEXT
const MAX_CONTEXT_MESSAGES = 50;
const conversationHistory = new Map();

function addToHistory(senderId, from, text) {
    if (!conversationHistory.has(senderId)) conversationHistory.set(senderId, []);
    const history = conversationHistory.get(senderId);
    history.push({ from, text, timestamp: Date.now() });
    if (history.length > MAX_CONTEXT_MESSAGES) history.splice(0, history.length - MAX_CONTEXT_MESSAGES);
}

function getContextSummary(senderId) {
    const history = conversationHistory.get(senderId) || [];
    if (history.length === 0) return '';
    return history.map(h => h.from + ': ' + h.text).join('\n');
}

// KNOWN USERS
const knownUsers = new Map();
const userMessageCount = new Map();
const FREE_MESSAGES_LIMIT = 15;

async function getKnownUser(senderId, supabase) {
    if (knownUsers.has(senderId)) return knownUsers.get(senderId);
    if (supabase) {
        try {
            const { data } = await supabase.from('messenger_users').select('*').eq('sender_id', senderId).single();
            if (data) {
                knownUsers.set(senderId, { lang: data.language, name: data.name, firstSeen: data.first_seen });
                return knownUsers.get(senderId);
            }
        } catch (e) { /* table may not exist */ }
    }
    return null;
}

async function saveKnownUser(senderId, lang, name, supabase) {
    knownUsers.set(senderId, { lang, name, firstSeen: new Date().toISOString() });
    if (supabase) {
        try {
            await supabase.from('messenger_users').upsert({
                sender_id: senderId, language: lang, name: name || null,
                first_seen: new Date().toISOString(), last_seen: new Date().toISOString()
            }, { onConflict: 'sender_id' });
        } catch (e) { /* in-memory fallback */ }
    }
}

// LANGUAGE DETECTION
function detectLanguage(text) {
    var t = (text || '').toLowerCase();
    if (/\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)) return 'en';
    if (/\b(der|die|das|ist|und|ich|ein|wie|was)\b/.test(t)) return 'de';
    if (/\b(le|la|les|est|et|un|une|je|que|comment|bonjour)\b/.test(t)) return 'fr';
    if (/\b(el|los|es|un|una|que|como|por|hola)\b/.test(t)) return 'es';
    if (/\b(il|lo|di|che|un|una|come|sono|ciao)\b/.test(t)) return 'it';
    return 'ro';
}

// RATE LIMITING
var RATE_LIMIT_MAX = 15;
var RATE_LIMIT_WINDOW_MS = 60 * 1000;
var senderRateLimits = new Map();

function isRateLimited(senderId) {
    var now = Date.now();
    var entry = senderRateLimits.get(senderId);
    if (!entry || now >= entry.resetAt) {
        senderRateLimits.set(senderId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count++;
    return false;
}

// GET SENDER PROFILE
async function getSenderProfile(senderId) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return null;
    try {
        var res = await fetch(
            'https://graph.facebook.com/v21.0/' + senderId + '?fields=first_name,last_name&access_token=' + token
        );
        if (res.ok) {
            var data = await res.json();
            return data.first_name ? (data.first_name + ' ' + (data.last_name || '')).trim() : null;
        }
    } catch (e) {
        logger.warn({ component: 'Messenger', senderId, err: e.message }, 'Failed to get sender profile');
    }
    return null;
}

// DOWNLOAD MEDIA FROM URL
async function downloadMediaFromUrl(url) {
    try {
        var res = await fetch(url);
        if (res.ok) return res.buffer();
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Media download failed');
    }
    return null;
}

// ANALYZE IMAGE WITH GPT-4o VISION
async function analyzeImage(imageBuffer, caption, mimeType) {
    var apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return caption || 'I received an image but no vision API key is configured.';

    var base64Image = imageBuffer.toString('base64');
    var mediaType = mimeType || 'image/jpeg';
    var userPrompt = caption
        ? 'Utilizatorul a trimis aceasta imagine cu textul: "' + caption + '". Descrie ce vezi, identifica persoane, obiecte, locuri, texte.'
        : 'Descrie in detaliu ce vezi in aceasta imagine. Identifica persoane, obiecte, locuri, texte vizibile, culori, actiuni.';

    try {
        var res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: userPrompt },
                        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64Image, detail: 'high' } }
                    ]
                }],
                max_tokens: 1000
            })
        });
        if (res.ok) {
            var data = await res.json();
            return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'Am vazut imaginea.';
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Vision error');
    }
    return 'Nu am putut analiza imaginea momentan.';
}

// TRANSCRIBE AUDIO (Whisper)
async function transcribeAudio(audioBuffer, mimeType) {
    var apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    var baseUrl = process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    var FormData = require('form-data');
    var form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.mp4', contentType: mimeType || 'audio/mp4' });
    form.append('model', process.env.GROQ_API_KEY ? 'whisper-large-v3' : 'whisper-1');
    try {
        var res = await fetch(baseUrl + '/audio/transcriptions', {
            method: 'POST',
            headers: Object.assign({ 'Authorization': 'Bearer ' + apiKey }, form.getHeaders()),
            body: form
        });
        if (res.ok) {
            var data = await res.json();
            return data.text || '';
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'STT failed');
    }
    return null;
}

// SEND MESSAGE
async function sendMessage(recipientId, text) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: text.slice(0, 2000) }
        })
    });
    if (!res.ok) {
        var body = await res.text();
        logger.error({ component: 'Messenger', status: res.status, body: body }, 'Send failed');
    }
}

// SEND TYPING INDICATOR
async function sendTypingOn(recipientId) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    try {
        await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: recipientId }, sender_action: 'typing_on' })
        });
    } catch (e) { }
}

// WEBHOOK VERIFICATION
router.get('/webhook', function (req, res) {
    var mode = req.query['hub.mode'];
    var token = req.query['hub.verify_token'];
    var challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
        logger.info({ component: 'Messenger' }, 'Webhook verified');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// INCOMING MESSAGE HANDLER
router.post('/webhook', async function (req, res) {
    res.sendStatus(200);
    try {
        // CRITICAL: req.body should be a Buffer because of express.raw() in index.js
        // Handle both raw Buffer and already-parsed JSON (defensive)
        var rawBody, body;
        if (Buffer.isBuffer(req.body)) {
            rawBody = req.body;
            body = JSON.parse(rawBody.toString());
        } else if (typeof req.body === 'string') {
            rawBody = Buffer.from(req.body);
            body = JSON.parse(req.body);
        } else if (req.body && typeof req.body === 'object') {
            // Already parsed by express.json()
            rawBody = Buffer.from(JSON.stringify(req.body));
            body = req.body;
        } else {
            logger.warn({ component: 'Messenger' }, 'Empty or missing body');
            return;
        }

        // HMAC-SHA256 validation
        var appSecret = process.env.FB_APP_SECRET;
        if (appSecret) {
            var sig = req.headers['x-hub-signature-256'];
            if (!sig) {
                logger.warn({ component: 'Messenger' }, 'Missing signature');
                return;
            }
            var expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
            if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
                logger.warn({ component: 'Messenger' }, 'Invalid signature');
                return;
            }
        }

        if (body.object !== 'page') return;

        for (var e = 0; e < (body.entry || []).length; e++) {
            var entry = body.entry[e];
            for (var m = 0; m < (entry.messaging || []).length; m++) {
                var event = entry.messaging[m];
                var senderId = event.sender && event.sender.id;
                var message = event.message;
                if (!senderId || !message || message.is_echo) continue;

                stats.messagesReceived++;
                stats.activeSenders.add(senderId);
                if (isRateLimited(senderId)) continue;

                await sendTypingOn(senderId);

                var userText = '';
                var visionResponse = null;
                var attachments = message.attachments || [];

                // HANDLE TEXT
                if (message.text) {
                    userText = message.text;
                }

                // HANDLE ATTACHMENTS (image, audio, video, file)
                for (var a = 0; a < attachments.length; a++) {
                    var att = attachments[a];
                    var attType = att.type;
                    var attUrl = att.payload && att.payload.url;
                    if (!attUrl) continue;

                    if (attType === 'image') {
                        var imgBuffer = await downloadMediaFromUrl(attUrl);
                        if (imgBuffer) {
                            visionResponse = await analyzeImage(imgBuffer, message.text || null, 'image/jpeg');
                            if (!userText) userText = 'Am trimis o imagine';
                        }
                    } else if (attType === 'audio') {
                        var audBuffer = await downloadMediaFromUrl(attUrl);
                        if (audBuffer) {
                            var transcript = await transcribeAudio(audBuffer, 'audio/mp4');
                            if (transcript) {
                                userText = transcript;
                            } else {
                                userText = '[Voice message - could not transcribe]';
                            }
                        }
                    } else if (attType === 'video') {
                        var vidBuffer = await downloadMediaFromUrl(attUrl);
                        if (vidBuffer) {
                            var vidTranscript = await transcribeAudio(vidBuffer, 'video/mp4');
                            if (vidTranscript) {
                                visionResponse = 'Am analizat videoclipul tau. Am auzit: "' + vidTranscript + '"';
                            } else {
                                visionResponse = 'Am primit videoclipul dar nu am putut extrage continut.';
                            }
                            if (!userText) userText = 'Am trimis un videoclip';
                        }
                    } else if (attType === 'file') {
                        if (!userText) userText = 'Am trimis un document';
                        visionResponse = 'Am primit documentul. Momentan pot analiza imagini si audio. Suportul pentru documente text vine in curand.';
                    }
                }

                if (!userText && !visionResponse) continue;

                // GET SENDER NAME
                var senderName = await getSenderProfile(senderId) || 'User';
                addToHistory(senderId, senderName, userText);

                // CHARACTER SELECTION
                if (/^(kelion|kira)$/i.test((userText || '').trim())) {
                    var charName = userText.trim().toLowerCase();
                    chatCharacter.set(senderId, charName);
                    var displayName = charName === 'kelion' ? 'Kelion' : 'Kira';
                    await sendMessage(senderId, (charName === 'kelion' ? '🤖 ' : '👩‍💻 ') + displayName + ' este acum asistentul tau. Cu ce te pot ajuta?');
                    stats.repliesSent++;
                    continue;
                }

                var character = chatCharacter.get(senderId) || 'kelion';

                // AI RESPONSE
                var reply;
                if (visionResponse) {
                    reply = visionResponse;
                } else {
                    var brain = req.app.locals.brain;
                    var context = getContextSummary(senderId);
                    var prompt = context ? '[Context:\n' + context + ']\nUser: ' + userText : userText;

                    if (brain) {
                        try {
                            var timeout = new Promise(function (_, reject) {
                                setTimeout(function () { reject(new Error('Brain timeout')); }, 20000);
                            });
                            var result = await Promise.race([
                                brain.think(prompt, character, [], 'auto'),
                                timeout
                            ]);
                            reply = (result && result.enrichedMessage) || 'Nu am putut procesa mesajul.';
                        } catch (err) {
                            logger.warn({ component: 'Messenger', err: err.message }, 'Brain error');
                            reply = 'Momentan sunt ocupat. Incearca din nou.';
                        }
                    } else {
                        reply = 'Sunt KelionAI! Viziteaza https://kelionai.app';
                    }
                }

                await sendMessage(senderId, reply);
                addToHistory(senderId, character === 'kira' ? 'Kira' : 'Kelion', reply);
                stats.repliesSent++;

                // USER PROTOCOL
                var msgCount = (userMessageCount.get(senderId) || 0) + 1;
                userMessageCount.set(senderId, msgCount);

                var supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
                var known = await getKnownUser(senderId, supabase);

                if (!known) {
                    var detectedLang = detectLanguage(userText || '');
                    await saveKnownUser(senderId, detectedLang, senderName, supabase);
                } else {
                    if (msgCount === 1) {
                        var greetings = {
                            ro: 'Bine ai revenit, ' + (known.name || 'prietene') + '! 😊',
                            en: 'Welcome back, ' + (known.name || 'friend') + '! 😊',
                            de: 'Willkommen zuruck, ' + (known.name || 'Freund') + '! 😊',
                            fr: 'Bon retour, ' + (known.name || 'ami') + '! 😊',
                            es: 'Bienvenido de nuevo, ' + (known.name || 'amigo') + '! 😊'
                        };
                        setTimeout(async function () {
                            await sendMessage(senderId, greetings[known.lang] || greetings.en);
                        }, 1000);
                    }
                    var newLang = detectLanguage(userText || '');
                    if (newLang !== known.lang) {
                        await saveKnownUser(senderId, newLang, known.name, supabase);
                    }
                }

                if (msgCount === FREE_MESSAGES_LIMIT) {
                    setTimeout(async function () {
                        await sendMessage(senderId,
                            'Ai folosit ' + FREE_MESSAGES_LIMIT + ' mesaje gratuite!\n\n' +
                            'Continua cu functii premium pe kelionai.app:\n' +
                            'Chat nelimitat cu AI\nAvatare 3D\nVoce naturala\n\n' +
                            'Aboneaza-te: https://kelionai.app/pricing');
                    }, 3000);
                }

                // SAVE TO SUPABASE
                if (supabase) {
                    try {
                        await supabase.from('messenger_messages').insert({
                            sender_id: senderId, direction: 'in',
                            message_type: attachments.length > 0 ? attachments[0].type : 'text',
                            text: userText, created_at: new Date().toISOString()
                        });
                        await supabase.from('messenger_messages').insert({
                            sender_id: senderId, direction: 'out',
                            message_type: 'text',
                            text: reply, created_at: new Date().toISOString()
                        });
                    } catch (e) { /* table may not exist */ }
                }
            }
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Webhook handler error');
    }
});

// HEALTH
router.get('/health', function (req, res) {
    res.json({
        status: process.env.FB_PAGE_ACCESS_TOKEN && process.env.FB_APP_SECRET ? 'configured' : 'misconfigured',
        hasPageToken: !!process.env.FB_PAGE_ACCESS_TOKEN,
        hasAppSecret: !!process.env.FB_APP_SECRET,
        hasVerifyToken: !!process.env.FB_VERIFY_TOKEN,
        graphApiVersion: 'v21.0',
        visionEnabled: !!process.env.OPENAI_API_KEY,
        sttEnabled: !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY),
        stats: getStats(),
        webhookUrl: (process.env.APP_URL || 'https://kelionai.app') + '/api/messenger/webhook'
    });
});

function getStats() {
    return {
        messagesReceived: stats.messagesReceived,
        repliesSent: stats.repliesSent,
        activeSenders: stats.activeSenders.size
    };
}

module.exports = { router, getStats };
