(function () {
  ('use strict');
  const API = window.location.origin;
  let currentUser = null;
  let _sessionChecked = false; // gate auto-enter until checkSession completes

  function saveSession(s, u) {
    if (s) {
      localStorage.setItem('kelion_token', s.access_token);
      if (s.refresh_token) localStorage.setItem('kelion_refresh_token', s.refresh_token);
      if (s.expires_at) localStorage.setItem('kelion_token_expires', s.expires_at);
    }
    if (u) localStorage.setItem('kelion_user', JSON.stringify(u));
  }
  function loadSession() {
    const t = localStorage.getItem('kelion_token'),
      u = localStorage.getItem('kelion_user');
    if (t && u) {
      try {
        currentUser = JSON.parse(u);
      } catch (_e) {
        /* ignored */
      }
    }
    return { token: t, user: currentUser };
  }
  function clearSession() {
    localStorage.removeItem('kelion_token');
    localStorage.removeItem('kelion_refresh_token');
    localStorage.removeItem('kelion_token_expires');
    localStorage.removeItem('kelion_user');
    currentUser = null;
  }
  function getAuthHeaders() {
    const t = localStorage.getItem('kelion_token');
    return t ? { Authorization: 'Bearer ' + t } : {};
  }
  function isTokenExpired() {
    const exp = localStorage.getItem('kelion_token_expires');
    if (!exp) return false;
    return parseInt(exp) - 60 < Date.now() / 1000;
  }
  async function refreshToken() {
    const rt = localStorage.getItem('kelion_refresh_token');
    if (!rt) {
      clearSession();
      return false;
    }
    try {
      const r = await fetch(API + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!r.ok) {
        clearSession();
        return false;
      }
      const d = await r.json();
      currentUser = d.user;
      saveSession(d.session, d.user);
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function register(email, pw, name) {
    const r = await fetch(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw, name }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }

  async function login(email, pw, _onRetry) {
    const RETRY_DELAYS = [0, 2000, 4000]; // 0ms, 2s, 4s Ã®ntre Ã®ncercÄƒri
    let lastErr = null;
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      if (RETRY_DELAYS[attempt] > 0) {
        if (_onRetry) _onRetry(attempt);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
      try {
        const r = await fetch(API + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pw }),
        });
        const d = await r.json();
        if (!r.ok) {
          // Auth errors (wrong password) -- no retry
          const isAuthError =
            d.error &&
            (d.error.includes('Invalid') ||
              d.error.includes('password') ||
              d.error.includes('verified') ||
              d.error.includes('confirm'));
          if (isAuthError) throw new Error(d.error);
          lastErr = new Error(d.error || 'Server error');
          continue; // retry
        }
        currentUser = d.user;
        saveSession(d.session, d.user);
        return d;
      } catch (e) {
        // Auth errors nu se reÃ®ncearcÄƒ
        if (
          e.message &&
          (e.message.includes('Invalid') || e.message.includes('password') || e.message.includes('verified'))
        )
          throw e;
        lastErr = e;
      }
    }
    throw lastErr || new Error('Login error');
  }

  async function logout() {
    try {
      await fetch(API + '/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch (_e) {
      /* ignored */
    }
    clearSession();
  }

  async function forgotPassword(email) {
    const r = await fetch(API + '/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }

  async function changePassword(password) {
    const r = await fetch(API + '/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }

  async function changeEmail(email) {
    const r = await fetch(API + '/api/auth/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ email }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }

  async function checkSession() {
    const { token, user } = loadSession();
    if (!token) return null;
    if (isTokenExpired()) {
      const ok = await refreshToken();
      if (!ok) return null;
    }
    try {
      const r = await fetch(API + '/api/auth/me', { headers: getAuthHeaders() });
      if (r.ok) {
        const d = await r.json();
        currentUser = d.user;
        return d.user;
      }
      clearSession();
      return null;
    } catch (_e) {
      return user;
    }
  }

  async function updateAdminButtonState() {
    const roleBtn = document.getElementById('btn-role');

    if (!currentUser) {
      // Not logged in — show "Guest (Free)"
      const userDisplay = document.getElementById('user-display');
      if (userDisplay) {
        userDisplay.textContent = 'Guest (Free)';
        userDisplay.style.display = '';
      }
      if (roleBtn) {
        roleBtn.style.background = 'rgba(99,102,241,0.15)';
        roleBtn.style.borderColor = 'rgba(99,102,241,0.4)';
        roleBtn.style.color = '#c7d2fe';
      }
      // Hide navbar buttons when not logged in
      const existingAdmin = document.getElementById('btn-admin-nav');
      if (existingAdmin) existingAdmin.style.display = 'none';

      return;
    }

    // Check admin status via user role
    let isAdmin = currentUser.role === 'admin' || window._isAdmin === true;

    // Update user display: Name (Role)
    const userDisplay = document.getElementById('user-display');
    if (userDisplay && currentUser) {
      const roleName = isAdmin ? 'Admin' : 'User';
      userDisplay.textContent = `${currentUser.name || currentUser.email} (${roleName})`;
      userDisplay.style.display = '';
    }

    if (roleBtn) {
      if (isAdmin) {
        roleBtn.style.background = 'rgba(16,185,129,0.25)';
        roleBtn.style.borderColor = 'rgba(16,185,129,0.5)';
        roleBtn.style.color = '#6ee7b7';
      } else {
        roleBtn.style.background = 'rgba(99,102,241,0.2)';
        roleBtn.style.borderColor = 'rgba(99,102,241,0.5)';
        roleBtn.style.color = '#a5b4fc';
      }
    }

    // Show/hide admin-only features
    const mouthBtn = document.getElementById('btn-mouth-cal');
    if (mouthBtn) mouthBtn.style.display = isAdmin ? '' : 'none';

    const pricingBtn = document.getElementById('btn-pricing');
    if (pricingBtn) pricingBtn.style.display = currentUser ? '' : 'none';
    const adminSep = document.getElementById('admin-tools-sep');
    if (adminSep) adminSep.style.display = isAdmin || currentUser ? '' : 'none';

    // Admin secret is managed via /api/admin/verify (not auto-fetched)

    // Show/hide navbar Admin and Logout buttons based on login state
    const adminNavBtn = document.getElementById('btn-admin-nav');
    if (adminNavBtn) adminNavBtn.style.display = isAdmin ? '' : 'none';

  }

  async function updateUI() {
    const b = document.getElementById('btn-auth');
    // Simplified: updateAdminButtonState now handles user-display text content
    if (currentUser) {
      if (b) {
        b.textContent = 'Logout';
        b.title = 'Logout';
      }
    } else {
      if (b) {
        b.textContent = 'Login';
        b.title = 'Login';
      }
    }
    await updateAdminButtonState();
  }

  function initUI() {
    const scr = document.getElementById('auth-screen');
    if (!scr) return;
    const form = scr.querySelector('#auth-form'),
      tog = scr.querySelector('#auth-toggle'),
      err = scr.querySelector('#auth-error');
    const sub = scr.querySelector('#auth-submit'),
      ttl = scr.querySelector('#auth-title'),
      nmg = scr.querySelector('#auth-name-group');
    const guest = scr.querySelector('#auth-guest');
    const forgotLink = scr.querySelector('#auth-forgot-link');
    const forgotDiv = scr.querySelector('#auth-forgot');
    let isReg = false;

    if (tog)
      tog.addEventListener('click', (e) => {
        e.preventDefault();
        isReg = !isReg;
        ttl.textContent = isReg ? 'Create Account' : 'Sign In';
        sub.textContent = isReg ? 'Register' : 'Sign In';
        tog.textContent = isReg ? 'I have an account -> Sign In' : 'No account -> Create';
        if (nmg) nmg.style.display = isReg ? 'block' : 'none';
        if (forgotDiv) forgotDiv.style.display = isReg ? 'none' : 'block';
        if (err) err.textContent = '';
      });

    if (forgotLink)
      forgotLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const emailEl = form ? form.querySelector('#auth-email') : null;
        const email = emailEl ? emailEl.value.trim() : '';
        if (!email) {
          if (err) err.textContent = 'Please enter your email address first';
          return;
        }
        forgotLink.textContent = '...';
        try {
          await forgotPassword(email);
          if (err) {
            err.style.color = '#00ff88';
            err.textContent = 'Password reset email sent. Please check your inbox.';
          }
        } catch (ex) {
          if (err) {
            err.style.color = '';
            err.textContent = ex.message;
          }
        } finally {
          forgotLink.textContent = 'Forgot password?';
        }
      });

    if (form)
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const em = form.querySelector('#auth-email').value.trim(),
          pw = form.querySelector('#auth-password').value,
          nm = form.querySelector('#auth-name')?.value.trim();
        if (!em || !pw) {
          if (err) err.textContent = 'Please enter email and password';
          return;
        }
        sub.disabled = true;
        sub.textContent = '...';
        if (err) {
          err.textContent = '';
          err.style.color = '';
        }
        try {
          if (isReg) {
            const d = await register(em, pw, nm);
            if (err) {
              err.style.color = '#00ff88';
              err.textContent = d.message || 'Please check your email to verify your account.';
            }
          } else {
            await login(em, pw);
            const storedCode = localStorage.getItem('kelion_referral_code');
            if (storedCode) {
              try {
                const rr = await fetch(API + '/api/referral/redeem', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                  body: JSON.stringify({ code: storedCode }),
                });
                const rd = await rr.json();
                if (rd.success) {
                  localStorage.removeItem('kelion_referral_code');
                } else {
                  if (err) {
                    err.style.color = '#ff4444';
                    err.textContent = 'Referral error: ' + (rd.error || 'Failed to redeem');
                  }
                  localStorage.removeItem('kelion_referral_code');
                }
              } catch (_e) {
                if (err) {
                  err.style.color = '#ff4444';
                  err.textContent = 'Referral error: ' + _e.message;
                }
                localStorage.removeItem('kelion_referral_code');
              }
            }
            scr.classList.add('hidden');
            const appLayout = document.getElementById('app-layout');
            appLayout.classList.remove('hidden');
            appLayout.style.visibility = '';
            appLayout.style.pointerEvents = '';
            // Reset auth form display for future logoutâ†’login cycles
            if (form) form.style.display = 'none';
            const startBtn2 = scr.querySelector('#start-btn');
            if (startBtn2) startBtn2.style.display = '';
            if (window.KAvatar) KAvatar.onResize();
            updateUI();
            if (window.KGuestTimer) KGuestTimer.stop();
            // Push state so Back goes to auth screen (not away from site)
            try {
              history.pushState({ kelionView: 'app' }, '', '/');
            } catch (_e) {
              /* ignored */
            }
          }
        } catch (ex) {
          if (err) {
            err.style.color = '';
            err.textContent = ex.message;
          }
        } finally {
          sub.disabled = false;
          sub.textContent = isReg ? 'Register' : 'Sign In';
        }
      });

    // "Continue without account" button â€” porneÈ™te timer-ul de 10 min/zi
    if (guest)
      guest.addEventListener('click', () => {
        scr.classList.add('hidden');
        document.getElementById('app-layout').classList.remove('hidden');
        updateUI();
        if (window.KGuestTimer) KGuestTimer.start();
      });

    // START button â€” immediate action if clicked
    const startBtn = scr.querySelector('#start-btn');
    function enterApp() {
      try {
        const c = new (window.AudioContext || window.webkitAudioContext)();
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
        c.resume();
      } catch (_e) {
        /* ignored */
      }
      if (window.KVoice) {
        KVoice.ensureAudioUnlocked();
      }
      document.getElementById('auth-screen').classList.add('hidden');
      const appLayout = document.getElementById('app-layout');
      appLayout.classList.remove('hidden');
      appLayout.style.visibility = '';
      appLayout.style.pointerEvents = '';
      if (window.KAvatar) KAvatar.onResize();
      updateUI();
      if (window.KGuestTimer) KGuestTimer.start();
      // Push state so Back button doesn't leave the app
      try {
        history.pushState({ kelionApp: true }, '', '/');
      } catch (_e) {
        /* ignored */
      }
    }
    if (startBtn) {
      startBtn.addEventListener('click', async function () {
        // Try to pre-warm mic/camera but never block entry
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
            stream.getTracks().forEach((t) => t.stop());
          } catch (_e) {
            console.warn('[Auth] Mic/camera pre-warm skipped:', _e.message);
          }
        }
        enterApp();
      });
    }
    // Admin button -- fetch admin secret via JWT, then navigate to admin panel
    const adminBtn = document.getElementById('user-name');
    if (adminBtn)
      adminBtn.addEventListener('click', async function () {
        // Admin auto-unlocked -- fetch secret via JWT before navigating
        if (adminBtn.dataset.locked === 'false') {
          window.location.href = '/admin';
        }
      });
    // Auto-enter when both avatars are 100% loaded (or 10s max)
    // GATE: only auto-enter AFTER checkSession has resolved, to prevent bounce
    window.addEventListener('avatars-ready', function () {
      console.log('[Auth] Avatars ready');
      if (startBtn) {
        const loadIcon = document.getElementById('loading-icon');
        if (loadIcon) loadIcon.style.animation = 'none';
        startBtn.innerHTML = 'START';
      }
      // Only auto-enter if session check is done AND no logged-in user (guest mode)
      // If user is logged in, init() already handled the transition
      if (_sessionChecked && !currentUser && !scr.classList.contains('hidden')) {
        enterApp();
      }
    });
    // Fallback: enter after 10s max even if avatars not loaded
    setTimeout(function () {
      if (_sessionChecked && !currentUser && !scr.classList.contains('hidden')) {
        console.log('[Auth] 10s timeout -- entering app as guest');
        enterApp();
      }
    }, 10000);

    const ab = document.getElementById('btn-auth');
    if (ab)
      ab.addEventListener('click', async () => {
        if (currentUser) {
          await logout();
          updateUI();
          scr.classList.remove('hidden');
          document.getElementById('app-layout').classList.add('hidden');
        } else {
          scr.classList.remove('hidden');
          document.getElementById('app-layout').classList.add('hidden');
          // Show auth form directly, hide START button
          const startBtn2 = scr.querySelector('#start-btn');
          if (startBtn2) startBtn2.style.display = 'none';
          if (form) form.style.display = '';
          if (guest) guest.style.display = '';
        }
      });



    // Navbar Admin button — navigate to admin panel
    const adminNavBtn = document.getElementById('btn-admin-nav');
    if (adminNavBtn)
      adminNavBtn.addEventListener('click', function () {
        window.location.href = '/admin';
      });

    // â”€â”€ Back-button: natural navigation between views â”€â”€
    // App (logat) â†’ Back â†’ Auth screen (fÄƒrÄƒ logout, sesiune rÄƒmÃ¢ne)
    // Auth screen â†’ Back â†’ navigheazÄƒ normal (Google, etc.)
    window.addEventListener('popstate', function (e) {
      const state = e.state || {};
      const appLayout = document.getElementById('app-layout');
      const authScreen = document.getElementById('auth-screen');
      if (state.kelionView === 'app') {
        // Forward to app view
        if (authScreen) authScreen.classList.add('hidden');
        if (appLayout) appLayout.classList.remove('hidden');
      } else {
        // Back from app â†’ show auth screen (but DON'T logout â€” session stays)
        const appVisible = appLayout && !appLayout.classList.contains('hidden');
        if (appVisible) {
          if (appLayout) appLayout.classList.add('hidden');
          if (authScreen) authScreen.classList.remove('hidden');
          // Show START button (not login form) so user can re-enter quickly
          const startBtn3 = document.getElementById('start-btn');
          if (startBtn3) startBtn3.style.display = '';
          const authForm = document.getElementById('auth-form');
          if (authForm) authForm.style.display = 'none';
        }
        // If auth screen is visible and Back is pressed again -> browser navigates away naturally
      }
    });
  }

  async function init() {
    initUI();

    // Admin status is now verified server-side via /api/admin/auth-token
    // No need to fetch admin email from config

    // â”€â”€ Handle Supabase email confirmation callback â”€â”€
    // When user clicks email link, Supabase redirects to: /#access_token=...&refresh_token=...&type=signup
    const hash = window.location.hash;
    if (hash && hash.includes('access_token=')) {
      try {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshTokenVal = hashParams.get('refresh_token');
        const expiresAt = hashParams.get('expires_at');
        const tokenType = hashParams.get('type'); // 'signup', 'recovery', etc.

        if (accessToken) {
          console.log('[Auth] Email callback detected, type:', tokenType);
          // Save tokens to session
          const session = {
            access_token: accessToken,
            refresh_token: refreshTokenVal || '',
            expires_at: expiresAt || '',
          };
          saveSession(session, null);

          // Fetch user info with the new token
          try {
            const r = await fetch(API + '/api/auth/me', {
              headers: { Authorization: 'Bearer ' + accessToken },
            });
            if (r.ok) {
              const d = await r.json();
              currentUser = d.user;
              saveSession(session, d.user);
              console.log('[Auth] Email confirmed, user:', d.user.email);
            }
          } catch (e) {
            console.warn('[Auth] User fetch after callback failed:', e.message);
          }

          // Clean URL hash
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } catch (e) {
        console.warn('[Auth] Hash parse error:', e.message);
      }
    }

    const u = await checkSession();
    _sessionChecked = true; // signal to auto-enter handlers that session is resolved
    if (u) {
      document.getElementById('auth-screen')?.classList.add('hidden');
      document.getElementById('app-layout')?.classList.remove('hidden');
      updateUI();
    } else {
      // Returning visitors (already onboarded): auto-enter immediately as guest
      // New visitors see auth screen (they go through onboarding first anyway)
      try {
        if (localStorage.getItem('kelion_onboarded')) {
          enterApp();
        } else {
          document.getElementById('auth-screen')?.classList.remove('hidden');
          document.getElementById('app-layout')?.classList.add('hidden');
          updateUI();
        }
      } catch (_e) {
        document.getElementById('auth-screen')?.classList.remove('hidden');
        document.getElementById('app-layout')?.classList.add('hidden');
        updateUI();
      }
    }
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('invite');
    if (inviteCode && /^KEL-[0-9a-fA-F]{4}-[0-9a-fA-F]{6}-[A-Z0-9]{10}$/i.test(inviteCode)) {
      localStorage.setItem('kelion_referral_code', inviteCode);
      const authScreen = document.getElementById('auth-screen');
      if (authScreen && !authScreen.classList.contains('hidden')) {
        let badge = document.getElementById('referral-bonus-badge');
        if (!badge) {
          badge = document.createElement('div');
          badge.id = 'referral-bonus-badge';
          badge.style.cssText =
            'background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.3);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:0.85rem;color:#00ff88;text-align:center;';
          badge.textContent = '🎁 Invitation from a friend! +5 bonus days on your first subscription';
          const form = authScreen.querySelector('#auth-form');
          if (form) form.insertBefore(badge, form.firstChild);
        }
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
    setInterval(
      async () => {
        if (localStorage.getItem('kelion_token') && isTokenExpired()) {
          const ok = await refreshToken();
          if (!ok) {
            updateUI();
            document.getElementById('auth-screen')?.classList.remove('hidden');
            document.getElementById('app-layout')?.classList.add('hidden');
          }
        }
      },
      5 * 60 * 1000
    );
  }

  window.KAuth = {
    init,
    register,
    login,
    logout,
    checkSession,
    getAuthHeaders,
    getUser: () => currentUser,
    isLoggedIn: () => !!currentUser,
    isTokenExpired,
    refreshToken,
    isAdmin: () => {
      if (!currentUser) return false;
      return currentUser.role === 'admin' || window._isAdmin === true;
    },
    forgotPassword,
    changePassword,
    changeEmail,
    updateAdminButtonState,
  };
})();

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GUEST TIMER â€” DISABLED (server-side message limits still apply)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
(function () {
  'use strict';
  // Timer removed â€” guests are limited by server-side daily message quotas instead.
  // Stub to prevent errors from existing code that references KGuestTimer.
  function openSubscriptions() {
    const modal = document.getElementById('pricing-modal');
    if (modal) {
      modal.classList.remove('hidden');
      if (window.KPayments) KPayments.renderPricing();
    }
  }
  function initStub() {
    const pricingBtn = document.getElementById('btn-pricing');
    if (pricingBtn) pricingBtn.addEventListener('click', openSubscriptions);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStub);
  else initStub();

  window.KGuestTimer = {
    start: function () {},
    stop: function () {},
    isActive: function () {
      return false;
    },
  };
})();
