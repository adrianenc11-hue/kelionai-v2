// ═══════════════════════════════════════════════════════════════
// KelionAI — Product Scanner (Barcode → Nutrition)
// Scan products with back camera, lookup nutritional info,
// display calories/macros, save to Supabase per user
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const API_BASE = window.location.origin;
  let _scanActive = false;
  let _stream = null;
  let _video = null;
  let _overlay = null;
  let _scanInterval = null;
  let _lastBarcode = '';
  let _dailyScans = [];

  // ── BarcodeDetector API (Chrome 83+, Android) ──────────────
  let _detector = null;
  try {
    if (typeof BarcodeDetector !== 'undefined') {
      _detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
      });
      console.log('[Scanner] ✅ BarcodeDetector API available');
    }
  } catch (_e) {
    /* not supported */
  }

  // ── Auth headers ───────────────────────────────────────────
  function authHeaders() {
    if (window.KAuth && KAuth.getAuthHeaders) return KAuth.getAuthHeaders();
    return {};
  }

  // ── Create scan overlay ────────────────────────────────────
  function createOverlay() {
    if (_overlay) return _overlay;

    _overlay = document.createElement('div');
    _overlay.id = 'scan-overlay';
    _overlay.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:9995;display:flex;flex-direction:column">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(20,20,30,0.95);z-index:2">
          <span style="color:#10b981;font-weight:700;font-size:1.1rem">🛒 Product Scanner</span>
          <button id="scan-close-btn" style="background:none;border:1px solid #555;color:#fff;padding:6px 16px;border-radius:20px;cursor:pointer;font-size:0.9rem">✕ Close</button>
        </div>
        <div style="flex:1;position:relative;overflow:hidden">
          <video id="scan-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:260px;height:160px;border:2px solid #10b981;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,0.5)"></div>
          <div id="scan-status" style="position:absolute;bottom:20px;left:0;right:0;text-align:center;color:#10b981;font-size:0.9rem;padding:8px">📷 Point camera at barcode...</div>
        </div>
        <div id="scan-result" style="background:rgba(20,20,30,0.97);max-height:50vh;overflow-y:auto;display:none;padding:16px"></div>
        <div id="scan-daily" style="background:rgba(20,20,30,0.95);padding:12px 16px;border-top:1px solid rgba(16,185,129,0.2);display:none">
          <div style="color:#10b981;font-weight:600;font-size:0.9rem">📊 Daily Total</div>
          <div id="scan-daily-stats" style="color:#ddd;font-size:0.85rem;margin-top:4px"></div>
        </div>
      </div>
    `;
    document.body.appendChild(_overlay);

    document.getElementById('scan-close-btn').addEventListener('click', stopScan);
    return _overlay;
  }

  // ── Start scanning ─────────────────────────────────────────
  async function startScan() {
    if (_scanActive) return;
    _scanActive = true;

    createOverlay();
    _overlay.style.display = 'block';

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      _video = document.getElementById('scan-video');
      _video.srcObject = _stream;
      await _video.play();

      console.log('[Scanner] Camera started, scanning...');
      _lastBarcode = '';

      // Start detection loop
      if (_detector) {
        // Use native BarcodeDetector (fast, no library needed)
        _scanInterval = setInterval(detectBarcode, 300);
      } else {
        // Fallback: use canvas + manual hint
        document.getElementById('scan-status').textContent =
          '📷 Take a photo of the barcode and type the number in chat';
        // Still try to detect with image analysis
        _scanInterval = setInterval(detectWithVision, 2000);
      }
    } catch (e) {
      console.error('[Scanner] Camera error:', e.message);
      stopScan();
    }
  }

  // ── Detect barcode with BarcodeDetector API ────────────────
  async function detectBarcode() {
    if (!_scanActive || !_video || _video.readyState < 2 || !_detector) return;

    try {
      const barcodes = await _detector.detect(_video);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        if (code && code !== _lastBarcode && code.length >= 8) {
          _lastBarcode = code;
          console.log('[Scanner] Barcode detected:', code);
          document.getElementById('scan-status').textContent = '✅ Found: ' + code;
          await lookupProduct(code);
        }
      }
    } catch (_e) {
      /* ignored */
    }
  }

  // ── Fallback: send frame to Vision API for barcode reading ─
  async function detectWithVision() {
    if (!_scanActive || !_video || _video.readyState < 2) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(_video, 0, 0, 640, 480);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1];

      const hdrs = authHeaders();
      hdrs['Content-Type'] = 'application/json';

      const r = await fetch(API_BASE + '/api/scan/barcode-detect', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ imageBase64: base64 }),
        signal: AbortSignal.timeout(5000),
      });

      if (r.ok) {
        const d = await r.json();
        if (d.barcode && d.barcode !== _lastBarcode) {
          _lastBarcode = d.barcode;
          document.getElementById('scan-status').textContent = '✅ Found: ' + d.barcode;
          await lookupProduct(d.barcode);
        }
      }
    } catch (_e) {
      /* ignored */
    }
  }

  // ── Lookup product by barcode ──────────────────────────────
  async function lookupProduct(barcode) {
    const resultDiv = document.getElementById('scan-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color:#10b981;text-align:center;padding:20px">⏳ Looking up product...</div>';

    try {
      const hdrs = authHeaders();
      hdrs['Content-Type'] = 'application/json';

      const r = await fetch(API_BASE + '/api/scan/product', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ barcode }),
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) {
        resultDiv.innerHTML = '<div style="color:#ef4444;padding:16px">❌ Product not found. Try scanning again.</div>';
        _lastBarcode = ''; // Allow re-scan
        return;
      }

      const product = await r.json();
      displayProduct(product);

      // Add to daily log
      if (product.nutrition) {
        _dailyScans.push(product);
        updateDailyStats();
      }
    } catch (e) {
      resultDiv.innerHTML = '<div style="color:#ef4444;padding:16px">❌ Error: ' + escapeHtml(e.message) + '</div>';
      _lastBarcode = '';
    }
  }

  // ── Display product info ───────────────────────────────────
  function displayProduct(p) {
    const resultDiv = document.getElementById('scan-result');
    const n = p.nutrition || {};

    resultDiv.innerHTML = `
      <div style="display:flex;align-items:start;gap:12px;margin-bottom:12px">
        ${p.image ? '<img src="' + escapeHtml(p.image) + '" style="width:80px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0">' : ''}
        <div>
          <div style="color:#fff;font-weight:700;font-size:1.05rem">${escapeHtml(p.name || 'Unknown Product')}</div>
          <div style="color:#aaa;font-size:0.8rem">${escapeHtml(p.brand || '')} ${p.quantity ? '· ' + escapeHtml(p.quantity) : ''}</div>
          <div style="color:#888;font-size:0.75rem;margin-top:2px">Barcode: ${escapeHtml(p.barcode || '')} · 📅 ${new Date().toLocaleString()}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
        <div style="background:rgba(239,68,68,0.15);border-radius:8px;padding:10px;text-align:center">
          <div style="color:#ef4444;font-size:1.3rem;font-weight:700">${n.calories || '?'}</div>
          <div style="color:#aaa;font-size:0.7rem">kcal</div>
        </div>
        <div style="background:rgba(59,130,246,0.15);border-radius:8px;padding:10px;text-align:center">
          <div style="color:#3b82f6;font-size:1.3rem;font-weight:700">${n.proteins || '?'}g</div>
          <div style="color:#aaa;font-size:0.7rem">Proteine</div>
        </div>
        <div style="background:rgba(245,158,11,0.15);border-radius:8px;padding:10px;text-align:center">
          <div style="color:#f59e0b;font-size:1.3rem;font-weight:700">${n.carbs || '?'}g</div>
          <div style="color:#aaa;font-size:0.7rem">Carbohidrați</div>
        </div>
        <div style="background:rgba(16,185,129,0.15);border-radius:8px;padding:10px;text-align:center">
          <div style="color:#10b981;font-size:1.3rem;font-weight:700">${n.fat || '?'}g</div>
          <div style="color:#aaa;font-size:0.7rem">Grăsimi</div>
        </div>
      </div>
      ${
        n.fiber || n.salt || n.sugar
          ? `
      <div style="display:flex;gap:12px;color:#aaa;font-size:0.8rem;margin-bottom:12px;flex-wrap:wrap">
        ${n.sugar ? '<span>🍬 Sugar: ' + n.sugar + 'g</span>' : ''}
        ${n.fiber ? '<span>🌾 Fiber: ' + n.fiber + 'g</span>' : ''}
        ${n.salt ? '<span>🧂 Salt: ' + n.salt + 'g</span>' : ''}
        ${n.saturatedFat ? '<span>🫠 Sat.fat: ' + n.saturatedFat + 'g</span>' : ''}
      </div>`
          : ''
      }
      ${p.nutriscore ? '<div style="margin-bottom:8px"><span style="background:' + nutriscoreColor(p.nutriscore) + ';color:#fff;padding:3px 10px;border-radius:12px;font-weight:700;font-size:0.85rem">Nutri-Score: ' + p.nutriscore.toUpperCase() + '</span></div>' : ''}
      ${p.ingredients ? '<div style="color:#888;font-size:0.75rem;margin-top:8px;max-height:60px;overflow-y:auto"><b>Ingredients:</b> ' + escapeHtml(p.ingredients.substring(0, 300)) + '</div>' : ''}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="scan-again-btn" style="flex:1;background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:10px;border-radius:8px;cursor:pointer;font-weight:600">🔄 Scan Another</button>
        <button id="scan-ask-ai-btn" style="flex:1;background:rgba(99,102,241,0.2);border:1px solid #6366f1;color:#6366f1;padding:10px;border-radius:8px;cursor:pointer;font-weight:600">🤖 Ask AI About This</button>
      </div>
    `;

    // Re-bind buttons
    document.getElementById('scan-again-btn').addEventListener('click', function () {
      _lastBarcode = '';
      resultDiv.style.display = 'none';
      document.getElementById('scan-status').textContent = '📷 Point camera at barcode...';
    });

    document.getElementById('scan-ask-ai-btn').addEventListener('click', function () {
      stopScan();
      // Send product info to chat for AI analysis
      const chatInput = document.getElementById('msg-input');
      if (chatInput) {
        const prompt =
          'Analizează acest produs alimentar: ' +
          (p.name || 'Unknown') +
          (p.brand ? ' de la ' + p.brand : '') +
          '. Calorii: ' +
          (n.calories || '?') +
          'kcal' +
          ', Proteine: ' +
          (n.proteins || '?') +
          'g' +
          ', Carbohidrați: ' +
          (n.carbs || '?') +
          'g' +
          ', Grăsimi: ' +
          (n.fat || '?') +
          'g' +
          '. E sănătos? Cât ar trebui consumat?';
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input'));
        // Auto-submit
        const sendBtn = document.getElementById('btn-send');
        if (sendBtn) sendBtn.click();
      }
    });
  }

  // ── Update daily nutrition stats ───────────────────────────
  function updateDailyStats() {
    const dailyDiv = document.getElementById('scan-daily');
    const statsDiv = document.getElementById('scan-daily-stats');
    if (!dailyDiv || !statsDiv || _dailyScans.length === 0) return;

    dailyDiv.style.display = 'block';
    let totalCal = 0,
      totalP = 0,
      totalC = 0,
      totalF = 0;
    _dailyScans.forEach(function (p) {
      const n = p.nutrition || {};
      totalCal += parseFloat(n.calories) || 0;
      totalP += parseFloat(n.proteins) || 0;
      totalC += parseFloat(n.carbs) || 0;
      totalF += parseFloat(n.fat) || 0;
    });

    statsDiv.innerHTML =
      '<b>' +
      _dailyScans.length +
      '</b> products scanned · ' +
      '🔥 <b>' +
      Math.round(totalCal) +
      '</b> kcal · ' +
      '💪 ' +
      totalP.toFixed(1) +
      'g protein · ' +
      '🍞 ' +
      totalC.toFixed(1) +
      'g carbs · ' +
      '🫠 ' +
      totalF.toFixed(1) +
      'g fat';
  }

  // ── Helpers ────────────────────────────────────────────────
  function nutriscoreColor(score) {
    const colors = { a: '#038141', b: '#85bb2f', c: '#fecb02', d: '#ee8100', e: '#e63e11' };
    return colors[(score || '').toLowerCase()] || '#888';
  }

  function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ── Stop scanning ──────────────────────────────────────────
  function stopScan() {
    _scanActive = false;
    if (_scanInterval) {
      clearInterval(_scanInterval);
      _scanInterval = null;
    }
    if (_stream) {
      _stream.getTracks().forEach(function (t) {
        t.stop();
      });
      _stream = null;
    }
    if (_overlay) {
      _overlay.style.display = 'none';
    }
    _lastBarcode = '';
    console.log('[Scanner] Stopped');
  }

  // ── Manual barcode entry (from chat) ───────────────────────
  async function lookupManual(barcode) {
    return await lookupProduct(barcode);
  }

  // ── Public API ─────────────────────────────────────────────
  window.KScanner = {
    start: startScan,
    stop: stopScan,
    lookup: lookupManual,
    isActive: function () {
      return _scanActive;
    },
    toggle: function () {
      if (_scanActive) stopScan();
      else startScan();
      return _scanActive;
    },
    getDailyScans: function () {
      return _dailyScans;
    },
    clearDaily: function () {
      _dailyScans = [];
    },
  };
})();
