// TaskStatusPanel — real-time overlay showing what Kelion is doing.
// Shows: tool name, file path, animated progress bar 0→100%, status label.
// Positioned bottom-left, floats above the chat input.

import React, { useState, useEffect, useRef } from 'react'
import { subscribeTaskStatus } from '../lib/taskStatusStore'

const PHASE_COLORS = {
  thinking: '#a78bfa',  // purple
  working:  '#60a5fa',  // blue
  done:     '#4ade80',  // green
  error:    '#f87171',  // red
}

const PHASE_ICONS = {
  thinking: '🧠',
  working:  '⚙️',
  done:     '✅',
  error:    '❌',
}

export default function TaskStatusPanel() {
  const [status, setStatus] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    const unsub = subscribeTaskStatus((s) => {
      setStatus(s)
      if (s && s.phase !== 'done' && s.phase !== 'error') {
        // Start elapsed timer
        if (!timerRef.current) {
          timerRef.current = setInterval(() => {
            setElapsed(prev => prev + 1)
          }, 1000)
        }
      } else {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        if (!s) setElapsed(0)
      }
    })
    return () => {
      unsub()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Reset elapsed when a new task starts
  useEffect(() => {
    if (status?.startedAt) {
      setElapsed(Math.round((Date.now() - status.startedAt) / 1000))
    }
  }, [status?.tool, status?.startedAt])

  if (!status) return null

  const color = PHASE_COLORS[status.phase] || PHASE_COLORS.working
  const icon = PHASE_ICONS[status.phase] || '⚙️'
  const progress = status.progress || 0
  const isDone = status.phase === 'done'
  const isError = status.phase === 'error'

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      left: 16,
      right: 'auto',
      zIndex: 9999,
      width: 360,
      maxWidth: 'calc(100vw - 32px)',
      background: 'rgba(15, 10, 30, 0.95)',
      backdropFilter: 'blur(20px)',
      border: `1px solid ${color}44`,
      borderRadius: 16,
      padding: '14px 18px',
      fontFamily: "'Inter', 'SF Pro', system-ui, sans-serif",
      color: '#ede9fe',
      boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${color}22`,
      transition: 'all 0.3s ease',
      animation: isDone ? 'taskDone 0.4s ease' : isError ? 'taskError 0.3s ease' : 'taskSlideIn 0.3s ease',
    }}>
      <style>{`
        @keyframes taskSlideIn {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes taskDone {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        @keyframes taskError {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        @keyframes progressPulse {
          0% { opacity: 0.7; }
          50% { opacity: 1; }
          100% { opacity: 0.7; }
        }
        @keyframes barStripes {
          0% { background-position: 0 0; }
          100% { background-position: 40px 0; }
        }
      `}</style>

      {/* Header: icon + tool name + elapsed */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}>
            {status.tool.replace(/_/g, ' ')}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#8b8b9e', fontVariantNumeric: 'tabular-nums' }}>
          {elapsed}s
        </span>
      </div>

      {/* File path */}
      {status.file && (
        <div style={{
          fontSize: 11,
          color: '#a78bfa',
          marginBottom: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '4px 8px',
          background: 'rgba(167, 139, 250, 0.08)',
          borderRadius: 6,
          fontFamily: "'Consolas', 'Fira Code', monospace",
        }}>
          📄 {status.file}
        </div>
      )}

      {/* Status label */}
      <div style={{
        fontSize: 12,
        color: '#c4b5fd',
        marginBottom: 10,
        animation: status.phase === 'working' ? 'progressPulse 1.5s infinite' : 'none',
      }}>
        {status.label}
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%',
        height: 8,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: isDone
            ? '#4ade80'
            : isError
              ? '#f87171'
              : `linear-gradient(90deg, ${color}, ${color}cc)`,
          borderRadius: 4,
          transition: 'width 0.4s ease',
          backgroundImage: !isDone && !isError
            ? 'linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent)'
            : 'none',
          backgroundSize: '40px 40px',
          animation: !isDone && !isError ? 'barStripes 1s linear infinite' : 'none',
        }} />
      </div>

      {/* Progress percentage */}
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: 4,
        fontSize: 10,
        color: '#6b6b7e',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {Math.round(progress)}%
      </div>
    </div>
  )
}
