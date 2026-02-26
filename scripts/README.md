# Scripts — KelionAI Railway Setup

Scripturi pentru configurarea automată a variabilelor de environment în Railway.

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
