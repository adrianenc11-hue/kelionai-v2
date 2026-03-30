// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Centralized Environment Config
// All env-dependent values in one place (no hardcoded domains)
// ═══════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const APP_URL = process.env.APP_URL;
const APP_DOMAIN = process.env.APP_DOMAIN || new URL(APP_URL).hostname;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || `contact@${APP_DOMAIN}`;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || `support@${APP_DOMAIN}`;
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'production';

module.exports = {
  APP_URL,
  APP_DOMAIN,
  CONTACT_EMAIL,
  SUPPORT_EMAIL,
  ADMIN_SECRET,
  PORT,
  NODE_ENV,
};
