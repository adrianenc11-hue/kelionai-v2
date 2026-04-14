'use strict';
const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { createReferralCode, findReferralCode, useReferralCode } = require('../db');

const router = Router();
router.use(requireAuth);

// POST /api/referral/generate — generate a new referral code for the logged-in user
router.post('/generate', csrfProtection, async (req, res) => {
  try {
    const ref = await createReferralCode(req.user.id);
    res.json({ code: ref.code, expires_at: ref.expires_at });
  } catch (err) {
    console.error('[referral/generate]', err);
    res.status(500).json({ error: 'Could not generate referral code' });
  }
});

// GET /api/referral/validate/:code — check if a code is valid
router.get('/validate/:code', async (req, res) => {
  try {
    const ref = await findReferralCode(req.params.code.toUpperCase());
    if (!ref)         return res.status(404).json({ valid: false, error: 'Code not found' });
    if (ref.used)     return res.status(400).json({ valid: false, error: 'Code already used' });
    if (new Date(ref.expires_at) < new Date()) return res.status(400).json({ valid: false, error: 'Code expired' });
    res.json({ valid: true, expires_at: ref.expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/referral/use — apply a referral code (called after payment)
router.post('/use', csrfProtection, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required' });
  try {
    await useReferralCode(code.toUpperCase(), req.user.id);
    res.json({ success: true, message: 'Referral code applied. Referrer gets +5 days.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
