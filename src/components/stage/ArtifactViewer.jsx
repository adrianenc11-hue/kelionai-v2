import React, { useState, useRef, useEffect } from 'react'

/**
 * ArtifactViewer — renders a code block as a live artifact.
 * Supports: html, svg, jsx (static), and generic code with syntax highlight.
 *
 * Props:
 *   lang    – detected language string (html, svg, jsx, js, css, python, etc.)
 *   code    – raw code string
 *   onClose – () => void
 */

const LANG_COLORS = {
  html: '#f97316', svg: '#8b5cf6', jsx: '#38bdf8', tsx: '#38bdf8',
  js: '#facc15', javascript: '#facc15', ts: '#60a5fa', typescript: '#60a5fa',
  python: '#4ade80', css: '#f472b6', sql: '#fb923c', json: '#a3e635',
  bash: '#94a3b8', shell: '#94a3b8',
}

const PREVIEWABLE = ['html', 'svg']

function buildHtmlDoc(lang, code) {
  if (lang === 'svg') {
    return `<!DOCTYPE html><html><body style="margin:0;background:#0f0f1a;display:flex;align-items:center;justify-content:center;min-height:100vh">${code}</body></html>`
  }
  // For html — if it's a full doc use as-is, else wrap
  if (code.includes('<html') || code.includes('<!DOCTYPE')) return code
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 16px; font-family: system-ui, sans-serif; background: #fff; color: #1a1a1a; }
</style>
</head>
<body>${code}</body>
</html>`
}

export default function ArtifactViewer({ lang, code, onClose }) {
  const [tab, setTab] = useState(PREVIEWABLE.includes(lang) ? 'preview' : 'code')
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef(null)

  // Inject content into iframe
  useEffect(() => {
    if (tab !== 'preview' || !iframeRef.current) return
    const doc = iframeRef.current.contentDocument
    if (!doc) return
    doc.open()
    doc.write(buildHtmlDoc(lang, code))
    doc.close()
  }, [tab, lang, code])

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const color = LANG_COLORS[lang] || '#94a3b8'
  const canPreview = PREVIEWABLE.includes(lang)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: 'min(900px, 96vw)', height: 'min(620px, 92vh)',
        background: '#0f0f1a',
        border: '1px solid rgba(167,139,250,0.2)',
        borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
          flexShrink: 0,
        }}>
          {/* Lang badge */}
          <span style={{
            padding: '2px 10px', borderRadius: 99,
            background: `${color}22`, color, fontSize: 11,
            fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            border: `1px solid ${color}44`,
          }}>{lang}</span>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
            {canPreview && (
              <button onClick={() => setTab('preview')} style={{
                padding: '3px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                background: tab === 'preview' ? 'rgba(167,139,250,0.2)' : 'transparent',
                border: tab === 'preview' ? '1px solid rgba(167,139,250,0.4)' : '1px solid transparent',
                color: tab === 'preview' ? '#ede9fe' : 'rgba(237,233,254,0.5)',
              }}>▶ Preview</button>
            )}
            <button onClick={() => setTab('code')} style={{
              padding: '3px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: tab === 'code' ? 'rgba(167,139,250,0.2)' : 'transparent',
              border: tab === 'code' ? '1px solid rgba(167,139,250,0.4)' : '1px solid transparent',
              color: tab === 'code' ? '#ede9fe' : 'rgba(237,233,254,0.5)',
            }}>{'</>'}  Cod</button>
          </div>

          <div style={{ flex: 1 }} />

          {/* Copy button */}
          <button onClick={handleCopy} style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
            border: copied ? '1px solid rgba(74,222,128,0.4)' : '1px solid rgba(255,255,255,0.1)',
            color: copied ? '#4ade80' : 'rgba(237,233,254,0.7)',
          }}>{copied ? '✓ Copiat' : 'Copiază'}</button>

          {/* Close */}
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(237,233,254,0.7)', fontSize: 16, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Preview tab */}
          {tab === 'preview' && (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              title="artifact-preview"
            />
          )}

          {/* Code tab */}
          {tab === 'code' && (
            <pre style={{
              margin: 0, padding: '20px 24px',
              overflowY: 'auto', height: '100%',
              fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontSize: 13, lineHeight: 1.65,
              color: '#e2e8f0',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              boxSizing: 'border-box',
            }}>
              <code>{code}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
