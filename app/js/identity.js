// App — Identity Module (Face Capture + Recognition)
// Feature 5: Face capture at registration, passive recognition, greeting by name
(function () {
  'use strict';

  const API_BASE = window.location.origin;
  let passiveCheckInterval = null;
  let isCheckingFace = false;

  // ─── Capture face photo from front camera ────────────────
  // Takes multiple captures silently, picks the best quality
  async function capturePhoto() {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
      await new Promise((r) => setTimeout(r, 800));

      // Take 3 captures, pick best quality (highest variance = sharpest)
      let bestPhoto = null;
      let bestScore = 0;
      for (let i = 0; i < 3; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 300));
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx2d = canvas.getContext('2d');
        ctx2d.drawImage(video, 0, 0, 320, 240);
        // Calculate image quality score (pixel variance = sharpness)
        const imgData = ctx2d.getImageData(0, 0, 320, 240).data;
        const count = imgData.length / 4;
        let sum = 0,
          sumSq = 0;
        for (let j = 0; j < imgData.length; j += 4) {
          const v = (imgData[j] + imgData[j + 1] + imgData[j + 2]) / 3;
          sum += v;
          sumSq += v * v;
        }
        const mean = sum / count;
        const variance = sumSq / count - mean * mean;
        const photo = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        if (variance > bestScore) {
          bestScore = variance;
          bestPhoto = photo;
        }
      }
      return bestPhoto;
    } catch (e) {
      console.warn('[Identity] Camera access error:', e.message);
      return null;
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    }
  }

  // ─── Register face at account creation ───────────────────
  async function registerFace(userId) {
    try {
      const photo = await capturePhoto();
      if (!photo) return false;

      const authHeaders = window.KAuth ? KAuth.getAuthHeaders() : {};
      const r = await fetch(API_BASE + '/api/identity/register-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ face: photo, userId }),
      });
      const d = await r.json();
      if (d.success) {
        console.log('[Identity] Face registered successfully');
        return true;
      }
    } catch (e) {
      console.warn('[Identity] Face registration failed:', e.message);
    }
    return false;
  }

  // ─── Check face against registered users ─────────────────
  async function checkFace() {
    if (isCheckingFace) return null;
    isCheckingFace = true;
    try {
      const photo = await capturePhoto();
      if (!photo) return null;

      const authHeaders = window.KAuth ? KAuth.getAuthHeaders() : {};
      const r = await fetch(API_BASE + '/api/identity/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ face: photo }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d;
    } catch (e) {
      console.warn('[Identity] Face check failed:', e.message);
      return null;
    } finally {
      isCheckingFace = false;
    }
  }

  // ─── Build time-appropriate greeting ─────────────────────
  function buildGreeting(name, lang) {
    const hour = new Date().getHours();
    const greetings = {
      en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', returning: 'Welcome back' },
      ro: { morning: 'Bună dimineața', afternoon: 'Bună ziua', evening: 'Bună seara', returning: 'Bine ai revenit' },
      fr: { morning: 'Bonjour', afternoon: 'Bon après-midi', evening: 'Bonsoir', returning: 'Bon retour' },
      de: { morning: 'Guten Morgen', afternoon: 'Guten Tag', evening: 'Guten Abend', returning: 'Willkommen zurück' },
      es: {
        morning: 'Buenos días',
        afternoon: 'Buenas tardes',
        evening: 'Buenas noches',
        returning: 'Bienvenido de nuevo',
      },
      it: { morning: 'Buongiorno', afternoon: 'Buon pomeriggio', evening: 'Buona sera', returning: 'Bentornato' },
      pt: { morning: 'Bom dia', afternoon: 'Boa tarde', evening: 'Boa noite', returning: 'Bem-vindo de volta' },
    };
    const g = greetings[lang] || greetings.en;
    let timeGreeting;
    if (hour >= 6 && hour < 12) timeGreeting = g.morning;
    else if (hour >= 12 && hour < 18) timeGreeting = g.afternoon;
    else if (hour >= 18 && hour < 22) timeGreeting = g.evening;
    else timeGreeting = g.returning;
    return `${timeGreeting}, ${name}!`;
  }

  // ─── Passive face check (runs until owner recognized) ──────
  let _ownerRecognized = false;
  let _greetingDone = false;

  async function runPassiveFaceCheck() {
    // Stop checking once owner is confirmed — no more API calls
    if (_ownerRecognized) return;

    const result = await checkFace();
    if (!result) return;

    if (result.isOwner) {
      _ownerRecognized = true;
      // Auto-store admin token from face recognition (no password needed)
      if (result.adminToken) {
        sessionStorage.setItem('kelion_admin_secret', result.adminToken);
        console.log('[Identity] Admin auto-authenticated via face recognition');
        if (window.KAuth && KAuth.updateAdminButtonState) KAuth.updateAdminButtonState();
      }

      // ═══ FACE AUTO-LOGIN — use session from server ═══
      if (result.session && result.faceLoginUser && window.KAuth) {
        // Show success toast in user's language
        const faceMessages = {
          ro: '✅ Recunoaștere facială reușită!',
          en: '✅ Face recognition successful!',
          es: '✅ ¡Reconocimiento facial exitoso!',
          fr: '✅ Reconnaissance faciale réussie !',
          de: '✅ Gesichtserkennung erfolgreich!',
          it: '✅ Riconoscimento facciale riuscito!',
        };
        const uLang = (result.user && result.user.lang) || (window.i18n ? i18n.getLanguage() : null) || navigator.language.split('-')[0] || null;
        const toast = document.createElement('div');
        toast.textContent = faceMessages[uLang] || faceMessages.en;
        toast.style.cssText =
          'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(16,185,129,0.95);color:#fff;padding:20px 40px;border-radius:16px;font-size:1.3rem;font-weight:600;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:fadeInScale 0.4s ease;';
        // Add animation keyframes
        const style = document.createElement('style');
        style.textContent =
          '@keyframes fadeInScale{from{opacity:0;transform:translate(-50%,-50%) scale(0.8)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}';
        document.head.appendChild(style);
        document.body.appendChild(toast);

        // Auto-login with Supabase session
        KAuth.saveSession(result.session, result.faceLoginUser);
        console.log('[Identity] Face login: auto-logged in as', result.faceLoginUser.name);

        // Fade out toast and enter app after 2s
        setTimeout(function () {
          toast.style.transition = 'opacity 0.5s ease';
          toast.style.opacity = '0';
          setTimeout(function () {
            toast.remove();
            style.remove();
            // Trigger app entry
            window.dispatchEvent(new CustomEvent('face-login-success'));
            if (window.KAuth && KAuth.checkSession) KAuth.checkSession();
          }, 500);
        }, 2000);
      }

      // Stop the interval — no more face checks needed
      stopPassiveCheck();
      console.log('[Identity] Owner recognized — face check stopped');
    }

    // Greeting — fire only once per session
    if (result.user && result.user.name && !_greetingDone && !window.KAuth?.isLoggedIn()) {
      _greetingDone = true;
      const lang = window.i18n ? i18n.getLanguage() : 'en';
      const greeting = buildGreeting(result.user.name, lang);
      console.log('[Identity] Greeting:', greeting);
      window.dispatchEvent(new CustomEvent('identity-recognized', { detail: { user: result.user, greeting } }));
    }
  }

  // ─── Start passive face checking ─────────────────────────
  function startPassiveCheck() {
    if (passiveCheckInterval) return;
    // Initial check after 3 seconds
    setTimeout(runPassiveFaceCheck, 3000);
    // Then every 10 seconds until owner is recognized
    passiveCheckInterval = setInterval(runPassiveFaceCheck, 10000);
    console.log('[Identity] Passive face check started');
  }

  function stopPassiveCheck() {
    if (passiveCheckInterval) {
      clearInterval(passiveCheckInterval);
      passiveCheckInterval = null;
    }
  }

  window.KIdentity = { capturePhoto, registerFace, checkFace, buildGreeting, startPassiveCheck, stopPassiveCheck };
})();
