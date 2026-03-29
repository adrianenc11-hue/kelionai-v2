/* ═══════════════════════════════════════════════════════════════
   App — Admin Panel — Clean Rewrite
   Zero dead code. All data from Supabase/Server APIs.
   Auth: JWT Bearer only.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
        if (p && p.access_token) {
          t = p.access_token;
          break;
        }
      } catch (e) {
        /* skip */
      }
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
function escAttr(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function safeImgSrc(url) {
  if (!url) return '';
  if (url.startsWith('data:image/') || url.startsWith('https://') || url.startsWith('http://')) return escAttr(url);
  return '';
}

// ── NAVIGATION: buttons → sub-page ──
function openSection(id) {
  document.getElementById('view-buttons').style.display = 'none';
  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('view-section').style.display = 'block';
  var titles = {
    ai:       '🤖 AI Credits & Costs',
    brain:    '🧠 Brain & Health',
    traffic:  '🌐 Traffic — Full Visits',
    live:     '👥 Live — Currently Online',
    users:    '👤 Users & Revenue',
    memories: '💾 Memories — What K1 Learned',
    visitors: '👁️ Visitors — Potential Leads',
    history:  '📜 Conversation History',
    logs:     '📋 Admin Logs',
    contact:  '✉️ Contact Inbox',
    healer:   '🔧 Self-Healing Engine',
    refunds:  '💸 Refund Requests',
  };
  document.getElementById('section-title').textContent = titles[id] || id;
  document.getElementById('section-content').innerHTML =
    '<div style="text-align:center;padding:40px;color:#888">Loading...</div>';

  // Clear previous auto-refresh
  if (window._adminRefresh) {
    clearInterval(window._adminRefresh);
    window._adminRefresh = null;
  }

  // Get loader function
  var loaderFn = null;
  switch (id) {
    case 'ai':
      loadAiSection();
      break;
    case 'brain':
      loaderFn = loadBrainSection;
      break;
    case 'traffic':
      loadTrafficSection();
      break;
    case 'live':
      loaderFn = loadLiveSection;
      break;
    case 'users':
      loadUsersSection();
      break;
    case 'memories':
      loadMemoriesSection();
      break;
    case 'visitors':
      loaderFn = loadVisitorsSection;
      break;
    case 'history':
      loadHistorySection();
      break;
    case 'logs':
      loadLogsSection();
      break;
    case 'contact':
      loaderFn = loadContactSection;
      break;
    case 'healer':
      loadHealerSection();
      break;
    case 'refunds':
      loaderFn = loadRefundsSection;
      break;
    case 'alerts':
      loaderFn = loadAlertsSection;
      break;
  }
  // First load
  if (loaderFn) loaderFn();

  // Auto-refresh for real-time sections (every 15s)
  if (loaderFn) {
    window._adminRefresh = setInterval(loaderFn, 15000);
  }
}

function closeSection() {
  if (window._adminRefresh) {
    clearInterval(window._adminRefresh);
    window._adminRefresh = null;
  }
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
      fetch('/api/admin/costs', { headers: hdrs() }),
    ]);
    if (!aiR.ok) {
      el.innerHTML = '<div class="error-msg">❌ Error: ' + aiR.status + ' ' + _esc(await aiR.text()) + '</div>';
      return;
    }
    var ai = await aiR.json();
    var costs = costR.ok ? await costR.json() : { byProvider: [], totalToday: 0, totalMonth: 0 };

    var html = '';

    // Month progress
    if (ai.month) {
      html +=
        '<div class="info-banner">📅 Luna: <strong>' +
        (ai.month.current || '') +
        '</strong> — Day ' +
        (ai.month.dayOfMonth || 0) +
        '/' +
        (ai.month.daysInMonth || 30) +
        ' (' +
        (ai.month.daysLeft || 0) +
        ' days left)' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' +
        (ai.month.monthProgress || 0) +
        '%"></div></div></div>';
    }

    // Cost summary
    html +=
      '<div class="cost-summary">' +
      '<div class="cost-box"><div class="cost-label">Cost Today</div><div class="cost-value">$' +
      (costs.totalToday || 0).toFixed(4) +
      '</div></div>' +
      '<div class="cost-box"><div class="cost-label">Monthly Cost</div><div class="cost-value">$' +
      (costs.totalMonth || 0).toFixed(4) +
      '</div></div>' +
      '</div>';

    // Provider cards — paid first, free last
    html += '<div class="ai-grid">';
    var sortedProviders = (ai.providers || []).slice().sort(function (a, b) {
      if (a.tier === 'free' && b.tier !== 'free') return 1;
      if (a.tier !== 'free' && b.tier === 'free') return -1;
      return 0;
    });
    sortedProviders.forEach(function (p) {
      var border = p.alertLevel === 'red' ? '#ef4444' : p.alertLevel === 'yellow' ? '#f59e0b' : '#10b981';
      var statusDot = p.live ? '🟢' : '⚫';
      var creditStatus = '';
      if (p.tier === 'free') {
        creditStatus =
          '<div class="ai-detail" style="color:#22c55e;font-weight:600">🆓 FREE — ' +
          (p.freeQuota || 0).toLocaleString() +
          ' ' +
          (p.unit || 'req') +
          '</div>';
      } else if (p.credit > 1) {
        creditStatus =
          '<div class="ai-detail" style="color:#22c55e;font-weight:600">✅ Credit OK: $' +
          p.credit.toFixed(2) +
          '</div>';
      } else if (p.credit > 0) {
        creditStatus =
          '<div class="ai-detail" style="color:#f59e0b;font-weight:600">⚠️ Low credit: $' +
          p.credit.toFixed(2) +
          '</div>';
      } else {
        creditStatus = '<div class="ai-detail" style="color:#ef4444;font-weight:600">🔴 NO CREDIT!</div>';
      }
      html +=
        '<div class="ai-card" style="border-color:' +
        border +
        '">' +
        '<div class="ai-header">' +
        statusDot +
        ' <strong>' +
        esc(p.name) +
        '</strong> <span class="ai-tier">' +
        (p.tier || '') +
        '</span></div>' +
        '<div class="ai-cost">Cheltuieli luna: $' +
        (p.costMonth || 0).toFixed(4) +
        '</div>' +
        creditStatus +
        '<div class="ai-detail">' +
        (p.requests || 0) +
        ' requests</div>';
      if (p.creditLimit > 0) {
        var pctRemaining = Math.round((p.credit / p.creditLimit) * 100);
        var barColor = pctRemaining > 50 ? '#22c55e' : pctRemaining > 20 ? '#f59e0b' : '#ef4444';
        html +=
          '<div class="ai-credit">Remaining: $' +
          (p.credit || 0).toFixed(2) +
          ' of $' +
          p.creditLimit.toFixed(2) +
          '<div class="progress-bar"><div class="progress-fill" style="width:' +
          pctRemaining +
          '%;background:' +
          barColor +
          '"></div></div></div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Cost per provider table
    if (costs.byProvider && costs.byProvider.length > 0) {
      html += '<h3 style="margin-top:20px">📊 Detailed costs per provider</h3>';
      html +=
        '<table class="admin-table"><thead><tr><th>Provider</th><th>Requests</th><th>Monthly Cost</th><th>Cost Today</th></tr></thead><tbody>';
      costs.byProvider.forEach(function (p) {
        html +=
          '<tr><td><strong>' +
          esc(p.provider) +
          '</strong></td><td>' +
          (p.requests || 0) +
          '</td>' +
          '<td>$' +
          (p.cost_usd || 0).toFixed(4) +
          '</td><td>$' +
          (p.cost_today || 0).toFixed(4) +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ Error: ' + _esc(e.message) + '</div>';
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
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();

    var html = '<div class="brain-stats">';
    html +=
      '<div class="mini-stat"><span class="label">Uptime:</span> ' + Math.round((d.uptime || 0) / 60) + ' min</div>';
    html +=
      '<div class="mini-stat"><span class="label">Conversations:</span> ' +
      (d.conversationCount || d.conversations || 0) +
      '</div>';
    html += '<div class="mini-stat"><span class="label">Messages:</span> ' + (d.totalMessages || 0) + '</div>';
    html += '<div class="mini-stat"><span class="label">Recent errors:</span> ' + (d.recentErrors || 0) + '</div>';
    html += '<div class="mini-stat"><span class="label">Version:</span> ' + esc(d.version || '—') + '</div>';
    html += '</div>';

    // Providers
    html += '<h3>🌐 Providers</h3><div class="brain-providers">';
    var providers = d.providers || {};
    for (var p in providers) {
      html += '<div class="provider-item">' + (providers[p] ? '🟢' : '⚫') + ' ' + p + '</div>';
    }
    html += '</div>';

    // Tool Usage
    html +=
      '<h3>🔧 Tool Usage</h3><table class="admin-table"><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Status</th></tr></thead><tbody>';
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
        html +=
          '<div class="latency-row"><span>' +
          l +
          '</span><span>' +
          d.avgLatency[l] +
          'ms</span>' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' +
          Math.min(100, (d.avgLatency[l] / 50) * 100) +
          '%"></div></div></div>';
      }
    }

    // ═══ Circuit Breakers ═══
    if (d.circuitBreakers && Object.keys(d.circuitBreakers).length > 0) {
      html += '<h3>⚡ Circuit Breakers</h3><div class="brain-providers">';
      for (var cb in d.circuitBreakers) {
        var cbs = d.circuitBreakers[cb];
        var cbState = cbs.state || 'closed';
        var cbIcon = cbState === 'closed' ? '🟢' : cbState === 'half-open' ? '🟡' : '🔴';
        html +=
          '<div class="provider-item">' +
          cbIcon +
          ' ' +
          esc(cb) +
          ' <small style="opacity:.6">(' +
          cbState +
          ', fails:' +
          (cbs.failures || 0) +
          ')</small></div>';
      }
      html += '</div>';
    }

    // ═══ Provider Stats ═══
    if (d.providerStats && Object.keys(d.providerStats).length > 0) {
      html +=
        '<h3>📊 Provider Stats</h3><table class="admin-table"><thead><tr><th>Provider</th><th>Calls</th><th>Avg ms</th><th>Errors</th><th>Last Call</th></tr></thead><tbody>';
      for (var ps in d.providerStats) {
        var pv = d.providerStats[ps];
        var pvAvg = pv.calls > 0 ? Math.round(pv.totalMs / pv.calls) : 0;
        var pvTime = pv.lastCall ? new Date(pv.lastCall).toLocaleTimeString() : '—';
        html +=
          '<tr><td>' +
          esc(ps) +
          '</td><td>' +
          pv.calls +
          '</td><td>' +
          pvAvg +
          '</td><td style="color:' +
          (pv.errors > 0 ? '#ff4444' : '#00ff88') +
          '">' +
          pv.errors +
          '</td><td>' +
          pvTime +
          '</td></tr>';
      }
      html += '</tbody></table>';
    }

    // ═══ Pipeline Traces (last 20 requests) ═══
    if (d.pipelineTraces && d.pipelineTraces.length > 0) {
      html += '<h3>🔬 Pipeline Traces <small style="opacity:.5">(last ' + d.pipelineTraces.length + ')</small></h3>';
      var traces = d.pipelineTraces.slice().reverse();
      for (var ti = 0; ti < traces.length; ti++) {
        var tr = traces[ti];
        var trColor = tr.hasReply ? '#00ff88' : '#ff4444';
        html +=
          '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px 14px;margin-bottom:6px;border-left:3px solid ' +
          trColor +
          '">';
        html +=
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:0.85rem;color:#aaa">' +
          new Date(tr.ts).toLocaleTimeString() +
          '</span>' +
          '<span style="font-size:0.9rem"><b>' +
          (tr.provider || 'none') +
          '</b> — ' +
          tr.totalMs +
          'ms</span></div>';
        // Step flow: agent1 → agent2 → ...
        if (tr.steps && tr.steps.length > 0) {
          html += '<div style="margin-top:6px;font-size:0.8rem">';
          for (var si = 0; si < tr.steps.length; si++) {
            var st = tr.steps[si];
            var stIcon = st.status === 'ok' ? '✅' : st.status === 'fail' ? '❌' : '⚠️';
            html += stIcon + ' ' + esc(st.agent) + ' <span style="color:#888">' + st.ms + 'ms</span>';
            if (si < tr.steps.length - 1) html += ' → ';
          }
          html += '</div>';
        }
        html += '</div>';
      }
    }

    // ═══ FULL HEALTH CHECK — all verification lines ═══
    try {
      var hcR = await fetch('/api/admin/health-check', { headers: hdrs() });
      if (hcR.ok) {
        var hc = await hcR.json();
        function ic(ok) {
          return ok ? '<span style="color:#00ff88">✅</span>' : '<span style="color:#ff4444">❌</span>';
        }

        // Score & Grade
        if (hc.score !== undefined) {
          var gc = hc.grade === 'A' || hc.grade === 'B' ? '#00ff88' : hc.grade === 'C' ? '#ffaa00' : '#ff4444';
          html += '<h3>📊 Health Score</h3><div class="hc-section">';
          html +=
            '<div class="hc-line" style="font-size:1.5rem"><b style="color:' +
            gc +
            '">' +
            hc.score +
            '/100</b> — Grade: <b style="color:' +
            gc +
            '">' +
            esc(hc.grade) +
            '</b></div>';
          html += '</div>';
        }

        // Server info
        html += '<h3>🖥 Server</h3><div class="hc-section">';
        if (hc.server) {
          html += '<div class="hc-line">Version: <b>' + esc(hc.server.version || '—') + '</b></div>';
          html += '<div class="hc-line">Uptime: <b>' + esc(hc.server.uptime || '—') + '</b></div>';
          html += '<div class="hc-line">Node.js: <b>' + esc(hc.server.nodeVersion || '—') + '</b></div>';
          if (hc.server.memory) {
            html += '<div class="hc-line">Memory RSS: <b>' + esc(hc.server.memory.rss || '—') + '</b></div>';
            html += '<div class="hc-line">Heap Used: <b>' + esc(hc.server.memory.heapUsed || '—') + '</b></div>';
          }
        }
        html += '</div>';

        // Services — use sv.active (not sv.configured)
        html += '<h3>🔌 Services</h3><div class="hc-section">';
        if (hc.services) {
          for (var sk in hc.services) {
            var sv = hc.services[sk];
            var isActive = sv.active !== undefined ? sv.active : sv.configured;
            html += '<div class="hc-line">' + ic(isActive) + ' ' + esc(sv.label || sk) + '</div>';
          }
        }
        html += '</div>';

        // Database
        html += '<h3>🗄 Database</h3><div class="hc-section">';
        if (hc.database) {
          html += '<div class="hc-line">' + ic(hc.database.connected) + ' Connected</div>';
          if (hc.database.tables) {
            for (var tk in hc.database.tables) {
              var tv = hc.database.tables[tk];
              if (typeof tv === 'object') {
                html +=
                  '<div class="hc-line">' +
                  ic(tv.ok) +
                  ' ' +
                  esc(tk) +
                  (tv.count !== undefined ? ' (' + tv.count + ' rows)' : '') +
                  '</div>';
              } else {
                html += '<div class="hc-line">' + ic(tv) + ' ' + esc(tk) + '</div>';
              }
            }
          }
        }
        html += '</div>';

        // Brain
        html += '<h3>🧠 Brain</h3><div class="hc-section">';
        if (hc.brain) {
          var bColor =
            hc.brain.status === 'healthy' ? '#00ff88' : hc.brain.status === 'degraded' ? '#ff4444' : '#ffaa00';
          html +=
            '<div class="hc-line">Status: <b style="color:' +
            bColor +
            '">' +
            esc(hc.brain.status || '—') +
            '</b></div>';
          html += '<div class="hc-line">Conversations: <b>' + (hc.brain.conversations || 0) + '</b></div>';
          html +=
            '<div class="hc-line">Recent Errors: <b style="color:' +
            (hc.brain.recentErrors > 0 ? '#ff4444' : '#00ff88') +
            '">' +
            (hc.brain.recentErrors || 0) +
            '</b></div>';
          if (hc.brain.degradedTools && hc.brain.degradedTools.length) {
            html +=
              '<div class="hc-line" style="color:#ff4444">Degraded Tools: <b>' +
              hc.brain.degradedTools.join(', ') +
              '</b></div>';
          }
          if (hc.brain.journal && hc.brain.journal.length) {
            html += '<div style="margin-top:8px;font-size:0.8rem;color:#888">';
            for (var ji = 0; ji < hc.brain.journal.length; ji++) {
              var j = hc.brain.journal[ji];
              html +=
                '<div style="padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)">' +
                new Date(j.time).toLocaleTimeString() +
                ' — <b>' +
                esc(j.event) +
                '</b>: ' +
                esc(j.lesson) +
                '</div>';
            }
            html += '</div>';
          }
        }
        html += '</div>';

        // Security
        html += '<h3>🛡 Security</h3><div class="hc-section">';
        if (hc.security) {
          html += '<div class="hc-line">' + ic(hc.security.httpsRedirect) + ' HTTPS Redirect</div>';
          html += '<div class="hc-line">' + ic(hc.security.adminSecretConfigured) + ' Admin Secret</div>';
        }
        html += '</div>';

        // Auth
        html += '<h3>🔐 Auth</h3><div class="hc-section">';
        if (hc.auth) {
          html += '<div class="hc-line">' + ic(hc.auth.authAvailable) + ' Supabase Auth</div>';
        }
        html += '</div>';

        // Payments
        html += '<h3>💳 Payments</h3><div class="hc-section">';
        if (hc.payments) {
          html += '<div class="hc-line">' + ic(hc.payments.stripeConfigured) + ' Stripe</div>';
          html += '<div class="hc-line">' + ic(hc.payments.webhookConfigured) + ' Webhook</div>';
          if (hc.payments.activeSubscribers !== null && hc.payments.activeSubscribers !== undefined) {
            html += '<div class="hc-line">Active Subscribers: <b>' + hc.payments.activeSubscribers + '</b></div>';
          }
        }
        html += '</div>';

        // Errors
        if (hc.errors && hc.errors.length > 0) {
          html += '<h3>🔴 Errors</h3><div class="hc-section">';
          for (var ei = 0; ei < hc.errors.length; ei++) {
            html += '<div class="hc-line" style="color:#ff4444">' + esc(hc.errors[ei]) + '</div>';
          }
          html += '</div>';
        }

        // Recommendations
        if (hc.recommendations && hc.recommendations.length > 0) {
          html += '<h3>⚠️ Recommendations</h3><div class="hc-section">';
          for (var ri = 0; ri < hc.recommendations.length; ri++) {
            html +=
              '<div class="hc-line" style="color:#ffcc66;background:rgba(255,170,0,0.08);padding:6px 10px;border-radius:6px;margin-bottom:4px">' +
              esc(hc.recommendations[ri]) +
              '</div>';
          }
          html += '</div>';
        }
      }
    } catch (hcErr) {
      html += '<div class="error-msg">⚠️ Health check failed: ' + hcErr.message + '</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
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
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();

    var html = '';

    // Summary stats
    html +=
      '<div class="traffic-summary">' +
      '<div class="mini-stat"><span class="label">Unique today:</span> ' +
      (d.uniqueToday || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Total today:</span> ' +
      (d.totalToday || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Total all-time:</span> ' +
      (d.totalAllTime || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Active connections:</span> ' +
      (d.activeConnections || 0) +
      '</div>' +
      '</div>';

    // Daily chart (7 days) — total vs unique
    if (d.daily && d.daily.length > 0) {
      var max =
        Math.max.apply(
          null,
          d.daily.map(function (x) {
            return x.count;
          })
        ) || 1;
      html += '<h3>📊 Last 7 days (total / unique)</h3><div class="bar-chart">';
      d.daily.forEach(function (day) {
        var pct = Math.round((day.count / max) * 100);
        var uniqueForDay = 0;
        if (d.dailyUnique) {
          var found = d.dailyUnique.find(function (u) {
            return u.date === day.date;
          });
          if (found) uniqueForDay = found.unique;
        }
        html +=
          '<div class="bar-col"><div class="bar-value">' +
          day.count +
          '<br><small style="color:#06b6d4">' +
          uniqueForDay +
          ' unique</small></div>' +
          '<div class="bar" style="height:' +
          pct +
          '%"></div>' +
          '<div class="bar-label">' +
          day.date.slice(5) +
          '</div></div>';
      });
      html += '</div>';
    }

    // Analytics panels row
    html +=
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0">';

    // Top Pages
    if (d.topPages && d.topPages.length > 0) {
      html += '<div class="gdpr-section" style="margin:0"><h3 style="margin:0 0 8px">📄 Top Pages</h3>';
      d.topPages.slice(0, 5).forEach(function (p) {
        html +=
          '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.85rem"><span style="color:#cbd5e1">' +
          esc(p.name) +
          '</span><strong style="color:#10b981">' +
          p.count +
          '</strong></div>';
      });
      html += '</div>';
    }

    // Top Countries
    if (d.topCountries && d.topCountries.length > 0) {
      var flags = {
        RO: '🇷🇴',
        US: '🇺🇸',
        DE: '🇩🇪',
        UK: '🇬🇧',
        FR: '🇫🇷',
        NL: '🇳🇱',
        IT: '🇮🇹',
        ES: '🇪🇸',
      };
      html += '<div class="gdpr-section" style="margin:0"><h3 style="margin:0 0 8px">🌍 Top Țări</h3>';
      d.topCountries.slice(0, 5).forEach(function (c) {
        html +=
          '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.85rem"><span>' +
          (flags[c.name] || '🏳️') +
          ' ' +
          esc(c.name) +
          '</span><strong style="color:#10b981">' +
          c.count +
          '</strong></div>';
      });
      html += '</div>';
    }

    // Top Referrers
    if (d.topReferrers && d.topReferrers.length > 0) {
      html += '<div class="gdpr-section" style="margin:0"><h3 style="margin:0 0 8px">🔗 Top Referrers</h3>';
      d.topReferrers.slice(0, 5).forEach(function (r) {
        var short = r.name.length > 30 ? r.name.substring(0, 30) + '...' : r.name;
        html +=
          '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.85rem"><span style="color:#cbd5e1">' +
          esc(short) +
          '</span><strong style="color:#10b981">' +
          r.count +
          '</strong></div>';
      });
      html += '</div>';
    }

    // Hourly Distribution
    if (d.hourlyDistribution && d.hourlyDistribution.length > 0) {
      var hMax =
        Math.max.apply(
          null,
          d.hourlyDistribution.map(function (h) {
            return h.count;
          })
        ) || 1;
      html += '<div class="gdpr-section" style="margin:0"><h3 style="margin:0 0 8px">⏰ Hourly Distribution</h3>';
      html += '<div style="display:flex;align-items:flex-end;gap:2px;height:60px">';
      d.hourlyDistribution.forEach(function (h) {
        var pct = Math.round((h.count / hMax) * 100);
        html +=
          '<div title="' +
          h.hour +
          ': ' +
          h.count +
          '" style="flex:1;background:linear-gradient(to top,#10b981,#06b6d4);height:' +
          pct +
          '%;border-radius:2px 2px 0 0;min-width:4px"></div>';
      });
      html +=
        '</div><div style="display:flex;justify-content:space-between;font-size:0.65rem;color:#64748b;margin-top:4px"><span>00:00</span><span>12:00</span><span>23:00</span></div></div>';
    }

    html += '</div>'; // close analytics grid

    // Country flag helper
    var FLAGS = {
      RO: '🇷🇴',
      US: '🇺🇸',
      DE: '🇩🇪',
      GB: '🇬🇧',
      UK: '🇬🇧',
      FR: '🇫🇷',
      NL: '🇳🇱',
      IT: '🇮🇹',
      ES: '🇪🇸',
      AT: '🇦🇹',
      CH: '🇨🇭',
      PL: '🇵🇱',
      HU: '🇭🇺',
      CZ: '🇨🇿',
      BG: '🇧🇬',
      MD: '🇲🇩',
      SE: '🇸🇪',
      NO: '🇳🇴',
      DK: '🇩🇰',
      FI: '🇫🇮',
      BE: '🇧🇪',
      PT: '🇵🇹',
      GR: '🇬🇷',
      TR: '🇹🇷',
      RU: '🇷🇺',
      UA: '🇺🇦',
      CA: '🇨🇦',
      AU: '🇦🇺',
      JP: '🇯🇵',
      CN: '🇨🇳',
      IN: '🇮🇳',
      BR: '🇧🇷',
    };
    function flag(code) {
      return (FLAGS[code] || '🏳️') + ' ' + (code || '—');
    }

    // Full table with checkboxes for bulk delete
    html += '<h3>📋 Recent Visits</h3>';
    html +=
      '<div style="margin-bottom:10px;display:flex;gap:10px">' +
      '<button class="btn-sm btn-danger" onclick="deleteSelectedVisits()">🗑️ Delete selected</button>' +
      '<button class="btn-sm btn-danger" onclick="clearAllTraffic()">🧹 Clear all traffic</button>' +
      '</div>';
    html +=
      '<table class="admin-table"><thead><tr>' +
      '<th><input type="checkbox" id="select-all-visits" onchange="toggleAllVisits(this)"></th>' +
      '<th>Foto</th><th>Ora</th><th>Pagina</th><th>IP</th><th>🌍 Țara</th><th>Browser</th><th>Device</th><th>Referrer</th>' +
      '</tr></thead><tbody>';
    if (d.recent && d.recent.length > 0) {
      d.recent.forEach(function (v) {
        var time = new Date(v.created_at).toLocaleString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        });
        var photoHtml = v.photo
          ? '<img src="' +
            safeImgSrc(v.photo) +
            '" style="width:30px;height:30px;object-fit:cover;border-radius:4px;cursor:pointer" onclick="window.open(this.src)" title="View photo">'
          : '<span style="color:#555">—</span>';

        html +=
          '<tr>' +
          '<td><input type="checkbox" class="visit-cb" value="' +
          v.id +
          '"></td>' +
          '<td style="text-align:center">' +
          photoHtml +
          '</td>' +
          '<td>' +
          time +
          '</td>' +
          '<td>' +
          esc(v.path) +
          '</td>' +
          '<td><code>' +
          esc(v.ip) +
          '</code></td>' +
          '<td>' +
          flag(v.country) +
          '</td>' +
          '<td>' +
          parseBrowser(v.user_agent) +
          '</td>' +
          '<td>' +
          parseDevice(v.user_agent) +
          '</td>' +
          '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">' +
          esc(v.referrer || '—') +
          '</td>' +
          '</tr>';
      });
    } else {
      html += '<tr><td colspan="9" style="text-align:center;color:#888">No visits recorded</td></tr>';
    }
    html += '</tbody></table>';

    // ═══ VIZITATORI — Full visitor profiles as interactive table ═══
    html += '<h3>👥 Visitors (full profile)</h3>';
    html +=
      '<div style="margin-bottom:10px;display:flex;gap:10px">' +
      '<button class="btn-sm btn-danger" onclick="deleteSelectedVisitors()">🗑️ Delete selected visitors</button>' +
      '</div>';
    html += '<div id="visitors-grid" style="color:#888">Loading...</div>';

    el.innerHTML = html;

    // Load visitors async
    try {
      var vr = await fetch('/api/admin/visitors', { headers: hdrs() });
      if (vr.ok) {
        var vd = await vr.json();
        var vhtml = '';
        if (vd.visitors && vd.visitors.length > 0) {
          vhtml +=
            '<table class="admin-table"><thead><tr>' +
            '<th><input type="checkbox" id="select-all-visitors" onchange="toggleAllVisitorsCb(this)"></th>' +
            '<th>Foto</th><th>Status</th><th>🌍 Țara</th><th>IP</th>' +
            '<th>Browser</th><th>Device</th><th>OS</th><th>Limbă</th>' +
            '<th>Screen</th><th>Vizite</th><th>Timp</th><th>Ultima vizită</th><th>Acțiuni</th>' +
            '</tr></thead><tbody>';
          vd.visitors.forEach(function (v) {
            var dicebearBase =
              (window.KELION_URLS && KELION_URLS.DICEBEAR) || 'https://api.dicebear.com/7.x/thumbs/svg';
            var avatarSrc =
              v.photo && v.photo.startsWith('data:image/')
                ? v.photo
                : dicebearBase + '?seed=' + encodeURIComponent(v.fingerprint || v.ip || 'anon');
            var statusBadge =
              v.status === 'converted'
                ? '<span class="badge badge-ok">✅ Convertit</span>'
                : v.status === 'returning'
                  ? '<span class="badge badge-warn">🔵 Revine</span>'
                  : '<span class="badge">🟡 Potențial</span>';
            var lastSeen = v.last_seen ? new Date(v.last_seen).toLocaleString('en-GB') : '—';
            var timeSpent = v.total_time_sec ? Math.round(v.total_time_sec / 60) + ' min' : '—';
            var pages =
              (v.pages_visited || [])
                .slice(-3)
                .map(function (p) {
                  return p.path;
                })
                .join(', ') || '—';

            vhtml +=
              '<tr>' +
              '<td><input type="checkbox" class="visitor-cb" value="' +
              v.id +
              '"></td>' +
              '<td style="text-align:center"><img src="' +
              escAttr(avatarSrc) +
              '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(0,255,255,0.3);cursor:pointer" ' +
              'onclick="if(this.src.startsWith(\'data:\'))window.open(this.src)" ' +
              'onerror="this.src=\'' +
              escAttr(dicebearBase + '?seed=' + encodeURIComponent(v.fingerprint || 'x')) +
              '\'"></td>' +
              '<td>' +
              statusBadge +
              '</td>' +
              '<td>' +
              flag(v.country) +
              (v.city ? ' ' + esc(v.city) : '') +
              '</td>' +
              '<td><code style="font-size:0.75rem">' +
              esc(v.ip || '—') +
              '</code></td>' +
              '<td>' +
              esc(v.browser || '—') +
              '</td>' +
              '<td>' +
              esc(v.device || '—') +
              '</td>' +
              '<td>' +
              esc(v.os || '—') +
              '</td>' +
              '<td>' +
              esc(v.language || '—') +
              '</td>' +
              '<td>' +
              (v.screen_width || '—') +
              '×' +
              (v.screen_height || '—') +
              '</td>' +
              '<td>' +
              (v.total_visits || 0) +
              '</td>' +
              '<td>' +
              timeSpent +
              '</td>' +
              '<td>' +
              lastSeen +
              '</td>' +
              '<td><button class="btn-sm btn-danger" onclick="deleteVisitor(\'' +
              v.id +
              '\')" title="Șterge vizitator">🗑️</button></td>' +
              '</tr>';
          });
          vhtml += '</tbody></table>';
        } else {
          vhtml = '<div style="color:#888;text-align:center;padding:20px">No visitors recorded</div>';
        }
        document.getElementById('visitors-grid').innerHTML = vhtml;
      }
    } catch (_) {}
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
  }
}

function toggleAllVisits(master) {
  document.querySelectorAll('.visit-cb').forEach(function (cb) {
    cb.checked = master.checked;
  });
}

async function deleteSelectedVisits() {
  var ids = [];
  document.querySelectorAll('.visit-cb:checked').forEach(function (cb) {
    ids.push(cb.value);
  });
  if (ids.length === 0) return alert('Select at least one visit.');
  if (!confirm('Delete ' + ids.length + ' selected visits?')) return;
  try {
    var r = await fetch('/api/admin/traffic/bulk-delete', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ ids: ids }),
    });
    if (!r.ok) {
      var err = await r.text();
      alert('Delete error: ' + r.status + ' — ' + err);
      return;
    }
    var result = await r.json();
    alert('\u2705 Deleted ' + (result.deleted || 0) + ' visits.');
    loadTrafficSection();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function clearAllTraffic() {
  if (!confirm('WARNING: Delete ALL traffic? This action is irreversible!')) return;
  try {
    var r = await fetch('/api/admin/traffic/clear-all', { method: 'POST', headers: hdrs() });
    if (!r.ok) {
      alert('Error: ' + r.status);
      return;
    }
    var result = await r.json();
    alert('\u2705 Cleared ' + (result.deleted || 0) + ' visits. New visits will appear as visitors browse the site.');
    loadTrafficSection();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function toggleAllVisitorsCb(master) {
  document.querySelectorAll('.visitor-cb').forEach(function (cb) {
    cb.checked = master.checked;
  });
}

function _reloadVisitorSection() {
  var title = (document.getElementById('section-title') || {}).textContent || '';
  if (title.indexOf('Visitors') > -1) loadVisitorsSection();
  else loadTrafficSection();
}

async function deleteVisitor(id) {
  if (!confirm('Șterge acest vizitator definitiv?')) return;
  try {
    var r = await fetch('/api/admin/visitors/' + id, { method: 'DELETE', headers: hdrs() });
    if (!r.ok) {
      var err = await r.text();
      alert('Delete error: ' + r.status + ' — ' + err);
      return;
    }
    var result = await r.json();
    alert('✅ Vizitator șters. ' + (result.deleted || 0) + ' rows removed.');
    _reloadVisitorSection();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function deleteSelectedVisitors() {
  var ids = [];
  document.querySelectorAll('.visitor-cb:checked').forEach(function (cb) {
    ids.push(cb.value);
  });
  if (ids.length === 0) return alert('Selectează cel puțin un vizitator.');
  if (!confirm('Șterge ' + ids.length + ' vizitatori selectați?')) return;
  try {
    var r = await fetch('/api/admin/visitors/bulk-delete', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ ids: ids }),
    });
    if (!r.ok) {
      var err = await r.text();
      alert('Delete error: ' + r.status + ' — ' + err);
      return;
    }
    var result = await r.json();
    alert('✅ Șters ' + (result.deleted || 0) + ' vizitatori.');
    _reloadVisitorSection();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Live Users
// Endpoint: /api/admin/live-users
// ═══════════════════════════════════════════════════════════════
async function loadLiveSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/live-users', { headers: hdrs() });
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();
    var sessions = d.sessions || d.activeSessions || [];

    var html =
      '<div class="mini-stat"><span class="label">Active sessions:</span> <strong>' +
      sessions.length +
      '</strong></div>';

    if (sessions.length > 0) {
      html +=
        '<table class="admin-table"><thead><tr>' +
        '<th>Tip</th><th>IP / User</th><th>Pagina</th>' +
        '<th>🌍 Locație</th><th>🖥 Browser</th><th>⏱ Total time</th><th>Ultima</th>' +
        '</tr></thead><tbody>';
      sessions.forEach(function (s, idx) {
        var typeBadge =
          s.userType === 'User'
            ? '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem">👤 User</span>'
            : '<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:0.7rem">👻 Guest</span>';
        var newBadge = s.isReturning
          ? '<span style="color:#f59e0b;font-size:0.7rem"> 🔄</span>'
          : '<span style="color:#10b981;font-size:0.7rem"> 🆕</span>';
        var loc = (s.country || '—') + (s.city ? ' · ' + s.city : '');
        var device = (s.browser || '—') + ' / ' + (s.os || '—');
        var identity = s.userName ? esc(s.userName) : '<code>' + esc(s.ip) + '</code>';
        html +=
          '<tr style="cursor:pointer" onclick="togglePages(' +
          idx +
          ')">' +
          '<td>' +
          typeBadge +
          newBadge +
          '</td>' +
          '<td>' +
          identity +
          '</td>' +
          '<td>' +
          esc(s.currentPage || '/') +
          '</td>' +
          '<td>' +
          esc(loc) +
          '</td>' +
          '<td>' +
          esc(device) +
          '</td>' +
          '<td>' +
          esc(s.totalTime || '—') +
          '</td>' +
          '<td>' +
          esc(s.lastActivity || '—') +
          '</td>' +
          '</tr>';
        // Expandable page history
        if (s.pages && s.pages.length > 0) {
          html +=
            '<tr id="pages-' +
            idx +
            '" style="display:none;background:rgba(16,185,129,0.05)">' +
            '<td colspan="7" style="padding:8px 16px">' +
            '<strong>📄 Pages visited (' +
            s.pages.length +
            '):</strong><br>';
          s.pages.forEach(function (p) {
            html +=
              '<span style="color:#6ee7b7;margin-right:12px">' + esc(p.time) + '</span> → ' + esc(p.path) + '<br>';
          });
          html += '</td></tr>';
        }
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="text-align:center;padding:40px;color:#888">Nobody online now</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
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
      fetch('/api/admin/revenue', { headers: hdrs() }),
    ]);
    if (!uR.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(uR.status)) + '</div>';
      return;
    }
    var users = await uR.json();
    var rev = rR.ok ? await rR.json() : {};

    var html = '';

    // Revenue summary
    html +=
      '<div class="revenue-summary">' +
      '<div class="mini-stat"><span class="label">Subscribers:</span> ' +
      (rev.subscribers || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">MRR:</span> $' +
      (rev.mrr || 0).toFixed(2) +
      '</div>' +
      '</div>';

    // Users table
    html += '<h3>👤 Users (' + (users.users || []).length + ')</h3>';
    html +=
      '<table class="admin-table"><thead><tr><th>Email</th><th>Nume</th><th>Plan</th><th>Înregistrat</th><th>Last login</th><th>Mesaje</th><th>🗑️</th></tr></thead><tbody>';
    (users.users || []).forEach(function (u) {
      var created = u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB') : '—';
      var lastSign = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('en-GB') : '—';
      var planBadge =
        u.plan === 'premium'
          ? '<span class="badge badge-ok">Premium</span>'
          : u.plan === 'pro'
            ? '<span class="badge badge-warn">Pro</span>'
            : '<span class="badge">Free</span>';
      html +=
        '<tr><td>' +
        esc(u.email) +
        '</td><td>' +
        esc(u.name) +
        '</td><td>' +
        planBadge +
        '</td>' +
        '<td>' +
        created +
        '</td><td>' +
        lastSign +
        '</td><td>' +
        (u.message_count || 0) +
        '</td>' +
        '<td><button class="btn-sm btn-danger" onclick="deleteUser(\'' +
        u.id +
        "','" +
        esc(u.email) +
        '\')">🗑️</button></td></tr>';
    });
    html += '</tbody></table>';

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
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
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();
    var memories = d.memories || [];
    var facts = d.facts || [];

    var html =
      '<div style="display:flex;gap:20px;margin-bottom:12px">' +
      '<div class="mini-stat"><span class="label">Memories:</span> ' +
      (d.totalMemories || memories.length) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Learned Facts:</span> ' +
      (d.totalFacts || facts.length) +
      '</div></div>';

    // Brain memories table
    html += '<h3>🧠 Brain Memories</h3>';
    if (memories.length > 0) {
      html +=
        '<table class="admin-table"><thead><tr><th>Tip</th><th>Conținut</th><th>Importance</th><th>Categorie</th><th>Data</th><th>🗑️</th></tr></thead><tbody>';
      memories.forEach(function (m) {
        var date = m.created_at ? new Date(m.created_at).toLocaleDateString('en-GB') : '—';
        var meta = m.metadata || {};
        var cat = meta.category || meta.source || '—';
        var impColor = m.importance >= 8 ? '#10b981' : m.importance >= 5 ? '#f59e0b' : '#64748b';
        html +=
          '<tr><td><span class="badge">' +
          esc(m.memory_type || '—') +
          '</span></td>' +
          '<td style="max-width:450px;white-space:pre-wrap;word-break:break-word;font-size:0.85rem">' +
          esc((m.content || '').substring(0, 300)) +
          '</td>' +
          '<td style="color:' +
          impColor +
          ';font-weight:bold">' +
          (m.importance || 0) +
          '/10</td>' +
          '<td>' +
          esc(cat) +
          '</td>' +
          '<td>' +
          date +
          '</td>' +
          '<td><button class="btn-sm btn-danger" onclick="deleteMemory(\'' +
          m.id +
          '\')">🗑️</button></td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html +=
        '<div style="text-align:center;padding:20px;color:#888">No memories — Kira will auto-seed golden knowledge on next learning sync (10 min)</div>';
    }

    // Learned facts table
    if (facts.length > 0) {
      html += '<h3>📖 Learned Facts</h3>';
      html +=
        '<table class="admin-table"><thead><tr><th>Fact</th><th>Category</th><th>Source</th><th>Confidence</th><th>Data</th></tr></thead><tbody>';
      facts.forEach(function (f) {
        var date = f.created_at ? new Date(f.created_at).toLocaleDateString('en-GB') : '—';
        var conf = f.confidence != null ? Math.round(f.confidence * 100) + '%' : '—';
        html +=
          '<tr><td style="max-width:400px;white-space:pre-wrap;word-break:break-word;font-size:0.85rem">' +
          esc((f.fact || '').substring(0, 300)) +
          '</td>' +
          '<td>' +
          esc(f.category || '—') +
          '</td>' +
          '<td>' +
          esc(f.source || '—') +
          '</td>' +
          '<td>' +
          conf +
          '</td>' +
          '<td>' +
          date +
          '</td></tr>';
      });
      html += '</tbody></table>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
  }
}

async function deleteMemory(id) {
  if (!confirm('Delete this memory?')) return;
  try {
    await fetch('/api/admin/memories/' + id, { method: 'DELETE', headers: hdrs() });
    loadMemoriesSection();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Visitors — Full Management v2
// Filters: period (1d/7d/1m/3m/unlimited), search, status
// Actions: delete single, bulk delete, delete by period, edit notes
// ═══════════════════════════════════════════════════════════════

// State for visitors section
var _visitorsState = {
  period: 'unlimited',
  search: '',
  page: 1,
  limit: 50,
  sort: 'last_seen',
  status: '',
  loading: false,
};

var FLAGS_MAP = {
  RO:'🇷🇴',US:'🇺🇸',DE:'🇩🇪',GB:'🇬🇧',UK:'🇬🇧',FR:'🇫🇷',NL:'🇳🇱',
  IT:'🇮🇹',ES:'🇪🇸',AT:'🇦🇹',CH:'🇨🇭',PL:'🇵🇱',HU:'🇭🇺',CZ:'🇨🇿',
  BG:'🇧🇬',MD:'🇲🇩',SE:'🇸🇪',NO:'🇳🇴',DK:'🇩🇰',FI:'🇫🇮',BE:'🇧🇪',
  PT:'🇵🇹',GR:'🇬🇷',TR:'🇹🇷',RU:'🇷🇺',UA:'🇺🇦',CA:'🇨🇦',AU:'🇦🇺',
  JP:'🇯🇵',CN:'🇨🇳',IN:'🇮🇳',BR:'🇧🇷',MX:'🇲🇽',AR:'🇦🇷',ZA:'🇿🇦',
  NG:'🇳🇬',EG:'🇪🇬',SA:'🇸🇦',AE:'🇦🇪',IL:'🇮🇱',KR:'🇰🇷',SG:'🇸🇬',
};

function vFlag(code) {
  return (FLAGS_MAP[code] || '🏳️') + ' ' + (code || '—');
}

async function loadVisitorsSection() {
  var el = document.getElementById('section-content');

  // ── Render shell with controls ──
  el.innerHTML =
    // ── Stats row ──
    '<div id="vis-stats" class="traffic-summary"><div style="color:#888;padding:20px">Loading stats…</div></div>' +

    // ── Alert banner ──
    '<div id="vis-alerts"></div>' +

    // ── Controls bar ──
    '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0 10px">' +
      // Period filter
      '<div style="display:flex;gap:4px">' +
        '<button class="btn-sm vis-period-btn" data-p="1d"    onclick="visSetPeriod(\'1d\')">24h</button>' +
        '<button class="btn-sm vis-period-btn" data-p="7d"    onclick="visSetPeriod(\'7d\')">7 days</button>' +
        '<button class="btn-sm vis-period-btn" data-p="1m"    onclick="visSetPeriod(\'1m\')">1 month</button>' +
        '<button class="btn-sm vis-period-btn" data-p="3m"    onclick="visSetPeriod(\'3m\')">3 months</button>' +
        '<button class="btn-sm vis-period-btn vis-period-active" data-p="unlimited" onclick="visSetPeriod(\'unlimited\')">All time</button>' +
      '</div>' +
      // Status filter
      '<select id="vis-status-sel" onchange="visSetStatus(this.value)" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font-size:0.8rem">' +
        '<option value="">All statuses</option>' +
        '<option value="potential">🟡 Potential</option>' +
        '<option value="returning">🔵 Returning</option>' +
        '<option value="converted">✅ Converted</option>' +
        '<option value="blocked">🚫 Blocked</option>' +
      '</select>' +
      // Search
      '<input id="vis-search-inp" type="text" placeholder="🔍 Search IP, country, city, browser…" ' +
        'style="flex:1;min-width:200px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 10px;font-size:0.85rem" ' +
        'oninput="visSearchDebounce(this.value)">' +
      // Sort
      '<select id="vis-sort-sel" onchange="visSetSort(this.value)" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font-size:0.8rem">' +
        '<option value="last_seen">Last seen ↓</option>' +
        '<option value="first_seen">First seen ↓</option>' +
        '<option value="total_visits">Most visits</option>' +
        '<option value="total_time_sec">Most time</option>' +
      '</select>' +
    '</div>' +

    // ── Bulk action bar ──
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center">' +
      '<button class="btn-sm btn-danger" onclick="visDeleteSelected()">🗑️ Delete selected</button>' +
      '<button class="btn-sm" style="background:#1e293b;border:1px solid #ef4444;color:#ef4444" onclick="visDeleteByPeriod()">🗑️ Delete period</button>' +
      '<button class="btn-sm" style="background:#1e293b;border:1px solid #334155;color:#94a3b8" onclick="visSelectAll()">☑️ Select all</button>' +
      '<button class="btn-sm" style="background:#1e293b;border:1px solid #334155;color:#94a3b8" onclick="visDeselectAll()">⬜ Deselect all</button>' +
      '<span id="vis-sel-count" style="color:#64748b;font-size:0.8rem"></span>' +
    '</div>' +

    // ── Table area ──
    '<div id="vis-table-area"><div style="text-align:center;padding:40px;color:#888">Loading visitors…</div></div>' +

    // ── Pagination ──
    '<div id="vis-pagination" style="display:flex;gap:10px;justify-content:center;margin:16px 0"></div>';

  // Load stats in background
  _visLoadStats();
  // Load visitors
  _visLoadTable();
}

async function _visLoadStats() {
  try {
    var r = await fetch('/api/admin/visitors/stats', { headers: hdrs() });
    if (!r.ok) return;
    var d = await r.json();
    var el = document.getElementById('vis-stats');
    if (!el) return;
    el.innerHTML =
      '<div class="mini-stat"><span class="label">Total visitors:</span> ' + (d.total || 0) + '</div>' +
      '<div class="mini-stat"><span class="label">Today:</span> ' + (d.today || 0) + '</div>' +
      '<div class="mini-stat"><span class="label">This week:</span> ' + (d.thisWeek || 0) + '</div>' +
      '<div class="mini-stat"><span class="label">This month:</span> ' + (d.thisMonth || 0) + '</div>';

    // Top countries mini
    if (d.topCountries && d.topCountries.length > 0) {
      var cHtml = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
      d.topCountries.slice(0, 6).forEach(function(c) {
        cHtml += '<span style="background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:12px;font-size:0.78rem">' +
          (FLAGS_MAP[c.country] || '🏳️') + ' ' + esc(c.country) + ' <strong>' + c.count + '</strong></span>';
      });
      cHtml += '</div>';
      el.innerHTML += cHtml;
    }
  } catch(e) { /* ignore */ }
}

var _visSearchTimer = null;
function visSearchDebounce(val) {
  clearTimeout(_visSearchTimer);
  _visSearchTimer = setTimeout(function() {
    _visitorsState.search = val.trim();
    _visitorsState.page = 1;
    _visLoadTable();
  }, 400);
}

function visSetPeriod(p) {
  _visitorsState.period = p;
  _visitorsState.page = 1;
  document.querySelectorAll('.vis-period-btn').forEach(function(b) {
    b.classList.toggle('vis-period-active', b.dataset.p === p);
  });
  _visLoadTable();
}

function visSetStatus(v) {
  _visitorsState.status = v;
  _visitorsState.page = 1;
  _visLoadTable();
}

function visSetSort(v) {
  _visitorsState.sort = v;
  _visitorsState.page = 1;
  _visLoadTable();
}

function visSelectAll() {
  document.querySelectorAll('.vis-cb').forEach(function(cb) { cb.checked = true; });
  _visUpdateSelCount();
}
function visDeselectAll() {
  document.querySelectorAll('.vis-cb').forEach(function(cb) { cb.checked = false; });
  _visUpdateSelCount();
}
function _visUpdateSelCount() {
  var n = document.querySelectorAll('.vis-cb:checked').length;
  var el = document.getElementById('vis-sel-count');
  if (el) el.textContent = n > 0 ? n + ' selected' : '';
}

async function _visLoadTable() {
  if (_visitorsState.loading) return;
  _visitorsState.loading = true;
  var area = document.getElementById('vis-table-area');
  if (area) area.innerHTML = '<div style="text-align:center;padding:30px;color:#888">⏳ Loading…</div>';

  try {
    var params = new URLSearchParams({
      period: _visitorsState.period,
      page:   _visitorsState.page,
      limit:  _visitorsState.limit,
      sort:   _visitorsState.sort,
    });
    if (_visitorsState.search) params.set('search', _visitorsState.search);
    if (_visitorsState.status) params.set('status', _visitorsState.status);

    var r = await fetch('/api/admin/visitors?' + params.toString(), { headers: hdrs() });
    if (!r.ok) {
      if (area) area.innerHTML = '<div class="error-msg">❌ Error ' + r.status + '</div>';
      _visitorsState.loading = false;
      return;
    }
    var d = await r.json();
    var visitors = d.visitors || [];

    if (!document.getElementById('vis-table-area')) { _visitorsState.loading = false; return; }

    if (visitors.length === 0) {
      document.getElementById('vis-table-area').innerHTML =
        '<div style="text-align:center;padding:40px;color:#888">No visitors found for this filter.</div>';
      document.getElementById('vis-pagination').innerHTML = '';
      _visitorsState.loading = false;
      return;
    }

    var dicebearBase = 'https://api.dicebear.com/7.x/thumbs/svg';
    var html = '<div style="overflow-x:auto"><table class="admin-table"><thead><tr>' +
      '<th><input type="checkbox" id="vis-select-all-hdr" onchange="visToggleAll(this)"></th>' +
      '<th>Avatar</th><th>Status</th><th>🌍 Country / City</th><th>IP</th>' +
      '<th>Browser</th><th>Device</th><th>Language</th>' +
      '<th>Visits</th><th>Time</th><th>Pages</th>' +
      '<th>First seen</th><th>Last seen</th><th>Referrer</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    visitors.forEach(function(v) {
      var avatarSrc = v.photo && v.photo.startsWith('data:image/')
        ? v.photo
        : dicebearBase + '?seed=' + encodeURIComponent(v.fingerprint || v.ip || 'anon');
      var statusBadge = v.status === 'converted'
        ? '<span class="badge badge-ok">✅ Converted</span>'
        : v.status === 'returning'
          ? '<span class="badge badge-warn">🔵 Returning</span>'
          : v.status === 'blocked'
            ? '<span style="color:#ef4444;font-size:0.75rem">🚫 Blocked</span>'
            : '<span class="badge">🟡 Potential</span>';
      var firstSeen = v.first_seen ? new Date(v.first_seen).toLocaleDateString('en-GB') : '—';
      var lastSeen  = v.last_seen  ? new Date(v.last_seen).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      var timeMins  = Math.round((v.total_time_sec || 0) / 60);
      var pagesCount = v.pageViewsCount || v.pages_visited || 0;
      var referrerShort = v.referrer ? (v.referrer.length > 25 ? v.referrer.substring(0,25)+'…' : v.referrer) : '—';

      html +=
        '<tr>' +
        '<td><input type="checkbox" class="vis-cb" value="' + v.id + '" onchange="_visUpdateSelCount()"></td>' +
        '<td style="text-align:center"><img src="' + escAttr(avatarSrc) + '" ' +
          'style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid rgba(99,102,241,0.4)" ' +
          'onerror="this.src=\'' + escAttr(dicebearBase + '?seed=x') + '\'"></td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + vFlag(v.country) + (v.city ? '<br><small style="color:#64748b">' + esc(v.city) + '</small>' : '') + '</td>' +
        '<td><code style="font-size:0.72rem;color:#94a3b8">' + esc(v.ip || '—') + '</code></td>' +
        '<td style="font-size:0.82rem">' + esc(v.browser || '—') + '</td>' +
        '<td style="font-size:0.82rem">' + esc(v.device || '—') + '</td>' +
        '<td style="font-size:0.82rem">' + esc(v.language || '—') + '</td>' +
        '<td style="text-align:center;font-weight:600;color:#22d3ee">' + (v.total_visits || 0) + '</td>' +
        '<td style="text-align:center">' + timeMins + ' min</td>' +
        '<td style="text-align:center">' + pagesCount + '</td>' +
        '<td style="font-size:0.78rem;color:#64748b">' + firstSeen + '</td>' +
        '<td style="font-size:0.78rem">' + lastSeen + '</td>' +
        '<td style="font-size:0.72rem;color:#64748b" title="' + escAttr(v.referrer || '') + '">' + esc(referrerShort) + '</td>' +
        '<td style="white-space:nowrap">' +
          '<button class="btn-sm" style="background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3);margin-right:4px" ' +
            'onclick="visEditNotes(\'' + v.id + '\')" title="Edit notes">📝</button>' +
          '<button class="btn-sm btn-danger" onclick="visDeleteOne(\'' + v.id + '\')" title="Delete">🗑️</button>' +
        '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    document.getElementById('vis-table-area').innerHTML = html;

    // Pagination
    var pg = document.getElementById('vis-pagination');
    if (pg) {
      var pgHtml = '';
      var total = d.total || 0;
      var totalPages = Math.ceil(total / _visitorsState.limit);
      if (totalPages > 1) {
        pgHtml += '<span style="color:#64748b;font-size:0.85rem;align-self:center">Page ' + _visitorsState.page + ' / ' + totalPages + ' (' + total + ' total)</span>';
        if (_visitorsState.page > 1)
          pgHtml += '<button class="btn-sm" onclick="visGoPage(' + (_visitorsState.page - 1) + ')">← Prev</button>';
        // Page numbers (max 5 around current)
        var startP = Math.max(1, _visitorsState.page - 2);
        var endP   = Math.min(totalPages, _visitorsState.page + 2);
        for (var pi = startP; pi <= endP; pi++) {
          var isActive = pi === _visitorsState.page;
          pgHtml += '<button class="btn-sm" style="' + (isActive ? 'background:#6366f1;color:#fff' : '') + '" onclick="visGoPage(' + pi + ')">' + pi + '</button>';
        }
        if (_visitorsState.page < totalPages)
          pgHtml += '<button class="btn-sm" onclick="visGoPage(' + (_visitorsState.page + 1) + ')">Next →</button>';
      } else if (total > 0) {
        pgHtml = '<span style="color:#64748b;font-size:0.85rem">' + total + ' visitors</span>';
      }
      pg.innerHTML = pgHtml;
    }
  } catch(e) {
    var a2 = document.getElementById('vis-table-area');
    if (a2) a2.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
  }
  _visitorsState.loading = false;
}

function visGoPage(p) {
  _visitorsState.page = p;
  _visLoadTable();
}

function visToggleAll(cb) {
  document.querySelectorAll('.vis-cb').forEach(function(c) { c.checked = cb.checked; });
  _visUpdateSelCount();
}

async function visDeleteOne(id) {
  if (!confirm('Delete this visitor and their page views?')) return;
  try {
    var r = await fetch('/api/admin/visitors/' + id, { method: 'DELETE', headers: hdrs() });
    if (r.ok) {
      var d = await r.json();
      _visShowToast('✅ Deleted visitor + ' + (d.pageViewsDeleted || 0) + ' page views');
      _visLoadTable();
      _visLoadStats();
    } else {
      alert('Error: ' + r.status);
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function visDeleteSelected() {
  var ids = Array.from(document.querySelectorAll('.vis-cb:checked')).map(function(c) { return c.value; });
  if (ids.length === 0) { alert('Select at least one visitor first.'); return; }
  if (!confirm('Delete ' + ids.length + ' selected visitors and their page views?')) return;
  try {
    var r = await fetch('/api/admin/visitors/bulk-delete', {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ ids: ids }),
    });
    if (r.ok) {
      var d = await r.json();
      _visShowToast('✅ Deleted ' + (d.deleted || 0) + ' visitors + ' + (d.pageViewsDeleted || 0) + ' page views');
      _visLoadTable();
      _visLoadStats();
    } else {
      alert('Error: ' + r.status);
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function visDeleteByPeriod() {
  var periodLabels = { '1d': 'last 24 hours', '7d': 'last 7 days', '1m': 'last month', '3m': 'last 3 months', 'unlimited': 'ALL TIME' };
  var p = _visitorsState.period;
  var label = periodLabels[p] || p;
  var msg = p === 'unlimited'
    ? '⚠️ DELETE ALL VISITORS OF ALL TIME?\nThis cannot be undone!'
    : 'Delete all visitors from ' + label + '?\nThis cannot be undone!';
  if (!confirm(msg)) return;
  if (p === 'unlimited' && !confirm('FINAL CONFIRMATION: Delete ALL visitors?')) return;
  try {
    var period = p === 'unlimited' ? 'all' : p;
    var r = await fetch('/api/admin/visitors/by-period/' + period, { method: 'DELETE', headers: hdrs() });
    if (r.ok) {
      var d = await r.json();
      _visShowToast('✅ Deleted ' + (d.deleted || 0) + ' visitors (' + label + ')');
      _visLoadTable();
      _visLoadStats();
    } else {
      alert('Error: ' + r.status);
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function visEditNotes(id) {
  var notes = prompt('Notes for this visitor (leave empty to clear):');
  if (notes === null) return;
  try {
    var r = await fetch('/api/admin/visitors/' + id, {
      method: 'PUT',
      headers: hdrs(),
      body: JSON.stringify({ notes: notes }),
    });
    if (r.ok) {
      _visShowToast('✅ Notes saved');
    } else {
      alert('Error: ' + r.status);
    }
  } catch(e) { alert('Error: ' + e.message); }
}

function _visShowToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#e2e8f0;padding:10px 18px;border-radius:8px;border:1px solid #334155;font-size:0.9rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4)';
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 3000);
}

async function deleteUser(id, email) {
  var action = prompt(
    'User: ' +
      email +
      '\n\nType:\n  "suspend" — soft-delete (disable login, keep data)\n  "delete" — permanently delete user and all data\n  Cancel to abort'
  );
  if (!action) return;
  action = action.trim().toLowerCase();
  try {
    if (action === 'delete') {
      if (!confirm('PERMANENT DELETE of ' + email + '?\nThis cannot be undone!')) return;
      var r = await fetch('/api/admin/users/' + id + '?hard=true', { method: 'DELETE', headers: hdrs() });
      if (r.ok) {
        alert('User ' + email + ' permanently deleted.');
        loadUsersSection();
      } else {
        alert('Error: ' + r.status);
      }
    } else if (action === 'suspend') {
      var r = await fetch('/api/admin/users/' + id, { method: 'DELETE', headers: hdrs() });
      if (r.ok) {
        alert('User ' + email + ' suspended.');
        loadUsersSection();
      } else {
        alert('Error: ' + r.status);
      }
    } else {
      alert('Unknown action: ' + action);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function restoreUser(id, email) {
  if (!confirm('Restore user ' + email + '?')) return;
  try {
    var r = await fetch('/api/admin/users/' + id + '/restore', { method: 'POST', headers: hdrs() });
    if (r.ok) {
      alert('User ' + email + ' restored.');
      loadUsersSection();
    } else {
      alert('Error: ' + r.status);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Conversation History
// No dedicated endpoint — uses brain data
// ═══════════════════════════════════════════════════════════════
async function loadHistorySection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/admin/brain', { headers: hdrs() });
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();
    var html = '';
    html +=
      '<div class="traffic-summary">' +
      '<div class="mini-stat"><span class="label">Total conversations:</span> ' +
      (d.conversationCount || d.conversations || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Total messages:</span> ' +
      (d.totalMessages || 0) +
      '</div>' +
      '<div class="mini-stat"><span class="label">Recent errors:</span> ' +
      (d.recentErrors || 0) +
      '</div>' +
      '</div>';
    if (d.recentConversations && d.recentConversations.length > 0) {
      html +=
        '<table class="admin-table"><thead><tr><th>User</th><th>Messages</th><th>Started</th><th>Last activity</th></tr></thead><tbody>';
      d.recentConversations.forEach(function (c) {
        var started = c.startedAt ? new Date(c.startedAt).toLocaleString('en-GB') : '—';
        var last = c.lastActivity ? new Date(c.lastActivity).toLocaleString('en-GB') : '—';
        html +=
          '<tr><td>' +
          esc(c.user || 'Guest') +
          '</td><td>' +
          (c.messageCount || 0) +
          '</td><td>' +
          started +
          '</td><td>' +
          last +
          '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html +=
        '<div style="text-align:center;padding:40px;color:#888">No recent conversations available. Conversation history is tracked by the brain in-memory during runtime.</div>';
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Admin Logs — Audit trail
// ═══════════════════════════════════════════════════════════════
async function loadLogsSection(offset) {
  var el = document.getElementById('section-content');
  offset = offset || 0;
  var limit = 50;
  try {
    var r = await fetch('/api/admin/logs?limit=' + limit + '&offset=' + offset, { headers: hdrs() });
    if (!r.ok) {
      el.innerHTML = '<div class="error-msg">❌ ' + _esc(String(r.status)) + '</div>';
      return;
    }
    var d = await r.json();
    var html = '<div class="traffic-summary">';
    html += '<div class="mini-stat"><span class="label">Total logs:</span> ' + (d.total || 0) + '</div>';
    html +=
      '<div class="mini-stat"><span class="label">Showing:</span> ' +
      (offset + 1) +
      '-' +
      Math.min(offset + limit, d.total || 0) +
      '</div>';
    html += '</div>';
    if (d.logs && d.logs.length > 0) {
      html +=
        '<table class="admin-table"><thead><tr><th>Date</th><th>Action</th><th>Admin</th><th>Details</th></tr></thead><tbody>';
      d.logs.forEach(function (log) {
        var date = log.created_at ? new Date(log.created_at).toLocaleString('en-GB') : '—';
        var details = log.details;
        if (typeof details === 'object') details = JSON.stringify(details);
        if (typeof details === 'string' && details.length > 120) details = details.substring(0, 120) + '…';
        html +=
          '<tr><td style="white-space:nowrap">' +
          esc(date) +
          '</td><td><span style="background:rgba(239,68,68,0.15);padding:2px 8px;border-radius:4px;font-weight:600">' +
          esc(log.action || '—') +
          '</span></td><td>' +
          esc(log.admin_id || '—') +
          '</td><td style="font-size:12px;color:#aaa;max-width:400px;overflow:hidden;text-overflow:ellipsis">' +
          esc(details || '—') +
          '</td></tr>';
      });
      html += '</tbody></table>';
      // Pagination
      html += '<div style="display:flex;gap:12px;justify-content:center;margin:20px 0">';
      if (offset > 0)
        html +=
          '<button class="admin-btn" onclick="loadLogsSection(' +
          Math.max(0, offset - limit) +
          ')">← Previous</button>';
      if (offset + limit < (d.total || 0))
        html += '<button class="admin-btn" onclick="loadLogsSection(' + (offset + limit) + ')">Next →</button>';
      html += '</div>';
    } else {
      html += '<div style="text-align:center;padding:40px;color:#888">No admin logs recorded yet.</div>';
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="error-msg">❌ ' + _esc(e.message) + '</div>';
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR — load real data for top stats
// ═══════════════════════════════════════════════════════════════
async function loadStats() {
  try {
    // Users count
    fetch('/api/admin/users', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        document.getElementById('val-users').textContent = (d.users || []).length;
        document.getElementById('preview-users').textContent = (d.users || []).length + ' users';
      })
      .catch(function () {
        document.getElementById('val-users').textContent = '?';
      });

    // Traffic
    fetch('/api/admin/traffic', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        document.getElementById('val-views').textContent = d.totalAllTime || d.totalToday || 0;
        document.getElementById('preview-traffic').textContent = (d.totalToday || 0) + ' today';
      })
      .catch(function () {
        document.getElementById('val-views').textContent = '?';
      });

    // Costs
    fetch('/api/admin/costs', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        document.getElementById('val-cost-today').textContent = '$' + (d.totalToday || 0).toFixed(4);
        document.getElementById('val-cost-month').textContent = '$' + (d.totalMonth || 0).toFixed(2);
        document.getElementById('preview-ai').textContent = '$' + (d.totalMonth || 0).toFixed(2) + '/month';
      })
      .catch(function () {
        document.getElementById('val-cost-today').textContent = '?';
        document.getElementById('val-cost-month').textContent = '?';
      });

    // Brain preview
    fetch('/api/admin/brain', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        var active = 0;
        var total = 0;
        var providers = d.providers || {};
        for (var p in providers) {
          total++;
          if (providers[p]) active++;
        }
        document.getElementById('preview-brain').textContent = active + '/' + total + ' providers';
        document.getElementById('admin-uptime').textContent = '⏱ ' + Math.round((d.uptime || 0) / 60) + 'min';
      })
      .catch(function () {});

    // Live preview + Acum Online stat
    fetch('/api/admin/live-users', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        var count = (d.sessions || d.activeSessions || []).length;
        document.getElementById('preview-live').textContent = count + ' online';
        document.getElementById('val-active').textContent = count;
      })
      .catch(function () {
        document.getElementById('val-active').textContent = '0';
      });

    // Memories preview
    fetch('/api/admin/memories', { headers: hdrs() })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('403');
      })
      .then(function (d) {
        document.getElementById('preview-memories').textContent = (d.memories || []).length + ' memories';
      })
      .catch(function () {});

    // History preview
    fetch('/api/admin/history?limit=1', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var total = d.total || (d.conversations || []).length || 0;
        var el = document.getElementById('preview-history');
        if (el) el.textContent = total + ' conversations';
      })
      .catch(function () {});

    // Visitors preview
    fetch('/api/admin/visitors?limit=1', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var total = d.total || (d.visitors || []).length || 0;
        var el = document.getElementById('preview-visitors');
        if (el) el.textContent = total + ' leads';
      })
      .catch(function () {});

    // Contact Inbox preview
    fetch('/api/contact/inbox?limit=1', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var unread = d.unread || 0;
        var total  = d.total  || (d.messages || []).length || 0;
        var el = document.getElementById('preview-contact');
        if (el) el.textContent = unread > 0 ? unread + ' unread' : total + ' msgs';
      })
      .catch(function () {});

    // Healer preview
    fetch('/api/admin/healer/status', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var el = document.getElementById('preview-healer');
        if (el) el.textContent = d.lastScore != null ? 'Score: ' + d.lastScore : 'Ready';
      })
      .catch(function () {});

    // Refunds preview
    fetch('/api/refund/requests?limit=1', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var requests = d.requests || [];
        var pending  = requests.filter(function (x) { return x.status === 'pending'; }).length;
        var total    = d.total || requests.length || 0;
        var el = document.getElementById('preview-refunds');
        if (el) el.textContent = pending > 0 ? pending + ' pending' : total + ' total';
      })
      .catch(function () {});

    // Alerts preview
    fetch('/api/admin/alerts?limit=1&status=unread', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var unread = d.total || 0;
        var el = document.getElementById('preview-alerts');
        if (el) el.textContent = unread > 0 ? unread + ' necitite' : '0 alerte';
      })
      .catch(function () {});

    // Logs preview
    fetch('/api/admin/logs?limit=1', { headers: hdrs() })
      .then(function (r) { if (r.ok) return r.json(); throw new Error('403'); })
      .then(function (d) {
        var total = d.total || (d.logs || []).length || 0;
        var el = document.getElementById('preview-logs');
        if (el) el.textContent = total + ' entries';
      })
      .catch(function () {});

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
    showAuthError('Not logged in. Sign in to the app first, then come back here.');
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
        showAuthError('Your email is not set as admin on the server.\nCheck ADMIN_EMAIL on Railway.');
        return;
      } else if (r.status === 401) {
        showAuthError('JWT token expired. Re-authenticate in the app.');
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
      showAuthError(
        'Access denied (' + check.status + ').\nCheck if you are authenticated with an admin account, then try again.'
      );
      return;
    }
  } catch (e) {
    showAuthError('Server unavailable: ' + e.message);
    return;
  }

  // Auth OK — load stats
  console.log('[Admin] Authenticated successfully ✅');
  loadStats();
  window._statsRefresh = setInterval(loadStats, 30000); // refresh every 30s for real-time feel
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Contact Inbox
// ═══════════════════════════════════════════════════════════════
async function loadContactSection() {
  var el = document.getElementById('section-content');
  var status = (new URLSearchParams(window._contactFilter || '')).get('status') || '';
  var dept   = (new URLSearchParams(window._contactFilter || '')).get('dept') || '';
  var search = window._contactSearch || '';

  try {
    var params = new URLSearchParams({ limit: 100 });
    if (status) params.set('status', status);
    if (dept)   params.set('department', dept);
    if (search) params.set('search', search);

    var r = await fetch('/api/contact/inbox?' + params, { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + r.status + '</div>'; return; }
    var d = await r.json();
    var msgs = d.messages || [];
    var unread = d.unread || 0;

    // Update preview badge
    var pb = document.getElementById('preview-contact');
    if (pb) pb.textContent = unread > 0 ? unread + ' unread' : msgs.length + ' msgs';

    var statusColors = { unread: '#ef4444', read: '#94a3b8', replied: '#22c55e', archived: '#475569' };
    var priorityColors = { urgent: '#ef4444', high: '#f97316', normal: '#6366f1', low: '#22c55e' };

    el.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <select onchange="window._contactFilter='status='+this.value;loadContactSection()" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:0.82rem">
          <option value="">All Status</option>
          <option value="unread" ${status==='unread'?'selected':''}>🔴 Unread (${unread})</option>
          <option value="read" ${status==='read'?'selected':''}>👁 Read</option>
          <option value="replied" ${status==='replied'?'selected':''}>✅ Replied</option>
        </select>
        <select onchange="window._contactFilter='dept='+this.value;loadContactSection()" style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:0.82rem">
          <option value="">All Departments</option>
          <option value="Support">Support</option>
          <option value="Technical">Technical</option>
          <option value="Commercial">Commercial</option>
          <option value="Billing">Billing</option>
        </select>
        <input type="text" placeholder="🔍 Search name/email..." value="${esc(search)}"
          oninput="window._contactSearch=this.value;clearTimeout(window._csTimer);window._csTimer=setTimeout(loadContactSection,400)"
          style="background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:6px 12px;border-radius:6px;font-size:0.82rem;width:200px">
        <span style="margin-left:auto;color:#94a3b8;font-size:0.82rem">${msgs.length} mesaje · ${unread} necitite</span>
      </div>

      ${msgs.length === 0 ? '<div style="text-align:center;padding:60px;color:#64748b">📭 No messages found</div>' :
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        msgs.map(function(m) {
          var sc = statusColors[m.status] || '#94a3b8';
          var pc = priorityColors[m.priority] || '#6366f1';
          return `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 16px;cursor:pointer;transition:border-color 0.2s"
            onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#334155'"
            onclick="openContactMsg('${m.id}')">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span style="background:${sc}22;color:${sc};padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700;text-transform:uppercase">${m.status}</span>
              <span style="background:${pc}22;color:${pc};padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700">${m.priority}</span>
              <span style="background:#334155;color:#94a3b8;padding:2px 8px;border-radius:10px;font-size:0.7rem">${esc(m.department)}</span>
              <span style="margin-left:auto;color:#64748b;font-size:0.75rem">${new Date(m.created_at).toLocaleString('ro-RO')}</span>
            </div>
            <div style="margin-top:8px;display:flex;gap:12px;align-items:flex-start">
              <div style="flex:1">
                <div style="font-weight:600;font-size:0.9rem">${esc(m.name)} <span style="color:#94a3b8;font-weight:400;font-size:0.82rem">&lt;${esc(m.email)}&gt;</span></div>
                <div style="color:#94a3b8;font-size:0.82rem;margin-top:2px">${esc(m.subject) || '(no subject)'}</div>
              </div>
              <div style="display:flex;gap:6px">
                <button onclick="event.stopPropagation();openContactMsg('${m.id}')" style="background:#6366f122;color:#6366f1;border:1px solid #6366f144;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.75rem">👁 View</button>
                <button onclick="event.stopPropagation();deleteContactMsg('${m.id}')" style="background:#ef444422;color:#ef4444;border:1px solid #ef444444;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.75rem">🗑</button>
              </div>
            </div>
          </div>`;
        }).join('') + '</div>'
      }`;
  } catch(e) {
    el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + e.message + '</div>';
  }
}

async function openContactMsg(id) {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/contact/inbox/' + id, { headers: hdrs() });
    var m = await r.json();
    if (!m.id) { alert('Message not found'); return; }

    var priorityColors = { urgent: '#ef4444', high: '#f97316', normal: '#6366f1', low: '#22c55e' };
    var pc = priorityColors[m.priority] || '#6366f1';

    el.innerHTML = `
      <button onclick="loadContactSection()" style="background:#334155;color:#e2e8f0;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;margin-bottom:16px">← Back to Inbox</button>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;max-width:700px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <span style="background:${pc}22;color:${pc};padding:3px 10px;border-radius:10px;font-size:0.75rem;font-weight:700">${m.priority?.toUpperCase()}</span>
          <span style="background:#33415522;color:#94a3b8;padding:3px 10px;border-radius:10px;font-size:0.75rem">${m.department}</span>
          <code style="background:#0f172a;color:#22d3ee;padding:3px 10px;border-radius:6px;font-size:0.75rem">${m.ref_number}</code>
          <span style="margin-left:auto;color:#64748b;font-size:0.75rem">${new Date(m.created_at).toLocaleString('ro-RO')}</span>
        </div>

        <div style="margin-bottom:16px">
          <div style="font-size:1.1rem;font-weight:700">${esc(m.name)}</div>
          <div style="color:#94a3b8;font-size:0.85rem"><a href="mailto:${esc(m.email)}" style="color:#6366f1">${esc(m.email)}</a>${m.phone ? ' · ' + esc(m.phone) : ''}</div>
          <div style="color:#e2e8f0;font-size:0.9rem;margin-top:4px;font-weight:600">${esc(m.subject) || '(no subject)'}</div>
        </div>

        <div style="background:#0f172a;border-radius:8px;padding:16px;margin-bottom:20px;border-left:3px solid #6366f1">
          <p style="color:#94a3b8;font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">MESSAGE</p>
          <p style="line-height:1.7;white-space:pre-wrap;font-size:0.9rem">${esc(m.message)}</p>
        </div>

        ${m.reply_text ? `
        <div style="background:#0f172a;border-radius:8px;padding:16px;margin-bottom:20px;border-left:3px solid #22c55e">
          <p style="color:#22c55e;font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">YOUR REPLY · ${m.replied_at ? new Date(m.replied_at).toLocaleString('ro-RO') : ''}</p>
          <p style="line-height:1.7;white-space:pre-wrap;font-size:0.9rem">${esc(m.reply_text)}</p>
        </div>` : ''}

        <div style="border-top:1px solid #334155;padding-top:16px">
          <p style="color:#94a3b8;font-size:0.78rem;margin-bottom:8px;font-weight:600">REPLY TO ${esc(m.name)}</p>
          <textarea id="reply-text-${id}" rows="5" placeholder="Scrie răspunsul tău..."
            style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px;color:#e2e8f0;font-size:0.88rem;resize:vertical;outline:none;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button onclick="sendContactReply('${id}')"
              style="background:#6366f1;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem">
              ✉️ Send Reply
            </button>
            <button onclick="deleteContactMsg('${id}')"
              style="background:#ef444422;color:#ef4444;border:1px solid #ef444444;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:0.9rem">
              🗑 Delete
            </button>
          </div>
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + e.message + '</div>';
  }
}

async function sendContactReply(id) {
  var replyText = (document.getElementById('reply-text-' + id) || {}).value || '';
  if (!replyText.trim()) { alert('Scrie un răspuns înainte de a trimite.'); return; }
  try {
    var r = await fetch('/api/contact/inbox/' + id + '/reply', {
      method: 'PUT',
      headers: hdrs(),
      body: JSON.stringify({ replyText }),
    });
    var d = await r.json();
    if (d.success) {
      alert('✅ Răspuns trimis cu succes' + (d.emailSent ? ' (email sent)' : ' (email not sent)'));
      openContactMsg(id);
    } else {
      alert('❌ Error: ' + (d.error || 'Failed'));
    }
  } catch(e) {
    alert('❌ Network error: ' + e.message);
  }
}

async function deleteContactMsg(id) {
  if (!confirm('Ștergi acest mesaj?')) return;
  try {
    var r = await fetch('/api/contact/inbox/' + id, { method: 'DELETE', headers: hdrs() });
    var d = await r.json();
    if (d.success) { loadContactSection(); }
    else alert('❌ ' + (d.error || 'Delete failed'));
  } catch(e) {
    alert('❌ ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Self-Healing Engine
// ═══════════════════════════════════════════════════════════════
async function loadHealerSection() {
  var el = document.getElementById('section-content');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:#888">Loading healer status...</div>';
  try {
    var r = await fetch('/api/admin/healer/status', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div style="color:#f87171;padding:20px">Healer API error: ' + r.status + '</div>'; return; }
    var d = await r.json();

    // Update preview badge
    var pb = document.getElementById('preview-healer');
    if (pb) pb.textContent = d.lastScore != null ? 'Score: ' + d.lastScore : 'Ready';

    var scoreColor = (d.lastScore >= 80) ? '#22c55e' : (d.lastScore >= 50) ? '#f59e0b' : '#ef4444';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px">
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:2rem;font-weight:800;color:${scoreColor}">${d.lastScore != null ? d.lastScore : '—'}</div>
          <div style="color:#94a3b8;font-size:0.78rem;margin-top:4px">Health Score</div>
        </div>
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#e2e8f0">${d.totalScans || 0}</div>
          <div style="color:#94a3b8;font-size:0.78rem;margin-top:4px">Total Scans</div>
        </div>
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#22c55e">${d.totalHeals || 0}</div>
          <div style="color:#94a3b8;font-size:0.78rem;margin-top:4px">Heals Applied</div>
        </div>
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:1.6rem;font-weight:700;color:#f59e0b">${d.lastIssues || 0}</div>
          <div style="color:#94a3b8;font-size:0.78rem;margin-top:4px">Last Issues</div>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        <button onclick="runHealerScan()" id="scan-btn"
          style="background:#6366f1;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem">
          🔍 Run Full Scan
        </button>
        <button onclick="runHealerAuto()" id="heal-btn"
          style="background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem">
          🔧 Auto-Heal All
        </button>
        <button onclick="loadHealerSection()"
          style="background:#334155;color:#e2e8f0;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-size:0.9rem">
          🔄 Refresh
        </button>
      </div>

      <div id="healer-output" style="background:#0f172a;border-radius:10px;padding:16px;min-height:120px;font-family:monospace;font-size:0.82rem;line-height:1.7;color:#94a3b8;white-space:pre-wrap">
${d.lastReport ? JSON.stringify(d.lastReport, null, 2).slice(0, 3000) : 'No scan report yet. Click "Run Full Scan" to start.'}
      </div>

      ${d.recentScans && d.recentScans.length > 0 ? `
      <div style="margin-top:20px">
        <h3 style="font-size:0.9rem;color:#94a3b8;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Recent Scans</h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${d.recentScans.map(function(s) {
            var sc = s.score >= 80 ? '#22c55e' : s.score >= 50 ? '#f59e0b' : '#ef4444';
            return `<div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:12px">
              <span style="color:${sc};font-weight:700;font-size:1rem">${s.score}</span>
              <span style="color:#94a3b8;font-size:0.78rem">${s.status}</span>
              <span style="color:#64748b;font-size:0.75rem">${s.issues_count} issues</span>
              <span style="margin-left:auto;color:#475569;font-size:0.72rem">${new Date(s.created_at).toLocaleString('ro-RO')}</span>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}`;
  } catch(e) {
    el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + e.message + '</div>';
  }
}

async function runHealerScan() {
  var btn = document.getElementById('scan-btn');
  var out = document.getElementById('healer-output');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Scanning...'; }
  if (out) out.textContent = '🔍 Running full system scan...\n';
  try {
    var r = await fetch('/api/admin/healer/scan', { method: 'POST', headers: hdrs() });
    var d = await r.json();
    if (out) {
      out.textContent = '✅ Scan complete — Score: ' + (d.score || '?') + '\n\n' +
        'Issues: ' + (d.issuesCount || 0) + ' (' + (d.criticalCount || 0) + ' critical)\n\n' +
        JSON.stringify(d.report || d, null, 2).slice(0, 4000);
    }
    loadHealerSection();
  } catch(e) {
    if (out) out.textContent = '❌ Scan error: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Run Full Scan'; }
  }
}

async function runHealerAuto() {
  var btn = document.getElementById('heal-btn');
  var out = document.getElementById('healer-output');
  if (!confirm('Rulezi auto-heal pe toate problemele detectate?')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Healing...'; }
  if (out) out.textContent = '🔧 Running auto-heal...\n';
  try {
    var r = await fetch('/api/admin/healer/heal-all', { method: 'POST', headers: hdrs() });
    var d = await r.json();
    if (out) {
      out.textContent = (d.success ? '✅ ' : '⚠️ ') + (d.message || 'Done') + '\n\n' +
        'Healed: ' + (d.healed || 0) + ' / ' + (d.total || 0) + '\n\n' +
        JSON.stringify(d.results || [], null, 2).slice(0, 3000);
    }
  } catch(e) {
    if (out) out.textContent = '❌ Heal error: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔧 Auto-Heal All'; }
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION: Refund Requests
// ═══════════════════════════════════════════════════════════════
async function loadRefundsSection() {
  var el = document.getElementById('section-content');
  try {
    var r = await fetch('/api/refund/requests', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + r.status + '</div>'; return; }
    var d = await r.json();
    var requests = d.requests || d || [];

    // Update preview badge
    var pb = document.getElementById('preview-refunds');
    var pending = requests.filter(function(x) { return x.status === 'pending'; }).length;
    if (pb) pb.textContent = pending > 0 ? pending + ' pending' : requests.length + ' total';

    var statusColors = { pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444' };

    el.innerHTML = `
      <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="color:#94a3b8;font-size:0.85rem">${requests.length} cereri · ${pending} în așteptare</span>
        <button onclick="loadRefundsSection()" style="margin-left:auto;background:#334155;color:#e2e8f0;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem">🔄 Refresh</button>
      </div>
      ${requests.length === 0 ? '<div style="text-align:center;padding:60px;color:#64748b">💸 No refund requests</div>' :
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        requests.map(function(req) {
          var sc = statusColors[req.status] || '#94a3b8';
          return `<div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px 16px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
              <span style="background:${sc}22;color:${sc};padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;text-transform:uppercase">${req.status}</span>
              <span style="color:#e2e8f0;font-weight:600">${esc(req.email)}</span>
              <span style="color:#94a3b8;font-size:0.82rem">${esc(req.plan)} · ${esc(req.billing_cycle)}</span>
              <span style="margin-left:auto;color:#22c55e;font-weight:700">$${req.refund_amount_usd || 0}</span>
              <span style="color:#64748b;font-size:0.72rem">${new Date(req.created_at).toLocaleString('ro-RO')}</span>
            </div>
            <div style="color:#94a3b8;font-size:0.82rem;margin-bottom:10px">${esc(req.reason)}</div>
            ${req.status === 'pending' ? `
            <div style="display:flex;gap:8px">
              <button onclick="processRefund('${req.id}','approved')"
                style="background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600">
                ✅ Approve
              </button>
              <button onclick="processRefund('${req.id}','rejected')"
                style="background:#ef444422;color:#ef4444;border:1px solid #ef444444;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600">
                ❌ Reject
              </button>
            </div>` : `<div style="color:#475569;font-size:0.78rem">Processed ${req.processed_at ? new Date(req.processed_at).toLocaleString('ro-RO') : ''}</div>`}
          </div>`;
        }).join('') + '</div>'
      }`;
  } catch(e) {
    el.innerHTML = '<div style="color:#f87171;padding:20px">Error: ' + e.message + '</div>';
  }
}

async function processRefund(id, action) {
  var note = '';
  if (action === 'rejected') {
    note = prompt('Motiv respingere (opțional):') || '';
  }
  if (action === 'approved' && !confirm('Confirmi aprobarea rambursului? Stripe va procesa automat.')) return;
  try {
    var r = await fetch('/api/refund/requests/' + id, {
      method: 'PUT',
      headers: hdrs(),
      body: JSON.stringify({ action: action === 'approved' ? 'approve' : 'reject', adminNote: note }),
    });
    var d = await r.json();
    if (d.success) {
      alert('✅ ' + (action === 'approved' ? 'Ramburs aprobat' : 'Cerere respinsă') + (d.stripeRefundId ? ' · Stripe: ' + d.stripeRefundId : ''));
      loadRefundsSection();
    } else {
      alert('❌ Error: ' + (d.error || 'Failed'));
    }
  } catch(e) {
    alert('❌ ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// ALERTS SECTION
// ══════════════════════════════════════════════════════════════
async function loadAlertsSection() {
  const main = document.getElementById('main-content');
  if (!main) return;

  // Filters state
  const prevFilters = window._alertFilters || { type: 'all', status: 'all', page: 0 };
  window._alertFilters = prevFilters;

  main.innerHTML = `
    <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <h2 style="margin:0;font-size:1.4rem;font-weight:700;color:#f1f5f9">🔔 Alerts & Notifications</h2>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:0.85rem">Monitorizare credite, utilizatori noi, erori sistem, AI status</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="markAllAlertsRead()" style="padding:7px 14px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;cursor:pointer;font-size:0.82rem">✅ Mark all read</button>
        <button onclick="clearAllAlerts()" style="padding:7px 14px;background:#1e293b;border:1px solid #ef4444;color:#ef4444;border-radius:8px;cursor:pointer;font-size:0.82rem">🗑 Clear all</button>
        <button onclick="loadAlertsSection()" style="padding:7px 14px;background:#e11d48;border:none;color:#fff;border-radius:8px;cursor:pointer;font-size:0.82rem">↻ Refresh</button>
      </div>
    </div>

    <!-- Stats bar -->
    <div id="alerts-stats" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px"></div>

    <!-- Filters -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;align-items:center">
      <select id="alert-filter-type" onchange="applyAlertFilters()" style="padding:7px 12px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;font-size:0.85rem">
        <option value="all">Toate tipurile</option>
        <option value="low_credits">💳 Low Credits</option>
        <option value="zero_credits">🚫 Zero Credits</option>
        <option value="new_user">👤 New User</option>
        <option value="system_error">❌ System Error</option>
        <option value="ai_status">🤖 AI Status</option>
        <option value="payment">💰 Payment</option>
        <option value="refund">💸 Refund</option>
        <option value="security">🔒 Security</option>
      </select>
      <select id="alert-filter-status" onchange="applyAlertFilters()" style="padding:7px 12px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;font-size:0.85rem">
        <option value="all">Toate statusurile</option>
        <option value="unread">🔴 Necitite</option>
        <option value="read">✅ Citite</option>
      </select>
      <span style="color:#64748b;font-size:0.82rem;margin-left:4px" id="alerts-count-label"></span>
    </div>

    <!-- Alerts list -->
    <div id="alerts-list" style="display:flex;flex-direction:column;gap:10px">
      <div style="text-align:center;padding:40px;color:#475569">
        <div style="font-size:1.5rem;margin-bottom:8px">⏳</div>
        <div>Se încarcă alertele...</div>
      </div>
    </div>

    <!-- Pagination -->
    <div id="alerts-pagination" style="display:flex;justify-content:center;gap:8px;margin-top:20px"></div>
  `;

  await _fetchAndRenderAlerts();
}

async function _fetchAndRenderAlerts() {
  const f = window._alertFilters || { type: 'all', status: 'all', page: 0 };
  const limit = 20;
  const offset = f.page * limit;

  let url = `/api/admin/alerts?limit=${limit}&offset=${offset}`;
  if (f.type && f.type !== 'all') url += `&type=${encodeURIComponent(f.type)}`;
  if (f.status && f.status !== 'all') url += `&status=${encodeURIComponent(f.status)}`;

  try {
    const r = await fetch(url, { credentials: 'include' });
    const d = await r.json();

    if (!d.success) throw new Error(d.error || 'Failed to load alerts');

    // Stats bar
    const statsEl = document.getElementById('alerts-stats');
    if (statsEl && d.stats) {
      const st = d.stats;
      const statItems = [
        { label: 'Total', value: st.total || 0, color: '#64748b', icon: '📊' },
        { label: 'Necitite', value: st.unread || 0, color: '#e11d48', icon: '🔴' },
        { label: 'Low Credits', value: st.low_credits || 0, color: '#f59e0b', icon: '💳' },
        { label: 'Zero Credits', value: st.zero_credits || 0, color: '#ef4444', icon: '🚫' },
        { label: 'New Users', value: st.new_user || 0, color: '#22c55e', icon: '👤' },
        { label: 'Errors', value: st.system_error || 0, color: '#f87171', icon: '❌' },
      ];
      statsEl.innerHTML = statItems.map(s => `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 16px;min-width:100px;text-align:center">
          <div style="font-size:1.3rem">${s.icon}</div>
          <div style="font-size:1.4rem;font-weight:700;color:${s.color}">${s.value}</div>
          <div style="font-size:0.75rem;color:#64748b">${s.label}</div>
        </div>
      `).join('');
    }

    // Count label
    const countEl = document.getElementById('alerts-count-label');
    if (countEl) countEl.textContent = `${d.total || 0} alerte găsite`;

    // Render list
    const listEl = document.getElementById('alerts-list');
    if (!listEl) return;

    const alerts = d.alerts || [];
    if (alerts.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:60px;color:#475569;background:#1e293b;border-radius:12px;border:1px dashed #334155">
          <div style="font-size:2.5rem;margin-bottom:12px">🎉</div>
          <div style="font-size:1rem;color:#64748b">Nu există alerte${f.type !== 'all' ? ' pentru filtrul selectat' : ''}</div>
        </div>`;
      return;
    }

    const typeConfig = {
      low_credits:  { icon: '💳', color: '#f59e0b', bg: '#451a03' },
      zero_credits: { icon: '🚫', color: '#ef4444', bg: '#450a0a' },
      new_user:     { icon: '👤', color: '#22c55e', bg: '#052e16' },
      system_error: { icon: '❌', color: '#f87171', bg: '#450a0a' },
      ai_status:    { icon: '🤖', color: '#818cf8', bg: '#1e1b4b' },
      payment:      { icon: '💰', color: '#34d399', bg: '#022c22' },
      refund:       { icon: '💸', color: '#fbbf24', bg: '#451a03' },
      security:     { icon: '🔒', color: '#a78bfa', bg: '#2e1065' },
    };

    listEl.innerHTML = alerts.map(a => {
      const cfg = typeConfig[a.alert_type] || { icon: '🔔', color: '#94a3b8', bg: '#1e293b' };
      const isUnread = a.status === 'unread';
      const ts = new Date(a.created_at).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      let meta = '';
      try {
        const m = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata || {});
        const keys = Object.keys(m).filter(k => !['stack'].includes(k));
        if (keys.length) {
          meta = `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">` +
            keys.slice(0, 6).map(k => `<span style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:2px 8px;font-size:0.75rem;color:#94a3b8"><b style="color:#cbd5e1">${k}:</b> ${String(m[k]).substring(0,60)}</span>`).join('') +
          `</div>`;
        }
      } catch(e) {}

      return `
        <div style="background:${isUnread ? cfg.bg : '#1e293b'};border:1px solid ${isUnread ? cfg.color + '44' : '#334155'};border-radius:12px;padding:14px 16px;transition:all 0.2s;position:relative">
          ${isUnread ? `<div style="position:absolute;top:14px;right:14px;width:8px;height:8px;background:${cfg.color};border-radius:50%"></div>` : ''}
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:1.6rem;flex-shrink:0;margin-top:2px">${cfg.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <span style="font-weight:700;color:${cfg.color};font-size:0.9rem;text-transform:uppercase;letter-spacing:0.5px">${a.alert_type.replace(/_/g,' ')}</span>
                <span style="background:#0f172a;border:1px solid #334155;border-radius:20px;padding:1px 8px;font-size:0.72rem;color:${isUnread ? cfg.color : '#64748b'}">${isUnread ? '● NECITIT' : '✓ citit'}</span>
                <span style="color:#475569;font-size:0.78rem;margin-left:auto">${ts}</span>
              </div>
              <div style="color:#e2e8f0;font-size:0.88rem;line-height:1.5">${a.message || '—'}</div>
              ${meta}
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
            ${isUnread ? `<button onclick="markAlertRead(${a.id})" style="padding:4px 12px;background:transparent;border:1px solid ${cfg.color}44;color:${cfg.color};border-radius:6px;cursor:pointer;font-size:0.78rem">✅ Marchează citit</button>` : ''}
            <button onclick="deleteAlert(${a.id})" style="padding:4px 12px;background:transparent;border:1px solid #ef444444;color:#ef4444;border-radius:6px;cursor:pointer;font-size:0.78rem">🗑 Șterge</button>
          </div>
        </div>`;
    }).join('');

    // Pagination
    const totalPages = Math.ceil((d.total || 0) / limit);
    const pagEl = document.getElementById('alerts-pagination');
    if (pagEl && totalPages > 1) {
      let btns = '';
      for (let i = 0; i < totalPages; i++) {
        const active = i === f.page;
        btns += `<button onclick="setAlertPage(${i})" style="padding:6px 12px;background:${active ? '#e11d48' : '#1e293b'};border:1px solid ${active ? '#e11d48' : '#334155'};color:${active ? '#fff' : '#94a3b8'};border-radius:8px;cursor:pointer;font-size:0.82rem">${i+1}</button>`;
      }
      pagEl.innerHTML = btns;
    }

  } catch(e) {
    const listEl = document.getElementById('alerts-list');
    if (listEl) listEl.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444">❌ Eroare: ${e.message}</div>`;
  }
}

function applyAlertFilters() {
  const t = document.getElementById('alert-filter-type');
  const s = document.getElementById('alert-filter-status');
  window._alertFilters = { type: t ? t.value : 'all', status: s ? s.value : 'all', page: 0 };
  _fetchAndRenderAlerts();
}

function setAlertPage(page) {
  if (window._alertFilters) window._alertFilters.page = page;
  _fetchAndRenderAlerts();
}

async function markAlertRead(id) {
  try {
    await fetch(`/api/admin/alerts/${id}/read`, { method: 'PATCH', credentials: 'include' });
    _fetchAndRenderAlerts();
  } catch(e) { console.error(e); }
}

async function markAllAlertsRead() {
  try {
    await fetch('/api/admin/alerts/mark-all-read', { method: 'PATCH', credentials: 'include' });
    _fetchAndRenderAlerts();
  } catch(e) { console.error(e); }
}

async function deleteAlert(id) {
  if (!confirm('Ștergi această alertă?')) return;
  try {
    await fetch(`/api/admin/alerts/${id}`, { method: 'DELETE', credentials: 'include' });
    _fetchAndRenderAlerts();
  } catch(e) { console.error(e); }
}

async function clearAllAlerts() {
  if (!confirm('Ștergi TOATE alertele? Această acțiune nu poate fi anulată.')) return;
  try {
    await fetch('/api/admin/alerts/clear-all', { method: 'DELETE', credentials: 'include' });
    _fetchAndRenderAlerts();
  } catch(e) { console.error(e); }
}

function showAuthError(msg) {
  document.querySelector('.admin-container').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:80vh;flex-direction:column;text-align:center;padding:20px">' +
    '<div style="font-size:2rem;margin-bottom:16px">🔒</div>' +
    '<div style="font-size:1.2rem;color:#f87171;margin-bottom:12px;font-weight:600">Admin — restricted access</div>' +
    '<pre style="color:#888;font-size:0.85rem;white-space:pre-wrap;max-width:500px;margin-bottom:20px;font-family:inherit">' +
    msg +
    '</pre>' +
    '<a href="/">← Back to ' + ((window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI') + '</a></div>';
}

// ── START ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
