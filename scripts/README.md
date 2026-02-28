# Scripts — KelionAI Railway Setup

Scripturi pentru configurarea automată a variabilelor de environment în Railway.

---

## `setup-secrets.sh` — Configurare GitHub Secrets pentru CI/CD

Script interactiv care setează secretele GitHub necesare pentru workflow-ul CI/CD (Netlify deploy).

### Cerințe

- [GitHub CLI](https://cli.github.com/) instalat și autentificat (`gh auth login`)
- Acces de scriere la repo

### Rulare

```bash
npm run setup:secrets
# sau direct:
bash scripts/setup-secrets.sh
```

Scriptul va:
1. Verifica dacă `gh` CLI este instalat
2. Verifica autentificarea GitHub
3. Cere interactiv:
   - `NETLIFY_AUTH_TOKEN` — tokenul personal de la [Netlify](https://app.netlify.com/user/applications)
   - `NETLIFY_SITE_ID` — Site ID de la Netlify (Site Settings → General → Site details)
4. Opțional, setează și `SENTRY_AUTH_TOKEN`
5. Valida valorile (nu goale, fără newlines sau spații)
6. Seta secretele în GitHub cu `gh secret set`
7. Afișa un summary cu ce a fost setat
8. Opțional, re-rula workflow-ul `test.yml`

### De ce este necesar

Workflow-ul `.github/workflows/test.yml` pică cu eroarea `is not a legal HTTP header value` dacă `NETLIFY_AUTH_TOKEN` sau `NETLIFY_SITE_ID` sunt goale sau invalide.

---

## Cerințe preliminare

### 1. Instalează Railway CLI

```bash
npm i -g @railway/cli
```

### 2. Autentifică-te în Railway

```bash
railway login
```

### 3. Linkează proiectul Railway

```bash
railway link
```

Selectează organizația și proiectul tău din lista afișată.

---

## Rulare script Node.js (recomandat)

```bash
npm run railway:setup
```

Scriptul va:
1. Verifica dacă Railway CLI este instalat (și îl va instala dacă nu e)
2. Verifica autentificarea și proiectul linked
3. Citi cheile din `.env.example`
4. Prelua valorile existente din `.env` local
5. Genera automat `ADMIN_TOKEN` cu `crypto.randomBytes(32).toString('hex')`
6. Întreba interactiv pentru variabilele lipsă (Enter = sari peste)
7. Seta toate variabilele în Railway cu `railway variables set`
8. Salva valorile generate în `.env.local`
9. Afișa un sumar cu rezultatele

> **Notă:** Valorile cheilor sunt mascate în terminal (`sk-***ab`) pentru securitate.

---

## Rulare script Bash (alternativ)

```bash
npm run railway:vars
# sau direct:
bash scripts/railway-env.sh
```

Scriptul bash citește direct din `.env` local și setează toate variabilele non-goale în Railway. Generează automat `ADMIN_TOKEN` dacă lipsește.

---

## Verificare variabile setate

```bash
railway variables
```

---

## Deploy

```bash
railway up
```

---

## Fișiere generate

| Fișier | Descriere |
|--------|-----------|
| `.env` | Variabile locale (nu se commitează) |
| `.env.local` | Valori generate automat (nu se commitează) |

Ambele fișiere sunt în `.gitignore`.
