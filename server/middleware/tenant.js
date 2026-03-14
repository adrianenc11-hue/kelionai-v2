/**
 * KelionAI v3.3 — Multi-Tenant Middleware
 *
 * Extracts tenant_id from subdomain or JWT and injects into req.tenantId.
 * When MULTI_TENANT=true, all user-facing queries are scoped to tenant.
 *
 * Tenant resolution:
 * 1. Custom header: X-Tenant-ID
 * 2. Subdomain: {tenant}.kelionai.app → tenant_id lookup
 * 3. JWT claim: user.app_metadata.tenant_id
 * 4. Default: "default" (single-tenant mode)
 */
'use strict';

const logger = require('../logger');

// ── In-memory tenant cache ──
const tenantCache = new Map(); // domain → tenant config
const CACHE_TTL = 5 * 60 * 1000; // 5 min

/**
 * Tenant resolution middleware
 */
function tenantMiddleware(req, _res, next) {
  // Skip if multi-tenant is disabled
  if (process.env.MULTI_TENANT !== 'true') {
    req.tenantId = 'default';
    return next();
  }

  // 1. Explicit header
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant) {
    req.tenantId = headerTenant;
    return next();
  }

  // 2. Subdomain
  const host = req.hostname || '';
  const parts = host.split('.');
  if (parts.length >= 3) {
    const subdomain = parts[0];
    if (subdomain !== 'www' && subdomain !== 'api') {
      req.tenantId = subdomain;
      return next();
    }
  }

  // 3. JWT claim (set by auth middleware)
  if (req.user?.app_metadata?.tenant_id) {
    req.tenantId = req.user.app_metadata.tenant_id;
    return next();
  }

  // 4. Default
  req.tenantId = 'default';
  next();
}

/**
 * Load tenant config from DB or cache
 */
async function getTenantConfig(tenantId, supabaseAdmin) {
  if (!supabaseAdmin || tenantId === 'default') return null;

  // Check cache
  const cached = tenantCache.get(tenantId);
  if (cached && Date.now() - cached._loadedAt < CACHE_TTL) {
    return cached;
  }

  try {
    // Try by domain first, then by ID
    let { data } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('domain', tenantId)
      .eq('is_active', true)
      .single();

    if (!data) {
      ({ data } = await supabaseAdmin.from('tenants').select('*').eq('id', tenantId).eq('is_active', true).single());
    }

    if (data) {
      data._loadedAt = Date.now();
      tenantCache.set(tenantId, data);
      return data;
    }
  } catch (e) {
    logger.warn({ component: 'Tenant', tenantId, err: e.message }, 'Tenant config load failed');
  }

  return null;
}

/**
 * Clear tenant cache
 */
function clearTenantCache(tenantId) {
  if (tenantId) {
    tenantCache.delete(tenantId);
  } else {
    tenantCache.clear();
  }
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  tenantMiddleware,
  getTenantConfig,
  clearTenantCache,
  tenantCache,
};
