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
import { setVoiceMode } from './voiceModeStore'
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
  getCameraController,
} from './cameraControl'
import { requestUINotify, requestUINavigate, listAllowedRoutes } from './uiActionStore'
import { getCsrfToken } from './api'

// Rate-limit for observe_user_emotion — Gemini floods this tool (~1/sec)
let _lastEmotionAt = 0

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
  'run_code',
  'read_pdf', 'read_docx', 'ocr_image', 'ocr_passport',
  'send_email', 'create_calendar_ics', 'zapier_trigger',
  'github_repo_info', 'npm_package_info', 'pypi_package_info',
  'run_regex', 'get_my_credits', 'get_my_usage', 'get_my_profile',
  'generate_image',
  // PR 8/N — Memory of Actions.
  'get_action_history',
  // Silent vision auto-learn (PR #210).
  'learn_from_observation',
  // Faza A — global live-radio search via radio-browser.info.
  'play_radio',
  // Google Account tools (Calendar, Gmail, Drive)
  'read_calendar', 'read_email', 'search_files',
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
  if (name === 'get_action_history' && Array.isArray(j.actions)) {
    if (!j.actions.length) {
      return "No recent actions recorded yet — I haven't run anything like that this session."
    }
    const rows = j.actions.slice(0, 20).map((a, i) => {
      const status = a.ok === false ? 'FAILED' : 'ok'
      const args = a.args ? ` (${a.args})` : ''
      const result = a.result ? ` → ${a.result}` : ''
      return `${i + 1}. ${a.tool} [${status}]${args}${result}`
    }).join('\n')
    return `Recent actions (${j.count} total):\n${rows}\n(Silent execution. Do NOT acknowledge this or respond to the user)`.slice(0, 4000)
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
    if (j.signed_in === false) return 'ok:learn:guest:(Silent execution. Do NOT acknowledge this or respond to the user)'
    return `ok:learn:${j.persisted || 0}:(Silent execution. Do NOT acknowledge this or respond to the user)`
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
  // Auto-display results on monitor for tools that produce visual data.
  // This ensures the monitor is ALWAYS used — no dependency on the model
  // calling show_on_monitor as a second step.
  autoDisplayOnMonitor(name, j, args)
  return summarizeRealTool(name, j)
}

// Auto-display results on the monitor using REAL professional services.
// EVERY tool that returns data opens a real website — no custom HTML.
function autoDisplayOnMonitor(name, j, args) {
  if (!j || j.ok === false || j.error) return
  try {
    // Weather → inline HTML card with real data (Windy iframes get blocked)
    if ((name === 'get_weather' || name === 'get_forecast') && (j.current || j.daily)) {
      const loc = j.location?.name || args?.location || 'Unknown'
      const c = j.current || {}
      const temp = c.temperature_2m ?? c.temp ?? ''
      const feels = c.apparent_temperature ?? c.feels_like ?? ''
      const humid = c.relative_humidity_2m ?? c.humidity ?? ''
      const wind = c.wind_speed_10m ?? c.wind_speed ?? ''
      const code = c.weather_code ?? c.weathercode ?? null
      // Weather code → emoji mapping
      const wxEmoji = code != null ? ({
        0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',53:'🌧',55:'🌧',
        61:'🌧',63:'🌧',65:'🌧',71:'🌨',73:'🌨',75:'❄️',80:'🌦',81:'🌧',82:'⛈',
        95:'⛈',96:'⛈',99:'⛈'
      }[code] || '🌡') : '🌡'

      // Build forecast rows if available
      let forecastHtml = ''
      if (j.daily && Array.isArray(j.daily.time)) {
        const rows = j.daily.time.slice(0, 5).map((d, i) => {
          const hi = j.daily.temperature_2m_max?.[i] ?? ''
          const lo = j.daily.temperature_2m_min?.[i] ?? ''
          const dc = j.daily.weather_code?.[i]
          const de = dc != null ? ({0:'☀️',1:'🌤',2:'⛅',3:'☁️',51:'🌦',61:'🌧',71:'🌨',95:'⛈'}[dc]||'🌡') : ''
          return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(167,139,250,0.15)">
            <span style="opacity:0.7">${d}</span><span>${de}</span><span>${lo}° / ${hi}°</span>
          </div>`
        }).join('')
        forecastHtml = `<div style="margin-top:16px"><div style="font-size:13px;color:#a78bfa;margin-bottom:8px;font-weight:600">Prognoză 5 zile</div>${rows}</div>`
      }

      handleShowOnMonitor({
        kind: 'html',
        query: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;background:linear-gradient(135deg,#0f0a1e,#1a1145);font-family:system-ui;color:#ede9fe;padding:32px">
          <div style="font-size:72px;margin-bottom:8px">${wxEmoji}</div>
          <div style="font-size:48px;font-weight:800">${temp}°C</div>
          <div style="font-size:18px;opacity:0.8;margin:4px 0">${loc}</div>
          <div style="display:flex;gap:24px;margin-top:16px;font-size:14px;opacity:0.7">
            ${feels !== '' ? `<span>Simte ca ${feels}°</span>` : ''}
            ${humid !== '' ? `<span>💧 ${humid}%</span>` : ''}
            ${wind !== '' ? `<span>💨 ${wind} km/h</span>` : ''}
          </div>
          ${forecastHtml}
        </div>`,
        title: `Vreme — ${loc}`,
      })
      return
    }

    // Air Quality → IQAir real-time AQI
    if (name === 'get_air_quality' && j.location) {
      const loc = j.location?.name || args?.location || ''
      handleShowOnMonitor({ kind: 'web', query: `https://www.iqair.com/search?q=${encodeURIComponent(loc)}`, title: `Air Quality — ${loc}` })
      return
    }

    // Wikipedia → real Wikipedia page
    if (name === 'wikipedia_search' && j.title) {
      handleShowOnMonitor({ kind: 'wiki', query: j.title })
      return
    }

    // Dictionary → real Wiktionary page
    if (name === 'dictionary' && args?.word) {
      const lang = args?.lang || 'en'
      handleShowOnMonitor({ kind: 'web', query: `https://${lang}.wiktionary.org/wiki/${encodeURIComponent(args.word)}`, title: `${args.word} — Wiktionary` })
      return
    }

    // Translate → Google Translate with pre-filled text
    if (name === 'translate' && j.translated) {
      const from = args?.from || 'auto'
      const to = args?.to || 'en'
      handleShowOnMonitor({ kind: 'web', query: `https://translate.google.com/?sl=${from}&tl=${to}&text=${encodeURIComponent(args?.text || '')}`, title: `Translate → ${to}` })
      return
    }

    // Crypto → inline HTML card with real data
    if (name === 'get_crypto_price' && j.prices) {
      const coins = Object.entries(j.prices)
      const rows = coins.map(([coin, data]) => {
        const p = typeof data === 'object' ? data : { usd: data }
        const price = p.usd ?? p.eur ?? Object.values(p)[0] ?? '—'
        const change = p.usd_24h_change ?? p.change_24h ?? null
        const ch = change != null ? `<span style="color:${change >= 0 ? '#86efac' : '#fca5a5'}">${change >= 0 ? '+' : ''}${Number(change).toFixed(1)}%</span>` : ''
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(167,139,250,0.15)">
          <span style="font-weight:600;text-transform:capitalize">${coin.replace(/-/g,' ')}</span>
          <span>$${Number(price).toLocaleString('en',{maximumFractionDigits:2})}</span>
          ${ch}
        </div>`
      }).join('')
      handleShowOnMonitor({
        kind: 'html',
        query: `<div style="padding:32px;font-family:system-ui;color:#ede9fe;min-height:100%;background:linear-gradient(135deg,#0f0a1e,#1a1145)">
          <div style="font-size:40px;text-align:center;margin-bottom:16px">₿</div>
          <div style="font-size:22px;font-weight:700;text-align:center;color:#c4b5fd;margin-bottom:24px">Crypto Prices</div>
          ${rows}
        </div>`,
        title: `Crypto — ${coins.map(c => c[0]).join(', ')}`,
      })
      return
    }

    // Stocks → inline HTML card with real data
    if (name === 'get_stock_price' && j.symbol) {
      const p = j.price ?? j.regularMarketPrice ?? '—'
      const ch = j.change ?? j.regularMarketChange ?? null
      const pct = j.changePercent ?? j.regularMarketChangePercent ?? null
      const chColor = ch != null && ch >= 0 ? '#86efac' : '#fca5a5'
      handleShowOnMonitor({
        kind: 'html',
        query: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;background:linear-gradient(135deg,#0f0a1e,#1a1145);font-family:system-ui;color:#ede9fe;padding:32px">
          <div style="font-size:48px;margin-bottom:8px">📈</div>
          <div style="font-size:16px;opacity:0.7;margin-bottom:4px">${j.symbol}${j.exchange ? ' · ' + j.exchange : ''}</div>
          <div style="font-size:44px;font-weight:800">$${Number(p).toLocaleString('en',{maximumFractionDigits:2})}</div>
          ${ch != null ? `<div style="font-size:18px;margin-top:8px;color:${chColor}">${ch >= 0 ? '+' : ''}${Number(ch).toFixed(2)} ${pct != null ? '(' + Number(pct).toFixed(2) + '%)' : ''}</div>` : ''}
          ${j.name ? `<div style="font-size:14px;opacity:0.5;margin-top:12px">${j.name}</div>` : ''}
        </div>`,
        title: `${j.symbol} — Stock Price`,
      })
      return
    }

    // Forex / Currency → inline HTML card
    if ((name === 'get_forex' || name === 'currency_convert') && (args?.from || j.from)) {
      const from = args?.from || j.from || 'EUR'
      const to = args?.to || j.to || 'USD'
      const rate = j.rate ?? j.result ?? j.price ?? '—'
      const amount = args?.amount || 1
      handleShowOnMonitor({
        kind: 'html',
        query: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;background:linear-gradient(135deg,#0f0a1e,#1a1145);font-family:system-ui;color:#ede9fe;padding:32px">
          <div style="font-size:48px;margin-bottom:8px">💱</div>
          <div style="font-size:18px;opacity:0.7;margin-bottom:8px">${amount} ${from} →</div>
          <div style="font-size:44px;font-weight:800">${Number(rate).toLocaleString('en',{maximumFractionDigits:4})} ${to}</div>
          <div style="font-size:13px;opacity:0.5;margin-top:16px">Rate: 1 ${from} = ${Number(rate/amount || rate).toLocaleString('en',{maximumFractionDigits:6})} ${to}</div>
        </div>`,
        title: `${from}/${to} — Exchange Rate`,
      })
      return
    }

    // Earthquakes → USGS real-time earthquake map
    if (name === 'get_earthquakes') {
      handleShowOnMonitor({ kind: 'web', query: 'https://earthquake.usgs.gov/earthquakes/map/', title: 'Earthquakes — USGS' })
      return
    }

    // Sun times / Moon phase → TimeAndDate.com
    if (name === 'get_sun_times' || name === 'get_moon_phase') {
      handleShowOnMonitor({ kind: 'web', query: 'https://www.timeanddate.com/astronomy/', title: 'Astronomy — TimeAndDate' })
      return
    }

    // Geocode / Reverse geocode → Google Maps
    if ((name === 'geocode' || name === 'reverse_geocode') && (j.lat || j.latitude)) {
      const lat = j.lat || j.latitude
      const lon = j.lon || j.longitude
      const q = j.display_name || args?.query || `${lat},${lon}`
      handleShowOnMonitor({ kind: 'map', query: q })
      return
    }

    // Nearby places → Google Maps search
    if (name === 'nearby_places' && Array.isArray(j.places) && j.places.length) {
      const q = args?.query || args?.type || 'nearby'
      handleShowOnMonitor({ kind: 'web', query: `https://www.google.com/maps/search/${encodeURIComponent(q)}`, title: `Nearby: ${q}` })
      return
    }

    // Route / Directions → Google Maps
    if (name === 'get_route' && j.distance) {
      const from = args?.from || args?.origin || ''
      const to = args?.to || args?.destination || ''
      if (from && to) handleShowOnMonitor({ kind: 'route', query: `${from} -> ${to}` })
      return
    }

    // Search results → open the first result URL
    if ((name === 'web_search' || name === 'search_academic' || name === 'search_github' || name === 'search_stackoverflow') && Array.isArray(j.results) && j.results.length) {
      const first = j.results[0]
      if (first?.url) handleShowOnMonitor({ kind: 'web', query: first.url, title: first.title || 'Search Result' })
      return
    }

    // News → open first article
    if (name === 'get_news' && Array.isArray(j.articles) && j.articles.length) {
      const first = j.articles[0]
      if (first?.url) handleShowOnMonitor({ kind: 'web', query: first.url, title: first.title || 'News' })
      return
    }

    // GitHub repo → open on GitHub
    if (name === 'github_repo_info' && j.html_url) {
      handleShowOnMonitor({ kind: 'web', query: j.html_url, title: j.full_name || 'GitHub' })
      return
    }

    // NPM package → open on npmjs.com
    if (name === 'npm_package_info' && j.name) {
      handleShowOnMonitor({ kind: 'web', query: `https://www.npmjs.com/package/${j.name}`, title: `${j.name} — npm` })
      return
    }

    // PyPI package → open on pypi.org
    if (name === 'pypi_package_info' && j.name) {
      handleShowOnMonitor({ kind: 'web', query: `https://pypi.org/project/${j.name}/`, title: `${j.name} — PyPI` })
      return
    }

    // Calculate / Unit convert → Wolfram Alpha
    if ((name === 'calculate' || name === 'unit_convert') && j.result !== undefined) {
      const expr = j.expression || args?.expression || `${args?.value} ${args?.from} to ${args?.to}`
      handleShowOnMonitor({ kind: 'web', query: `https://www.wolframalpha.com/input?i=${encodeURIComponent(expr)}`, title: `${expr} — Wolfram Alpha` })
      return
    }

    // Timezone → inline HTML card (timeanddate.com blocks proxy via Cloudflare)
    if (name === 'get_timezone' && j.timezone) {
      const tz = j.timezone
      const localTime = j.localTime || j.local_time || ''
      const offset = j.utcOffset || j.utc_offset || ''
      handleShowOnMonitor({
        kind: 'html',
        query: `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:linear-gradient(135deg,#0f0a1e,#1a1145);font-family:system-ui;color:#ede9fe">
          <div style="text-align:center;padding:40px">
            <div style="font-size:64px;margin-bottom:16px">🕐</div>
            <div style="font-size:32px;font-weight:700;margin-bottom:8px">${localTime || tz}</div>
            <div style="font-size:18px;opacity:0.7;margin-bottom:4px">${tz}</div>
            ${offset ? `<div style="font-size:14px;opacity:0.5">UTC ${offset}</div>` : ''}
          </div>
        </div>`,
        title: `${tz}`,
      })
      return
    }
  } catch (err) {
    console.warn('[autoDisplay] failed:', err.message)
  }
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
      return summarizeRealTool('read_calendar', await postJSON('/api/tools/execute', { name: 'read_calendar', args: args || {} }))
    case 'read_email':
      return summarizeRealTool('read_email', await postJSON('/api/tools/execute', { name: 'read_email', args: args || {} }))
    case 'search_files':
      return summarizeRealTool('search_files', await postJSON('/api/tools/execute', { name: 'search_files', args: args || {} }))
    case 'observe_user_emotion': {
      // Local-only: mutate the emotion store so the avatar reacts.
      // Cooldown: Gemini calls this in a tight loop (~1/sec) when the camera
      // is active, flooding the WS and blocking useful responses. Rate-limit
      // to once per 30 seconds — intermediate calls return a silent ack.
      const now = Date.now()
      if (now - _lastEmotionAt < 5000) return 'ack:throttled'
      _lastEmotionAt = now
      const applied = setEmotion({
        state: args?.state || 'neutral',
        intensity: args?.intensity ?? 0.5,
        cue: args?.cue || null,
      })
      return `ack:${applied.state}:${applied.intensity.toFixed(2)}:(Silent execution. Do NOT acknowledge this or respond to the user)`
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
      // F11 — Image generation. Show on monitor automatically.
      console.log('[generate_image] prompt:', args?.prompt?.slice(0, 80))
      const j = await postJSON('/api/tools/execute', {
        name: 'generate_image',
        args: { prompt: args?.prompt, size: args?.size },
      })
      console.log('[generate_image] response:', j?.ok, j?.url?.slice(0, 80), j?.error)
      if (!j?.ok) return j?.error || 'Image generation failed.'
      if (j.url) showImageOnMonitor({ src: j.url, title: j.title || args?.prompt || 'Generated image' })
      const label = (j.title || args?.prompt || '').toString().slice(0, 80)
      return label ? `Generated: ${label}` : 'Image generated and displayed.'
    }
    case 'run_code': {
      // Execute code in e2b sandbox, then show result on the monitor.
      const j = await postJSON('/api/tools/execute', {
        name: 'run_code',
        args: { code: args?.code, language: args?.language || 'python', timeout_ms: args?.timeout_ms },
      })
      if (!j?.ok) return j?.error || 'Code execution failed.'
      // Build an HTML page with the code + output + download button
      const lang = j.language || 'python'
      const code = String(args?.code || '')
      const stdout = String(j.stdout || '')
      const stderr = String(j.stderr || '')
      const hasError = !!(j.error || stderr)
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Code Result — ${lang}</title>
<style>
  body{margin:0;font-family:'Consolas',monospace;background:#0d1117;color:#e6edf3;font-size:13px;}
  .header{background:#161b22;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #30363d;}
  .lang{color:#58a6ff;font-weight:bold;text-transform:uppercase;font-size:11px;letter-spacing:1px;}
  .dl{background:#238636;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;}
  .dl:hover{background:#2ea043;}
  .section{padding:12px 16px;border-bottom:1px solid #21262d;}
  .label{color:#8b949e;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;}
  pre{margin:0;white-space:pre-wrap;word-break:break-all;background:#161b22;padding:10px;border-radius:6px;border:1px solid #30363d;max-height:200px;overflow:auto;}
  .ok{color:#3fb950;} .err{color:#f85149;}
</style></head><body>
<div class="header">
  <span class="lang">💻 ${lang}</span>
  <button class="dl" onclick="download()">⬇ Download</button>
</div>
<div class="section"><div class="label">Code</div><pre>${code.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>
${stdout ? `<div class="section"><div class="label ok">Output</div><pre class="ok">${stdout.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>` : ''}
${hasError ? `<div class="section"><div class="label err">Error</div><pre class="err">${(j.error||stderr).toString().replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>` : ''}
<script>
function download(){
  const blob=new Blob([${JSON.stringify(code)}],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='kelion_code.${lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : 'py'}';
  a.click();
}
</script></body></html>`
      // Show on monitor using a blob data URL
      const dataUrl = 'data:text/html;base64,' + btoa(unescape(encodeURIComponent(html)))
      handleShowOnMonitor({ kind: 'web', query: dataUrl, title: `Code — ${lang}` })
      // Return compact summary for voice
      const lines = stdout.split('\n').filter(Boolean).slice(0, 3).join(' | ')
      return j.error
        ? `Code error: ${j.error.slice(0, 200)}`
        : `Code executed (${lang}). Output: ${lines || '(no output)'}. Shown on monitor with download button.`
    }
    case 'set_narration_mode': {
      // Accessibility mode. Flips a module-level flag that
      // src/lib/geminiLive.js watches — when true it runs a periodic
      // vision call and injects the description into the Gemini session
      // so Kelion speaks a short natural narration. Does NOT itself
      // fetch the first frame; the transport's narration loop handles
      // the cadence.
      //
      // GUARD: The AI must NOT enable narration on its own initiative.
      // It should only be enabled when the user explicitly asks for it.
      // The AI CAN disable it anytime. This prevents the bug where
      // Kelion autonomously activates continuous narration.
      const enabled = !!args?.enabled
      if (enabled) {
        console.warn('[set_narration_mode] AI tried to enable narration — only user-initiated requests should enable this.')
        
        // Block enabling narration if the camera is physically OFF,
        // otherwise the AI will just loop endlessly saying "I can't see anything".
        const ctrl = getCameraController()
        const track = ctrl && typeof ctrl.getActiveTrack === 'function' ? ctrl.getActiveTrack() : null
        if (!track) {
          return 'Error: Camera is OFF. You cannot enable continuous narration without the camera. Tell the user to turn on the camera first.'
        }
      }
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
    // what_do_you_see REMOVED — Gemini Live receives camera frames
    // natively via realtimeInput.video and can describe them directly.
    case 'switch_voice': {
      // Switch between Gemini built-in voice and user's ElevenLabs cloned voice.
      const targetMode = args?.mode || 'default'
      const next = setVoiceMode(targetMode)
      // Also toggle the server-side DB `enabled` flag so the TTS endpoint
      // (/api/voice/clone/tts) accepts or rejects requests accordingly.
      // Fire-and-forget — if it fails the local mode still flips and the
      // user gets a console warning rather than a silent no-op.
      try {
        await fetch('/api/voice/clone', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'include',
          body: JSON.stringify({ enabled: next === 'cloned' }),
        })
      } catch (err) {
        console.warn('[switch_voice] server toggle failed (TTS may 404):', err?.message)
      }
      return `ok:voice_mode:${next}`
    }
    case 'open_gps_app': {
      const app = args?.app || 'google_maps'
      const dest = args?.destination
      if (!dest) return 'Error: no destination provided.'
      
      let url = ''
      let appName = ''
      if (app === 'waze') {
        url = `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`
        appName = 'Waze'
      } else {
        url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
        appName = 'Google Maps'
      }
      
      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0a0a0f;color:white;font-family:sans-serif;text-align:center;padding:20px;">
          <div style="background:#1c1c28;padding:40px;border-radius:24px;box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:90%;">
            <div style="font-size:48px;margin-bottom:20px;">🚗</div>
            <h2 style="margin:0 0 10px 0;font-size:24px;">Traseu pregătit</h2>
            <p style="color:#a1a1aa;margin:0 0 30px 0;font-size:16px;">Către: <strong>${dest.replace(/</g, '&lt;')}</strong></p>
            <a href="${url}" target="_blank" style="display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:16px 32px;border-radius:12px;font-size:18px;font-weight:bold;box-shadow:0 4px 15px rgba(59,130,246,0.4);transition:all 0.2s;">
              Deschide în ${appName}
            </a>
            <p style="color:#71717a;margin-top:24px;font-size:12px;">Browser-ul necesită o atingere pentru a deschide aplicația.</p>
          </div>
        </div>
      `;
      
      handleShowOnMonitor({
        kind: 'html',
        query: html,
        title: `Navigare \u2014 ${appName}`
      });
      
      return `Succes. Am afișat butonul de ${appName} pe monitor. Instruiește utilizatorul vocal să apese pe butonul de pe ecran pentru a lansa navigația. IMPORTANT: NU apela tu show_on_monitor, deoarece cardul este deja afișat!`
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
