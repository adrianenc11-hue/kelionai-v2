// Pub/sub store for in-app composer modals (email today; calendar/sms/doc to
// follow). Adrian: "sa deschida cimpurile de mail, sa poata fi setate" — when
// Kelion is asked to send an email it must NOT just fire-and-forget through
// SMTP. It opens an editable form pre-populated with To / Subject / Body /
// Cc / Bcc, the user reviews and edits in place, and only their explicit
// click on Send actually delivers the message. This store bridges the tool
// dispatcher (kelionTools.js → openEmailComposer) and the React modal
// component in KelionStage.jsx.
//
// Intentionally dependency-free so the tool runner (outside React) and the
// component (via useSyncExternalStore below) can both use it.

const state = {
  kind: null,    // 'email' | null  (calendar/sms/doc come later)
  draft: null,   // { to, cc, bcc, subject, body, reply_to, attachments } for email
  openedAt: 0,
}

const subs = new Set()

function emit() {
  for (const fn of subs) {
    try { fn() } catch (_) { /* swallow — never let one bad subscriber kill the rest */ }
  }
}

export function getComposer() {
  // Returning the same object reference when nothing has changed lets
  // useSyncExternalStore short-circuit re-renders.
  return state
}

export function subscribeComposer(fn) {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

function asArray(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean)
  return String(v || '')
    .split(/[,;]\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * Open the email composer modal. Called from the kelionTools dispatcher
 * when the model invokes `compose_email_draft`. The modal lets the user
 * edit every field before pressing Send, which only then routes through
 * the server's send_email tool.
 *
 * @param {{
 *   to?: string | string[],
 *   cc?: string | string[],
 *   bcc?: string | string[],
 *   subject?: string,
 *   body?: string,
 *   reply_to?: string,
 * }} draft
 */
export function openEmailComposer(draft = {}) {
  state.kind = 'email'
  state.draft = {
    to: asArray(draft.to),
    cc: asArray(draft.cc),
    bcc: asArray(draft.bcc),
    subject: typeof draft.subject === 'string' ? draft.subject.slice(0, 300) : '',
    body: typeof draft.body === 'string' ? draft.body : '',
    reply_to: typeof draft.reply_to === 'string' ? draft.reply_to.trim() : '',
  }
  state.openedAt = Date.now()
  emit()
}

export function closeComposer() {
  state.kind = null
  state.draft = null
  state.openedAt = 0
  emit()
}
