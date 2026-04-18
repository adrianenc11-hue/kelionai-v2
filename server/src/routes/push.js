'use strict';

// Stage 5 — M23: Web Push endpoints.
// Signed-in users only. Subscribes a browser to receive proactive pings.

const { Router } = require('express');
const webpush = require('web-push');
const {
  upsertPushSubscription,
  listPushSubscriptionsForUser,
  deletePushSubscription,
} = require('../db');

const router = Router();

// ─── VAPID config ──────────────────────────────────────────────
// Dev-only fallback keys generated for the monorepo. Production MUST set
// VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (and VAPID_SUBJECT) on the deploy env.
const DEV_VAPID_PUBLIC  = 'BIqS6tm83i1SaCZDqN7G9O4U4aJhw3_ZT5KgGIuWYZEytSZsLpZbfMrt93P1Hi9L4kCsWGJ3pmW4N-zQGcZlfw8';
const DEV_VAPID_PRIVATE = 'nq3rUWh1anHPti8-ASd-pJgvFc3INByXfedyH6O3ht0';

const publicKey  = process.env.VAPID_PUBLIC_KEY  || DEV_VAPID_PUBLIC;
const privateKey = process.env.VAPID_PRIVATE_KEY || DEV_VAPID_PRIVATE;
const subject    = process.env.VAPID_SUBJECT     || 'mailto:adrian@kelionai.app';

try {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} catch (err) {
  console.warn('[push] VAPID setup failed — proactive pings disabled:', err.message);
}

function getWebPush() { return webpush; }
function getVapidPublicKey() { return publicKey; }

// GET /api/push/public-key — returns the VAPID public key so the browser
// can register a PushSubscription bound to this server.
router.get('/public-key', (_req, res) => {
  res.json({ publicKey });
});

// POST /api/push/subscribe — user enables pings on this device.
// Expects body: { subscription: { endpoint, keys: { p256dh, auth } } }
router.post('/subscribe', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Sign in first.' });
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'Missing subscription fields.' });
    }
    const id = await upsertPushSubscription({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[push] subscribe error', err.message);
    res.status(500).json({ error: 'Failed to register push subscription.' });
  }
});

// POST /api/push/unsubscribe — user disables pings on this device.
router.post('/unsubscribe', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Sign in first.' });
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint.' });
    const ok = await deletePushSubscription(userId, endpoint);
    res.json({ ok });
  } catch (err) {
    console.error('[push] unsubscribe error', err.message);
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
});

// GET /api/push/subscriptions — list this user's active subscriptions.
router.get('/subscriptions', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Sign in first.' });
    const items = await listPushSubscriptionsForUser(userId);
    res.json({ items: items.map((i) => ({
      id: i.id,
      endpoint_preview: i.endpoint.slice(0, 48) + '…',
      enabled: !!i.enabled,
      created_at: i.created_at,
      last_sent_at: i.last_sent_at,
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list subscriptions.' });
  }
});

// POST /api/push/test — immediate push of a test payload to ALL this user's
// subscriptions. Used by the menu "Send test ping" button and by the scheduler
// during dev.
router.post('/test', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Sign in first.' });
    const subs = await listPushSubscriptionsForUser(userId);
    const payload = JSON.stringify({
      title: 'Kelion',
      body: req.body?.body || "Just testing — Kelion can reach you.",
      url: req.body?.url || '/',
    });
    let delivered = 0;
    for (const s of subs) {
      if (!s.enabled) continue;
      try {
        await webpush.sendNotification({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth_secret },
        }, payload);
        delivered += 1;
      } catch (err) {
        console.warn('[push] test send failed', s.endpoint.slice(0, 40), err.statusCode || err.message);
      }
    }
    res.json({ ok: true, delivered, total: subs.length });
  } catch (err) {
    console.error('[push] test error', err.message);
    res.status(500).json({ error: 'Failed to send test push.' });
  }
});

module.exports = router;
module.exports.getWebPush = getWebPush;
module.exports.getVapidPublicKey = getVapidPublicKey;
