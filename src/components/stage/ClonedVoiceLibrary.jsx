'use strict'
import React, { useState, useEffect } from 'react'
import { getCsrfToken } from '../../lib/api'

/**
 * ClonedVoiceLibrary — a full-screen or large modal to manage and select
 * from the user's library of cloned voices.
 */
export default function ClonedVoiceLibrary({ onClose }) {
  const [clones, setClones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const fetchClones = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/voice/clone/library', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setClones(j.clones || [])
      const active = (j.clones || []).find(c => c.is_active)
      if (active) setActiveId(active.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchClones()
  }, [])

  const handleActivate = async (clone) => {
    try {
      const r = await fetch(`/api/voice/clone/library/${clone.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
      })
      if (r.ok) {
        setActiveId(clone.id)
        // Refresh local store or notify parent if needed
      }
    } catch (err) {
      console.error('[Library] activate failed', err)
    }
  }

  const handleDeactivate = async () => {
    try {
      const r = await fetch('/api/voice/clone/library/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
      })
      if (r.ok) {
        setActiveId(null)
      }
    } catch (err) {
      console.error('[Library] deactivate failed', err)
    }
  }

  const handleUpdate = async (id) => {
    try {
      const r = await fetch(`/api/voice/clone/library/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
        body: JSON.stringify({ displayName: editName }),
      })
      if (r.ok) {
        setEditingId(null)
        fetchClones()
      }
    } catch (err) {
      console.error('[Library] update failed', err)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Ești sigur că vrei să ștergi această voce din bibliotecă?')) return
    try {
      const r = await fetch(`/api/voice/clone/library/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
      })
      if (r.ok) {
        fetchClones()
      }
    } catch (err) {
      console.error('[Library] delete failed', err)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(5, 4, 12, 0.85)',
      backdropFilter: 'blur(16px)',
      zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 500,
        background: '#0d0b1e',
        borderRadius: 24,
        border: '1px solid rgba(167, 139, 250, 0.2)',
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(167, 139, 250, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#ede9fe', fontSize: 20 }}>Bibliotecă Voci Clonate</h2>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <button
              onClick={async () => {
                setLoading(true)
                try {
                  const r = await fetch('/api/voice/clone/library/sync', {
                    method: 'POST',
                    headers: { 'X-CSRF-Token': getCsrfToken() },
                    credentials: 'include'
                  })
                  if (r.ok) {
                    const j = await r.json()
                    setClones(j.clones || [])
                  }
                } finally {
                  setLoading(false)
                }
              }}
              style={{
                background: 'rgba(124, 58, 237, 0.1)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                color: '#c4b5fd',
                padding: '6px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              🔄 Sync din ElevenLabs
            </button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
          </div>
        </div>

        <div style={{ padding: '24px 32px', maxHeight: '60vh', overflowY: 'auto' }}>
          {loading && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>Se încarcă vocile...</div>}
          {error && <div style={{ color: '#ef4444', textAlign: 'center', padding: 40 }}>{error}</div>}
          {!loading && !error && clones.length === 0 && (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>
              Nu ai nicio voce clonată încă.
            </div>
          )}

          {clones.map(c => (
            <div key={c.id} style={{
              padding: 16,
              borderRadius: 16,
              background: activeId === c.id ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.03)',
              border: '1px solid ' + (activeId === c.id ? '#22c55e' : 'rgba(255,255,255,0.08)'),
              marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <div style={{ fontSize: 24 }}>👤</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === c.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdate(c.id)}
                    style={{ background: '#1a1b26', border: '1px solid #7c3aed', color: '#fff', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                  />
                ) : (
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.display_name}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  ID: {c.voice_id.slice(0, 8)}... · {c.language === 'auto' ? 'Limbă Auto' : c.language}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {editingId === c.id ? (
                  <button onClick={() => handleUpdate(c.id)} style={{ padding: '6px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Salvează</button>
                ) : (
                  <>
                    <button
                      onClick={() => activeId === c.id ? handleDeactivate() : handleActivate(c)}
                      style={{
                        padding: '6px 12px',
                        background: activeId === c.id ? 'rgba(239, 68, 68, 0.2)' : '#7c3aed',
                        color: activeId === c.id ? '#f87171' : '#fff',
                        border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600
                      }}
                    >
                      {activeId === c.id ? 'Dezactivează' : 'Activează'}
                    </button>
                    <button onClick={() => { setEditingId(c.id); setEditName(c.display_name) }} style={{ padding: '6px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(c.id)} style={{ padding: '6px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' }}>🗑️</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '24px 32px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(167, 139, 250, 0.1)', fontSize: 13, color: '#94a3b8' }}>
          Dacă nicio voce clonată nu este activată, Kelion va folosi automat vocile native din ElevenLabs.
        </div>
      </div>
    </div>
  )
}
