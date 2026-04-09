'use strict';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'adrianenc11@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase());

/**
 * Express middleware that requires the authenticated user to be an admin.
 * Must be used after requireAuth so req.user is already populated.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!ADMIN_EMAILS.includes(req.user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = { requireAdmin, ADMIN_EMAILS };
