// taskStatusStore.js — Reactive store for real-time task execution status.
// Displays what Kelion is doing RIGHT NOW on the user's screen:
//   tool name, file being worked on, progress 0..100%, status text.
// Also pushes every action to the MONITOR (liveTerminal) so the user
// sees a live log of everything Kelion does.

import { showTerminal, postLine, postDone } from './liveTerminal'

let _current = null
let _monitorOpen = false   // tracks if we've already opened the terminal
let _lastTool = null       // dedup monitor opens
const _listeners = new Set()

function notify() {
  const snapshot = _current ? { ..._current } : null
  _listeners.forEach(fn => { try { fn(snapshot) } catch (_) {} })
}

/**
 * Set the current task status. All fields optional except `tool`.
 * Also pushes to the monitor live terminal.
 */
export function setTaskStatus(status) {
  _current = {
    tool: status.tool || 'unknown',
    file: status.file || null,
    progress: typeof status.progress === 'number' ? Math.max(0, Math.min(100, status.progress)) : 0,
    label: status.label || `Rulez ${status.tool}...`,
    phase: status.phase || 'working',
    startedAt: _current?.tool === status.tool ? (_current.startedAt || Date.now()) : Date.now(),
  }
  notify()

  // ── Push to Monitor ──
  const toolName = status.tool || 'unknown'
  if (!_monitorOpen || _lastTool !== toolName) {
    // Open a fresh terminal on the monitor for this task
    showTerminal('kelion-live', `Kelion lucrează...`)
    _monitorOpen = true
    _lastTool = toolName
    // Small delay so iframe mounts
    setTimeout(() => {
      postLine('stdout', `⚙️  ${toolName.replace(/_/g, ' ').toUpperCase()}`)
      if (status.file) postLine('stdout', `   📄 ${status.file}`)
      if (status.label) postLine('stdout', `   ${status.label}`)
    }, 200)
  } else {
    // Just append a line to the existing terminal
    const prefix = status.phase === 'error' ? '❌' : status.phase === 'done' ? '✅' : '▶'
    const line = `${prefix}  ${toolName.replace(/_/g, ' ')}${status.file ? '  📄 ' + status.file : ''}  [${status.progress || 0}%]`
    postLine(status.phase === 'error' ? 'stderr' : 'stdout', line)
  }
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
  // Show done on monitor
  postLine('stdout', `✅  ${label || 'Gata'}`)
  postDone(true, 0)
  _monitorOpen = false
  _lastTool = null
  // Auto-clear after 2s
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
  // Show error on monitor
  postLine('stderr', `❌  ${error || 'Eroare'}`)
  postDone(false, 1)
  _monitorOpen = false
  _lastTool = null
  setTimeout(() => {
    if (_current?.phase === 'error') {
      _current = null
      notify()
    }
  }, 4000)
}

/** Clear task status immediately. */
export function clearTaskStatus() {
  if (_monitorOpen) {
    postDone(true, 0)
  }
  _current = null
  _monitorOpen = false
  _lastTool = null
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
