# Schema Logică Integrală — KelionAI (Post-Audit)

## Arhitectura Completă

```mermaid
graph TB
    subgraph Frontend["🖥️ FRONTEND"]
        direction TB
        HTML["index.html<br>Splash + Chat + Monitor"]

        subgraph JS_Core["Core JS"]
            APP["app.js (40KB)<br>Chat, Send, Init, Mic, Plus"]
            AUTH_F["auth.js (14KB)<br>Login, Register, enterApp"]
            AVATAR["avatar.js (21KB)<br>3D Avatars, Mouth, Expressions"]
            VOICE["voice.js (19KB)<br>TTS, STT, Wake Word, AudioCtx"]
        end

        subgraph JS_Features["Feature JS"]
            MONITOR["monitor.js — Display Panel"]
            TOOLS["tools.js — Weather/Search/Maps"]
            I18N["i18n.js — 18 Languages"]
            PAYMENTS_UI["payments-ui.js — Pricing"]
            LIPSYNC["fft-lipsync.js — FFT Mouth Sync"]
            TICKER["ticker.js — News Ticker"]
            NAVBAR["navbar.js — Navigation"]
            IDENTITY_F["identity.js — User Profile"]
            VISION_F["realtime-vision.js — Camera"]
            GEO["geolocation.js — GPS"]
            ONBOARD["onboarding.js — Tutorial"]
        end
    end

    subgraph Server["⚙️ BACKEND"]
        INDEX["index.js (34KB)<br>Express, Middleware, Routes"]
        BRAIN["brain.js (50KB)<br>AI Engine → OpenAI/Groq"]
        PERSONA["persona.js (20KB)<br>Kelion & Kira personalities"]

        subgraph API["API Routes (mount path → handler)"]
            R_CHAT["/api/chat → chat.js"]
            R_SPEAK["/api/speak → voice.js"]
            R_VISION["/api/vision → vision.js"]
            R_SEARCH["/api/search → search.js"]
            R_WEATHER["/api/weather → weather.js"]
            R_IMAGES["/api/imagine → images.js"]
            R_AUTH["/api/auth/* → auth.js"]
            R_HEALTH["/api/health → health.js"]
            R_IDENTITY["/api/identity → identity.js"]
            R_ADMIN["/api/admin/* → admin.js"]
            R_DEV["/api/developer/* → developer.js"]
        end

        subgraph Bots["Bot Integrations"]
            TELEGRAM["telegram.js (23KB)"]
            WHATSAPP["whatsapp.js (32KB)"]
            MESSENGER["messenger.js (47KB)"]
            INSTAGRAM["instagram.js (4.8KB)"]
            FB_PAGE["facebook-page.js (3.5KB)"]
        end

        subgraph Business["Business Logic"]
            PAYMENTS_S["payments.js (21KB) → Stripe"]
            TRADING["trading.js (55KB)"]
            TRADE_EXEC["trade-executor.js (45KB)"]
            TRADE_INTEL["trade-intelligence.js (30KB)"]
            NEWS["news.js (21KB) → RSS"]
            REFERRAL["referral.js (30KB)"]
            LEGAL["legal.js (11KB)"]
        end

        SUPABASE["supabase.js → PostgreSQL"]
        CACHE["cache.js → In-Memory"]
    end

    APP -->|"POST /api/chat"| R_CHAT
    VOICE -->|"POST /api/speak"| R_SPEAK
    VOICE -->|"POST /api/vision"| R_VISION
    APP -->|"via tools.js"| R_SEARCH
    APP -->|"via tools.js"| R_WEATHER
    AUTH_F -->|"POST /api/auth/*"| R_AUTH
    R_CHAT --> BRAIN
```

---

## Flux Utilizator — CORECT (post-audit)

```mermaid
graph TD
    START["🌐 User deschide kelionai.app"] --> SPLASH["Splash Screen<br>⏳ Se încarcă..."]

    SPLASH --> BG["Background: avatari se încarcă<br>Kelion first, Kira preload"]
    BG --> READY{"avatars-ready<br>event?"}
    READY -->|Da| CHANGE["Buton: ▶ START"]
    READY -->|10s timeout| CHANGE
    CHANGE --> CLICK["User click ▶ START"]
    SPLASH -->|"Direct click"| CLICK

    CLICK --> ENTER["enterApp()<br>AudioCtx unlock<br>Show chat interface"]

    ENTER --> CHAT["Chat Interface<br>🎙️ [text input] +"]

    CHAT --> T["User tastează + Enter"]
    CHAT --> MIC["User click 🎙️"]
    CHAT --> PLUS["User click +"]

    T --> CHECK_WEB{"tryWebCommand?"}
    CHECK_WEB -->|"deschide youtube"| OPEN["window.open(url)<br>confirm in chat"]
    CHECK_WEB -->|Nu| CHECK_VISION{"isVisionRequest?"}
    CHECK_VISION -->|"ce vezi"| CAM["Camera → /api/vision"]
    CHECK_VISION -->|Nu| SEND["sendToAI_Regular()"]

    MIC --> PERM["getUserMedia()"]
    PERM --> SR["SpeechRecognition ro-RO<br>continuous, no wake word"]
    SR --> HEARD["text recunoscut"]
    HEARD --> SEND

    SEND --> FETCH["fetch /api/chat"]
    FETCH --> AI_RESP["AI reply JSON"]
    AI_RESP --> TEXT_SHOW["addMessage() INSTANT"]
    AI_RESP --> TTS["fetch /api/speak"]
    TTS --> AUDIO["AudioContext.play()"]
    AUDIO --> LIP["lipSync.update()<br>mouth moves"]
    AUDIO --> END_AUDIO["audio.onended"]
    END_AUDIO --> CLOSE["isSpeaking=false<br>mouth CLOSED<br>ALL morphs=0"]

    PLUS --> POPUP["Popup:<br>📂 Adaugă fișier<br>💾 Salvează tot"]
    POPUP --> IMPORT["file input → handleFiles()"]
    POPUP --> EXPORT["MonitorManager.downloadAsZip()"]
```

---

## Erori de Logică Confirmate

### ❌ ERR-1: Două SpeechRecognition CONCURENTE

|             |                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **Fișiere** | `app.js:625` + `app.js:511-539`                                                                                  |
| **Cauză**   | L625: `KVoice.startWakeWordDetection()` pornește SR#1. Mic toggle L511: pornește SR#2. Browser permite doar UNA. |
| **Efect**   | Mic nu aude vocea / nu se face verde                                                                             |
| **Fix**     | Stop wake word când mic ON. Restart când mic OFF.                                                                |

### ❌ ERR-2: Wake Word fără permisiune

|            |                                                                       |
| ---------- | --------------------------------------------------------------------- |
| **Fișier** | `app.js:625`                                                          |
| **Cauză**  | `startWakeWordDetection()` rulează la init(), ÎNAINTE de getUserMedia |
| **Efect**  | SpeechRecognition fail silențios ("not-allowed")                      |
| **Fix**    | NU porni wake word la init. Doar după click 🎙️.                       |

### ❌ ERR-3: Triple startWakeWordDetection

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| **Fișiere** | `app.js:625` + `auth.js:130` + potențial mic toggle    |
| **Cauză**   | Se apelează din 3 locuri diferite                      |
| **Efect**   | Multiple instanțe SpeechRecognition                    |
| **Fix**     | Singura sursă: butonul 🎙️. Scos din init() și auth.js. |

### ❌ ERR-4: Plus popup ASCUNS

|            |                                                                  |
| ---------- | ---------------------------------------------------------------- |
| **Fișier** | `app.js:588`                                                     |
| **Cauză**  | `top:36px` poziționează popup SUB buton = sub marginea ecranului |
| **Efect**  | Popup invizibil sau parțial vizibil                              |
| **Fix**    | `bottom:44px` (deasupra butonului)                               |

### ❌ ERR-5: unlockAudio duplicat spam

|            |                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Fișier** | `app.js:488` + `app.js:627`                                                                                                               |
| **Cauză**  | L488: listener PERMANENT pe click (once:false). L627: alt listener cu once:true. Plus unlockAudio() creează AudioContext la fiecare apel. |
| **Efect**  | AudioContext spam, memory leak                                                                                                            |
| **Fix**    | Scoate L627. Fix L488 cu `{ once: true }`.                                                                                                |

### ❌ ERR-6: START buton text static

|            |                                                                          |
| ---------- | ------------------------------------------------------------------------ |
| **Fișier** | `index.html:288`                                                         |
| **Cauză**  | "⏳ Loading..." — user crede trebuie să aștepte, dar butonul E clickable |
| **Efect**  | UX confuz                                                                |
| **Fix**    | Initial "⏳ Se încarcă...", la avatars-ready → "▶ START"                 |

### ❌ ERR-7: isSpeaking state leak

|            |                                                                           |
| ---------- | ------------------------------------------------------------------------- |
| **Fișier** | `voice.js:119, 196`                                                       |
| **Cauză**  | Dacă audio decode fail dar isSpeaking=true deja setat, poate rămâne stuck |
| **Efect**  | Gura nu se mai închide, wake word blocat                                  |
| **Fix**    | Try/catch mai agresiv, always false la orice eroare                       |

### ❌ ERR-8: handleFiles closure bug

|            |                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------- |
| **Fișier** | `app.js:419-441`                                                                          |
| **Cauză**  | `var file = fileList[i]` + `reader.onload = async function()` — `file` se schimbă în loop |
| **Efect**  | Ultimul fișier procesat pt toate                                                          |
| **Fix**    | `let` sau IIFE wrapper                                                                    |

### ❌ ERR-9: sendToAI_Regular nu face showThinking

|            |                                                            |
| ---------- | ---------------------------------------------------------- |
| **Fișier** | `app.js:188`                                               |
| **Cauză**  | Funcția nu apelează showThinking(true) — depinde de caller |
| **Efect**  | Minor (callers fac). Risk: future callers fără.            |
| **Fix**    | Adaugă showThinking(true) la început                       |

### ❌ ERR-10: SpeechRecognition lang hardcoded

|            |                                        |
| ---------- | -------------------------------------- |
| **Fișier** | `app.js:516`                           |
| **Cauză**  | `lang = 'ro-RO'` hardcoded             |
| **Efect**  | Utilizatori en/de/fr nu sunt înțeleși  |
| **Fix**    | Detect din i18n sau navigator.language |

---

## Plan de Rewrite — Fix-uri Exacte

### 1. `index.html`

```diff
-<button id="start-btn">⏳ Loading...</button>
+<button id="start-btn">⏳ Se încarcă...</button>
```

### 2. `auth.js`

```diff
 // enterApp function
-if (window.KVoice) { KVoice.ensureAudioUnlocked(); KVoice.startWakeWordDetection(); }
+if (window.KVoice) { KVoice.ensureAudioUnlocked(); }

 // avatars-ready event
+var startBtn = document.getElementById('start-btn');
+if (startBtn) startBtn.innerHTML = '▶ START';
```

### 3. `app.js` — init()

```diff
 // Remove auto wake word
-if (window.KVoice) KVoice.startWakeWordDetection();
-document.addEventListener('click', function unlockAudio() { ... }, { once: true });

 // Fix unlockAudio listeners
-['click', 'touchstart', 'keydown'].forEach(function(e) {
-  document.addEventListener(e, unlockAudio, { once: false, passive: true });
-});
+['click', 'touchstart', 'keydown'].forEach(function(e) {
+  document.addEventListener(e, unlockAudio, { once: true, passive: true });
+});
```

### 4. `app.js` — mic toggle

```diff
 // Stop wake word before starting direct speech
+if (window.KVoice && KVoice.stopWakeWordDetection) KVoice.stopWakeWordDetection();
 window._directSpeech = new SR();
-window._directSpeech.lang = 'ro-RO';
+window._directSpeech.lang = (window.i18n && i18n.getLanguage()) || navigator.language || 'ro-RO';

 // On mic OFF, restart wake word
 micOn = false;
 if (window._directSpeech) { ... }
```

### 5. `app.js` — plus popup

```diff
-popup.style.cssText = '...top:36px;right:8px...';
+popup.style.cssText = '...bottom:44px;right:0...';
```

### 6. `app.js` — handleFiles

```diff
-for (var i = 0; i < fileList.length; i++) {
-    var file = fileList[i];
+for (let i = 0; i < fileList.length; i++) {
+    let file = fileList[i];
```

### 7. `avatar.js` — mouth force-close (optimize)

```diff
 // Cache mouth morph indices at load time, not per frame
+var _mouthMorphCache = [];
+function cacheMouthMorphs() {
+    _mouthMorphCache = [];
+    morphMeshes.forEach(function(m) {
+        if (!m.morphTargetDictionary || !m.morphTargetInfluences) return;
+        Object.keys(m.morphTargetDictionary).forEach(function(k) {
+            var kl = k.toLowerCase();
+            if (kl.indexOf('mouth')>=0 || kl.indexOf('jaw')>=0 ||
+                kl.indexOf('viseme')>=0 || kl.indexOf('lip')>=0 || kl==='smile') {
+                _mouthMorphCache.push({ mesh: m, idx: m.morphTargetDictionary[k] });
+            }
+        });
+    });
+}

 // In animate():
-morphMeshes.forEach(function(m) { ... });  // 250 string compares/frame
+_mouthMorphCache.forEach(function(c) { c.mesh.morphTargetInfluences[c.idx] = 0; });
```
