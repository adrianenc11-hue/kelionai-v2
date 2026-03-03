# E2E Test Suite — Structura Completă

**Live:** `https://kelionai.app` | **Acoperire țintă: 98%**
**Exclus:** Stripe checkout, portal, webhook (3 teste = 2%)

---

## 1. ONBOARDING — 6 teste ✅

| # | Test | Status |
|---|------|:------:|
| 1 | `/` redirect la `/onboarding.html` la prima vizită | ✅ |
| 2 | Step 1 → Step 2 via "Get Started" | ✅ |
| 3 | Step 2 plan selection (free/pro) | ✅ |
| 4 | Navigate back de la step 2 la step 1 | ✅ |
| 5 | "Finish" finalizează onboarding + redirect `/` | ✅ |
| 6 | Onboarding pe mobile (375×812) | ✅ |

## 2. NAVIGARE PAGINI — 15 teste (6 ✅ + 9 🆕)

| # | Test | Status |
|---|------|:------:|
| 7 | Homepage `/` se încarcă | ✅ |
| 8 | `/pricing` se încarcă | ✅ |
| 9 | Pricing link din navbar | ✅ |
| 10 | `/settings` se încarcă | ✅ |
| 11 | `/developer` se încarcă | ✅ |
| 12 | Static assets (app.css, app.js) → 200 | ✅ |
| 13 | `/reset-password.html` se încarcă, conține form | 🆕 |
| 14 | `/404.html` se încarcă cu mesaj 404 | 🆕 |
| 15 | `/error.html` se încarcă | 🆕 |
| 16 | `/dashboard/billing.html` se încarcă | 🆕 |
| 17 | `/dashboard/trading.html` se încarcă | 🆕 |
| 18 | `/dashboard/news.html` se încarcă | 🆕 |
| 19 | `/dashboard/sports.html` se încarcă | 🆕 |
| 20 | `/dashboard/health.html` se încarcă | 🆕 |
| 21 | `/admin/health.html` (admin secret) se încarcă | 🆕 |

## 3. BUTOANE & LINKS — 7 teste (5 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 22 | Navbar links — no 404 | ✅ |
| 23 | Send button vizibil + nu e disabled | ✅ |
| 24 | Mic button vizibil | ✅ |
| 25 | "Get Started" button vizibil | ✅ |
| 26 | Pricing modal button vizibil | ✅ |
| 27 | Back buttons funcționează pe fiecare pagină | 🆕 |
| 28 | Subscription modal se deschide corect la click | 🆕 |

## 4. RESPONSIVE MOBILE — 4 teste ✅

| # | Test | Status |
|---|------|:------:|
| 29 | Homepage pe mobile viewport | ✅ |
| 30 | Hamburger menu deschide nav | ✅ |
| 31 | Send button accesibil pe mobile | ✅ |
| 32 | Onboarding pe mobile | ✅ |

## 5. API HEALTH — 6 teste (4 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 33 | `GET /api/health` → 200 | ✅ |
| 34 | `POST /api/chat` → < 500 | ✅ |
| 35 | `GET /api/news` → < 500 | ✅ |
| 36 | `GET /api/nonexistent` → 404 | ✅ |
| 37 | `GET /health` (root) → status ok | 🆕 |
| 38 | `GET /metrics` fără admin → 401 | 🆕 |

## 6. ERROR HANDLING — 3 teste ✅

| # | Test | Status |
|---|------|:------:|
| 39 | Unknown page returnează app | ✅ |
| 40 | No JS errors pe homepage | ✅ |
| 41 | No JS errors pe `/pricing` | ✅ |

## 7. PWA — 2 teste ✅

| # | Test | Status |
|---|------|:------:|
| 42 | `manifest.json` valid | ✅ |
| 43 | Service worker registration | ✅ |

## 8. CHAT — 6 teste (4 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 44 | AI reply conține cuvinte reale | ✅ |
| 45 | Full chat: send + AI replies | ✅ |
| 46 | Chat empty message | ✅ |
| 47 | Chat long message | ✅ |
| 48 | `POST /api/chat/stream` → SSE events (thinking, start, token, done) | 🆕 |
| 49 | `POST /api/chat/stream` mesaj gol → handling | 🆕 |

## 9. AVATAR — 8 teste (2 ✅ + 6 🆕)

| # | Test | Status |
|---|------|:------:|
| 50 | Avatar Kelion canvas se încarcă | ✅ |
| 51 | User name badge vizibil | ✅ |
| 52 | **Avatar Kira** se încarcă corect | 🆕 |
| 53 | **Switch Kelion → Kira** funcționează | 🆕 |
| 54 | **Switch Kira → Kelion** funcționează | 🆕 |
| 55 | **Kira TTS** — voce diferită de Kelion | 🆕 |
| 56 | **Kira chat** — răspunde cu personalitate diferită | 🆕 |
| 57 | **Kira lip sync** — gura se mișcă cu audio | 🆕 |

## 10. VOICE & LIP SYNC — 10 teste (1 ✅ + 9 🆕)

| # | Test | Status |
|---|------|:------:|
| 58 | Microphone button vizibil | ✅ |
| 59 | `POST /api/speak` text scurt → audio/mpeg | 🆕 |
| 60 | `POST /api/speak` avatar Kira → audio valid | 🆕 |
| 61 | `POST /api/listen` cu text (WebSpeech) → returnează text | 🆕 |
| 62 | `POST /api/listen` cu audio base64 → transcripție | 🆕 |
| 63 | **Voce-text sync** — textul apare, vocea pornește sincron | 🆕 |
| 64 | **Voice overlap prevention** — al doilea răspuns oprește prima voce | 🆕 |
| 65 | **Audio intermitent** — multiple TTS requests → toate returnează audio | 🆕 |
| 66 | **Lip sync force-close** — mouth reset la stop audio | 🆕 |
| 67 | **Push-to-talk** — hold mic → release → input procesat | 🆕 |

## 11. MICROFON & CAMERA — 5 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 68 | Click `#btn-mic` → recording toggle UI | 🆕 |
| 69 | **Microfon off la ieșire pagină** — navigare away oprește mic | 🆕 |
| 70 | Camera button vizibil + click deschide captură | 🆕 |
| 71 | **Cameră la login** — face recognition la autentificare | 🆕 |
| 72 | `POST /api/vision` cu imagine base64 → descriere | 🆕 |

## 12. AUTH — 13 teste (7 ✅ + 6 🆕)

| # | Test | Status |
|---|------|:------:|
| 73 | `POST /api/auth/register` | ✅ |
| 74 | `POST /api/auth/login` + token | ✅ |
| 75 | `GET /api/auth/me` | ✅ |
| 76 | `POST /api/auth/change-password` (wrong) → fail | ✅ |
| 77 | `POST /api/auth/change-email` no auth → 400+ | ✅ |
| 78 | `POST /api/auth/logout` | ✅ |
| 79 | Login in browser + chat | ✅ |
| 80 | `POST /api/auth/refresh` token valid → sesiune nouă | 🆕 |
| 81 | `POST /api/auth/refresh` fără token → 400 | 🆕 |
| 82 | `POST /api/auth/forgot-password` email valid → 200 | 🆕 |
| 83 | `POST /api/auth/forgot-password` email inexistent → 200 | 🆕 |
| 84 | `POST /api/auth/reset-password` token invalid → 401 | 🆕 |
| 85 | `POST /api/auth/change-email` cu auth → 200 | 🆕 |

## 13. TRADING — 15 teste ✅

| # | Test | Status |
|---|------|:------:|
| 86–100 | 15 endpoints trading | ✅ |

## 14. DEVELOPER — 7 teste ✅

| # | Test | Status |
|---|------|:------:|
| 101–107 | 7 endpoints developer | ✅ |

## 15. LEGAL & GDPR — 5 teste ✅

| # | Test | Status |
|---|------|:------:|
| 108–112 | 5 endpoints legal | ✅ |

## 16. AI SERVICES — 6 teste (4 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 113 | `POST /api/search` | ✅ |
| 114 | `POST /api/chat` | ✅ |
| 115 | `POST /api/news` | ✅ |
| 116 | `POST /api/imagine` | ✅ |
| 117 | `POST /api/imagine` cu prompt → imagine base64 completă | 🆕 |
| 118 | **AI știe creatorul** — "cine te-a creat" → răspunde Adrian | 🆕 |

## 17. WEATHER — 3 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 119 | `POST /api/weather` oraș valid (București) → date meteo | 🆕 |
| 120 | `POST /api/weather` oraș inexistent → 404 | 🆕 |
| 121 | `POST /api/weather` fără oraș → 400 | 🆕 |

## 18. GEOLOCATION — 2 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 122 | Permisiune geolocation cerută la startup | 🆕 |
| 123 | Coordonate trimise la AI în context | 🆕 |

## 19. PAYMENTS (non-Stripe) — 6 teste (3 🆕 + 3 ❌)

| # | Test | Status |
|---|------|:------:|
| 124 | `GET /api/payments/plans` → lista planuri | 🆕 |
| 125 | `GET /api/payments/status` fără auth → guest | 🆕 |
| 126 | `GET /api/payments/status` cu auth → plan + usage | 🆕 |
| 127 | `POST /api/payments/checkout` | ❌ Stripe |
| 128 | `POST /api/payments/portal` | ❌ Stripe |
| 129 | `POST /api/payments/webhook` | ❌ Stripe |

## 20. IDENTITY, MEDIA, MESSAGING — 11 teste (6 ✅ + 5 🆕)

| # | Test | Status |
|---|------|:------:|
| 130–131 | Identity (register-face, verify-face) | ✅ |
| 132 | `POST /api/news → needs admin` | ✅ |
| 133 | `GET /api/media/facebook/health` | ✅ |
| 134 | `POST /api/media/publish → needs admin` | ✅ |
| 135–137 | Messaging (messenger, whatsapp health) | ✅ |
| 138 | `GET /api/media/instagram/health` | 🆕 |
| 139 | `GET /api/media/status` (admin) | 🆕 |
| 140 | `POST /api/media/publish-news` (admin) → FB + Instagram | 🆕 |
| 141 | `GET /api/messenger/stats` (admin) | 🆕 |
| 142 | `GET /api/news/public` → articole | 🆕 |

## 21. ADMIN — 7 teste (5 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 143–146 | Admin routes blocked | ✅ |
| 147 | Referral `GET /api/referral/code` | ✅ |
| 148 | `GET /dashboard` fără admin → 404 | 🆕 |
| 149 | `GET /api/admin/health-check` (admin) → report | 🆕 |

## 22. SECURITY — 10 teste ✅

| # | Test | Status |
|---|------|:------:|
| 150–159 | XSS, SQL injection, rate limit, CSRF, path traversal, etc. | ✅ |

## 23. TICKER — 1 test 🆕

| # | Test | Status |
|---|------|:------:|
| 160 | `POST /api/ticker/disable` fără auth → 401 | 🆕 |

## 24. i18n — 4 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 161 | Schimbare limbă EN → verificare text UI | 🆕 |
| 162 | Schimbare limbă RO → verificare text UI | 🆕 |
| 163 | Chat în limba selectată → AI răspunde corect | 🆕 |
| 164 | **Limbă memorată** — setează limbă → reload → persistă | 🆕 |

## 25. CONVERSATION HISTORY — 2 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 165 | Trimite mesaj → history sidebar → apare | 🆕 |
| 166 | Reload pagină → history → conversația persistă | 🆕 |

## 26. REFERRAL — 3 teste (1 ✅ + 2 🆕)

| # | Test | Status |
|---|------|:------:|
| 167 | `GET /api/referral/code` | ✅ |
| 168 | `GET /api/referral/code` cu auth → cod referral | 🆕 |
| 169 | `GET /api/referral/code` fără auth → eroare | 🆕 |

## 27. UI LAYOUT — 2 teste 🆕

| # | Test | Status |
|---|------|:------:|
| 170 | **Chat area** — are flex:1 și min-height ≥ 250px | 🆕 |
| 171 | **Vision fără imagine** — `POST /api/vision` fără imagine → 503 | 🆕 |

## 28. FLUXURI END-TO-END — 4 teste (1 ✅ + 3 🆕)

| # | Test | Status |
|---|------|:------:|
| 172 | Full auth existentă | ✅ |
| 173 | **Full auth complet**: Register → Login → Chat → Change Pass → Logout | 🆕 |
| 174 | **Voice round-trip**: Text → TTS audio → STT transcripție | 🆕 |
| 175 | **Search + Chat**: Search → Rezultate → Chat follow-up | 🆕 |

## 29. AI SIMULĂRI & ROLURI — 9 teste 🆕

> **Concept:** AI-ul primește un rol → ÎNTÂI caută cum se face la 10/10 → APOI execută.
> Implementare: Knowledge Base pre-built + Prompt Library în `brain.js`.

### Knowledge Base (embedded în brain.js)

| Rol | Framework-uri integrate | Surse de căutare automată |
|-----|------------------------|--------------------------|
| Profesor | Bloom's Taxonomy, 5E Model, Backward Design | Google Scholar, Khan Academy methodology |
| Agent Vânzări | AIDA, SPIN Selling, Challenger Sale | Industry benchmarks, case studies |
| Cercetător | Metoda științifică, Literature Review, Meta-analiză | Google Scholar, PubMed, arXiv |
| Consultant | McKinsey 7S, Porter's 5 Forces, SWOT, Business Model Canvas | Industry reports, best practices |
| Prezentator | Storytelling Arc, 10-20-30 Rule, Minto Pyramid | TED methodology, Presentation Zen |
| Intervievator | STAR Method, Competency-Based, Behavioral | LinkedIn, Glassdoor trends |
| Planificator | GANTT, Agile Sprint, WBS | Prețuri reale, locații, review-uri live |
| Trainer | ADDIE Model, Kirkpatrick Evaluation, Microlearning | L&D best practices |
| Content Creator | AIDA Copy, PAS Framework, Hook-Story-Offer | Social media trends, SEO data |

### Prompt Library (system prompts experte per rol)

Fiecare rol primește un system prompt care forțează:
1. **Research phase** — "Înainte de a răspunde, caută cele mai bune practici pentru [rol]"
2. **Structure phase** — "Folosește framework-ul [X] pentru a structura răspunsul"
3. **Quality check** — "Verifică: ai surse? ai structură? e concret sau generic?"
4. **Output format** — template forțat per tip de output

### Teste AI Simulări

| # | Test | Ce verifică |
|---|------|------------|
| 176 | **Profesor** — "fă-mi o lecție despre fotosinteza" → structură Bloom's (obiective, teorie, exerciții, evaluare) | 🆕 |
| 177 | **Prezentator** — "fă-mi o prezentare despre energia solară" → outline cu slide-uri, hook, closing | 🆕 |
| 178 | **Agent vânzări** — "vinde-mi un telefon" → pitch AIDA/SPIN (nu generic) | 🆕 |
| 179 | **Consultant** — "ce structură are un plan de afaceri" → secțiuni standard (SWOT, financiar, etc.) | 🆕 |
| 180 | **Cercetător** — "cercetează impactul AI asupra educației" → raport cu surse citate (min 2) | 🆕 |
| 181 | **Intervievator** — "simulează un interviu pentru developer" → întrebări STAR, nu generice | 🆕 |
| 182 | **Planificator** — "planifică o vacanță în Grecia" → caută real (prețuri, locuri, date) | 🆕 |
| 183 | **Trainer** — "antrenează-mă pentru public speaking" → plan ADDIE cu exerciții practice | 🆕 |
| 184 | **Search-first verification** — orice rol nou → AI-ul caută ÎNAINTE de a răspunde (thinkTime > 0) | 🆕 |

## 30. INTELIGENȚĂ BRAIN — 8 teste 🆕

> Testează funcțiile core din `brain.js`: gândire, planificare, recovery, învățare.

| # | Test | Ce verifică |
|---|------|------------|
| 185 | **Chain-of-thought** — cerere complexă → thinkTime > 0, toolStats arată activitate | 🆕 |
| 186 | **Task decomposition** — "caută vremea în 3 orașe" → descompune în sub-tasks | 🆕 |
| 187 | **Auto-recovery** — dacă un tool pică, AI-ul oferă alternativă nu eroare | 🆕 |
| 188 | **Search refinement** — a doua căutare pe același subiect → query îmbunătățit | 🆕 |
| 189 | **Learn from conversation** — "mă numesc X" → conversația următoare își amintește | 🆕 |
| 190 | **History compression** — 20+ mesaje → AI comprimă, păstrează context | 🆕 |
| 191 | **Multi-tool plan** — "cum e vremea și ce știri sunt" → folosește weather + search | 🆕 |
| 192 | **Diagnostics** — `GET /api/brain` returnează status, toolStats, journal | 🆕 |

## 31. PERSONA & EMOȚII — 10 teste 🆕

> Testează `persona.js`: Truth Engine, Emotional IQ, Humor, Temporal Awareness, avatar personalități.

| # | Test | Ce verifică |
|---|------|------------|
| 193 | **Truth Engine** — întreabă ceva inventat → AI zice "nu știu", nu inventează | 🆕 |
| 194 | **EQ tristețe** — "sunt trist" → validare emoțională, NU soluție directă | 🆕 |
| 195 | **EQ bucurie** — "am luat examenul!" → celebrare sinceră cu entuziasm | 🆕 |
| 196 | **Humor natural** — conversație casual → răspuns cu umor, nu forțat | 🆕 |
| 197 | **Temporal awareness** — chat la ore diferite → ton adaptat (dimineață vs noapte) | 🆕 |
| 198 | **Curiosity** — spune ceva interesant → AI pune O întrebare la final | 🆕 |
| 199 | **Proactive** — "mă duc afară" → oferă meteo/sugestie fără să fie cerut | 🆕 |
| 200 | **Accessibility** — trimite imagine + cere descriere → direcții, culori, pericole | 🆕 |
| 201 | **Self-repair** — tool indisponibil → AI oferă alternativă, nu mesaj eroare | 🆕 |
| 202 | **Kelion vs Kira** — aceeași întrebare la ambii → personalitate diferită verificabilă | 🆕 |

## 32. MEMORIE PERSISTENTĂ — 4 teste 🆕

> Testează memory injection, user preferences, recall, izolare între useri.

| # | Test | Ce verifică |
|---|------|------------|
| 203 | **Memory save** — "reține că prefer Python" → salvat în preferințe DB | 🆕 |
| 204 | **Memory recall** — conversație nouă → AI menționează preferința salvată | 🆕 |
| 205 | **Memory context** — chat cu user autentificat → AI folosește istoricul | 🆕 |
| 206 | **Memory isolation** — user A nu vede memoria user B (securitate) | 🆕 |

---

## SUMAR FINAL

| Categorie | ✅ | 🆕 | ❌ | Total |
|-----------|:--:|:--:|:--:|:-----:|
| Onboarding | 6 | 0 | 0 | 6 |
| Navigare | 6 | 9 | 0 | 15 |
| Butoane | 5 | 2 | 0 | 7 |
| Responsive | 4 | 0 | 0 | 4 |
| API Health | 4 | 2 | 0 | 6 |
| Errors | 3 | 0 | 0 | 3 |
| PWA | 2 | 0 | 0 | 2 |
| Chat | 4 | 2 | 0 | 6 |
| Avatar | 2 | 6 | 0 | 8 |
| Voice & Lip Sync | 1 | 9 | 0 | 10 |
| Mic & Camera | 0 | 5 | 0 | 5 |
| Auth | 7 | 6 | 0 | 13 |
| Trading | 15 | 0 | 0 | 15 |
| Developer | 7 | 0 | 0 | 7 |
| Legal/GDPR | 5 | 0 | 0 | 5 |
| AI Services | 4 | 2 | 0 | 6 |
| Weather | 0 | 3 | 0 | 3 |
| Geolocation | 0 | 2 | 0 | 2 |
| Payments | 0 | 3 | 3 | 6 |
| Media/Msg | 6 | 5 | 0 | 11 |
| Admin | 5 | 2 | 0 | 7 |
| Security | 10 | 0 | 0 | 10 |
| Ticker | 0 | 1 | 0 | 1 |
| i18n | 0 | 4 | 0 | 4 |
| History | 0 | 2 | 0 | 2 |
| Referral | 1 | 2 | 0 | 3 |
| UI Layout | 0 | 2 | 0 | 2 |
| Fluxuri E2E | 1 | 3 | 0 | 4 |
| AI Simulări | 0 | 9 | 0 | 9 |
| **Brain Intelligence** | **0** | **8** | **0** | **8** |
| **Persona & Emoții** | **0** | **10** | **0** | **10** |
| **Memorie Persistentă** | **0** | **4** | **0** | **4** |
| **TOTAL** | **103** | **98** | **3** | **204** |

**Acoperire curentă: 103/201 (51%) → După implementare: 201/204 (98%)**
