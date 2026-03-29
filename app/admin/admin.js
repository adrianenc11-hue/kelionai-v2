// ═══════════════════════════════════════════════════════════════
// App — Admin Panel JS
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const API = window.location.origin;

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getToken() {
    return localStorage.getItem('kelion_token');
  }
  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // ── Check admin access — only ADMIN_EMAIL user ──
  async function checkAccess() {
    try {
      const r = await fetch(API + '/api/auth/me', { headers: authHeaders() });
      if (r.ok) {
        const d = await r.json();
        if (d.user?.email) {
          document.getElementById('admin-user').textContent = d.user.email;
          // Server-side /api/admin/* endpoints verify ADMIN_EMAIL
          return d.user;
        }
      }
    } catch (e) {}
    // No valid auth — deny
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#f66;font-size:1.5rem;background:#0a0a14;">' +
      '<div>🔒 Admin — acces restricționat</div>' +
      '<div style="font-size:0.9rem;color:#888;margin-top:8px">Doar contul admin are acces.</div>' +
      '<a href="/" style="margin-top:16px;color:#a5b4fc;text-decoration:none;">← Înapoi la ' + ((window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI') + '</a></div>';
    return null;
  }

  // ── Tab switching ──
  function initTabs() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) {
          t.classList.remove('active');
        });
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          p.classList.remove('active');
        });
        tab.classList.add('active');
        var panel = document.getElementById('tab-' + tab.dataset.tab);
        if (panel) panel.classList.add('active');
        loadTabData(tab.dataset.tab);
      });
    });
  }

  // ── Load tab data ──
  async function loadTabData(tab) {
    switch (tab) {
      case 'brain':
        await loadBrain();
        break;
      case 'costs':
        await loadCosts();
        break;
      case 'traffic':
        await loadTraffic();
        break;
      case 'users':
        await loadUsers();
        break;
      case 'revenue':
        await loadRevenue();
        break;

      case 'deploy':
        await loadDeploy();
        break;
    }
  }

  // ══════════════════════════════════════════════════════════
  // BRAIN TAB
  // ══════════════════════════════════════════════════════════
  async function loadBrain() {
    try {
      const [brainR, aiR] = await Promise.all([
        fetch(API + '/api/admin/brain', { headers: authHeaders() }),
        fetch(API + '/api/admin/ai-status', { headers: authHeaders() }).catch(() => null),
      ]);
      if (!brainR.ok) {
        document.getElementById('brain-tools').textContent = 'Error loading';
        return;
      }
      const d = await brainR.json();
      const aiData = aiR && aiR.ok ? await aiR.json() : { providers: [] };

      // ── CREDIT ALERTS BANNER ──
      var alerts = (aiData.providers || []).filter(function (p) {
        return p.alertLevel === 'red' || p.alertLevel === 'yellow';
      });
      var alertHtml = '';
      if (alerts.length > 0) {
        alertHtml =
          '<div style="background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #f87171">';
        alertHtml += '<div style="font-size:1.1rem;font-weight:700;margin-bottom:8px">⚠️ Credit Alerts</div>';
        alerts.forEach(function (a) {
          var color = a.alertLevel === 'red' ? '#fca5a5' : '#fde68a';
          alertHtml +=
            '<div style="color:' + color + ';padding:4px 0">• <b>' + a.name + '</b>: ' + a.alertMessage + '</div>';
        });
        alertHtml += '</div>';
      }

      // ── AI PROVIDER CREDIT CARDS ──
      var cardsHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:24px">';
      (aiData.providers || []).forEach(function (p) {
        var bg = p.live
          ? p.alertLevel === 'red'
            ? 'linear-gradient(135deg,#7f1d1d,#991b1b)'
            : p.alertLevel === 'yellow'
              ? 'linear-gradient(135deg,#78350f,#92400e)'
              : 'linear-gradient(135deg,#1a1a2e,#16213e)'
          : 'linear-gradient(135deg,#1f1f1f,#2d2d2d)';
        var border =
          p.alertLevel === 'red' ? '#ef4444' : p.alertLevel === 'yellow' ? '#f59e0b' : p.live ? '#6366f1' : '#444';
        var statusDot = p.live ? '🟢' : '⚫';

        cardsHtml +=
          "<div class=\"ai-card\" onclick=\"this.querySelector('.ai-details').style.display=this.querySelector('.ai-details').style.display==='block'?'none':'block'\" style=\"background:" +
          bg +
          ';border:1px solid ' +
          border +
          ";border-radius:14px;padding:16px;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s\" onmouseover=\"this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 25px rgba(0,0,0,0.3)'\" onmouseout=\"this.style.transform='none';this.style.boxShadow='none'\">";
        cardsHtml += '<div style="display:flex;justify-content:space-between;align-items:center">';
        cardsHtml += '<div style="font-weight:700;font-size:1.05rem">' + statusDot + ' ' + p.name + '</div>';
        cardsHtml += '<div style="font-size:0.8rem;opacity:0.7">' + p.tier + '</div>';
        cardsHtml += '</div>';

        // Cost this month
        cardsHtml +=
          '<div style="margin-top:10px;font-size:1.3rem;font-weight:700;color:#10b981">$' +
          (p.costMonth || 0).toFixed(4) +
          '</div>';
        cardsHtml += '<div style="font-size:0.75rem;opacity:0.6">' + (p.requests || 0) + ' requests luna asta</div>';

        // Alert message
        cardsHtml +=
          '<div style="margin-top:8px;font-size:0.8rem;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.05)">' +
          (p.alertMessage || '') +
          '</div>';

        // ── Expandable details (hidden by default) ──
        cardsHtml +=
          '<div class="ai-details" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">';
        if (p.creditLimit > 0) {
          var usedPct = p.creditLimit > 0 ? Math.round(((p.creditLimit - p.credit) / p.creditLimit) * 100) : 0;
          var barColor = usedPct > 90 ? '#ef4444' : usedPct > 70 ? '#f59e0b' : '#10b981';
          cardsHtml +=
            '<div style="margin-bottom:8px"><b>Credit:</b> $' +
            p.credit.toFixed(2) +
            ' / $' +
            p.creditLimit.toFixed(2) +
            '</div>';
          cardsHtml +=
            '<div style="background:#1a1a2e;border-radius:6px;height:8px;overflow:hidden"><div style="width:' +
            usedPct +
            '%;height:100%;background:' +
            barColor +
            ';border-radius:6px"></div></div>';
        } else if (p.freeQuota > 0) {
          cardsHtml +=
            '<div style="margin-bottom:8px"><b>Free quota:</b> ' +
            p.freeQuota.toLocaleString() +
            ' ' +
            p.unit +
            '</div>';
        }
        cardsHtml +=
          '<div style="margin-top:6px"><b>Proiectat luna:</b> $' + (p.projectedMonth || 0).toFixed(4) + '</div>';
        cardsHtml +=
          '<a href="' +
          (p.pricingUrl || '#') +
          '" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;padding:8px 16px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-size:0.85rem;font-weight:600">💳 Reîncarcă / Billing</a>';
        cardsHtml += '</div>'; // ai-details
        cardsHtml += '</div>'; // ai-card
      });
      cardsHtml += '</div>';

      // ── Tool stats table ──
      var html =
        '<table class="admin-table"><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Status</th></tr></thead><tbody>';
      var tools = d.toolStats || {};
      var errors = d.toolErrors || {};
      for (var t in tools) {
        var err = errors[t] || 0;
        var status = err > 5 ? '🔴' : err > 0 ? '🟡' : '🟢';
        html += '<tr><td>' + _esc(t) + '</td><td>' + tools[t] + '</td><td>' + err + '</td><td>' + status + '</td></tr>';
      }
      html += '</tbody></table>';

      document.getElementById('brain-tools').innerHTML = alertHtml + cardsHtml + html;

      // Providers summary (keep existing)
      var providers = d.providers || {};
      var phtml = '';
      for (var p in providers) {
        var ok = providers[p] ? '🟢 Active' : '⚫ Missing';
        phtml +=
          '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' +
          p +
          '</span><span>' +
          ok +
          '</span></div>';
      }
      document.getElementById('brain-providers').innerHTML = phtml || 'No data';

      // Uptime
      if (d.uptime)
        document.getElementById('admin-uptime').textContent = '⏱ ' + Math.round(d.uptime / 60) + 'min uptime';

      // Conversations + messages
      if (d.conversationCount !== undefined) {
        var statsEl = document.getElementById('admin-uptime');
        if (statsEl)
          statsEl.textContent += ' | 💬 ' + d.conversationCount + ' convos | ' + (d.totalMessages || 0) + ' msgs';
      }
    } catch (e) {
      document.getElementById('brain-tools').textContent = 'Connection error: ' + e.message;
    }
  }

  // ══════════════════════════════════════════════════════════
  // COSTS TAB
  // ══════════════════════════════════════════════════════════
  async function loadCosts() {
    try {
      const r = await fetch(API + '/api/admin/costs', { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();

      // Provider costs
      var tbody = '';
      (d.byProvider || []).forEach(function (p) {
        tbody +=
          '<tr><td>' +
          _esc(p.provider) +
          '</td><td>' +
          p.requests +
          '</td><td>' +
          (p.tokens_in || 0) +
          '</td><td>' +
          (p.tokens_out || 0) +
          '</td><td>$' +
          (p.cost_usd || 0).toFixed(4) +
          '</td></tr>';
      });
      document.querySelector('#costs-provider tbody').innerHTML = tbody || '<tr><td colspan="5">No data yet</td></tr>';

      // User costs
      var utbody = '';
      (d.byUser || []).forEach(function (u) {
        utbody +=
          '<tr><td>' +
          _esc(u.email || u.user_id) +
          '</td><td>' +
          u.requests +
          '</td><td>$' +
          (u.cost_usd || 0).toFixed(4) +
          '</td><td>' +
          _esc(u.top_provider || '—') +
          '</td></tr>';
      });
      document.querySelector('#costs-users tbody').innerHTML = utbody || '<tr><td colspan="4">No data yet</td></tr>';

      // Daily costs
      var dhtml = '';
      (d.daily || []).forEach(function (day) {
        dhtml +=
          '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' +
          day.date +
          '</span><span style="color:#10b981;font-weight:600">$' +
          (day.cost_usd || 0).toFixed(4) +
          '</span></div>';
      });
      document.getElementById('costs-daily').innerHTML = dhtml || 'No data yet';

      // Stats bar
      if (d.totalToday !== undefined)
        document.getElementById('val-cost-today').textContent = '$' + d.totalToday.toFixed(2);
      if (d.totalMonth !== undefined)
        document.getElementById('val-cost-month').textContent = '$' + d.totalMonth.toFixed(2);
    } catch (e) {
      console.warn('[Admin] Costs error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // TRAFFIC TAB
  // ══════════════════════════════════════════════════════════
  async function loadTraffic() {
    try {
      const r = await fetch(API + '/api/admin/traffic', { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();

      var tbody = '';
      (d.recent || []).forEach(function (v) {
        var time = new Date(v.created_at).toLocaleTimeString('ro-RO');
        tbody +=
          '<tr><td>' +
          time +
          '</td><td>' +
          _esc(v.ip || '—') +
          '</td><td>' +
          _esc(v.path || '/') +
          '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' +
          _esc(v.user_agent || '—') +
          '</td><td>' +
          _esc(v.country || '—') +
          '</td></tr>';
      });
      document.querySelector('#traffic-table tbody').innerHTML = tbody || '<tr><td colspan="5">No data</td></tr>';

      var shtml = '';
      shtml += '<div style="padding:6px 0"><strong>Vizitatori unici azi:</strong> ' + (d.uniqueToday || 0) + '</div>';
      shtml += '<div style="padding:6px 0"><strong>Total pageviews azi:</strong> ' + (d.totalToday || 0) + '</div>';
      shtml += '<div style="padding:6px 0"><strong>Conexiuni active:</strong> ' + (d.activeConnections || 0) + '</div>';
      document.getElementById('traffic-stats').innerHTML = shtml;

      if (d.totalToday !== undefined) document.getElementById('val-requests').textContent = d.totalToday;
    } catch (e) {
      console.warn('[Admin] Traffic error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // USERS TAB
  // ══════════════════════════════════════════════════════════
  async function loadUsers() {
    try {
      const r = await fetch(API + '/api/admin/users', { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();

      var tbody = '';
      (d.users || []).forEach(function (u) {
        tbody +=
          '<tr><td>' +
          _esc(u.email || '—') +
          '</td><td>' +
          _esc(u.name || '—') +
          '</td><td>' +
          _esc(u.plan || 'free') +
          '</td><td>' +
          (u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—') +
          '</td><td>' +
          (u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('ro-RO') : '—') +
          '</td><td>' +
          (u.message_count || 0) +
          '</td></tr>';
      });
      document.querySelector('#users-table tbody').innerHTML = tbody || '<tr><td colspan="6">No users</td></tr>';
      document.getElementById('val-users').textContent = (d.users || []).length;
    } catch (e) {
      console.warn('[Admin] Users error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // REVENUE TAB
  // ══════════════════════════════════════════════════════════
  async function loadRevenue() {
    try {
      const r = await fetch(API + '/api/admin/revenue', { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      document.getElementById('rev-subscribers').textContent = d.subscribers || 0;
      document.getElementById('rev-mrr').textContent = '$' + (d.mrr || 0).toFixed(2);
      document.getElementById('rev-churn').textContent = (d.churnRate || 0).toFixed(1) + '%';
      var phtml = '';
      (d.recentPayments || []).forEach(function (p) {
        phtml +=
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' +
          _esc(p.email || p.user_id) +
          '</span><span style="color:#10b981">$' +
          (p.amount || 0).toFixed(2) +
          '</span><span style="color:#888">' +
          _esc(p.plan || 'pro') +
          '</span></div>';
      });
      document.getElementById('rev-payments').innerHTML = phtml || 'No payments yet';
    } catch (e) {
      console.warn('[Admin] Revenue error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // DEPLOY TAB
  // ══════════════════════════════════════════════════════════
  async function loadDeploy() {
    try {
      const r = await fetch(API + '/api/health');
      if (r.ok) {
        const d = await r.json();
        var html = '<div style="padding:6px 0">🟢 <strong>Status:</strong> ' + (d.status || 'unknown') + '</div>';
        html += '<div style="padding:6px 0">🧠 <strong>Brain:</strong> ' + (d.brain || 'unknown') + '</div>';
        if (d.services) {
          html += '<div style="padding:6px 0"><strong>Services:</strong></div>';
          for (var s in d.services) {
            html += '<div style="padding:2px 0;margin-left:16px">' + (d.services[s] ? '🟢' : '⚫') + ' ' + s + '</div>';
          }
        }
        document.getElementById('deploy-status').innerHTML = html;
      }
    } catch (e) {
      document.getElementById('deploy-status').textContent = '🔴 Offline: ' + e.message;
    }
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    var user = await checkAccess();
    if (!user) return;
    initTabs();
    loadBrain(); // load default tab

    // Button handlers
    var resetAll = document.getElementById('btn-reset-all');
    if (resetAll)
      resetAll.addEventListener('click', function () {
        fetch(API + '/api/brain/reset', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ tool: 'all' }),
        }).then(function () {
          alert('All tools reset!');
          loadBrain();
        });
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
