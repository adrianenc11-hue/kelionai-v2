// Kelion Browser Extension — popup script.
// If the iframe fails to load (e.g. offline), show a fallback button.

const frame = document.getElementById('frame')
const body = document.body

frame.addEventListener('error', () => {
  body.innerHTML = `
    <div class="fallback">
      <div style="font-size:32px;margin-bottom:8px">🚫</div>
      <div style="font-weight:700;margin-bottom:6px">Unable to load Kelion</div>
      <div style="font-size:13px;opacity:0.7;margin-bottom:12px">Check your connection or try opening Kelion directly.</div>
      <a href="https://kelionai.app" target="_blank">Open kelionai.app</a>
    </div>`
})
