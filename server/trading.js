// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING BOT (Stub)
// ⚠️  INFORMATIV — nu execută tranzacții
//
// Planned functionality:
//   - Fetch real-time market data via TRADING_API_KEY (e.g., Alpha Vantage, Polygon.io)
//   - Analyse Romanian and European stock indices (BVB, DAX, etc.)
//   - Provide AI-powered market commentary using KelionBrain
//   - Send scheduled market summaries via Messenger/notifications
//
// Routes:
//   GET /api/trading/status   — bot status (public)
//   GET /api/trading/analysis — market analysis stub (admin only)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('./logger');

const router = express.Router();

/**
 * GET /api/trading/status
 * Returns the current status of the Trading Bot.
 * Public endpoint — no auth required.
 */
router.get('/status', (req, res) => {
    res.json({
        status: 'stub',
        disclaimer: 'INFORMATIV — nu execută tranzacții',
        configured: !!process.env.TRADING_API_KEY,
        version: '0.1.0'
    });
});

/**
 * GET /api/trading/analysis
 * Returns a stub market analysis response.
 * Admin only — protected by adminAuth middleware applied in index.js.
 *
 * When TRADING_API_KEY is set, this will be extended to fetch
 * live market data and generate AI-powered analysis.
 */
router.get('/analysis', (req, res) => {
    logger.info({ component: 'Trading' }, 'Market analysis requested (stub)');
    res.json({
        disclaimer: 'INFORMATIV — nu execută tranzacții. Datele de mai jos sunt de test.',
        generatedAt: new Date().toISOString(),
        configured: !!process.env.TRADING_API_KEY,
        markets: [
            { index: 'BET (BVB)', value: null, change: null, note: 'Date indisponibile — configurați TRADING_API_KEY' },
            { index: 'DAX',       value: null, change: null, note: 'Date indisponibile — configurați TRADING_API_KEY' },
            { index: 'S&P 500',   value: null, change: null, note: 'Date indisponibile — configurați TRADING_API_KEY' }
        ],
        summary: 'Trading Bot este în faza de stub. Conectați un furnizor de date (Alpha Vantage, Polygon.io) prin variabila TRADING_API_KEY pentru a activa analiza în timp real.'
    });
});

module.exports = router;
