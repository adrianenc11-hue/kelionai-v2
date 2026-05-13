// Network status hook — detects slow connections and data-saver modes
// so Kelion can degrade gracefully on mobile / GSM / metered links.

import { useState, useEffect } from 'react'

function getConnection() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
}

function isSlow(conn) {
  if (!conn) return false
  if (conn.saveData) return true
  // 2g is unusable for vision; 3g is borderline
  if (/2g/.test(conn.effectiveType || '')) return true
  if (/3g/.test(conn.effectiveType || '')) return true
  if ((conn.downlink || 999) < 0.5) return true
  return false
}

function isMetered(conn) {
  if (!conn) return false
  if (conn.saveData) return true
  if (typeof conn.metered === 'boolean') return conn.metered
  return false
}

export function useNetworkStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [slow, setSlow] = useState(false)
  const [metered, setMetered] = useState(false)
  const [type, setType] = useState('unknown')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const conn = getConnection()

    const update = () => {
      setOnline(navigator.onLine)
      setSlow(!navigator.onLine || isSlow(conn))
      setMetered(isMetered(conn))
      setType(conn?.effectiveType || conn?.type || 'unknown')
    }

    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    if (conn) {
      conn.addEventListener?.('change', update)
    }
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      if (conn) {
        conn.removeEventListener?.('change', update)
      }
    }
  }, [])

  return { online, slow, metered, type }
}
