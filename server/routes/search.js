// ═══════════════════════════════════════════════════════════════
// KelionAI — Search Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { validate, searchSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');

const router = express.Router();

const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: { error: 'Too many searches. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });

// POST /api/search — Perplexity Sonar → Tavily → Serper → DuckDuckGo
router.post('/', searchLimiter, validate(searchSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query is required' });

        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'search', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'Search limit reached. Upgrade to Pro for more searches.', plan: usage.plan, limit: usage.limit, upgrade: true });

        // 1. Perplexity Sonar
        if (process.env.PERPLEXITY_API_KEY) {
            try {
                const r = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.PERPLEXITY_API_KEY },
                    body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }], max_tokens: 500 })
                });
                if (r.ok) {
                    const d = await r.json();
                    const answer = d.choices?.[0]?.message?.content || '';
                    const citations = d.citations || [];
                    const results = citations.slice(0, 5).map(url => ({ title: url, content: '', url }));
                    logger.info({ component: 'Search', engine: 'Perplexity', chars: answer.length }, 'Perplexity Sonar — ' + answer.length + ' chars');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
                    return res.json({ results, answer, engine: 'Perplexity' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Perplexity', err: e.message }, 'Perplexity'); }
        }

        // 2. Tavily
        if (process.env.TAVILY_API_KEY) {
            try {
                const tr = await fetch('https://api.tavily.com/search', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'basic', max_results: 5, include_answer: true })
                });
                if (tr.ok) {
                    const td = await tr.json();
                    logger.info({ component: 'Search', engine: 'Tavily', results: (td.results || []).length }, 'Tavily — ' + (td.results || []).length + ' results');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
                    return res.json({ results: (td.results || []).map(x => ({ title: x.title, content: x.content, url: x.url })), answer: td.answer || '', engine: 'Tavily' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Tavily', err: e.message }, 'Tavily'); }
        }

        // 3. Serper
        if (process.env.SERPER_API_KEY) {
            try {
                const sr = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SERPER_API_KEY },
                    body: JSON.stringify({ q: query, num: 5 })
                });
                if (sr.ok) {
                    const sd = await sr.json();
                    const answer = sd.answerBox?.answer || sd.answerBox?.snippet || sd.knowledgeGraph?.description || '';
                    const results = (sd.organic || []).slice(0, 5).map(x => ({ title: x.title, content: x.snippet, url: x.link }));
                    logger.info({ component: 'Search', engine: 'Serper', results: results.length }, 'Serper — ' + results.length + ' results');
                    incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
                    return res.json({ results, answer, engine: 'Serper' });
                }
            } catch (e) { logger.warn({ component: 'Search', engine: 'Serper', err: e.message }, 'Serper'); }
        }

        // 4. DuckDuckGo (free fallback)
        const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1');
        const d = await r.json();
        const results = [];
        if (d.Abstract) results.push({ title: d.Heading || query, content: d.Abstract, url: d.AbstractURL });
        if (d.RelatedTopics) for (const t of d.RelatedTopics.slice(0, 5)) if (t.Text) results.push({ title: t.Text.substring(0, 80), content: t.Text, url: t.FirstURL });
        incrementUsage(user?.id, 'search', supabaseAdmin).catch(() => { });
        res.json({ results, answer: d.Abstract || '', engine: 'DuckDuckGo' });
    } catch (e) { res.status(500).json({ error: 'Search error' }); }
});

module.exports = router;
