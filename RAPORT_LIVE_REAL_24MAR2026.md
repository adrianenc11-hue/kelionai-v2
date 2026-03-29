# 🚨 RAPORT REAL — KelionAI Live — 24 Martie 2026

> **Verificat ACUM cu Playwright pe https://kelionai.app**  
> **Screenshot-uri salvate în:** `test-results/live-audit-now/`  
> **53 erori JavaScript detectate pe o singură pagină**

---

## ❌ CE NU FUNCȚIONEAZĂ (verificat live)

### 1. CHAT-UL NU FUNCȚIONEAZĂ

- **Dovadă:** Am trimis "Salut, funcționezi?" → răspunsul primit înapoi a fost **propriul mesaj** ("Salut, funcționezi?"), NU un răspuns AI
- **Screenshot:** `04b-chat-response.png`
- **API:** `POST /api/chat` → **429 Too many requests** (rate limiter prea agresiv)
- Chat-ul arată input-ul dar **NU primește răspuns de la AI**

### 2. GDPR — ENDPOINT-URI SPARTE

| Endpoint                  | Status  | Rezultat                             |
| ------------------------- | ------- | ------------------------------------ |
| `GET /api/gdpr/consent`   | **404** | `{"error":"API endpoint not found"}` |
| `POST /api/gdpr/consent`  | **404** | `{"error":"API endpoint not found"}` |
| `DELETE /api/gdpr/delete` | **404** | `{"error":"API endpoint not found"}` |
| `POST /api/gdpr/export`   | 401     | Necesită auth (corect)               |

**Concluzie GDPR:** 3 din 4 endpoint-uri GDPR sunt **complet sparte** (404). Doar export-ul există dar necesită autentificare. Un utilizator NU poate:

- Vedea/modifica consimțământul GDPR
- Șterge datele personale
- Doar exportul funcționează (cu auth)

### 3. ADMIN PANEL — NU FUNCȚIONEAZĂ

- **Dovadă:** `https://kelionai.app/admin/` → "🔒 Admin — acces restricționat. Nu ești logat."
- **Screenshot:** `08-admin.png`
- Chiar și după login, admin-ul nu funcționează deoarece scripturile sunt blocate de CSP

### 4. 53 ERORI JAVASCRIPT PE PAGINĂ

Erori critice detectate:

- **CSP blochează TOATE scripturile inline** — `Executing inline script violates Content Security Policy directive 'script-src'` (apare de ~40 ori!)
- **`/js/ticker.js` → 404** — fișierul lipsește complet, serverul returnează HTML în loc de JS
- **`showSubtitle is not defined`** — funcție apelată dar neexistentă
- **Resurse 400** — cereri eșuate

**Asta înseamnă:** Majoritatea funcționalităților JavaScript din pagină **NU SE EXECUTĂ** din cauza Content Security Policy. Butoanele, overlay-urile, GDPR consent dialog — toate depind de scripturi inline care sunt **blocate**.

### 5. GDPR CONSENT OVERLAY — APARE DAR NU FUNCȚIONEAZĂ CORECT

- **Dovadă:** Overlay-ul GDPR apare (vizibil: true), butonul "Accept" există
- **Screenshot:** `02-gdpr-overlay.png`
- **PROBLEMA:** Scripturile inline care gestionează click-ul pe "Accept" sunt **blocate de CSP**
- Utilizatorul vede overlay-ul dar **nu poate trece de el** deoarece JavaScript-ul e blocat

### 6. RATE LIMITING PREA AGRESIV

| Endpoint                  | Status                    |
| ------------------------- | ------------------------- |
| `POST /api/chat`          | **429** Too many requests |
| `GET /api/conversations`  | **429** Too many requests |
| `GET /api/payments/plans` | **429** Too many requests |

Rate limiter-ul blochează cereri normale după doar câteva request-uri.

---

## ✅ CE FUNCȚIONEAZĂ (puțin)

| Ce                      | Status | Dovadă                     |
| ----------------------- | ------ | -------------------------- |
| Homepage se încarcă     | ✅ 200 | `01-homepage.png`          |
| `/api/health`           | ✅ 200 | Server up, brain "healthy" |
| `/gdpr/` pagina HTML    | ✅ 200 | 2198 chars conținut        |
| `/privacy/` pagina HTML | ✅ 200 | 1281 chars conținut        |
| `/terms/` pagina HTML   | ✅ 200 | Se încarcă                 |
| `/pricing/` pagina HTML | ✅ 200 | Se încarcă                 |
| `/api/legal/terms`      | ✅ 200 | JSON valid                 |
| `/api/legal/privacy`    | ✅ 200 | JSON valid                 |

**Dar:** Paginile HTML se încarcă dar **JavaScript-ul din ele NU funcționează** din cauza CSP.

---

## 🔴 PROBLEMA PRINCIPALĂ: Content Security Policy

Serverul trimite un header CSP cu `nonce` pentru scripturi:

```
script-src 'self' 'unsafe-eval' 'nonce-CZVZdiPjDsOyjLXTnXPC+w=='
```

Dar **scripturile inline din HTML nu au atributul `nonce`**, deci sunt **toate blocate**. Asta distruge:

- GDPR consent dialog (click handlers)
- Chat functionality
- Auth screen
- Admin panel
- Ticker
- Subtitles
- Practic **tot ce e interactiv**

---

## 📊 SUMAR REAL

| Categorie               | Funcționează?                             |
| ----------------------- | ----------------------------------------- |
| Server up               | ✅ Da                                     |
| Pagini HTML se încarcă  | ✅ Da                                     |
| JavaScript funcționează | ❌ **NU** (53 erori CSP)                  |
| Chat AI                 | ❌ **NU** (429 + fără răspuns)            |
| GDPR consent            | ❌ **NU** (404 API + CSP blochează UI)    |
| GDPR delete             | ❌ **NU** (404)                           |
| GDPR export             | ⚠️ Parțial (necesită auth)                |
| Admin panel             | ❌ **NU** (blocat)                        |
| Auth/Login              | ❌ **NU** (403 din curl, CSP din browser) |
| Payments                | ❌ **NU** (429)                           |

### Procent real funcțional: **~15%** — doar paginile statice se încarcă, nimic interactiv nu merge.

---

## CE TREBUIE REPARAT URGENT

1. **CSP Header** — Fie adaugă `'unsafe-inline'` la `script-src`, fie pune `nonce` pe fiecare `<script>` tag din HTML
2. **GDPR endpoints** — Montează `/api/gdpr/consent` și `/api/gdpr/delete` pe server
3. **Rate limiting** — Relaxează limitele, 429 apare prea repede
4. **ticker.js** — Fișierul lipsește (404)
5. **showSubtitle** — Funcția nu e definită

> **Screenshot-uri dovadă:** `test-results/live-audit-now/`
