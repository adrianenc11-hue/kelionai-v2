// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — CHECK SUBSCRIPTION MIDDLEWARE
// Verifies the user has an active paid subscription.
// Attaches req.subscription = { plan, limits, subscription } on success.
// Usage:
//   app.get('/api/premium-feature', checkSubscription(), handler);
//   app.get('/api/pro-feature', checkSubscription(['pro','enterprise']), handler);
// ═══════════════════════════════════════════════════════════════
const { getUserPlan, PLAN_LIMITS } = require('../payments');

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

            const planInfo = await getUserPlan(user.id, supabaseAdmin);

            if (!paid.includes(planInfo.plan)) {
                return res.status(403).json({
                    error: 'Abonament activ necesar',
                    plan: planInfo.plan,
                    required: paid,
                    upgrade: true
                });
            }

            req.subscription = planInfo;
            req.user = user;
            next();
        } catch (e) {
            res.status(500).json({ error: 'Eroare verificare abonament' });
        }
    };
}

module.exports = checkSubscription;
