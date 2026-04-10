// API base URL.
// Production: empty string → relative URLs (same origin, cookies work).
// Development: localhost:3001 (backend dev server).
const API_BASE = import.meta.env.PROD
  ? ''
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001')

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
      ...options,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const err = new Error(body.error || body.message || `HTTP ${res.status}`)
      err.status = res.status
      err.body = body
      throw err
    }
    return res.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Request timed out')
      timeoutErr.status = 408
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export const api = {
  get:    (path, opts)   => apiFetch(path, { method: 'GET', ...opts }),
  post:   (path, data)   => apiFetch(path, { method: 'POST',  body: JSON.stringify(data) }),
  put:    (path, data)   => apiFetch(path, { method: 'PUT',   body: JSON.stringify(data) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
}

export const AUTH_BASE = API_BASE
