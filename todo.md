# TODO COMPLET VALID — KelionAI v2.5

> Ultima actualizare: 10 Mar 2026 22:07 — Auditat + implementat

---

## ✅ GATA (35 itemi — confirmate în cod)

- [x] Text dublu chat — fixat
- [x] Vizite = 0 admin — page_views + bot filter
- [x] Credit AI incorect — fixat
- [x] Admin login cod vizibil — fixat
- [x] Kelion anunță "admin" — doar lacăt
- [x] Audio nu se aude — AudioContext fix
- [x] GPS nu funcționează — fixat
- [x] WhatsApp send rută — rută prezentă
- [x] Media publish rută — rută prezentă
- [x] Vision — GPT-5.4 + Gemini fallback (169 linii)
- [x] Learning — LearningStore + CircuitBreaker (417 linii)
- [x] Identity — register-face + OpenAI Vision compare (240 linii)
- [x] CSP — Helmet nonce + connect-src complet (index.js L95-157)
- [x] ${destination} fix — doar în node_modules
- [x] Coduri admin — generateCode/deleteCode
- [x] Invitații admin — referral-ui.js
- [x] Buton invitație navbar — referral-ui.js
- [x] Generator cod referral — existent
- [x] Istoric download — Export chat button
- [x] Localizare — i18n.js 660 linii, 6 limbi
- [x] Voice Streaming — Deepgram→Groq→Cartesia (491 linii)
- [x] Funcții conștiente — 20+ tools în persona
- [x] Gzip — compressionMiddleware activ
- [x] Static cache headers — staticCacheMiddleware
- [x] Circuit breaker — brain-profile.js + scalability.js
- [x] IP blacklist — ipBlacklistMiddleware >500 req/min
- [x] Graceful degradation — gracefulDegradationMiddleware
- [x] Sentry DSN — fixat
- [x] Path traversal — Express static safe
- [x] sendToAI_Sync șters — confirmat grep
- [x] TIMPANUL șters — confirmat grep
- [x] Stripe verificat — €9.99/lună funcțional
- [x] Planuri anuale pricing modal — adăugat (Save ~17%)
- [x] Modele AI actualizate — Gemini 3.1 Flash, ElevenLabs v3, whisper-v3-turbo, sonar-pro, tts-1-hd
- [x] Zero hardcode modele — centralizat prin config/models.js (8 fișiere fixate)
- [x] Visits delete button — DELETE /api/admin/traffic/:id
- [x] Refund Stripe — POST /api/admin/refund cu logică lunar/anual
- [x] Clients paying subscribers — GET /api/admin/revenue
- [x] Categorii știri — filter pe /api/news/latest?category=X
- [x] Mutare GPT-5.4 — deja setat în models.js
- [x] Comenzi avatar din chat — setPose/playGesture/setExpression
- [x] Mâinile lângă corp — \_computeArmDownQuaternions()
- [x] Mărire avatari — camera z=1.15, bust framing

---

## ⚠️ DE TESTAT LIVE (8 itemi)

- [ ] Audio INSTANT sub 1s — voice-stream pipeline de testat latența
- [ ] brain.think() binary data — chat.js flow image→brain
- [ ] Mouth stays closed — \_mouthMorphCache force-close
- [ ] Brain repostare fidelă știri — news.js de verificat
- [ ] Lip sync realist — alignment-lipsync.js + fft-lipsync.js
- [ ] Doar engleză traducere — i18n detectLanguage()
- [ ] Memoria persistentă — brain.saveMemory() → Supabase
- [ ] Token health check startup — startup-checks.js

---

## 🟢 DE FĂCUT RAPID (~12 itemi)

- [x] #36 Planuri anuale în pricing modal ✅
- [x] #46 Mutare pe GPT-5.4 ✅ (deja era setat)
- [ ] #53 Brain-map tab dreapta — CSS layout
- [ ] #64 Showcase funcții stânga — UI pe homepage
- [ ] #65 Hourglass animation START page — CSS
- [ ] #66 Scot creierul roz — emoji fallback
- [ ] #67 subscribe.html = DOAR LOGIN
- [x] #84 Visits delete button per row ✅ (deja era)
- [ ] #85 Visits live refresh auto-update
- [x] #44 Categorii știri ✅ (deja era)
- [ ] #38 Promoție Family verificare
- [ ] #31 Procedură update AI — documentație

---

## 🟡 DE FĂCUT MEDIU (~20 itemi)

- [ ] #33 Buton Media → pagină separată publish
- [ ] #34 Buton Trading → pagină raport profit
- [ ] #35 Buton Traffic → pagină vizitatori, IP, țară
- [ ] #37 Planuri enterprise — Stripe config
- [ ] #39 Încărcare credite din interfață
- [ ] #40 AI Credits balanță + alerte email
- [ ] #41 Credit real balance per provider
- [ ] #45 Știri verificate articol complet
- [ ] #47 Vision îmbunătățit
- [ ] #49 Brain centru de cunoaștere
- [ ] #50 Întrebări din trecut — search brain_memory
- [ ] #54 Flux new user complet
- [ ] #55 AUTH: Chat callable ("loghează-mă")
- [ ] #57 PAYMENTS: Chat callable ("vreau Pro")
- [ ] #58 NEWS: Chat callable ("ce știri sunt?")
- [ ] #59 TRADING: Chat callable ("cum stă Bitcoin?")
- [x] #62 Refund pe Stripe ✅ (deja era cu logica lunar/anual)
- [ ] #63 GDPR date cu poza + face_reference
- [ ] #68 Limba inteligentă grup
- [ ] #77 Telegram audio/video/image handlers
- [x] #83 Clients paying subscribers ✅ (deja în /revenue)
- [ ] #86 Visits more details (device, browser, referrer)

---

## 🔴 MARI / RISC (5 itemi — EVITARE)

- [ ] #56 AUTH Voice + face login — complex + security
- [ ] #60 Trading modul învățare piețe — backtesting extensiv
- [ ] #61 Cont live Binance — risc financiar
- [ ] #82 Admin page redesign complet — iterativ
- [ ] #14 YouTube/Maps inteligență — Google API complex

---

## ⚠️ CONFIG EXTERNĂ — Nu e cod (10 itemi)

- [ ] #69 Messenger webhook → Meta Dashboard
- [ ] #70 WhatsApp webhook → Meta Cloud API
- [ ] #72 Facebook Page poza profil
- [ ] #73 Instagram poza profil
- [ ] #74 WhatsApp poza profil
- [ ] #75 Telegram BotFather /setuserpic
- [ ] #76 Messenger avatar bot
- [ ] #90 SMTP Email config Supabase
- [ ] #96 Redis Upstash free tier
- [ ] #97 GOOGLE_MAPS_KEY config

---

## 🧪 TESTARE (5 itemi)

- [ ] #103 Testare live fiecare funcție pe kelionai.app
- [ ] #104 npm audit security check
- [ ] #105 E2E tests live
- [ ] #106 Verificare rute publice
- [ ] #107 Verificare API responses English

---

## 📱 SOCIAL MEDIA RESTANTE (5 itemi cod)

- [ ] #78 Poze avatar pe toate platformele — design
- [ ] #79 Supabase tables messages/posts platforme
- [ ] #80 Media History → social media hub
- [ ] #81 Postări/media publishing funcțional
- [ ] #87 Code Audit → Brain resolution

---

> **TOTAL: 107** | ✅ 35 gata | ⚠️ 8 de testat | 🟢 12 rapide | 🟡 22 medii | 🔴 5 mari | ⚠️ 10 config | 🧪 5 testare | 📱 5 social | **Restante: ~62**
