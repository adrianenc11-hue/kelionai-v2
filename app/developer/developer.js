// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Developer Portal Frontend
// ═══════════════════════════════════════════════════════════════
'use strict';

// ─── State ───────────────────────────────────────────────────────
let authToken = localStorage.getItem('kelion_token') || null;
let currentUser = null;
let pendingRevokeId = null;
let savedApiKey = localStorage.getItem('dev_api_key') || null;

// ─── DOM helpers ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

// ─── AUTH ─────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    return res;
}

async function checkAuth() {
    if (!authToken) { showAuthOverlay(); return; }
    try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
            currentUser = (await res.json()).user;
            hideAuthOverlay();
            renderNavUser();
            loadOverviewStats();
            loadKeys();
            loadWebhook();
        } else {
            authToken = null;
            localStorage.removeItem('kelion_token');
            showAuthOverlay();
        }
    } catch (_) { showAuthOverlay(); }
}

function showAuthOverlay() {
    $('dev-auth-overlay').classList.remove('hidden');
}
function hideAuthOverlay() {
    $('dev-auth-overlay').classList.add('hidden');
}
function renderNavUser() {
    if (!currentUser) return;
    $('nav-user').textContent = currentUser.email;
    $('nav-logout-btn').style.display = 'inline-block';
}

// Toggle register / login
let isRegister = false;
$('auth-toggle-link').addEventListener('click', () => {
    isRegister = !isRegister;
    $('auth-name-row').style.display = isRegister ? 'block' : 'none';
    $('auth-submit-btn').textContent = isRegister ? 'Create Account' : 'Sign In';
    $('auth-toggle-link').textContent = isRegister ? 'Sign in instead' : 'Create one';
    document.querySelector('#auth-switch').firstChild.textContent = isRegister ? 'Already have an account? ' : "Don't have an account? ";
    $('auth-err').textContent = '';
});

$('auth-submit-btn').addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const name = $('auth-name').value.trim();
    if (!email || !password) { $('auth-err').textContent = 'Email and password required'; return; }

    $('auth-submit-btn').disabled = true;
    $('auth-err').textContent = '';
    try {
        const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
        const body = isRegister ? { email, password, name } : { email, password };
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) { $('auth-err').textContent = data.error || 'Auth failed'; return; }
        authToken = data.session?.access_token;
        if (authToken) localStorage.setItem('kelion_token', authToken);
        currentUser = data.user;
        hideAuthOverlay();
        renderNavUser();
        loadOverviewStats();
        loadKeys();
        loadWebhook();
    } catch (_) { $('auth-err').textContent = 'Network error'; }
    finally { $('auth-submit-btn').disabled = false; }
});

$('nav-logout-btn').addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('kelion_token');
    $('nav-user').textContent = '';
    $('nav-logout-btn').style.display = 'none';
    showAuthOverlay();
});

// ─── NAVIGATION ───────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchPanel(tab.dataset.panel);
    });
});
document.querySelectorAll('[data-goto]').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.goto));
});

function switchPanel(name) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}

// ─── OVERVIEW STATS ───────────────────────────────────────────────
async function loadOverviewStats() {
    try {
        const res = await apiFetch('/api/developer/stats');
        if (!res.ok) return;
        const d = await res.json();
        $('stat-active-keys').textContent = d.activeKeys;
        $('stat-total-req').textContent = d.totalRequests;
        $('stat-total-keys').textContent = d.totalKeys;
        $('overview-stats').style.display = 'block';
    } catch (_) {}
}

// ─── API KEYS ────────────────────────────────────────────────────
async function loadKeys() {
    try {
        const res = await apiFetch('/api/developer/keys');
        if (!res.ok) return;
        const { keys } = await res.json();
        renderKeyList(keys);
    } catch (_) {}
}

function renderKeyList(keys) {
    const el = $('key-list');
    if (!keys || !keys.length) {
        el.innerHTML = '<div class="empty-state"><div class="icon">🔑</div><p>No API keys yet. Generate one above.</p></div>';
        return;
    }
    el.innerHTML = keys.map(k => `
        <div class="key-item" data-id="${k.id}">
            <div class="key-info">
                <div class="key-name">${escHtml(k.name)}</div>
                <div class="key-preview">${escHtml(k.key_preview || '')}</div>
                <div class="key-meta">
                    Created ${fmtDate(k.created_at)} &nbsp;·&nbsp;
                    ${k.last_used_at ? 'Last used ' + fmtDate(k.last_used_at) : 'Never used'} &nbsp;·&nbsp;
                    ${k.request_count || 0} requests &nbsp;·&nbsp;
                    ${k.rate_limit || 100} req/hr limit
                </div>
            </div>
            <span class="key-badge ${k.revoked_at ? 'revoked' : 'active'}">${k.revoked_at ? 'REVOKED' : 'ACTIVE'}</span>
            <div class="key-actions">
                ${!k.revoked_at ? `<button class="btn btn-danger btn-sm revoke-btn" data-id="${k.id}">Revoke</button>` : ''}
            </div>
        </div>
    `).join('');

    el.querySelectorAll('.revoke-btn').forEach(btn => {
        btn.addEventListener('click', () => openRevokeModal(btn.dataset.id));
    });
}

$('create-key-btn').addEventListener('click', async () => {
    const name = $('new-key-name').value.trim() || 'My API Key';
    $('create-key-btn').disabled = true;
    hideAlert('key-alert');
    $('new-key-reveal').style.display = 'none';
    try {
        const res = await apiFetch('/api/developer/keys', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) { showAlert('key-alert', data.error || 'Failed to create key', 'error'); return; }
        const newKey = data.key;
        // Show the full key once
        $('new-key-text').textContent = newKey.key;
        $('new-key-reveal').style.display = 'block';
        savedApiKey = newKey.key;
        localStorage.setItem('dev_api_key', newKey.key);
        $('sb-apikey').value = newKey.key;
        $('new-key-name').value = '';
        loadKeys();
        loadOverviewStats();
    } catch (_) { showAlert('key-alert', 'Network error', 'error'); }
    finally { $('create-key-btn').disabled = false; }
});

$('copy-key-btn').addEventListener('click', () => {
    const txt = $('new-key-text').textContent;
    navigator.clipboard.writeText(txt).then(() => {
        $('copy-key-btn').textContent = '✓ Copied';
        setTimeout(() => { $('copy-key-btn').textContent = 'Copy'; }, 2000);
    }).catch(() => { $('copy-key-btn').textContent = 'Copy'; });
});

// ─── REVOKE MODAL ─────────────────────────────────────────────────
function openRevokeModal(id) {
    pendingRevokeId = id;
    $('revoke-modal').classList.add('show');
}
function closeRevokeModal() {
    pendingRevokeId = null;
    $('revoke-modal').classList.remove('show');
}
$('revoke-cancel').addEventListener('click', closeRevokeModal);
$('revoke-cancel2').addEventListener('click', closeRevokeModal);
$('revoke-confirm-btn').addEventListener('click', async () => {
    if (!pendingRevokeId) return;
    const id = pendingRevokeId;
    closeRevokeModal();
    try {
        const res = await apiFetch('/api/developer/keys/' + id, { method: 'DELETE' });
        if (res.ok) {
            showAlert('key-alert', 'Key revoked successfully.', 'success');
            loadKeys();
            loadOverviewStats();
        } else {
            const d = await res.json();
            showAlert('key-alert', d.error || 'Failed to revoke key', 'error');
        }
    } catch (_) { showAlert('key-alert', 'Network error', 'error'); }
});

// ─── WEBHOOKS ────────────────────────────────────────────────────
async function loadWebhook() {
    try {
        const res = await apiFetch('/api/developer/webhooks');
        if (!res.ok) return;
        const { url } = await res.json();
        if (url) $('webhook-url-input').value = url;
    } catch (_) {}
}

$('save-webhook-btn').addEventListener('click', async () => {
    const url = $('webhook-url-input').value.trim();
    $('save-webhook-btn').disabled = true;
    hideAlert('webhook-alert');
    try {
        const res = await apiFetch('/api/developer/webhooks', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (!res.ok) { showAlert('webhook-alert', data.error || 'Failed to save', 'error'); return; }
        showAlert('webhook-alert', url ? 'Webhook saved!' : 'Webhook removed.', 'success');
    } catch (_) { showAlert('webhook-alert', 'Network error', 'error'); }
    finally { $('save-webhook-btn').disabled = false; }
});

// ─── SANDBOX ─────────────────────────────────────────────────────
const sbEndpoint = $('sb-endpoint');
const sbMethod = $('sb-method');

sbEndpoint.addEventListener('change', () => {
    const val = sbEndpoint.value;
    if (val === '/api/v1/status' || val === '/api/v1/models' || val === '/api/v1/user/profile') {
        sbMethod.value = 'GET';
        $('sb-body').value = '';
    } else {
        sbMethod.value = 'POST';
        $('sb-body').value = '{"message": "Hello! What can you do?"}';
    }
});

$('sb-run-btn').addEventListener('click', async () => {
    const endpoint = sbEndpoint.value;
    const method = sbMethod.value;
    const apiKey = $('sb-apikey').value.trim() || savedApiKey;
    const bodyText = $('sb-body').value.trim();

    $('sb-run-btn').disabled = true;
    $('sandbox-status').textContent = 'Running…';
    $('sandbox-status').className = '';
    $('sb-response').value = '';
    $('sb-status-code').textContent = '';
    $('sb-duration').textContent = '';

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const opts = { method, headers };
    if (method === 'POST' && bodyText) {
        try { opts.body = JSON.stringify(JSON.parse(bodyText)); }
        catch (_) { opts.body = bodyText; }
    }

    const start = Date.now();
    try {
        const res = await fetch(endpoint, opts);
        const duration = Date.now() - start;
        let text;
        try { text = JSON.stringify(await res.json(), null, 2); } catch (_) { text = await res.text(); }
        $('sb-response').value = text;
        $('sb-status-code').textContent = 'HTTP ' + res.status;
        $('sb-duration').textContent = duration + 'ms';
        $('sandbox-status').textContent = res.ok ? '✓ Success' : '✗ Error';
        $('sandbox-status').className = res.ok ? 'ok' : 'err';
    } catch (e) {
        $('sb-response').value = 'Network error: ' + e.message;
        $('sandbox-status').textContent = '✗ Failed';
        $('sandbox-status').className = 'err';
    } finally {
        $('sb-run-btn').disabled = false;
    }
});

// ─── DOCS ACCORDIONS ─────────────────────────────────────────────
document.querySelectorAll('.endpoint-header').forEach(header => {
    header.addEventListener('click', () => {
        header.closest('.endpoint').classList.toggle('open');
    });
});

// ─── HELPERS ─────────────────────────────────────────────────────
function showAlert(id, msg, type) {
    const el = $(id);
    el.textContent = msg;
    el.className = 'alert show ' + type;
    setTimeout(() => { el.className = 'alert'; }, 5000);
}
function hideAlert(id) { $(id).className = 'alert'; }
function fmtDate(iso) {
    if (!iso) return 'never';
    return new Date(iso).toLocaleDateString();
}
function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── PRE-FILL sandbox API key if saved ───────────────────────────
if (savedApiKey) $('sb-apikey').value = savedApiKey;

// ─── INIT ─────────────────────────────────────────────────────────
checkAuth();
