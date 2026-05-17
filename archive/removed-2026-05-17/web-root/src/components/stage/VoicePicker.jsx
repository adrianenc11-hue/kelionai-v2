'use strict'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { getDetectedLang, getSelectedVoice, setSelectedVoice } from '../../lib/voiceModeStore'
import { getCsrfToken } from '../../lib/api.js'

/**
 * VoicePicker — floating button on the avatar stage that opens a dropdown
 * with available masculine ElevenLabs voices for the current language.
 * The user can preview and select a voice; it's saved server-side and
 * used for all subsequent TTS calls.
 */

export default function VoicePicker({ style }) {
  const [open, setOpen] = useState(false)
  const [voices, setVoices] = useState([])
  const [clones, setClones] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentVoiceId, setCurrentVoiceId] = useState(null)
  const [previewAudio, setPreviewAudio] = useState(null)
  const [previewingId, setPreviewingId] = useState(null)
  const dropdownRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Pause preview audio whenever the dropdown closes or on component unmount
  useEffect(() => {
    if (!open && previewAudio) {
      previewAudio.pause()
      setPreviewAudio(null)
      setPreviewingId(null)
    }
    return () => {
      if (previewAudio) previewAudio.pause()
    }
  }, [open, previewAudio])

  const fetchVoices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const lang = getDetectedLang() || 'en'
      // Fetch public voices
      const r = await fetch(`/api/voice/clone/voices?lang=${lang}`, { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        setVoices(data.voices || [])
        setCurrentVoiceId(data.currentVoiceId || getSelectedVoice()?.voiceId || null)
      } else if (r.status === 401 || r.status === 403) {
        setError('Trebuie să te autentifici pentru a alege vocea.')
      } else {
        setError('Serviciu indisponibil. Încearcă din nou.')
      }
      
      // Fetch user's clones
      const rc = await fetch('/api/voice/clone/library', { credentials: 'include' })
      if (rc.ok) {
        const cdata = await rc.json()
        setClones(cdata.clones || [])
        // If an active clone exists, that's our current voice
        const activeClone = (cdata.clones || []).find(c => c.is_active)
        if (activeClone) {
          setCurrentVoiceId(activeClone.voice_id)
        }
      }
    } catch (e) {
      console.error('[VoicePicker] fetch error:', e)
      setError('Eroare de rețea.')
    }
    setLoading(false)
  }, [])

  const handleToggle = () => {
    if (!open) fetchVoices()
    setOpen(!open)
  }

  const handleSelect = async (voice, isClone = false) => {
    const lang = getDetectedLang() || 'en'
    setCurrentVoiceId(voice.voice_id)
    setSelectedVoice({ voiceId: voice.voice_id, voiceName: voice.name || voice.display_name, lang })

    try {
      if (isClone) {
        await fetch(`/api/voice/clone/library/${voice.id}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'include',
        })
      } else {
        // Switching to public voice deactivates clones
        await fetch('/api/voice/clone/library/deactivate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'include',
        })
        await fetch('/api/voice/clone/select-voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'include',
          body: JSON.stringify({ voiceId: voice.voice_id, voiceName: voice.name, lang }),
        })
      }
    } catch (e) {
      console.error('[VoicePicker] save error:', e)
    }
    setOpen(false)
  }

  const handlePreview = (e, voice) => {
    e.stopPropagation()
    if (previewAudio) {
      previewAudio.pause()
      setPreviewAudio(null)
      if (previewingId === voice.voice_id) {
        setPreviewingId(null)
        return
      }
    }
    if (voice.preview_url) {
      const audio = new Audio(voice.preview_url)
      audio.volume = 0.7
      audio.play().catch(() => {})
      audio.onended = () => { setPreviewingId(null); setPreviewAudio(null) }
      setPreviewAudio(audio)
      setPreviewingId(voice.voice_id)
    }
  }

  // Count lang-matching voices
  const langMatches = voices.filter(v => v.langScore >= 80).length

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleToggle}
        title="Alege vocea"
        style={{
          height: 36,
          padding: '0 14px',
          borderRadius: 999,
          background: open ? 'rgba(124,58,237,0.85)' : 'rgba(10,8,20,0.5)',
          backdropFilter: 'blur(12px)',
          border: '1px solid ' + (open ? 'rgba(124,58,237,0.6)' : 'rgba(167,139,250,0.25)'),
          color: '#ede9fe',
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{ fontSize: 14 }}>🎙</span>
        <span>Voce</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          marginTop: 8,
          width: '100%',
          maxHeight: 250,
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: 8,
          padding: '8px 0',
        }}>
          {/* Clones Header */}
          {clones.length > 0 && (
            <div style={{
              padding: '10px 16px 8px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontSize: 12,
              color: '#4ade80',
              textTransform: 'uppercase',
              letterSpacing: 1,
              fontWeight: 600,
            }}>
              Vocile Mele Clonate
            </div>
          )}

          {/* Clones List */}
          {clones.map((c) => {
            const isSelected = c.voice_id === currentVoiceId
            return (
              <div
                key={c.voice_id}
                onClick={() => handleSelect(c, true)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isSelected ? 'rgba(34,197,94,0.15)' : 'transparent',
                  borderLeft: isSelected ? '3px solid #22c55e' : '3px solid transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = isSelected ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? 'rgba(34,197,94,0.15)' : 'transparent'}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#4ade80' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    👤 {c.display_name}
                    {isSelected && <span style={{ fontSize: 11, color: '#22c55e' }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                    Clonă Privată · Limba: {c.language === 'auto' ? 'Auto' : c.language}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Public Voices Header */}
          <div style={{
            padding: '10px 16px 8px',
            borderTop: clones.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginTop: clones.length > 0 ? 8 : 0,
          }}>
            {loading ? '⏳ Se încarcă...' : `Voci Publice (${langMatches} native · ${voices.length} total)`}
          </div>

          {/* Voice List */}
          {voices.map((v) => {
            const isSelected = v.voice_id === currentVoiceId
            const isLangMatch = v.langScore >= 80
            return (
              <div
                key={v.voice_id}
                onClick={() => handleSelect(v)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: isSelected ? 'rgba(124,58,237,0.2)' : 'transparent',
                  borderLeft: isSelected ? '3px solid #7c3aed' : '3px solid transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = isSelected ? 'rgba(124,58,237,0.25)' : 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? 'rgba(124,58,237,0.2)' : 'transparent'}
              >
                {/* Voice Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#a78bfa' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    {v.name}
                    {isSelected && <span style={{ fontSize: 11, color: '#7c3aed' }}>✓</span>}
                    {isLangMatch && (
                      <span style={{
                        fontSize: 9,
                        background: 'rgba(34,197,94,0.2)',
                        color: '#4ade80',
                        padding: '1px 6px',
                        borderRadius: 8,
                        fontWeight: 600,
                      }}>
                        NATIV
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.4)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {[v.language, v.accent, v.use_case, v.category].filter(Boolean).join(' · ')}
                  </div>
                </div>

                {/* Preview Button */}
                {v.preview_url && (
                  <button
                    type="button"
                    onClick={(e) => handlePreview(e, v)}
                    title="Ascultă preview"
                    style={{
                      background: previewingId === v.voice_id ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.08)',
                      border: 'none',
                      borderRadius: 8,
                      color: previewingId === v.voice_id ? '#a78bfa' : 'rgba(255,255,255,0.5)',
                      padding: '4px 8px',
                      fontSize: 14,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                    }}
                  >
                    {previewingId === v.voice_id ? '⏸' : '▶'}
                  </button>
                )}
              </div>
            )
          })}

          {voices.length === 0 && !loading && (
            <div style={{ padding: 20, textAlign: 'center', color: error ? '#f87171' : 'rgba(255,255,255,0.3)', fontSize: 13 }}>
              {error || 'Nu s-au găsit voci masculine disponibile.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
