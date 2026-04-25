// Stage 4 — client-side bridge for Gemini Live function tools.
// When Gemini Live emits a toolCall, geminiLive.js calls runTool(name, args)
// which proxies to our backend. The backend owns credentials (BROWSER_USE_API_KEY,
// MCP tokens, etc.); the client just shuttles.
//
// Stage 6 — observe_user_emotion is handled LOCALLY (no backend hop). It
// mutates the emotion store, which the avatar subscribes to.

import { setEmotion } from './emotionStore'
import { handleShowOnMonitor, showImageOnMonitor } from './monitorStore'
import { openEmailComposer } from './composerStore'
import { getLatestCameraFrame } from './cameraFrameBuffer'
import { setNarrationMode } from './narrationMode'
import {
  readClientCoords,
  readClientGeoPermission,
  tryRequestClientGeo,
} from './clientGeoProvider'
import {
  requestCameraSwitch,
  requestCameraStart,
  requestCameraStop,
  requestCameraZoom,
  getCurrentFacingMode,
} from './cameraControl'
import { requestUINotify, requestUINavigate, listAllowedRoutes } from './uiActionStore'
import { getCsrfToken } from './api'

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
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

// Real tools executed server-side via /api/tools/execute. These are the
// deterministic-API tools (mathjs, Open-Meteo, CoinGecko, OSRM, Wikipedia,
// Wiktionary, …) — the voice transports surface them so the model can ground
// answers instead of guessing. The server has the authoritative REAL_TOOL_NAMES
// list; this mirror just avoids a round-trip for names we know are unsupported.
const REAL_TOOL_NAMES = new Set([
  'calculate', 'unit_convert', 'get_moon_phase',
  'get_weather', 'get_forecast', 'get_air_quality', 'get_news',
  'get_crypto_price', 'get_stock_price', 'get_forex', 'currency_convert',
  'get_earthquakes', 'get_sun_times',
  'geocode', 'reverse_geocode', 'get_route', 'nearby_places',
  'get_elevation', 'get_timezone',
  'web_search', 'search_academic', 'search_github', 'search_stackoverflow',
  'fetch_url', 'rss_read',
  'wikipedia_search', 'dictionary',
  'translate',
  // Groq-powered (opt-in). The server returns a graceful "not configured"
  // message when GROQ_API_KEY is absent, so the voice UX never breaks.
  'solve_problem', 'code_review', 'explain_code',
  // PR 7/N — Planner Brain. Kelion calls this on compound/multi-step
  // asks to get a short numbered plan from Gemini Flash before it
  // starts executing real tools. Server returns a clean JSON plan;
  // summarizeRealTool shapes it for the voice model below.
  'plan_task',
  // PR 8/N — Memory of Actions. Kelion reads back its own recent tool
  // invocations for the signed-in user so it knows what it has already
  // done this session. Server returns a compact JSON list; the
  // summariser below renders it as numbered bullet points.
  'get_action_history',
  // Silent vision auto-learn (PR #210). Persists a private camera/voice
  // observation about the signed-in user as a low-confidence
  // memory_items row. Guests are a no-op server-side. Voice transports
  // need this entry so the toolCall reaches /api/tools/execute instead
  // of the client-side "not implemented" branch.
  'learn_from_observation',
  // Faza A (PR #211) — global live-radio search via radio-browser.info.
  // Without this the voice transports return "Tool not implemented"
  // and Kelion silently fails the user when they ask for radio.
  'play_radio',
  // F11 — `generate_image` is handled specially in the runTool switch
  // below so we can side-effect the monitor; it isn't in this set.
])

// Compress a tool-result JSON into a short, speakable string for the voice
// model. We keep the payload compact because the model will read this back
// in its next turn and any filler chars cost latency/tokens.
function summarizeRealTool(name, j) {
  if (!j || typeof j !== 'object') return 'Tool returned no result.'
  if (j.ok === false) {
    return j.error ? `Tool failed: ${j.error}` : 'Tool failed.'
  }
  // Known shapes — hand-tuned so the model gets the most useful bit first.
  if (name === 'calculate' && j.result !== undefined) {
    return `${j.expression} = ${j.result}`
  }
  if (name === 'unit_convert' && j.result !== undefined) {
    return `${j.value} ${j.from} = ${j.result} ${j.to}`
  }
  if (name === 'get_weather' && j.current) {
    const loc = j.location?.name || ''
    const c = j.current
    return `${loc}: ${c.temperature_2m}°C, wind ${c.wind_speed_10m} m/s, precipitation ${c.precipitation} mm.`
  }
  if (name === 'get_forecast' && (j.current || j.daily)) {
    // `get_forecast` calls `toolGetWeather` internally with `_maxDays: 16`
    // so it can return up to 16 days of daily data. Without this handler
    // the whole payload would fall through to the 2 KB JSON fallback,
    // which is both noisier and unfriendly to the voice model.
    const loc = j.location?.name || ''
    const parts = []
    if (j.current) {
      parts.push(`${loc}: now ${j.current.temperature_2m}°C, wind ${j.current.wind_speed_10m} m/s.`)
    } else if (loc) {
      parts.push(`${loc}:`)
    }
    if (j.daily && Array.isArray(j.daily.time)) {
      const days = j.daily.time.slice(0, 16).map((date, i) => {
        const hi = j.daily.temperature_2m_max?.[i]
        const lo = j.daily.temperature_2m_min?.[i]
        const rain = j.daily.precipitation_sum?.[i]
        const seg = [date]
        if (hi != null && lo != null) seg.push(`${lo}…${hi}°C`)
        if (rain != null) seg.push(`${rain} mm rain`)
        return seg.join(' ')
      })
      if (days.length) parts.push(`Forecast: ${days.join(' | ')}.`)
    }
    return parts.join(' ') || 'Forecast returned no data.'
  }
  if (name === 'get_crypto_price' && j.prices) {
    // `vs` echoes the requested fiat (usd/eur/ron/…). The server returns
    // `{ bitcoin: { eur: 50000 } }`, so hardcoding `p.usd` gave
    // "bitcoin undefined USD" for any non-USD query.
    const vs = (j.vs || 'usd').toLowerCase()
    const parts = Object.entries(j.prices).map(([id, p]) => `${id} ${p?.[vs]} ${vs.toUpperCase()}`)
    return parts.join('; ')
  }
  if (name === 'get_stock_price' && j.price !== undefined) {
    const chg = (j.price != null && j.previousClose != null)
      ? (((j.price - j.previousClose) / j.previousClose) * 100).toFixed(2)
      : null
    return `${j.symbol}: ${j.price} ${j.currency || ''}${chg != null ? ` (${chg}% vs prev close)` : ''}`
  }
  if (name === 'wikipedia_search' && j.extract) {
    return String(j.extract).slice(0, 900)
  }
  if (name === 'dictionary' && Array.isArray(j.meanings) && j.meanings.length) {
    const parts = []
    for (const m of j.meanings.slice(0, 3)) {
      for (const d of (m.definitions || []).slice(0, 2)) {
        parts.push(`(${m.partOfSpeech}) ${d.definition}`)
      }
    }
    return parts.join(' — ') || 'No definition found.'
  }
  if ((name === 'web_search' || name === 'search_academic' || name === 'search_github' || name === 'search_stackoverflow') && Array.isArray(j.results)) {
    const top = j.results.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} — ${r.url}`).join('\n')
    return top || 'No results.'
  }
  if (name === 'translate' && j.translated) {
    return j.translated
  }
  if ((name === 'solve_problem' || name === 'code_review' || name === 'explain_code') && j.result) {
    // Groq completions are already structured; keep them mostly intact but
    // cap so we don't blow past the voice model's context on the read-back.
    return String(j.result).slice(0, 4000)
  }
  if (name === 'get_action_history' && Array.isArray(j.actions)) {
    // Kelion is reading its own history. We keep each row on one line
    // so the voice model can scan it and decide quickly whether to
    // re-run a tool. Guest case (`signed_in === false`) is handled
    // by the generic `ok === false` branch at the top.
    if (!j.actions.length) {
      return "No recent actions recorded yet — I haven't run anything like that this session."
    }
    const rows = j.actions.slice(0, 20).map((a, i) => {
      const status = a.ok === false ? 'FAILED' : 'ok'
      const args = a.args ? ` (${a.args})` : ''
      const result = a.result ? ` → ${a.result}` : ''
      return `${i + 1}. ${a.tool} [${status}]${args}${result}`
    }).join('\n')
    return `Recent actions (${j.count} total):\n${rows}`.slice(0, 4000)
  }
  if (name === 'plan_task' && Array.isArray(j.steps)) {
    // Condense the planner's structured JSON into a compact speakable form
    // the voice model can read and then walk through. We keep tool_hint
    // inline so the model knows which tool each step should call. A final
    // "Cautions" line surfaces anything the planner flagged as requiring
    // user confirmation (spending, messaging, destructive actions).
    const header = j.summary ? `Plan: ${j.summary}` : 'Plan:'
    const body = j.steps.map((s) => {
      const hint = s.tool_hint ? ` [${s.tool_hint}]` : ''
      const why = s.why ? ` — ${s.why}` : ''
      return `${s.n}. ${s.action}${hint}${why}`
    }).join('\n')
    const cautions = Array.isArray(j.cautions) && j.cautions.length
      ? `\nCautions: ${j.cautions.join('; ')}`
      : ''
    return `${header}\n${body}${cautions}`.slice(0, 4000)
  }
  if (name === 'play_radio' && j.pick) {
    // Faza A. The voice model gets a compact line so it can confirm
    // ("now playing Radio ZU, Bucharest") and then immediately call
    // show_on_monitor(kind='audio', query=<url>, title=<name>) to
    // actually start playback. We surface the stream URL verbatim
    // because the next tool call needs it.
    const p = j.pick
    const where = [p.country, p.language].filter(Boolean).join(', ')
    const codec = p.codec ? `, ${p.codec}${p.bitrate ? ` ${p.bitrate}kbps` : ''}` : ''
    return `Pick: ${p.name}${where ? ` (${where})` : ''}${codec}. Stream: ${p.url}`
  }
  if (name === 'learn_from_observation') {
    // Silent tool. Persona forbids any user-visible mention of this
    // call — return a compact ack the model will not narrate.
    if (j.signed_in === false) return 'ok:learn:guest'
    return `ok:learn:${j.persisted || 0}`
  }
  // Generic fallback — stringify but cap so the model never chokes.
  try {
    return JSON.stringify(j).slice(0, 2000)
  } catch {
    return 'Tool returned an unserializable result.'
  }
}

async function runRealToolRemote(name, args) {
  const j = await postJSON('/api/tools/execute', { name, args: args || {} })
  return summarizeRealTool(name, j)
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
      // `title` was added in Faza A so the audio card can show the live
      // station name instead of falling back to the stream hostname.
      return handleShowOnMonitor({
        kind: args?.kind,
        query: args?.query,
        title: args?.title,
      })
    }
    case 'compose_email_draft': {
      // Local-only: open the in-app email composer modal pre-populated
      // with the model's draft. The user reviews / edits / sends — nothing
      // is delivered without an explicit click. Adrian: "sa deschida
      // cimpurile de mail, sa poata fi setate".
      openEmailComposer({
        to: args?.to,
        cc: args?.cc,
        bcc: args?.bcc,
        subject: args?.subject,
        body: args?.body,
        reply_to: args?.reply_to,
      })
      // Compact ack so the voice model can confirm to the user without
      // narrating tool details ("Drafted — review the fields and hit Send
      // when you're ready"). Kelion's persona forbids enumerating these
      // fields back; the modal IS the visible state.
      return 'ok:composer:email_opened'
    }
    case 'generate_image': {
      // F11 — OpenAI gpt-image-1. The server generates the PNG, caches it
      // for 10 min, and returns a short-lived URL. We then push it onto
      // the stage monitor so the avatar literally shows the new image
      // inline (no second "show_on_monitor" turn needed — cuts one
      // round-trip of latency the user would otherwise hear).
      const j = await postJSON('/api/tools/execute', {
        name: 'generate_image',
        args: {
          prompt: args?.prompt,
          size: args?.size,
        },
      })
      if (!j?.ok) {
        // Preserve the upstream error so Kelion can explain ("the safety
        // system rejected that prompt", "image service isn't configured
        // yet", …). The caller already surfaces this verbatim to the
        // voice model via the transport's tool-response frame.
        return j?.error || 'Image generation failed.'
      }
      if (j.url) {
        showImageOnMonitor({
          src: j.url,
          title: j.title || args?.prompt || 'Generated image',
        })
      }
      // The voice model reads this short ack back to the user. Keeping
      // it under ~80 chars avoids filler latency on the TTS pass.
      const label = (j.title || args?.prompt || '').toString().slice(0, 80)
      return label ? `Generated: ${label}` : 'Image generated and displayed.'
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
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
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
    case 'get_my_location': {
      // Client-side GPS — on mobile this hits real GPS, on desktop the OS
      // WiFi-fused location. KelionStage registered a provider via
      // `setClientGeoProvider` on mount. If permission is already granted
      // we return coords synchronously; if the user hasn't granted yet we
      // fire `requestNow()` (iOS needs a user gesture, so the first call
      // from KelionStage's onClick handler primes this path — by the
      // time the model invokes the tool the prompt either ran or is
      // about to) and return a speakable hint so Kelion can ask the user
      // to allow location.
      const permission = readClientGeoPermission()
      let coords = readClientCoords()
      if (!coords && permission !== 'denied') {
        tryRequestClientGeo()
        // Short wait so a freshly-granted prompt can land before we
        // answer. Keeps the voice turn snappy — we never block longer
        // than 1.5s here; the watchPosition subscription will update
        // future calls.
        const deadline = Date.now() + 1500
        while (!coords && Date.now() < deadline) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 150))
          coords = readClientCoords()
        }
      }
      if (!coords) {
        if (permission === 'denied') {
          return 'Location permission is blocked. Tell the user to enable it in their browser settings.'
        }
        return 'Location not available yet. Ask the user to tap the screen and allow location access.'
      }
      const parts = [
        `lat ${coords.lat.toFixed(5)}`,
        `lon ${coords.lon.toFixed(5)}`,
      ]
      if (coords.accuracy != null) parts.push(`±${Math.round(coords.accuracy)} m`)
      if (args?.include_address !== false) {
        // Best-effort reverse geocode via the shared real-tool executor
        // so Kelion can say "Cluj-Napoca, Romania" instead of raw
        // coordinates. If it fails we still return the numeric answer.
        try {
          const j = await postJSON('/api/tools/execute', {
            name: 'reverse_geocode',
            args: { lat: coords.lat, lon: coords.lon },
          })
          // Server reverse_geocode returns `displayName` (camelCase) — the snake_case
          // `display_name` check was left over from the raw Nominatim shape and never fired.
          const place = j?.displayName || j?.display_name || j?.address?.city || j?.address?.town || j?.address?.village
          if (place) parts.unshift(String(place))
        } catch { /* ignore — numeric answer is fine */ }
      }
      return parts.join(', ')
    }
    case 'switch_camera': {
      // Flip front / back camera on mobile. The voice model invokes this
      // when the user says "flip the camera" / "show me what's behind you"
      // / "schimbă camera" / "comută camerele". cameraControl.js restarts
      // the active transport's getUserMedia stream with the new facingMode.
      // On laptops / single-camera devices the browser may ignore the
      // constraint and keep the same stream — we surface that so Kelion
      // doesn't claim success.
      const current = getCurrentFacingMode()
      const side = args?.side
        || (current === 'user' ? 'back' : 'front')
      const res = await requestCameraSwitch(side)
      if (!res.ok) return res.error || 'Camera switch failed.'
      return `ok:facingMode=${res.facingMode}`
    }
    case 'camera_on': {
      // "pornește camera", "activează camera front/back", "camera spate".
      // Default to back camera when side is omitted — it's the higher-
      // resolution lens on phones and the one Adrian relies on for
      // distance reads (number plates, signage).
      const side = args?.side || 'back'
      const res = await requestCameraStart(side)
      if (!res.ok) return res.error || 'Camera failed to start.'
      return `ok:camera_on:side=${res.side}:facingMode=${res.facingMode}`
    }
    case 'camera_off': {
      // "oprește camera", "dezactivează camera".
      const res = await requestCameraStop()
      if (!res.ok) return res.error || 'Camera failed to stop.'
      return 'ok:camera_off'
    }
    case 'zoom_camera': {
      // "focalizează pe număr", "zoom 2x". Returns softZoom=true when
      // the lens has no hardware zoom capability so the model can tell
      // the user the effect is limited.
      const level = Number(args?.level)
      const res = await requestCameraZoom(level)
      if (!res.ok) return res.error || 'Zoom failed.'
      return `ok:zoom=${res.zoom}${res.softZoom ? ':soft' : ''}`
    }
    case 'ui_notify': {
      // Kelion paints a visible status note on the stage ("am deschis
      // harta", "am salvat conversația"). Gives the avatar a visual
      // channel for actions it just performed so the user can see
      // them complete, instead of trusting spoken claims alone. First
      // concrete agency primitive — "apasă butoane" starts here.
      const res = await requestUINotify({
        text: args?.text ?? args?.message,
        variant: args?.variant,
        ttl_s: args?.ttl_s,
      })
      if (!res.ok) return res.error || 'Notification failed.'
      return `ok:ui_notify:id=${res.id}`
    }
    case 'ui_navigate': {
      // Move the user between the small set of SPA routes Kelion
      // knows about ("/", "/studio", "/contact"). Allowlisted inside
      // uiActionStore so a hallucinated route can't silently
      // navigate anywhere. When the route is unknown the tool
      // returns a speakable error that includes the allowed set,
      // so the model can correct itself.
      const res = await requestUINavigate(args?.route)
      if (!res.ok) {
        return res.error || `Navigation failed. Allowed routes: ${listAllowedRoutes().join(', ')}.`
      }
      return `ok:ui_navigate:route=${res.route}`
    }
    default:
      // Real-API tools (calculate, get_weather, web_search, …) are proxied
      // to the server — the executor is shared with text chat so the model
      // gets the exact same JSON shape on both transports.
      if (REAL_TOOL_NAMES.has(name)) {
        try {
          return await runRealToolRemote(name, args)
        } catch (err) {
          return `Tool "${name}" failed: ${err?.message || err}`
        }
      }
      return `Tool "${name}" is not implemented on this build.`
  }
}
