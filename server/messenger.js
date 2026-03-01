// KelionAI v2.4 — MESSENGER BOT (Full AI: Text + Audio + Video + Image + Documents)
// Webhook: https://kelionai.app/api/messenger/webhook
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

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

// FEATURE 6: SUBSCRIBER MANAGEMENT
var subscribedUsers = new Set();
var lastMessageTime = new Map();
var _supabase = null;

function setSupabase(client) {
    _supabase = client;
    // Restore subscribers from DB on startup
    if (client) {
        client.from('messenger_subscribers').select('sender_id').then(function (result) {
            if (result.data) {
                result.data.forEach(function (row) { subscribedUsers.add(row.sender_id); });
                if (subscribedUsers.size > 0) logger.info({ component: 'Messenger', count: subscribedUsers.size }, 'Subscribers restored');
            }
        }).catch(function (err) {
            logger.warn({ component: 'Messenger', err: err && err.message }, 'Could not restore messenger_subscribers (table may not exist)');
        });
    }
}

// TEMPORARY MEDIA BUFFERS (for TTS voice + image serving)
var mediaBuffers = new Map();

// Clean up expired media buffers every 10 minutes
setInterval(function () {
    var now = Date.now();
    mediaBuffers.forEach(function (entry, id) {
        if (now > entry.expiresAt) mediaBuffers.delete(id);
    });
}, 600000).unref();

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

// FEATURE 1: EXTRACT DOCUMENT TEXT
async function extractDocumentText(buffer, mimeType, filename) {
    var ext = (filename || '').split('.').pop().toLowerCase();
    try {
        if (mimeType === 'application/pdf' || ext === 'pdf') {
            var data = await pdfParse(buffer);
            return (data.text || '').slice(0, 3000);
        }
        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
            var result = await mammoth.extractRawText({ buffer: buffer });
            return (result.value || '').slice(0, 3000);
        }
        if (['txt', 'csv', 'json', 'md'].includes(ext) || (mimeType && mimeType.startsWith('text/'))) {
            return buffer.toString('utf8').slice(0, 3000);
        }
    } catch (e) {
        logger.warn({ component: 'Messenger', err: e.message }, 'Document extraction failed');
    }
    return null;
}

// SEND MESSAGE (Feature 5: optional quickReplies)
async function sendMessage(recipientId, text, quickReplies) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    var message = { text: text.slice(0, 2000) };
    if (quickReplies && quickReplies.length > 0) {
        message.quick_replies = quickReplies.map(function (qr) {
            if (typeof qr === 'string') {
                return { content_type: 'text', title: qr.slice(0, 20), payload: qr.toUpperCase().replace(/[^A-Z0-9]/g, '_') };
            }
            return qr;
        }).slice(0, 13);
    }
    var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: message })
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

// FEATURE 2: SEND AUDIO MESSAGE
async function sendAudioMessage(recipientId, audioUrl) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    try {
        var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } } }
            })
        });
        if (!res.ok) {
            var body = await res.text();
            logger.error({ component: 'Messenger', status: res.status, body: body }, 'Audio send failed');
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'sendAudioMessage error');
    }
}

// FEATURE 2: GENERATE AND SEND VOICE REPLY
async function generateAndSendVoice(recipientId, text, character) {
    var apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return;
    var appUrl = process.env.APP_URL || 'https://kelionai.app';
    try {
        var voiceId = character === 'kira'
            ? (process.env.ELEVENLABS_VOICE_KIRA || 'EXAVITQu4vr4xnSDxMaL')
            : (process.env.ELEVENLABS_VOICE_KELION || 'VR6AewLTigWG4xSOukaG');
        var res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({
                text: text.slice(0, 500),
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });
        if (!res.ok) return;
        var audioBuffer = Buffer.from(await res.arrayBuffer());
        var audioId = crypto.randomBytes(16).toString('hex');
        mediaBuffers.set(audioId, { buffer: audioBuffer, contentType: 'audio/mpeg', expiresAt: Date.now() + 3600000 });
        var audioUrl = appUrl + '/api/messenger/media/' + audioId;
        await sendAudioMessage(recipientId, audioUrl);
        logger.info({ component: 'Messenger', recipientId: recipientId }, 'Voice reply sent');
    } catch (e) {
        logger.warn({ component: 'Messenger', err: e.message }, 'Voice generation failed');
    }
}

// FEATURE 3: SEND IMAGE MESSAGE
async function sendImageMessage(recipientId, imageUrl) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    try {
        var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } }
            })
        });
        if (!res.ok) {
            var body = await res.text();
            logger.error({ component: 'Messenger', status: res.status, body: body }, 'Image send failed');
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'sendImageMessage error');
    }
}

// FEATURE 3: SEND GENERIC TEMPLATE (Carousel)
async function sendGenericTemplate(recipientId, elements) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    try {
        var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: {
                    attachment: {
                        type: 'template',
                        payload: { template_type: 'generic', elements: elements.slice(0, 10) }
                    }
                }
            })
        });
        if (!res.ok) {
            var body = await res.text();
            logger.error({ component: 'Messenger', status: res.status, body: body }, 'Generic template send failed');
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'sendGenericTemplate error');
    }
}

// FEATURE 3: SEND BUTTON TEMPLATE
async function sendButtonTemplate(recipientId, text, buttons) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return;
    try {
        var res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: {
                    attachment: {
                        type: 'template',
                        payload: { template_type: 'button', text: text.slice(0, 640), buttons: buttons.slice(0, 3) }
                    }
                }
            })
        });
        if (!res.ok) {
            var body = await res.text();
            logger.error({ component: 'Messenger', status: res.status, body: body }, 'Button template send failed');
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'sendButtonTemplate error');
    }
}

// FEATURE 4: SETUP PERSISTENT MENU
async function setupPersistentMenu() {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return { error: 'No page token configured' };
    try {
        var res = await fetch('https://graph.facebook.com/v21.0/me/messenger_profile?access_token=' + token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                persistent_menu: [{
                    locale: 'default',
                    composer_input_disabled: false,
                    call_to_actions: [
                        { type: 'postback', title: '🤖 Kelion', payload: 'SWITCH_KELION' },
                        { type: 'postback', title: '👩‍💻 Kira', payload: 'SWITCH_KIRA' },
                        { type: 'web_url', title: '🌐 kelionai.app', url: 'https://kelionai.app' },
                        { type: 'postback', title: '📰 Știri', payload: 'GET_NEWS' },
                        { type: 'postback', title: '❓ Ajutor', payload: 'GET_HELP' }
                    ]
                }]
            })
        });
        var data = await res.json();
        logger.info({ component: 'Messenger', result: data }, 'Persistent menu set up');
        return data;
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'setupPersistentMenu failed');
        return { error: e.message };
    }
}

// FEATURE 4: HANDLE POSTBACK EVENTS
async function handlePostback(senderId, payload, appLocals) {
    try {
        if (payload === 'SWITCH_KELION') {
            chatCharacter.set(senderId, 'kelion');
            await sendMessage(senderId, '🤖 Kelion este acum asistentul tau!', ['💬 Chat', '📰 Știri', '🌤️ Meteo']);
        } else if (payload === 'SWITCH_KIRA') {
            chatCharacter.set(senderId, 'kira');
            await sendMessage(senderId, '👩‍💻 Kira este acum asistenta ta!', ['💬 Chat', '📰 Știri', '🌤️ Meteo']);
        } else if (payload === 'GET_NEWS') {
            var getArticles = appLocals && appLocals._getNewsArticles;
            var articles = getArticles ? getArticles() : [];
            if (articles && articles.length > 0) {
                await sendMessage(senderId, '📰 Ultimele stiri:');
                await sendGenericTemplate(senderId, buildNewsElements(articles.slice(0, 3)));
            } else {
                await sendMessage(senderId, '📰 Nu am stiri disponibile momentan. Revino curand!');
            }
        } else if (payload === 'GET_HELP') {
            await sendMessage(senderId,
                '❓ Cum te pot ajuta:\n\n' +
                '📝 Trimite text — raspund intrebarii tale\n' +
                '🖼️ Trimite imagine — analizez poza\n' +
                '🎤 Trimite mesaj vocal — transcriu si raspund\n' +
                '📄 Trimite document — extrag si analizez textul\n' +
                '📰 Scrie "stiri" — iti trimit ultimele stiri\n' +
                '🤖 Scrie "kelion" sau "kira" — schimba asistentul\n' +
                '🔔 Scrie "aboneaza-ma" — notificari stiri\n\n' +
                '🌐 Mai multe pe kelionai.app',
                ['💬 Chat', '📰 Știri', '🌐 Site']
            );
        }
    } catch (e) {
        logger.warn({ component: 'Messenger', senderId: senderId, payload: payload, err: e.message }, 'Postback handling failed');
    }
}

// HELPER: BUILD NEWS CAROUSEL ELEMENTS
function buildNewsElements(articles) {
    return articles.map(function (a) {
        return {
            title: (a.title || 'Știre').slice(0, 80),
            subtitle: (a.description || a.summary || '').slice(0, 80),
            image_url: a.image || a.imageUrl || 'https://kelionai.app/og-image.jpg',
            default_action: { type: 'web_url', url: a.url || a.link || 'https://kelionai.app' },
            buttons: [{ type: 'web_url', title: '🔗 Citeste', url: a.url || a.link || 'https://kelionai.app' }]
        };
    });
}

// FEATURE 6: BROADCAST TO SUBSCRIBERS
async function broadcastToSubscribers(message, quickReplies) {
    var now = Date.now();
    var windowMs = 24 * 60 * 60 * 1000;
    var sent = 0;
    for (var userId of subscribedUsers) {
        var lastMsg = lastMessageTime.get(userId) || 0;
        if (now - lastMsg > windowMs) continue;
        try {
            await sendMessage(userId, message, quickReplies);
            sent++;
        } catch (e) {
            logger.warn({ component: 'Messenger', userId: userId, err: e.message }, 'Broadcast to subscriber failed');
        }
    }
    return sent;
}

// FEATURE 6: NOTIFY SUBSCRIBERS WITH NEWS (exported for index.js)
async function notifySubscribersNews(articles) {
    if (!articles || articles.length === 0) return;
    var now = Date.now();
    var windowMs = 24 * 60 * 60 * 1000;
    var top3 = articles.slice(0, 3);
    var elements = buildNewsElements(top3);
    var targets = Array.from(subscribedUsers);
    for (var i = 0; i < targets.length; i++) {
        var userId = targets[i];
        var lastMsg = lastMessageTime.get(userId) || 0;
        if (now - lastMsg > windowMs) continue;
        try {
            await sendMessage(userId, '📰 Stiri noi pentru tine:');
            await sendGenericTemplate(userId, elements);
            logger.info({ component: 'Messenger', userId: userId }, 'News notification sent');
        } catch (e) {
            logger.warn({ component: 'Messenger', userId: userId, err: e.message }, 'News notification failed');
        }
    }
}

// GENERATE IMAGE VIA DALL-E 3
async function generateImage(prompt) {
    var apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
        var res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'dall-e-3', prompt: prompt, n: 1, size: '1024x1024', response_format: 'url' })
        });
        if (res.ok) {
            var data = await res.json();
            return data.data && data.data[0] && data.data[0].url;
        }
    } catch (e) {
        logger.warn({ component: 'Messenger', err: e.message }, 'Image generation failed');
    }
    return null;
}

// SERVE TEMPORARY MEDIA BUFFERS (audio/images)
router.get('/media/:id', function (req, res) {
    var entry = mediaBuffers.get(req.params.id);
    if (!entry || Date.now() > entry.expiresAt) return res.status(404).send('Not found');
    res.set('Content-Type', entry.contentType);
    res.send(entry.buffer);
});

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

// ═══ AUTO-SUBSCRIBE PAGE TO WEBHOOKS ═══
router.get('/subscribe', async function (req, res) {
    var token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return res.status(500).json({ error: 'FB_PAGE_ACCESS_TOKEN not set' });
    try {
        var meRes = await fetch('https://graph.facebook.com/v21.0/me?access_token=' + token);
        var me = await meRes.json();
        if (!me.id) return res.status(500).json({ error: 'Cannot get page ID', details: me });
        var subRes = await fetch('https://graph.facebook.com/v21.0/' + me.id + '/subscribed_apps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads',
                access_token: token
            })
        });
        var result = await subRes.json();
        logger.info({ component: 'Messenger', pageId: me.id, result: result }, 'Webhook subscription result');
        res.json({ success: result.success, pageId: me.id, pageName: me.name });
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Subscribe failed');
        res.status(500).json({ error: e.message });
    }
});

// FEATURE 4: SETUP MENU ENDPOINT
router.get('/setup-menu', async function (req, res) {
    var result = await setupPersistentMenu();
    res.json(result);
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
                if (!senderId) continue;

                // FEATURE 4: HANDLE POSTBACK EVENTS
                if (event.postback) {
                    lastMessageTime.set(senderId, Date.now());
                    await handlePostback(senderId, event.postback.payload, req.app.locals);
                    stats.messagesReceived++;
                    stats.activeSenders.add(senderId);
                    stats.repliesSent++;
                    continue;
                }

                var message = event.message;
                if (!message || message.is_echo) continue;

                stats.messagesReceived++;
                stats.activeSenders.add(senderId);
                lastMessageTime.set(senderId, Date.now());
                if (isRateLimited(senderId)) continue;

                await sendTypingOn(senderId);

                var userText = '';
                var visionResponse = null;
                var attachments = message.attachments || [];
                var receivedAudio = false;

                // FEATURE 5: HANDLE QUICK REPLY PAYLOAD
                if (message.quick_reply && message.quick_reply.payload) {
                    var qrPayload = message.quick_reply.payload;
                    if (qrPayload === 'SWITCH_KELION' || qrPayload === 'SWITCH_KIRA' ||
                        qrPayload === 'GET_NEWS' || qrPayload === 'GET_HELP') {
                        await handlePostback(senderId, qrPayload, req.app.locals);
                        stats.repliesSent++;
                        continue;
                    }
                    // Use payload as text if it doesn't match a known command
                    if (!message.text) userText = qrPayload;
                }

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
                        receivedAudio = true;
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
                        // FEATURE 1: DOCUMENT TEXT ANALYSIS
                        var fileBuffer = await downloadMediaFromUrl(attUrl);
                        if (fileBuffer) {
                            var fileName = att.payload && att.payload.name || '';
                            var fileMime = att.payload && att.payload.mime_type || '';
                            var extractedText = await extractDocumentText(fileBuffer, fileMime, fileName);
                            if (extractedText) {
                                if (!userText) userText = 'Am trimis un document';
                                visionResponse = null; // will use AI for document
                                userText = 'Analizeaza urmatorul continut din documentul meu:\n\n' + extractedText;
                            } else {
                                if (!userText) userText = 'Am trimis un document';
                                visionResponse = 'Am primit documentul. Formatul nu este suportat momentan (suport: PDF, DOCX, TXT, CSV, JSON, MD).';
                            }
                        } else {
                            if (!userText) userText = 'Am trimis un document';
                            visionResponse = 'Nu am putut descarca documentul. Te rog incearca din nou.';
                        }
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
                    await sendMessage(senderId, (charName === 'kelion' ? '🤖 ' : '👩‍💻 ') + displayName + ' este acum asistentul tau. Cu ce te pot ajuta?', ['💬 Chat', '📰 Știri', '🌤️ Meteo']);
                    stats.repliesSent++;
                    continue;
                }

                // FEATURE 6: SUBSCRIBE / UNSUBSCRIBE
                var supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
                var textLower = (userText || '').toLowerCase().trim();
                if (/^(subscribe|aboneaza-ma|notificari)$/i.test(textLower)) {
                    subscribedUsers.add(senderId);
                    if (supabase) {
                        try {
                            await supabase.from('messenger_subscribers').upsert({ sender_id: senderId, subscribed_at: new Date().toISOString() }, { onConflict: 'sender_id' });
                        } catch (ex) { /* table may not exist */ }
                    }
                    await sendMessage(senderId, '✅ Esti abonat la notificari de stiri! Vei fi notificat cand apar stiri noi.\n\nScrie "dezaboneaza-ma" oricand pentru a opri notificarile.');
                    stats.repliesSent++;
                    continue;
                }
                if (/^(unsubscribe|dezaboneaza-ma)$/i.test(textLower)) {
                    subscribedUsers.delete(senderId);
                    if (supabase) {
                        try {
                            await supabase.from('messenger_subscribers').delete().eq('sender_id', senderId);
                        } catch (ex) { /* table may not exist */ }
                    }
                    await sendMessage(senderId, '❌ Ai fost dezabonat de la notificari. Ne vedem curand! 👋');
                    stats.repliesSent++;
                    continue;
                }

                // NEWS REQUEST — show carousel
                if (/\b(stiri|news|noutati|ultimele\s+stiri)\b/i.test(textLower)) {
                    var getArticles = req.app.locals._getNewsArticles;
                    var articles = getArticles ? getArticles() : [];
                    if (articles && articles.length > 0) {
                        await sendMessage(senderId, '📰 Ultimele stiri:');
                        await sendGenericTemplate(senderId, buildNewsElements(articles.slice(0, 3)));
                        addToHistory(senderId, chatCharacter.get(senderId) === 'kira' ? 'Kira' : 'Kelion', 'Stiri trimise');
                        stats.repliesSent++;
                        continue;
                    }
                }

                var character = chatCharacter.get(senderId) || 'kelion';

                // IMAGE GENERATION REQUEST (Feature 3)
                if (!visionResponse && /\b(genereaz[aă]\s+imagine|generate\s+image|creeaz[aă]\s+(o\s+)?imagine|deseneaz[aă])\b/i.test(userText)) {
                    var imageUrl = await generateImage(userText);
                    if (imageUrl) {
                        await sendMessage(senderId, '🎨 Iata imaginea generata pentru tine!');
                        await sendImageMessage(senderId, imageUrl);
                        addToHistory(senderId, character === 'kira' ? 'Kira' : 'Kelion', 'Imagine generata');
                        stats.repliesSent++;
                        continue;
                    }
                }

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

                // DETERMINE QUICK REPLIES FOR RESPONSE
                var msgCount = (userMessageCount.get(senderId) || 0) + 1;
                userMessageCount.set(senderId, msgCount);
                var replyQuickReplies;
                if (msgCount === FREE_MESSAGES_LIMIT) {
                    replyQuickReplies = ['💎 Upgrade', '🌐 Site'];
                }

                await sendMessage(senderId, reply, replyQuickReplies);
                addToHistory(senderId, character === 'kira' ? 'Kira' : 'Kelion', reply);
                stats.repliesSent++;

                // FEATURE 2: VOICE REPLY when user sent audio
                if (receivedAudio) {
                    await generateAndSendVoice(senderId, reply, character);
                }

                // USER PROTOCOL
                var known = await getKnownUser(senderId, supabase);

                if (!known) {
                    var detectedLang = detectLanguage(userText || '');
                    await saveKnownUser(senderId, detectedLang, senderName, supabase);
                    // FEATURE 5: Quick replies for new users
                    setTimeout(async function () {
                        try {
                            await sendMessage(senderId, '👋 Bun venit! Sunt ' + (character === 'kira' ? 'Kira' : 'Kelion') + ', asistentul tau AI.\n\nCe doresti sa faci?', ['🤖 Kelion', '👩‍💻 Kira', '📰 Știri', '❓ Ajutor']);
                        } catch (ex) { logger.warn({ component: 'Messenger', err: ex.message }, 'Welcome message failed'); }
                    }, 1500);
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
                            try {
                                await sendMessage(senderId, greetings[known.lang] || greetings.en);
                            } catch (ex) { logger.warn({ component: 'Messenger', err: ex.message }, 'Return greeting failed'); }
                        }, 1000);
                    }
                    var newLang = detectLanguage(userText || '');
                    if (newLang !== known.lang) {
                        await saveKnownUser(senderId, newLang, known.name, supabase);
                    }
                }

                if (msgCount === FREE_MESSAGES_LIMIT) {
                    setTimeout(async function () {
                        try {
                            await sendMessage(senderId,
                                'Ai folosit ' + FREE_MESSAGES_LIMIT + ' mesaje gratuite!\n\n' +
                                'Continua cu functii premium pe kelionai.app:\n' +
                                'Chat nelimitat cu AI\nAvatare 3D\nVoce naturala\n\n' +
                                'Aboneaza-te: https://kelionai.app/pricing',
                                ['💎 Upgrade', '🌐 Site']
                            );
                        } catch (ex) { logger.warn({ component: 'Messenger', err: ex.message }, 'Free limit message failed'); }
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
                    } catch (ex) { /* table may not exist */ }
                }
            }
        }
    } catch (ex) {
        logger.error({ component: 'Messenger', err: ex.message }, 'Webhook handler error');
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
        ttsEnabled: !!process.env.ELEVENLABS_API_KEY,
        stats: getStats(),
        webhookUrl: (process.env.APP_URL || 'https://kelionai.app') + '/api/messenger/webhook'
    });
});

function getStats() {
    return {
        messagesReceived: stats.messagesReceived,
        repliesSent: stats.repliesSent,
        activeSenders: stats.activeSenders.size,
        subscribers: subscribedUsers.size
    };
}

module.exports = { router, getStats, notifySubscribersNews, setupPersistentMenu, setSupabase };
