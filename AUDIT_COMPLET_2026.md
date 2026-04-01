# KelionAI v2 — Audit Complet

**Data:** 1 Aprilie 2026  
**Repo:** `github.com/adrianenc11-hue/kelionai-v2`  
**Stack:** Express + tRPC + Drizzle/PostgreSQL + Vite/React + Three.js + Socket.IO  
**Deploy:** Railway (Dockerfile) → Supabase PostgreSQL (EU)

---

## 1. PROBLEME CRITICE (trebuie rezolvate imediat)

### 1.1 SECURITATE — JWT fallback secrets diferite și nesigure

**Fișiere:** `standalone-auth.ts:18` și `_core/index.ts:154`

Există **două fallback-uri JWT diferite** în codebase:
- `standalone-auth.ts` → `"kelionai-default-secret-change-me"`
- `_core/index.ts` (endpoint `/api/profile/avatar`) → `"dev-secret"`

Dacă `JWT_SECRET` nu e setat în Railway, autentificarea e compromisă. Mai grav, cele două fallback-uri diferite înseamnă că token-urile semnate de standalone-auth **nu vor fi validate** de endpoint-ul avatar și invers.

**Fix:** Un singur fallback (sau mai bine, crash la startup dacă `JWT_SECRET` lipsește):
```ts
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("FATAL: JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}
```

### 1.2 SECURITATE — CORS permite orice origin

**Fișier:** `_core/index.ts:57-66`

```ts
const origin = req.headers.origin;
if (origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
}
```

Orice site din lume poate face request-uri autentificate la API. Trebuie whitelist:
```ts
const ALLOWED_ORIGINS = [
  "https://kelionai.app",
  "https://kelionai-v2-production.up.railway.app",
];
if (origin && ALLOWED_ORIGINS.includes(origin)) { ... }
```

### 1.3 SECURITATE — WebSocket CORS `origin: "*"`

**Fișier:** `websocket-server.ts:23`

Socket.IO acceptă conexiuni de la orice origin. Trebuie restricționat la aceleași domenii ca și HTTP CORS.

### 1.4 SECURITATE — Code Executor permite RCE (Remote Code Execution)

**Fișier:** `code-executor.ts`

Sanitizarea cu regex e ușor de ocolit. Un user poate executa cod arbitrar pe server:
- Python: `__builtins__.__import__('os').system('...')` — ocolește regex-ul
- Bash: blacklist-ul e insuficient (`rm`, `curl`, `wget`, `cat /etc/passwd`, etc. funcționează)
- JavaScript: `require('child_' + 'process')` — ocolește regex-ul

**Recomandare:** Dezactivează code execution complet până când implementezi Docker sandbox sau WASM isolation. Acest modul este **cea mai periculoasă vulnerabilitate** din codebase.

### 1.5 SECURITATE — Endpoint `/api/migrate` expus public

**Fișier:** `_core/index.ts:97-139`

Endpoint-ul `/api/migrate` nu are nicio autentificare. Oricine poate:
- Seta admin role pe orice email
- Insera subscription plans
- Vedea informații despre baza de date

**Fix:** Adaugă `adminProcedure` sau cel puțin un secret token în query string.

### 1.6 SECURITATE — Lipsă Rate Limiting complet

Nu există niciun rate limiter pe niciunul din endpoint-uri. Un atacator poate:
- Brute-force parole (login endpoint)
- Spam-ui API-ul OpenAI/ElevenLabs (costă bani)
- DDoS pe WebSocket

**Fix:** `express-rate-limit` pe `/api/auth/login`, `/api/auth/register`, `/api/chat/stream`, și pe toate mutation-urile.

---

## 2. PROBLEME MAJORE (afectează funcționalitatea)

### 2.1 Modelul AI nu corespunde arhitecturii planificate

**Arhitectura din memorie:** GPT-4.1 = primary chat, GPT-4o-realtime = voice, GPT-4.1 vision = accessibility

**Ce e în cod:**
- `llm.ts:245` → returnează `"gpt-4o"` (nu GPT-4.1)
- `brain-v4.ts:138` → hardcoded `"gpt-4o"` pentru vision (nu GPT-4.1 vision)
- `streaming.ts:24` → returnează `"gpt-4o"` (nu GPT-4.1)
- Fallback Forge → `"gemini-2.5-flash"` (OK pentru Manus, dar nu se mai folosește)
- Nu există nicio referință la `gpt-4o-realtime` pentru voice WebSocket

**Fix:** Actualizează `getModelName()` la `"gpt-4.1"` și adaugă modelul realtime pentru voice.

### 2.2 TTS se generează pe FIECARE mesaj — costuri mari ElevenLabs

**Fișiere:** `brain-v4.ts:258-267`, `streaming.ts:172-179`

Fiecare răspuns generează audio TTS automat, chiar dacă user-ul nu a cerut audio. Cu ElevenLabs billing per character, asta consumă credite rapid.

**Fix:** TTS-ul trebuie generat doar on-demand (când user-ul cere sau când e pe voice mode).

### 2.3 Streaming endpoint trimite base64 audio — response payload enorm

**Fișier:** `elevenlabs.ts:79`

Când storage-ul local (fără S3) e folosit, audio-ul e returnat ca `data:audio/mpeg;base64,...` inline în SSE event. Un răspuns de 30 secunde ≈ 500KB base64 care se trimite prin SSE stream.

**Fix:** Salvează local și returnează URL, sau implementează Supabase Storage.

### 2.4 Lipsesc endpoint-uri GDPR

Nu există niciun endpoint pentru:
- Export date personale
- Ștergere completă cont (GDPR "right to be forgotten")
- Descărcare istoric conversații

`closeUserAccount()` din `db.ts` face doar soft-close (pune `accountClosed: true`), dar **nu șterge datele**.

**Fix:** Implementează `/api/gdpr/export` și `/api/gdpr/delete` cu ștergere reală.

### 2.5 Pricing tiers inconsistente

**În memorie:** Pro €9.99, Premium €19.99  
**În cod:**
- `schema.ts` → enum-uri: `free`, `pro`, `enterprise` (nu "premium")
- `/api/migrate` → `Enterprise: 29.99` (nu 19.99)
- `admin.ts:123` → `pro * 29 + enterprise * 99` (placeholder greșit)
- `subscription.ts:51-59` → price IDs mapate la `pro` + `enterprise`, nu `premium`

**Fix:** Aliniază naming-ul și prețurile la planul de business actual.

### 2.6 WebSocket voice nu are autentificare

**Fișier:** `websocket-server.ts:32`

Event-ul `"join"` primește `userId` direct de la client fără verificare JWT. Oricine poate trimite un userId arbitrar și impersona alt user.

**Fix:** Verifică JWT token la connection sau la `"join"` event.

---

## 3. PROBLEME MODERATE (afectează calitatea)

### 3.1 Cod duplicat — `resolveApiUrl()` / `getApiKey()` / `getModelName()`

Aceste funcții sunt definite identic în 3 fișiere:
- `_core/llm.ts`
- `streaming.ts`
- (parțial) `brain-v4.ts`

**Fix:** Export din `llm.ts` și importă în celelalte.

### 3.2 Referral bonus e 5 zile în cod, 7 zile în specificații

**Din memorie:** `referral = 7-day Pro for both`  
**Din cod:** `db.ts:237` → `+ (5 * 24 * 60 * 60)` = 5 zile

### 3.3 `env.ts` comentariu incorect

```ts
// OpenAI for GPT-5.4 vision + Whisper STT
openaiApiKey: process.env.OPENAI_API_KEY ?? "",
```
"GPT-5.4" nu există. Probabil "GPT-4.1" sau "GPT-4o".

### 3.4 Conversation `primaryAiModel` hardcoded

**Fișier:** `db.ts:92` → `primaryAiModel: "gpt-4"` — mereu se scrie "gpt-4" la creation, indiferent de modelul real folosit.

### 3.5 Admin analytics încarcă TOȚI userii/mesajele în memorie

**Fișier:** `admin.ts:51-65`

```ts
const allUsers = await db.select().from(users);
const allConversations = await db.select().from(conversations);
const allMessages = await db.select().from(messages);
```

Cu mii de useri/mesaje, asta va face OOM sau timeout. Trebuie `COUNT()` SQL.

### 3.6 `subscriptionStatus` default = `"active"` pentru useri noi

**Fișier:** `schema.ts:24` → `.default("active")`

Un user nou care se înregistrează are `subscriptionStatus: "active"` + `subscriptionTier: "free"`. Confuz — un user free nu e "activ" pe subscription. Ar trebui `null` sau un status dedicat.

### 3.7 Fișiere moarte / nefolosite

- `agi-brain.ts`, `agi-decision-engine.ts`, `ai-router.ts` — nu sunt importate nicăieri
- `teaching-engine.ts`, `vision-system.ts`, `accessibility-layer.ts` — nu sunt importate
- `_core/map.ts`, `_core/imageGeneration.ts`, `_core/notification.ts`, `_core/dataApi.ts` — neimportate
- `ComponentShowcase.tsx` (57KB) — pagină demo, nu e pentru producție

**Fix:** Șterge codul mort sau integrează-l.

### 3.8 Database fără foreign keys

Tabelele din `schema.ts` au `integer("user_id")` dar **fără `.references()`**. Nu există integritate referențială la nivel de DB — poți avea mesaje orfane, conversations fără user, etc.

### 3.9 DB connection pool fără cleanup

**Fișier:** `db.ts:20-24`

```ts
const client = postgres(url, { ssl: 'require', max: 10 });
_db = drizzle(client);
```

Nu există `client.end()` sau graceful shutdown. La restart Railway, conexiunile rămân deschise în Supabase.

---

## 4. TODO-URI DIN COD (bugs cunoscute nerezolvate)

Din `todo.md`:
1. ❌ Fix "I'm experiencing a temporary issue" error on chat (AI not responding)
2. ❌ Fix "Voice error: invalid_format, Invalid URL" on TTS
3. ❌ Fix Camera capture giving error
4. ❌ Fix missing Romanian translation

Din memorie (sesiuni anterioare):
5. ❌ Claude integration into clone-voice button
6. ❌ GDPR endpoints returning 404
7. ❌ `showSubtitle` bug in `voice.js`
8. ❌ Verify `OPENAI_API_KEY` in Railway

---

## 5. DEPLOYMENT CHECKLIST (blockers)

| Task | Status |
|------|--------|
| `JWT_SECRET` setat în Railway | ❓ de verificat |
| `OPENAI_API_KEY` setat în Railway | ❓ de verificat |
| `ELEVENLABS_API_KEY` setat în Railway | ❓ de verificat |
| `SUPABASE_DATABASE_URL` setat | ❓ de verificat |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | ❌ lipsesc |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_PREMIUM` | ❌ lipsesc |
| `APP_URL=https://kelionai.app` | ❌ lipsește |
| Schema SQL aplicată pe Supabase | ❓ de verificat |
| Stripe products create | ❌ de făcut |
| Domeniu `kelionai.app` achiziționat | ❓ de verificat |
| Rate limiting implementat | ❌ lipsește |
| `/api/migrate` securizat | ❌ expus public |

---

## 6. STATISTICI CODEBASE

| Metrică | Valoare |
|---------|---------|
| Fișiere server TypeScript | ~30 |
| Fișiere client React | ~25 |
| Pagini frontend | 12 (Home, Chat, Login, Profile, Pricing, Contact, Admin, etc.) |
| Tabele DB (Drizzle schema) | 13 |
| tRPC routers | 9 (chat, subscription, admin, voice, contact, referral, refund, userChat, voiceLibrary) |
| Limbi i18n | 24 |
| Teste (vitest) | 129 menționate în commit-uri |
| Cod mort (neimportat) | ~8 fișiere server, ~57KB showcase |

---

## 7. CE FUNCȚIONEAZĂ BINE

- **Arhitectura generală** e solidă: tRPC + Drizzle + PostgreSQL e un stack modern
- **Auth standalone** cu bcrypt + JWT e corect implementat (minus fallback-ul)
- **Trial system** cu daily limits e bine gândit
- **Stripe webhook handler** acoperă lifecycle-ul complet (checkout, update, delete, invoice)
- **Voice cloning pipeline** ElevenLabs e funcțional
- **i18n** cu 24 limbi este impresionant
- **Schema DB** e bine structurată cu enum-uri PostgreSQL
- **SSE streaming** pentru chat funcționează corect
- **Admin dashboard** cu analytics de bază e util
- **Refund system** cu business logic (monthly non-refundable, 3-month limit) e bine gândit

---

## 8. PRIORITIZARE RECOMANDATĂ

**Sprint 1 (Securitate — URGENT):**
1. Fixează JWT secret (un singur secret, crash dacă lipsește)
2. Restricționează CORS la domenii specifice
3. Dezactivează code-executor sau pune-l în sandbox
4. Securizează `/api/migrate` (sau șterge-l)
5. Adaugă auth pe WebSocket `"join"`
6. Implementează rate limiting pe login/register/chat

**Sprint 2 (Funcționalitate — Blocker deploy):**
7. Actualizează model names la GPT-4.1
8. Fixează TTS să fie on-demand, nu pe fiecare mesaj
9. Setează env vars lipsă pe Railway
10. Creează produse Stripe
11. Aliniază pricing naming (premium vs enterprise)

**Sprint 3 (Calitate — Pre-launch):**
12. Șterge codul mort
13. Deduplică `resolveApiUrl/getApiKey/getModelName`
14. Adaugă foreign keys pe DB
15. Implementează GDPR endpoints
16. Fix bugs din todo (AI not responding, TTS invalid URL, camera)

---

*Audit generat automat din analiza codului sursă. Toate observațiile se bazează pe codul din master branch, commit `5d22a9b`.*
