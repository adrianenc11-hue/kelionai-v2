/* ═══════════════════════════════════════════════════════════════
   KelionAI — Admin Panel — Clean Rewrite
   Zero dead code. All data from Supabase/Server APIs.
   Auth: JWT Bearer only.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ── AUTH: JWT token + admin secret ──
var _adminSecret = sessionStorage.getItem('kelion_admin_secret') || '';

function hdrs() {
  var h = { 'Content-Type': 'application/json' };
  // Send admin secret if we have it
  if (_adminSecret) h['x-admin-secret'] = _adminSecret;
  // Also send JWT Bearer token
  var t = localStorage.getItem('kelion_token');
  if (!t) {
    var keys = Object.keys(localStorage).filter(function (k) {
      return k.startsWith('sb-') && k.endsWith('-auth-token');
    });
    for (var i = 0; i < keys.length; i++) {
      try {
        var p = JSON.parse(localStorage.getItem(keys[i]));
        if (p && p.access_token) { t = p.access_token; break; }
      } catch (e) { /* skip */ }
    }
  }
  if (!t) t = localStorage.getItem('sb-access-token');
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s || '—';
  return d.innerHTML;
}

// ── NAVIGATION: buttons → sub-page ──
function openSection(id) {
  document.getElementById('view-buttons').style.display = 'none';
  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('view-section').style.display = 'block';
  var titles = {
    ai: '🤖 AI Credits & Costs',
    brain: '🧠 Brain & Health',
    traffic: '🌐 Trafic — Vizite Complete',
    live: '👥 Live — Acum pe site',
    users: '👤 Users & Revenue',
    memories: '💾 Memories — Ce a învățat K1',
    visitors: '👁️ Vizitatori — Potențiali Leads'
  };
  document.getElementById('section-title').textContent = titles[id] || id;
  document.getElementById('section-content').innerHTML = '<div style="text-align:center;padding:40px;color:#888">Se încarcă...</div>';

  // Load data
  switch (id) {
    case 'ai': loadAiSection(); break;
    case 'brain': loadBrainSection(); break;
    case 'traffic': loadTrafficSection(); break;
    case 'live': loadLiveSection(); break;
    case 'users': loadUsersSection(); break;
    case 'memories': loadMemoriesSection(); break;
    case 'visitors': loadVisitorsSection(); break;
  }
}

function closeSection() {
  document.getElementById('view-section').style.display = 'none';
  document.getElementById('view-buttons').style.display = 'flex';
  document.getElementById('stats-bar').style.display = 'grid';
}

// ═══════════════════════════════════════════════════════════════
// SECTION: AI Credits & Costs
// Endpoints: /api/admin/ai-status + /api/admin/costs
// ═══════════════════════════════════════════════════════════════
async function loadAiSection() {
  var el = document.getElementById('section-content');
  try {
    var [aiR, costR] = await Promise.all([
      fetch('/api/admin/ai-status', { headers: hdrs() }),
      fetch('/api/admin/costs', { headers: hdrs() })
    ]);
    if (!aiR.ok) { el.innerHTML = '<div class="error-msg">❌ Eroare: ' + aiR.status + ' ' + (await aiR.text()) + '</div>'; return; }
    var ai = await aiR.json();
    var costs = costR.ok ? await costR.json() : { byProvider: [], totalToday: 0, totalMonth: 0 };

    var html = '';

    // Month progress
    if (ai.month) {
      html += '<div class="info-banner">📅 Luna: <strong>' + (ai.month.current || '') + '</strong> — Ziua '
        + (ai.month.dayOfMonth || 0) + '/' + (ai.month.daysInMonth || 30) + ' (' + (ai.month.daysLeft || 0) + ' zile rămase)'
        + '<div class="progress-bar"><div class="progress-fill" style="width:' + (ai.month.monthProgress || 0) + '%"></div></div></div>';
    }

    // Cost summary
    html += '<div class="cost-summary">'
      + '<div class="cost-box"><div class="cost-label">Cost Azi</div><div class="cost-value">$' + (costs.totalToday || 0).toFixed(4) + '</div></div>'
      + '<div class="cost-box"><div class="cost-label">Cost Lună</div><div class="cost-value">$' + (costs.totalMonth || 0).toFixed(4) + '</div></div>'
      + '</div>';

    // Provider cards — paid first, free last
    html += '<div class="ai-grid">';
    var sortedProviders = (ai.providers || []).slice().sort(function(a, b) {
      if (a.tier === 'free' && b.tier !== 'free') return 1;
      if (a.tier !== 'free' && b.tier === 'free') return -1;
      return 0;
    });
    sortedProviders.forEach(function (p) {
      var border = p.alertLevel === 'red' ? '#ef4444' : p.alertLevel === 'yellow' ? '#f59e0b' : '#10b981';
      var statusDot = p.live ? '🟢' : '⚫';
      var creditStatus = '';
      if (p.tier === 'free') {
        creditStatus = '<div class="ai-detail" style="color:#22c55e;font-weight:600">🆓 GRATIS — ' + (p.freeQuota || 0).toLocaleString() + ' ' + (p.unit || 'req') + '</div>';
      } else if (p.credit > 1) {
        creditStatus = '<div class="ai-detail" style="color:#22c55e;font-weight:600">✅ Credit OK: $' + p.credit.toFixed(2) + '</div>';
      } else if (p.credit > 0) {
        creditStatus = '<div class="ai-detail" style="color:#f59e0b;font-weight:600">⚠️ Credit scăzut: $' + p.credit.toFixed(2) + '</div>';
      } else {
        creditStatus = '<div class="ai-detail" style="color:#ef4444;font-weight:600">🔴 FĂRĂ CREDIT!</div>';
      }
      html += '<div class="ai-card" style="border-color:' + border + '">'
        + '<div class="ai-header">' + statusDot + ' <strong>' + esc(p.name) + '</strong> <span class="ai-tier">' + (p.tier || '') + '</span></div>'
        + '<div class="ai-cost">Cheltuieli luna: $' + (p.costMonth || 0).toFixed(4) + '</div>'
        + creditStatus
        + '<div class="ai-detail">' + (p.requests || 0) + ' requesturi</div>';
      if (p.creditLimit > 0) {
        var pctRemaining = Math.round((p.credit / p.creditLimit) * 100);
        var barColor = pctRemaining > 50 ? '#22c55e' : pctRemaining > 20 ? '#f59e0b' : '#ef4444';
        html += '<div class="ai-credit">Rămas: $' + (p.credit || 0).toFixed(2) + ' din $' + p.creditLimit.toFixed(2)
          + '<div class="progress-bar"><div class="progress-fill" style="width:' + pctRemaining + '%;background:' + barColor + '"></div></div></div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Cost per provider table
    if (costs.byProvider && costs.byProvider.length > 0) {
      html += '<h3 style="margin-top:20px">📊 Costuri detaliate per provider</h3>';
      html += '<table class="admin-table"><thead><tr><th>Provider</th><th>Requests</th><th>Cost Lună</th><th>Cost Azi</th></tr></thead><tbody>';
      costs.byProvider.forEach(function (p) {
        html += '<tr><td><strong>' + esc(p.provider) + '</strong></td><td>' + (p.requests || 0) + '</td>'
          + '<td>$' + (p.cost_usd || 0).toFixed(4) + '</td><td>$' + (p.cost_today || 0).toFixed(4) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ Eroare: ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Brain & Health
// Endpoint: /api/admin/brain + /api/admin/brain-health
// ═══════════════════════════════════════════════════════════════
async function loadBrainSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/brain', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div class="error-msg">❌ ' + r.status + '</div>'; return; }
    var d = await r.json();

    var html = '<div class="brain-stats">';
    html += '<div class="mini-stat"><span class="label">Uptime:</span> ' + Math.round((d.uptime || 0) / 60) + ' min</div>';
    html += '<div class="mini-stat"><span class="label">Conversații:</span> ' + (d.conversationCount || d.conversations || 0) + '</div>';
    html += '<div class="mini-stat"><span class="label">Mesaje:</span> ' + (d.totalMessages || 0) + '</div>';
    html += '<div class="mini-stat"><span class="label">Erori recente:</span> ' + (d.recentErrors || 0) + '</div>';
    html += '<div class="mini-stat"><span class="label">Versiune:</span> ' + esc(d.version || '—') + '</div>';
    html += '</div>';

    // Providers
    html += '<h3>🌐 Providers</h3><div class="brain-providers">';
    var providers = d.providers || {};
    for (var p in providers) {
      html += '<div class="provider-item">' + (providers[p] ? '🟢' : '⚫') + ' ' + p + '</div>';
    }
    html += '</div>';

    // Tool Usage
    html += '<h3>🔧 Tool Usage</h3><table class="admin-table"><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Status</th></tr></thead><tbody>';
    var tools = d.toolStats || {};
    var errors = d.toolErrors || {};
    for (var t in tools) {
      var err = errors[t] || 0;
      var status = err > 5 ? '🔴' : err > 0 ? '🟡' : '🟢';
      html += '<tr><td>' + esc(t) + '</td><td>' + tools[t] + '</td><td>' + err + '</td><td>' + status + '</td></tr>';
    }
    html += '</tbody></table>';

    // Latency
    if (d.avgLatency && Object.keys(d.avgLatency).length > 0) {
      html += '<h3>⏱ Latency</h3>';
      for (var l in d.avgLatency) {
        html += '<div class="latency-row"><span>' + l + '</span><span>' + d.avgLatency[l] + 'ms</span>'
          + '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.min(100, d.avgLatency[l] / 50 * 100) + '%"></div></div></div>';
      }
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Traffic — COMPLET
// Endpoint: /api/admin/traffic
// ═══════════════════════════════════════════════════════════════
function parseBrowser(ua) {
  if (!ua) return '—';
  if (ua.includes('Chrome') && !ua.includes('Edge')) return '🌐 Chrome';
  if (ua.includes('Firefox')) return '🦊 Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return '🧭 Safari';
  if (ua.includes('Edge')) return '🔵 Edge';
  if (ua.includes('Opera') || ua.includes('OPR')) return '🔴 Opera';
  return '❓ ' + ua.substring(0, 20);
}
function parseDevice(ua) {
  if (!ua) return '—';
  if (/Mobile|Android|iPhone/i.test(ua)) return '📱 Mobile';
  if (/Tablet|iPad/i.test(ua)) return '📋 Tablet';
  return '💻 Desktop';
}

async function loadTrafficSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/traffic', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div class="error-msg">❌ ' + r.status + '</div>'; return; }
    var d = await r.json();

    var html = '';

    // Summary stats
    html += '<div class="traffic-summary">'
      + '<div class="mini-stat"><span class="label">Unici azi:</span> ' + (d.uniqueToday || 0) + '</div>'
      + '<div class="mini-stat"><span class="label">Total azi:</span> ' + (d.totalToday || 0) + '</div>'
      + '<div class="mini-stat"><span class="label">Total all-time:</span> ' + (d.totalAllTime || 0) + '</div>'
      + '<div class="mini-stat"><span class="label">Conexiuni active:</span> ' + (d.activeConnections || 0) + '</div>'
      + '</div>';

    // Daily chart (7 days)
    if (d.daily && d.daily.length > 0) {
      var max = Math.max.apply(null, d.daily.map(function (x) { return x.count; })) || 1;
      html += '<h3>📊 Grafic ultimele 7 zile</h3><div class="traffic-chart">';
      d.daily.forEach(function (day) {
        var pct = Math.round((day.count / max) * 100);
        html += '<div class="bar-col"><div class="bar-value">' + day.count + '</div>'
          + '<div class="bar" style="height:' + pct + '%"></div>'
          + '<div class="bar-label">' + day.date.slice(5) + '</div></div>';
      });
      html += '</div>';
    }

    // Full table with checkboxes for bulk delete
    html += '<h3>📋 Vizite recente</h3>';
    html += '<div style="margin-bottom:10px;display:flex;gap:10px">'
      + '<button class="btn-sm btn-danger" onclick="deleteSelectedVisits()">🗑️ Șterge selectate</button>'
      + '<button class="btn-sm btn-danger" onclick="clearAllTraffic()">🧹 Golește tot traficul</button>'
      + '</div>';
    html += '<table class="admin-table"><thead><tr>'
      + '<th><input type="checkbox" id="select-all-visits" onchange="toggleAllVisits(this)"></th>'
      + '<th>Ora</th><th>Pagina</th><th>IP</th><th>Țara</th><th>Browser</th><th>Device</th><th>Referrer</th>'
      + '</tr></thead><tbody>';
    if (d.recent && d.recent.length > 0) {
      d.recent.forEach(function (v) {
        var time = new Date(v.created_at).toLocaleString('ro-RO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        html += '<tr>'
          + '<td><input type="checkbox" class="visit-cb" value="' + v.id + '"></td>'
          + '<td>' + time + '</td>'
          + '<td>' + esc(v.path) + '</td>'
          + '<td><code>' + esc(v.ip) + '</code></td>'
          + '<td>' + esc(v.country || '—') + '</td>'
          + '<td>' + parseBrowser(v.user_agent) + '</td>'
          + '<td>' + parseDevice(v.user_agent) + '</td>'
          + '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">' + esc(v.referrer || '—') + '</td>'
          + '</tr>';
      });
    } else {
      html += '<tr><td colspan="8" style="text-align:center;color:#888">Nicio vizită înregistrată</td></tr>';
    }
    html += '</tbody></table>';

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}

function toggleAllVisits(master) {
  document.querySelectorAll('.visit-cb').forEach(function (cb) { cb.checked = master.checked; });
}

async function deleteSelectedVisits() {
  var ids = [];
  document.querySelectorAll('.visit-cb:checked').forEach(function (cb) { ids.push(cb.value); });
  if (ids.length === 0) return alert('Selectează cel puțin o vizită.');
  if (!confirm('Ștergi ' + ids.length + ' vizite selectate?')) return;
  try {
    await fetch('/api/admin/traffic/bulk-delete', {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ ids: ids })
    });
    loadTrafficSection();
  } catch (e) { alert('Eroare: ' + e.message); }
}

async function clearAllTraffic() {
  if (!confirm('ATENȚIE: Ștergi TOT traficul? Această acțiune e ireversibilă!')) return;
  try {
    await fetch('/api/admin/traffic/clear-all', { method: 'POST', headers: hdrs() });
    loadTrafficSection();
  } catch (e) { alert('Eroare: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Live Users
// Endpoint: /api/admin/live-users
// ═══════════════════════════════════════════════════════════════
async function loadLiveSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/live-users', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div class="error-msg">❌ ' + r.status + '</div>'; return; }
    var d = await r.json();
    var sessions = d.sessions || d.activeSessions || [];

    var html = '<div class="mini-stat"><span class="label">Sesiuni active:</span> <strong>' + sessions.length + '</strong></div>';

    if (sessions.length > 0) {
      html += '<table class="admin-table"><thead><tr>'
        + '<th>Tip</th><th>IP / User</th><th>Pagina</th>'
        + '<th>🌍 Locație</th><th>🖥 Browser</th><th>⏱ Timp total</th><th>Ultima</th>'
        + '</tr></thead><tbody>';
      sessions.forEach(function (s, idx) {
        var typeBadge = s.userType === 'User'
          ? '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem">👤 User</span>'
          : '<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem">👻 Guest</span>';
        var newBadge = s.isReturning
          ? '<span style="color:#f59e0b;font-size:0.7rem"> 🔄</span>'
          : '<span style="color:#10b981;font-size:0.7rem"> 🆕</span>';
        var loc = (s.country || '—') + (s.city ? ' · ' + s.city : '');
        var device = (s.browser || '—') + ' / ' + (s.os || '—');
        var identity = s.userName ? esc(s.userName) : '<code>' + esc(s.ip) + '</code>';
        html += '<tr style="cursor:pointer" onclick="togglePages(' + idx + ')">'
          + '<td>' + typeBadge + newBadge + '</td>'
          + '<td>' + identity + '</td>'
          + '<td>' + esc(s.currentPage || '/') + '</td>'
          + '<td>' + esc(loc) + '</td>'
          + '<td>' + esc(device) + '</td>'
          + '<td>' + esc(s.totalTime || '—') + '</td>'
          + '<td>' + esc(s.lastActivity || '—') + '</td>'
          + '</tr>';
        // Expandable page history
        if (s.pages && s.pages.length > 0) {
          html += '<tr id="pages-' + idx + '" style="display:none;background:rgba(16,185,129,0.05)">'
            + '<td colspan="7" style="padding:8px 16px">'
            + '<strong>📄 Pagini vizitate (' + s.pages.length + '):</strong><br>';
          s.pages.forEach(function (p) {
            html += '<span style="color:#6ee7b7;margin-right:12px">' + esc(p.time) + '</span> → ' + esc(p.path) + '<br>';
          });
          html += '</td></tr>';
        }
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="text-align:center;padding:40px;color:#888">Nimeni online acum</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}
function togglePages(idx) {
  var row = document.getElementById('pages-' + idx);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Users & Revenue
// Endpoints: /api/admin/users + /api/admin/revenue
// ═══════════════════════════════════════════════════════════════
async function loadUsersSection() {
  var el = document.getElementById('section-content');
  try {
    var [uR, rR] = await Promise.all([
      fetch('/api/admin/users', { headers: hdrs() }),
      fetch('/api/admin/revenue', { headers: hdrs() })
    ]);
    if (!uR.ok) { el.innerHTML = '<div class="error-msg">❌ ' + uR.status + '</div>'; return; }
    var users = await uR.json();
    var rev = rR.ok ? await rR.json() : {};

    var html = '';

    // Revenue summary
    html += '<div class="revenue-summary">'
      + '<div class="mini-stat"><span class="label">Abonați:</span> ' + (rev.subscribers || 0) + '</div>'
      + '<div class="mini-stat"><span class="label">MRR:</span> $' + (rev.mrr || 0).toFixed(2) + '</div>'
      + '<div class="mini-stat"><span class="label">Churn:</span> ' + (rev.churnRate || 0).toFixed(1) + '%</div>'
      + '</div>';

    // Users table
    html += '<h3>👤 Utilizatori (' + (users.users || []).length + ')</h3>';
    html += '<table class="admin-table"><thead><tr><th>Email</th><th>Nume</th><th>Plan</th><th>Înregistrat</th><th>Ultima logare</th><th>Mesaje</th><th>🗑️</th></tr></thead><tbody>';
    (users.users || []).forEach(function (u) {
      var created = u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—';
      var lastSign = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('ro-RO') : '—';
      var planBadge = u.plan === 'premium' ? '<span class="badge badge-ok">Premium</span>'
        : u.plan === 'pro' ? '<span class="badge badge-warn">Pro</span>'
        : '<span class="badge">Free</span>';
      html += '<tr><td>' + esc(u.email) + '</td><td>' + esc(u.name) + '</td><td>' + planBadge + '</td>'
        + '<td>' + created + '</td><td>' + lastSign + '</td><td>' + (u.message_count || 0) + '</td>'
        + '<td><button class="btn-sm btn-danger" onclick="deleteUser(\'' + u.id + '\',\'' + esc(u.email) + '\')">🗑️</button></td></tr>';
    });
    html += '</tbody></table>';

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Memories
// Endpoint: /api/admin/memories
// ═══════════════════════════════════════════════════════════════
async function loadMemoriesSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/memories', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div class="error-msg">❌ ' + r.status + '</div>'; return; }
    var d = await r.json();
    var memories = d.memories || [];

    var html = '<div class="mini-stat"><span class="label">Total memories:</span> ' + memories.length + '</div>';

    if (memories.length > 0) {
      html += '<table class="admin-table"><thead><tr><th>Tip</th><th>Conținut</th><th>Importanță</th><th>Data</th><th>🗑️</th></tr></thead><tbody>';
      memories.forEach(function (m) {
        var date = m.created_at ? new Date(m.created_at).toLocaleDateString('ro-RO') : '—';
        html += '<tr><td><span class="badge">' + esc(m.memory_type || '—') + '</span></td>'
          + '<td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">' + esc((m.content || '').substring(0, 200)) + '</td>'
          + '<td>' + (m.importance || 0) + '/10</td>'
          + '<td>' + date + '</td>'
          + '<td><button class="btn-sm btn-danger" onclick="deleteMemory(\'' + m.id + '\')">🗑️</button></td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="text-align:center;padding:40px;color:#888">Nicio memorie stocată</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}

async function deleteMemory(id) {
  if (!confirm('Ștergi această memorie?')) return;
  try {
    await fetch('/api/admin/memories/' + id, { method: 'DELETE', headers: hdrs() });
    loadMemoriesSection();
  } catch (e) { alert('Eroare: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Visitors — Potential Leads
// Endpoint: /api/admin/visitors
// ═══════════════════════════════════════════════════════════════
async function loadVisitorsSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/visitors', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div class="error-msg">❌ ' + r.status + '</div>'; return; }
    var d = await r.json();
    var visitors = d.visitors || [];

    var html = '<div class="traffic-summary">'
      + '<div class="mini-stat"><span class="label">Total vizitatori:</span> ' + visitors.length + '</div>'
      + '<div class="mini-stat"><span class="label">Potențiali:</span> ' + visitors.filter(function(v){return v.status==='potential'}).length + '</div>'
      + '<div class="mini-stat"><span class="label">Revenitori:</span> ' + visitors.filter(function(v){return v.status==='returning'}).length + '</div>'
      + '<div class="mini-stat"><span class="label">Convertiți:</span> ' + visitors.filter(function(v){return v.status==='converted'}).length + '</div>'
      + '</div>';

    if (visitors.length > 0) {
      html += '<table class="admin-table"><thead><tr>'
        + '<th>Status</th><th>IP</th><th>Țara</th><th>Device</th><th>Browser</th><th>OS</th>'
        + '<th>Ecran</th><th>Vizite</th><th>Timp</th><th>Prima vizită</th><th>Ultima</th><th>Pagini</th>'
        + '</tr></thead><tbody>';
      visitors.forEach(function (v) {
        var statusBadge = v.status === 'converted' ? '<span class="badge badge-ok">✅ Convertit</span>'
          : v.status === 'returning' ? '<span class="badge badge-warn">🔵 Revine</span>'
          : '<span class="badge">🟢 Potențial</span>';
        var firstSeen = v.first_seen ? new Date(v.first_seen).toLocaleDateString('ro-RO') : '—';
        var lastSeen = v.last_seen ? new Date(v.last_seen).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
        var pages = (v.pages_visited || []).slice(-3).map(function(p){ return p.path; }).join(', ') || '—';
        var timeMins = Math.round((v.total_time_sec || 0) / 60);
        html += '<tr>'
          + '<td>' + statusBadge + '</td>'
          + '<td><code>' + esc(v.ip || '—') + '</code></td>'
          + '<td>' + esc(v.country || '—') + '</td>'
          + '<td>' + esc(v.device || '—') + '</td>'
          + '<td>' + esc(v.browser || '—') + '</td>'
          + '<td>' + esc(v.os || '—') + '</td>'
          + '<td>' + (v.screen_width || '?') + 'x' + (v.screen_height || '?') + '</td>'
          + '<td>' + (v.total_visits || 0) + '</td>'
          + '<td>' + timeMins + ' min</td>'
          + '<td>' + firstSeen + '</td>'
          + '<td>' + lastSeen + '</td>'
          + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + esc(pages) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="text-align:center;padding:40px;color:#888">Niciun vizitator înregistrat</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
  }
}

async function deleteUser(id, email) {
  if (!confirm('Ștergi userul ' + email + ' și tot istoricul lui?')) return;
  try {
    var r = await fetch('/api/admin/users/' + id, { method: 'DELETE', headers: hdrs() });
    if (r.ok) {
      alert('User ' + email + ' șters.');
      loadUsersSection();
    } else {
      alert('Eroare: ' + r.status);
    }
  } catch (e) { alert('Eroare: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR — load real data for top stats
// ═══════════════════════════════════════════════════════════════
async function loadStats() {
  try {
    // Users count
    fetch('/api/admin/users', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      document.getElementById('val-users').textContent = (d.users || []).length;
      document.getElementById('preview-users').textContent = (d.users || []).length + ' useri';
    }).catch(function () { document.getElementById('val-users').textContent = '?'; });

    // Traffic
    fetch('/api/admin/traffic', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      document.getElementById('val-views').textContent = d.totalAllTime || d.totalToday || 0;
      document.getElementById('preview-traffic').textContent = (d.totalToday || 0) + ' azi';
    }).catch(function () { document.getElementById('val-views').textContent = '?'; });

    // Costs
    fetch('/api/admin/costs', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      document.getElementById('val-cost-today').textContent = '$' + (d.totalToday || 0).toFixed(4);
      document.getElementById('val-cost-month').textContent = '$' + (d.totalMonth || 0).toFixed(2);
      document.getElementById('preview-ai').textContent = '$' + (d.totalMonth || 0).toFixed(2) + '/luna';
    }).catch(function () {
      document.getElementById('val-cost-today').textContent = '?';
      document.getElementById('val-cost-month').textContent = '?';
    });

    // Brain preview
    fetch('/api/admin/brain', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      var active = 0; var total = 0;
      var providers = d.providers || {};
      for (var p in providers) { total++; if (providers[p]) active++; }
      document.getElementById('preview-brain').textContent = active + '/' + total + ' providers';
      document.getElementById('admin-uptime').textContent = '⏱ ' + Math.round((d.uptime || 0) / 60) + 'min';
    }).catch(function () { });

    // Live preview + Acum Online stat
    fetch('/api/admin/live-users', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      var count = (d.sessions || d.activeSessions || []).length;
      document.getElementById('preview-live').textContent = count + ' online';
      document.getElementById('val-active').textContent = count;
    }).catch(function () { document.getElementById('val-active').textContent = '0'; });

    // Memories preview
    fetch('/api/admin/memories', { headers: hdrs() }).then(function (r) {
      if (r.ok) return r.json(); throw new Error('403');
    }).then(function (d) {
      document.getElementById('preview-memories').textContent = (d.memories || []).length + ' memorii';
    }).catch(function () { });

  } catch (e) {
    console.error('[Admin] Stats error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH CHECK + INIT
// ═══════════════════════════════════════════════════════════════
async function initAdmin() {
  // Step 1: Check if we have a JWT token at all
  var testH = hdrs();
  if (!testH['Authorization'] && !_adminSecret) {
    showAuthError('Nu ești logat. Loghează-te mai întâi pe kelionai.app, apoi revino aici.');
    return;
  }

  // Step 2: Try to get admin secret (optional — JWT alone works too)
  if (!_adminSecret && testH['Authorization']) {
    try {
      var r = await fetch('/api/admin/auth-token', { headers: testH });
      if (r.ok) {
        var d = await r.json();
        if (d.secret) {
          _adminSecret = d.secret;
          sessionStorage.setItem('kelion_admin_secret', _adminSecret);
          console.log('[Admin] Secret obținut automat via JWT ✅');
        }
      } else if (r.status === 403) {
        showAuthError('Emailul tău nu e setat ca admin pe server.\nVerifică ADMIN_EMAIL pe Railway.');
        return;
      } else if (r.status === 401) {
        showAuthError('Token JWT expirat. Re-logheaza-te pe kelionai.app.');
        return;
      } else {
        // 500 = ADMIN_SECRET_KEY not set — OK, JWT auth still works
        console.log('[Admin] Secret nu e configurat, dar JWT funcționează direct');
      }
    } catch (e) {
      console.log('[Admin] auth-token skip, using JWT direct');
    }
  }

  // Step 3: Verify access with a real admin endpoint
  try {
    var check = await fetch('/api/admin/brain', { headers: hdrs() });
    if (!check.ok) {
      showAuthError('Acces refuzat (' + check.status + ').\nEști logat ca adrianenc11@gmail.com?\nAltfel, re-logheaza-te pe kelionai.app.');
      return;
    }
  } catch (e) {
    showAuthError('Server indisponibil: ' + e.message);
    return;
  }

  // Auth OK — load stats
  console.log('[Admin] Autentificat cu succes ✅');
  loadStats();
  setInterval(loadStats, 30000); // refresh every 30s for real-time feel
}

function showAuthError(msg) {
  document.querySelector('.admin-container').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column;text-align:center;padding:20px">'
    + '<div style="font-size:2rem;margin-bottom:16px">🔒</div>'
    + '<div style="font-size:1.2rem;color:#f87171;margin-bottom:12px;font-weight:600">Admin — acces restricționat</div>'
    + '<pre style="color:#888;font-size:0.85rem;white-space:pre-wrap;max-width:500px;margin-bottom:20px;font-family:inherit">' + msg + '</pre>'
    + '<a href="/" style="color:#a5b4fc;text-decoration:none;padding:10px 20px;border:1px solid rgba(99,102,241,0.3);border-radius:8px">← Înapoi la KelionAI</a></div>';
}

// ── START ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
