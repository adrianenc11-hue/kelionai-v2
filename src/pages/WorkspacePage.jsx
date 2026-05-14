// Kelion Workspace — repo IDE inside the monitor overlay.
// Usage: /workspace?embed=1&file=src/main.jsx
// embed=1 hides the app chrome so it fits cleanly inside the monitor iframe.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import { useSearchParams } from 'react-router-dom'
import ensureMonaco from '../lib/monacoSetup'

function getCsrf() {
  const m = document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function execTool(name, args) {
  const r = await fetch('/api/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
    credentials: 'include',
    body: JSON.stringify({ name, args: args || {} }),
  })
  return r.json().catch(() => ({ ok: false, error: 'Invalid JSON' }))
}

function languageForPath(p) {
  if (/\.jsx?$/i.test(p)) return 'javascript'
  if (/\.tsx?$/i.test(p)) return 'typescript'
  if (/\.html?$/i.test(p)) return 'html'
  if (/\.css$/i.test(p)) return 'css'
  if (/\.json$/i.test(p)) return 'json'
  if (/\.py$/i.test(p)) return 'python'
  if (/\.md$/i.test(p)) return 'markdown'
  return 'plaintext'
}

export default function WorkspacePage() {
  const [params] = useSearchParams()
  const embed = params.get('embed') === '1'
  const initialFile = params.get('file') || ''

  const [files, setFiles] = useState([])
  const [activePath, setActivePath] = useState(initialFile)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [termOpen, setTermOpen] = useState(true)
  const [termLines, setTermLines] = useState([{ t: 'info', text: 'Terminal ready.' }])
  const [termBusy, setTermBusy] = useState(false)
  const editorRef = useRef(null)
  const termEndRef = useRef(null)

  const refreshFiles = useCallback(async () => {
    const r = await execTool('list_local_files', {})
    if (Array.isArray(r.files)) setFiles(r.files)
    else if (Array.isArray(r)) setFiles(r)
  }, [])

  useEffect(() => { refreshFiles() }, [refreshFiles])

  const openFile = useCallback(async (path) => {
    if (dirty) {
      const ok = window.confirm('Ai modificări nesalvate. Continui fără salvare?')
      if (!ok) return
    }
    setLoading(true)
    const r = await execTool('read_local_file', { path })
    setContent(typeof r.content === 'string' ? r.content : r.text || r.stdout || '')
    setActivePath(path)
    setDirty(false)
    setLoading(false)
  }, [dirty])

  useEffect(() => {
    if (initialFile && files.length) openFile(initialFile)
  }, [initialFile, files, openFile])

  const saveFile = useCallback(async () => {
    if (!activePath) return
    const r = await execTool('edit_local_file', { path: activePath, content })
    const ok = r.ok !== false && !r.error
    setDirty(false)
    setTermLines(prev => [...prev, { t: ok ? 'ok' : 'err', text: ok ? `✓ Saved ${activePath}` : `✗ Save failed: ${r.error || ''}` }])
    refreshFiles()
  }, [activePath, content, refreshFiles])

  const runCommand = useCallback(async (cmd) => {
    if (!cmd.trim() || termBusy) return
    setTermBusy(true)
    setTermLines(prev => [...prev, { t: 'cmd', text: `$ ${cmd}` }])
    const r = await execTool('run_terminal_command', { command: cmd })
    const out = r.stdout || r.text || ''
    const err = r.stderr || r.error || ''
    if (out) setTermLines(prev => [...prev, { t: 'out', text: out }])
    if (err) setTermLines(prev => [...prev, { t: 'err', text: err }])
    setTermBusy(false)
    setTimeout(() => termEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [termBusy])

  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [termLines])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      {!embed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid #21262d', background: '#161b22' }}>
          <span style={{ fontWeight: 700, color: '#58a6ff' }}>Kelion Workspace</span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{activePath || 'Niciun fișier'}</span>
          <button onClick={refreshFiles} style={{ marginLeft: 'auto', background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Refresh</button>
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{ width: 220, borderRight: '1px solid #21262d', overflowY: 'auto', padding: 8, fontSize: 13, flexShrink: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 8 }}>Files</div>
          {files.map(f => (
            <div key={f} onClick={() => openFile(f)} style={{
              padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
              background: activePath === f ? '#1f6feb' : 'transparent',
              color: activePath === f ? '#fff' : '#c9d1d9',
            }}>{f}</div>
          ))}
          {files.length === 0 && <div style={{ opacity: 0.4, fontSize: 12, padding: 8 }}>Niciun fișier</div>}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderBottom: '1px solid #21262d', background: '#161b22' }}>
            <span style={{ fontSize: 12, opacity: 0.8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePath || 'Selectează un fișier'}</span>
            {dirty && <span style={{ fontSize: 11, color: '#f0883e' }}>● modificat</span>}
            <button onClick={saveFile} disabled={!activePath || !dirty} style={{ background: '#238636', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer', opacity: !activePath || !dirty ? 0.5 : 1 }}>Save</button>
            <button onClick={() => setTermOpen(v => !v)} style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>{termOpen ? 'Hide Term' : 'Show Term'}</button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activePath ? (
              <Editor
                theme="vs-dark"
                language={languageForPath(activePath)}
                value={content}
                onChange={v => { setContent(v || ''); setDirty(true) }}
                onMount={ed => { editorRef.current = ed; ensureMonaco() }}
                options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', automaticLayout: true }}
                loading={<div style={{ color: '#8b949e', padding: 20 }}>Loading editor…</div>}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58' }}>Selectează un fișier din sidebar</div>
            )}
          </div>

          {/* Terminal */}
          {termOpen && (
            <div style={{ height: 160, borderTop: '1px solid #21262d', background: '#0d1117', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.5 }}>
                {termLines.map((l, i) => (
                  <div key={i} style={{ color: l.t === 'err' ? '#f85149' : l.t === 'ok' ? '#3fb950' : l.t === 'cmd' ? '#58a6ff' : '#8b949e', whiteSpace: 'pre-wrap' }}>{l.text}</div>
                ))}
                <div ref={termEndRef} />
              </div>
              <form onSubmit={e => { e.preventDefault(); runCommand(e.target.cmd.value); e.target.cmd.value = '' }} style={{ display: 'flex', borderTop: '1px solid #21262d' }}>
                <span style={{ padding: '6px 10px', color: '#58a6ff', fontFamily: 'Consolas, monospace', fontSize: 12 }}>$</span>
                <input name="cmd" autoComplete="off" disabled={termBusy} placeholder="Comandă…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#c9d1d9', fontFamily: 'Consolas, monospace', fontSize: 12 }} />
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
