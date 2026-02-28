// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TELEGRAM BOT
// Webhook: https://kelionai.app/api/telegram/webhook
// Commands: /start, /help, /stiri, /breaking, /despre
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('./logger');

const router = express.Router();

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
            `/despre — Despre KelionAI\n` +
            `/help — Ajutor\n\n` +
            `💬 Sau pur și simplu scrie-mi un mesaj și îți răspund cu AI!`;
        await sendMessage(chatId, msg, {
            replyMarkup: {
                inline_keyboard: [[
                    { text: '🌐 Deschide KelionAI', url: 'https://kelionai.app' },
                    { text: '📰 Știri', callback_data: 'cmd_stiri' }
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
            msg += `🔄 Actualizat automat la 05:00, 12:00, 18:00`;
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

        // Use Brain AI
        let reply;
        const brain = req.app.locals.brain;
        if (brain) {
            try {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Brain timeout')), 15000)
                );
                const result = await Promise.race([
                    brain.think(text, 'kelion', [], 'ro'),
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

        await sendMessage(chatId, escapeHtml(reply), { parseMode: undefined }); // Plain text for AI responses
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
