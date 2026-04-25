// Lazy Mermaid renderer for the stage monitor's `embedType: 'mermaid'`
// branch. Adrian (2026-04-25): "nu stie sa genereze scheme electronice,
// cablaje, lista de componente". This is the visual half — the model
// emits Mermaid source via the `generate_schematic` tool, monitorStore
// stores it, and this component renders an SVG.
//
// Why lazy-load: the `mermaid` package is ~600 KB minified+gzipped,
// huge for a feature most users will never trigger. Dynamic
// `import('mermaid')` keeps the main bundle slim and only pays the
// download cost the first time a schematic is opened.
//
// Rendering uses `mermaid.render()` (not `mermaid.run()`) because we
// don't want Mermaid to scan the DOM for diagrams on its own — we know
// exactly which div should hold the SVG and we control its lifetime.
//
// Errors: on parse failure (LLM emitting invalid syntax) we surface
// the exact compiler error so the user / dev can see what went wrong;
// the existing iframeBlocked-style fallback would mask the bug.

import { useEffect, useRef, useState } from 'react'

let mermaidPromise = null

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default || mod
      mermaid.initialize({
        startOnLoad: false,
        // Dark theme matches the rest of the stage monitor (#0d0b1d
        // background, violet-tinted text). `themeVariables` overrides
        // are intentionally narrow — we let Mermaid's `dark` defaults
        // do the heavy lifting and only nudge the accent so block
        // borders match the violet palette around them.
        theme: 'dark',
        themeVariables: {
          primaryColor: '#1a1230',
          primaryTextColor: '#ede9fe',
          primaryBorderColor: '#7c3aed',
          lineColor: '#a78bfa',
          textColor: '#ede9fe',
          mainBkg: '#1a1230',
          secondaryColor: '#312e81',
          tertiaryColor: '#0d0b1d',
        },
        securityLevel: 'strict',
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
      })
      return mermaid
    })
  }
  return mermaidPromise
}

let renderCounter = 0

export default function MermaidView({ code, title }) {
  const containerRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (!code) return undefined
    const renderId = `kelion-mermaid-${++renderCounter}`
    loadMermaid()
      .then(async (mermaid) => {
        if (cancelled) return
        try {
          const { svg } = await mermaid.render(renderId, code)
          if (cancelled) return
          if (containerRef.current) {
            containerRef.current.innerHTML = svg
            // Force the SVG to fill the available area without losing
            // aspect ratio — Mermaid's default `style="max-width: …"`
            // would shrink small diagrams to 100px and leave whitespace.
            const svgEl = containerRef.current.querySelector('svg')
            if (svgEl) {
              svgEl.style.width = '100%'
              svgEl.style.height = '100%'
              svgEl.style.maxWidth = '100%'
              svgEl.style.maxHeight = '100%'
              svgEl.removeAttribute('width')
              svgEl.removeAttribute('height')
            }
          }
        } catch (e) {
          if (cancelled) return
          // Surface the parse error inline so the user sees what
          // Mermaid choked on (typically an LLM-emitted syntax issue).
          // Don't throw — that would crash the whole monitor branch.
          setError((e && e.message) || 'Failed to render diagram.')
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(`Couldn't load mermaid: ${(e && e.message) || 'unknown error'}`)
      })
    return () => { cancelled = true }
  }, [code])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(ellipse at center, #1a1230 0%, #0d0b1d 70%)',
        color: '#ede9fe',
      }}
    >
      {title && (
        <div style={{
          padding: '8px 14px',
          fontSize: 12,
          fontWeight: 600,
          color: '#c4b5fd',
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          opacity: 0.85,
          borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
          flexShrink: 0,
        }}>
          {title}
        </div>
      )}
      {error ? (
        <div style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'auto',
          padding: 18,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          color: '#fecaca',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>Mermaid error</div>
          {error}
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
            overflow: 'auto',
          }}
        />
      )}
    </div>
  )
}
