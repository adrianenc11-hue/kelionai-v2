import { useEffect, useState } from 'react'
import {
  subscribeUIActions,
  getUIActionState,
  dismissNotification,
} from '../lib/uiActionStore'

// Tiny toast overlay driven by uiActionStore. Mounts once inside
// KelionStage; renders only when Kelion has pushed a notification via
// the ui_notify tool. Kept visually unobtrusive on purpose —
// top-center banner, auto-dismissing, never blocking clicks.
//
// We render at most one toast at a time (the newest). A deeper queue
// would be easy to add, but Adrian's immediate need is "see that it
// actually happened" — one visible confirmation at a time is the
// clearest signal.

const VARIANT_STYLES = {
  info:    { bg: 'rgba(30, 64, 175, 0.92)',  border: '#3b82f6' },
  success: { bg: 'rgba(21, 128, 61, 0.92)',  border: '#22c55e' },
  warning: { bg: 'rgba(161, 98, 7, 0.92)',   border: '#eab308' },
  error:   { bg: 'rgba(153, 27, 27, 0.92)',  border: '#ef4444' },
}

export default function UIActionToast() {
  const [snap, setSnap] = useState(() => getUIActionState())

  useEffect(() => {
    return subscribeUIActions((s) => setSnap(s))
  }, [])

  // Auto-dismiss the most recent toast after its ttl. We store the
  // id on the timer so a newer toast arriving mid-ttl cancels the
  // stale timer instead of wiping it.
  useEffect(() => {
    const last = snap.notifications[snap.notifications.length - 1]
    if (!last) return undefined
    const t = setTimeout(() => {
      dismissNotification(last.id)
    }, last.ttlMs)
    return () => clearTimeout(t)
  }, [snap.lastNotificationId, snap.notifications])

  const active = snap.notifications[snap.notifications.length - 1]
  if (!active) return null

  const style = VARIANT_STYLES[active.variant] || VARIANT_STYLES.info

  return (
    <div
      role="status"
      aria-live="polite"
      data-ui-id="kelion-action-toast"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        maxWidth: 'min(520px, calc(100vw - 32px))',
        padding: '10px 16px',
        borderRadius: 10,
        background: style.bg,
        borderLeft: `3px solid ${style.border}`,
        color: '#fff',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
        cursor: 'pointer',
        lineHeight: 1.35,
      }}
      onClick={() => dismissNotification(active.id)}
      title="Tap to dismiss"
    >
      {active.text}
    </div>
  )
}
