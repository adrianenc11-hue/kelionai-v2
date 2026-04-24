/**
 * Cross-mode handoff — selects `priorTurns` for a new voice session.
 *
 * KelionStage holds two logical transcripts:
 *   • `chatMessages` — [{role, content}, ...] — text-chat state. Voice
 *     session end seeds it from the live hook's `turns` so the user
 *     can swap modes without losing context.
 *   • `turns`        — [{role, text}, ...]     — live voice-hook state.
 *     Cleared only on page reload, never on stop/start.
 *
 * Both tap-to-talk and wake-word call `start()` on the active voice
 * hook with `{ priorTurns }` so the server-side persona injects the
 * prior conversation into the new session (see
 * server/src/routes/realtime.js + util/sanitizePriorTurns.js).
 *
 * Selection rule:
 *   1. If `chatMessages` has any usable entries, use it — it's the
 *      canonical cross-mode transcript (voice + text interleaved).
 *   2. Otherwise fall back to `turns` — covers voice-only users who
 *      never touched the text composer.
 *
 * Pure function → testable without React/DOM.
 *
 * @param {Array<{role?:string, content?:string}>} chatMessages
 * @param {Array<{role?:string, text?:string}>}    voiceTurns
 * @param {number} [max=20] — cap on returned length; keep the persona
 *        instruction budget tight on the server side.
 * @returns {Array<{role:'user'|'assistant', text:string}>}
 */
export function selectPriorTurns(chatMessages, voiceTurns, max = 20) {
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
