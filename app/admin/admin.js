// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Panel JS
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const API = window.location.origin;

    function getToken() { return sessionStorage.getItem('kelion_token'); }
    function authHeaders() {
        const h = { 'Content-Type': 'application/json' };
        const t = getToken();
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    }

    // ── Check admin access ──
    async function checkAccess() {
        try {
            const r = await fetch(API + '/api/auth/me', { headers: authHeaders() });
            if (!r.ok) { window.location.href = '/'; return null; }
            const d = await r.json();
            if (d.user?.role !== 'admin') { window.location.href = '/'; return null; }
            document.getElementById('admin-user').textContent = d.user.email;
            return d.user;
        } catch (e) { window.location.href = '/'; return null; }
    }

    // ── Tab switching ──
    function initTabs() {
        document.querySelectorAll('.tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
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
            case 'brain': await loadBrain(); break;
            case 'costs': await loadCosts(); break;
            case 'traffic': await loadTraffic(); break;
            case 'users': await loadUsers(); break;
            case 'revenue': await loadRevenue(); break;
            case 'trading': await loadTrading(); break;
            case 'deploy': await loadDeploy(); break;
        }
    }

    // ══════════════════════════════════════════════════════════
    // BRAIN TAB
    // ══════════════════════════════════════════════════════════
    async function loadBrain() {
        try {
            const r = await fetch(API + '/api/admin/brain', { headers: authHeaders() });
            if (!r.ok) { document.getElementById('brain-tools').textContent = 'Error loading'; return; }
            const d = await r.json();

            // Tool stats
            var html = '<table class="admin-table"><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Status</th></tr></thead><tbody>';
            var tools = d.toolStats || {};
            var errors = d.toolErrors || {};
            for (var t in tools) {
                var err = errors[t] || 0;
                var status = err > 5 ? '🔴' : err > 0 ? '🟡' : '🟢';
                html += '<tr><td>' + t + '</td><td>' + tools[t] + '</td><td>' + err + '</td><td>' + status + '</td></tr>';
            }
            html += '</tbody></table>';
            document.getElementById('brain-tools').innerHTML = html;

            // Providers
            var providers = d.providers || {};
            var phtml = '';
            for (var p in providers) {
                var ok = providers[p] ? '🟢 Active' : '⚫ Missing';
                phtml += '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' + p + '</span><span>' + ok + '</span></div>';
            }
            document.getElementById('brain-providers').innerHTML = phtml || 'No data';

            // Uptime
            if (d.uptime) document.getElementById('admin-uptime').textContent = '⏱ ' + Math.round(d.uptime / 60) + 'min uptime';
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
                tbody += '<tr><td>' + p.provider + '</td><td>' + p.requests + '</td><td>' + (p.tokens_in || 0) + '</td><td>' + (p.tokens_out || 0) + '</td><td>$' + (p.cost_usd || 0).toFixed(4) + '</td></tr>';
            });
            document.querySelector('#costs-provider tbody').innerHTML = tbody || '<tr><td colspan="5">No data yet</td></tr>';

            // User costs
            var utbody = '';
            (d.byUser || []).forEach(function (u) {
                utbody += '<tr><td>' + (u.email || u.user_id) + '</td><td>' + u.requests + '</td><td>$' + (u.cost_usd || 0).toFixed(4) + '</td><td>' + (u.top_provider || '—') + '</td></tr>';
            });
            document.querySelector('#costs-users tbody').innerHTML = utbody || '<tr><td colspan="4">No data yet</td></tr>';

            // Daily costs
            var dhtml = '';
            (d.daily || []).forEach(function (day) {
                dhtml += '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' + day.date + '</span><span style="color:#10b981;font-weight:600">$' + (day.cost_usd || 0).toFixed(4) + '</span></div>';
            });
            document.getElementById('costs-daily').innerHTML = dhtml || 'No data yet';

            // Stats bar
            if (d.totalToday !== undefined) document.getElementById('val-cost-today').textContent = '$' + d.totalToday.toFixed(2);
            if (d.totalMonth !== undefined) document.getElementById('val-cost-month').textContent = '$' + d.totalMonth.toFixed(2);
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
                tbody += '<tr><td>' + time + '</td><td>' + (v.ip || '—') + '</td><td>' + (v.path || '/') + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (v.user_agent || '—') + '</td><td>' + (v.country || '—') + '</td></tr>';
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
                tbody += '<tr><td>' + (u.email || '—') + '</td><td>' + (u.name || '—') + '</td><td>' + (u.plan || 'free') + '</td><td>' + (u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—') + '</td><td>' + (u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString('ro-RO') : '—') + '</td><td>' + (u.message_count || 0) + '</td></tr>';
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
                phtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span>' + (p.email || p.user_id) + '</span><span style="color:#10b981">$' + (p.amount || 0).toFixed(2) + '</span><span style="color:#888">' + (p.plan || 'pro') + '</span></div>';
            });
            document.getElementById('rev-payments').innerHTML = phtml || 'No payments yet';
        } catch (e) { console.warn('[Admin] Revenue error:', e.message); }
    }

    // ══════════════════════════════════════════════════════════
    // TRADING TAB
    // ══════════════════════════════════════════════════════════
    async function loadTrading() {
        try {
            const r = await fetch(API + '/api/admin/trading', { headers: authHeaders() });
            if (!r.ok) { document.getElementById('trade-portfolio').textContent = 'Not available'; return; }
            const d = await r.json();
            document.getElementById('trade-portfolio').textContent = d.portfolio || 'No data';
            document.getElementById('trade-pnl').textContent = d.pnl || 'No data';
            document.getElementById('trade-signals').textContent = d.signals || 'No signals';
        } catch (e) { console.warn('[Admin] Trading error:', e.message); }
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
        loadBrain();  // load default tab

        // Button handlers
        var resetAll = document.getElementById('btn-reset-all');
        if (resetAll) resetAll.addEventListener('click', function () {
            fetch(API + '/api/admin/reset', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ tool: 'all' }) })
                .then(function () { alert('All tools reset!'); loadBrain(); });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
