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
                if (!text) continue;

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
                            setTimeout(() => reject(new Error('Brain timeout')), 10000)
                        );
                        const result = await Promise.race([
                            brain.think(text, 'kelion', [], 'ro'),
                            timeout
                        ]);
                        reply = (result && result.enrichedMessage) || faqReply(text);
                    } catch (e) {
                        logger.warn({ component: 'Messenger', err: e.message }, 'Brain unavailable, using FAQ');
                        reply = faqReply(text);
                    }
                } else {
                    reply = faqReply(text);
                }

                await sendMessage(senderId, reply);
                stats.repliesSent++;
                logger.info({ component: 'Messenger', senderId }, 'Reply sent');
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
