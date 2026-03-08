/* ═══════════════════════════════════════════════════════════════
   KelionAI — Admin Panel V2 App Logic
   External JS to avoid CSP inline-script blocking
   ═══════════════════════════════════════════════════════════════ */
"use strict";

var adminSecret = sessionStorage.getItem('kelion_admin_secret') || '';
function hdrs() {
    var h = { 'Content-Type': 'application/json' };
    if (adminSecret) h['x-admin-secret'] = adminSecret;
    try {
        // Try all known Supabase token storage keys
        var keys = Object.keys(localStorage).filter(function (k) { return k.startsWith('sb-') && k.endsWith('-auth-token'); });
        var t = null;
        for (var i = 0; i < keys.length; i++) {
            try {
                var raw = localStorage.getItem(keys[i]);
                if (raw) {
                    var parsed = JSON.parse(raw);
                    if (parsed && parsed.access_token) { t = parsed.access_token; break; }
                }
            } catch (e2) { }
        }
        // Fallback: direct token
        if (!t) t = localStorage.getItem('sb-access-token');
        if (t) h['Authorization'] = 'Bearer ' + t;
    } catch (e) { }
    return h;
}
function esc(s) { var d = document.createElement('div'); d.textContent = s || '—'; return d.innerHTML; }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── AI STATUS ──
async function loadAiStatus() {
    try {
        var r = await fetch('/api/admin/ai-status', { headers: hdrs() });
        var d = await r.json();
        var grid = document.getElementById('ai-status-grid');
        grid.innerHTML = '';
        d.providers.forEach(function (p) {
            var card = document.createElement('div');
            card.className = 'ai-card ' + (p.live ? 'live' : 'off');
            card.innerHTML = '<div class="ai-status-dot ' + (p.live ? 'dot-live' : 'dot-off') + '"></div>' +
                '<div class="ai-name">' + p.name + '</div>' +
                '<div class="ai-detail">' + (p.live ? '🟢 Live' : '🔴 Off') + '</div>' +
                '<div class="ai-cost">$' + (p.costMonth || 0).toFixed(2) + '/mo</div>';
            grid.appendChild(card);
        });
    } catch (e) { document.getElementById('ai-status-grid').innerHTML = '<div class="ai-card off"><div class="ai-name">Error</div></div>'; }
}

// ── TRAFFIC ──
async function loadTraffic() {
    try {
        var r = await fetch('/api/admin/traffic', { headers: hdrs() });
        var d = await r.json();
        document.getElementById('traffic-unique').textContent = d.uniqueToday || 0;
        document.getElementById('traffic-total').textContent = d.totalToday || 0;
        document.getElementById('traffic-active').textContent = d.activeConnections || 0;
        document.getElementById('val-views-today').textContent = d.totalToday || 0;
        var chart = document.getElementById('traffic-chart');
        if (d.daily && d.daily.length > 0) {
            var max = Math.max.apply(null, d.daily.map(function (x) { return x.count; })) || 1;
            chart.innerHTML = d.daily.map(function (day) {
                var pct = Math.round((day.count / max) * 100);
                return '<div class="bar-col"><div class="bar-value">' + day.count + '</div>' +
                    '<div class="bar" style="height:' + pct + '%"></div>' +
                    '<div class="bar-label">' + day.date.slice(5) + '</div></div>';
            }).join('');
        }
        var tbody = document.querySelector('#visits-table tbody');
        if (d.recent && d.recent.length > 0) {
            tbody.innerHTML = d.recent.slice(0, 20).map(function (v) {
                var time = new Date(v.created_at).toLocaleTimeString('ro-RO');
                return '<tr><td>' + time + '</td><td>' + esc(v.path) + '</td><td>' + esc(v.ip) + '</td><td>' + esc(v.country) + '</td><td>' + esc((v.user_agent || '').substring(0, 40)) + '</td></tr>';
            }).join('');
        }
    } catch (e) { }
}

// ── CREDIT ──
async function loadCredit() {
    try {
        var r = await fetch('/api/admin/costs', { headers: hdrs() });
        var d = await r.json();
        document.getElementById('val-cost-today').textContent = '$' + (d.totalToday || 0).toFixed(2);
        document.getElementById('val-cost-month').textContent = '$' + (d.totalMonth || 0).toFixed(2);
        var tbody = document.querySelector('#credit-table tbody');
        if (d.byProvider && d.byProvider.length > 0) {
            tbody.innerHTML = d.byProvider.map(function (p) {
                var al = p.cost_usd > 5 ? '<span class="badge badge-danger">⚠️ High</span>' :
                    p.cost_usd > 2 ? '<span class="badge badge-warn">📊 Med</span>' : '<span class="badge badge-ok">✅ OK</span>';
                return '<tr><td><strong>' + p.provider + '</strong></td><td>🟢</td><td>' + p.requests + '</td>' +
                    '<td>$' + p.cost_usd.toFixed(4) + '</td><td>$' + (p.cost_today || 0).toFixed(4) + '</td><td>' + al + '</td></tr>';
            }).join('');
        }
        if (d.totalMonth > 0) {
            var el = document.getElementById('credit-distribution');
            el.innerHTML = '<h4 style="margin:12px 0 8px;color:#06b6d4">Distribuție £50:</h4>';
            d.byProvider.forEach(function (p) {
                var pct = ((p.cost_usd / d.totalMonth) * 100).toFixed(1);
                var amt = ((p.cost_usd / d.totalMonth) * 50).toFixed(2);
                el.innerHTML += '<div class="dist-row"><span class="dist-name">' + p.provider + '</span>' +
                    '<div class="dist-bar-wrap"><div class="dist-bar" style="width:' + pct + '%"></div></div>' +
                    '<span class="dist-amount">£' + amt + ' (' + pct + '%)</span></div>';
            });
        }
    } catch (e) { }
}

// ── CLIENTS ──
var _clients = [];
async function loadClients() {
    try {
        var r = await fetch('/api/admin/users', { headers: hdrs() });
        var d = await r.json();
        _clients = d.users || [];
        document.getElementById('val-users').textContent = _clients.length;
        var subs = _clients.filter(function (u) { return u.plan && u.plan !== 'free'; }).length;
        document.getElementById('val-subs').textContent = subs;
        var tbody = document.querySelector('#clients-table tbody');
        if (_clients.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="color:#888">Niciun client</td></tr>'; return; }
        tbody.innerHTML = _clients.map(function (u) {
            var plan = u.plan || 'free';
            var pb = plan === 'premium' ? '<span class="badge badge-ok">⭐ Premium</span>' :
                plan === 'pro' ? '<span class="badge badge-warn">🔥 Pro</span>' : '<span class="badge">Free</span>';
            var date = u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—';
            return '<tr><td>' + esc(u.email) + '</td><td>' + pb + '</td><td><span class="badge badge-ok">Active</span></td>' +
                '<td>' + date + '</td><td>' + (u.message_count || 0) + '</td>' +
                '<td class="action-cell">' +
                '<button class="btn-sm" onclick="upgradePlan(\'' + u.id + '\',\'' + esc(u.email).replace(/'/g, '') + '\')" title="Upgrade">⬆️</button>' +
                '<button class="btn-sm btn-danger" onclick="openRefund(\'' + u.id + '\',\'' + esc(u.email).replace(/'/g, '') + '\',\'' + plan + '\')" title="Refund">💸</button>' +
                '<button class="btn-sm btn-delete" onclick="deleteUser(\'' + u.id + '\',\'' + esc(u.email).replace(/'/g, '') + '\')" title="Șterge user">🗑️</button>' +
                '</td></tr>';
        }).join('');
    } catch (e) { console.error('Clients:', e); }
}

// ── REFUND ──
var _refundUid = null;
function openRefund(uid, email, plan) {
    _refundUid = uid;
    document.getElementById('refund-email').textContent = email;
    document.getElementById('refund-plan').textContent = plan;
    document.getElementById('refund-reason').value = '';
    document.getElementById('refund-modal').classList.remove('hidden');
}
async function confirmRefund() {
    if (!_refundUid) return;
    try {
        var r = await fetch('/api/admin/refund', {
            method: 'POST', headers: hdrs(),
            body: JSON.stringify({ userId: _refundUid, reason: document.getElementById('refund-reason').value || 'Admin' })
        });
        var d = await r.json();
        alert(d.message || 'Refund procesat!');
        closeModal('refund-modal');
        loadClients();
    } catch (e) { alert('Error: ' + e.message); }
}
function upgradePlan(uid, email) {
    var plan = prompt('Upgrade ' + email + ' la:\n\npro / premium / free', 'pro');
    if (!plan) return;
    fetch('/api/admin/upgrade', {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ userId: uid, plan: plan })
    })
        .then(function (r) { return r.json(); })
        .then(function (d) { alert(d.message || 'Done!'); loadClients(); });
}
async function deleteUser(uid, email) {
    if (!confirm('Sigur vrei să ȘTERGI userul ' + email + '?\n\nAceastă acțiune este IREVERSIBILĂ!')) return;
    if (!confirm('CONFIRMARE FINALĂ:\n\nȘterge definitiv ' + email + '?\n\nToate datele vor fi pierdute.')) return;
    try {
        var r = await fetch('/api/admin/users/' + uid, { method: 'DELETE', headers: hdrs() });
        var d = await r.json();
        if (r.ok) { alert('✅ User ' + email + ' șters.'); loadClients(); }
        else { alert('❌ Eroare: ' + (d.error || 'necunoscută')); }
    } catch (e) { alert('Eroare: ' + e.message); }
}

// ── CODES ──
async function loadCodes() {
    try {
        var r = await fetch('/api/admin/codes', { headers: hdrs() });
        var d = await r.json();
        var codes = d.codes || [];
        var tbody = document.querySelector('#codes-table tbody');
        if (codes.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="color:#888">Niciun cod</td></tr>'; return; }
        tbody.innerHTML = codes.map(function (c) {
            var sb = c.used ? '<span class="badge badge-warn">Folosit</span>' : '<span class="badge badge-ok">Activ</span>';
            return '<tr><td><code>' + esc(c.code) + '</code></td><td>' + esc(c.type || 'admin') + '</td><td>' + sb + '</td>' +
                '<td>' + (c.created_at ? new Date(c.created_at).toLocaleDateString('ro-RO') : '—') + '</td>' +
                '<td>' + esc(c.used_by) + '</td>' +
                '<td><button class="btn-sm btn-danger" onclick="deleteCode(\'' + c.id + '\')">🗑️</button></td></tr>';
        }).join('');
    } catch (e) { }
}
async function generateCode() {
    var type = prompt('Tip cod (admin / promo / beta):', 'admin');
    if (!type) return;
    try {
        var r = await fetch('/api/admin/codes', { method: 'POST', headers: hdrs(), body: JSON.stringify({ type: type }) });
        var d = await r.json();
        alert('Cod generat: ' + (d.code || '?'));
        loadCodes();
    } catch (e) { alert('Error'); }
}
async function deleteCode(id) {
    if (!confirm('Ștergi codul?')) return;
    await fetch('/api/admin/codes/' + id, { method: 'DELETE', headers: hdrs() });
    loadCodes();
}

// ── RECHARGE ──
async function recharge() {
    var btn = document.getElementById('btn-recharge');
    btn.disabled = true; btn.textContent = '⏳...';
    try {
        var r = await fetch('/api/admin/recharge', { method: 'POST', headers: hdrs(), body: JSON.stringify({ amount: 50, currency: 'gbp' }) });
        var d = await r.json();
        if (d.url) window.location.href = d.url;
        else { alert(d.message || 'Done!'); btn.textContent = '✅'; loadCredit(); }
    } catch (e) { btn.disabled = false; btn.textContent = '⚡ Reîncărcare £50'; }
}

// ── UPTIME ──
async function loadUptime() {
    try {
        var r = await fetch('/health'); var d = await r.json();
        var m = Math.round(d.uptime / 60), h = Math.floor(m / 60);
        document.getElementById('admin-uptime').textContent = '⏱ ' + (h > 0 ? h + 'h ' : '') + (m % 60) + 'm';
    } catch (e) { }
}

// ── TOGGLE SECTIONS (Accordion) ──
function toggleSection(id) {
    var panel = document.getElementById(id);
    if (!panel) return;
    var isOpen = panel.classList.contains('open');
    panel.classList.toggle('open');
    var arrow = panel.querySelector('.toggle-arrow');
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
}

// ── CODE AUDIT ──
async function loadAudit() {
    var el = document.getElementById('audit-results');
    if (!el) return;
    try {
        var r = await fetch('/api/admin/audit-hardcoded', { headers: hdrs() });
        var d = await r.json();
        if (d.clean) {
            el.innerHTML = '<div style="text-align:center;padding:20px;color:#00ff88;font-size:1.2rem">' +
                '✅ CLEAN — Zero hardcoded values<br>' +
                '<small style="color:#888">' + d.filesScanned + ' files scanned · ' + d.scannedAt + '</small></div>';
        } else {
            var html = '<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">' +
                '<div class="badge badge-danger">🔴 Critical: ' + d.critical + '</div>' +
                '<div class="badge badge-warn">🟠 High: ' + d.high + '</div>' +
                '<div class="badge">🟡 Medium: ' + d.medium + '</div>' +
                '<small style="color:#888;align-self:center">' + d.filesScanned + ' files · ' + d.scannedAt + '</small>' +
                '</div>';
            var all = [].concat(d.findings.CRITICAL || [], d.findings.HIGH || [], d.findings.MEDIUM || []);
            if (all.length > 0) {
                html += '<table class="data-table"><thead><tr><th>File</th><th>Line</th><th>Pattern</th><th>Code</th></tr></thead><tbody>';
                all.forEach(function (f) {
                    var sev = f.pattern.includes('Key') || f.pattern.includes('Bearer') ? 'badge-danger' : f.pattern.includes('domain') || f.pattern.includes('URL') ? 'badge-warn' : '';
                    html += '<tr><td><code>' + esc(f.file) + '</code></td><td>' + f.line + '</td>' +
                        '<td><span class="badge ' + sev + '">' + esc(f.pattern) + '</span></td>' +
                        '<td><code style="font-size:0.7rem;word-break:break-all">' + esc(f.snippet) + '</code></td></tr>';
                });
                html += '</tbody></table>';
                html += '<button class="btn-sm" onclick="runAutoFix()" style="margin-top:8px;background:#6366f1">🔧 Auto-Fix All</button>';
            }
            el.innerHTML = html;
        }
    } catch (e) { el.innerHTML = '<div style="color:#f87171">Error loading audit: ' + e.message + '</div>'; }
}

async function runAutoFix() {
    if (!confirm('Brain-ul va înlocui automat valorile hardcodate cu process.env.APP_URL. Continui?')) return;
    try {
        var r = await fetch('/api/admin/audit-hardcoded/fix', { method: 'POST', headers: hdrs() });
        var d = await r.json();
        alert('Fixed ' + d.fix.count + ' files! Remaining: ' + d.afterScan.total + ' findings.');
        loadAudit();
    } catch (e) { alert('Fix failed: ' + e.message); }
}

// ── INIT ──
loadAiStatus(); loadTraffic(); loadCredit(); loadClients(); loadCodes(); loadUptime(); loadAudit();
setInterval(function () { loadTraffic(); loadCredit(); loadUptime(); }, 30000);
setInterval(loadAiStatus, 60000);
setInterval(loadAudit, 6 * 60 * 60 * 1000); // refresh audit every 6h
