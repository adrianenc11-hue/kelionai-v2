// Live Terminal Module — self-contained monitor terminal for dev operations.
// Renders a terminal UI inside the monitor iframe that receives output
// line-by-line via postMessage. Supports SSE streaming from the server.
//
// Usage:
//   import { showTerminal, postLine, postDone, streamCommand } from './liveTerminal'
//   showTerminal('run_command', 'npm install')   // opens terminal on monitor
//   postLine('stdout', 'added 50 packages')      // sends a line
//   postDone(true, 0)                            // marks completion
//   // OR:
//   const result = await streamCommand('npm install', '/app')  // full SSE stream

import { handleShowOnMonitor } from './monitorStore'

const ESC = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Terminal HTML template ────────────────────────────────────────
// Self-contained HTML page with a live terminal that receives lines
// via window.postMessage({ __kelion_term: true, type, ... }).
export function buildTerminalHtml(toolName, cmdOrInfo) {
  return `<div id="term" style="padding:16px 20px;font-family:'Consolas','Fira Code',monospace;background:#0d1117;color:#e6edf3;min-height:100%;box-sizing:border-box;font-size:13px;line-height:1.6;overflow-y:auto;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d;">
    <div id="spinner" style="width:10px;height:10px;border-radius:50%;border:2px solid #58a6ff;border-top-color:transparent;animation:spin .8s linear infinite;"></div>
    <span style="color:#58a6ff;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">${ESC(toolName)}</span>
    <span id="elapsed" style="color:#484f58;font-size:11px;margin-left:auto;">0.0s</span>
  </div>
  <div style="color:#7d8590;font-size:12px;margin-bottom:8px;">$ ${ESC(cmdOrInfo)}</div>
  <div id="output"></div>
  <div id="cursor" style="display:inline-block;width:8px;height:14px;background:#58a6ff;animation:blink 1s step-end infinite;vertical-align:text-bottom;margin-left:2px;"></div>
</div>
<style>
  @keyframes spin{100%{transform:rotate(360deg)}}
  @keyframes blink{50%{opacity:0}}
  .ln{opacity:0;animation:fadeIn .15s ease forwards}
  @keyframes fadeIn{to{opacity:1}}
  .err{color:#f85149}
  .ok{color:#3fb950}
</style>
<script>
  var t0=Date.now(),out=document.getElementById('output'),el=document.getElementById('elapsed');
  setInterval(function(){el.textContent=((Date.now()-t0)/1000).toFixed(1)+'s'},100);
  window.addEventListener('message',function(e){
    if(!e.data||!e.data.__kelion_term) return;
    var d=e.data;
    if(d.type==='line'){
      var div=document.createElement('div');
      div.className='ln'+(d.stream==='stderr'?' err':'');
      div.textContent=d.text;
      out.appendChild(div);
      div.scrollIntoView({block:'end',behavior:'auto'});
    }
    if(d.type==='done'){
      document.getElementById('cursor').style.display='none';
      var sp=document.getElementById('spinner');
      sp.style.animation='none';
      sp.style.borderColor=d.ok?'#3fb950':'#f85149';
      sp.style.background=d.ok?'#3fb950':'#f85149';
      var fin=document.createElement('div');
      fin.style.cssText='margin-top:12px;padding-top:8px;border-top:1px solid #21262d;font-size:12px;font-weight:600;';
      fin.className=d.ok?'ok':'err';
      fin.textContent=d.ok?'✓ Done ('+((Date.now()-t0)/1000).toFixed(1)+'s)':'✗ Failed (exit '+d.code+')';
      out.appendChild(fin);
      fin.scrollIntoView({block:'end'});
    }
  });
<\/script>`
}

// ── PostMessage to monitor iframe ─────────────────────────────────
export function postLine(stream, text) {
  _postToIframes({ __kelion_term: true, type: 'line', stream, text })
}

export function postDone(ok, code = 0) {
  _postToIframes({ __kelion_term: true, type: 'done', ok, code })
}

function _postToIframes(msg) {
  try {
    const iframes = document.querySelectorAll('iframe')
    for (const f of iframes) {
      try { f.contentWindow.postMessage(msg, '*') } catch {}
    }
  } catch {}
}

// ── Show terminal on monitor ──────────────────────────────────────
export function showTerminal(toolName, cmdOrInfo) {
  handleShowOnMonitor({
    kind: 'html',
    query: buildTerminalHtml(toolName, cmdOrInfo),
    title: `⚡ ${toolName}`,
  })
}

// ── SSE streaming command execution ───────────────────────────────
// Connects to /api/tools/terminal-stream and pipes output to monitor.
// Returns { ok, stdout, stderr } when done.
export async function streamCommand(command, cwd = '') {
  showTerminal('terminal', command)
  await new Promise(r => setTimeout(r, 150)) // let iframe mount

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 125000)

    fetch('/api/tools/terminal-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ command, cwd }),
      signal: controller.signal,
    }).then(async (res) => {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const evt = JSON.parse(payload)
            if (evt.type === 'stdout') {
              stdout += evt.data + '\n'
              postLine('stdout', evt.data)
            } else if (evt.type === 'stderr') {
              stderr += evt.data + '\n'
              postLine('stderr', evt.data)
            } else if (evt.type === 'exit') {
              postDone(evt.data?.code === 0, evt.data?.code)
            } else if (evt.type === 'error') {
              stderr += evt.data + '\n'
              postLine('stderr', evt.data)
              postDone(false, -1)
            }
          } catch {}
        }
      }
      clearTimeout(timeout)
      resolve({ ok: !stderr || !!stdout, stdout: stdout.slice(0, 20000), stderr: stderr.slice(0, 20000) })
    }).catch((err) => {
      clearTimeout(timeout)
      postLine('stderr', err.message)
      postDone(false, -1)
      resolve({ ok: false, error: err.message, stdout: '', stderr: err.message })
    })
  })
}

// ── Display batch result on terminal ──────────────────────────────
// For when SSE fails — takes a completed result and animates it onto
// the already-open terminal display line by line.
export function displayBatchResult(result) {
  const ok = result?.ok !== false
  const output = result?.stdout || result?.error || ''
  String(output).split('\n').slice(0, 50).forEach(line => {
    postLine(ok ? 'stdout' : 'stderr', line)
  })
  if (result?.stderr) {
    String(result.stderr).split('\n').slice(0, 20).forEach(line => {
      postLine('stderr', line)
    })
  }
  postDone(ok, ok ? 0 : 1)
}
