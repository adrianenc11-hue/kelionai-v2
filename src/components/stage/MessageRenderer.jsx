import React, { useState } from 'react'
import ArtifactViewer from './ArtifactViewer'

/**
 * MessageRenderer — renders assistant message text with:
 *   - Detected code blocks shown as artifact cards (with preview button)
 *   - Plain text rendered with basic markdown (bold, italic, lists)
 *   - Inline code styled distinctly
 */

// Minimum lines to consider something a true artifact (not inline snippet)
const ARTIFACT_MIN_LINES = 5

/**
 * Parse a message string into segments:
 *   { type: 'text', content: string }
 *   { type: 'artifact', lang: string, code: string }
 *   { type: 'code', lang: string, code: string }   ← short snippets
 */
function parseSegments(text) {
  if (!text) return []
  const segments = []
  // Match fenced code blocks: ```lang\n...code...\n```
  const FENCE = /```([a-zA-Z0-9+\-_]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = FENCE.exec(text)) !== null) {
    // Text before this block
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    const lang = (match[1] || 'text').toLowerCase()
    const code = match[2]
    const lines = code.split('\n').length

    if (lines >= ARTIFACT_MIN_LINES) {
      segments.push({ type: 'artifact', lang, code })
    } else {
      segments.push({ type: 'code', lang, code })
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return segments
}

/**
 * Render plain text with basic markdown:
 *   **bold**, *italic*, `inline code`, bullet lists
 */
function renderText(text) {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, i) => {
    // Bullet list
    const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/)
    if (bulletMatch) {
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
          <span style={{ color: '#a78bfa', flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{renderInline(bulletMatch[1])}</span>
        </div>
      )
    }
    // Numbered list
    const numMatch = line.match(/^[\s]*(\d+)\.\s+(.+)/)
    if (numMatch) {
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
          <span style={{ color: '#a78bfa', flexShrink: 0, minWidth: 18, marginTop: 1 }}>{numMatch[1]}.</span>
          <span>{renderInline(numMatch[2])}</span>
        </div>
      )
    }
    // Heading
    const h3 = line.match(/^###\s+(.+)/)
    if (h3) return <div key={i} style={{ fontWeight: 700, fontSize: 15, color: '#ede9fe', marginTop: 8, marginBottom: 4 }}>{h3[1]}</div>
    const h2 = line.match(/^##\s+(.+)/)
    if (h2) return <div key={i} style={{ fontWeight: 700, fontSize: 16, color: '#ede9fe', marginTop: 10, marginBottom: 4 }}>{h2[1]}</div>
    const h1 = line.match(/^#\s+(.+)/)
    if (h1) return <div key={i} style={{ fontWeight: 700, fontSize: 18, color: '#ede9fe', marginTop: 12, marginBottom: 6 }}>{h1[1]}</div>

    // Empty line → spacer
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />

    return <div key={i}>{renderInline(line)}</div>
  })
}

/**
 * Render inline markdown: **bold**, *italic*, `code`
 */
function renderInline(text) {
  if (!text) return null
  // Split by inline patterns
  const parts = []
  const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0, m
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'plain', text: text.slice(last, m.index) })
    const token = m[0]
    if (token.startsWith('`')) {
      parts.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**')) {
      parts.push({ type: 'bold', text: token.slice(2, -2) })
    } else if (token.startsWith('*')) {
      parts.push({ type: 'italic', text: token.slice(1, -1) })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'plain', text: text.slice(last) })

  return parts.map((p, i) => {
    if (p.type === 'bold') return <strong key={i} style={{ color: '#ede9fe' }}>{p.text}</strong>
    if (p.type === 'italic') return <em key={i} style={{ color: '#c4b5fd' }}>{p.text}</em>
    if (p.type === 'code') return (
      <code key={i} style={{
        background: 'rgba(167,139,250,0.15)', color: '#c4b5fd',
        padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9em',
      }}>{p.text}</code>
    )
    return <span key={i}>{p.text}</span>
  })
}

const ARTIFACT_LANG_LABELS = {
  html: '🌐 HTML', svg: '🎨 SVG', jsx: '⚛ React', tsx: '⚛ React',
  js: '📜 JavaScript', javascript: '📜 JavaScript',
  ts: '📘 TypeScript', typescript: '📘 TypeScript',
  python: '🐍 Python', css: '🎨 CSS', sql: '🗄 SQL',
  json: '{ } JSON', bash: '$ Shell', shell: '$ Shell',
}

const PREVIEWABLE = ['html', 'svg']

export default function MessageRenderer({ text }) {
  const [openArtifact, setOpenArtifact] = useState(null)

  if (!text || typeof text !== 'string') {
    return <span style={{ opacity: 0.4, fontStyle: 'italic' }}>…</span>
  }

  const segments = parseSegments(text)

  return (
    <div style={{ fontSize: 14, lineHeight: 1.65, color: '#e2e8f0' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <div key={i}>
              {renderText(seg.content)}
            </div>
          )
        }

        if (seg.type === 'code') {
          // Short inline snippet
          return (
            <pre key={i} style={{
              margin: '8px 0', padding: '10px 14px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, overflow: 'auto',
              fontFamily: 'monospace', fontSize: 12,
              color: '#e2e8f0', lineHeight: 1.5,
            }}>
              <code>{seg.code}</code>
            </pre>
          )
        }

        if (seg.type === 'artifact') {
          const label = ARTIFACT_LANG_LABELS[seg.lang] || `📄 ${seg.lang}`
          const canPreview = PREVIEWABLE.includes(seg.lang)
          const lineCount = seg.code.split('\n').length

          return (
            <div key={i} style={{
              margin: '12px 0',
              background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.2)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              {/* Artifact header bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px',
                background: 'rgba(167,139,250,0.08)',
                borderBottom: '1px solid rgba(167,139,250,0.15)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#c4b5fd', flex: 1 }}>
                  {label}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.5)' }}>
                  {lineCount} linii
                </span>
                <button
                  onClick={() => setOpenArtifact({ lang: seg.lang, code: seg.code })}
                  style={{
                    padding: '3px 12px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(167,139,250,0.2)',
                    border: '1px solid rgba(167,139,250,0.35)',
                    color: '#ede9fe', fontSize: 12, fontWeight: 600,
                  }}
                >
                  {canPreview ? '▶ Preview' : 'Deschide'}
                </button>
              </div>

              {/* Code preview (first 4 lines) */}
              <pre style={{
                margin: 0, padding: '10px 14px',
                fontFamily: 'monospace', fontSize: 12,
                color: 'rgba(226,232,240,0.6)',
                lineHeight: 1.5, overflow: 'hidden',
                maxHeight: 72,
                maskImage: 'linear-gradient(to bottom, black 60%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent)',
              }}>
                {seg.code.split('\n').slice(0, 4).join('\n')}
              </pre>
            </div>
          )
        }

        return null
      })}

      {/* Artifact modal */}
      {openArtifact && (
        <ArtifactViewer
          lang={openArtifact.lang}
          code={openArtifact.code}
          onClose={() => setOpenArtifact(null)}
        />
      )}
    </div>
  )
}
