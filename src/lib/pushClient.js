// Stage 5 — M23/M25: browser-side push registration.
// Menu action "Enable pings" calls enablePush(); "Disable pings" calls disablePush().

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function pushSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function getPushStatus() {
  if (!pushSupported()) return { supported: false, enabled: false, permission: 'unsupported' }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    if (!reg) return { supported: true, enabled: false, permission: Notification.permission }
    const sub = await reg.pushManager.getSubscription()
    return { supported: true, enabled: !!sub, permission: Notification.permission, endpoint: sub?.endpoint || null }
  } catch {
    return { supported: true, enabled: false, permission: Notification.permission }
  }
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported on this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied.')

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready

  const keyRes = await fetch('/api/push/public-key')
  if (!keyRes.ok) throw new Error('Failed to fetch VAPID public key.')
  const { publicKey } = await keyRes.json()
  if (!publicKey) throw new Error('Server has no VAPID public key configured.')

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const subscription = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subscription }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Subscribe failed: ${res.status} ${err}`)
  }
  return subscription
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
  } finally {
    await sub.unsubscribe().catch(() => {})
  }
}

export async function sendTestPing(body) {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ body: body || null }),
  })
  if (!res.ok) throw new Error(`Test push failed: ${res.status}`)
  return res.json()
}
