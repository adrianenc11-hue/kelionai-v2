// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — MESSENGER BOT (Facebook Messenger Auto-Reply)
// Webhook: https://kelionai.app/api/messenger/webhook
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ STATS ═══
const stats = {
    messagesReceived: 0,
    repliesSent: 0,
    activeSenders: new Set()
};

// ═══ RATE LIMITING (in-memory, max 10 messages/sender/minute) ═══
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const senderRateLimits = new Map(); // senderId → { count, resetAt }

// ═══ USER MESSAGE COUNTER (for site recommendations) ═══
const senderMessageCount = new Map();
const FREE_MESSAGES_LIMIT = 10;

// ═══ KNOWN USERS (persisted in Supabase) ═══
const knownSenders = new Map(); // senderId → { lang, firstSeen }

async function getKnownSender(senderId, supabase) {
    // Check memory first
    if (knownSenders.has(senderId)) return knownSenders.get(senderId);
    // Check Supabase
    if (supabase) {
        try {
            const { data } = await supabase.from('messenger_users').select('*').eq('sender_id', senderId).single();
            if (data) {
                knownSenders.set(senderId, { lang: data.language, firstSeen: data.first_seen });
                return knownSenders.get(senderId);
            }
        } catch (e) { /* table may not exist yet */ }
    }
    return null;
}

async function saveKnownSender(senderId, lang, name, supabase) {
    knownSenders.set(senderId, { lang, name, firstSeen: new Date().toISOString() });
    if (supabase) {
        try {
            await supabase.from('messenger_users').upsert({
                sender_id: senderId, language: lang, name: name || null, first_seen: new Date().toISOString(), last_seen: new Date().toISOString()
            }, { onConflict: 'sender_id' });
        } catch (e) { /* table may not exist yet - works in-memory */ }
    }
}

// ═══ GET USER NAME FROM FACEBOOK ═══
async function getUserName(senderId) {
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) return null;
    try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${senderId}?fields=first_name&access_token=${token}`);
        if (res.ok) {
            const data = await res.json();
            return data.first_name || null;
        }
    } catch (e) { /* ignore */ }
    return null;
}

function isRateLimited(senderId) {
    const now = Date.now();
    const entry = senderRateLimits.get(senderId);
    if (!entry || now >= entry.resetAt) {
        senderRateLimits.set(senderId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count++;
    return false;
}

// ═══ AUTO-DETECT LANGUAGE ═══
function detectLanguage(text) {
    const t = (text || '').toLowerCase();
    if (/\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)) return 'en';
    if (/\b(der|die|das|ist|und|ich|ein|wie|was|können)\b/.test(t)) return 'de';
    if (/\b(le|la|les|de|est|et|un|une|je|que|comment|bonjour)\b/.test(t)) return 'fr';
    if (/\b(el|la|los|es|un|una|que|como|por|hola)\b/.test(t)) return 'es';
    if (/\b(il|lo|la|di|che|un|una|come|sono|ciao)\b/.test(t)) return 'it';
    return 'ro'; // default Romanian
}

// ═══ FAQ FALLBACK ═══
function faqReply(text) {
    const t = (text || '').toLowerCase();
    if (/pre[tț]|cost|plan/.test(t)) {
        return 'KelionAI oferă 3 planuri:\n• Free — gratuit, 10 chat-uri/zi\n• Pro — €9.99/lună, 100 chat-uri/zi\n• Premium — €19.99/lună, nelimitat\nDetalii pe kelionai.app';
    }
    if (/contact|support|ajutor/.test(t)) {
        return 'Contactează-ne la: support@kelionai.app. Suntem disponibili de luni până vineri.';
    }
    if (/ce e[șs]ti|cine e[șs]ti/.test(t)) {
        return 'Sunt KelionAI — asistentul tău AI personal cu avatar 3D, suport vocal și multilingv. Încearcă pe kelionai.app!';
    }
    return 'Bună! Sunt asistentul KelionAI. Cu ce te pot ajuta?';
}

// ═══ SEND FACEBOOK MESSAGE ═══
async function sendMessage(recipientId, text) {
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) {
        logger.warn({ component: 'Messenger' }, 'FB_PAGE_ACCESS_TOKEN not set');
        return;
    }
    logger.info({ component: 'Messenger', recipientId, textLength: text.length }, 'Sending message via Graph API v21.0');
    const res = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${token}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: text.slice(0, 2000) }
            })
        }
    );
    if (res.ok) {
        logger.info({ component: 'Messenger', recipientId, status: res.status }, 'Message sent successfully');
    } else {
        const body = await res.text();
        logger.error({ component: 'Messenger', status: res.status, body }, 'Failed to send message');
    }
}

// ═══ WEBHOOK VERIFICATION (GET) ═══
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
        logger.info({ component: 'Messenger' }, 'Webhook verified');
        return res.status(200).send(challenge);
    }
    logger.warn({ component: 'Messenger' }, 'Webhook verification failed');
    res.sendStatus(403);
});

// ═══ INCOMING MESSAGE HANDLER (POST) ═══
// Note: express.raw() is applied in index.js for this route so req.body is a Buffer
router.post('/webhook', async (req, res) => {
    // Always respond 200 first so Facebook does not retry
    res.sendStatus(200);
    try {
        const rawBody = req.body; // Buffer (set by express.raw in index.js)

        // ── Validate HMAC-SHA256 signature ──
        const appSecret = process.env.FB_APP_SECRET;
        if (appSecret) {
            const sig = req.headers['x-hub-signature-256'];
            if (!sig) {
                logger.warn({ component: 'Messenger' }, 'Missing x-hub-signature-256');
                return;
            }
            const expected = 'sha256=' + crypto
                .createHmac('sha256', appSecret)
                .update(rawBody)
                .digest('hex');
            if (
                sig.length !== expected.length ||
                !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
            ) {
                logger.warn({ component: 'Messenger' }, 'Invalid signature');
                return;
            }
        }

        const body = JSON.parse(rawBody.toString());
        if (body.object !== 'page') return;

        for (const entry of (body.entry || [])) {
            for (const event of (entry.messaging || [])) {
                const senderId = event.sender && event.sender.id;
                const message = event.message;
                if (!senderId || !message || message.is_echo) continue;

                const text = message.text;
                const attachments = message.attachments || [];

                // ═══ HANDLE IMAGE/FILE ATTACHMENTS ═══
                let userText = text || '';
                let imageUrl = null;
                for (const att of attachments) {
                    if (att.type === 'image' && att.payload && att.payload.url) {
                        imageUrl = att.payload.url;
                        if (!userText) userText = 'Ce vezi in aceasta imagine?';
                    } else if (att.type === 'file' && att.payload && att.payload.url) {
                        if (!userText) userText = 'Am trimis un document. Analizeaza-l.';
                    } else if (att.type === 'audio' && att.payload && att.payload.url) {
                        if (!userText) userText = 'Am trimis un mesaj vocal.';
                    } else if (att.type === 'video' && att.payload && att.payload.url) {
                        if (!userText) userText = 'Am trimis un video.';
                    }
                }

                if (!userText) continue;

                stats.messagesReceived++;
                stats.activeSenders.add(senderId);

                // ── Per-sender rate limit ──
                if (isRateLimited(senderId)) {
                    logger.warn({ component: 'Messenger', senderId }, 'Rate limited');
                    continue;
                }

                let reply;
                const brain = req.app.locals.brain;
                if (brain) {
                    try {
                        const timeout = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Brain timeout')), 15000)
                        );
                        const thought = await Promise.race([
                            brain.think(userText, 'kelion', [], 'auto'),
                            timeout
                        ]);

                        // ── BUILD SYSTEM PROMPT ──
                        const { buildSystemPrompt } = require('./persona');
                        const systemPrompt = buildSystemPrompt('kelion', 'auto', '', {}, thought.chainOfThought);

                        // ── CALL AI (Claude → GPT-4o fallback) ──
                        const enrichedContext = thought.enrichedContext || thought.enrichedMessage || userText;
                        const aiMsgs = [{ role: 'user', content: enrichedContext }];

                        let aiReply = null;

                        // Claude (primary)
                        if (!aiReply && process.env.ANTHROPIC_API_KEY) {
                            try {
                                const r = await fetch('https://api.anthropic.com/v1/messages', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
                                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system: systemPrompt, messages: aiMsgs })
                                });
                                const d = await r.json();
                                aiReply = d.content?.[0]?.text;
                            } catch (e) { logger.warn({ component: 'Messenger', err: e.message }, 'Claude call failed'); }
                        }

                        // GPT-4o (fallback)
                        if (!aiReply && process.env.OPENAI_API_KEY) {
                            try {
                                const r = await fetch('https://api.openai.com/v1/chat/completions', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
                                    body: JSON.stringify({ model: 'gpt-4o', max_tokens: 500, messages: [{ role: 'system', content: systemPrompt }, ...aiMsgs] })
                                });
                                const d = await r.json();
                                aiReply = d.choices?.[0]?.message?.content;
                            } catch (e) { logger.warn({ component: 'Messenger', err: e.message }, 'GPT-4o call failed'); }
                        }

                        reply = aiReply || faqReply(userText);
                    } catch (e) {
                        logger.warn({ component: 'Messenger', err: e.message }, 'Brain unavailable, using FAQ');
                        reply = faqReply(userText);
                    }
                } else {
                    reply = faqReply(userText);
                }

                await sendMessage(senderId, reply);
                stats.repliesSent++;
                logger.info({ component: 'Messenger', senderId }, 'Reply sent');

                // ═══ USER ENGAGEMENT TRACKING ═══
                const msgCount = (senderMessageCount.get(senderId) || 0) + 1;
                senderMessageCount.set(senderId, msgCount);

                // ═══ FIRST-EVER CONTACT? Check Supabase ═══
                const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
                const known = await getKnownSender(senderId, supabase);

                if (!known) {
                    // New user — get name, save, detect language
                    const userName = await getUserName(senderId);
                    const detectedLang = detectLanguage(text);
                    await saveKnownSender(senderId, detectedLang, userName, supabase);

                    // If first message is just a greeting, hint about multilingual support
                    const isJustGreeting = /^(h(ello|i|ey)|salut|bun[aă]|ciao|hola|bonjour|hallo|ola)[!?.,\s]*$/i.test(text.trim());
                    if (isJustGreeting) {
                        setTimeout(async () => {
                            await sendMessage(senderId,
                                'We can provide support in any language you wish. Feel free to speak in your language. 🌍');
                        }, 1500);
                    }
                } else {
                    // Returning user — greet by name in their language
                    if (msgCount === 1) {
                        const greetings = {
                            ro: `Bine ai revenit, ${known.name || 'prietene'}! 😊`,
                            en: `Welcome back, ${known.name || 'friend'}! 😊`,
                            de: `Willkommen zurück, ${known.name || 'Freund'}! 😊`,
                            fr: `Bon retour, ${known.name || 'ami'}! 😊`,
                            es: `Bienvenido de nuevo, ${known.name || 'amigo'}! 😊`,
                            it: `Bentornato, ${known.name || 'amico'}! 😊`
                        };
                        await sendMessage(senderId, greetings[known.lang] || greetings.en);
                    }
                    // Update language if changed
                    const newLang = detectLanguage(text);
                    if (newLang !== known.lang) {
                        await saveKnownSender(senderId, newLang, known.name, supabase);
                    }
                }

                // Subscription + site prompt ONLY at free limit (end of free period)
                if (msgCount === FREE_MESSAGES_LIMIT) {
                    setTimeout(async () => {
                        await sendMessage(senderId,
                            '⭐ Ai folosit ' + FREE_MESSAGES_LIMIT + ' mesaje gratuite!\n\n' +
                            'Continuă cu funcții premium pe kelionai.app:\n' +
                            '• 💬 Chat nelimitat cu AI\n' +
                            '• 🎭 Avatare 3D — Kelion & Kira\n' +
                            '• 🔊 Voce naturală\n' +
                            '• 🖼️ Generare imagini\n\n' +
                            '🌐 Abonează-te: https://kelionai.app/pricing');
                    }, 3000);
                }
            }
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Webhook handler error');
    }
});

// ═══ HEALTH ENDPOINT ═══
router.get('/health', (req, res) => {
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    const secret = process.env.FB_APP_SECRET;
    const verify = process.env.FB_VERIFY_TOKEN;

    const status = {
        status: token && secret ? 'configured' : 'misconfigured',
        hasPageToken: !!token,
        tokenPrefix: token ? token.substring(0, 10) + '...' : null,
        hasAppSecret: !!secret,
        hasVerifyToken: !!verify,
        graphApiVersion: 'v21.0',
        stats: getStats(),
        webhookUrl: (process.env.APP_URL || 'https://kelionai.app') + '/api/messenger/webhook'
    };

    res.json(status);
});

// ═══ STATS EXPORT ═══
function getStats() {
    return {
        messagesReceived: stats.messagesReceived,
        repliesSent: stats.repliesSent,
        activeSenders: stats.activeSenders.size
    };
}

module.exports = { router, getStats };
