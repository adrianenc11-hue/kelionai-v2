import { useEffect, useRef } from 'react'

export default function FeaturesModal({ onClose, isAdmin }) {
  const ref = useRef(null)
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const section = (title, items) => (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', margin: '0 0 10px', borderBottom: '1px solid #e5e5e5', paddingBottom: 6 }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: '#333' }}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )

  const userFeatures = [
    'Real-time voice chat with a 3D avatar (lip-sync, facial emotions, camera awareness).',
    'Multi-model AI brain — Claude, Gemini, Llama via OpenRouter with automatic fallback if one provider fails.',
    'Live web search, weather forecasts, interactive maps, turn-by-turn navigation, and news.',
    'AI image generation from text prompts.',
    'Device control: GPS location, front/back camera switch, zoom, and screen awareness.',
    'Built-in Workspace IDE — file tree, Monaco code editor, and terminal that auto-opens when Kelion edits files or runs commands.',
    'Python sandbox (Kelion Studio) — write and run Python code in ephemeral cloud sandboxes (E2B).',
    'Long-term memory — Kelion remembers facts about you across sessions (names, preferences, projects).',
    'Self-learning agent — Kelion can generate new tools, run self-evaluation tests, auto-install dependencies, and auto-update packages.',
    'Electronics & engineering tools: SPICE circuit simulation, OCR on schematics, datasheet parsing, BOM CSV import, calibration checklists, component equivalence search, and technical translation.',
    'Web automation with Playwright — browse any website, click buttons, fill forms, and take screenshots on your behalf.',
    'Mobile apps for iOS and Android (Capacitor).',
    'Credit-based pricing with Stripe — buy minutes, get refunds, view transaction history.',
    'Wake-word activation — say "Kelion" to start a voice session hands-free.',
    'Voice cloning — train a personal voice model for the avatar.',
    'Offline voice mode — cloned-voice TTS that works without cloud credits.',
  ]

  const adminFeatures = [
    'Admin Dashboard with revenue charts, user analytics, AI-credit consumption, and payout tracking.',
    'Agent Mode — run the 25+ capability-evaluation tests, inspect agent health, and manage model routing.',
    'Credit ledger — view every top-up, consumption, and refund in real time.',
    'Visitor analytics — geographic, device, and referrer breakdowns.',
    'User management — search users, view profiles, edit allowlists, and merge duplicate accounts.',
    'Settings & configuration — Stripe keys, model defaults, feature flags, and system messages.',
    'Self-diagnosis watchdog — automatic backend health checks with email alerts on failure.',
  ]

  return (
    <div
      ref={ref}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 16, maxWidth: 720, width: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #e5e5e5' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a' }}>Kelion Features</div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
          {section('For Everyone', userFeatures)}
          {isAdmin && section('Admin Only', adminFeatures)}
          <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
            Kelion is a conversational operating system — not just a chatbot. It sees (camera), remembers (memory), builds (workspace), and learns (auto-tools).
          </div>
        </div>
      </div>
    </div>
  )
}
