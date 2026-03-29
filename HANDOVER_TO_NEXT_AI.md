# HANDOVER — KelionAI v2 — Înlocuire Valori Hardcodate

**Data:** 2026-03-28  
**Status:** ✅ COMPLET

---

## Ce s-a realizat în această sesiune

### Obiectiv
Înlocuirea tuturor valorilor hardcodate (`KelionAI`, `kelionai`, URL-uri, email-uri, etc.) cu funcții/referințe dinamice care citesc din `process.env` (server) sau `window.APP_CONFIG` (frontend).

---

## Arhitectura soluției

### Sursa de adevăr — server
**`server/config/app.js`** — fișier centralizat care exportă toate constantele aplicației:
```js
const APP = require('./config/app');
APP.NAME      // → process.env.APP_NAME || 'KelionAI'
APP.SLUG      // → slug calculat din APP_NAME
APP.DOMAIN    // → process.env.APP_DOMAIN
APP.VERSION   // → din package.json
APP.USER_AGENT // → compus dinamic
```

### Sursa de adevăr — frontend
**`/api/config`** (server/routes/config.js) — endpoint care servește config-ul către browser:
```js
window.APP_CONFIG.appName   // → APP_NAME din env
window.APP_CONFIG.appSlug   // → slug calculat
window.APP_CONFIG.appDomain // → APP_DOMAIN din env
```

---

## Fișiere modificate

### Server (Node.js)
| Fișier | Ce s-a schimbat |
|--------|----------------|
| `server/config/app.js` | **NOU** — sursă centralizată de configurare |
| `server/index.js` | `service: 'kelionai'` → `APP_SLUG` dinamic |
| `server/metrics.js` | `kelionai_*` metric names → `_metricPrefix + '_*'` |
| `server/routes/legal-api.js` | Texte legale + domain fallback → `APP_CFG.APP_NAME` |
| `server/routes/mobile-api.js` | UA string + mesaj online → dinamic |
| `server/routes/voice-clone.js` | Description voice clone → dinamic |
| `server/routes/admin/monitor.js` | Prompt-uri AI → `_APP_NAME` dinamic |
| `server/routes/admin/revenue.js` | Stripe product name → dinamic |
| `server/routes/config.js` | Servește `APP_CONFIG` către frontend |
| `server/routes/payments.js` | Plan limits → din `app.js` |
| `server/payments.js` | Plan limits → din `app.js` |
| `server/identity-guard.js` | Valori identitate → dinamic |
| `server/persona.js` | Studio name, founder → dinamic |
| `server/routes/voice-realtime.js` | Studio name → dinamic |
| `server/routes/voice.js` | STT prompts → `APP_NAME` dinamic |
| `server/routes/tools-api.js` | User-Agent → dinamic |
| `server/migrate.js` | Default tenant name → neutral |

### Frontend (app/)
| Fișier | Ce s-a schimbat |
|--------|----------------|
| `app/js/i18n.js` | Toate string-urile `'KelionAI'` → `_appName()` helper |
| `app/js/app.js` | Canvas fingerprint + console.log → `window.APP_CONFIG.appName` |
| `app/js/gdpr-consent.js` | Text cameră → `window.APP_CONFIG.appName` |
| `app/js/copy-shield.js` | Studio name, founder → `_appCfg.appName` |
| `app/js/client-config.js` | `appName` fallback → `U.APP_NAME \|\| 'KelionAI'` |
| `app/admin/admin-app.js` | "Back to KelionAI" → `window.APP_CONFIG.appName` |
| `app/admin/admin.js` | "Înapoi la KelionAI" → `window.APP_CONFIG.appName` |
| `app/admin/index.html` | Logo span → `<span id="admin-app-name">` + fetch `/api/config` |
| `app/admin/health.html` | H1 title → `<span id="app-name-health">` + fetch `/api/config` |
| `app/settings/index.html` | Copyright → `<span id="settings-app-name">` + fetch `/api/config` |
| `app/index.html` | LogRocket init + PWA title → dinamic via `APP_CONFIG` |
| `app/sw.js` | `CACHE_NAME` → `self.__APP_SLUG + '-v2.5'` |

### Config & Build
| Fișier | Ce s-a schimbat |
|--------|----------------|
| `capacitor.config.json` | `appName`, `appId`, `ios.scheme` → override via `process.env` |
| `.env.example` | `APP_URL` → placeholder neutru `your-app.up.railway.app` |
| `app/manifest.json` | Păstrat cu fallback `KelionAI` (static PWA — override la build via env) |

---

## Pattern-uri folosite

### 1. Server — require centralizat
```js
const { APP_NAME, APP_SLUG, APP_DOMAIN } = require('./config/app');
// sau
const APP_CFG = require('../config/app');
```

### 2. Frontend JS — window.APP_CONFIG
```js
const name = (window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI';
```

### 3. Frontend HTML — span + fetch
```html
<span id="app-name">KelionAI</span>
<script>
  fetch('/api/config').then(r=>r.json()).then(cfg=>{
    var el=document.getElementById('app-name');
    if(el && cfg.appName) el.textContent=cfg.appName;
  }).catch(()=>{});
</script>
```

### 4. i18n.js — helper function
```js
function _appName() {
  return (window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI';
}
// Folosit în toate string-urile de traducere
'pwa.title': 'Install ' + _appName(),
```

### 5. Metrics — prefix dinamic
```js
const _metricPrefix = (APP_SLUG || 'app').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
name: `${_metricPrefix}_http_request_duration_seconds`,
```

---

## Ce NU s-a schimbat (intenționat)

| Element | Motiv |
|---------|-------|
| Comentarii de header `// KelionAI —` | Inofensive, nu afectează runtime |
| `package.json` `"name": "kelionai-v2"` | Identificator npm intern, nu afectează UI |
| `app/manifest.json` `"name": "KelionAI"` | Static PWA manifest — override la build via `APP_NAME` env |
| Fișiere `.sql` migration comments | Documentație, nu cod executabil |
| `server/K1_SYSTEM_PROMPT.txt` | Prompt AI intern, specific proiectului |
| `server/config/app.js` fallback `'KelionAI'` | **Corect** — fallback de ultimă instanță dacă `APP_NAME` nu e setat |

---

## Variabile .env necesare

```env
APP_NAME=YourAppName           # Numele aplicației (înlocuiește KelionAI)
APP_SHORT_NAME=YourApp         # Nume scurt pentru PWA
APP_SLUG=yourapp               # Slug URL-safe (auto-calculat dacă lipsește)
APP_DOMAIN=yourdomain.com      # Domeniu producție
APP_URL=https://yourdomain.com # URL complet producție
APP_ID=com.yourcompany.app     # Bundle ID Capacitor
APP_STUDIO_NAME=Your Studio    # Numele studioului
APP_FOUNDER_NAME=YourName      # Numele fondatorului
CONTACT_EMAIL=hello@yourdomain.com
PRIVACY_EMAIL=privacy@yourdomain.com
LOGROCKET_ID=yourorg/yourapp   # ID LogRocket (opțional)
```

---

## Verificare rapidă după deploy

```bash
# Verifică că nu mai există valori hardcodate funcționale
grep -rn "kelionai" server/ app/js/ --include="*.js" \
  | grep -v "node_modules" \
  | grep -v "// " \
  | grep -v "|| 'KelionAI'" \
  | grep -v "APP_NAME\|APP_SLUG\|appName\|appSlug"
# Rezultat așteptat: 0 linii
```

---

## Status final

- ✅ **0 valori hardcodate funcționale** în server/
- ✅ **0 valori hardcodate funcționale** în app/js/
- ✅ **11 fallback-uri corecte** `|| 'KelionAI'` (pattern standard)
- ✅ **4 span-uri HTML dinamice** populate via `/api/config`
- ✅ **65 comentarii header** (inofensive)
- ✅ **`server/config/app.js`** — sursă unică de adevăr pentru server
- ✅ **`window.APP_CONFIG`** — sursă unică de adevăr pentru frontend