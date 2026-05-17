// Agent Mode — Admin page for Kelion coding-agent capabilities.
// Lists all agent APIs and lets the admin run quick diagnostics.

import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useToast } from './AdminComponents'

const CAPS = [
  { key: 'fs',    label: 'Fișiere',   icon: '📁', path: '/api/agent/fs' },
  { key: 'shell', label: 'Terminal',  icon: '💻', path: '/api/agent/shell' },
  { key: 'web',   label: 'Web',       icon: '🌐', path: '/api/agent/web/search' },
  { key: 'browser',label:'Browser',   icon: '🖼️', path: '/api/agent/browser/screenshot' },
  { key: 'github',label: 'GitHub',    icon: '🐙', path: '/api/agent/github/prs' },
  { key: 'deploy',label: 'Deploy',    icon: '🚀', path: '/api/agent/deploy/list' },
  { key: 'diag',  label: 'Diagnostics',icon:'🔍', path: '/api/agent/diag/tests' },
  { key: 'tasks', label: 'Task-uri',  icon: '✅', path: '/api/agent/tasks' },
]

export default function AgentPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [status, setStatus] = useState({})
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/agent/tasks', { credentials: 'include' })
        if (r.ok) setTasks((await r.json()).tasks || [])
      } catch (_) {}
      // Probe each capability with HEAD
      const next = {}
      await Promise.all(CAPS.map(async c => {
        try {
          const r = await fetch(c.path, { method: 'HEAD', credentials: 'include' })
          next[c.key] = r.status !== 404
        } catch (_) { next[c.key] = false }
      }))
      setStatus(next)
      setLoading(false)
    })()
  }, [])

  const runQuick = async (path) => {
    try {
      const r = await fetch(path, { credentials: 'include', headers: { 'x-csrf-token': getCsrfToken() } })
      const body = await r.json().catch(() => ({}))
      toast.success(body.message || 'OK')
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>🤖 Agent Mode</h2>
      <p style={{ opacity: 0.6, marginBottom: 24 }}>
        Kelion poate acum să citească fișiere, ruleze comenzi, caute pe web,
        facă screenshot-uri, opereze GitHub, deploy-eze și ruleze teste ca un agent de coding.
      </p>

      {loading ? (
        <div style={{ opacity: 0.5 }}>Se încarcă status-ul API-urilor…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {CAPS.map(c => (
            <div key={c.key} style={{
              background: 'var(--admin-surface-2)',
              border: '1px solid var(--admin-border)',
              borderRadius: 'var(--admin-radius)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ fontSize: 22 }}>{c.icon}</div>
              <div style={{ fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                {status[c.key] ? (
                  <span style={{ color: 'var(--admin-green)' }}>● Activ</span>
                ) : (
                  <span style={{ color: 'var(--admin-red)' }}>● Inactiv</span>
                )}
              </div>
              <button
                className="admin-btn"
                onClick={() => runQuick(c.path)}
                disabled={!status[c.key]}
                style={{ marginTop: 'auto' }}
              >
                Test rapid
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ margin: '32px 0 12px', fontSize: 16 }}>Task-uri recente</h3>
      {tasks.length === 0 ? (
        <div style={{ opacity: 0.4, fontSize: 13 }}>Niciun task încă.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.slice(0, 10).map(t => (
            <div key={t.id} style={{
              background: 'var(--admin-surface-2)',
              border: '1px solid var(--admin-border)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>{t.title}</span>
              <span style={{
                color: t.status === 'done' ? 'var(--admin-green)' :
                       t.status === 'error' ? 'var(--admin-red)' : 'var(--admin-amber)'
              }}>{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
