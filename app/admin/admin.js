// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Admin Panel Frontend
// INVISIBLE to regular users — super_admin only
// ═══════════════════════════════════════════════════════════════
'use strict';

let _token = null;
let _refreshTimer = null;
let _countdownVal = 30;
let _countdownInterval = null;

// ── Auth ──
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) { loginError.textContent = data.error || 'Login failed'; return; }

        _token = data.session && data.session.access_token;
        if (!_token) { loginError.textContent = 'No token received'; return; }

        // Verify super_admin by hitting a protected endpoint
        const check = await fetch('/api/admin/health', {
            headers: { 'Authorization': 'Bearer ' + _token }
        });
        if (check.status === 401 || check.status === 403) {
            loginError.textContent = 'Access denied — super_admin only';
            _token = null;
            return;
        }

        // Store token in sessionStorage for page refresh
        sessionStorage.setItem('admin_token', _token);
        showDashboard();
    } catch (err) {
        loginError.textContent = 'Network error';
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    _token = null;
    sessionStorage.removeItem('admin_token');
    clearInterval(_countdownInterval);
    clearTimeout(_refreshTimer);
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
});

document.getElementById('refresh-btn').addEventListener('click', () => {
    resetCountdown();
    loadDashboard();
});

// ── Dashboard ──
function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    // Attach bot toggle event listeners
    document.querySelectorAll('[data-bot]').forEach(el => {
        el.addEventListener('change', function () { toggleBot(this); });
    });
    loadDashboard();
    startCountdown();
}

function startCountdown() {
    clearInterval(_countdownInterval);
    _countdownVal = 30;
    document.getElementById('countdown').textContent = _countdownVal;
    _countdownInterval = setInterval(() => {
        _countdownVal--;
        document.getElementById('countdown').textContent = _countdownVal;
        if (_countdownVal <= 0) {
            resetCountdown();
            loadDashboard();
        }
    }, 1000);
}

function resetCountdown() {
    _countdownVal = 30;
    document.getElementById('countdown').textContent = _countdownVal;
}

async function apiGet(path) {
    const res = await fetch(path, {
        headers: { 'Authorization': 'Bearer ' + _token }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function fmt(val) {
    if (val === 'N/A' || val === null || val === undefined) return 'N/A';
    if (typeof val === 'number') return val.toLocaleString();
    return String(val);
}

function fmtCurrency(val, currency) {
    if (val === 'N/A' || val === null || val === undefined) return 'N/A';
    return Number(val).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (currency || 'EUR');
}

function setValue(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const isNA = (val === 'N/A' || val === null || val === undefined);
    el.textContent = isNA ? 'N/A' : fmt(val);
    if (isNA) el.classList.add('na'); else el.classList.remove('na');
}

function setValueCurrency(id, val, currency) {
    const el = document.getElementById(id);
    if (!el) return;
    const isNA = (val === 'N/A' || val === null || val === undefined);
    el.textContent = isNA ? 'N/A' : fmtCurrency(val, currency);
    if (isNA) el.classList.add('na'); else el.classList.remove('na');
}

async function loadDashboard() {
    try {
        const data = await apiGet('/api/admin/dashboard');

        // Users
        const u = data.users;
        if (u && u !== 'N/A') {
            setValue('u-total', u.total);
            setValue('u-today', u.today);
            setValue('u-active', u.active_7days);
            const paid = (u.pro !== 'N/A' && u.premium !== 'N/A')
                ? (Number(u.pro) || 0) + (Number(u.premium) || 0)
                : 'N/A';
            setValue('u-paid', paid);
        } else {
            ['u-total', 'u-today', 'u-active', 'u-paid'].forEach(id => setValue(id, 'N/A'));
        }

        // Revenue
        const r = data.revenue;
        if (r && r !== 'N/A') {
            setValueCurrency('r-mrr', r.mrr, r.currency);
            setValueCurrency('r-today', r.today, r.currency);
            setValue('r-subs', r.active_subscriptions);
        } else {
            ['r-mrr', 'r-today', 'r-subs'].forEach(id => setValue(id, 'N/A'));
        }

        // Usage
        const ug = data.usage;
        if (ug && ug !== 'N/A') {
            setValue('ug-chat', ug.chat_today);
            setValue('ug-tts', ug.tts_today);
            setValue('ug-vision', ug.vision_today);
            setValue('ug-search', ug.search_today);
        } else {
            ['ug-chat', 'ug-tts', 'ug-vision', 'ug-search'].forEach(id => setValue(id, 'N/A'));
        }

        // Conversations
        const c = data.conversations;
        if (c && c !== 'N/A') {
            setValue('c-total', c.total);
            setValue('c-today', c.today);
        } else {
            setValue('c-total', 'N/A');
            setValue('c-today', 'N/A');
        }

        // Bots
        const bots = data.bots;
        if (bots && bots !== 'N/A') {
            ['news', 'trading', 'sports'].forEach(name => {
                const b = bots[name] || {};
                const el = document.getElementById('bot-' + name);
                if (el) el.checked = !!b.enabled;
                const lastEl = document.getElementById('bot-' + name + '-last');
                if (lastEl) {
                    lastEl.textContent = b.lastRun
                        ? 'Last run: ' + new Date(b.lastRun).toLocaleString()
                        : 'Last run: —';
                }
            });
        }

        // System
        const sys = data.system;
        const sysEl = document.getElementById('system-info');
        if (sysEl && sys) {
            sysEl.innerHTML = `
                <div class="row-item"><span class="row-label">Uptime</span><span class="row-val">${Math.floor(sys.uptime / 60)}m ${sys.uptime % 60}s</span></div>
                <div class="row-item"><span class="row-label">Memory RSS</span><span class="row-val">${sys.memory ? sys.memory.rss : 'N/A'}</span></div>
                <div class="row-item"><span class="row-label">Memory Heap</span><span class="row-val">${sys.memory ? sys.memory.heap : 'N/A'}</span></div>
                <div class="row-item"><span class="row-label">Node.js</span><span class="row-val">${sys.nodeVersion || 'N/A'}</span></div>
            `;
        }

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

    } catch (err) {
        console.error('Dashboard load error:', err);
    }

    // Load health separately
    loadHealth();
}

async function loadHealth() {
    try {
        const data = await apiGet('/api/admin/health');
        const el = document.getElementById('health-services');
        if (!el) return;

        const services = data.services || {};
        const rows = Object.entries(services).map(([key, val]) => {
            let status = 'unconfigured';
            let label = key;
            if (typeof val === 'boolean') { status = val ? 'ok' : 'unconfigured'; }
            else if (val && val.status) { status = val.status; }

            const latency = (val && val.latency) ? ` (${val.latency}ms)` : '';
            const dotClass = status === 'ok' ? 'ok' : (status === 'error' ? 'error' : 'unconfigured');
            const displayStatus = status === 'ok' ? '✓ OK' + latency : (status === 'error' ? '✗ ERROR' : '— N/A');
            const color = status === 'ok' ? 'var(--green)' : (status === 'error' ? 'var(--red)' : 'var(--muted)');

            return `<div class="row-item">
                <span class="row-label"><span class="health-dot ${dotClass}"></span>${label}</span>
                <span class="row-val" style="color:${color}">${displayStatus}</span>
            </div>`;
        }).join('');

        el.innerHTML = `<div class="card-label" style="margin-bottom:12px">Services</div>` + rows;
    } catch (err) {
        const el = document.getElementById('health-services');
        if (el) el.innerHTML = '<div class="card-label">Health data unavailable</div>';
    }
}

async function toggleBot(checkbox) {
    const name = checkbox.getAttribute('data-bot');
    const enabled = checkbox.checked;

    try {
        const res = await fetch('/api/admin/bots/toggle', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + _token
            },
            body: JSON.stringify({ name, enabled })
        });
        if (!res.ok) {
            // Revert toggle on failure
            checkbox.checked = !enabled;
            const data = await res.json();
            alert('Toggle failed: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        checkbox.checked = !enabled;
        alert('Network error');
    }
}

// ── Auto-login from session storage ──
(function init() {
    const saved = sessionStorage.getItem('admin_token');
    if (saved) {
        _token = saved;
        // Verify token is still valid
        fetch('/api/admin/health', { headers: { 'Authorization': 'Bearer ' + _token } })
            .then(r => {
                if (r.status === 200) { showDashboard(); }
                else { sessionStorage.removeItem('admin_token'); _token = null; }
            })
            .catch(() => { sessionStorage.removeItem('admin_token'); _token = null; });
    }
})();
