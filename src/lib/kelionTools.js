// Stage 4 — client-side bridge for Gemini Live function tools.
// When Gemini Live emits a toolCall, geminiLive.js calls runTool(name, args)
// which proxies to our backend. The backend owns credentials (BROWSER_USE_API_KEY,
// MCP tokens, etc.); the client just shuttles.

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
    default:
      return `Tool "${name}" is not implemented on this build.`
  }
}
