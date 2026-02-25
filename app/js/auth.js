(function () {
    'use strict';
    const API = window.location.origin;
    let currentUser = null;

    function saveSession(s, u) { if (s) { localStorage.setItem('kelion_token', s.access_token); if (s.refresh_token) localStorage.setItem('kelion_refresh_token', s.refresh_token); if (s.expires_at) localStorage.setItem('kelion_token_expires', s.expires_at); } if (u) localStorage.setItem('kelion_user', JSON.stringify(u)); }
    function loadSession() { const t = localStorage.getItem('kelion_token'), u = localStorage.getItem('kelion_user'); if (t && u) { try { currentUser = JSON.parse(u); } catch(e){} } return { token: t, user: currentUser }; }
    function clearSession() { localStorage.removeItem('kelion_token'); localStorage.removeItem('kelion_refresh_token'); localStorage.removeItem('kelion_token_expires'); localStorage.removeItem('kelion_user'); currentUser = null; }
    function getAuthHeaders() { const t = localStorage.getItem('kelion_token'); return t ? { 'Authorization': 'Bearer ' + t } : {}; }
    function isTokenExpired() { const exp = localStorage.getItem('kelion_token_expires'); if (!exp) return false; return (parseInt(exp) - 60) < (Date.now() / 1000); }
    async function refreshToken() { const rt = localStorage.getItem('kelion_refresh_token'); if (!rt) { clearSession(); return false; } try { const r = await fetch(API+'/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) }); if (!r.ok) { clearSession(); return false; } const d = await r.json(); currentUser = d.user; saveSession(d.session, d.user); return true; } catch(e) { return false; } }

    async function register(email, pw, name) {
        const r = await fetch(API+'/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser = d.user; if (d.session) saveSession(d.session, d.user); return d;
    }

    async function login(email, pw) {
        const r = await fetch(API+'/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser = d.user; saveSession(d.session, d.user); return d;
    }

    async function logout() { try { await fetch(API+'/api/auth/logout', { method: 'POST', headers: getAuthHeaders() }); } catch(e){} clearSession(); }

    async function checkSession() {
        const { token, user } = loadSession(); if (!token) return null;
        if (isTokenExpired()) { const ok = await refreshToken(); if (!ok) return null; }
        try { const r = await fetch(API+'/api/auth/me', { headers: getAuthHeaders() }); if (r.ok) { const d = await r.json(); currentUser = d.user; return d.user; } clearSession(); return null; }
        catch(e) { return user; }
    }

    function updateUI() {
        const n = document.getElementById('user-name'), b = document.getElementById('btn-auth');
        if (currentUser) { if (n) n.textContent = currentUser.name || currentUser.email; if (b) { b.textContent = '🚪'; b.title = 'Deconectare'; } }
        else { if (n) n.textContent = 'Guest'; if (b) { b.textContent = '🔑'; b.title = 'Login'; } }
    }

    function initUI() {
        const scr = document.getElementById('auth-screen'); if (!scr) return;
        const form = scr.querySelector('#auth-form'), tog = scr.querySelector('#auth-toggle'), err = scr.querySelector('#auth-error');
        const sub = scr.querySelector('#auth-submit'), ttl = scr.querySelector('#auth-title'), nmg = scr.querySelector('#auth-name-group');
        const guest = scr.querySelector('#auth-guest');
        let isReg = false;

        if (tog) tog.addEventListener('click', (e) => { e.preventDefault(); isReg = !isReg;
            ttl.textContent = isReg ? 'Creează cont' : 'Autentificare'; sub.textContent = isReg ? 'Înregistrează-te' : 'Intră';
            tog.textContent = isReg ? 'Am cont → Intră' : 'Nu am cont → Creează'; if (nmg) nmg.style.display = isReg ? 'block' : 'none'; if (err) err.textContent = ''; });

        if (form) form.addEventListener('submit', async (e) => { e.preventDefault();
            const em = form.querySelector('#auth-email').value.trim(), pw = form.querySelector('#auth-password').value, nm = form.querySelector('#auth-name')?.value.trim();
            if (!em || !pw) { if (err) err.textContent = 'Completează email și parola'; return; }
            sub.disabled = true; sub.textContent = '...'; if (err) err.textContent = '';
            try { if (isReg) await register(em, pw, nm); else await login(em, pw);
                scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI();
                if (window.KApp) KApp.loadConversations();
            } catch(ex) { if (err) err.textContent = ex.message; }
            finally { sub.disabled = false; sub.textContent = isReg ? 'Înregistrează-te' : 'Intră'; } });

        if (guest) guest.addEventListener('click', () => { scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI(); });

        const ab = document.getElementById('btn-auth');
        if (ab) ab.addEventListener('click', async () => {
            if (currentUser) { await logout(); updateUI(); if (window.KApp) KApp.startNewChat(); scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); }
            else { scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); } });
    }

    async function init() { initUI(); const u = await checkSession();
        if (u) { document.getElementById('auth-screen')?.classList.add('hidden'); document.getElementById('app-layout')?.classList.remove('hidden'); updateUI(); }
        else { document.getElementById('auth-screen')?.classList.add('hidden'); document.getElementById('app-layout')?.classList.remove('hidden'); updateUI(); }
        setInterval(async () => { if (localStorage.getItem('kelion_token') && isTokenExpired()) { const ok = await refreshToken(); if (!ok) { updateUI(); document.getElementById('auth-screen')?.classList.remove('hidden'); document.getElementById('app-layout')?.classList.add('hidden'); } } }, 5 * 60 * 1000); }

    window.KAuth = { init, register, login, logout, checkSession, getAuthHeaders, getUser: () => currentUser, isLoggedIn: () => !!currentUser };
})();
