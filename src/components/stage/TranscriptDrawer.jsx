import React, { useState, useRef, useCallback, useEffect } from 'react'

/**
 * TranscriptDrawer — extracted from KelionStage IIFE to fix React Error #310.
 * Hooks must live at component top-level, never inside conditionally-executed IIFEs.
 *
 * Props:
 *   turns        – array of { role, text, transcript, source }
 *   authSignedIn – boolean
 *   authToken    – string | null
 *   isAdmin      – boolean
 *   onClose      – () => void
 */

/**
 * Strip internal tool-calling markup that the model sometimes leaks into its
 * visible text.  Patterns removed:
 *   ⚙ **Apelează Tool:** `tool_name` ```json ... ```
 *   ✅ **Rezultat Tool:** ``` ... ```
 *   Any remaining raw JSON objects ({ "key": ... })
 */
function cleanToolMarkup(text) {
  if (!text || typeof text !== 'string') return text
  let cleaned = text
  // Remove "⚙ **Apelează Tool:** ..." blocks (including JSON code fences)
  cleaned = cleaned.replace(/⚙\s*\*{0,2}Apeleaz[aăâ]\s*Tool:?\*{0,2}[^✅]*/gi, '')
  // Remove "✅ **Rezultat Tool:** ..." blocks
  cleaned = cleaned.replace(/✅\s*\*{0,2}Rezultat\s*Tool:?\*{0,2}\s*```[\s\S]*?```/gi, '')
  // Remove any remaining fenced code blocks with JSON
  cleaned = cleaned.replace(/```json[\s\S]*?```/gi, '')
  cleaned = cleaned.replace(/```[\s\S]*?```/gi, '')
  // Remove standalone JSON objects like {"ok":true,"type":"conversations",...}
  cleaned = cleaned.replace(/\{["\s]*ok["\s]*:\s*true[\s\S]*?\}\s*/g, '')
  // Remove leftover ✅ markers
  cleaned = cleaned.replace(/[⚙✅]\s*/g, '')
  // Collapse multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.trim()
}

export default function TranscriptDrawer({ turns, authSignedIn, authToken, isAdmin, onClose }) {
  const [tsTab, setTsTab] = useState('live')
  const [tsQuery, setTsQuery] = useState('')
  const [tsDateFrom, setTsDateFrom] = useState('')
  const [tsDateTo, setTsDateTo] = useState('')
  const [tsTimeFrom, setTsTimeFrom] = useState('')
  const [tsTimeTo, setTsTimeTo] = useState('')
  const [tsRole, setTsRole] = useState('')
  const [tsResults, setTsResults] = useState([])
  const [tsTotal, setTsTotal] = useState(0)
  const [tsOffset, setTsOffset] = useState(0)
  const [tsLoading, setTsLoading] = useState(false)
  const [tsError, setTsError] = useState(null)
  const [tsFiltersOpen, setTsFiltersOpen] = useState(false)
  const tsLimit = 30
  const tsDebounceRef = useRef(null)

  const doSearch = useCallback(async (newOffset = 0) => {
    if (!authSignedIn) {
      setTsError('Sign in to search conversation history.')
      return
    }
    setTsLoading(true)
    setTsError(null)
    try {
      const params = new URLSearchParams()
      if (tsQuery.trim()) params.set('q', tsQuery.trim())
      // Combine date + time into SQLite-compatible datetime strings
      if (tsDateFrom) {
        const timePart = tsTimeFrom || '00:00'
        params.set('dateFrom', `${tsDateFrom} ${timePart}:00`)
      }
      if (tsDateTo) {
        const timePart = tsTimeTo || '23:59'
        params.set('dateTo', `${tsDateTo} ${timePart}:59`)
      }
      if (tsRole) params.set('role', tsRole)
      params.set('limit', String(tsLimit))
      params.set('offset', String(newOffset))

      const headers = { 'Content-Type': 'application/json' }
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`
      }
      const resp = await fetch(`/api/conversations/search?${params.toString()}`, {
        credentials: 'include',
        headers,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setTsResults(data.results || [])
      setTsTotal(data.total || 0)
      setTsOffset(newOffset)
    } catch (err) {
      setTsError(err.message || 'Search failed')
      setTsResults([])
      setTsTotal(0)
    } finally {
      setTsLoading(false)
    }
  }, [tsQuery, tsDateFrom, tsDateTo, tsTimeFrom, tsTimeTo, tsRole, authSignedIn, authToken])

  // Auto-search on filter change with debounce
  useEffect(() => {
    if (tsTab !== 'search') return
    if (tsDebounceRef.current) clearTimeout(tsDebounceRef.current)
    tsDebounceRef.current = setTimeout(() => doSearch(0), 400)
    return () => clearTimeout(tsDebounceRef.current)
  }, [tsQuery, tsDateFrom, tsDateTo, tsTimeFrom, tsTimeTo, tsRole, tsTab, doSearch])

  // Highlight matching keywords in content
  const highlightMatch = (text, query) => {
    if (!query || !query.trim() || !text) return text
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.trim().toLowerCase()
        ? <mark key={i} style={{
            background: 'rgba(250, 204, 21, 0.35)',
            color: '#fef3c7',
            borderRadius: 3,
            padding: '0 2px',
          }}>{part}</mark>
        : part
    )
  }

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: 'rgba(167, 139, 250, 0.08)',
    border: '1px solid rgba(167, 139, 250, 0.2)',
    color: '#ede9fe', fontSize: 13,
    outline: 'none', fontFamily: 'inherit',
    transition: 'border-color 0.2s',
  }
  const labelStyle = {
    fontSize: 10, opacity: 0.55, letterSpacing: '0.1em',
    marginBottom: 4, display: 'block',
  }
  const chipStyle = (active) => ({
    padding: '5px 10px', borderRadius: 8, fontSize: 12,
    cursor: 'pointer', transition: 'all 0.2s',
    border: active
      ? '1px solid rgba(167, 139, 250, 0.6)'
      : '1px solid rgba(167, 139, 250, 0.15)',
    background: active
      ? 'rgba(167, 139, 250, 0.2)'
      : 'rgba(167, 139, 250, 0.04)',
    color: active ? '#ede9fe' : 'rgba(237, 233, 254, 0.6)',
  })

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 'min(460px, 94vw)',
        background: 'rgba(10, 8, 20, 0.82)',
        backdropFilter: 'blur(22px)',
        borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
        padding: '70px 20px 20px 20px',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 24,
        userSelect: 'text',
        WebkitUserSelect: 'text',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>TRANSCRIPT</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {tsTab === 'live' && turns.length > 0 && (
            <button
              onClick={() => {
                const text = turns.map(t => `${t.role === 'user' ? 'YOU' : 'KELION'}:\n${t.text || t.transcript || '...'}`).join('\n\n')
                navigator.clipboard.writeText(text).catch(() => {})
              }}
              style={{
                background: 'rgba(167, 139, 250, 0.15)', border: '1px solid rgba(167, 139, 250, 0.3)',
                color: '#ede9fe', fontSize: 11, padding: '4px 8px', borderRadius: 6,
                cursor: 'pointer', transition: 'background 0.2s',
              }}
            >Copy All</button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: '#ede9fe',
              fontSize: 20, cursor: 'pointer', opacity: 0.7,
            }}
            aria-label="Close transcript"
          >×</button>
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 14, flexShrink: 0,
        background: 'rgba(167, 139, 250, 0.06)',
        borderRadius: 10, padding: 3,
      }}>
        {[
          { key: 'live', label: '🎙 Sesiune' },
          { key: 'search', label: '🔍 Căutare' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setTsTab(tab.key)}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12,
              fontWeight: tsTab === tab.key ? 600 : 400,
              border: 'none', cursor: 'pointer',
              background: tsTab === tab.key
                ? 'rgba(167, 139, 250, 0.22)'
                : 'transparent',
              color: tsTab === tab.key ? '#ede9fe' : 'rgba(237, 233, 254, 0.5)',
              transition: 'all 0.2s',
              letterSpacing: '0.03em',
            }}
          >{tab.label}</button>
        ))}
      </div>

      {/* LIVE TAB — current session turns */}
      {tsTab === 'live' && (
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
          {turns.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Conversația va apărea aici.</div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{
              marginBottom: 14, padding: '10px 12px',
              borderRadius: 10,
              background: t.role === 'user' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(96, 165, 250, 0.08)',
              borderLeft: `2px solid ${t.role === 'user' ? '#a78bfa' : '#60a5fa'}`,
              fontSize: 14, lineHeight: 1.5,
            }}>
              <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 4, letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
                <span>{t.role === 'user' ? 'TU' : 'KELION'}</span>
                {isAdmin && t.source && <span style={{ opacity: 0.8, color: t.role === 'user' ? '#d8b4fe' : '#93c5fd', fontWeight: 500 }}>{t.source}</span>}
              </div>
              {t.role === 'user'
                ? (t.text || t.transcript || <i style={{ opacity: 0.4 }}>…</i>)
                : (cleanToolMarkup(t.text || t.transcript || '') || <i style={{ opacity: 0.4 }}>…</i>)
              }
            </div>
          ))}
        </div>
      )}

      {/* SEARCH TAB — full-text search with filters */}
      {tsTab === 'search' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Search input */}
          <div style={{ position: 'relative', marginBottom: 10, flexShrink: 0 }}>
            <input
              type="text"
              value={tsQuery}
              onChange={(e) => setTsQuery(e.target.value)}
              placeholder="Caută cuvinte, subiecte..."
              style={{
                ...inputStyle,
                paddingLeft: 34,
                fontSize: 14,
              }}
              onFocus={(e) => e.target.style.borderColor = 'rgba(167, 139, 250, 0.5)'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(167, 139, 250, 0.2)'}
              autoFocus
            />
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 15, opacity: 0.4,
            }}>🔍</span>
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setTsFiltersOpen(v => !v)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(167, 139, 250, 0.15)',
              color: 'rgba(237, 233, 254, 0.6)',
              fontSize: 11, padding: '5px 10px', borderRadius: 8,
              cursor: 'pointer', marginBottom: 10, alignSelf: 'flex-start',
              display: 'flex', alignItems: 'center', gap: 6,
              letterSpacing: '0.05em',
              transition: 'all 0.2s',
            }}
          >
            <span style={{ fontSize: 13 }}>⚙</span>
            {tsFiltersOpen ? 'Ascunde filtre' : 'Filtre avansate'}
            {(tsDateFrom || tsDateTo || tsRole) && (
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#a78bfa', flexShrink: 0,
              }} />
            )}
          </button>

          {/* Advanced filters panel */}
          {tsFiltersOpen && (
            <div style={{
              marginBottom: 14, padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(167, 139, 250, 0.05)',
              border: '1px solid rgba(167, 139, 250, 0.12)',
              flexShrink: 0,
              animation: 'fadeIn 0.2s ease',
            }}>
              {/* Date range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>DE LA DATĂ</label>
                  <input
                    type="date"
                    value={tsDateFrom}
                    onChange={(e) => setTsDateFrom(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>PÂNĂ LA DATĂ</label>
                  <input
                    type="date"
                    value={tsDateTo}
                    onChange={(e) => setTsDateTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              {/* Time range */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>DE LA ORA</label>
                  <input
                    type="time"
                    value={tsTimeFrom}
                    onChange={(e) => setTsTimeFrom(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>PÂNĂ LA ORA</label>
                  <input
                    type="time"
                    value={tsTimeTo}
                    onChange={(e) => setTsTimeTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              {/* Role filter */}
              <div>
                <label style={labelStyle}>CINE A SPUS</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setTsRole('')} style={chipStyle(!tsRole)}>Toți</button>
                  <button onClick={() => setTsRole('user')} style={chipStyle(tsRole === 'user')}>Tu</button>
                  <button onClick={() => setTsRole('assistant')} style={chipStyle(tsRole === 'assistant')}>Kelion</button>
                </div>
              </div>
              {/* Clear filters */}
              {(tsDateFrom || tsDateTo || tsTimeFrom || tsTimeTo || tsRole) && (
                <button
                  onClick={() => {
                    setTsDateFrom(''); setTsDateTo('');
                    setTsTimeFrom(''); setTsTimeTo('');
                    setTsRole('')
                  }}
                  style={{
                    marginTop: 10, fontSize: 11, padding: '4px 8px',
                    borderRadius: 6, background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fecaca', cursor: 'pointer',
                  }}
                >✕ Resetează filtrele</button>
              )}
            </div>
          )}

          {/* Status / error */}
          {tsError && (
            <div style={{
              marginBottom: 10, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fecaca', fontSize: 12,
              flexShrink: 0,
            }}>{tsError}</div>
          )}

          {/* Results count */}
          {!tsLoading && tsResults.length > 0 && (
            <div style={{
              fontSize: 11, opacity: 0.5, marginBottom: 8,
              letterSpacing: '0.05em', flexShrink: 0,
            }}>
              {tsTotal} rezultat{tsTotal !== 1 ? 'e' : ''} găsit{tsTotal !== 1 ? 'e' : ''}
              {tsOffset > 0 && ` · pagina ${Math.floor(tsOffset / tsLimit) + 1}`}
            </div>
          )}

          {/* Loading spinner */}
          {tsLoading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              opacity: 0.6, fontSize: 13, padding: '16px 0',
              flexShrink: 0,
            }}>
              <span style={{
                width: 14, height: 14, border: '2px solid rgba(167, 139, 250, 0.3)',
                borderTopColor: '#a78bfa', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block', flexShrink: 0,
              }} />
              Se caută...
            </div>
          )}

          {/* No results */}
          {!tsLoading && tsResults.length === 0 && !tsError && (
            <div style={{ opacity: 0.45, fontSize: 14, padding: '20px 0', textAlign: 'center', lineHeight: 1.5 }}>
              {tsQuery || tsDateFrom || tsDateTo || tsRole
                ? '🔍 Niciun rezultat pentru filtrele selectate.'
                : 'Introdu un cuvânt sau ajustează filtrele pentru a căuta în istoricul conversațiilor.'}
            </div>
          )}

          {/* Search results */}
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {tsResults.map((r) => {
              const ts = r.created_at ? new Date(r.created_at) : null
              const timeStr = ts && !Number.isNaN(ts.getTime())
                ? ts.toLocaleString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : ''
              return (
                <div key={r.id} style={{
                  marginBottom: 12, padding: '10px 12px',
                  borderRadius: 10,
                  background: r.role === 'user' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(96, 165, 250, 0.08)',
                  borderLeft: `2px solid ${r.role === 'user' ? '#a78bfa' : '#60a5fa'}`,
                  fontSize: 13, lineHeight: 1.5,
                }}>
                  <div style={{
                    fontSize: 10, opacity: 0.55, marginBottom: 4,
                    letterSpacing: '0.08em',
                    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4,
                  }}>
                    <span style={{ fontWeight: 600 }}>
                      {r.role === 'user' ? 'TU' : 'KELION'}
                    </span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      {r.conversation_title && (
                        <span style={{
                          color: '#c4b5fd',
                          maxWidth: 120, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>📝 {r.conversation_title}</span>
                      )}
                      {timeStr && <span>{timeStr}</span>}
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {highlightMatch(r.content, tsQuery)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {tsTotal > tsLimit && !tsLoading && (
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 8,
              marginTop: 12, flexShrink: 0,
            }}>
              {tsOffset > 0 && (
                <button
                  onClick={() => doSearch(Math.max(0, tsOffset - tsLimit))}
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12,
                    background: 'rgba(167, 139, 250, 0.12)',
                    border: '1px solid rgba(167, 139, 250, 0.25)',
                    color: '#ede9fe', cursor: 'pointer',
                  }}
                >← Înapoi</button>
              )}
              {(tsOffset + tsLimit) < tsTotal && (
                <button
                  onClick={() => doSearch(tsOffset + tsLimit)}
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12,
                    background: 'rgba(167, 139, 250, 0.12)',
                    border: '1px solid rgba(167, 139, 250, 0.25)',
                    color: '#ede9fe', cursor: 'pointer',
                  }}
                >Mai multe →</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
