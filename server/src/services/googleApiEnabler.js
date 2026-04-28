'use strict';

/**
 * googleApiEnabler.js
 *
 * Auto-enables all Google Cloud APIs required by KelionAI tools at server
 * startup. Uses the Google Cloud Service Usage API v1 with the project's
 * own service account credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * GOOGLE_SERVICE_ACCOUNT_JSON) OR the server API key if available.
 *
 * Called once from server/src/index.js on boot — idempotent (enabling an
 * already-enabled API is a no-op). Errors are logged but never fatal.
 */

// All Google APIs required by KelionAI tools
const REQUIRED_APIS = [
  // Core AI / Translation
  'translate.googleapis.com',           // Google Cloud Translation
  'language.googleapis.com',            // Natural Language (optional)

  // Maps & Geo
  'maps-embed-backend.googleapis.com',  // Maps Embed API (monitor maps)
  'directions-backend.googleapis.com',  // Directions API (get_route)
  'geocoding-backend.googleapis.com',   // Geocoding API (geocode tool)
  'places-backend.googleapis.com',      // Places API (nearby_places)

  // Search
  'customsearch.googleapis.com',        // Custom Search API (web_search)

  // Google Account (OAuth-based, per-user)
  'calendar-json.googleapis.com',       // Google Calendar API (read_calendar)
  'gmail.googleapis.com',               // Gmail API (read_email)
  'drive.googleapis.com',               // Google Drive API (search_files)

  // YouTube removed (2026-04-28)
];

let _enabledOnce = false;

/**
 * Attempt to enable all required Google APIs.
 * Uses OAuth2 service account if available, otherwise logs a warning.
 * Never throws — all errors are caught and logged.
 */
async function enableAllGoogleApis() {
  if (_enabledOnce) return;
  _enabledOnce = true;

  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT_ID;

  if (!projectId) {
    console.warn('[googleApiEnabler] No GCP project ID found. Set GOOGLE_CLOUD_PROJECT to auto-enable APIs.');
    return;
  }

  // Try to get an access token via service account
  let accessToken = null;
  try {
    accessToken = await getServiceAccountToken();
  } catch (err) {
    console.warn('[googleApiEnabler] Could not obtain service account token:', err.message);
    return;
  }

  if (!accessToken) {
    console.warn('[googleApiEnabler] No access token available. Skipping auto-enable.');
    return;
  }

  console.log(`[googleApiEnabler] Checking/enabling ${REQUIRED_APIS.length} Google APIs for project ${projectId}...`);

  const results = await Promise.allSettled(
    REQUIRED_APIS.map((api) => enableApi(projectId, api, accessToken))
  );

  const enabled = results.filter((r) => r.status === 'fulfilled' && r.value?.enabled).length;
  const alreadyOn = results.filter((r) => r.status === 'fulfilled' && r.value?.alreadyEnabled).length;
  const failed = results.filter((r) => r.status === 'rejected' || r.value?.error).length;

  console.log(`[googleApiEnabler] Done: ${enabled} enabled, ${alreadyOn} already active, ${failed} failed/skipped.`);
}

/**
 * Enable a single Google API service.
 */
async function enableApi(projectId, apiName, accessToken) {
  try {
    const url = `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${apiName}:enable`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (r.status === 200 || r.status === 201) {
      const data = await r.json().catch(() => ({}));
      // Long-running operation — we don't wait for it
      if (data.name) return { enabled: true, api: apiName };
    }
    if (r.status === 400) {
      // API might already be enabled or the name is wrong
      const body = await r.json().catch(() => ({}));
      if (body?.error?.message?.includes('already enabled')) {
        return { alreadyEnabled: true, api: apiName };
      }
    }
    if (r.status === 403) {
      // Insufficient permissions — service account doesn't have Service Usage Admin role
      return { error: `403 Forbidden for ${apiName}` };
    }
    return { error: `HTTP ${r.status} for ${apiName}` };
  } catch (err) {
    return { error: `${apiName}: ${err.message}` };
  }
}

/**
 * Get a Google OAuth2 access token using the service account credentials.
 * Tries GOOGLE_APPLICATION_CREDENTIALS (file path) then
 * GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON) then google-auth-library if available.
 */
async function getServiceAccountToken() {
  // Try google-auth-library (already installed for vertexLiveProxy)
  try {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const tokenData = await client.getAccessToken();
    return tokenData?.token || tokenData;
  } catch {
    // google-auth-library not available or credentials not configured
  }

  // Try GOOGLE_SERVICE_ACCOUNT_JSON env var (inline JSON)
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    try {
      const sa = JSON.parse(inlineJson);
      return await mintJwtAccessToken(sa);
    } catch (err) {
      console.warn('[googleApiEnabler] GOOGLE_SERVICE_ACCOUNT_JSON parse error:', err.message);
    }
  }

  return null;
}

/**
 * Mint a short-lived access token from a service account JSON object.
 * Uses RS256 JWT signed with the private key.
 */
async function mintJwtAccessToken(sa) {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${header}.${body}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = `${unsigned}.${signature}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });

  if (!r.ok) throw new Error(`Token endpoint returned ${r.status}`);
  const data = await r.json();
  return data.access_token;
}

module.exports = { enableAllGoogleApis, REQUIRED_APIS };
