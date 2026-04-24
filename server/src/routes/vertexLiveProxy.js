'use strict';

// Vertex AI Gemini Live API WebSocket proxy.
//
// Vertex Live API authenticates with OAuth 2.0 Bearer tokens via the
// `Authorization` HTTP header — a mechanism browsers cannot use on
// WebSocket connections (the WebSocket constructor in the web platform
// does not accept custom headers). The Google-published tutorial for
// browser-based Live API clients therefore uses a **server proxy**
// that handles auth against Vertex and forwards the raw Gemini Live
// JSON frames verbatim in both directions:
//   https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-websocket
//
// This module implements that proxy. Browser clients connect to
// `wss://<kelion-host>/api/realtime/vertex-live-ws`; the server mints
// a short-lived access token from the `GCP_SERVICE_ACCOUNT_JSON`
// credentials, opens the upstream WebSocket to the regional
// `*-aiplatform.googleapis.com` endpoint, and pipes frames through.
//
// The Gemini Live protocol frames are identical between Google AI
// Studio (`generativelanguage.googleapis.com`) and Vertex AI — the
// only differences are the URL path and the auth shape. Because of
// that, the existing browser hook `useGeminiLive` can be pointed at
// this proxy with zero protocol changes; the hook keeps sending and
// receiving the same JSON (`setup`, `clientContent`, `realtimeInput`,
// `serverContent`, `toolCall`, etc.).
//
// Scope / non-goals for this first cut:
//   - We do NOT implement trial / credits / auth gating here yet. The
//     legacy `/gemini-token` route already does that for the AI Studio
//     path and stays in place. Gating will be wired into the upgrade
//     handler in a follow-up PR once the proxy is proven end-to-end.
//   - We only support a single upstream per browser connection. If
//     the client reconnects, it opens a fresh pair of sockets.
//   - Token refresh is best-effort: a fresh token is minted on every
//     client connect. Google tokens live ~60 minutes and the average
//     Live session is well under that, so we don't rotate mid-flight.

const { GoogleAuth } = require('google-auth-library');
const WebSocket = require('ws');

// Cached GoogleAuth singleton. Re-using one instance lets the
// underlying client re-use cached access tokens across connections
// and keeps our egress footprint small.
let _authSingleton = null;
function getAuth() {
  if (_authSingleton) return _authSingleton;
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON
    || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    || '';
  const opts = {
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  };
  if (raw && raw.trim().startsWith('{')) {
    // Inline JSON string — parse into credentials.
    try {
      opts.credentials = JSON.parse(raw);
    } catch (err) {
      console.warn('[vertex-live] failed to parse GCP_SERVICE_ACCOUNT_JSON:', err.message);
    }
  }
  // If no inline JSON, google-auth-library falls back to
  // GOOGLE_APPLICATION_CREDENTIALS (path), gcloud ADC, or metadata
  // server — matches the standard auth chain on GCE / Cloud Run.
  _authSingleton = new GoogleAuth(opts);
  return _authSingleton;
}

// Mint a fresh Google Cloud OAuth 2.0 access token for Vertex AI.
// Returns `null` on failure so the caller can bail gracefully.
async function mintAccessToken() {
  try {
    const auth = getAuth();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse && tokenResponse.token;
    return token || null;
  } catch (err) {
    console.warn('[vertex-live] failed to mint access token:', err.message);
    return null;
  }
}

// Extract project id + location from env with sane defaults.
// `GOOGLE_CLOUD_PROJECT` matches the GCP convention; falls back to
// the service account JSON's `project_id` so one env var is enough.
function resolveProjectAndLocation() {
  let project = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCP_PROJECT_ID
    || process.env.VERTEX_PROJECT_ID
    || '';
  if (!project) {
    try {
      const raw = process.env.GCP_SERVICE_ACCOUNT_JSON || '';
      if (raw && raw.trim().startsWith('{')) {
        const parsed = JSON.parse(raw);
        project = parsed && parsed.project_id ? parsed.project_id : '';
      }
    } catch (_) { /* ignore */ }
  }
  const location = process.env.GOOGLE_CLOUD_LOCATION
    || process.env.VERTEX_LOCATION
    || 'us-central1';
  return { project, location };
}

function buildUpstreamUrl(location) {
  // Vertex Live API WebSocket endpoint. `BidiGenerateContent` is the
  // unconstrained path — the ephemeral-token-only "Constrained"
  // variant used by AI Studio does not exist on Vertex.
  const host = `${location}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
}

// Attach a `handleUpgrade` handler for path `/api/realtime/vertex-live-ws`
// to the given HTTP server. Returns a cleanup fn for tests.
function attachVertexLiveProxy(httpServer, options = {}) {
  const path = options.path || '/api/realtime/vertex-live-ws';
  // `noServer:true` lets us do the HTTP upgrade ourselves so we can
  // gate on path + later on trial/credits without registering a
  // dedicated listener that catches every upgrade request.
  const wss = new WebSocket.Server({ noServer: true });

  const onUpgrade = (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_) {
      socket.destroy();
      return;
    }
    if (url.pathname !== path) return;
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      handleClientConnection(clientWs, req).catch((err) => {
        console.warn('[vertex-live] connection handler crashed:', err.message);
        try { clientWs.close(1011, 'proxy internal error'); } catch (_) { /* ignore */ }
      });
    });
  };

  httpServer.on('upgrade', onUpgrade);

  return () => {
    httpServer.off('upgrade', onUpgrade);
    wss.close();
  };
}

async function handleClientConnection(clientWs, req) {
  const { project, location } = resolveProjectAndLocation();
  if (!project) {
    clientWs.close(1011, 'Vertex project not configured');
    return;
  }
  const token = await mintAccessToken();
  if (!token) {
    clientWs.close(1011, 'Vertex auth failed');
    return;
  }

  const upstreamUrl = buildUpstreamUrl(location);
  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Vertex's LlmBidiService reads the project from the setup
      // frame's `model` field (e.g. `projects/<id>/locations/<loc>/
      // publishers/google/models/<model>`). We pass through the
      // client's setup verbatim; no header needed here. Keeping this
      // explanation inline so a future reader doesn't wonder why we
      // aren't injecting an `x-goog-user-project` header.
    },
  });

  let closed = false;
  const closeBoth = (code, reason) => {
    if (closed) return;
    closed = true;
    try { clientWs.close(code || 1000, reason || ''); } catch (_) { /* ignore */ }
    try { upstream.close(code || 1000, reason || ''); } catch (_) { /* ignore */ }
  };

  upstream.on('open', () => {
    // No special handshake — the client sends its Gemini Live
    // `setup` frame as the first message, and Vertex responds with
    // `setupComplete`. The protocol is wire-identical to AI Studio
    // once past the auth handshake.
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    try {
      clientWs.send(data, { binary: isBinary });
    } catch (err) {
      console.warn('[vertex-live] failed to forward upstream→client:', err.message);
    }
  });

  upstream.on('close', (code, reason) => {
    closeBoth(code, reason && reason.toString ? reason.toString() : '');
  });

  upstream.on('error', (err) => {
    console.warn('[vertex-live] upstream error:', err.message);
    closeBoth(1011, 'upstream error');
  });

  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.CONNECTING) {
      // Buffer until upstream opens. The official Gemini Live client
      // always sends `setup` immediately after `onopen`, so we rely
      // on the one-shot `open` event + queue anything that slips in
      // early (shouldn't happen in practice, but defensive).
      upstream.once('open', () => {
        try { upstream.send(data, { binary: isBinary }); } catch (_) { /* ignore */ }
      });
      return;
    }
    if (upstream.readyState !== WebSocket.OPEN) return;
    try {
      upstream.send(data, { binary: isBinary });
    } catch (err) {
      console.warn('[vertex-live] failed to forward client→upstream:', err.message);
    }
  });

  clientWs.on('close', (code, reason) => {
    closeBoth(code, reason && reason.toString ? reason.toString() : '');
  });

  clientWs.on('error', (err) => {
    console.warn('[vertex-live] client error:', err.message);
    closeBoth(1011, 'client error');
  });
}

module.exports = {
  attachVertexLiveProxy,
  // Exported for tests only.
  _internals: {
    mintAccessToken,
    resolveProjectAndLocation,
    buildUpstreamUrl,
  },
};
