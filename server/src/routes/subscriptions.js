'use strict';

const { Router } = require('express');
const { PLANS } = require('../config/plans');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/subscription/plans
// ---------------------------------------------------------------------------
// Public endpoint – returns all available plans.
// ---------------------------------------------------------------------------
router.get('/plans', (_req, res) => {
  const plans = Object.values(PLANS).map((p) => ({
    ...p,
    dailyLimit: p.dailyLimit === Infinity ? null : p.dailyLimit,
  }));
  res.json({ plans });
});

module.exports = router;
