// taskStatusStore.js — Reactive store for real-time task execution status.
// Displays what Kelion is doing RIGHT NOW on the user's screen:
//   tool name, file being worked on, progress 0..100%, status text.
//
// Usage:
//   import { setTaskStatus, clearTaskStatus, subscribeTaskStatus } from './taskStatusStore'
//   setTaskStatus({ tool: 'write_to_file', file: 'server/index.js', progress: 30, label: 'Scriind fișierul...' })
//   clearTaskStatus()

let _current = null
const _listeners = new Set()

function notify() {
  const snapshot = _current ? { ..._current } : null
  _listeners.forEach(fn => { try { fn(snapshot) } catch (_) {} })
}

/**
 * Set the current task status. All fields optional except `tool`.
 * @param {{ tool: string, file?: string, progress?: number, label?: string, phase?: string }} status
 */
export function setTaskStatus(status) {
  _current = {
    tool: status.tool || 'unknown',
    file: status.file || null,
    progress: typeof status.progress === 'number' ? Math.max(0, Math.min(100, status.progress)) : 0,
    label: status.label || `Rulez ${status.tool}...`,
    phase: status.phase || 'working', // 'thinking' | 'working' | 'done' | 'error'
    startedAt: _current?.tool === status.tool ? (_current.startedAt || Date.now()) : Date.now(),
  }
  notify()
}

/** Update only the progress (0..100) without changing other fields. */
export function updateTaskProgress(progress, label) {
  if (!_current) return
  _current.progress = Math.max(0, Math.min(100, progress))
  if (label) _current.label = label
  notify()
}

/** Mark the current task as done (100%) with a brief flash before clearing. */
export function completeTask(label) {
  if (!_current) return
  _current.progress = 100
  _current.phase = 'done'
  _current.label = label || 'Gata ✓'
  notify()
  // Auto-clear after 2s so the user sees the "done" state
  setTimeout(() => {
    if (_current?.phase === 'done') {
      _current = null
      notify()
    }
  }, 2000)
}

/** Mark the current task as failed. */
export function failTask(error) {
  if (!_current) return
  _current.phase = 'error'
  _current.label = error || 'Eroare ✗'
  notify()
  setTimeout(() => {
    if (_current?.phase === 'error') {
      _current = null
      notify()
    }
  }, 4000)
}

/** Clear task status immediately. */
export function clearTaskStatus() {
  _current = null
  notify()
}

/** Get current snapshot (non-reactive). */
export function getTaskStatus() {
  return _current ? { ..._current } : null
}

/**
 * Subscribe to task status changes.
 * @param {function} fn — called with the new status or null
 * @returns {function} unsubscribe
 */
export function subscribeTaskStatus(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}
