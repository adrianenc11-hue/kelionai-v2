// Admin Settings page — system configuration overview.
// Shows environment info, API key status (masked), and admin actions.

import { useState, useEffect } from 'react'
import { useToast } from './AdminComponents'

export default function SettingsPage() {
  const toast = useToast()
  const [info, setInfo] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        // Diag endpoint returns environment info for admins
        const r = await fetch('/api/admin/health', { credentials: 'include' })
        if (r.ok) setInfo(await r.json())
      } catch (_) {}
    })()
  }, [])

  const envRows = [
    { label: 'Mediu', value: info?.env || 'production' },
    { label: 'Versiune Node', value: info?.nodeVersion || '—' },
    { label: 'Uptime', value: info?.uptimeSeconds ? `${Math.floor(info.uptimeSeconds / 3600)}h ${Math.floor((info.uptimeSeconds % 3600) / 60)}m` : '—' },
    { label: 'Memorie RSS', value: info?.memoryMB ? `${info.memoryMB} MB` : '—' },
    { label: 'Bază de date', value: info?.dbConnected ? '✅ Conectată' : '❌ Deconectată' },
  ]

  const keyRows = [
    { label: 'OPENROUTER_API_KEY', status: info?.keys?.openrouter || 'unknown' },
    { label: 'GOOGLE_API_KEY', status: info?.keys?.google || 'unknown' },
    { label: 'STRIPE_SECRET_KEY', status: info?.keys?.stripe || 'unknown' },
    { label: 'ELEVENLABS_API_KEY', status: info?.keys?.elevenlabs || 'unknown' },
  ]

  return (
    <div>
      <div className="admin-card">
        <div className="admin-card-title" style={{ marginBottom: 16 }}>🖥️ Informații Sistem</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          {envRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <span style={{ color: 'var(--admin-text-dim)' }}>{r.label}</span>
              <span style={{ fontWeight: 500 }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-title" style={{ marginBottom: 16 }}>🔑 Chei API (status)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keyRows.map((r) => (
            <div key={r.label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'var(--admin-surface-2)',
              borderRadius: 8,
              border: '1px solid var(--admin-border)',
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.label}</span>
              <span className={`admin-badge ${r.status === 'set' ? 'green' : r.status === 'missing' ? 'red' : 'amber'}`}>
                {r.status === 'set' ? 'Setată' : r.status === 'missing' ? 'Lipsă' : 'Necunoscut'}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--admin-text-dim)', lineHeight: 1.6 }}>
          💡 Cheile nu sunt afișate din motive de securitate. Modificarea se face din variabilele de mediu Railway.
        </div>
      </div>

      <WhatsAppBridgeCard toast={toast} />

      <div className="admin-card">
        <div className="admin-card-title" style={{ marginBottom: 16 }}>📥 Export Date</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ExportBtn label="Export Utilizatori CSV" path="/api/admin/export/users.csv" />
          <ExportBtn label="Export Tranzacții CSV" path="/api/admin/export/transactions.csv" />
        </div>
      </div>
    </div>
  )
}

function WhatsAppBridgeCard({ toast }) {
  const [waStatus, setWaStatus] = useState('checking')
  const [qrCode, setQrCode] = useState(null)
  const [stats, setStats] = useState(null)

  const fetchStatus = async () => {
    try {
      const r = await fetch('/api/whatsapp/status', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setWaStatus(data.status)
        setQrCode(data.qrCode)
        setStats(data.stats)
      }
    } catch (_) {}
  }

  useEffect(() => {
    fetchStatus()
    // Poll status if pending QR
    const iv = setInterval(() => {
      fetchStatus()
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const handleConnect = async () => {
    setWaStatus('connecting...')
    try {
      const r = await fetch('/api/whatsapp/connect', { method: 'POST', credentials: 'include' })
      const data = await r.json()
      if (r.ok) {
        toast.info(`WhatsApp: ${data.message}`)
        fetchStatus()
      } else {
        toast.error(`Eroare: ${data.error}`)
      }
    } catch (e) {
      toast.error('Eroare rețea')
    }
  }

  const handleDisconnect = async () => {
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST', credentials: 'include' })
      toast.info('Sesiune WhatsApp ștearsă')
      fetchStatus()
    } catch (_) {}
  }

  return (
    <div className="admin-card">
      <div className="admin-card-title" style={{ marginBottom: 16 }}>📱 WhatsApp Bridge</div>
      <div style={{ fontSize: 13, marginBottom: 16, color: 'var(--admin-text-dim)' }}>
        Conectează Kelion la WhatsApp prin scanarea codului QR. Kelion va răspunde în chat-uri private și grupuri atunci când este menționat și va funcționa ca translator automat.
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span className={`admin-badge ${waStatus === 'ready' ? 'green' : waStatus === 'error' ? 'red' : 'amber'}`}>
          Status: {waStatus}
        </span>
        {waStatus === 'ready' && stats && (
          <span style={{ fontSize: 12, color: 'var(--admin-text-dim)' }}>
            Mesaje: {stats.messagesReceived} | Răspunsuri: {stats.responseSent}
          </span>
        )}
      </div>

      {qrCode && waStatus === 'qr_pending' && (
        <div style={{ marginBottom: 16, background: 'white', padding: 12, borderRadius: 8, display: 'inline-block' }}>
          <img src={qrCode} alt="WhatsApp QR Code" style={{ width: 250, height: 250 }} />
          <div style={{ color: '#000', fontSize: 12, textAlign: 'center', marginTop: 8, fontWeight: 500 }}>
            Scanează din WhatsApp → Linked Devices
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {waStatus !== 'ready' && waStatus !== 'qr_pending' && (
          <button className="admin-btn" style={{ background: 'var(--admin-green)', color: 'white', border: 'none' }} onClick={handleConnect}>
            🔗 Generează QR / Conectează
          </button>
        )}
        {(waStatus === 'ready' || waStatus === 'qr_pending') && (
          <button className="admin-btn" style={{ background: 'var(--admin-red)', color: 'white', border: 'none' }} onClick={handleDisconnect}>
            🛑 Deconectează
          </button>
        )}
      </div>
    </div>
  )
}

function ExportBtn({ label, path }) {
  return (
    <button
      className="admin-btn"
      onClick={() => { const a = document.createElement('a'); a.href = path; a.download = ''; a.click() }}
    >
      📥 {label}
    </button>
  )
}
