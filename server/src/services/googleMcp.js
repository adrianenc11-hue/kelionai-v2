'use strict';

// Google MCP integration — Calendar, Gmail, Drive.
// Uses Google REST APIs directly (no googleapis dependency).
// Per-user OAuth tokens stored in DB (google_tokens table).

const crypto = require('crypto');
const config = require('../config');

// DB access — db/index.js exports `getDb` which is the module-level
// `db` variable (a sqlite/pg adapter with .run/.get/.all methods).
// We read it lazily since it's assigned during initDb() at boot.
const dbModule = require('../db');
function getDb() { return dbModule.getDb; }

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

// ── Token Management ────────────────────────────────────────────

let tableCreated = false;

async function ensureTokenTable() {
  if (tableCreated) return;
  const d = getDb();
  if (!d) return;
  await d.run(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      user_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      scope TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tableCreated = true;
}

async function saveTokens(userId, tokens) {
  await ensureTokenTable();
  const d = getDb();
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
  await d.run(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, expires_at, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), google_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, tokens.access_token, tokens.refresh_token || '', expiresAt, tokens.scope || '']
  );
}

async function getAccessToken(userId) {
  await ensureTokenTable();
  const d = getDb();
  const row = await d.get(
    'SELECT access_token, refresh_token, expires_at FROM google_tokens WHERE user_id = $1',
    [userId]
  );
  if (!row) return null;

  // Token still valid (5 min buffer)
  if (Number(row.expires_at) > Date.now() + 300_000) {
    return row.access_token;
  }

  // Refresh
  if (!row.refresh_token) return null;
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
      }),
    });
    if (!r.ok) {
      console.warn('[mcp] token refresh failed:', r.status);
      return null;
    }
    const tokens = await r.json();
    await saveTokens(userId, { ...tokens, refresh_token: row.refresh_token });
    return tokens.access_token;
  } catch (err) {
    console.warn('[mcp] token refresh error:', err.message);
    return null;
  }
}

async function hasGoogleConnection(userId) {
  try {
    await ensureTokenTable();
    const d = getDb();
    const row = await d.get('SELECT user_id FROM google_tokens WHERE user_id = $1', [userId]);
    return !!row;
  } catch { return false; }
}

// ── Calendar ────────────────────────────────────────────────────

async function listCalendarEvents(userId, { maxResults = 10, timeMin, timeMax } = {}) {
  const token = await getAccessToken(userId);
  if (!token) return { ok: false, error: 'Google Calendar not connected. Please link your Google account first.' };

  const params = new URLSearchParams({
    maxResults: String(maxResults),
    orderBy: 'startTime',
    singleEvents: 'true',
    timeMin: timeMin || new Date().toISOString(),
  });
  if (timeMax) params.set('timeMax', timeMax);

  const r = await fetch(`${CALENDAR_API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    return { ok: false, error: `Calendar API error: ${r.status}` };
  }
  const data = await r.json();
  const events = (data.items || []).map(e => ({
    id: e.id,
    summary: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date || '',
    end: e.end?.dateTime || e.end?.date || '',
    location: e.location || null,
    description: e.description?.slice(0, 200) || null,
  }));
  return { ok: true, events, count: events.length };
}

// ── Gmail ───────────────────────────────────────────────────────

async function listEmails(userId, { maxResults = 10, query = '' } = {}) {
  const token = await getAccessToken(userId);
  if (!token) return { ok: false, error: 'Gmail not connected. Please link your Google account first.' };

  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set('q', query);

  const r = await fetch(`${GMAIL_API}/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false, error: `Gmail API error: ${r.status}` };
  const data = await r.json();
  const messageIds = (data.messages || []).slice(0, maxResults);

  const emails = [];
  for (const msg of messageIds) {
    try {
      const mr = await fetch(`${GMAIL_API}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (mr.ok) {
        const md = await mr.json();
        const hdrs = md.payload?.headers || [];
        emails.push({
          id: md.id,
          subject: hdrs.find(h => h.name === 'Subject')?.value || '(no subject)',
          from: hdrs.find(h => h.name === 'From')?.value || '',
          date: hdrs.find(h => h.name === 'Date')?.value || '',
          snippet: md.snippet || '',
        });
      }
    } catch (_) {}
  }
  return { ok: true, emails, count: emails.length };
}

// ── Drive ───────────────────────────────────────────────────────

async function listDriveFiles(userId, { maxResults = 10, query = '' } = {}) {
  const token = await getAccessToken(userId);
  if (!token) return { ok: false, error: 'Google Drive not connected. Please link your Google account first.' };

  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
  });
  if (query) params.set('q', `name contains '${query.replace(/'/g, "\\'")}'`);

  const r = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { ok: false, error: `Drive API error: ${r.status}` };
  const data = await r.json();
  const files = (data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    type: f.mimeType,
    modified: f.modifiedTime,
    size: f.size ? `${Math.round(Number(f.size) / 1024)}KB` : null,
    link: f.webViewLink || null,
  }));
  return { ok: true, files, count: files.length };
}

// ── OAuth Connect URL ───────────────────────────────────────────

// Security audit 2026-05-11 (C2): getConnectUrl now returns { url, nonce }
// so the caller can set the nonce as an httpOnly cookie. The callback route
// validates the cookie against the returned state to prevent CSRF.
function getConnectUrl(userId) {
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ].join(' ');

  // State = "userId:random" — the callback splits on `:` to extract userId
  // and validates the full string against the httpOnly cookie.
  const nonce = `${userId}:${crypto.randomBytes(16).toString('hex')}`;

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.appBaseUrl}/auth/google/mcp-callback`,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: nonce,
  });

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, nonce };
}

async function exchangeCode(code, userId) {
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: `${config.appBaseUrl}/auth/google/mcp-callback`,
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    throw new Error(`Token exchange failed: ${r.status} ${err.slice(0, 200)}`);
  }
  const tokens = await r.json();
  await saveTokens(userId, tokens);
  return true;
}

module.exports = {
  saveTokens,
  getAccessToken,
  hasGoogleConnection,
  listCalendarEvents,
  listEmails,
  listDriveFiles,
  getConnectUrl,
  exchangeCode,
};
