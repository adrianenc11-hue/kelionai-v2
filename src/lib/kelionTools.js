// Stage 4 — client-side bridge for Gemini Live function tools.
// When Gemini Live emits a toolCall, geminiLive.js calls runTool(name, args)
// which proxies to our backend. The backend owns credentials (BROWSER_USE_API_KEY,
// MCP tokens, etc.); the client just shuttles.
//
// Stage 6 — observe_user_emotion is handled LOCALLY (no backend hop). It
// mutates the emotion store, which the avatar subscribes to.

import { setEmotion } from './emotionStore'
import { handleShowOnMonitor } from './monitorStore'
import { getLatestCameraFrame } from './cameraFrameBuffer'
import { setNarrationMode } from './narrationMode'

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body || {}),
  })
  let j = null
  try { j = await r.json() } catch { /* ignore */ }
  if (!j) return { ok: false, error: `HTTP ${r.status}` }
  return j
}

function summarize(j, successKey = 'result') {
  if (j.ok && j[successKey]) return String(j[successKey])
  if (j.unavailable && j.error) return j.error
  if (j.error) return j.error
  return 'Tool returned no result.'
}

export async function runTool(name, args) {
  switch (name) {
    case 'browse_web': {
      const j = await postJSON('/api/tools/browser/browse', {
        task: args?.task,
        start_url: args?.start_url || null,
      })
      return summarize(j)
    }
    case 'read_calendar':
      return summarize(await postJSON('/api/tools/mcp/calendar', { range: args?.range || 'today' }))
    case 'read_email':
      return summarize(await postJSON('/api/tools/mcp/email', {
        query: args?.query || '',
        limit: args?.limit || 5,
      }))
    case 'search_files':
      return summarize(await postJSON('/api/tools/mcp/files', {
        query: args?.query || '',
        limit: args?.limit || 5,
      }))
    case 'observe_user_emotion': {
      // Local-only: mutate the emotion store so the avatar reacts.
      // Return a tiny ack so Gemini knows we heard it.
      const applied = setEmotion({
        state: args?.state || 'neutral',
        intensity: args?.intensity ?? 0.5,
        cue: args?.cue || null,
      })
      return `ack:${applied.state}:${applied.intensity.toFixed(2)}`
    }
    case 'show_on_monitor': {
      // Local-only: project content onto the avatar's on-stage monitor.
      // monitorStore resolves (kind, query) → iframe/image URL and notifies
      // the React tree via subscribeMonitor. No backend round-trip needed.
      return handleShowOnMonitor({ kind: args?.kind, query: args?.query })
    }
    case 'set_narration_mode': {
      // Accessibility mode. Flips a module-level flag that
      // src/lib/openaiRealtime.js watches — when true it runs a periodic
      // vision call and injects the description into the OpenAI session
      // so Kelion speaks a short natural narration. Does NOT itself
      // fetch the first frame; the transport's narration loop handles
      // the cadence. We just confirm the transition back to the model
      // so it can say something like "OK, I'll keep describing what
      // I see" before the first tick fires.
      const enabled = !!args?.enabled
      const interval = Number(args?.interval_s)
      const focus = typeof args?.focus === 'string' ? args.focus : ''
      const next = setNarrationMode({
        enabled,
        interval_s: Number.isFinite(interval) ? interval : undefined,
        focus: enabled ? focus : '',
      })
      if (next.enabled) {
        const every = Math.round(next.intervalMs / 1000)
        return `narration_on:${every}s${next.focus ? `:focus=${next.focus.slice(0, 80)}` : ''}`
      }
      return 'narration_off'
    }
    case 'what_do_you_see': {
      // Hybrid voice+vision: OpenAI handles speech, Gemini Vision handles
      // camera. The tool only fires when the user asks the avatar to look
      // (persona gates this in the system prompt); here we pull the most
      // recent frame from the passive buffer (openaiRealtime.js grabs one
      // every ~1s while the camera is on) and POST it to the server,
      // which forwards to Gemini Vision and returns plain-text description.
      // If the camera is off or we haven't grabbed a frame yet, tell the
      // model that so it can ask the user to turn it on instead of making
      // up a description.
      const frame = getLatestCameraFrame()
      if (!frame?.dataUrl) {
        return "Camera is off. Tell the user to tap the camera button so you can see."
      }
      // Stale-frame guard: if the last grab was > 30s ago (tab was
      // backgrounded, grab loop stalled, etc.) we'd rather ask the user
      // to verify than describe a minute-old still.
      if (Date.now() - (frame.capturedAt || 0) > 30_000) {
        return "My last camera frame is stale. Ask the user to move or tap the camera button again."
      }
      try {
        const r = await fetch('/api/realtime/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ frame: frame.dataUrl, focus: args?.focus || '' }),
        })
        if (!r.ok) {
          // Surface a graceful, speakable failure — don't crash the voice
          // turn. 429/402/401 all fall through to the same fallback text;
          // the user is already inside a paid/authenticated voice session
          // when this tool fires, so these are transient upstream issues.
          let body = null
          try { body = await r.json() } catch { /* ignore */ }
          if (body?.description) return body.description
          return "I can't see clearly right now. Tell the user to try again in a moment."
        }
        const body = await r.json().catch(() => null)
        if (body?.description) return body.description
        return "I looked but couldn't make out any details this time."
      } catch (err) {
        return "The vision link dropped just now. I can try again if the user asks."
      }
    }
    default:
      return `Tool "${name}" is not implemented on this build.`
  }
}
