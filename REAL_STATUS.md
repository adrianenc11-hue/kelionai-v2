# KelionAI v2 — REAL STATUS
## Data: 2026-02-24 13:26
## Proiect: kelionai-v2 (Railway)
## URL: https://kelionai-v2-production.up.railway.app/
## Repo: github.com/adrianenc11-hue/kelionai-v2
## Local: C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2

---

## ✅ CE MERGE (CONFIRMAT CU SCREENSHOT-URI)

| # | Funcție | Detalii |
|---|--------|---------|
| 1 | **Chat text Kelion** | Scris mesaj + Enter → răspuns corect de la Claude |
| 2 | **Chat text Kira** | Răspunde corect "Sunt Kira" — folosește prompt Kira |
| 3 | **Avatar Kelion** | Se încarcă, se afișează corect, blink funcționează |
| 4 | **Avatar Kira** | Se încarcă, sprâncene+pleoape REPARATE (mirror fix) |
| 5 | **Switch avatar** | Click Kelion/Kira schimbă avatarul + butonul activ |
| 6 | **Backend TTS** | /api/speak returnează 200 + audio/mpeg (10KB) |
| 7 | **Backend Chat** | /api/chat funcționează pentru ambii avatari |
| 8 | **Backend Vision** | /api/vision returnează 200 |
| 9 | **Backend Health** | Toate serviciile: AI, TTS, STT, Vision, Search, Weather, Memory = OK |
| 10 | **System prompts** | Kelion și Kira au prompt-uri separate cu capacitățile aplicației |
| 11 | **Vision cameră** | Cod existent: captureAndAnalyze() ia frame din camera FRONTALĂ, trimite la Claude Vision |
| 12 | **Buton fișiere** | Ascuns (display:none) conform cerință |

---

## ❌ CE NU MERGE (CONFIRMAT)

| # | Bug | Cauză identificată | Prioritate |
|---|-----|-------------------|-----------|
| 1 | **AUDIO NU SE AUDE** | Backend-ul trimite audio OK (200, 10KB). Frontend-ul creează Audio() și apelează .play(). Probabil: (a) browser autoplay policy blochează fără user gesture, sau (b) eroare JS silențioasă în speak(). TREBUIE DEBUGAT CU CONSOLE LIVE. | 🔴 CRITIC |
| 2 | **LIP SYNC NU FUNCȚIONEAZĂ** | createMediaElementSource eliminat (crăpa audio). Text-based lip sync e activ dar gura NU mișcă vizibil. Posibil: morphMeshes nu conțin morph target 'Smile' sau 'jawOpen' în modelul GLB. | 🔴 CRITIC |
| 3 | **MONITOR INACTIV** | Afișează doar placeholder "Monitor de prezentare". NU există cod care să afișeze hărți/imagini/rute pe monitor. Claude știe din prompt că poate, dar nu are cod să execute. | 🟡 MEDIU |
| 4 | **MEMORIE** | Chat history se trimite în request (ultimele 20 mesaje) dar SE PIERDE la refresh. Nu există persistență server-side. Endpoint /api/memory există dar nu e integrat în chat flow. | 🟡 MEDIU |
| 5 | **KIRA MOȘTENEȘTE MESAJE KELION** | Când switch de la Kelion la Kira, mesajele vechi rămân în chat overlay. Kira pare că a zis "Sunt Kelion" dar e de fapt mesajul vechi. Chat-ul ar trebui curățat la switch sau mesajele marcate per avatar. | 🟡 MEDIU |
| 6 | **VOCE KIRA** | Backend trimite audio cu voce Kira (ElevenLabs voice ID diferit) DAR audio-ul nu se aude (bug #1). | 🔴 CRITIC (depinde de #1) |
| 7 | **WAKE WORD** | KVoice.startWakeWordDetection() se apelează la init dar necesită microfon + browser permissions. Nu verificat. | 🟡 MEDIU |
| 8 | **CĂUTARE WEB** | Endpoint /api/search există, Claude știe din prompt, dar NU există cod frontend care să apeleze automat /api/search când AI-ul cere. AI-ul doar SPUNE că poate căuta, dar nu face efectiv. | 🟡 MEDIU |
| 9 | **METEO** | Endpoint /api/weather există dar nu e conectat la frontend. | 🟡 MEDIU |
| 10 | **GENERARE IMAGINI** | Endpoint /api/generate-image există dar nu e conectat la monitor. | 🟡 MEDIU |

---

## 🔧 FIX-URI APLICATE ÎN ACEASTĂ SESIUNE

| # | Fix | Commit |
|---|-----|--------|
| 1 | btn-keyboard null crash → null-safe check | 6bdcfc3 |
| 2 | Camera frontală (user) + calitate 95% | d33cc9d |
| 3 | Vision prompt detaliat (culori, gesturi) | d33cc9d |
| 4 | Wake word cu virgulă (Kelion, + Kira,) | d33cc9d |
| 5 | System prompt cu capabilități | 671a39f |
| 6 | Lip sync Romanian phoneme mapping | 806173e |
| 7 | Lip sync gura închisă la pauze | 3cd857b |
| 8 | Expresia happy NU mai suprascrie Smile morph | 8d502cd |
| 9 | Kira face: renderOrder + mirror fix Z-fighting | dd15d4b |
| 10 | Buton fișiere ascuns | dd15d4b |
| 11 | Audio: eliminat createMediaElementSource | ad73f30 |

---

## 📁 FIȘIERE CHEIE

| Fișier | Rol |
|--------|-----|
| `app/index.html` | Pagina principală |
| `app/js/app.js` | Logica principală (init, chat, switchAvatar, onSendText) |
| `app/js/avatar.js` | Three.js avatar (loadAvatar, morph, lip sync init, Kira mirror fix) |
| `app/js/voice.js` | TTS (speak), STT (startListening), wake word, captureAndAnalyze(vision) |
| `app/js/fft-lipsync.js` | SimpleLipSync (FFT) + TextLipSync (phoneme) |
| `app/js/realtime-vision.js` | TensorFlow.js real-time object detection |
| `app/css/app.css` | Stiluri aplicație |
| `server/index.js` | Express server: /api/chat, /api/speak, /api/vision, /api/search, /api/weather |

---

## 🎯 PRIORITATE REPARAȚII (ORDINE)

1. **🔴 AUDIO** — Most critical. Debug frontend speak() în browser console. Verifică dacă currentAudio.play() returnează eroare.
2. **🔴 LIP SYNC** — După audio merge, verifică dacă textLipSync primește morphMeshes corect.
3. **🟡 MONITOR** — Implementare reală: când AI-ul vrea să arate ceva, trimite comanda spre monitor (iframe/img/map).
4. **🟡 MEMORIE** — Integrare /api/memory în chat flow pentru persistență.
5. **🟡 SEARCH/WEATHER/IMAGES** — Conectare frontend la API-uri existente.

---

## ⚙️ API KEYS CONFIGURATE (Railway)

- ANTHROPIC_API_KEY ✅
- ELEVENLABS_API_KEY ✅ 
- DEEPSEEK_API_KEY ✅
- TOGETHER_API_KEY ✅ (imagini)
- OPENWEATHER_API_KEY ✅
- HF_TOKEN ✅

## ⚙️ VOICE IDs (ElevenLabs)

- Kelion: configurat în server/index.js
- Kira: configurat în server/index.js (voice ID diferit, feminin)
