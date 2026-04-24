// Kelion Studio — voice-driven Python IDE (DS-2).
//
// Layout (desktop, >=960px):
//   ┌────────────────────────────────────────────────────────────────┐
//   │  Workspace: [My project ▾] [+ New] [Rename] [Delete]  [quota…] │  ← toolbar
//   ├──────────┬─────────────────────────────────────────────────────┤
//   │ Files    │  Monaco editor (autosaves every 2 s)                │
//   │  main.py │                                                     │
//   │ +req.txt │                                                     │
//   │ + New    │                                                     │
//   ├──────────┴─────────────────────────────────────────────────────┤
//   │ ▶ Run main.py  ☑ install deps first                            │  ← run bar
//   │ [stdout / stderr of last run…]                                 │
//   └────────────────────────────────────────────────────────────────┘
//
// Data path (client → server):
//   GET  /api/studio/workspaces                   (list + pick)
//   POST /api/studio/workspaces {name}            (create)
//   GET  /api/studio/workspaces/:id               (files meta)
//   GET  /api/studio/workspaces/:id/file?path=…   (content on select)
//   PUT  /api/studio/workspaces/:id/file {path,content}   (autosave every 2 s)
//   POST /api/studio/workspaces/:id/run {entry, install_first}
//
// Nothing runs in the browser — every `Run` spins up an ephemeral E2B
// sandbox server-side (server/src/services/studioSandbox.js), prints the
// result here, and is destroyed in `finally`. The editor state is local
// to the component; source-of-truth is the DB blob the server owns.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import ensureMonaco from '../lib/monacoSetup'
import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  renameWorkspace,
  deleteWorkspace,
  readFile,
  writeFile,
  deleteFile,
  runWorkspace,
  getStudioUsage,
  formatBytes,
  languageForPath,
} from '../lib/studioApi'

const AUTOSAVE_MS = 2000

// Opaque "open this file from a clean slate" default scaffold. We only
// prefill when the user creates a workspace from the UI and it comes
// back with zero files — otherwise we respect whatever the server has.
const DEFAULT_NEW_FILES = [
  { path: 'main.py', content: 'print("Hello from Kelion Studio")\n' },
  { path: 'requirements.txt', content: '# one package per line, e.g.\n# requests\n' },
]

function toast(setToast, kind, text, ttlMs = 4000) {
  setToast({ kind, text, id: Date.now() })
  if (ttlMs > 0) {
    setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), ttlMs)
  }
}

// ---------- sub-components ----------

function FileTree({ files, activePath, onSelect, onCreate, onDelete, busy }) {
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    onCreate(name)
    setNewName('')
    setAdding(false)
  }

  return (
    <div style={styles.fileTree}>
      <div style={styles.fileTreeHeader}>
        <span style={styles.fileTreeHeaderLabel}>Files ({files.length})</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding((v) => !v)}
          style={styles.iconButton}
          title="New file"
        >+ New</button>
      </div>

      {adding && (
        <form onSubmit={submit} style={styles.newFileForm}>
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="filename.py"
            style={styles.input}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
          />
          <button type="submit" style={styles.primaryButton} disabled={!newName.trim()}>Create</button>
        </form>
      )}

      <ul style={styles.fileList}>
        {files.length === 0 && (
          <li style={styles.fileTreeEmpty}>No files yet — click "+ New" to add one.</li>
        )}
        {files.map((f) => (
          <li
            key={f.path}
            style={{
              ...styles.fileRow,
              ...(f.path === activePath ? styles.fileRowActive : {}),
            }}
          >
            <button
              type="button"
              onClick={() => onSelect(f.path)}
              style={styles.fileRowButton}
              title={`${f.path} — ${formatBytes(f.size)}`}
            >
              <span style={styles.fileName}>{f.path}</span>
              <span style={styles.fileSize}>{formatBytes(f.size)}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                // eslint-disable-next-line no-alert
                if (window.confirm(`Delete ${f.path}?`)) onDelete(f.path)
              }}
              style={styles.deleteButton}
              title="Delete"
              aria-label={`Delete ${f.path}`}
            >×</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RunPanel({ onRun, running, lastRun }) {
  const [installFirst, setInstallFirst] = useState(true)

  return (
    <div style={styles.runPanel}>
      <div style={styles.runBar}>
        <button
          type="button"
          disabled={running}
          onClick={() => onRun({ installFirst })}
          style={{ ...styles.runButton, ...(running ? styles.runButtonBusy : {}) }}
        >
          {running ? '…running' : '▶ Run'}
        </button>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={installFirst}
            onChange={(e) => setInstallFirst(e.target.checked)}
          />
          install deps first (requirements.txt)
        </label>
        {lastRun?.duration_ms != null && (
          <span style={styles.runDuration}>{Math.round(lastRun.duration_ms)} ms</span>
        )}
      </div>

      <div style={styles.runOutput}>
        {!lastRun && <div style={styles.runOutputEmpty}>Click "Run" to execute this project in an ephemeral sandbox.</div>}

        {lastRun?.pip && (
          <RunBlock title="pip install" block={lastRun.pip} />
        )}
        {lastRun?.run && (
          <RunBlock title={`python ${lastRun.entry || 'main.py'}`} block={lastRun.run} />
        )}
        {lastRun?.error && (
          <div style={styles.runError}>Error: {lastRun.error}</div>
        )}
      </div>
    </div>
  )
}

function RunBlock({ title, block }) {
  const code = Number(block?.exit_code ?? -1)
  const ok = code === 0
  return (
    <div style={styles.runBlock}>
      <div style={{ ...styles.runBlockHeader, color: ok ? '#86efac' : '#fca5a5' }}>
        {ok ? '✓' : '✗'} {title}{block?.timed_out ? ' — timed out' : ` — exit ${code}`}
      </div>
      {block?.stdout ? (
        <pre style={styles.runPre}>{block.stdout}</pre>
      ) : null}
      {block?.stderr ? (
        <pre style={{ ...styles.runPre, color: '#fca5a5' }}>{block.stderr}</pre>
      ) : null}
    </div>
  )
}

function QuotaBar({ usage }) {
  if (!usage || !usage.limits) return null
  const used = Number(usage.used_bytes ?? 0)
  const limit = Number(usage.limits.user_bytes ?? 0) || 1
  const pct = Math.min(100, Math.round((used / limit) * 100))
  return (
    <div style={styles.quotaBar} title={`${formatBytes(used)} / ${formatBytes(limit)}`}>
      <div style={{ ...styles.quotaFill, width: `${pct}%` }} />
      <span style={styles.quotaLabel}>{formatBytes(used)} / {formatBytes(limit)}</span>
    </div>
  )
}

// ---------- main component ----------

export default function KelionStudio() {
  const [workspaces, setWorkspaces] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [files, setFiles] = useState([])      // [{path, size, updated_at}]
  const [activePath, setActivePath] = useState(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState(null)
  const [usage, setUsage] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const saveTimer = useRef(null)
  const lastSavedContent = useRef('')
  const activeIdRef = useRef(null)
  const activePathRef = useRef(null)

  // Configure Monaco once, before <Editor /> mounts. Safe to call every
  // render — the setup module is internally idempotent.
  useEffect(() => { ensureMonaco() }, [])

  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { activePathRef.current = activePath }, [activePath])

  const refreshUsage = useCallback(async () => {
    try {
      const u = await getStudioUsage()
      setUsage(u)
    } catch (_) { /* usage is informational, silent on failure */ }
  }, [])

  // Initial load: list workspaces, pick the first (or create one), load files.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        let { items } = await listWorkspaces()
        if (!alive) return
        if (!items || items.length === 0) {
          // Auto-create a first workspace so the UI is never empty.
          const { workspace } = await createWorkspace('My first project')
          items = [workspace]
          // Seed it with a default main.py + requirements.txt so the
          // Run button does something useful out of the box.
          for (const f of DEFAULT_NEW_FILES) {
            // eslint-disable-next-line no-await-in-loop
            await writeFile(workspace.id, f.path, f.content)
          }
        }
        if (!alive) return
        setWorkspaces(items)
        await openWorkspace(items[0].id)
      } catch (err) {
        if (!alive) return
        toast(setToastMsg, 'error', err.message || 'Failed to load Studio')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openWorkspace = useCallback(async (id) => {
    setActiveId(id)
    setActivePath(null)
    setContent('')
    setDirty(false)
    try {
      const { workspace } = await getWorkspace(id)
      const fileList = workspace.files || []
      setFiles(fileList)
      if (fileList.length > 0) {
        // Prefer main.py when it exists, otherwise the first file.
        const pick = fileList.find((f) => f.path === 'main.py') || fileList[0]
        await selectFile(id, pick.path)
      }
      refreshUsage()
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Failed to open workspace')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUsage])

  const selectFile = useCallback(async (id, path) => {
    setActivePath(path)
    setContent('')
    setDirty(false)
    try {
      const { file } = await readFile(id, path)
      // Only apply if the user hasn't clicked another file mid-flight.
      if (activeIdRef.current === id && activePathRef.current === path) {
        setContent(file.content || '')
        lastSavedContent.current = file.content || ''
      }
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Failed to read file')
    }
  }, [])

  // Autosave on content change.
  useEffect(() => {
    if (!dirty || !activeId || !activePath) return undefined
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const id = activeId
      const path = activePath
      const text = content
      if (text === lastSavedContent.current) { setDirty(false); return }
      setSaving(true)
      try {
        const { file } = await writeFile(id, path, text)
        lastSavedContent.current = text
        setDirty(false)
        // Keep the file tree metadata in sync without a full refetch.
        setFiles((prev) => {
          const next = prev.map((f) =>
            f.path === path ? { path: file.path, size: file.size, updated_at: file.updated_at } : f
          )
          return next.find((f) => f.path === path)
            ? next
            : [...next, { path: file.path, size: file.size, updated_at: file.updated_at }]
        })
        refreshUsage()
      } catch (err) {
        toast(setToastMsg, 'error', err.message || 'Autosave failed')
      } finally {
        setSaving(false)
      }
    }, AUTOSAVE_MS)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [content, dirty, activeId, activePath, refreshUsage])

  // Ctrl/Cmd+S for immediate save.
  useEffect(() => {
    const onKey = (e) => {
      const modSave = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')
      if (!modSave) return
      e.preventDefault()
      if (!dirty || !activeId || !activePath) return
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      setSaving(true)
      writeFile(activeId, activePath, content)
        .then(({ file }) => {
          lastSavedContent.current = content
          setDirty(false)
          setFiles((prev) => prev.map((f) =>
            f.path === activePath ? { path: file.path, size: file.size, updated_at: file.updated_at } : f
          ))
          refreshUsage()
        })
        .catch((err) => toast(setToastMsg, 'error', err.message || 'Save failed'))
        .finally(() => setSaving(false))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, activeId, activePath, content, refreshUsage])

  // --- workspace actions ---

  const handleCreateWorkspace = useCallback(async () => {
    // eslint-disable-next-line no-alert
    const name = window.prompt('New project name:', `Project ${workspaces.length + 1}`)
    if (!name) return
    try {
      const { workspace } = await createWorkspace(name)
      setWorkspaces((prev) => [workspace, ...prev])
      await openWorkspace(workspace.id)
      toast(setToastMsg, 'success', `Created "${workspace.name}"`)
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Create failed')
    }
  }, [workspaces.length, openWorkspace])

  const handleRenameWorkspace = useCallback(async () => {
    if (!activeId) return
    const current = workspaces.find((w) => w.id === activeId)
    // eslint-disable-next-line no-alert
    const name = window.prompt('Rename project:', current?.name || '')
    if (!name || name === current?.name) return
    try {
      await renameWorkspace(activeId, name)
      setWorkspaces((prev) => prev.map((w) => (w.id === activeId ? { ...w, name } : w)))
      toast(setToastMsg, 'success', `Renamed to "${name}"`)
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Rename failed')
    }
  }, [activeId, workspaces])

  const handleDeleteWorkspace = useCallback(async () => {
    if (!activeId) return
    const current = workspaces.find((w) => w.id === activeId)
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete project "${current?.name}"? This cannot be undone.`)) return
    try {
      await deleteWorkspace(activeId)
      const remaining = workspaces.filter((w) => w.id !== activeId)
      setWorkspaces(remaining)
      if (remaining.length > 0) {
        await openWorkspace(remaining[0].id)
      } else {
        setActiveId(null)
        setFiles([])
        setActivePath(null)
        setContent('')
      }
      refreshUsage()
      toast(setToastMsg, 'success', 'Project deleted')
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Delete failed')
    }
  }, [activeId, workspaces, openWorkspace, refreshUsage])

  // --- file actions ---

  const handleCreateFile = useCallback(async (rawName) => {
    if (!activeId) return
    let name = String(rawName || '').trim().replace(/^\/+/, '')
    if (!name) return
    if (files.some((f) => f.path === name)) {
      toast(setToastMsg, 'error', 'File already exists')
      return
    }
    try {
      const { file } = await writeFile(activeId, name, '')
      setFiles((prev) => [...prev, { path: file.path, size: file.size, updated_at: file.updated_at }])
      setActivePath(file.path)
      setContent('')
      lastSavedContent.current = ''
      setDirty(false)
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Create failed')
    }
  }, [activeId, files])

  const handleDeleteFile = useCallback(async (path) => {
    if (!activeId) return
    try {
      await deleteFile(activeId, path)
      const remaining = files.filter((f) => f.path !== path)
      setFiles(remaining)
      if (path === activePath) {
        const next = remaining[0]
        if (next) {
          await selectFile(activeId, next.path)
        } else {
          setActivePath(null)
          setContent('')
          lastSavedContent.current = ''
        }
      }
      refreshUsage()
    } catch (err) {
      toast(setToastMsg, 'error', err.message || 'Delete failed')
    }
  }, [activeId, files, activePath, selectFile, refreshUsage])

  // --- run ---

  const handleRun = useCallback(async ({ installFirst }) => {
    if (!activeId) return
    // Flush any pending autosave before we run so the sandbox sees the
    // latest source.
    if (dirty && activePath) {
      try {
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
        await writeFile(activeId, activePath, content)
        lastSavedContent.current = content
        setDirty(false)
      } catch (err) {
        toast(setToastMsg, 'error', err.message || 'Save-before-run failed')
        return
      }
    }

    setRunning(true)
    setLastRun(null)
    try {
      // Prefer the currently-open .py file as entry; otherwise main.py.
      const entry = activePath && activePath.endsWith('.py') ? activePath : 'main.py'
      const r = await runWorkspace(activeId, { entry, installFirst })
      setLastRun(r)
    } catch (err) {
      setLastRun({ error: err.message || 'Run failed' })
    } finally {
      setRunning(false)
    }
  }, [activeId, dirty, activePath, content])

  const monacoLanguage = useMemo(() => languageForPath(activePath), [activePath])
  const savingLabel = saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <a href="/" style={styles.brandLink} title="Back to Kelion">‹ Kelion</a>
          <span style={styles.brandTitle}>Studio</span>
        </div>

        <div style={styles.toolbar}>
          <select
            value={activeId || ''}
            onChange={(e) => openWorkspace(parseInt(e.target.value, 10))}
            style={styles.select}
            disabled={loading || workspaces.length === 0}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
            {workspaces.length === 0 && <option value="">—</option>}
          </select>
          <button type="button" onClick={handleCreateWorkspace} style={styles.secondaryButton}>+ New</button>
          <button type="button" onClick={handleRenameWorkspace} style={styles.secondaryButton} disabled={!activeId}>Rename</button>
          <button type="button" onClick={handleDeleteWorkspace} style={styles.dangerButton} disabled={!activeId}>Delete</button>
          <span style={styles.saveStatus}>{savingLabel}</span>
        </div>

        <QuotaBar usage={usage} />
      </header>

      <main style={styles.main}>
        <aside style={styles.sidebar}>
          <FileTree
            files={files}
            activePath={activePath}
            onSelect={(p) => selectFile(activeId, p)}
            onCreate={handleCreateFile}
            onDelete={handleDeleteFile}
            busy={loading}
          />
        </aside>

        <section style={styles.editorColumn}>
          <div style={styles.editorHost}>
            {activePath ? (
              <Editor
                key={`${activeId}:${activePath}`}
                height="100%"
                language={monacoLanguage}
                value={content}
                onChange={(v) => { setContent(v ?? ''); setDirty(true) }}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  wordWrap: 'on',
                }}
              />
            ) : (
              <div style={styles.editorEmpty}>
                {loading ? 'Loading Studio…' : 'Pick or create a file on the left.'}
              </div>
            )}
          </div>

          <RunPanel onRun={handleRun} running={running} lastRun={lastRun} />
        </section>
      </main>

      {toastMsg && (
        <div
          role="status"
          style={{
            ...styles.toast,
            background: toastMsg.kind === 'error' ? '#3b0f1a' : '#0f2a1a',
            borderColor:  toastMsg.kind === 'error' ? '#7f1d1d' : '#166534',
            color:        toastMsg.kind === 'error' ? '#fecaca' : '#bbf7d0',
          }}
        >
          {toastMsg.text}
        </div>
      )}
    </div>
  )
}

// ---------- styles ----------

const styles = {
  page: {
    position: 'fixed',
    inset: 0,
    background: '#05060a',
    color: '#e5e7eb',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  brand: { display: 'flex', alignItems: 'baseline', gap: 10 },
  brandLink: { color: '#a78bfa', textDecoration: 'none', fontSize: 13 },
  brandTitle: { color: '#e5e7eb', fontWeight: 600, fontSize: 18, letterSpacing: '0.02em' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' },
  select: {
    background: '#0f172a',
    color: '#e5e7eb',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '6px 10px',
    minWidth: 180,
  },
  secondaryButton: {
    background: 'rgba(167,139,250,0.12)',
    color: '#e5e7eb',
    border: '1px solid rgba(167,139,250,0.3)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
  },
  dangerButton: {
    background: 'rgba(239,68,68,0.14)',
    color: '#fecaca',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
  },
  primaryButton: {
    background: '#a78bfa',
    color: '#05060a',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  iconButton: {
    background: 'transparent',
    color: '#c4b5fd',
    border: '1px solid rgba(167,139,250,0.3)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  saveStatus: {
    marginLeft: 'auto',
    color: '#94a3b8',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  quotaBar: {
    position: 'relative',
    width: 200,
    height: 18,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  quotaFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #a78bfa, #8b5cf6)',
    transition: 'width 200ms ease',
  },
  quotaLabel: {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, color: '#e5e7eb',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  },
  main: { flex: 1, display: 'flex', minHeight: 0 },
  sidebar: {
    width: 240,
    minWidth: 180,
    borderRight: '1px solid rgba(255,255,255,0.08)',
    overflow: 'auto',
    background: '#07080f',
  },
  fileTree: { display: 'flex', flexDirection: 'column', height: '100%' },
  fileTreeHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  fileTreeHeaderLabel: { fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' },
  newFileForm: { display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  input: {
    flex: 1,
    background: '#0f172a',
    color: '#e5e7eb',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 13,
  },
  fileList: { listStyle: 'none', margin: 0, padding: 0, flex: 1 },
  fileTreeEmpty: { color: '#6b7280', fontSize: 12, padding: '10px 12px' },
  fileRow: {
    display: 'flex', alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  fileRowActive: { background: 'rgba(167,139,250,0.12)' },
  fileRowButton: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'transparent',
    color: '#e5e7eb',
    border: 'none',
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
  },
  fileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 },
  fileSize: { color: '#6b7280', fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  deleteButton: {
    background: 'transparent',
    color: '#9ca3af',
    border: 'none',
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 16,
    lineHeight: 1,
  },
  editorColumn: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  editorHost: { flex: 1, minHeight: 0 },
  editorEmpty: {
    height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#6b7280', fontSize: 14,
  },
  runPanel: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    background: '#07080f',
    display: 'flex', flexDirection: 'column',
    maxHeight: '40vh',
  },
  runBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', flexWrap: 'wrap' },
  runButton: {
    background: '#34d399',
    color: '#05060a',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  runButtonBusy: { background: '#6b7280', cursor: 'wait' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' },
  runDuration: { marginLeft: 'auto', fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' },
  runOutput: {
    overflow: 'auto',
    padding: '0 12px 12px',
    flex: 1,
    minHeight: 60,
  },
  runOutputEmpty: { padding: 12, color: '#6b7280', fontSize: 12 },
  runBlock: { marginBottom: 10 },
  runBlockHeader: { fontSize: 12, padding: '6px 0', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
  runPre: {
    margin: 0,
    background: '#0b0d16',
    color: '#e5e7eb',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 12,
    padding: 10,
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.06)',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    maxHeight: '20vh',
  },
  runError: { color: '#fca5a5', fontSize: 12, padding: 10 },
  toast: {
    position: 'fixed',
    left: '50%',
    bottom: 24,
    transform: 'translateX(-50%)',
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid',
    maxWidth: '80vw',
    fontSize: 13,
    zIndex: 200,
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },
}
