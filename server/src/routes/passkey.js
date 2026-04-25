'use strict';

// Stage 3 — M13: Passkey (WebAuthn) register + authenticate endpoints.
//
// The flow is "silent" from the user's perspective — no sign-in page.
// The frontend calls these when Kelion offers to remember the user
// mid-conversation. A session cookie + JWT is minted on success.

const { Router } = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const config = require('../config');
const {
  getUserById,
  createUser,
  addPasskey,
  getUserPasskeys,
  updatePasskeyCounter,
  findUserByCredentialId,
  setWebauthnChallenge,
  consumeWebauthnChallenge,
} = require('../db');
const { signAppToken } = require('../middleware/auth');

const router = Router();

const rpID = (() => {
  try { return new URL(config.appBaseUrl).hostname; } catch { return 'localhost'; }
})();
const rpName = 'Kelion';
const origin = config.appBaseUrl;

// Helper — flip the session cookie that Stage 1 auth middleware already honours.
function issueSessionCookie(res, user) {
  // signAppToken reads user.id to populate the JWT `sub` claim, so we must
  // pass the object with `.id`, not `.sub`. Passing `{sub: ...}` produced
  // JWTs with sub=undefined, breaking memory/push lookups for passkey users.
  const token = signAppToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'user',
  });
  res.cookie('kelion.token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookie.secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  return token;
}

// --- REGISTRATION ------------------------------------------------------

// POST /api/auth/passkey/register/options
// Body: { name?: string }  — Kelion can pass the conversational name.
// Creates or reuses a user row keyed on an anonymous handle, returns
// CredentialCreationOptions JSON for the browser.
router.post('/register/options', async (req, res) => {
  try {
    const name = (req.body?.name || 'friend').toString().slice(0, 80);
    // Create a shell user with a synthetic email (passkey-only, no real email needed).
    // Real email can be attached later if the user wants magic-link on other devices.
    const synthEmail = `passkey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kelion.local`;
    const user = await createUser({
      google_id: null,
      email: synthEmail,
      name,
      picture: null,
    });

    const existing = await getUserPasskeys(user.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(String(user.id)),
      userName: name,
      userDisplayName: name,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: Buffer.from(c.credentialID, 'base64url'),
        type: 'public-key',
        transports: c.transports,
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });

    await setWebauthnChallenge(user.id, options.challenge);
    res.json({ options, userId: user.id });
  } catch (err) {
    console.error('[passkey/register/options]', err);
    res.status(500).json({ error: 'Failed to generate registration options' });
  }
});

// POST /api/auth/passkey/register/verify
// Body: { userId: number, response: RegistrationResponseJSON }
router.post('/register/verify', async (req, res) => {
  try {
    const { userId, response } = req.body || {};
    if (!userId || !response) {
      return res.status(400).json({ error: 'userId and response are required' });
    }
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const expectedChallenge = await consumeWebauthnChallenge(userId);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No pending challenge' });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration not verified' });
    }

    const { credential } = verification.registrationInfo;
    await addPasskey(user.id, {
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: response.response?.transports || [],
    });

    issueSessionCookie(res, user);
    res.json({ verified: true, user: { id: user.id, name: user.name } });
  } catch (err) {
    console.error('[passkey/register/verify]', err);
    res.status(500).json({ error: 'Registration verification failed' });
  }
});

// --- AUTHENTICATION ----------------------------------------------------

// POST /api/auth/passkey/authenticate/options
// Discoverable credential login — no user handle needed.
router.post('/authenticate/options', async (_req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });
    // Challenge stored in a short-lived cookie (stateless server for this step)
    res.cookie('kelion.wa_challenge', options.challenge, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookie.secure,
      path: '/',
      maxAge: 5 * 60 * 1000,
    });
    res.json({ options });
  } catch (err) {
    console.error('[passkey/authenticate/options]', err);
    res.status(500).json({ error: 'Failed to generate authentication options' });
  }
});

// POST /api/auth/passkey/authenticate/verify
// Body: { response: AuthenticationResponseJSON }
router.post('/authenticate/verify', async (req, res) => {
  try {
    const response = req.body?.response;
    if (!response?.id) {
      return res.status(400).json({ error: 'response required' });
    }
    const expectedChallenge = req.cookies?.['kelion.wa_challenge'];
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No pending challenge' });
    }
    res.clearCookie('kelion.wa_challenge', { path: '/' });

    const user = await findUserByCredentialId(response.id);
    if (!user) {
      return res.status(404).json({ error: 'Credential not recognised' });
    }
    const passkeys = await getUserPasskeys(user.id);
    const stored = passkeys.find((c) => c.credentialID === response.id);
    if (!stored) {
      return res.status(404).json({ error: 'Credential not found on user' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credentialID,
        publicKey: Buffer.from(stored.credentialPublicKey, 'base64url'),
        counter: stored.counter,
        transports: stored.transports,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Authentication not verified' });
    }

    await updatePasskeyCounter(user.id, stored.credentialID, verification.authenticationInfo.newCounter);
    issueSessionCookie(res, user);
    res.json({ verified: true, user: { id: user.id, name: user.name } });
  } catch (err) {
    console.error('[passkey/authenticate/verify]', err);
    res.status(500).json({ error: 'Authentication verification failed' });
  }
});

// GET /api/auth/passkey/me — quick "am I signed in?" probe for the frontend
router.get('/me', async (req, res) => {
  // The stage-1 requireAuth middleware already populates req.user when the
  // cookie is valid. But we want this endpoint public (no 401 for guests).
  try {
    const jwt = require('jsonwebtoken');
    const token = req.cookies?.['kelion.token'];
    if (!token) return res.json({ signedIn: false });
    const decoded = jwt.verify(token, config.jwt.secret);
    // Surface role + email so the frontend can gate admin-only UI
    // (credits dashboard, business panel). Email is also used client-side
    // against the env-configured ADMIN_EMAILS fallback list.
    const allAdmins = config.getAdminEmails();
    const jwtEmail = decoded.email || null;
    const roleIsAdmin = decoded.role === 'admin';
    const jwtEmailIsAdmin = jwtEmail ? allAdmins.includes(jwtEmail.toLowerCase()) : false;

    // Also consult the DB — JWT payload may be stale if the user was
    // promoted to admin AFTER the token was signed, or if the JWT is old
    // and missing the email claim. DB row is authoritative for freshness.
    let dbName = null;
    let dbEmail = null;
    let dbIsAdmin = false;
    try {
      const { findById } = require('../db');
      if (findById && decoded.sub) {
        const dbUser = await findById(decoded.sub);
        if (dbUser) {
          dbName = dbUser.name || null;
          dbEmail = dbUser.email || null;
          const dbRoleIsAdmin = dbUser.role === 'admin';
          const dbEmailIsAdmin = dbUser.email && allAdmins.includes(String(dbUser.email).toLowerCase());
          dbIsAdmin = Boolean(dbRoleIsAdmin || dbEmailIsAdmin);
        }
      }
    } catch (_) { /* ignore — fall back to JWT-only */ }

    const effectiveEmail = dbEmail || jwtEmail;
    const effectiveName = dbName || decoded.name || null;
    return res.json({
      signedIn: true,
      user: {
        id: decoded.sub,
        name: effectiveName,
        email: effectiveEmail,
        role: (dbIsAdmin || roleIsAdmin) ? 'admin' : (decoded.role || 'user'),
        isAdmin: Boolean(roleIsAdmin || jwtEmailIsAdmin || dbIsAdmin),
      },
    });
  } catch {
    return res.json({ signedIn: false });
  }
});

// POST /api/auth/passkey/signout — clear cookie
router.post('/signout', (_req, res) => {
  res.clearCookie('kelion.token', { path: '/' });
  res.json({ ok: true });
});

module.exports = router;
