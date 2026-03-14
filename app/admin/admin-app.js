/* ═══════════════════════════════════════════════════════════════
   KelionAI — Admin Panel V2 App Logic
   External JS to avoid CSP inline-script blocking
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const adminSecret =
  (document.querySelector('meta[name="admin-secret"]') || {}).content ||
  sessionStorage.getItem('kelion_admin_secret') ||
  '';
/**
 * hdrs
 * @returns {*}
 */
function hdrs() {
  const h = { 'Content-Type': 'application/json' };
  if (adminSecret) h['x-admin-secret'] = adminSecret;
  try {
    let t = null;
    // Priority 1: sessionStorage kelion_token (set by auth.js on login)
    t = sessionStorage.getItem('kelion_token');
    // Priority 2: Supabase token keys in localStorage
    if (!t) {
      const keys = Object.keys(localStorage).filter(function (k) {
        return k.startsWith('sb-') && k.endsWith('-auth-token');
      });
      for (let i = 0; i < keys.length; i++) {
        try {
          const raw = localStorage.getItem(keys[i]);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.access_token) {
              t = parsed.access_token;
              break;
            }
          }
        } catch (_e2) {
          /* ignored */
        }
      }
    }
    // Priority 3: direct token fallback
    if (!t) t = localStorage.getItem('sb-access-token');
    if (t) h['Authorization'] = 'Bearer ' + t;
  } catch (_e) {
    /* ignored */
  }
  return h;
}
/**
 * esc
 * @param {*} s
 * @returns {*}
 */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '—';
  return d.innerHTML;
}
/**
 * closeModal
 * @param {*} id
 * @returns {*}
 */
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── AI STATUS ── (auto-monitoring, no manual buttons)
async function loadAiStatus() {
  try {
    const r = await fetch('/api/admin/ai-status', { headers: hdrs() });
    const d = await r.json();
    const grid = document.getElementById('ai-status-grid');
    grid.textContent = '';

    // Month progress header
    if (d.month) {
      const mh = document.createElement('div');
      mh.className = 'month-header';
      mh.textContent =
        '📅 Luna: <strong>' +
        (d.month.current || '') +
        '</strong> — Ziua ' +
        (d.month.dayOfMonth || 0) +
        '/' +
        (d.month.daysInMonth || 30) +
        ' (' +
        (d.month.daysLeft || 0) +
        ' zile rămase) — ' +
        '<span style="display:inline-block;width:100px;height:6px;background:#1f2937;border-radius:3px;vertical-align:middle">' +
        '<span style="display:block;width:' +
        (d.month.monthProgress || 0) +
        '%;height:100%;background:' +
        ((d.month.monthProgress || 0) > 80 ? '#ef4444' : '#818cf8') +
        ';border-radius:3px"></span></span>';
      grid.appendChild(mh);
    }

    (d.providers || []).forEach(function (p) {
      const card = document.createElement('div');
      const borderColor = p.alertLevel === 'red' ? '#ef4444' : p.alertLevel === 'yellow' ? '#f59e0b' : '#10b981';
      card.className = 'ai-card ' + (p.live ? 'live' : 'off');
      card.style.borderColor = borderColor;
      card.style.cursor = 'pointer';

      const tierLabel = p.tier === 'free' ? '🆓 Free' : '💳 Pay';
      const costStr = '$' + (p.costMonth || 0).toFixed(4);
      const reqStr = (p.requests || 0) + ' req';
      const projStr = p.projectedMonth > 0 ? '~$' + p.projectedMonth.toFixed(2) + '/mo' : '';
      const alertDot = p.alertLevel === 'red' ? '🔴' : p.alertLevel === 'yellow' ? '🟡' : '🟢';

      card.textContent =
        '<div class="ai-status-dot ' +
        (p.live ? 'dot-live' : 'dot-off') +
        '"></div>' +
        '<div class="ai-name">' +
        p.name +
        '</div>' +
        '<div class="ai-detail" style="font-size:0.7rem;opacity:0.7">' +
        tierLabel +
        ' — ' +
        reqStr +
        '</div>' +
        '<div class="ai-cost" style="font-size:0.8rem">' +
        costStr +
        '</div>' +
        '<div class="ai-alert" style="font-size:0.7rem;margin-top:2px">' +
        alertDot +
        ' ' +
        (projStr || p.unit || '') +
        '</div>';

      // Click to show details inline
      card.addEventListener('click', function () {
        const existing = card.querySelector('.ai-detail-panel');
        if (existing) {
          existing.remove();
          return;
        }
        // Close other panels
        document.querySelectorAll('.ai-detail-panel').forEach(function (el) {
          el.remove();
        });
        const panel = document.createElement('div');
        panel.className = 'ai-detail-panel';
        panel.style.cssText =
          'margin-top:8px;padding:8px;background:rgba(0,0,0,0.3);border-radius:8px;font-size:0.72rem;line-height:1.5;text-align:left';
        let details = '<div style="color:' + borderColor + ';font-weight:600">' + (p.alertMessage || '') + '</div>';
        details += '<div>📊 Consum luna: <strong>' + costStr + '</strong> (' + reqStr + ')</div>';
        if (p.projectedMonth > 0) details += '<div>📈 Proiecție: ~$' + p.projectedMonth.toFixed(4) + '/lună</div>';
        if (p.freeQuota > 0)
          details += '<div>🎁 Cotă gratuită: ' + p.freeQuota.toLocaleString() + ' ' + (p.unit || '') + '</div>';
        if (p.creditLimit > 0)
          details += '<div>💰 Credit: $' + p.credit.toFixed(2) + ' / $' + p.creditLimit.toFixed(2) + '</div>';
        if (p.pricingUrl)
          details +=
            '<div style="margin-top:4px"><a href="' +
            p.pricingUrl +
            '" target="_blank" style="color:#818cf8;text-decoration:underline">🔗 Dashboard provider</a></div>';
        panel.textContent = details;
        card.appendChild(panel);
      });

      grid.appendChild(card);
    });
  } catch (_e) {
    document.getElementById('ai-status-grid').textContent =
      '<div class="ai-card off"><div class="ai-name">Error</div></div>';
  }
}

// ── TRAFFIC ──
function parseBrowser(ua) {
  if (!ua) return '—';
  if (ua.includes('Chrome') && !ua.includes('Edg')) return '🌐 Chrome';
  if (ua.includes('Edg')) return '🌐 Edge';
  if (ua.includes('Firefox')) return '🦊 Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return '🍎 Safari';
  if (ua.includes('bot') || ua.includes('Bot') || ua.includes('crawl')) return '🤖 Bot';
  return ua.substring(0, 25);
}
/**
 * parseDevice
 * @param {*} ua
 * @returns {*}
 */
function parseDevice(ua) {
  if (!ua) return '—';
  if (ua.includes('Mobile') || ua.includes('Android')) return '📱 Mobile';
  if (ua.includes('iPad') || ua.includes('Tablet')) return '📱 Tablet';
  return '💻 Desktop';
}
/**
 * _deleteVisit
 * @param {*} id
 * @returns {*}
 */
async function _deleteVisit(id) {
  if (!confirm('Ștergi această vizită?')) return;
  try {
    await fetch('/api/admin/traffic/' + id, {
      method: 'DELETE',
      headers: hdrs(),
    });
    loadTraffic();
  } catch (e) {
    console.error(e);
  }
}
/**
 * loadTraffic
 * @returns {*}
 */
async function loadTraffic() {
  try {
    const r = await fetch('/api/admin/traffic', { headers: hdrs() });
    const d = await r.json();
    document.getElementById('traffic-unique').textContent = d.uniqueToday || 0;
    document.getElementById('traffic-total').textContent = d.totalToday || 0;
    document.getElementById('traffic-active').textContent = d.activeConnections || 0;
    // Show all-time total in stats bar (real count from DB, excluding internal IPs)
    document.getElementById('val-views-today').textContent = d.totalAllTime || d.totalToday || 0;
    const chart = document.getElementById('traffic-chart');
    if (d.daily && d.daily.length > 0) {
      const max =
        Math.max.apply(
          null,
          d.daily.map(function (x) {
            return x.count;
          })
        ) || 1;
      chart.textContent = d.daily
        .map(function (day) {
          const pct = Math.round((day.count / max) * 100);
          return (
            '<div class="bar-col"><div class="bar-value">' +
            day.count +
            '</div>' +
            '<div class="bar" style="height:' +
            pct +
            '%"></div>' +
            '<div class="bar-label">' +
            day.date.slice(5) +
            '</div></div>'
          );
        })
        .join('');
    }
    const tbody = document.querySelector('#visits-table tbody');
    if (d.recent && d.recent.length > 0) {
      tbody.textContent = d.recent
        .slice(0, 30)
        .map(function (v) {
          const time = new Date(v.created_at).toLocaleTimeString('ro-RO');
          const browser = parseBrowser(v.user_agent);
          const device = parseDevice(v.user_agent);
          return (
            '<tr><td>' +
            time +
            '</td><td>' +
            esc(v.path) +
            '</td><td>' +
            esc(v.ip) +
            '</td>' +
            '<td>' +
            esc(v.country || '—') +
            '</td><td>' +
            browser +
            '</td><td>' +
            device +
            '</td>' +
            '<td><button class="btn-sm btn-danger" onclick="deleteVisit(\'' +
            v.id +
            '\')" title="Șterge">🗑️</button></td></tr>'
          );
        })
        .join('');
    }
  } catch (_e) {
    /* ignored */
  }
}

// ── CREDIT ──
async function loadCredit() {
  try {
    const r = await fetch('/api/admin/costs', { headers: hdrs() });
    const d = await r.json();
    document.getElementById('val-cost-today').textContent = '$' + (d.totalToday || 0).toFixed(2);
    document.getElementById('val-cost-month').textContent = '$' + (d.totalMonth || 0).toFixed(2);
    const tbody = document.querySelector('#credit-table tbody');
    if (d.byProvider && d.byProvider.length > 0) {
      tbody.textContent = d.byProvider
        .map(function (p) {
          const al =
            p.cost_usd > 5
              ? '<span class="badge badge-danger">⚠️ High</span>'
              : p.cost_usd > 2
                ? '<span class="badge badge-warn">📊 Med</span>'
                : '<span class="badge badge-ok">✅ OK</span>';
          return (
            '<tr><td><strong>' +
            p.provider +
            '</strong></td><td>🟢</td><td>' +
            p.requests +
            '</td>' +
            '<td>$' +
            p.cost_usd.toFixed(4) +
            '</td><td>$' +
            (p.cost_today || 0).toFixed(4) +
            '</td><td>' +
            al +
            '</td></tr>'
          );
        })
        .join('');
    } else {
      tbody.textContent = '<tr><td colspan="6" style="color:#888;text-align:center">No cost data this month</td></tr>';
    }
    if (d.totalMonth > 0) {
      const el = document.getElementById('credit-distribution');
      let distHtml = '<h4 style="margin:12px 0 8px;color:#06b6d4">Distribuție costuri:</h4>';
      d.byProvider.forEach(function (p) {
        const pct = ((p.cost_usd / d.totalMonth) * 100).toFixed(1);
        distHtml +=
          '<div class="dist-row"><span class="dist-name">' +
          p.provider +
          '</span>' +
          '<div class="dist-bar-wrap"><div class="dist-bar" style="width:' +
          pct +
          '%"></div></div>' +
          '<span class="dist-amount">$' +
          p.cost_usd.toFixed(2) +
          ' (' +
          pct +
          '%)</span></div>';
      });
      el.textContent = distHtml;
    } else {
      const el = document.getElementById('credit-distribution');
      if (el) el.textContent = '';
    }
  } catch (_e) {
    const tb = document.querySelector('#credit-table tbody');
    if (tb) tb.textContent = '<tr><td colspan="6" style="color:#f66;text-align:center">Error loading costs</td></tr>';
  }
}

// ── CLIENTS ──
let _clients = [];
/**
 * loadClients
 * @returns {*}
 */
async function loadClients() {
  try {
    const r = await fetch('/api/admin/users', { headers: hdrs() });
    const d = await r.json();
    _clients = d.users || [];
    document.getElementById('val-users').textContent = _clients.length;
    const subs = _clients.filter(function (u) {
      return u.plan && u.plan !== 'free';
    }).length;
    document.getElementById('val-subs').textContent = subs;
    const tbody = document.querySelector('#clients-table tbody');
    if (_clients.length === 0) {
      tbody.textContent = '<tr><td colspan="6" style="color:#888">Niciun client</td></tr>';
      return;
    }
    tbody.textContent = _clients
      .map(function (u) {
        const plan = u.plan || 'free';
        const pb =
          plan === 'premium'
            ? '<span class="badge badge-ok">⭐ Premium</span>'
            : plan === 'pro'
              ? '<span class="badge badge-warn">🔥 Pro</span>'
              : '<span class="badge">Free</span>';
        const date = u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—';
        return (
          '<tr><td>' +
          esc(u.email) +
          '</td><td>' +
          pb +
          '</td><td><span class="badge badge-ok">Active</span></td>' +
          '<td>' +
          date +
          '</td><td>' +
          (u.message_count || 0) +
          '</td>' +
          '<td class="action-cell">' +
          '<button class="btn-sm" onclick="upgradePlan(\'' +
          u.id +
          "','" +
          esc(u.email).replace(/'/g, '') +
          '\')" title="Upgrade">⬆️</button>' +
          '<button class="btn-sm btn-danger" onclick="openRefund(\'' +
          u.id +
          "','" +
          esc(u.email).replace(/'/g, '') +
          "','" +
          plan +
          '\')" title="Refund">💸</button>' +
          '<button class="btn-sm btn-delete" onclick="deleteUser(\'' +
          u.id +
          "','" +
          esc(u.email).replace(/'/g, '') +
          '\')" title="Șterge user">🗑️</button>' +
          '</td></tr>'
        );
      })
      .join('');
  } catch (e) {
    console.error('Clients:', e);
  }
}

// ── REFUND ──
let _refundUid = null;
/**
 * _openRefund
 * @param {*} uid
 * @param {*} email
 * @param {*} plan
 * @returns {*}
 */
function _openRefund(uid, email, plan) {
  _refundUid = uid;
  document.getElementById('refund-email').textContent = email;
  document.getElementById('refund-plan').textContent = plan;
  document.getElementById('refund-reason').value = '';
  document.getElementById('refund-modal').classList.remove('hidden');
}
/**
 * _confirmRefund
 * @returns {*}
 */
async function _confirmRefund() {
  if (!_refundUid) return;
  try {
    const r = await fetch('/api/admin/refund', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({
        userId: _refundUid,
        reason: document.getElementById('refund-reason').value || 'Admin',
      }),
    });
    const d = await r.json();

    closeModal('refund-modal');
    loadClients();
  } catch (e) {
    console.error(e);
  }
}
/**
 * _upgradePlan
 * @param {*} uid
 * @param {*} email
 * @returns {*}
 */
function _upgradePlan(uid, email) {
  const plan = prompt('Upgrade ' + email + ' la:\n\npro / premium / free', 'pro');
  if (!plan) return;
  fetch('/api/admin/upgrade', {
    method: 'POST',
    headers: hdrs(),
    body: JSON.stringify({ userId: uid, plan: plan }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      loadClients();
    });
}
/**
 * _deleteUser
 * @param {*} uid
 * @param {*} email
 * @returns {*}
 */
async function _deleteUser(uid, email) {
  if (!confirm('Sigur vrei să ȘTERGI userul ' + email + '?\n\nAceastă acțiune este IREVERSIBILĂ!')) return;
  if (!confirm('CONFIRMARE FINALĂ:\n\nȘterge definitiv ' + email + '?\n\nToate datele vor fi pierdute.')) return;
  try {
    const r = await fetch('/api/admin/users/' + uid, {
      method: 'DELETE',
      headers: hdrs(),
    });
    const d = await r.json();
    if (r.ok) {
      loadClients();
    } else {
      alert('❌ Eroare: ' + (d.error || 'necunoscută'));
    }
  } catch (e) {
    console.error(e);
  }
}

// ── CODES ──
async function loadCodes() {
  try {
    const r = await fetch('/api/admin/codes', { headers: hdrs() });
    const d = await r.json();
    const codes = d.codes || [];
    const tbody = document.querySelector('#codes-table tbody');
    if (codes.length === 0) {
      tbody.textContent = '<tr><td colspan="6" style="color:#888">Niciun cod</td></tr>';
      return;
    }
    tbody.textContent = codes
      .map(function (c) {
        const sb =
          c.uses_remaining !== null && c.uses_remaining < 1
            ? '<span class="badge badge-warn">Folosit</span>'
            : '<span class="badge badge-ok">Activ</span>';
        return (
          '<tr><td><code>' +
          esc(c.code) +
          '</code></td><td>' +
          esc(c.type || 'admin') +
          '</td><td>' +
          sb +
          '</td>' +
          '<td>' +
          (c.created_at ? new Date(c.created_at).toLocaleDateString('ro-RO') : '—') +
          '</td>' +
          '<td>' +
          esc(c.value || '—') +
          '</td>' +
          '<td><button class="btn-sm btn-danger" onclick="deleteCode(\'' +
          c.id +
          '\')">🗑️</button></td></tr>'
        );
      })
      .join('');
  } catch (_e) {
    /* ignored */
  }
}
/**
 * _generateCode
 * @returns {*}
 */
async function _generateCode() {
  const type = prompt('Tip cod (admin / promo / beta):', 'admin');
  if (!type) return;
  try {
    const r = await fetch('/api/admin/codes', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ type: type }),
    });
    const d = await r.json();
    alert('Cod generat: ' + (d.code || '?'));
    loadCodes();
  } catch (_e) {
    console.error(_e);
  }
}
/**
 * _deleteCode
 * @param {*} id
 * @returns {*}
 */
async function _deleteCode(id) {
  if (!confirm('Ștergi codul?')) return;
  await fetch('/api/admin/codes/' + id, { method: 'DELETE', headers: hdrs() });
  loadCodes();
}

// ── RECHARGE ──
async function _recharge() {
  const btn = document.getElementById('btn-recharge');
  btn.disabled = true;
  btn.textContent = '⏳...';
  try {
    const r = await fetch('/api/admin/recharge', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ amount: 50, currency: 'gbp' }),
    });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else {
      btn.textContent = '✅';
      loadCredit();
    }
  } catch (_e) {
    btn.disabled = false;
    btn.textContent = '⚡ Reîncărcare £50';
  }
}

// ── UPTIME ──
async function loadUptime() {
  try {
    const r = await fetch('/health');
    const d = await r.json();
    const m = Math.round(d.uptime / 60),
      h = Math.floor(m / 60);
    document.getElementById('admin-uptime').textContent = '⏱ ' + (h > 0 ? h + 'h ' : '') + (m % 60) + 'm';
  } catch (_e) {
    /* ignored */
  }
}

// ── TOGGLE SECTIONS (Accordion) ──
function _toggleSection(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  const arrow = panel.querySelector('.toggle-arrow');
  if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

// ── CODE AUDIT ──
async function loadAudit() {
  const el = document.getElementById('audit-results');
  if (!el) return;
  try {
    const r = await fetch('/api/admin/audit-hardcoded', { headers: hdrs() });
    const d = await r.json();
    if (d.clean) {
      el.textContent =
        '<div style="text-align:center;padding:20px;color:#00ff88;font-size:1.2rem">' +
        '✅ CLEAN — Zero hardcoded values<br>' +
        '<small style="color:#888">' +
        d.filesScanned +
        ' files scanned · ' +
        d.scannedAt +
        '</small></div>';
    } else {
      let html =
        '<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div class="badge badge-danger">🔴 Critical: ' +
        d.critical +
        '</div>' +
        '<div class="badge badge-warn">🟠 High: ' +
        d.high +
        '</div>' +
        '<div class="badge">🟡 Medium: ' +
        d.medium +
        '</div>' +
        '<small style="color:#888;align-self:center">' +
        d.filesScanned +
        ' files · ' +
        d.scannedAt +
        '</small>' +
        '</div>';
      const all = [].concat(d.findings.CRITICAL || [], d.findings.HIGH || [], d.findings.MEDIUM || []);
      if (all.length > 0) {
        html +=
          '<table class="data-table"><thead><tr><th>File</th><th>Line</th><th>Pattern</th><th>Code</th></tr></thead><tbody>';
        all.forEach(function (f) {
          const sev =
            f.pattern.includes('Key') || f.pattern.includes('Bearer')
              ? 'badge-danger'
              : f.pattern.includes('domain') || f.pattern.includes('URL')
                ? 'badge-warn'
                : '';
          html +=
            '<tr><td><code>' +
            esc(f.file) +
            '</code></td><td>' +
            f.line +
            '</td>' +
            '<td><span class="badge ' +
            sev +
            '">' +
            esc(f.pattern) +
            '</span></td>' +
            '<td><code style="font-size:0.7rem;word-break:break-all">' +
            esc(f.snippet) +
            '</code></td></tr>';
        });
        html += '</tbody></table>';
        html +=
          '<button class="btn-sm" onclick="runAutoFix()" style="margin-top:8px;background:#6366f1">🔧 Auto-Fix All</button>';
      }
      el.textContent = html;
    }
  } catch (e) {
    el.textContent = '<div style="color:#f87171">Error loading audit: ' + e.message + '</div>';
  }
}

/**
 * _runAutoFix
 * @returns {*}
 */
async function _runAutoFix() {
  if (!confirm('Brain-ul va înlocui automat valorile hardcodate cu process.env.APP_URL. Continui?')) return;
  try {
    const r = await fetch('/api/admin/audit-hardcoded/fix', {
      method: 'POST',
      headers: hdrs(),
    });
    const d = await r.json();

    loadAudit();
  } catch (e) {
    console.error(e);
  }
}

// ── MEDIA HISTORY ──
async function loadMedia() {
  try {
    const r = await fetch('/api/admin/media', { headers: hdrs() });
    const d = await r.json();
    const stats = d.stats || {};

    document.getElementById('media-total').textContent = d.totalCount || 0;
    document.getElementById('media-images').textContent = (stats.image || 0) + (stats.vision || 0);
    document.getElementById('media-tts').textContent = stats.tts || 0;
    const otherCount = (d.totalCount || 0) - (stats.image || 0) - (stats.vision || 0) - (stats.tts || 0);
    document.getElementById('media-other').textContent = Math.max(0, otherCount);

    const tb = document.getElementById('media-tbody');
    if (!d.recent || d.recent.length === 0) {
      const msg =
        d.totalCount > 0
          ? d.totalCount + ' records in database (details restricted by row-level security)'
          : 'No media generated yet';
      tb.textContent = '<tr><td colspan="5" style="color:#888;text-align:center">' + msg + '</td></tr>';
      return;
    }
    tb.textContent = d.recent
      .map(function (m) {
        const date = new Date(m.created_at).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
        const urlCell = m.url ? '<a href="' + esc(m.url) + '" target="_blank" style="color:#06B6D4">View</a>' : '—';
        const prompt = m.prompt ? esc(m.prompt).substring(0, 60) + (m.prompt.length > 60 ? '…' : '') : '—';
        return (
          '<tr><td>' +
          esc(date) +
          '</td><td>' +
          esc(m.type || '—') +
          '</td><td style="font-size:0.7rem">' +
          esc((m.user_id || '').substring(0, 8)) +
          '</td><td>' +
          prompt +
          '</td><td>' +
          urlCell +
          '</td></tr>'
        );
      })
      .join('');
  } catch (_e) {
    document.getElementById('media-tbody').textContent =
      '<tr><td colspan="5" style="color:#f66">Error loading media</td></tr>';
  }
}

// ── TRADING ──
async function loadTrading() {
  try {
    const r = await fetch('/api/admin/trading', { headers: hdrs() });
    const d = await r.json();
    const s = d.stats || {};

    document.getElementById('trade-total').textContent = s.totalTrades || 0;
    document.getElementById('trade-active').textContent = s.activeTrades || 0;
    const pnlVal = parseFloat(s.totalPnl) || 0;
    const pnlEl = document.getElementById('trade-pnl');
    pnlEl.textContent = (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(2) + ' $';
    pnlEl.style.color = pnlVal >= 0 ? '#10B981' : '#EF4444';
    document.getElementById('trade-winrate').textContent = (s.winRate || 0) + '%';
    const binanceEl = document.getElementById('trade-binance');
    binanceEl.textContent = s.binanceConfigured
      ? s.binanceMode === 'testnet'
        ? '🟡 Testnet'
        : '🟢 Live'
      : '🔴 Not configured';

    // Recent trades
    const tb = document.getElementById('trading-tbody');
    if (!d.recentTrades || d.recentTrades.length === 0) {
      tb.textContent = '<tr><td colspan="7" style="color:#666;text-align:center">No trades yet</td></tr>';
    } else {
      tb.textContent = d.recentTrades
        .slice(0, 20)
        .map(function (t) {
          const date = new Date(t.created_at).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          const pnl = parseFloat(t.pnl) || 0;
          const pnlColor = pnl > 0 ? '#10B981' : pnl < 0 ? '#EF4444' : '#888';
          const sideColor = t.side === 'buy' ? '#10B981' : '#EF4444';
          return (
            '<tr><td>' +
            esc(date) +
            '</td><td><strong>' +
            esc(t.symbol || '—') +
            '</strong></td><td style="color:' +
            sideColor +
            '">' +
            esc((t.side || '—').toUpperCase()) +
            '</td><td>' +
            esc(t.quantity || '—') +
            '</td><td>$' +
            esc(parseFloat(t.price || 0).toFixed(2)) +
            '</td><td>' +
            esc(t.status || '—') +
            '</td><td style="color:' +
            pnlColor +
            '">' +
            (pnl >= 0 ? '+' : '') +
            pnl.toFixed(2) +
            '</td></tr>'
          );
        })
        .join('');
    }

    // Intelligence
    const ib = document.getElementById('intel-tbody');
    if (!d.intelligence || d.intelligence.length === 0) {
      ib.textContent = '<tr><td colspan="5" style="color:#666;text-align:center">No intelligence data yet</td></tr>';
    } else {
      ib.textContent = d.intelligence
        .slice(0, 10)
        .map(function (i) {
          const date = new Date(i.created_at).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          const signalColor = i.signal === 'buy' ? '#10B981' : i.signal === 'sell' ? '#EF4444' : '#F59E0B';
          const analysis = i.analysis ? esc(String(i.analysis)).substring(0, 80) + '…' : '—';
          return (
            '<tr><td>' +
            esc(date) +
            '</td><td><strong>' +
            esc(i.symbol || '—') +
            '</strong></td><td style="color:' +
            signalColor +
            '">' +
            esc((i.signal || '—').toUpperCase()) +
            '</td><td>' +
            esc(Math.round((i.confidence || 0) * 100)) +
            '%</td><td style="font-size:0.78rem">' +
            analysis +
            '</td></tr>'
          );
        })
        .join('');
    }
  } catch (_e) {
    document.getElementById('trading-tbody').textContent =
      '<tr><td colspan="7" style="color:#f66">Error loading trades</td></tr>';
  }
}

// ── MEMORY PANEL ──
async function loadMemories(typeFilter, searchQuery) {
  try {
    let url = '/api/admin/memories?limit=50';
    if (typeFilter && typeFilter !== 'all') url += '&type=' + encodeURIComponent(typeFilter);
    if (searchQuery) url += '&search=' + encodeURIComponent(searchQuery);
    const r = await fetch(url, { headers: hdrs() });
    const d = await r.json();

    // Stats
    const statsEl = document.getElementById('memory-stats');
    if (statsEl) {
      statsEl.textContent =
        '<span class="badge badge-ok">🧠 ' +
        (d.totalMemories || 0) +
        ' memories</span> ' +
        '<span class="badge">📚 ' +
        (d.totalFacts || 0) +
        ' facts</span>';
    }

    // Type filters
    const filtersEl = document.getElementById('memory-filters');
    if (filtersEl && d.types) {
      filtersEl.textContent =
        '<button class="btn-sm' +
        (!typeFilter || typeFilter === 'all' ? ' active' : '') +
        '" onclick="loadMemories(\'all\')">📊 All</button> ' +
        d.types
          .map(function (t) {
            const count = d.typeStats[t] || 0;
            const active = typeFilter === t ? ' active' : '';
            return (
              '<button class="btn-sm' +
              active +
              '" onclick="loadMemories(\'' +
              t +
              '\')">' +
              t +
              ' (' +
              count +
              ')</button>'
            );
          })
          .join(' ');
    }

    // Memories table
    const tb = document.getElementById('memories-tbody');
    if (!d.memories || d.memories.length === 0) {
      tb.textContent = '<tr><td colspan="5" style="color:#888;text-align:center">No memories found</td></tr>';
    } else {
      tb.textContent = d.memories
        .map(function (m) {
          const date = new Date(m.created_at).toLocaleString('ro-RO', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          const content = esc(m.content || '').substring(0, 120) + (m.content && m.content.length > 120 ? '…' : '');
          const imp =
            m.importance >= 8
              ? '<span class="badge badge-danger">⭐ ' + m.importance + '</span>'
              : m.importance >= 5
                ? '<span class="badge badge-warn">' + m.importance + '</span>'
                : '<span class="badge">' + (m.importance || 0) + '</span>';
          return (
            '<tr><td>' +
            esc(date) +
            '</td><td><span class="badge badge-ok">' +
            esc(m.type || '?') +
            '</span></td>' +
            '<td style="font-size:0.78rem">' +
            content +
            '</td><td>' +
            imp +
            '</td>' +
            '<td><button class="btn-sm btn-danger" onclick="deleteMemory(\'' +
            m.id +
            '\')">🗑️</button></td></tr>'
          );
        })
        .join('');
    }

    // Facts table
    const ftb = document.getElementById('facts-tbody');
    if (ftb) {
      if (!d.facts || d.facts.length === 0) {
        ftb.textContent = '<tr><td colspan="4" style="color:#888;text-align:center">No facts learned yet</td></tr>';
      } else {
        ftb.textContent = d.facts
          .map(function (f) {
            const date = new Date(f.created_at).toLocaleString('ro-RO', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              '<tr><td>' +
              esc(date) +
              '</td><td>' +
              esc(f.category || '—') +
              '</td>' +
              '<td style="font-size:0.78rem">' +
              esc((f.fact || '').substring(0, 150)) +
              '</td>' +
              '<td>' +
              esc(f.source || '—') +
              '</td></tr>'
            );
          })
          .join('');
      }
    }
  } catch (e) {
    const tb = document.getElementById('memories-tbody');
    if (tb) tb.textContent = '<tr><td colspan="5" style="color:#f66">Error: ' + e.message + '</td></tr>';
  }
}
/**
 * _deleteMemory
 * @param {*} id
 * @returns {*}
 */
async function _deleteMemory(id) {
  if (!confirm('Ștergi această memorie?')) return;
  try {
    await fetch('/api/admin/memories/' + id, {
      method: 'DELETE',
      headers: hdrs(),
    });
    loadMemories();
  } catch (e) {
    console.error(e);
  }
}
/**
 * _searchMemories
 * @returns {*}
 */
function _searchMemories() {
  const q = document.getElementById('memory-search');
  loadMemories(null, q ? q.value : '');
}

// ── BRAIN STATUS ──
async function loadBrain() {
  try {
    const r = await fetch('/api/admin/brain', { headers: hdrs() });
    const d = await r.json();

    // Uptime
    const uptSec = d.uptime || 0;
    const uptH = Math.floor(uptSec / 3600);
    const uptM = Math.floor((uptSec % 3600) / 60);
    document.getElementById('brain-uptime').textContent = uptH + 'h ' + uptM + 'm';

    // Conversations (from DB — persists across deploys)
    document.getElementById('brain-conversations').textContent = d.conversationCount || 0;
    const convEl = document.getElementById('val-conversations');
    if (convEl) convEl.textContent = d.conversationCount || 0;
    // Total messages badge (if element exists)
    const msgEl = document.getElementById('brain-messages');
    if (msgEl) msgEl.textContent = d.totalMessages || 0;

    // Provider count
    let provActive = 0;
    if (d.providers) {
      Object.values(d.providers).forEach(function (v) {
        if (v) provActive++;
      });
    }
    document.getElementById('brain-providers').textContent = provActive + '/9';

    // Tool stats
    const toolsEl = document.getElementById('brain-tools');
    if (toolsEl && d.toolStats) {
      toolsEl.textContent = Object.entries(d.toolStats)
        .map(function (kv) {
          const icon = kv[1] > 0 ? '🟢' : '⚪';
          return (
            '<span class="badge ' +
            (kv[1] > 0 ? 'badge-ok' : '') +
            '" style="font-size:0.78rem">' +
            icon +
            ' ' +
            kv[0] +
            ': ' +
            kv[1] +
            '</span>'
          );
        })
        .join('');
    }

    // Provider keys
    const keysEl = document.getElementById('brain-provider-keys');
    if (keysEl && d.providers) {
      keysEl.textContent = Object.entries(d.providers)
        .map(function (kv) {
          const icon = kv[1] ? '🟢' : '🔴';
          return (
            '<span class="badge ' +
            (kv[1] ? 'badge-ok' : 'badge-danger') +
            '" style="font-size:0.78rem">' +
            icon +
            ' ' +
            kv[0] +
            '</span>'
          );
        })
        .join('');
    }
  } catch (e) {
    console.error('Brain load error:', e);
    document.getElementById('brain-uptime').textContent = 'Error';
  }
}

// ── INIT — Auth-guarded (#156: prevent 403 flood) ──
let _adminIntervals = [];
/**
 * initAdmin
 * @returns {*}
 */
async function initAdmin() {
  // Auto-fetch admin secret via JWT if not already set
  if (!adminSecret) {
    try {
      const h = {};
      let t = sessionStorage.getItem('kelion_token');
      if (!t) {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
        for (const k of keys) {
          try {
            const p = JSON.parse(localStorage.getItem(k));
            if (p?.access_token) {
              t = p.access_token;
              break;
            }
          } catch {}
        }
      }
      if (!t) t = localStorage.getItem('sb-access-token');
      if (t) {
        h['Authorization'] = 'Bearer ' + t;
        const r = await fetch('/api/admin/auth-token', { headers: h });
        if (r.ok) {
          const d = await r.json();
          if (d.secret) {
            // Update global adminSecret and save to sessionStorage
            window.adminSecret = d.secret;
            sessionStorage.setItem('kelion_admin_secret', d.secret);
          }
        }
      }
    } catch (e) {
      console.warn('[Admin] Auto-auth failed:', e.message);
    }
  }
  // Rebuild hdrs with potentially updated secret
  const currentSecret = window.adminSecret || sessionStorage.getItem('kelion_admin_secret') || '';

  // Check auth before loading anything (with retry for cold-start)
  async function checkAdminAuth() {
    const headers = hdrs();
    if (currentSecret) headers['x-admin-secret'] = currentSecret;
    const testR = await fetch('/api/admin/ai-status', { headers });
    return testR.status !== 401 && testR.status !== 403;
  }
  try {
    let ok = await checkAdminAuth();
    if (!ok) {
      console.warn('[Admin] First auth check failed, retrying in 1.5s...');
      await new Promise((r) => setTimeout(r, 1500));
      ok = await checkAdminAuth();
    }
    if (!ok) {
      document.body.textContent =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#f66;font-size:1.5rem;background:#0a0a14;"><div>🔒 Admin access denied</div><div style="font-size:0.9rem;color:#888;margin-top:8px">Please enter admin code in chat first.</div><a href="/" style="margin-top:16px;color:#a5b4fc;text-decoration:none;">← Back to KelionAI</a></div>';
      return;
    }
  } catch (e) {
    console.warn('[Admin] Auth check failed:', e.message);
  }
  // Auth OK — load all sections
  loadAiStatus();
  loadBrain();
  loadTraffic();
  loadCredit();
  loadClients();
  loadCodes();
  loadUptime();
  loadAudit();
  loadMedia();
  loadTrading();
  loadMemories();
  _adminIntervals.push(
    setInterval(function () {
      loadTraffic();
      loadCredit();
      loadUptime();
    }, 30000)
  );
  _adminIntervals.push(setInterval(loadAiStatus, 60000));
  _adminIntervals.push(setInterval(loadBrain, 60000));
  _adminIntervals.push(setInterval(loadAudit, 6 * 60 * 60 * 1000));
  _adminIntervals.push(
    setInterval(function () {
      loadMedia();
      loadTrading();
    }, 60000)
  );
  _adminIntervals.push(setInterval(loadMemories, 120000)); // refresh memories every 2min
}
// ── EXIT ADMIN — preserve user session ──
function _exitAdmin() {
  // Stop all intervals
  _adminIntervals.forEach(function (id) {
    clearInterval(id);
  });
  _adminIntervals = [];
  // Sync Supabase token from localStorage to sessionStorage
  // so homepage auth.js checkSession() finds the user session
  try {
    const keys = Object.keys(localStorage).filter(function (k) {
      return k.startsWith('sb-') && k.endsWith('-auth-token');
    });
    for (let i = 0; i < keys.length; i++) {
      try {
        const raw = localStorage.getItem(keys[i]);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.access_token) {
            sessionStorage.setItem('kelion_token', parsed.access_token);
            if (parsed.refresh_token) sessionStorage.setItem('kelion_refresh_token', parsed.refresh_token);
            if (parsed.expires_at) sessionStorage.setItem('kelion_token_expires', String(parsed.expires_at));
            if (parsed.user) sessionStorage.setItem('kelion_user', JSON.stringify(parsed.user));
            break;
          }
        }
      } catch (_e2) {
        /* ignored */
      }
    }
  } catch (e) {
    console.warn('[Admin] Token sync failed:', e.message);
  }
  window.location.href = '/';
}

initAdmin();

// ══════════════════════════════════════════════════════════
// REAL-TIME NOTIFICATIONS (SSE)
// ══════════════════════════════════════════════════════════
let _notifCount = 0;
let _notifs = [];
let _notifSSE = null;

/**
 * initNotifications
 * @returns {*}
 */
function initNotifications() {
  if (typeof EventSource === 'undefined') return;
  try {
    _notifSSE = new EventSource('/api/admin/notifications/stream');
    _notifSSE.onmessage = function (e) {
      try {
        const n = JSON.parse(e.data);
        _notifs.unshift(n);
        if (_notifs.length > 30) _notifs.pop();
        _notifCount++;
        updateNotifBadge();
        renderNotifList();
      } catch {
        /* ignored */
      }
    };
    _notifSSE.onerror = function () {
      console.warn('[Notifications] SSE connection error — will retry');
    };
  } catch (e) {
    console.warn('[Notifications] Init failed:', e.message);
  }
}

/**
 * updateNotifBadge
 * @returns {*}
 */
function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (_notifCount > 0) {
    badge.style.display = 'inline';
    badge.textContent = _notifCount > 99 ? '99+' : _notifCount;
  } else {
    badge.style.display = 'none';
  }
}

/**
 * _toggleNotifications
 * @returns {*}
 */
function _toggleNotifications() {
  const dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  if (dd.style.display === 'block') {
    _notifCount = 0;
    updateNotifBadge();
  }
}

/**
 * _clearNotifications
 * @returns {*}
 */
function _clearNotifications() {
  _notifs = [];
  _notifCount = 0;
  updateNotifBadge();
  renderNotifList();
}

/**
 * renderNotifList
 * @returns {*}
 */
function renderNotifList() {
  const el = document.getElementById('notif-list');
  if (!el) return;
  if (_notifs.length === 0) {
    el.textContent = '<div style="padding:12px;text-align:center;color:#666">No notifications</div>';
    return;
  }
  const colors = {
    info: '#3b82f6',
    warn: '#f59e0b',
    error: '#ef4444',
    success: '#22c55e',
    trade: '#8b5cf6',
    user: '#06b6d4',
    system: '#6366f1',
  };
  el.textContent = _notifs
    .map(function (n) {
      const c = colors[n.type] || '#666';
      const time = n.timestamp ? new Date(n.timestamp).toLocaleTimeString() : '';
      return (
        '<div style="padding:6px 8px;border-left:3px solid ' +
        c +
        ';margin-bottom:4px;border-radius:4px;background:rgba(255,255,255,0.02)">' +
        '<div style="color:#e0e0e0">' +
        (n.message || '') +
        '</div>' +
        '<div style="color:#666;font-size:0.7rem;margin-top:2px">' +
        time +
        '</div>' +
        '</div>'
      );
    })
    .join('');
}

// Close dropdown on click outside
document.addEventListener('click', function (e) {
  const w = document.getElementById('notif-wrapper');
  const dd = document.getElementById('notif-dropdown');
  if (w && dd && !w.contains(e.target)) dd.style.display = 'none';
});

// Start SSE
initNotifications();