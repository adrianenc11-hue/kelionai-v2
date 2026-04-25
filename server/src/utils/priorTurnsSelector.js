'use strict';

/**
 * Cross-mode handoff — CJS twin of src/lib/priorTurnsSelector.js so
 * Jest (no ESM transform in the server config) can exercise the
 * pure selection rule. Keep the two copies in lockstep; a parity
 * test at the end of the suite checks the frontend copy for drift.
 *
 * See the ESM copy for the full rationale. Short version:
 *   • Prefer `chatMessages` (the cross-mode transcript — voice
 *     session end seeds it from `turns`, text turns append).
 *   • Fall back to the live voice hook's `turns` when chatMessages
 *     is empty so voice-only users still get handoff context.
 */

function selectPriorTurns(chatMessages, voiceTurns, max) {
  const cap = Math.max(0, Number.isFinite(max) ? max : 20);
  const chat = Array.isArray(chatMessages) ? chatMessages : [];
  const voice = Array.isArray(voiceTurns) ? voiceTurns : [];

  const chatClean = chat
    .filter((m) => m && m.role && m.content && String(m.content).trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: String(m.content),
    }));

  if (chatClean.length > 0) return chatClean.slice(-cap);

  return voice
    .filter((t) => t && t.role && t.text && String(t.text).trim())
    .map((t) => ({
      role: t.role === 'assistant' ? 'assistant' : 'user',
      text: String(t.text),
    }))
    .slice(-cap);
}

module.exports = { selectPriorTurns };
