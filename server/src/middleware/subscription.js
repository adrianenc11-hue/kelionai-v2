'use strict';

const { findById, getUsageToday, incrementUsage } = require('../db');

/**
 * Subscription tiers with daily limits.
 * null = unlimited
 */
const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: null,
    dailyLimit: 10,
    features: ['Basic voice chat', 'Standard avatars'],
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    price: 9.99,
    interval: 'month',
    dailyLimit: 60,
    features: ['Extended voice chat', 'All avatars', 'Priority support'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 29.99,
    interval: 'month',
    dailyLimit: 180,
    features: ['Unlimited voice chat', 'Custom avatars', 'Advanced features', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 99.99,
    interval: 'month',
    dailyLimit: null,
    features: ['Everything in Premium', 'Custom integrations', 'Dedicated support'],
  },
};

function getAdminEmails() {
  const defaultAdmins = ['adrianenc11@gmail.com'];
  const extraAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set([...defaultAdmins, ...extraAdmins])];
}

function isAdminEmail(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();

  return Boolean(normalizedEmail) && getAdminEmails().includes(normalizedEmail);
}

/**
 * Middleware pentru verificarea subscription-ului.
 * Verifică dacă utilizatorul are quota disponibilă.
 */
function checkSubscription(requiredPlan = 'free') {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;

      // Admin identity check — ran BEFORE the DB lookup so that admins with
      // stale JWTs (cookie minted against a previous DB snapshot that has
      // since been reset / migrated) don't hit a 404 "User not found" wall.
      // Adrian's requirement is "admin are tot nelimitat" — identity-based,
      // not row-based. We trust the JWT email + allow-list for admin gating.
      const jwtRoleIsAdmin = req.user.role === 'admin';
      const jwtEmailIsAdmin = isAdminEmail(req.user.email);

      const user = await findById(userId);

      // Admin bypass via JWT identity — works even if the DB row was wiped.
      if (!user && (jwtRoleIsAdmin || jwtEmailIsAdmin)) {
        req.subscription = {
          tier: 'admin',
          plan: { id: 'admin', name: 'Admin', dailyLimit: null },
          usageToday: 0,
          dailyLimit: null,
          isAdmin: true,
        };
        return next();
      }

      if (!user) {
        // Stale JWT — the cookie references a user row that no longer exists
        // (DB reset, user deleted, orphan from an older schema). For non-admin
        // identities we previously returned 404, which the frontend rendered
        // as a bare "HTTP 404" bubble and left the user with no way to
        // recover short of manually clearing cookies. Instead: clear the
        // cookie server-side and return a clean 401 so the client falls back
        // to the trial / sign-in flow on its own.
        try { res.clearCookie('kelion.token', { path: '/' }); } catch (_) { /* best-effort */ }
        return res.status(401).json({ error: 'Session expired, please sign in again' });
      }

      // Admin bypass via DB row — when the user row exists, the DB is
      // authoritative. We intentionally do NOT OR-in the JWT role/email
      // claims here: JWTs are valid for 7 days (see config.js), so reusing
      // stale JWT claims would make admin revocation ineffective for up to
      // a week. The JWT-only path above is limited to the "row missing"
      // case it was designed for (stale cookie against a reset DB).
      const dbRoleIsAdmin = user.role === 'admin';
      const dbEmailIsAdmin = isAdminEmail(user.email);
      if (dbRoleIsAdmin || dbEmailIsAdmin) {
        req.subscription = {
          tier: 'admin',
          plan: { id: 'admin', name: 'Admin', dailyLimit: null },
          usageToday: 0,
          dailyLimit: null,
          isAdmin: true,
        };
        return next();
      }

      const tier = user.subscription_tier || 'free';
      const plan = SUBSCRIPTION_PLANS[tier];
      const required = SUBSCRIPTION_PLANS[requiredPlan];

      if (!plan || !required) {
        return res.status(500).json({ error: 'Invalid subscription plan' });
      }

      const tierOrder = ['free', 'basic', 'premium', 'enterprise'];
      const userTierIndex = tierOrder.indexOf(tier);
      const requiredTierIndex = tierOrder.indexOf(requiredPlan);

      if (userTierIndex < requiredTierIndex) {
        return res.status(403).json({
          error: 'Subscription upgrade required',
          currentPlan: tier,
          requiredPlan: requiredPlan,
        });
      }

      const usageToday = await getUsageToday(userId);

      if (plan.dailyLimit !== null && usageToday >= plan.dailyLimit) {
        return res.status(429).json({
          error: 'Daily limit exceeded',
          dailyLimit: plan.dailyLimit,
          usageToday: usageToday,
          upgradeTo: tierOrder[userTierIndex + 1] || 'enterprise',
        });
      }

      req.subscription = {
        tier,
        plan,
        usageToday,
        dailyLimit: plan.dailyLimit,
      };

      next();
    } catch (err) {
      console.error('[checkSubscription] Error:', err.message);
      res.status(500).json({ error: 'Subscription check failed' });
    }
  };
}

/**
 * Get available subscription plans.
 */
function getPlans() {
  return Object.values(SUBSCRIPTION_PLANS);
}

module.exports = {
  checkSubscription,
  getPlans,
  SUBSCRIPTION_PLANS,
};
