// ═══════════════════════════════════════════════════════════════
// KelionAI — Referral UI (invite button + modal logic)
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const btnInvite = document.getElementById('btn-invite');
  const modal = document.getElementById('referral-modal');
  const closeBtn = document.getElementById('referral-close');
  const codeDisplay = document.getElementById('referral-code-display');
  const btnGenerate = document.getElementById('btn-generate-code');
  const btnCopy = document.getElementById('btn-copy-code');
  const emailInput = document.getElementById('referral-email');
  const btnSend = document.getElementById('btn-send-invite');
  const statusEl = document.getElementById('referral-status');
  const expiryEl = document.getElementById('referral-expiry');
  const remainingEl = document.getElementById('referral-remaining');

  let currentCode = null;

  // ─── Show/Hide invite button based on auth state ───
  function updateInviteVisibility() {
    const token =
      localStorage.getItem('kelion_token') ||
      (window.KelionAuth && window.KelionAuth.getToken && window.KelionAuth.getToken());
    if (btnInvite) {
      btnInvite.style.display = token ? '' : 'none';
    }
  }

  // Check on load and periodically
  updateInviteVisibility();
  setInterval(updateInviteVisibility, 2000);

  // Listen for auth events
  window.addEventListener('kelion:auth:login', updateInviteVisibility);
  window.addEventListener('kelion:auth:logout', function () {
    if (btnInvite) btnInvite.style.display = 'none';
  });

  // ─── Open/Close Modal ───
  if (btnInvite) {
    btnInvite.addEventListener('click', function () {
      if (modal) modal.classList.remove('hidden');
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      if (modal) modal.classList.add('hidden');
    });
  }
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  // ─── Helper: get auth token ───
  function getToken() {
    return (
      localStorage.getItem('kelion_token') ||
      (window.KelionAuth && window.KelionAuth.getToken && window.KelionAuth.getToken()) ||
      ''
    );
  }

  // ─── Generate Referral Code ───
  if (btnGenerate) {
    btnGenerate.addEventListener('click', async function () {
      const token = getToken();
      if (!token) {
        showStatus('⚠️ You must be logged in', '#f87171');
        return;
      }
      btnGenerate.disabled = true;
      btnGenerate.textContent = '⏳ Generating...';

      try {
        const resp = await fetch('/api/referral/generate', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
        const data = await resp.json();

        if (resp.ok && data.code) {
          currentCode = data.code;
          codeDisplay.value = data.code;
          codeDisplay.style.borderColor = 'rgba(16,185,129,0.5)';

          if (data.expiresAt) {
            const date = new Date(data.expiresAt);
            expiryEl.textContent = '⏰ Expires: ' + date.toLocaleDateString('en-US');
          }
          if (data.codesRemainingThisMonth !== undefined) {
            remainingEl.textContent = '📊 Invites remaining this month: ' + data.codesRemainingThisMonth;
          }
          showStatus('✅ Code generated successfully!', '#10B981');
        } else {
          showStatus('❌ ' + (data.error || 'Generation error'), '#f87171');
        }
      } catch (err) {
        showStatus('❌ Network error: ' + err.message, '#f87171');
      }

      btnGenerate.disabled = false;
      btnGenerate.textContent = '✨ Generate invite code';
    });
  }

  // ─── Copy Code ───
  if (btnCopy) {
    btnCopy.addEventListener('click', function () {
      if (currentCode) {
        navigator.clipboard
          .writeText(currentCode)
          .then(function () {
            btnCopy.textContent = '✅';
            setTimeout(function () {
              btnCopy.textContent = '📋';
            }, 2000);
          })
          .catch(function () {
            codeDisplay.select();
            document.execCommand('copy');
            btnCopy.textContent = '✅';
            setTimeout(function () {
              btnCopy.textContent = '📋';
            }, 2000);
          });
      }
    });
  }

  // ─── Send Invite Email ───
  if (btnSend) {
    btnSend.addEventListener('click', async function () {
      const email = emailInput.value.trim();
      if (!email) {
        showStatus('⚠️ Enter an email address', '#f87171');
        return;
      }
      if (!currentCode) {
        showStatus('⚠️ Generate a code first', '#f87171');
        return;
      }
      const token = getToken();
      if (!token) {
        showStatus('⚠️ You must be logged in', '#f87171');
        return;
      }

      btnSend.disabled = true;
      btnSend.textContent = '⏳ Sending...';

      try {
        const resp = await fetch('/api/referral/send-invite', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, code: currentCode }),
        });
        const data = await resp.json();

        if (resp.ok && data.success) {
          showStatus('✅ Invite sent to ' + email + '!', '#10B981');
          emailInput.value = '';
        } else {
          showStatus('❌ ' + (data.error || 'Send error'), '#f87171');
        }
      } catch (err) {
        showStatus('❌ Error: ' + err.message, '#f87171');
      }

      btnSend.disabled = false;
      btnSend.textContent = '📧 Send';
    });
  }

  function showStatus(msg, color) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = color || '#8888AA';
    }
  }
})();
