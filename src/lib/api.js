// Detect the API base URL.
// In production (same origin), use relative URLs so cookies work.
// In development, use the env var or default to localhost:3001.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '')

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return res.json()
}

export const api = {
  get:    (path, opts)   => apiFetch(path, { method: 'GET', ...opts }),
  post:   (path, data)   => apiFetch(path, { method: 'POST',  body: JSON.stringify(data) }),
  put:    (path, data)   => apiFetch(path, { method: 'PUT',   body: JSON.stringify(data) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
}

export const AUTH_BASE = API_BASE
