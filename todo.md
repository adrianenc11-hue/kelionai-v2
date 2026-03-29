# 📋 KelionAI — TODO pentru următoarea sesiune

> **Ultima actualizare:** 24 Martie 2026, 15:25 UTC
> **Ultima sesiune:** Orchestrator v3.0 — Creier Interconectat + Protecție

---

## 🔴 URGENT (de verificat imediat)

- [ ] **ANTHROPIC_API_KEY** — Verifică în Railway (Settings → Variables) dacă e setată. Fără ea, Claude Sonnet 4 (coder) nu funcționează și creierul folosește fallback GPT-5.4. Adaugă și în `.env.example`.
- [ ] **Testare live** — Testează pe kelionai.app: chat simplu, chat complex, căutare web, analiză imagine (camera), cod. Verifică că toate funcționează cu creierul v3.0.

## 🟡 IMPORTANT (de făcut curând)

- [ ] **Costuri API** — Monitorizează costurile în admin panel → AI Costs. Creierul v3.0 folosește mai mulți agenți per cerere complexă (2-4 agenți în paralel). Ajustează dacă e prea scump.
- [ ] **AUTO_REPAIR** — Setează `AUTO_REPAIR=true` în Railway dacă vrei ca creierul să se auto-repare autonom.
- [x] **Voice stream userId** — userId resolved from WebSocket auth token (already implemented).
- [x] **Streaming (SSE) identity guard** — `checkInputProbing()` (already had) + `sanitizeOutput()` added to stream route.

## 🟢 ÎMBUNĂTĂȚIRI VIITOARE

- [x] **Admin panel endpoints** — Mounted 4 admin sub-routers (monitor, revenue, users, visitors) + added 11 missing endpoints (/brain, /ai-status, /costs, /traffic, /live-users, /memories, /logs, etc.)
- [ ] **Brain Dashboard upgrade** — Dashboard-ul (`/dashboard`) afiseaza acum pipeline traces, provider stats, circuit breaker status, latency per provider. (v1 complet). TODO viitor: vizualizare pipeline multi-agent cand se implementeaza orchestratorul real.
- [x] **Caching raspunsuri** -- Brain response cache (SHA-256 key, 120s TTL) via cache.js. Skips vision/short messages.
- [ ] **A/B testing modele** — Compară calitatea răspunsurilor între GPT-5.4 singur vs. multi-agent synthesis. Poate pentru unele categorii e mai bun un singur model.
- [x] **Emotion detection din pipeline** — Brain now parses [EMOTION:xxx] tags + fallback text-based detection (no longer always neutral).
- [x] **Rate limiting per agent** -- Circuit breaker wired to all AI providers (Gemini, OpenAI, Groq). 5 failures = 30s cooldown.

## ✅ COMPLETAT (sesiunea 24 Mar 2026)

- [x] Orchestrator v3.0 — 5 straturi cognitive (Perceive → Reason → Synthesize → Verify → Fallback)
- [x] Multi-agent paralel + sinteză consensus (GPT-5.4 ca "cortex prefrontal")
- [x] Analiză vizuală duală (GPT-5.4 + Gemini 2.5 Flash în paralel)
- [x] Self-reflection quality loop (Gemini Flash verifică răspunsurile)
- [x] Emergency fallback cascade (4 provideri)
- [x] Memory-augmented reasoning (memoria integrală injectată în system prompt)
- [x] Code Shield — protecție anti-copiere server (integritate fișiere, rate limiting, scraper detection)
- [x] Identity Guard — avatarul nu dezvăluie niciodată modelele/providerii
- [x] Copy Shield — protecție anti-copiere client (Ctrl+C blocat, DevTools detectat, watermark)
- [x] System prompt comprimat ~60% (eliminate 3 duplicate masive)
- [x] max_tokens adăugat la toate apelurile API

---

## 📁 Fișiere cheie modificate/create

| Fișier                     | Ce face                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `server/orchestrator.js`   | Creierul v3.0 — 5 straturi cognitive, multi-agent paralel        |
| `server/code-shield.js`    | Protecție anti-copiere server (integritate, rate limit, scraper) |
| `server/identity-guard.js` | Avatarul nu dezvăluie internals (30+ pattern-uri detectate)      |
| `app/js/copy-shield.js`    | Protecție anti-copiere client (DevTools, watermark)              |
| `server/persona.js`        | System prompt optimizat (-60% tokeni)                            |
| `server/routes/chat.js`    | Identity guard wired (input probing + output sanitization)       |
| `server/index.js`          | Code shield wired (middleware-uri de protecție)                  |

---

## 🏗️ Arhitectura creierului v3.0

```
Mesaj utilizator
    │
    ▼
┌─────────────────┐
│  LAYER 1:       │  GPT-4o-mini clasifică intent-ul (3s timeout)
│  PERCEPȚIE      │  Detectează: categorie, complexitate, risc, modalitate
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LAYER 2:       │  Alege agenții (ca regiuni ale creierului)
│  RUTARE         │  Ex: coding → Claude + GPT-5.4 + Gemini QA
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LAYER 3:       │  Agenții lucrează ÎN PARALEL
│  EXECUȚIE       │  Fiecare provider: OpenAI, Anthropic, Google, Groq, DeepSeek, Perplexity
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LAYER 4:       │  GPT-5.4 sintetizează toate rezultatele
│  SINTEZĂ        │  Ia cele mai bune părți din fiecare agent
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LAYER 5:       │  Gemini Flash verifică calitatea
│  VERIFICARE     │  Self-reflection: acuratețe, completitudine, siguranță
└────────┬────────┘
         │
         ▼
    Răspuns final → Identity Guard sanitizează → Utilizator
```
