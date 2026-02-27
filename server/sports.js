// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SPORTS BOT (Stub)
// ⚠️  INFORMATIV — nu garantează rezultate
//
// Planned functionality:
//   - Fetch live football/sports scores via SPORTS_API_KEY
//     (e.g., API-Football, SportMonks, TheSportsDB)
//   - Cover Romanian Liga 1, Champions League, and major leagues
//   - Provide match summaries and standings using KelionBrain
//   - Send scheduled sports updates via Messenger/notifications
//
// Routes:
//   GET /api/sports/status — bot status (public)
//   GET /api/sports/scores — live scores stub (admin only)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('./logger');

const router = express.Router();

/**
 * GET /api/sports/status
 * Returns the current status of the Sports Bot.
 * Public endpoint — no auth required.
 */
router.get('/status', (req, res) => {
    res.json({
        status: 'stub',
        disclaimer: 'INFORMATIV — nu garantează rezultate',
        configured: !!process.env.SPORTS_API_KEY,
        version: '0.1.0'
    });
});

/**
 * GET /api/sports/scores
 * Returns a stub live scores response.
 * Admin only — protected by adminAuth middleware applied in index.js.
 *
 * When SPORTS_API_KEY is set, this will be extended to fetch
 * live match data from API-Football or a similar provider.
 */
router.get('/scores', (req, res) => {
    logger.info({ component: 'Sports' }, 'Scores requested (stub)');
    res.json({
        disclaimer: 'INFORMATIV — nu garantează rezultate. Datele de mai jos sunt de test.',
        generatedAt: new Date().toISOString(),
        configured: !!process.env.SPORTS_API_KEY,
        matches: [
            {
                league: 'Liga 1 (România)',
                homeTeam: null,
                awayTeam: null,
                score: null,
                status: null,
                note: 'Date indisponibile — configurați SPORTS_API_KEY'
            }
        ],
        summary: 'Sports Bot este în faza de stub. Conectați un furnizor de date (API-Football, TheSportsDB) prin variabila SPORTS_API_KEY pentru a activa scorurile în timp real.'
    });
});

module.exports = router;
