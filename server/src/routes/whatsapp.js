'use strict';

// ── WhatsApp Bridge Admin Routes ─────────────────────────────────
// Admin-only endpoints for managing the WhatsApp bridge:
//   GET  /api/whatsapp/status    — connection status + QR code
//   POST /api/whatsapp/connect   — start the bridge
//   POST /api/whatsapp/disconnect — stop the bridge
//   POST /api/whatsapp/logout    — clear session + disconnect
//
// The chat handler sends messages to the same AI pipeline as the
// web chat, preserving Kelion's personality and memory.

const { Router } = require('express');
const { requireAdmin } = require('../middleware/auth');
const bridge = require('../services/whatsappBridge');

const router = Router();

// ── AI Chat Handler ──────────────────────────────────────────────
// This function is called for every WhatsApp message that triggers
// Kelion (name mentioned). It uses the same chat pipeline as the web.
async function kelionChatHandler(message, senderName, chatName, isGroup) {
  const { smartFetch } = require('../services/modelRouter');
  const { buildKelionPersona } = require('./realtime');

  // Build a contextual system prompt
  const platform = isGroup ? `WhatsApp group "${chatName}"` : 'WhatsApp DM';
  const systemPrompt = buildKelionPersona({
    user: { display_name: 'Admin' },
    creditsBalance: null,
    memoryItems: [],
    geo: null,
    lockedLangTag: null,
    clientTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    clientLocalTime: new Date().toLocaleString(),
  });

  // Add WhatsApp context to the system prompt
  const whatsappContext = `\n\n[WHATSAPP CONTEXT]
You are responding on ${platform}.
The person talking to you is "${senderName}".
Keep responses concise (max 500 chars) — this is a chat app, not an essay.
Use short paragraphs. No markdown formatting (WhatsApp doesn't render it well).
If someone speaks a different language, respond in THEIR language.

[TRANSLATOR MODE]
If a message starts with "traduci:" or "translate:" or "翻译:", act as a
real-time translator. Translate the text that follows into the language
specified, or auto-detect the target language from context.
Example: "traduci: Bună ziua, cum ești?" in a chat with a Chinese speaker
→ translate to Chinese: "你好，你好吗？"

When two people speak different languages in a group, automatically translate
each message to the OTHER person's language. Detect languages automatically.`;

  const messages = [
    { role: 'system', content: systemPrompt + whatsappContext },
    { role: 'user', content: `[${senderName}]: ${message}` },
  ];

  try {
    const result = await smartFetch({
      messages,
      temperature: 0.7,
      max_tokens: 600,
    });

    if (result?.choices?.[0]?.message?.content) {
      return result.choices[0].message.content.trim();
    }
    return null;
  } catch (err) {
    console.error('[WhatsApp/chat] AI error:', err.message);
    throw err;
  }
}

// ── Routes ───────────────────────────────────────────────────────

/**
 * GET /api/whatsapp/status
 * Returns bridge status, QR code (if pending), and stats.
 */
router.get('/status', requireAdmin, (req, res) => {
  const status = bridge.getStatus();
  res.json(status);
});

/**
 * POST /api/whatsapp/connect
 * Starts the WhatsApp bridge. Returns QR code when available.
 */
router.post('/connect', requireAdmin, async (req, res) => {
  if (bridge.status === 'ready') {
    return res.json({ ok: true, status: 'already_connected' });
  }

  try {
    // Start initialization (async — QR comes via status endpoint)
    bridge.init(kelionChatHandler).catch(err => {
      console.error('[WhatsApp] Init error:', err.message);
    });

    // Wait a bit for QR to generate
    await new Promise(resolve => setTimeout(resolve, 3000));

    const status = bridge.getStatus();
    res.json({
      ok: true,
      status: status.status,
      qrCode: status.qrCode, // data:image/png;base64,... or null
      message: status.qrCode
        ? 'Scanează QR-ul cu WhatsApp (Settings → Linked Devices → Link a Device)'
        : 'Se inițializează... verifică /status în câteva secunde.',
    });
  } catch (err) {
    console.error('[WhatsApp] Connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Stops the bridge but keeps the session (can reconnect without QR).
 */
router.post('/disconnect', requireAdmin, async (req, res) => {
  try {
    await bridge.destroy();
    res.json({ ok: true, status: 'disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/whatsapp/logout
 * Clears the session entirely (will need to re-scan QR).
 */
router.post('/logout', requireAdmin, async (req, res) => {
  try {
    await bridge.logout();
    res.json({ ok: true, status: 'logged_out', message: 'Sesiune WhatsApp ștearsă. Trebuie re-scanat QR-ul.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
