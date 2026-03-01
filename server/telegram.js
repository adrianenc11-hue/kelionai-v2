// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TELEGRAM BOT
// Webhook: https://kelionai.app/api/telegram/webhook
// Commands: /start, /help, /stiri, /breaking, /despre
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ AUTO-REGISTER WEBHOOK ON STARTUP ═══
if (process.env.TELEGRAM_BOT_TOKEN) {
    const webhookUrl = (process.env.APP_URL || 'https://kelionai.app') + '/api/telegram/webhook';
    setTimeout(async () => {
        try {
            const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'] })
            });
            const data = await res.json();
            logger.info({ component: 'Telegram', success: data.ok, webhookUrl }, 'Webhook auto-registered');
        } catch (e) {
            logger.error({ component: 'Telegram', err: e.message }, 'Webhook auto-registration failed');
        }
    }, 5000);
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID; // optional — for broadcasting news

// ═══ STATS ═══
const stats = {
    messagesReceived: 0,
    repliesSent: 0,
    activeUsers: new Set()
};

// ═══ RATE LIMITING ═══
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const userRateLimits = new Map();

// ═══ USER MESSAGE COUNTER ═══
const userMessageCount = new Map();
const FREE_MESSAGES_LIMIT = 10;

// ═══ KNOWN USERS (persisted in Supabase) ═══
const knownUsers = new Map(); // { lang, name, firstSeen }

async function getKnownUser(userId, supabase) {
    if (knownUsers.has(userId)) return knownUsers.get(userId);
    if (supabase) {
        try {
            const { data } = await supabase.from('telegram_users').select('*').eq('user_id', String(userId)).single();
            if (data) {
                knownUsers.set(userId, { lang: data.language, name: data.name, firstSeen: data.first_seen });
                return knownUsers.get(userId);
            }
        } catch (e) { /* table may not exist yet */ }
    }
    return null;
}

async function saveKnownUser(userId, lang, name, supabase) {
    knownUsers.set(userId, { lang, name, firstSeen: new Date().toISOString() });
    if (supabase) {
        try {
            await supabase.from('telegram_users').upsert({
                user_id: String(userId), language: lang, name: name || null,
                first_seen: new Date().toISOString(), last_seen: new Date().toISOString()
            }, { onConflict: 'user_id' });
        } catch (e) { /* works in-memory */ }
    }
}

function isRateLimited(userId) {
    const now = Date.now();
    const entry = userRateLimits.get(userId);
    if (!entry || now >= entry.resetAt) {
        userRateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX) return true;
    entry.count++;
    return false;
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
    if (/\b(ben|sen|bu|için|ile|merhaba|teşekkür|evet|hayır)\b/.test(t)) return 'tr';
    return 'ro'; // default Romanian
}

// ═══ ADMIN KEYWORD BLACKLIST ═══
const ADMIN_KEYWORDS = /\b(admin|administrator|dashboard|panou\s*admin|setări\s*admin|settings\s*admin|admin\s*panel|admin\s*mode|deschide\s*admin)\b/i;

// ═══ SEND MESSAGE ═══
async function sendMessage(chatId, text, options = {}) {
    if (!BOT_TOKEN) {
        logger.warn({ component: 'Telegram' }, 'TELEGRAM_BOT_TOKEN not set');
        return;
    }
    try {
        const body = {
            chat_id: chatId,
            text: text.slice(0, 4096),
            parse_mode: options.parseMode || 'HTML',
            disable_web_page_preview: options.disablePreview || false
        };
        if (options.replyMarkup) body.reply_markup = JSON.stringify(options.replyMarkup);

        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            stats.repliesSent++;
            logger.info({ component: 'Telegram', chatId }, 'Message sent');
        } else {
            const err = await res.text();
            logger.error({ component: 'Telegram', chatId, status: res.status, err }, 'Failed to send');
        }
    } catch (e) {
        logger.error({ component: 'Telegram', err: e.message }, 'sendMessage error');
    }
}

// ═══ BROADCAST TO CHANNEL ═══
async function broadcastToChannel(text) {
    if (!CHANNEL_ID) return;
    await sendMessage(CHANNEL_ID, text, { disablePreview: false });
}

// ═══ COMMAND HANDLERS ═══
const COMMANDS = {
    '/start': async (chatId, userName) => {
        const msg = `🤖 <b>Bine ai venit la KelionAI!</b>\n\n` +
            `Sunt asistentul tău AI personal. Poți să-mi scrii orice întrebare!\n\n` +
            `📋 <b>Comenzi disponibile:</b>\n` +
            `/stiri — Ultimele știri din România\n` +
            `/breaking — Breaking news\n` +
            `/banc — Bancuri românești 😂\n` +
            `/despre — Despre KelionAI\n` +
            `/help — Ajutor\n\n` +
            `💬 Sau pur și simplu scrie-mi un mesaj și îți răspund cu AI!`;
        await sendMessage(chatId, msg, {
            replyMarkup: {
                inline_keyboard: [[
                    { text: '🌐 Deschide KelionAI', url: 'https://kelionai.app' },
                    { text: '📰 Știri', callback_data: 'cmd_stiri' },
                    { text: '😂 Banc', callback_data: 'cmd_banc' }
                ]]
            }
        });
    },

    '/banc': async (chatId) => {
        const jokes = [
            'De ce nu joacă peștii tenis? Pentru că le e frică de fileu! 🐟',
            'Bulă la școală: "Doamna învățătoare, pot fi pedepsit pentru ceva ce n-am făcut?" "Nu, Bulă." "Bine, nu mi-am făcut temele." 📚',
            'Ce face un crocodil când întâlnește o femeie frumoasă? O complimentează! 🐊',
            'Un optimist și un pesimist la bar. Pesimistul: "Mai rău de atât nu se poate!" Optimistul: "Ba da, se poate!" 🍺',
            'Cum se numește un magician care și-a pierdut magia? Ian. 🪄',
            'Bulă: "Tată, am luat 10 la matematică!" "Bravo! La ce?" "La un test de 100..." 📝',
            'De ce merg programatorii la plajă? Ca să facă debugging! 🏖️',
            'Ce-i spune un semafon altuia? Nu te uita la mine că mă schimb! 🚦',
            'Care e cea mai lungă propoziție din lume? Închisoare pe viață. ⚖️',
            'Ce face un vampir informatician? Dă byte! 🧛',
            'De ce poartă scafandrii casca pe spate? Pentru că dacă o purtau pe față nu mai vedeau! 🤿',
            'Bulă: "Mama, la școală mi se spune mincinosul!" "Tu la școală nu mergi, Bulă!" 🏫',
            'Cum se numește un câine fără picioare? Nu contează, oricum nu vine când îl chemi! 🐕',
            'Ce scrie pe mormântul unui electrician? A avut un scurtcircuit! ⚡',
            'De ce nu se ceartă munții? Pentru că au vârfuri comune! ⛰️'
        ];
        const joke = jokes[Math.floor(Math.random() * jokes.length)];
        await sendMessage(chatId, `😂 <b>Bancul zilei:</b>\n\n${joke}\n\n<i>Alt banc? Apasă /banc</i>`, {
            replyMarkup: {
                inline_keyboard: [[
                    { text: '😂 Alt banc', callback_data: 'cmd_banc' },
                    { text: '🌐 KelionAI', url: 'https://kelionai.app' }
                ]]
            }
        });
    },

    '/help': async (chatId) => {
        const msg = `❓ <b>Ajutor KelionAI Bot</b>\n\n` +
            `Pot să te ajut cu:\n` +
            `• 💬 Conversații AI — scrie orice întrebare\n` +
            `• 📰 Știri recente din România\n` +
            `• 🔴 Breaking news\n` +
            `• 📊 Informații diverse\n\n` +
            `<b>Comenzi:</b>\n` +
            `/stiri — Ultimele 5 știri\n` +
            `/breaking — Doar breaking news\n` +
            `/despre — Despre KelionAI\n\n` +
            `🌐 Versiunea completă: https://kelionai.app`;
        await sendMessage(chatId, msg);
    },

    '/despre': async (chatId) => {
        const msg = `🤖 <b>KelionAI</b> — Asistentul tău AI personal\n\n` +
            `✨ <b>Funcționalități:</b>\n` +
            `• Avatar 3D interactiv (Kelion & Kira)\n` +
            `• Conversații AI multilingve\n` +
            `• Voce naturală (text-to-speech)\n` +
            `• Căutare web inteligentă\n` +
            `• Generare imagini AI\n` +
            `• Știri în timp real\n` +
            `• Meteo, sport, trading\n\n` +
            `🌐 <b>Website:</b> https://kelionai.app\n` +
            `📧 <b>Contact:</b> support@kelionai.app`;
        await sendMessage(chatId, msg);
    },

    '/stiri': async (chatId, userName, app) => {
        try {
            const newsModule = require('./news');
            // Access article cache via internal function
            const articles = getNewsArticles(app);
            if (!articles || articles.length === 0) {
                await sendMessage(chatId, '📰 Nu sunt știri disponibile momentan. Încearcă mai târziu.');
                return;
            }
            let msg = '📰 <b>Ultimele știri din România:</b>\n\n';
            const top = articles.slice(0, 5);
            for (let i = 0; i < top.length; i++) {
                const a = top[i];
                const cat = a.category ? ` [${a.category}]` : '';
                msg += `${i + 1}. <b>${escapeHtml(a.title)}</b>${cat}\n`;
                if (a.source) msg += `   📌 ${escapeHtml(a.source)}`;
                if (a.url) msg += ` — <a href="${a.url}">citește</a>`;
                msg += '\n\n';
            }
            msg += `🔄 Actualizat automat la 05:00, 12:00, 18:00\n\n`;
            msg += `🌐 <i>Mai multe pe <a href="https://kelionai.app">kelionai.app</a> — AI cu avatar 3D!</i>`;
            await sendMessage(chatId, msg);
        } catch (e) {
            logger.error({ component: 'Telegram', err: e.message }, 'Stiri command error');
            await sendMessage(chatId, '❌ Eroare la încărcarea știrilor. Încearcă din nou.');
        }
    },

    '/breaking': async (chatId, userName, app) => {
        try {
            const articles = getNewsArticles(app);
            const breaking = (articles || []).filter(a => a.isBreaking || a.confirmedBy >= 2);
            if (breaking.length === 0) {
                await sendMessage(chatId, '🔴 Nu sunt breaking news acum. Folosește /stiri pentru ultimele știri.');
                return;
            }
            let msg = '🔴 <b>BREAKING NEWS:</b>\n\n';
            for (const a of breaking.slice(0, 5)) {
                msg += `⚡ <b>${escapeHtml(a.title)}</b>\n`;
                if (a.source) msg += `   Confirmat de ${a.confirmedBy} surse\n`;
                if (a.url) msg += `   🔗 <a href="${a.url}">citește</a>\n\n`;
            }
            await sendMessage(chatId, msg);
        } catch (e) {
            await sendMessage(chatId, '❌ Eroare. Încearcă din nou.');
        }
    }
};

// ═══ HELPERS ═══
function escapeHtml(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getNewsArticles(app) {
    try {
        if (app && app.locals && app.locals._getNewsArticles) {
            return app.locals._getNewsArticles();
        }
        return [];
    } catch (e) {
        return [];
    }
}

// ═══ FAQ FALLBACK ═══
function faqReply(text) {
    const t = (text || '').toLowerCase();
    if (/pre[tț]|cost|plan|abonam/.test(t)) {
        return '💰 <b>Planuri KelionAI:</b>\n\n• <b>Free</b> — gratuit, 10 chat-uri/zi\n• <b>Pro</b> — €9.99/lună, 100 chat-uri/zi\n• <b>Premium</b> — €19.99/lună, nelimitat\n\n🌐 Detalii: https://kelionai.app/pricing/';
    }
    if (/contact|support|ajutor|problema/.test(t)) {
        return '📧 Contactează-ne: support@kelionai.app\nSuntem disponibili luni-vineri.';
    }
    if (/ce e[șs]ti|cine e[șs]ti/.test(t)) {
        return '🤖 Sunt <b>KelionAI</b> — asistentul tău AI personal cu avatar 3D, suport vocal și multilingv!\n\n🌐 Încearcă: https://kelionai.app';
    }
    return null; // No FAQ match, use Brain AI
}

// ═══ WEBHOOK HANDLER ═══
router.post('/webhook', async (req, res) => {
    res.sendStatus(200); // Always respond 200 to Telegram

    try {
        const update = req.body;
        if (!update) return;

        // Handle callback queries (inline button presses)
        if (update.callback_query) {
            const cbData = update.callback_query.data;
            const chatId = update.callback_query.message?.chat?.id;
            if (chatId && cbData === 'cmd_stiri') {
                await COMMANDS['/stiri'](chatId, '', req.app);
            } else if (chatId && cbData === 'cmd_banc') {
                await COMMANDS['/banc'](chatId);
            }
            // Answer callback to remove loading state
            if (BOT_TOKEN) {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: update.callback_query.id })
                });
            }
            return;
        }

        const message = update.message;
        if (!message || !message.text) return;

        const chatId = message.chat.id;
        const userId = message.from?.id;
        const userName = message.from?.first_name || 'User';
        const text = message.text.trim();

        stats.messagesReceived++;
        stats.activeUsers.add(userId);

        // Rate limit
        if (isRateLimited(userId)) {
            await sendMessage(chatId, '⏳ Prea multe mesaje. Așteaptă un minut.');
            return;
        }

        // Admin keyword blacklist — total silence for non-owners
        if (ADMIN_KEYWORDS.test(text)) return;

        // Check for commands
        const cmd = text.split(' ')[0].toLowerCase().split('@')[0]; // Remove @botname
        if (COMMANDS[cmd]) {
            await COMMANDS[cmd](chatId, userName, req.app);
            return;
        }

        // Try FAQ first
        const faq = faqReply(text);
        if (faq) {
            await sendMessage(chatId, faq);
            return;
        }

        // ═══ USER ENGAGEMENT TRACKING ═══
        const msgCount = (userMessageCount.get(userId) || 0) + 1;
        userMessageCount.set(userId, msgCount);

        // Use Brain AI
        const detectedLangTg = detectLanguage(text);
        let reply;
        const brain = req.app.locals.brain;
        if (brain) {
            try {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Brain timeout')), 15000)
                );
                const result = await Promise.race([
                    brain.think(text, 'kelion', [], detectedLangTg || 'auto'),
                    timeout
                ]);
                reply = (result && result.enrichedMessage) || '🤔 Nu am putut procesa mesajul. Încearcă din nou.';
            } catch (e) {
                logger.warn({ component: 'Telegram', err: e.message }, 'Brain unavailable');
                reply = '🤖 Momentan sunt ocupat. Încearcă din nou sau vizitează https://kelionai.app';
            }
        } else {
            reply = '🤖 Sunt KelionAI! Pentru experiența completă vizitează https://kelionai.app';
        }

        await sendMessage(chatId, escapeHtml(reply), { parseMode: undefined });

        // ═══ FIRST-EVER USER? Check Supabase ═══
        const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
        const known = await getKnownUser(userId, supabase);

        if (!known) {
            const detectedLang = detectLanguage(text);
            await saveKnownUser(userId, detectedLang, userName, supabase);

            const isJustGreeting = /^(\/start|h(ello|i|ey)|salut|bun[aă]|ciao|hola|bonjour|hallo|ola)[!?.,\s]*$/i.test(text.trim());
            if (isJustGreeting) {
                setTimeout(async () => {
                    await sendMessage(chatId,
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
                await sendMessage(chatId, greetings[known.lang] || greetings.en);
            }
            const newLang = detectLanguage(text);
            if (newLang !== known.lang) {
                await saveKnownUser(userId, newLang, known.name, supabase);
            }
        }

        // ═══ FREE LIMIT — promo ONLY at end of free period ═══
        if (msgCount === FREE_MESSAGES_LIMIT) {
            setTimeout(async () => {
                await sendMessage(chatId,
                    `⭐ <b>Ai folosit ${FREE_MESSAGES_LIMIT} mesaje gratuite azi!</b>\n\n` +
                    `Continuă cu funcții premium pe kelionai.app:\n` +
                    `• 💬 Chat nelimitat cu AI\n` +
                    `• 🎭 Avatare 3D — Kelion & Kira\n` +
                    `• 🔊 Voce naturală\n` +
                    `• 🖼️ Generare imagini\n\n` +
                    `🌐 Abonează-te: https://kelionai.app/pricing`, {
                    replyMarkup: {
                        inline_keyboard: [[
                            { text: '💎 Vezi planurile', url: 'https://kelionai.app/pricing' }
                        ]]
                    }
                });
            }, 3000);
        }
    } catch (e) {
        logger.error({ component: 'Telegram', err: e.message }, 'Webhook handler error');
    }
});

// ═══ WEBHOOK SETUP ═══
router.get('/setup', async (req, res) => {
    if (!BOT_TOKEN) {
        return res.json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    }
    const webhookUrl = (process.env.APP_URL || 'https://kelionai.app') + '/api/telegram/webhook';
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                allowed_updates: ['message', 'callback_query']
            })
        });
        const data = await response.json();
        res.json({ success: data.ok, webhookUrl, result: data });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// ═══ HEALTH ═══
router.get('/health', (req, res) => {
    res.json({
        status: BOT_TOKEN ? 'configured' : 'misconfigured',
        hasToken: !!BOT_TOKEN,
        hasChannelId: !!CHANNEL_ID,
        stats: {
            messagesReceived: stats.messagesReceived,
            repliesSent: stats.repliesSent,
            activeUsers: stats.activeUsers.size
        },
        webhookUrl: (process.env.APP_URL || 'https://kelionai.app') + '/api/telegram/webhook'
    });
});

// ═══ BROADCAST NEWS TO CHANNEL ═══
async function broadcastNews(articles) {
    if (!CHANNEL_ID || !articles || articles.length === 0) return;
    let msg = '📰 <b>Știri din România</b>\n\n';
    for (const a of articles.slice(0, 5)) {
        const icon = a.isBreaking ? '🔴' : '📌';
        msg += `${icon} <b>${escapeHtml(a.title)}</b>\n`;
        if (a.url) msg += `🔗 <a href="${a.url}">citește</a>\n`;
        msg += '\n';
    }
    msg += `\n🤖 <i>KelionAI — kelionai.app</i>`;
    await broadcastToChannel(msg);
}

module.exports = { router, broadcastNews };
