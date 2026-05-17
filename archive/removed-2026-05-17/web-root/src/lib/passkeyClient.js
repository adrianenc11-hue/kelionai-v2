// Stage 3 — M13: Passkey (WebAuthn) browser flow.
// Thin wrapper around @simplewebauthn/browser + our /api/auth/passkey endpoints.

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import { getCsrfToken } from './api';

export function supportsPasskey() {
  return browserSupportsWebAuthn();
}

/**
 * Register a new passkey for a first-time user. `name` is the conversational
 * name Kelion has for them (can be the empty string; we'll fall back to 'friend').
 * On success, the server mints a session cookie — subsequent realtime-token
 * calls will be memory-aware.
 */
export async function registerPasskey(name) {
  const optsResp = await fetch('/api/auth/passkey/register/options', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify({ name: (name || '').trim() }),
  });
  if (!optsResp.ok) throw new Error(`register/options failed (${optsResp.status})`);
  const { options, userId } = await optsResp.json();

  const credential = await startRegistration({ optionsJSON: options });

  const verifyResp = await fetch('/api/auth/passkey/register/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify({ userId, response: credential }),
  });
  if (!verifyResp.ok) {
    const err = await verifyResp.json().catch(() => ({}));
    throw new Error(err.error || `register/verify failed (${verifyResp.status})`);
  }
  return verifyResp.json();
}

/**
 * Sign in an existing user via a discoverable credential (no handle needed).
 */
export async function authenticateWithPasskey() {
  const optsResp = await fetch('/api/auth/passkey/authenticate/options', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
  });
  if (!optsResp.ok) throw new Error(`authenticate/options failed (${optsResp.status})`);
  const { options } = await optsResp.json();

  const credential = await startAuthentication({ optionsJSON: options });

  const verifyResp = await fetch('/api/auth/passkey/authenticate/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
    body: JSON.stringify({ response: credential }),
  });
  if (!verifyResp.ok) {
    const err = await verifyResp.json().catch(() => ({}));
    throw new Error(err.error || `authenticate/verify failed (${verifyResp.status})`);
  }
  return verifyResp.json();
}

export async function fetchMe() {
  const r = await fetch('/api/auth/passkey/me', { credentials: 'include' });
  if (!r.ok) return { signedIn: false };
  return r.json();
}

export async function signOut() {
  await fetch('/api/auth/passkey/signout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': getCsrfToken() },
  });
}
