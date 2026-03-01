// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — INSTAGRAM AUTO-POST
// Auto-publishes to Instagram Business via Graph API
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN; // Same token — Instagram uses FB token
const IG_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;

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
                access_token: PAGE_TOKEN
            })
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
                access_token: PAGE_TOKEN
            })
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
    caption += `🌐 Link în bio: kelionai.app\n\n`;
    caption += `${tags}${catTag}`;

    return caption;
}

// ═══ POST NEWS ═══
async function postNews(article, imageUrl) {
    const caption = formatCaption(article);

    // Default image if none provided
    const img = imageUrl || 'https://kelionai.app/img/kelionai-share.png';

    const containerId = await createMediaContainer(img, caption);
    if (!containerId) return null;

    // Wait for container to be ready (Instagram needs time to process)
    await new Promise(r => setTimeout(r, 3000));

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
        status: (PAGE_TOKEN && IG_ACCOUNT_ID) ? 'configured' : 'misconfigured',
        hasToken: !!PAGE_TOKEN,
        hasAccountId: !!IG_ACCOUNT_ID,
        graphApiVersion: 'v21.0'
    };
}

module.exports = { postNews, publishNewsBatch, createMediaContainer, publishMedia, formatCaption, getHealth };
