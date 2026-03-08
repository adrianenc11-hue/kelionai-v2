/* ═══════════════════════════════════════════════════════════════
   KelionAI — Admin Panel V2 App Logic
   External JS to avoid CSP inline-script blocking
   ═══════════════════════════════════════════════════════════════ */
"use strict";

var adminSecret = 'kAI-adm1n-s3cr3t-2026-pr0d';
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
async function rechargeProvider(name, currentCredit) {
    var newAmount = prompt('💳 ' + name + ' — Credit: $' + currentCredit.toFixed(2) + '\n\nIntrodu noul credit ($):', '');
    if (newAmount === null || newAmount === '') return;
    var amount = parseFloat(newAmount);
    if (isNaN(amount) || amount < 0) return;
    try {
        await fetch('/api/admin/provider-credit', {
            method: 'POST', headers: hdrs(),
            body: JSON.stringify({ provider: name, amount: amount })
        });
        loadAiStatus();
    } catch (e) { }
}
async function loadAiStatus() {
    try {
        var r = await fetch('/api/admin/ai-status', { headers: hdrs() });
        var d = await r.json();
        var grid = document.getElementById('ai-status-grid');
        grid.innerHTML = '';
        d.providers.forEach(function (p) {
            var card = document.createElement('div');
            card.className = 'ai-card ' + (p.live ? 'live' : 'off');
            var creditColor = p.creditLimit > 0 ? (p.credit > 1 ? '#10B981' : p.credit > 0 ? '#F59E0B' : '#EF4444') : '#888';
            card.innerHTML = '<div class="ai-status-dot ' + (p.live ? 'dot-live' : 'dot-off') + '"></div>' +
                '<div class="ai-name">' + p.name + '</div>' +
                '<div class="ai-detail">' + (p.live ? '🟢 Live' : '🔴 Off') + '</div>' +
                '<div class="ai-cost">$' + (p.costMonth || 0).toFixed(2) + '/mo</div>' +
                '<div class="ai-credit" onclick="rechargeProvider(\'' + p.name + '\',' + (p.creditLimit || 0) + ')" ' +
                'style="font-size:0.7rem;margin-top:4px;color:' + creditColor + ';font-weight:600;cursor:pointer" ' +
                'title="Click pentru a reîncărca creditul">' +
                '💳 Credit: ' + (p.creditLabel || '—') + '</div>';
            grid.appendChild(card);
        });
    } catch (e) { document.getElementById('ai-status-grid').innerHTML = '<div class="ai-card off"><div class="ai-name">Error</div></div>'; }
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
function parseDevice(ua) {
    if (!ua) return '—';
    if (ua.includes('Mobile') || ua.includes('Android')) return '📱 Mobile';
    if (ua.includes('iPad') || ua.includes('Tablet')) return '📱 Tablet';
    return '💻 Desktop';
}
async function deleteVisit(id) {
    if (!confirm('Ștergi această vizită?')) return;
    try {
        await fetch('/api/admin/traffic/' + id, { method: 'DELETE', headers: hdrs() });
        loadTraffic();
    } catch (e) { alert('Error: ' + e.message); }
}
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
            tbody.innerHTML = d.recent.slice(0, 30).map(function (v) {
                var time = new Date(v.created_at).toLocaleTimeString('ro-RO');
                var browser = parseBrowser(v.user_agent);
                var device = parseDevice(v.user_agent);
                return '<tr><td>' + time + '</td><td>' + esc(v.path) + '</td><td>' + esc(v.ip) + '</td>' +
                    '<td>' + esc(v.country || '—') + '</td><td>' + browser + '</td><td>' + device + '</td>' +
                    '<td><button class="btn-sm btn-danger" onclick="deleteVisit(\'' + v.id + '\')" title="Șterge">🗑️</button></td></tr>';
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
        } else {
            tbody.innerHTML = '<tr><td colspan="6" style="color:#888;text-align:center">No cost data this month</td></tr>';
        }
        if (d.totalMonth > 0) {
            var el = document.getElementById('credit-distribution');
            var distHtml = '<h4 style="margin:12px 0 8px;color:#06b6d4">Distribuție costuri:</h4>';
            d.byProvider.forEach(function (p) {
                var pct = ((p.cost_usd / d.totalMonth) * 100).toFixed(1);
                distHtml += '<div class="dist-row"><span class="dist-name">' + p.provider + '</span>' +
                    '<div class="dist-bar-wrap"><div class="dist-bar" style="width:' + pct + '%"></div></div>' +
                    '<span class="dist-amount">$' + p.cost_usd.toFixed(2) + ' (' + pct + '%)</span></div>';
            });
            el.innerHTML = distHtml;
        } else {
            var el = document.getElementById('credit-distribution');
            if (el) el.innerHTML = '';
        }
    } catch (e) {
        var tb = document.querySelector('#credit-table tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="color:#f66;text-align:center">Error loading costs</td></tr>';
    }
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

// ── MEDIA HISTORY ──
async function loadMedia() {
    try {
        var r = await fetch('/api/admin/media', { headers: hdrs() });
        var d = await r.json();
        var stats = d.stats || {};

        document.getElementById('media-total').textContent = d.totalCount || 0;
        document.getElementById('media-images').textContent = (stats.image || 0) + (stats.vision || 0);
        document.getElementById('media-tts').textContent = stats.tts || 0;
        var otherCount = (d.totalCount || 0) - (stats.image || 0) - (stats.vision || 0) - (stats.tts || 0);
        document.getElementById('media-other').textContent = Math.max(0, otherCount);

        var tb = document.getElementById('media-tbody');
        if (!d.recent || d.recent.length === 0) {
            var msg = (d.totalCount > 0)
                ? d.totalCount + ' records in database (details restricted by row-level security)'
                : 'No media generated yet';
            tb.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center">' + msg + '</td></tr>';
            return;
        }
        tb.innerHTML = d.recent.map(function (m) {
            var date = new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            var urlCell = m.url ? '<a href="' + esc(m.url) + '" target="_blank" style="color:#06B6D4">View</a>' : '—';
            var prompt = m.prompt ? esc(m.prompt).substring(0, 60) + (m.prompt.length > 60 ? '…' : '') : '—';
            return '<tr><td>' + esc(date) + '</td><td>' + esc(m.type || '—') + '</td><td style="font-size:0.7rem">' + esc((m.user_id || '').substring(0, 8)) + '</td><td>' + prompt + '</td><td>' + urlCell + '</td></tr>';
        }).join('');
    } catch (e) {
        document.getElementById('media-tbody').innerHTML = '<tr><td colspan="5" style="color:#f66">Error loading media</td></tr>';
    }
}

// ── TRADING ──
async function loadTrading() {
    try {
        var r = await fetch('/api/admin/trading', { headers: hdrs() });
        var d = await r.json();
        var s = d.stats || {};

        document.getElementById('trade-total').textContent = s.totalTrades || 0;
        document.getElementById('trade-active').textContent = s.activeTrades || 0;
        var pnlVal = parseFloat(s.totalPnl) || 0;
        var pnlEl = document.getElementById('trade-pnl');
        pnlEl.textContent = (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(2) + ' $';
        pnlEl.style.color = pnlVal >= 0 ? '#10B981' : '#EF4444';
        document.getElementById('trade-winrate').textContent = (s.winRate || 0) + '%';
        var binanceEl = document.getElementById('trade-binance');
        binanceEl.textContent = s.binanceConfigured ? (s.binanceMode === 'testnet' ? '🟡 Testnet' : '🟢 Live') : '🔴 Not configured';

        // Recent trades
        var tb = document.getElementById('trading-tbody');
        if (!d.recentTrades || d.recentTrades.length === 0) {
            tb.innerHTML = '<tr><td colspan="7" style="color:#666;text-align:center">No trades yet</td></tr>';
        } else {
            tb.innerHTML = d.recentTrades.slice(0, 20).map(function (t) {
                var date = new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                var pnl = parseFloat(t.pnl) || 0;
                var pnlColor = pnl > 0 ? '#10B981' : pnl < 0 ? '#EF4444' : '#888';
                var sideColor = t.side === 'buy' ? '#10B981' : '#EF4444';
                return '<tr><td>' + esc(date) + '</td><td><strong>' + esc(t.symbol || '—') + '</strong></td><td style="color:' + sideColor + '">' + esc((t.side || '—').toUpperCase()) + '</td><td>' + esc(t.quantity || '—') + '</td><td>$' + esc(parseFloat(t.price || 0).toFixed(2)) + '</td><td>' + esc(t.status || '—') + '</td><td style="color:' + pnlColor + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '</td></tr>';
            }).join('');
        }

        // Intelligence
        var ib = document.getElementById('intel-tbody');
        if (!d.intelligence || d.intelligence.length === 0) {
            ib.innerHTML = '<tr><td colspan="5" style="color:#666;text-align:center">No intelligence data yet</td></tr>';
        } else {
            ib.innerHTML = d.intelligence.slice(0, 10).map(function (i) {
                var date = new Date(i.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                var signalColor = i.signal === 'buy' ? '#10B981' : i.signal === 'sell' ? '#EF4444' : '#F59E0B';
                var analysis = i.analysis ? esc(String(i.analysis)).substring(0, 80) + '…' : '—';
                return '<tr><td>' + esc(date) + '</td><td><strong>' + esc(i.symbol || '—') + '</strong></td><td style="color:' + signalColor + '">' + esc((i.signal || '—').toUpperCase()) + '</td><td>' + esc(Math.round((i.confidence || 0) * 100)) + '%</td><td style="font-size:0.78rem">' + analysis + '</td></tr>';
            }).join('');
        }
    } catch (e) {
        document.getElementById('trading-tbody').innerHTML = '<tr><td colspan="7" style="color:#f66">Error loading trades</td></tr>';
    }
}

// ── INIT — Auth-guarded (#156: prevent 403 flood) ──
var _adminIntervals = [];
async function initAdmin() {
    // Check auth before loading anything
    try {
        var testR = await fetch('/api/admin/ai-status', { headers: hdrs() });
        if (testR.status === 401 || testR.status === 403) {
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#f66;font-size:1.5rem;background:#0a0a14;"><div>🔒 Admin access denied</div><div style="font-size:0.9rem;color:#888;margin-top:8px">Please enter admin code in chat first.</div><a href="/" style="margin-top:16px;color:#a5b4fc;text-decoration:none;">← Back to KelionAI</a></div>';
            return;
        }
    } catch (e) {
        console.warn('[Admin] Auth check failed:', e.message);
    }
    // Auth OK — load all sections
    loadAiStatus(); loadTraffic(); loadCredit(); loadClients(); loadCodes(); loadUptime(); loadAudit(); loadMedia(); loadTrading();
    _adminIntervals.push(setInterval(function () { loadTraffic(); loadCredit(); loadUptime(); }, 30000));
    _adminIntervals.push(setInterval(loadAiStatus, 60000));
    _adminIntervals.push(setInterval(loadAudit, 6 * 60 * 60 * 1000));
    _adminIntervals.push(setInterval(function () { loadMedia(); loadTrading(); }, 60000));
}
initAdmin();


