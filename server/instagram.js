// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — INSTAGRAM AUTO-POST + DM CHAT BOT
// Auto-publishes to Instagram Business via Graph API
// + Handles DM messages via Instagram Messaging API
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN; // Same token — Instagram uses FB token
const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || null; // SECURITY: no hardcoded fallback — set FB_VERIFY_TOKEN in env

let brain = null;
let supabaseAdmin = null;

/**
 * setBrain
 * @param {*} b
 * @returns {*}
 */
function setBrain(b) {
  brain = b;
}
/**
 * setSupabase
 * @param {*} s
 * @returns {*}
 */
function setSupabase(s) {
  supabaseAdmin = s;
}

const router = express.Router();

// Rate limiting for public API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
});

// Apply rate limiting to public-facing routes
router.use('/webhook', apiLimiter);

// ═══════════════════════════════════════════════════════════════
// INSTAGRAM DM CHAT BOT — Webhook
// ═══════════════════════════════════════════════════════════════

// ── Webhook Verify (GET) ──
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (!VERIFY_TOKEN) {
    logger.warn({ component: 'Instagram' }, 'Webhook verify attempt but FB_VERIFY_TOKEN not set');
    return res.sendStatus(403);
  }
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    logger.info({ component: 'Instagram' }, 'Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Webhook Handler (POST) ──
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Respond immediately

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || body.object !== 'instagram') return;

    for (const entry of body.entry || []) {
      for (const msg of entry.messaging || []) {
        if (msg.message && !msg.message.is_echo) {
          await handleIncomingDM(msg);
        }
      }
    }
  } catch (e) {
    logger.error({ component: 'Instagram', err: e.message }, 'Webhook handler error');
  }
});

// ── Handle Incoming DM ──
async function handleIncomingDM(msg) {
  const senderId = msg.sender?.id;
  const text = msg.message?.text;
  if (!senderId || !text) return;

  logger.info({ component: 'Instagram', senderId, text: text.substring(0, 50) }, 'DM received');

  // Load/save user preferences from Supabase
  let userLang = 'ro';
  if (supabaseAdmin) {
    try {
      const { data } = await supabaseAdmin
        .from('user_preferences')
        .select('language')
        .eq('platform_id', `ig_${senderId}`)
        .single();
      if (data?.language) userLang = data.language;
    } catch (e) {
      logger.warn({ component: 'Instagram', err: e.message }, 'first time user');
    }
  }

  // Process with Brain
  let reply = 'Salut! Sunt KelionAI. Momentan nu am brain-ul conectat. 🤖';
  if (brain) {
    try {
      const result = await brain.think(text, `ig_${senderId}`, {
        platform: 'instagram',
        language: userLang,
        conversationId: `ig_${senderId}`,
      });
      reply = result.response || result.text || reply;
    } catch (e) {
      logger.error({ component: 'Instagram', err: e.message }, 'Brain.think error');
      reply = 'Scuze, am o problemă tehnică. Încearcă din nou! 🔧';
    }
  }

  // Send reply
  await sendDM(senderId, reply);

  // ═══ BRAIN INTEGRATION — save DM memory ═══
  if (brain) {
    brain
      .saveMemory(
        null,
        'text',
        'Instagram DM ' + senderId + ': ' + text.substring(0, 200) + ' | Reply: ' + reply.substring(0, 300),
        {
          platform: 'instagram',
          type: 'dm',
        }
      )
      .catch((err) => {
        console.error(err);
      });
  }

  // Log to Supabase
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from('admin_logs').insert({
        action: 'instagram_dm',
        details: `DM from ig_${senderId}: ${text.substring(0, 100)}`,
        result: { reply: reply.substring(0, 200) },
        source: 'instagram_bot',
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn({ component: 'Instagram', err: e.message }, 'ok');
    }
  }
}

// ── Send DM via Graph API ──
async function sendDM(recipientId, text) {
  if (!PAGE_TOKEN) return;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: text.substring(0, 1000) }, // Instagram limit
        access_token: PAGE_TOKEN,
      }),
    });
    const data = await res.json();
    if (data.error) {
      logger.error({ component: 'Instagram', error: data.error }, 'Send DM failed');
    }
  } catch (e) {
    logger.error({ component: 'Instagram', err: e.message }, 'sendDM error');
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-POST FUNCTIONS (existing)
// ═══════════════════════════════════════════════════════════════

// ═══ CREATE MEDIA CONTAINER ═══
async function createMediaContainer(imageUrl, caption) {
  if (!PAGE_TOKEN || !IG_ACCOUNT_ID) {
    logger.warn({ component: 'Instagram' }, 'Missing INSTAGRAM_ACCOUNT_ID or FB_PAGE_ACCESS_TOKEN');
    return null;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption.slice(0, 2200), // Instagram limit
        access_token: PAGE_TOKEN,
      }),
    });
    const data = await res.json();
    if (data.id) {
      logger.info({ component: 'Instagram', containerId: data.id }, 'Media container created');
      return data.id;
    }
    logger.error({ component: 'Instagram', error: data.error }, 'Container creation failed');
    return null;
  } catch (e) {
    logger.error({ component: 'Instagram', err: e.message }, 'createMediaContainer error');
    return null;
  }
}

// ═══ PUBLISH MEDIA ═══
async function publishMedia(containerId) {
  if (!PAGE_TOKEN || !IG_ACCOUNT_ID || !containerId) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${IG_ACCOUNT_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: PAGE_TOKEN,
      }),
    });
    const data = await res.json();
    if (data.id) {
      logger.info({ component: 'Instagram', mediaId: data.id }, 'Published to Instagram');
      return data.id;
    }
    logger.error({ component: 'Instagram', error: data.error }, 'Publish failed');
    return null;
  } catch (e) {
    logger.error({ component: 'Instagram', err: e.message }, 'publishMedia error');
    return null;
  }
}

// ═══ FORMAT CAPTION ═══
function formatCaption(article) {
  const emoji = article.isBreaking ? '🔴 BREAKING' : '📰';
  const tags = '#kelionai #romania #stiri #news #ai';
  const catTag = article.category ? ` #${article.category}` : '';

  let caption = `${emoji} ${article.title}\n\n`;
  if (article.summary) caption += `${article.summary}\n\n`;
  if (article.source) caption += `📌 Sursă: ${article.source}\n`;
  caption += `\n🤖 KelionAI — Asistentul tău AI personal\n`;
  caption += `🌐 Link în bio: ${process.env.APP_URL}\n\n`;
  caption += `${tags}${catTag}`;

  return caption;
}

// ═══ POST NEWS ═══
async function postNews(article, imageUrl) {
  const caption = formatCaption(article);

  // Default image if none provided
  const img = imageUrl || process.env.APP_URL + '/img/kelionai-share.png';

  const containerId = await createMediaContainer(img, caption);
  if (!containerId) return null;

  // Wait for container to be ready (Instagram needs time to process)
  await new Promise((r) => setTimeout(r, 3000));

  return await publishMedia(containerId);
}

// ═══ PUBLISH NEWS BATCH ═══
async function publishNewsBatch(articles, maxPosts = 1) {
  const results = [];
  const toPost = articles.slice(0, maxPosts);
  for (const article of toPost) {
    const imageUrl = article.imageUrl || article.image_url;
    const result = await postNews(article, imageUrl);
    results.push({ title: article.title, mediaId: result });
  }
  return results;
}

// ═══ HEALTH ═══
function getHealth() {
  return {
    status: PAGE_TOKEN && IG_ACCOUNT_ID ? 'configured' : 'misconfigured',
    hasToken: !!PAGE_TOKEN,
    hasAccountId: !!IG_ACCOUNT_ID,
    graphApiVersion: 'v21.0',
    chatBot: true, // NEW: chat bot enabled
    dmWebhook: '/api/instagram/webhook',
  };
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  router,
  setBrain,
  setSupabase,
  postNews,
  publishNewsBatch,
  createMediaContainer,
  publishMedia,
  formatCaption,
  getHealth,
  sendDM,
};
