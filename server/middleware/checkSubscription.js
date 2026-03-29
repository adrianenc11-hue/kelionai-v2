// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — CHECK SUBSCRIPTION MIDDLEWARE
// Verifies the user has an active paid subscription.
// Attaches req.subscription = { plan, limits, subscription } on success.
// Usage:
//   app.get('/api/premium-feature', checkSubscription(), handler);
//   app.get('/api/pro-feature', checkSubscription(['pro','enterprise']), handler);
// ═══════════════════════════════════════════════════════════════
const { getUserPlan } = require('../payments');
const logger = require('../logger');

/**
 * @param {string[]} [allowedPlans] - list of plans that are allowed; defaults to all paid plans
 * @returns Express middleware
 */
function checkSubscription(allowedPlans) {
  const paid = allowedPlans || ['pro', 'enterprise', 'premium'];

  return async function (req, res, next) {
    try {
      const { getUserFromToken, supabaseAdmin } = req.app.locals;
      if (!getUserFromToken) return res.status(503).json({ error: 'Auth indisponibil' });

      const user = await getUserFromToken(req);
      if (!user) return res.status(401).json({ error: 'Neautentificat' });

      const plan = await getUserPlan(user.id, supabaseAdmin);

      if (!paid.includes(plan)) {
        return res.status(403).json({
          error: 'Abonament activ necesar',
          plan,
          required: paid,
          upgrade: true,
        });
      }

      req.subscription = { plan };
      req.user = user;
      next();
    } catch (err) {
      logger.error({ component: 'Auth', err: err.message }, 'Subscription check failed');
      res.status(500).json({ error: 'Eroare verificare abonament' });
    }
  };
}

module.exports = checkSubscription;
