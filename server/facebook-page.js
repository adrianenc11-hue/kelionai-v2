// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — FACEBOOK PAGE AUTO-POST
// Auto-publică știri pe pagina Facebook
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID;

// ═══ POST TO FACEBOOK PAGE ═══
async function postToPage(message, link) {
    if (!PAGE_TOKEN || !PAGE_ID) {
        logger.warn({ component: 'FacebookPage' }, 'FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID not set');
        return null;
    }
    try {
        const body = { message, access_token: PAGE_TOKEN };
        if (link) body.link = link;

        const res = await fetch(`https://graph.facebook.com/v21.0/${PAGE_ID}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.id) {
            logger.info({ component: 'FacebookPage', postId: data.id }, 'Posted to Facebook Page');
            return data.id;
        } else {
            logger.error({ component: 'FacebookPage', error: data.error }, 'Failed to post');
            return null;
        }
    } catch (e) {
        logger.error({ component: 'FacebookPage', err: e.message }, 'Post error');
        return null;
    }
}

// ═══ FORMAT NEWS FOR FACEBOOK ═══
function formatNewsPost(article) {
    const emoji = article.isBreaking ? '🔴 BREAKING' : '📰';
    const category = article.category ? ` #${article.category}` : '';

    let post = `${emoji} ${article.title}\n\n`;
    if (article.summary) post += `${article.summary}\n\n`;
    if (article.source) post += `📌 Sursă: ${article.source}\n`;
    post += `\n🤖 KelionAI — Asistentul tău AI personal\n`;
    post += `🌐 kelionai.app${category}`;

    return { message: post, link: article.url || null };
}

// ═══ PUBLISH NEWS BATCH ═══
async function publishNewsBatch(articles, maxPosts = 3) {
    if (!PAGE_TOKEN || !PAGE_ID) return [];

    const posted = [];
    const toPost = (articles || []).slice(0, maxPosts);

    for (const article of toPost) {
        const { message, link } = formatNewsPost(article);
        const postId = await postToPage(message, link);
        if (postId) posted.push({ title: article.title, postId });
        // Wait 5 seconds between posts to avoid rate limits
        if (toPost.indexOf(article) < toPost.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    logger.info({ component: 'FacebookPage', count: posted.length }, 'News batch posted');
    return posted;
}

// ═══ POST CUSTOM MESSAGE ═══
async function postCustom(text) {
    return await postToPage(text);
}

// ═══ HEALTH ═══
function getHealth() {
    return {
        status: (PAGE_TOKEN && PAGE_ID) ? 'configured' : 'misconfigured',
        hasPageToken: !!PAGE_TOKEN,
        hasPageId: !!PAGE_ID,
        graphApiVersion: 'v21.0'
    };
}

module.exports = { postToPage, publishNewsBatch, postCustom, getHealth, formatNewsPost };
