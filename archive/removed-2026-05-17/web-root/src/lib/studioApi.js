// Thin typed client for the Kelion Studio DS-1/DS-3 endpoints
// (mounted at /api/studio). Every call reuses the shared CSRF cookie
// and cookie-based session auth from lib/api.js.
//
// No business logic lives here — the server layer (routes/studio.js
// and the DB helpers) is the single source of truth for quotas,
// ownership and validation. The UI only renders what this returns.

import { api, getCsrfToken, AUTH_BASE } from './api'

const BASE = '/api/studio'

// Some endpoints use methods or payload shapes lib/api.js doesn't
// expose directly (PATCH, DELETE-with-body, long-lived POST). Those
// fall through to raw fetch, which means *we* have to prefix the
// dev-server base URL ourselves — api.* helpers do this internally.
function absUrl(path) {
  return `${AUTH_BASE}${path}`
}

// GET /api/studio/usage → { totals, limits }
export function getStudioUsage() {
  return api.get(`${BASE}/usage`)
}

// GET /api/studio/workspaces → { items: [{id, name, size_bytes, updated_at}] }
export function listWorkspaces() {
  return api.get(`${BASE}/workspaces`)
}

// POST /api/studio/workspaces → { workspace }
export function createWorkspace(name) {
  return api.post(`${BASE}/workspaces`, { name })
}

// GET /api/studio/workspaces/:id → { workspace: { …, files: [{path,size,updated_at}] } }
export function getWorkspace(id) {
  return api.get(`${BASE}/workspaces/${encodeURIComponent(id)}`)
}

// PATCH /api/studio/workspaces/:id → { ok: true }
// lib/api.js doesn't expose a .patch() helper, so we inline the same
// cookie + CSRF + JSON dance here rather than bolt a new method onto
// the shared client just for DS-2.
export async function renameWorkspace(id, name) {
  const r = await fetch(absUrl(`${BASE}/workspaces/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: JSON.stringify({ name }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(j.error || `HTTP ${r.status}`)
    err.status = r.status
    err.body = j
    throw err
  }
  return j
}

// DELETE /api/studio/workspaces/:id → { ok: true }
export function deleteWorkspace(id) {
  return api.delete(`${BASE}/workspaces/${encodeURIComponent(id)}`)
}

// GET /api/studio/workspaces/:id/file?path=… → { file: {path, content, size, updated_at} }
export function readFile(id, path) {
  const qs = `?path=${encodeURIComponent(path)}`
  return api.get(`${BASE}/workspaces/${encodeURIComponent(id)}/file${qs}`)
}

// PUT /api/studio/workspaces/:id/file → { file }
// Idempotent — called by the autosave loop every ~2 seconds while
// Monaco is dirty. The server uses a per-workspace write queue
// (studioWriteQueues) so concurrent saves don't clobber the JSON blob.
export function writeFile(id, path, content) {
  return api.put(`${BASE}/workspaces/${encodeURIComponent(id)}/file`, { path, content })
}

// DELETE /api/studio/workspaces/:id/file (body: {path}) → { ok, remaining }
// `api.delete` doesn't take a body; use raw fetch so we stay within
// the existing helper conventions (cookies + CSRF + 10s timeout).
export function deleteFile(id, path) {
  return fetch(absUrl(`${BASE}/workspaces/${encodeURIComponent(id)}/file`), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: JSON.stringify({ path }),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(j.error || `HTTP ${r.status}`)
      err.status = r.status
      err.body = j
      throw err
    }
    return j
  })
}

// POST /api/studio/workspaces/:id/run
// Body: { entry?, install_first?, timeout_ms? }
// → { ok, entry, pip: {exit_code, stdout, stderr}?, run: {exit_code, stdout, stderr}, duration_ms }
// Long-running (can block for up to 120 s) — uses a raw fetch with a
// generous timeout so the shared 10 s `api.*` helpers don't abort it.
export async function runWorkspace(id, { entry, installFirst, timeoutMs = 120000 } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs + 5000)
  try {
    const r = await fetch(absUrl(`${BASE}/workspaces/${encodeURIComponent(id)}/run`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
      },
      body: JSON.stringify({
        entry: entry || undefined,
        install_first: Boolean(installFirst),
        timeout_ms: timeoutMs,
      }),
      signal: controller.signal,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(j.error || `HTTP ${r.status}`)
      err.status = r.status
      err.body = j
      throw err
    }
    return j
  } finally {
    clearTimeout(t)
  }
}

// POST /api/studio/workspaces/:id/pip-install → { ok, exit_code, stdout, stderr }
export async function pipInstall(id, packages) {
  const r = await fetch(absUrl(`${BASE}/workspaces/${encodeURIComponent(id)}/pip-install`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    body: JSON.stringify({ packages }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(j.error || `HTTP ${r.status}`)
    err.status = r.status
    err.body = j
    throw err
  }
  return j
}

// Format bytes as a compact human string — used in the quota banner.
export function formatBytes(n) {
  const x = Number(n) || 0
  if (x < 1024) return `${x} B`
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`
  if (x < 1024 * 1024 * 1024) return `${(x / (1024 * 1024)).toFixed(1)} MB`
  return `${(x / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Guess a Monaco language for a filename — just enough to get syntax
// highlighting for the common cases. Unknown extensions default to
// plaintext which is the safest fallback.
export function languageForPath(path) {
  const p = String(path || '').toLowerCase()
  if (p.endsWith('.py')) return 'python'
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript'
  if (p.endsWith('.ts')) return 'typescript'
  if (p.endsWith('.tsx')) return 'typescript'
  if (p.endsWith('.jsx')) return 'javascript'
  if (p.endsWith('.json')) return 'json'
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'markdown'
  if (p.endsWith('.yml') || p.endsWith('.yaml')) return 'yaml'
  if (p.endsWith('.toml')) return 'ini'
  if (p.endsWith('.sh') || p.endsWith('.bash')) return 'shell'
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'html'
  if (p.endsWith('.css')) return 'css'
  if (p.endsWith('.txt') || p === 'requirements.txt' || p.endsWith('/requirements.txt')) return 'plaintext'
  return 'plaintext'
}
