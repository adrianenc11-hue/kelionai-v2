// Admin shared UI components — KPI card, DataTable, Toast, ConfirmModal,
// Skeleton, EmptyState, Chart. Zero external deps, all self-contained.

import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'

/* ═══════════════════════════════════════════════════════════════
   Toast System
   ═══════════════════════════════════════════════════════════════ */

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const add = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
  }, [])
  const toast = useCallback({
    success: (msg) => add(msg, 'success'),
    error:   (msg) => add(msg, 'error'),
    info:    (msg) => add(msg, 'info'),
  }, [add])
  // Wrap in useMemo-style stable ref
  const ref = useRef(toast)
  ref.current = toast

  return (
    <ToastContext.Provider value={ref.current}>
      {children}
      <div className="admin-toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`admin-toast ${t.type}`}>
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/* ═══════════════════════════════════════════════════════════════
   Confirm Modal
   ═══════════════════════════════════════════════════════════════ */

export function ConfirmModal({ open, title, message, confirmLabel, danger, onConfirm, onCancel, busy }) {
  if (!open) return null
  return (
    <div className="admin-modal-backdrop" onClick={onCancel}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title || 'Confirmare'}</h3>
        <p>{message}</p>
        <div className="admin-modal-actions">
          <button className="admin-btn" onClick={onCancel} disabled={busy}>Anulează</button>
          <button
            className={`admin-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Se procesează…' : (confirmLabel || 'Confirmă')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Input Modal — replaces window.prompt()
   ═══════════════════════════════════════════════════════════════ */

export function InputModal({ open, title, fields, onSubmit, onCancel, busy, submitLabel }) {
  const [values, setValues] = useState({})
  useEffect(() => {
    if (open && fields) {
      const init = {}
      fields.forEach((f) => { init[f.key] = f.defaultValue || '' })
      setValues(init)
    }
  }, [open, fields])
  if (!open) return null
  return (
    <div className="admin-modal-backdrop" onClick={onCancel}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
          {(fields || []).map((f) => (
            <div key={f.key}>
              <label style={{ fontSize: 12, color: 'var(--admin-text-dim)', marginBottom: 4, display: 'block' }}>
                {f.label}
              </label>
              <input
                className="admin-input"
                type={f.type || 'text'}
                placeholder={f.placeholder}
                value={values[f.key] || ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                autoFocus={f === fields[0]}
              />
            </div>
          ))}
        </div>
        <div className="admin-modal-actions">
          <button className="admin-btn" onClick={onCancel} disabled={busy}>Anulează</button>
          <button className="admin-btn primary" onClick={() => onSubmit(values)} disabled={busy}>
            {busy ? 'Se procesează…' : (submitLabel || 'Trimite')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   KPI Card
   ═══════════════════════════════════════════════════════════════ */

export function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <div className="kpi-card" style={{ '--kpi-accent': accent }}>
      <div className="kpi-label">{icon && <span style={{ marginRight: 4 }}>{icon}</span>}{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Data Table — sortable, clickable rows, paginated
   ═══════════════════════════════════════════════════════════════ */

export function DataTable({ columns, data, onRowClick, pageSize = 25, emptyText }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(0)

  useEffect(() => setPage(0), [data])

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = sortKey
    ? [...(data || [])].sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey]
        const cmp = typeof va === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : (data || [])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const rows = sorted.slice(page * pageSize, (page + 1) * pageSize)

  if (!data || data.length === 0) {
    return (
      <div className="admin-empty">
        <div className="admin-empty-icon">📭</div>
        <div className="admin-empty-text">{emptyText || 'Nicio înregistrare.'}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  style={{ cursor: col.sortable === false ? 'default' : 'pointer' }}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: 4, fontSize: 10 }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id || i}
                className={onRowClick ? 'clickable' : ''}
                onClick={() => onRowClick && onRowClick(row)}
              >
                {columns.map((col) => (
                  <td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 4px', fontSize: 12, color: 'var(--admin-text-dim)',
        }}>
          <span>{sorted.length} înregistrări · Pagina {page + 1} / {totalPages}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="admin-btn sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              ← Înapoi
            </button>
            <button className="admin-btn sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
              Înainte →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Skeleton
   ═══════════════════════════════════════════════════════════════ */

export function Skeleton({ width, height = 20, count = 1 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="admin-skeleton" style={{ width: width || '100%', height }} />
      ))}
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="kpi-grid">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="kpi-card">
          <Skeleton width="60%" height={12} />
          <div style={{ height: 8 }} />
          <Skeleton width="40%" height={28} />
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Mini chart — pure SVG sparkline (no deps)
   ═══════════════════════════════════════════════════════════════ */

export function SparkChart({ data, valueKey, labelKey, color = 'var(--admin-accent)', height = 180, fillOpacity = 0.15, secondLine, secondColor }) {
  if (!data || data.length === 0) {
    return <div className="admin-empty"><div className="admin-empty-text">Nicio dată disponibilă.</div></div>
  }
  const w = 800, h = height, pad = 6
  const maxV = Math.max(1, ...data.map((d) => d[valueKey] || 0), ...(secondLine ? data.map((d) => d[secondLine] || 0) : []))

  const makePath = (key) => {
    const pts = data.map((d, i) => {
      const x = pad + (data.length > 1 ? (i / (data.length - 1)) * (w - 2 * pad) : w / 2)
      const y = h - pad - (((d[key] || 0) / maxV) * (h - 2 * pad))
      return [x, y]
    })
    return pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
  }

  const makeArea = (key) => {
    const line = makePath(key)
    const pts = data.map((d, i) => {
      const x = pad + (data.length > 1 ? (i / (data.length - 1)) * (w - 2 * pad) : w / 2)
      return x
    })
    return `${line} L${pts[pts.length - 1]},${h - pad} L${pts[0]},${h - pad} Z`
  }

  return (
    <div className="admin-chart-container" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={makeArea(valueKey)} fill={color} opacity={fillOpacity} />
        <path d={makePath(valueKey)} fill="none" stroke={color} strokeWidth="2" />
        {secondLine && (
          <>
            <path d={makeArea(secondLine)} fill={secondColor || 'var(--admin-pink)'} opacity={fillOpacity * 0.7} />
            <path d={makePath(secondLine)} fill="none" stroke={secondColor || 'var(--admin-pink)'} strokeWidth="2" />
          </>
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 4 }}>
        <span>{data[0]?.[labelKey] || ''}</span>
        <span>{data[data.length - 1]?.[labelKey] || 'azi'}</span>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Bar Chart — horizontal bars for ranked data
   ═══════════════════════════════════════════════════════════════ */

export function BarChart({ data, labelKey = 'key', valueKey = 'count', color = 'var(--admin-accent)', max: maxRows = 10 }) {
  if (!data || data.length === 0) return null
  const items = data.slice(0, maxRows)
  const maxVal = Math.max(1, ...items.map((d) => d[valueKey]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--admin-text-dim)' }}>
            {d[labelKey]}
          </span>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
            <div style={{ height: '100%', width: `${(d[valueKey] / maxVal) * 100}%`, background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--admin-text-dim)' }}>
            {d[valueKey]}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Avatar helper
   ═══════════════════════════════════════════════════════════════ */

export function UserAvatar({ email, name, size = 32 }) {
  const initial = (name || email || '?')[0]
  return (
    <div className="admin-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </div>
  )
}
