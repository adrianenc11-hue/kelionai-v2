// UI action store — tiny pub/sub that lets the voice model (via
// ui_notify / ui_navigate tools in kelionTools.js) push visible
// actions into the React tree without importing hooks.
//
// Two concerns are decoupled on purpose:
//
//   1. Toast queue. Any tool can `pushNotification({ text, variant })`
//      and the stage-mounted <UIActionToast/> subscribes to drain it.
//      Toasts are append-only with monotonic ids so a subscriber that
//      mounts late still sees the last active notification.
//
//   2. Imperative controller. The stage registers
//      `setUIActionController({ navigate(route) })` once, and the
//      ui_navigate tool calls into it. Legacy pages without the
//      controller wired in simply receive a soft-fail error message
//      from the tool instead of a crash.
//
// Adrian's brief (2026-04-20): "vreau un creier ... apasă butoane".
// These primitives are the first step — Kelion can now say "am
// deschis Studio" AND actually navigate there, instead of narrating
// an action it never took. Subsequent PRs will add ui_click (against
// an explicit data-ui-id allowlist) and ui_recording_start/stop.

const ALLOWED_VARIANTS = new Set(['info', 'success', 'warning', 'error'])

// Known client routes. Keeping this as an allowlist inside the tool
// layer (not just in the React router) means a hallucinated route
// like "/admin-backend" can't silently navigate anywhere — the
// allowlist mismatch surfaces as a speakable error instead.
const ALLOWED_ROUTES = new Set([
  '/',        // KelionStage (the avatar scene)
  '/studio',  // Python / Node Dev Studio
  '/contact', // Contact page
])

const state = {
  notifications: [],  // append-only, capped at 20
  lastNotificationId: 0,
}
const listeners = new Set()

function notify() {
  const snap = {
    notifications: [...state.notifications],
    lastNotificationId: state.lastNotificationId,
  }
  for (const fn of listeners) {
    try { fn(snap) } catch (_) { /* ignore listener errors */ }
  }
}

export function subscribeUIActions(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function getUIActionState() {
  return {
    notifications: [...state.notifications],
    lastNotificationId: state.lastNotificationId,
  }
}

// Normalise a variant string to the ALLOWED_VARIANTS set; default
// 'info' so a malformed argument from the model can't blow past the
// UI's styling.
export function normaliseVariant(v) {
  const s = String(v || '').trim().toLowerCase()
  return ALLOWED_VARIANTS.has(s) ? s : 'info'
}

// Exposed so tests can assert the allowlist contents without
// reaching into module state.
export function isAllowedRoute(route) {
  return ALLOWED_ROUTES.has(String(route || ''))
}

export function listAllowedRoutes() {
  return [...ALLOWED_ROUTES]
}

export function pushNotification({ text, variant, ttlMs } = {}) {
  const body = String(text || '').trim()
  if (!body) return { ok: false, error: 'ui_notify requires non-empty text.' }
  // Cap display text so a runaway tool call can't paint the screen.
  const safeText = body.slice(0, 240)
  const v = normaliseVariant(variant)
  const id = ++state.lastNotificationId
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, 15_000) : 4_500
  const entry = { id, text: safeText, variant: v, createdAt: Date.now(), ttlMs: ttl }
  state.notifications.push(entry)
  // Keep the queue small — subscribers only render the latest entry
  // in practice, but a short history is useful for debugging.
  if (state.notifications.length > 20) {
    state.notifications = state.notifications.slice(-20)
  }
  notify()
  return { ok: true, id }
}

// Called by the <UIActionToast/> component when a toast's ttl expires
// or the user dismisses it manually. Safe to call with an unknown id.
export function dismissNotification(id) {
  const before = state.notifications.length
  state.notifications = state.notifications.filter((n) => n.id !== id)
  if (state.notifications.length !== before) notify()
}

// Imperative controller — set once by the stage, cleared on unmount.
let controller = null

export function setUIActionController(impl) {
  // `impl` is shaped like:
  //   {
  //     navigate?(route): void | Promise<void>,
  //   }
  // More hooks (toggle panel, open memory drawer, trigger recording)
  // will be added in follow-up PRs. Keeping the surface optional
  // means the tools degrade to a speakable error instead of a crash
  // when a page hasn't wired a handler yet.
  controller = impl || null
}

export function getUIActionController() {
  return controller
}

export async function requestUINavigate(route) {
  const r = String(route || '').trim()
  if (!r) return { ok: false, error: 'ui_navigate requires a route.' }
  if (!isAllowedRoute(r)) {
    return {
      ok: false,
      error: `Route '${r}' is not in the allowed list: ${[...ALLOWED_ROUTES].join(', ')}.`,
    }
  }
  if (!controller || typeof controller.navigate !== 'function') {
    return { ok: false, error: 'Navigation is not available yet. Tell the user to reload the page.' }
  }
  try {
    await controller.navigate(r)
    return { ok: true, route: r }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Navigation rejected.' }
  }
}

export async function requestUINotify({ text, variant, ttl_s } = {}) {
  const ttlMs = Number.isFinite(ttl_s) && ttl_s > 0 ? Math.round(ttl_s * 1000) : undefined
  return pushNotification({ text, variant, ttlMs })
}
