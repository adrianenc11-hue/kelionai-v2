# Audit dependențe (live)

**Data:** 2026-04-15  
**Mediu local la generare:** Node.js v24.14.1, npm 11.11.0  

Acest fișier rezultă din curățarea dependențelor nefolosite și din rularea `npm audit` pe arborii **producție** (`--omit=dev`) și **compleți** (inclusiv devDependencies), pentru ambele pachete: rădăcină (frontend) și `server/`.

---

## Dependențe eliminate (dead code)

| Pachet | Unde | Motiv |
|--------|------|--------|
| `puppeteer` | rădăcină | Nu era importat nicăieri în surse. |
| `@stripe/stripe-js` | rădăcină | Nu era folosit; checkout-ul Stripe e făcut server-side (redirect URL). La integrarea viitoare cu Stripe.js în browser, poți readăuga pachetul. |
| `express-session` | `server/` | Nu există `express.session()` în cod; autentificarea web folosește JWT în cookie HttpOnly. |
| `better-sqlite3-session-store` | `server/` | Depindea de sesiuni Express; nefolosit. |

---

## Rezultate `npm audit` (după curățare)

### Frontend (director rădăcină)

- `npm audit --omit=dev` → **0 vulnerabilities**
- `npm audit` → **0 vulnerabilities**

### Backend (`server/`)

- `npm audit --omit=dev` → **0 vulnerabilities**
- `npm audit` → **0 vulnerabilities**

---

## Verificări efectuate

- `npm install` în rădăcină și în `server/` (lockfile-uri actualizate).
- `npm test` în `server/` — toate suitele au trecut.
- `npm run build` (Vite) — build reușit.

---

## Notă

`npm audit` reflectă baza de date de vulnerabilități npm la momentul rulării; pentru producție, rerulează periodic `npm audit` și actualizează dependențele conform politicii proiectului.
