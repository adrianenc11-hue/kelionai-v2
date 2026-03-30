// ═══════════════════════════════════════════════════════════════
// App — Deploy Status Indicator
// Afișează o clepsidră animată în timpul deploy-ului
// și confirmă "Deploy finalizat!" când serverul revine
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const HEALTH_URL = window.location.origin + '/api/health';
  const POLL_INTERVAL = 3000; // verifică la fiecare 3s
  const MAX_WAIT = 300000; // timeout 5 minute
  const RESTART_GRACE = 5000; // așteptare inițială 5s pt restart

  let overlay = null;
  let pollTimer = null;
  let startTime = 0;
  let baselineUptime = null;

  // ── CSS Styles (injected once) ──
  function injectStyles() {
    if (document.getElementById('deploy-status-styles')) return;
    const style = document.createElement('style');
    style.id = 'deploy-status-styles';
    style.textContent = `
      #deploy-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(10, 10, 20, 0.92);
        backdrop-filter: blur(8px);
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'Inter', 'Segoe UI', sans-serif;
        color: #e2e8f0;
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      #deploy-overlay.visible { opacity: 1; }

      .deploy-hourglass {
        font-size: 64px;
        animation: deploy-flip 1.5s ease-in-out infinite;
        margin-bottom: 24px;
        filter: drop-shadow(0 0 20px rgba(99, 102, 241, 0.5));
      }
      @keyframes deploy-flip {
        0%   { transform: rotate(0deg); }
        50%  { transform: rotate(180deg); }
        100% { transform: rotate(360deg); }
      }

      .deploy-title {
        font-size: 22px;
        font-weight: 700;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #a5b4fc, #6366f1);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .deploy-subtitle {
        font-size: 14px;
        color: #94a3b8;
        margin-bottom: 20px;
      }
      .deploy-timer {
        font-size: 13px;
        color: #64748b;
        font-variant-numeric: tabular-nums;
      }
      .deploy-progress-bar {
        width: 260px;
        height: 4px;
        background: #1e293b;
        border-radius: 4px;
        overflow: hidden;
        margin: 16px 0;
      }
      .deploy-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #6366f1, #06b6d4);
        border-radius: 4px;
        width: 0%;
        transition: width 0.5s ease;
      }
      .deploy-dots {
        display: inline-block;
        width: 20px;
        text-align: left;
      }

      /* ── Success state ── */
      .deploy-success .deploy-hourglass {
        animation: deploy-pop 0.5s ease forwards;
        font-size: 72px;
      }
      @keyframes deploy-pop {
        0%   { transform: scale(0.8); opacity: 0.5; }
        50%  { transform: scale(1.2); }
        100% { transform: scale(1); opacity: 1; }
      }
      .deploy-success .deploy-title {
        background: linear-gradient(135deg, #34d399, #10b981);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      /* ── Error state ── */
      .deploy-error .deploy-title {
        background: linear-gradient(135deg, #f87171, #ef4444);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Create overlay ──
  function createOverlay() {
    injectStyles();
    overlay = document.createElement('div');
    overlay.id = 'deploy-overlay';
    overlay.innerHTML = `
      <div class="deploy-hourglass">⏳</div>
      <div class="deploy-title">Deploying<span class="deploy-dots"></span></div>
      <div class="deploy-subtitle">Waiting for server restart...</div>
      <div class="deploy-progress-bar"><div class="deploy-progress-fill" id="deploy-progress"></div></div>
      <div class="deploy-timer" id="deploy-timer">0s</div>
    `;
    document.body.appendChild(overlay);
    // Fade in
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('visible');
      });
    });
    // Animate dots
    let dotCount = 0;
    setInterval(function () {
      const dots = overlay.querySelector('.deploy-dots');
      if (dots) {
        dotCount = (dotCount + 1) % 4;
        dots.textContent = '.'.repeat(dotCount);
      }
    }, 500);
  }

  // ── Update timer ──
  function updateTimer() {
    if (!overlay) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timerEl = document.getElementById('deploy-timer');
    if (timerEl) timerEl.textContent = elapsed + 's';
    // Progress bar (approximate, based on typical 60-90s deploy)
    const progressEl = document.getElementById('deploy-progress');
    if (progressEl) {
      const pct = Math.min(95, (elapsed / 120) * 100);
      progressEl.style.width = pct + '%';
    }
  }

  // ── Show success ──
  function showSuccess(uptime) {
    if (!overlay) return;
    overlay.classList.add('deploy-success');
    overlay.querySelector('.deploy-hourglass').textContent = 'Done';
    overlay.querySelector('.deploy-title').textContent = 'Deploy complete!';
    overlay.querySelector('.deploy-subtitle').textContent = 'Server is live • uptime: ' + Math.floor(uptime) + 's';
    const progressEl = document.getElementById('deploy-progress');
    if (progressEl) progressEl.style.width = '100%';
    // Auto-close after 3s
    setTimeout(function () {
      if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(function () {
          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
          overlay = null;
        }, 500);
      }
    }, 3000);
  }

  // ── Show error ──
  function showError(msg) {
    if (!overlay) return;
    overlay.classList.add('deploy-error');
    overlay.querySelector('.deploy-hourglass').textContent = 'Error';
    overlay.querySelector('.deploy-title').textContent = 'Deploy timeout';
    overlay.querySelector('.deploy-subtitle').textContent = msg || 'Server did not respond in time.';
    setTimeout(function () {
      if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(function () {
          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
          overlay = null;
        }, 500);
      }
    }, 5000);
  }

  // ── Poll health endpoint ──
  async function pollHealth() {
    updateTimer();

    // Timeout check
    if (Date.now() - startTime > MAX_WAIT) {
      clearInterval(pollTimer);
      showError('Timeout — server did not come back within 5 minutes.');
      return;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(function () {
        ctrl.abort();
      }, 5000);
      const r = await fetch(HEALTH_URL, { signal: ctrl.signal });
      clearTimeout(timer);

      if (r.ok) {
        const data = await r.json();
        const newUptime = data.uptime || 0;

        // Detect restart: new uptime < baseline uptime means server restarted
        if (baselineUptime !== null && newUptime < baselineUptime && data.status === 'ok') {
          clearInterval(pollTimer);
          showSuccess(newUptime);
          return;
        }

        // First poll — save baseline
        if (baselineUptime === null) {
          baselineUptime = newUptime;
        }
      }
    } catch (_e) {
      // Server is down — this is expected during restart
      const subtitleEl = overlay ? overlay.querySelector('.deploy-subtitle') : null;
      if (subtitleEl) subtitleEl.textContent = 'Server is restarting...';
      // Mark that server went down — next successful poll with low uptime = success
      baselineUptime = Infinity;
    }
  }

  // ── START deploy monitoring ──
  function startDeployMonitor() {
    if (overlay) return; // already monitoring

    startTime = Date.now();
    baselineUptime = null;
    createOverlay();

    // Wait a grace period before polling (deploy needs time to shut down)
    setTimeout(function () {
      pollTimer = setInterval(pollHealth, POLL_INTERVAL);
      pollHealth(); // first check
    }, RESTART_GRACE);
  }

  // ── STOP deploy monitoring (manual cancel) ──
  function stopDeployMonitor() {
    if (pollTimer) clearInterval(pollTimer);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    pollTimer = null;
  }

  // ── Expose globally ──
  window.DeployStatus = {
    start: startDeployMonitor,
    stop: stopDeployMonitor,
  };
})();
