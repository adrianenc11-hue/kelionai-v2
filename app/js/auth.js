(function () {
    'use strict';
    const API = window.location.origin;
    let currentUser = null;

    function saveSession(s, u) { if (s) { sessionStorage.setItem('kelion_token', s.access_token); if (s.refresh_token) sessionStorage.setItem('kelion_refresh_token', s.refresh_token); if (s.expires_at) sessionStorage.setItem('kelion_token_expires', s.expires_at); } if (u) sessionStorage.setItem('kelion_user', JSON.stringify(u)); }
    function loadSession() { const t = sessionStorage.getItem('kelion_token'), u = sessionStorage.getItem('kelion_user'); if (t && u) { try { currentUser = JSON.parse(u); } catch(e){} } return { token: t, user: currentUser }; }
    function clearSession() { sessionStorage.removeItem('kelion_token'); sessionStorage.removeItem('kelion_refresh_token'); sessionStorage.removeItem('kelion_token_expires'); sessionStorage.removeItem('kelion_user'); currentUser = null; }
    function getAuthHeaders() { const t = sessionStorage.getItem('kelion_token'); return t ? { 'Authorization': 'Bearer ' + t } : {}; }
    function isTokenExpired() { const exp = sessionStorage.getItem('kelion_token_expires'); if (!exp) return false; return (parseInt(exp) - 60) < (Date.now() / 1000); }
    async function refreshToken() { const rt = sessionStorage.getItem('kelion_refresh_token'); if (!rt) { clearSession(); return false; } try { const r = await fetch(API+'/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) }); if (!r.ok) { clearSession(); return false; } const d = await r.json(); currentUser = d.user; saveSession(d.session, d.user); return true; } catch(e) { return false; } }

    async function register(email, pw, name) {
        const r = await fetch(API+'/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error);
        // Registration no longer returns a session — user must verify email first
        return d;
    }

    async function login(email, pw) {
        const r = await fetch(API+'/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); currentUser = d.user; saveSession(d.session, d.user); return d;
    }

    async function logout() { try { await fetch(API+'/api/auth/logout', { method: 'POST', headers: getAuthHeaders() }); } catch(e){} clearSession(); }

    async function forgotPassword(email) {
        const r = await fetch(API+'/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
    }

    async function changePassword(password) {
        const r = await fetch(API+'/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ password }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
    }

    async function changeEmail(email) {
        const r = await fetch(API+'/api/auth/change-email', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ email }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error); return d;
    }

    async function checkSession() {
        const { token, user } = loadSession(); if (!token) return null;
        if (isTokenExpired()) { const ok = await refreshToken(); if (!ok) return null; }
        try { const r = await fetch(API+'/api/auth/me', { headers: getAuthHeaders() }); if (r.ok) { const d = await r.json(); currentUser = d.user; return d.user; } clearSession(); return null; }
        catch(e) { return user; }
    }

    function updateUI() {
        const n = document.getElementById('user-name'), b = document.getElementById('btn-auth');
        if (currentUser) { if (n) n.textContent = currentUser.name || currentUser.email; if (b) { b.textContent = '👋'; b.title = 'Logoff'; } }
        else { if (n) n.textContent = 'Guest'; if (b) { b.textContent = '🔑'; b.title = 'Login'; } }
    }

    function initUI() {
        const scr = document.getElementById('auth-screen'); if (!scr) return;
        const form = scr.querySelector('#auth-form'), tog = scr.querySelector('#auth-toggle'), err = scr.querySelector('#auth-error');
        const sub = scr.querySelector('#auth-submit'), ttl = scr.querySelector('#auth-title'), nmg = scr.querySelector('#auth-name-group');
        const guest = scr.querySelector('#auth-guest');
        const forgotLink = scr.querySelector('#auth-forgot-link');
        const forgotDiv = scr.querySelector('#auth-forgot');
        let isReg = false;

        if (tog) tog.addEventListener('click', (e) => { e.preventDefault(); isReg = !isReg;
            ttl.textContent = isReg ? 'Create Account' : 'Sign In'; sub.textContent = isReg ? 'Register' : 'Sign In';
            tog.textContent = isReg ? 'I have an account → Sign In' : 'No account → Create';
            if (nmg) nmg.style.display = isReg ? 'block' : 'none';
            if (forgotDiv) forgotDiv.style.display = isReg ? 'none' : 'block';
            if (err) err.textContent = ''; });

        if (forgotLink) forgotLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const emailEl = form ? form.querySelector('#auth-email') : null;
            const email = emailEl ? emailEl.value.trim() : '';
            if (!email) { if (err) err.textContent = 'Please enter your email address first'; return; }
            forgotLink.textContent = '...';
            try {
                await forgotPassword(email);
                if (err) { err.style.color = '#00ff88'; err.textContent = 'Password reset email sent. Please check your inbox.'; }
            } catch(ex) {
                if (err) { err.style.color = ''; err.textContent = ex.message; }
            } finally { forgotLink.textContent = 'Forgot password?'; }
        });

        if (form) form.addEventListener('submit', async (e) => { e.preventDefault();
            const em = form.querySelector('#auth-email').value.trim(), pw = form.querySelector('#auth-password').value, nm = form.querySelector('#auth-name')?.value.trim();
            if (!em || !pw) { if (err) err.textContent = 'Please enter email and password'; return; }
            sub.disabled = true; sub.textContent = '...'; if (err) { err.textContent = ''; err.style.color = ''; }
            try {
                if (isReg) {
                    const d = await register(em, pw, nm);
                    if (err) { err.style.color = '#00ff88'; err.textContent = d.message || 'Please check your email to verify your account.'; }
                    // Store referral code for redemption after email verification & login
                    // (actual redemption happens at login time — see redeemStoredReferralCode)
                } else {
                    await login(em, pw);
                    // Redeem stored referral code if any
                    const storedCode = localStorage.getItem('kelion_referral_code');
                    if (storedCode) {
                        try {
                            const rr = await fetch(API + '/api/referral/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ code: storedCode }) });
                            const rd = await rr.json();
                            if (rd.success) localStorage.removeItem('kelion_referral_code');
                        } catch(_e) {}
                    }
                    scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI();
                    if (window.KApp) KApp.loadConversations();
                }
            } catch(ex) { if (err) { err.style.color = ''; err.textContent = ex.message; } }
            finally { sub.disabled = false; sub.textContent = isReg ? 'Register' : 'Sign In'; } });

        if (guest) guest.addEventListener('click', () => { scr.classList.add('hidden'); document.getElementById('app-layout').classList.remove('hidden'); updateUI(); });

        const ab = document.getElementById('btn-auth');
        if (ab) ab.addEventListener('click', async () => {
            if (currentUser) { await logout(); updateUI(); if (window.KApp) KApp.startNewChat(); scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); }
            else { scr.classList.remove('hidden'); document.getElementById('app-layout').classList.add('hidden'); } });
    }

    async function init() { initUI(); const u = await checkSession();
        if (u) { document.getElementById('auth-screen')?.classList.add('hidden'); document.getElementById('app-layout')?.classList.remove('hidden'); updateUI(); }
        else { document.getElementById('auth-screen')?.classList.remove('hidden'); document.getElementById('app-layout')?.classList.add('hidden'); updateUI(); }
        // Detect ?invite= URL param and store referral code
        const params = new URLSearchParams(window.location.search);
        const inviteCode = params.get('invite');
        if (inviteCode && /^KEL-[0-9a-fA-F]{4}-[0-9a-fA-F]{6}-[A-Z0-9]{10}$/i.test(inviteCode)) {
            localStorage.setItem('kelion_referral_code', inviteCode);
            // Show bonus badge if register form is visible
            const authScreen = document.getElementById('auth-screen');
            if (authScreen && !authScreen.classList.contains('hidden')) {
                let badge = document.getElementById('referral-bonus-badge');
                if (!badge) {
                    badge = document.createElement('div');
                    badge.id = 'referral-bonus-badge';
                    badge.style.cssText = 'background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.3);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:0.85rem;color:#00ff88;text-align:center;';
                    badge.textContent = '🎁 Invitație de la un prieten! +5 zile bonus la prima subscripție';
                    const form = authScreen.querySelector('#auth-form');
                    if (form) form.insertBefore(badge, form.firstChild);
                }
            }
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
        }
        setInterval(async () => { if (sessionStorage.getItem('kelion_token') && isTokenExpired()) { const ok = await refreshToken(); if (!ok) { updateUI(); document.getElementById('auth-screen')?.classList.remove('hidden'); document.getElementById('app-layout')?.classList.add('hidden'); } } }, 5 * 60 * 1000); }

    window.KAuth = { init, register, login, logout, checkSession, getAuthHeaders, getUser: () => currentUser, isLoggedIn: () => !!currentUser, forgotPassword, changePassword, changeEmail };
})();
