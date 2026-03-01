// KelionAI v2.3 — MESSENGER BOT (Facebook Messenger Full AI Brain)
// Webhook: https://kelionai.app/api/messenger/webhook
'use strict';

const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// STATS
const stats = { messagesReceived: 0, repliesSent: 0, activeSenders: new Set() };

// CHARACTER SELECTION (Kelion or Kira)
const chatCharacter = new Map(); // senderId -> 'kelion' | 'kira'

// CONVERSATION CONTEXT (group awareness)
const MAX_CONTEXT_MESSAGES = 50;
const conversationHistory = new Map(); // senderId -> [{ from, text, timestamp }]

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

// AUTO-DETECT LANGUAGE
function detectLanguage(text) {
    const t = (text || '').toLowerCase();
    if (/\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)) return 'en';
    if (/\b(der|die|das|ist|und|ich|ein|wie|was|können)\b/.test(t)) return 'de';
    if (/\b(le|la|les|de|est|et|un|une|je|que|comment|bonjour)\b/.test(t)) return 'fr';
    if (/\b(el|la|los|es|un|una|que|como|por|hola)\b/.test(t)) return 'es';
    if (/\b(il|lo|la|di|che|un|una|come|sono|ciao)\b/.test(t)) return 'it';
    return 'ro';
}

// RATE LIMITING
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const senderRateLimits = new Map();

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

// SEND FACEBOOK MESSAGE
async function sendMessage(recipientId, text) {
    const token = process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) {
        logger.warn({ component: 'Messenger' }, 'FB_PAGE_ACCESS_TOKEN not set');
        return;
    }
    const res = await fetch('https://graph.facebook.com/v21.0/me/messages?access_token=' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: text.slice(0, 2000) }
        })
    });
    if (!res.ok) {
        const body = await res.text();
        logger.error({ component: 'Messenger', status: res.status, body }, 'Failed to send message');
    }
}

// WEBHOOK VERIFICATION (GET)
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// INCOMING MESSAGE HANDLER (POST)
router.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const body = req.body;
        if (body.object !== 'page') return;

        for (const entry of (body.entry || [])) {
            for (const event of (entry.messaging || [])) {
                const senderId = event.sender && event.sender.id;
                const message = event.message;
                if (!senderId || !message || message.is_echo) continue;

                const userText = message.text;
                if (!userText) continue;

                stats.messagesReceived++;
                stats.activeSenders.add(senderId);

                if (isRateLimited(senderId)) continue;

                if (/^(kelion|kira)$/i.test(userText.trim())) {
                    const char = userText.trim().toLowerCase();
                    chatCharacter.set(senderId, char);
                    const name = char === 'kelion' ? 'Kelion' : 'Kira';
                    await sendMessage(senderId, (char === 'kelion' ? '🤖' : '👩‍💻') + ' ' + name + ' este acum asistentul tău. Cu ce te pot ajuta?');
                    continue;
                }

                addToHistory(senderId, 'User', userText);

                const character = chatCharacter.get(senderId) || 'kelion';
                let reply;
                const brain = req.app.locals.brain;
                const context = getContextSummary(senderId);
                const prompt = context ? '[Context:\n' + context + ']\nUser: ' + userText : userText;

                if (brain) {
                    try {
                        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Brain timeout')), 12000));
                        const result = await Promise.race([
                            brain.think(prompt, character, [], 'auto'),
                            timeout
                        ]);
                        reply = (result && result.enrichedMessage) || 'Nu am putut procesa mesajul.';
                    } catch (e) {
                        reply = 'Sunt ocupat acum. Încearcă din nou.';
                    }
                } else {
                    reply = 'Sunt KelionAI! Vizitează https://kelionai.app';
                }

                await sendMessage(senderId, reply);
                addToHistory(senderId, 'AI', reply);
                stats.repliesSent++;
            }
        }
    } catch (e) {
        logger.error({ component: 'Messenger', err: e.message }, 'Webhook handler error');
    }
});

// HEALTH ENDPOINT
router.get('/health', (req, res) => {
    res.json({
        status: process.env.FB_PAGE_ACCESS_TOKEN ? 'configured' : 'misconfigured',
        hasPageToken: !!process.env.FB_PAGE_ACCESS_TOKEN,
        hasVerifyToken: !!process.env.FB_VERIFY_TOKEN,
        hasAppSecret: !!process.env.FB_APP_SECRET,
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
