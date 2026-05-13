import { useState, useRef, useEffect } from 'react'
import { subscribeMonitor, handleShowOnMonitor, EXTERNAL_ONLY_HOSTS } from '../../lib/monitorStore'

export function externalCardCopy(m) {
  const title = (m && m.title) || 'External app'
  const src = (m && m.src) || ''
  let host = ''
  try { host = new URL(src).hostname.toLowerCase() } catch { /* ignore */ }


  // WebVM / CheerpX / JSLinux / v86 — these *legitimately* need cross-
  // origin isolation and we cannot render them in-app. Keep the specific
  // explanation so the user knows this is a browser-platform limit.
  // Host list comes from monitorStore.EXTERNAL_ONLY_HOSTS so routing
  // (which hosts get `embedType:'external'`) and display (which hosts
  // get this cross-origin card copy) stay in sync automatically.
  if (EXTERNAL_ONLY_HOSTS.has(host)) {
    return {
      icon: '🖥️',
      headline: `${title} needs its own tab`,
      body: 'This Linux-in-the-browser requires cross-origin isolation that the embedded frame cannot provide. Open it in a new tab — files persist in your browser.',
      ctaLabel: `Open ${title} in new tab`,
    }
  }

  // Everything else that landed on the external card — usually sites
  // that send `X-Frame-Options: DENY` (Google/Facebook/etc.) and would
  // otherwise paint an empty gray box.
  const hostLabel = host.replace(/^www\./, '') || title
  return {
    icon: '🔗',
    headline: title,
    body: `${hostLabel} blocks being embedded in another page, so it can\'t render here. Open it in a new tab to use it.`,
    ctaLabel: `Open ${hostLabel} in new tab`,
  }
}

// MonitorOverlay — half-page 2D panel that renders whatever `monitorStore`
// currently holds. Anchored to the left 50vw of the viewport on desktop, or
// as a bottom sheet (100vw × 55vh) on narrow screens so the avatar — which
// sits on the right half of the stage — always stays visible and can keep
// talking / listening while the content is on screen. Hidden entirely when
// there is nothing to display.
// Below this viewport width we flip the overlay to a bottom-sheet
// layout. Previously this was 900px which flipped plenty of desktop
// windows (split-screen, devtools docked) into the mobile layout
// and the sheet could end up behind the chat composer. 640px keeps
// the side-by-side layout on every realistic desktop workflow and
// only drops to the bottom sheet on narrow phones / tablets.
const MONITOR_NARROW_BREAKPOINT = 640

// Iframe wrapper that detects silent CSP/X-Frame-Options blocks. If
// `onload` never fires within `MONITOR_LOAD_TIMEOUT_MS`, we assume the
// target refused the frame and call `onBlocked` so the parent can swap
// in a fallback card. Also forwards real `onerror` events.
const MONITOR_LOAD_TIMEOUT_MS = 6000

function IframeWithFallback({ src, title, onBlocked }) {
  const loadedRef = useRef(false)
  useEffect(() => {
    loadedRef.current = false
    const timer = setTimeout(() => {
      if (!loadedRef.current) {
        try { onBlocked && onBlocked() } catch (_) { }
      }
    }, MONITOR_LOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [src, onBlocked])
  return (
    <iframe
      src={src}
      title={title}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-top-navigation-by-user-activation"
      allow="fullscreen; geolocation; autoplay; encrypted-media"
      onLoad={() => { loadedRef.current = true }}
      onError={() => { try { onBlocked && onBlocked() } catch (_) { } }}
      style={{ width: '100%', height: '100%', border: 'none', background: '#0d0b1d', display: 'block' }}
    />
  )
}

function MonitorOverlay() {
  const [m, setM] = useState({ kind: null, src: null, title: null, embedType: 'iframe', updatedAt: 0 })
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth < MONITOR_NARROW_BREAKPOINT
  ))
  // Audit #5: iframes can be silently refused by the target's CSP /
  // X-Frame-Options without firing onError. We start a load timer
  // whenever `m.src` changes and, if `onLoad` hasn't fired within the
  // budget, flip into a fallback card with "Open in new tab". Also
  // shows the fallback if the iframe throws (rare, but some hosts
  // emit `onError` for network-level blocks).
  const [iframeBlocked, setIframeBlocked] = useState(false)

  // Prevent infinite recursive iframes (Droste effect) gracefully
  // If this window was spawned with ?kelion_nested=1, it means we are already
  // inside the monitor. We must NEVER render another monitor inside ourselves.
  const isNested = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('kelion_nested')

  useEffect(() => {
    if (!isNested) {
      subscribeMonitor((s) => setM({ ...s }))
    }
  }, [isNested])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => setIsNarrow(window.innerWidth < MONITOR_NARROW_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Reset the "blocked" flag every time the monitor payload changes.
  useEffect(() => { setIframeBlocked(false) }, [m.src, m.updatedAt])

  if (!m.src || isNested) return null

  let finalSrc = m.src
  try {
    // If the AI tries to load kelionai.app (directly or via proxy), append a flag
    // so the nested app knows it's a child and doesn't render another monitor.
    let targetUrlStr = m.src
    // Handle relative proxy URLs
    if (m.src.startsWith('/api/proxy')) {
      const searchParams = new URLSearchParams(m.src.split('?')[1])
      if (searchParams.has('url')) {
        targetUrlStr = searchParams.get('url')
      }
    }

    const urlObj = new URL(targetUrlStr, window.location.href)
    const targetHost = urlObj.hostname.replace(/^www\./, '').toLowerCase()
    const currentHost = window.location.hostname.replace(/^www\./, '').toLowerCase()
    
    if (targetHost === currentHost || targetHost === 'localhost') {
      // Append kelion_nested=1 to the actual URL
      urlObj.searchParams.set('kelion_nested', '1')
      
      if (m.src.startsWith('/api/proxy')) {
        // Reconstruct the proxy URL and add kelion_nested=1 to the top-level
        // so that `window.location.search` inside the iframe detects it
        const proxyUrl = new URL(m.src, window.location.href)
        proxyUrl.searchParams.set('url', urlObj.toString())
        proxyUrl.searchParams.set('kelion_nested', '1')
        finalSrc = proxyUrl.pathname + proxyUrl.search
      } else {
        finalSrc = urlObj.toString()
      }
    }
  } catch (e) {
    // Ignore invalid URLs
  }

  const isImage = m.embedType === 'image'
  const isExternal = m.embedType === 'external'
  const isAudio = m.embedType === 'audio'
  const isHtml = m.embedType === 'html'
  const isVideo = m.embedType === 'video'
  const externalCopy = isExternal ? externalCardCopy(m) : null
  const onClose = (e) => {
    e.stopPropagation()
    handleShowOnMonitor({ kind: 'clear' })
  }

  const desktopStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  }
  const mobileStyle = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        ...(isNarrow ? mobileStyle : desktopStyle),
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10, 8, 20, 0.96)',
        backdropFilter: 'blur(14px)',
        borderRight: isNarrow ? 'none' : '1px solid rgba(167, 139, 250, 0.28)',
        borderBottom: isNarrow ? '1px solid rgba(167, 139, 250, 0.28)' : 'none',
        boxShadow: '0 0 40px rgba(0,0,0,0.55)',
        color: '#ede9fe',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(167, 139, 250, 0.18)',
          background: 'rgba(17, 12, 38, 0.7)',
          flex: '0 0 auto',
        }}
      >
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.3,
          color: '#c4b5fd',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {m.title || 'Monitor'}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close monitor"
          style={{
            appearance: 'none',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            background: 'rgba(124, 58, 237, 0.18)',
            color: '#ede9fe',
            width: 32,
            height: 32,
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, background: '#0d0b1d' }}>
        {isHtml ? (
          <iframe
            title={m.title || 'Kelion — Demonstrație'}
            sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation"
            style={{ width: '100%', height: '100%', border: 'none', background: '#0d0b1d', display: 'block' }}
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/autoloader/prism-autoloader.min.js"><\/script>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>

<style>
  ${(m.kind === 'map' || m.kind === 'route' || (m.kind === 'html' && m.src && (m.src.includes('L.map') || m.src.includes('leaflet')))) ? `
  body { margin: 0; padding: 0; background: #0d0b1d; overflow: hidden; }
  ` : `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0d0b1d; color: #ede9fe;
    padding: 24px 28px; line-height: 1.7; font-size: 15px;
    overflow-y: auto;
  }
  h1, h2, h3 { color: #c4b5fd; margin: 18px 0 10px; }
  h1 { font-size: 22px; border-bottom: 2px solid rgba(167,139,250,0.3); padding-bottom: 8px; }
  h2 { font-size: 18px; } h3 { font-size: 16px; }
  p { margin: 8px 0; }
  ol, ul { padding-left: 24px; margin: 10px 0; } li { margin: 6px 0; }
  .step { background: rgba(124,58,237,0.12); border-left: 3px solid #7c3aed; padding: 12px 16px; margin: 12px 0; border-radius: 0 8px 8px 0; }
  .step-num { color: #a78bfa; font-weight: 700; font-size: 13px; text-transform: uppercase; margin-bottom: 4px; }
  .result { background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.4); padding: 14px 18px; border-radius: 10px; margin: 16px 0; font-weight: 600; font-size: 17px; text-align: center; color: #86efac; }
  .formula { background: rgba(167,139,250,0.1); padding: 8px 14px; border-radius: 6px; font-size: 17px; text-align: center; margin: 10px 0; }
  .katex { color: #e2d9f3; }
  .katex-display { margin: 16px 0; }
  code { background: rgba(167,139,250,0.15); padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  th, td { border: 1px solid rgba(167,139,250,0.25); padding: 8px 12px; text-align: left; }
  th { background: rgba(124,58,237,0.2); color: #c4b5fd; }
  canvas { max-width: 100%; border-radius: 12px; }
  .chart-container { background: rgba(255,255,255,0.03); border: 1px solid rgba(167,139,250,0.15); border-radius: 12px; padding: 16px; margin: 16px 0; }
  `}
<\/style><\/head><body>${m.src}
<script>
  // Auto-render KaTeX: $...$ inline, $$...$$ block
  if (window.renderMathInElement) {
    renderMathInElement(document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\\\(', right: '\\\\)', display: false},
        {left: '\\\\[', right: '\\\\]', display: true}
      ],
      throwOnError: false
    });
  }
  // Auto-render Mermaid diagrams: <div class="mermaid">...</div>
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'dark',
      themeVariables: { darkMode: true, background: '#0d0b1d', primaryColor: '#7c3aed',
        primaryTextColor: '#ede9fe', lineColor: '#a78bfa', fontSize: '14px' }
    });
  }
  // Prism code highlighting runs automatically via autoloader
<\/script><\/body><\/html>`}
          />



        ) : isVideo ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: '#000',
          }}>
            <video
              src={finalSrc}
              controls
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', maxHeight: '100%', outline: 'none', background: '#000' }}
              onError={() => {
                try { console.warn('[monitor] video failed to load', finalSrc) } catch (_) {}
              }}
            >
              <source src={finalSrc} />
              Your browser does not support video playback.
            </video>
          </div>
        ) : isImage ? (
          <img
            src={finalSrc}
            alt={m.title || 'Monitor content'}
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#0d0b1d' }}
          />
        ) : isAudio ? (
          // Faza A — live radio / streaming audio playback. Renders a
          // dedicated card with an HTML5 <audio> element + station
          // label. Browsers can play .mp3/.aac/.ogg/.opus natively;
          // .m3u8 (HLS) is supported on Safari natively and on
          // Chromium via the URL — for the long tail we let the
          // <audio> element fail gracefully (the user can open the
          // homepage from the link below). Autoplay policy: most
          // browsers allow it once the user has interacted with the
          // tab (which they did to ask for radio in the first place);
          // we set `autoPlay` and rely on that gesture.
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 22,
              padding: 24,
              textAlign: 'center',
              color: '#ede9fe',
              background: 'radial-gradient(ellipse at center, #1a1230 0%, #0d0b1d 70%)',
            }}
          >
            <div style={{ fontSize: 56, lineHeight: 1 }} aria-hidden>📻</div>
            <div style={{
              fontSize: 16,
              fontWeight: 700,
              color: '#c4b5fd',
              maxWidth: 360,
              wordBreak: 'break-word',
            }}>
              {m.title || 'Live audio'}
            </div>
            <audio
              src={finalSrc}
              controls
              autoPlay
              preload="auto"
              style={{
                width: '100%',
                maxWidth: 420,
                outline: 'none',
              }}
              onError={() => {
                try { console.warn('[monitor] audio element failed to play', finalSrc) } catch (_) {}
              }}
            >
              Your browser does not support the audio element.
            </audio>
            <a
              href={finalSrc}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                opacity: 0.6,
                color: '#c4b5fd',
                textDecoration: 'underline',
                wordBreak: 'break-all',
                maxWidth: 380,
              }}
            >
              Open stream URL ↗
            </a>
          </div>
        ) : isExternal ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              padding: 24,
              textAlign: 'center',
              color: '#ede9fe',
              background: 'radial-gradient(ellipse at center, #1a1230 0%, #0d0b1d 70%)',
            }}
          >
            <div style={{ fontSize: 40, lineHeight: 1 }}>{externalCopy.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#c4b5fd', maxWidth: 360 }}>
              {externalCopy.headline}
            </div>
            <div style={{ fontSize: 13, opacity: 0.75, maxWidth: 360, lineHeight: 1.5 }}>
              {externalCopy.body}
            </div>
            <a
              href={m.src}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                appearance: 'none',
                textDecoration: 'none',
                border: '1px solid rgba(167, 139, 250, 0.55)',
                background: 'rgba(124, 58, 237, 0.28)',
                color: '#ede9fe',
                padding: '10px 20px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: 0.2,
              }}
            >
              {externalCopy.ctaLabel} ↗
            </a>
          </div>
        ) : iframeBlocked ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              padding: 24,
              textAlign: 'center',
              color: '#ede9fe',
              background: 'radial-gradient(ellipse at center, #1a1230 0%, #0d0b1d 70%)',
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1 }}>🔒</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#c4b5fd', maxWidth: 360 }}>
              This site refused to embed
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 340, lineHeight: 1.5 }}>
              Its Content-Security-Policy (X-Frame-Options) blocks iframes. Open it in a new tab instead.
            </div>
            <a
              href={m.src}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                border: '1px solid rgba(167, 139, 250, 0.55)',
                background: 'rgba(124, 58, 237, 0.28)',
                color: '#ede9fe',
                padding: '9px 18px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
            >
              Open in new tab ↗
            </a>
          </div>
        ) : (
          <IframeWithFallback
            src={finalSrc}
            title={m.title || 'Kelion monitor'}
            onBlocked={() => {
              try { console.warn('[monitor] iframe never loaded — likely CSP/XFO block', finalSrc) } catch (_) {}
              setIframeBlocked(true)
            }}
          />
        )}
      </div>
    </div>
  )
}

export default MonitorOverlay
