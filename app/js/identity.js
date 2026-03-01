// KelionAI — Identity Module (Face Capture + Recognition)
// Feature 5: Face capture at registration, passive recognition, greeting by name
(function () {
    'use strict';

    const API_BASE = window.location.origin;
    let passiveCheckInterval = null;
    let isCheckingFace = false;

    // ─── Capture face photo from front camera ────────────────
    async function capturePhoto() {
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.setAttribute('playsinline', '');
            await video.play();
            await new Promise(r => setTimeout(r, 800)); // Wait for camera to warm up

            const canvas = document.createElement('canvas');
            canvas.width = 320; canvas.height = 240;
            canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);

            const photoBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            return photoBase64;
        } catch (e) {
            console.warn('[Identity] Camera access error:', e.message);
            return null;
        } finally {
            if (stream) stream.getTracks().forEach(t => t.stop());
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
                body: JSON.stringify({ face: photo, userId })
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
                body: JSON.stringify({ face: photo })
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
            es: { morning: 'Buenos días', afternoon: 'Buenas tardes', evening: 'Buenas noches', returning: 'Bienvenido de nuevo' },
            it: { morning: 'Buongiorno', afternoon: 'Buon pomeriggio', evening: 'Buona sera', returning: 'Bentornato' },
            pt: { morning: 'Bom dia', afternoon: 'Boa tarde', evening: 'Boa noite', returning: 'Bem-vindo de volta' }
        };
        const g = greetings[lang] || greetings.en;
        let timeGreeting;
        if (hour >= 6 && hour < 12) timeGreeting = g.morning;
        else if (hour >= 12 && hour < 18) timeGreeting = g.afternoon;
        else if (hour >= 18 && hour < 22) timeGreeting = g.evening;
        else timeGreeting = g.returning;
        return `${timeGreeting}, ${name}!`;
    }

    // ─── Passive face check (every ~10 seconds) ───────────────
    async function runPassiveFaceCheck() {
        const result = await checkFace();
        if (!result) return;

        if (result.isOwner) {
            // Only now create and append admin button to DOM
            if (!document.getElementById('btn-admin')) {
                const navArea = document.getElementById('nav-area') || document.querySelector('.ctrl-buttons');
                if (navArea) {
                    const adminBtn = document.createElement('button');
                    adminBtn.id = 'btn-admin';
                    adminBtn.className = 'ctrl-btn-sm';
                    adminBtn.title = 'Admin';
                    adminBtn.textContent = '⚙️';
                    adminBtn.addEventListener('click', function () {
                        window.location.href = '/admin';
                    });
                    navArea.appendChild(adminBtn);
                    console.log('[Identity] Admin button added (owner recognized)');
                }
            }
        } else {
            // Remove admin button if it was somehow added
            const adminBtn = document.getElementById('btn-admin');
            if (adminBtn) adminBtn.remove();
        }

        if (result.user && result.user.name && !window.KAuth?.isLoggedIn()) {
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
        // Then every 10 seconds
        passiveCheckInterval = setInterval(runPassiveFaceCheck, 10000);
        console.log('[Identity] Passive face check started');
    }

    function stopPassiveCheck() {
        if (passiveCheckInterval) { clearInterval(passiveCheckInterval); passiveCheckInterval = null; }
    }

    window.KIdentity = { capturePhoto, registerFace, checkFace, buildGreeting, startPassiveCheck, stopPassiveCheck };
}());
