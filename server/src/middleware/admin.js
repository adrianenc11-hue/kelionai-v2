'use strict';
/**
 * Admin middleware — checks user.role === 'admin' from the database.
 * No hardcoded emails. The first user to be promoted to admin must be
 * done via the Supabase dashboard or a one-time seed script.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = { requireAdmin };
