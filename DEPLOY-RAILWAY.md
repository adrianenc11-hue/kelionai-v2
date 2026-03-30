# 🚀 Deploy KelionAI pe Railway.app

## Pași rapizi (5 minute)

### 1. Creează cont Railway
- Mergi la [railway.app](https://railway.app) → Sign up cu GitHub

### 2. Creează proiect nou
- **New Project** → **Deploy from GitHub repo**
- Selectează repo-ul `kelionai-v2`
- Railway detectează automat Node.js

### 3. Adaugă PostgreSQL (dacă nu folosești Supabase)
- În proiect → **+ New** → **Database** → **PostgreSQL**
- `DATABASE_URL` se setează automat

### 4. Configurează variabilele de mediu
În Railway → proiect → **Variables** → adaugă:

#### 🔴 OBLIGATORII
| Variabilă | Valoare |
|---|---|
| `SUPABASE_URL` | Din supabase.com → Settings → API |
| `SUPABASE_ANON_KEY` | Din supabase.com → Settings → API |
| `SUPABASE_SERVICE_KEY` | Din supabase.com → Settings → API (service_role) |
| `SESSION_SECRET` | Rulează: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ELEVENLABS_API_KEY` | Din elevenlabs.io |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://YOUR-APP.up.railway.app` (după primul deploy) |

#### 🟡 RECOMANDATE
| Variabilă | Valoare |
|---|---|
| `GOOGLE_AI_KEY` | Din aistudio.google.com |
| `OPENAI_API_KEY` | Din platform.openai.com |
| `ANTHROPIC_API_KEY` | Din console.anthropic.com |
| `GROQ_API_KEY` | Din console.groq.com |
| `STRIPE_SECRET_KEY` | Din dashboard.stripe.com |
| `STRIPE_WEBHOOK_SECRET` | Din Stripe → Webhooks |
| `ADMIN_EMAIL` | Email-ul tău de admin |
| `ADMIN_SECRET_KEY` | Orice string secret |

### 5. Deploy
- Railway face deploy automat la fiecare `git push`
- Primul deploy: click **Deploy** în dashboard

### 6. Rulează migrările DB
După primul deploy, în Railway → proiect → **Shell**:
```bash
node server/migrate.js
```

### 7. Setează Stripe Webhook
- Stripe Dashboard → Webhooks → Add endpoint
- URL: `https://YOUR-APP.up.railway.app/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`

### 8. Setează APP_URL corect
- Copiază URL-ul din Railway (ex: `https://kelionai-production.up.railway.app`)
- Actualizează variabila `APP_URL` în Railway Variables

---

## ✅ Checklist pre-deploy

- [ ] `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY` setate
- [ ] `SESSION_SECRET` generat (32 bytes hex)
- [ ] `ELEVENLABS_API_KEY` setat
- [ ] Cel puțin un AI key setat (`GOOGLE_AI_KEY` sau `OPENAI_API_KEY`)
- [ ] `NODE_ENV=production`
- [ ] `APP_URL` setat după primul deploy
- [ ] Migrările DB rulate: `node server/migrate.js`

---

## 🔧 Comenzi utile Railway CLI

```bash
# Instalare Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link proiect
railway link

# Deploy manual
railway up

# Logs live
railway logs

# Shell în container
railway shell

# Rulează migrări
railway run node server/migrate.js
```

---

## 🌐 Domeniu custom

Railway → proiect → **Settings** → **Domains** → **Custom Domain**
- Adaugă `yourdomain.com`
- Configurează DNS: CNAME → `YOUR-APP.up.railway.app`
- Actualizează `APP_URL` cu noul domeniu

---

## 📊 Monitorizare

- **Logs**: Railway Dashboard → Deployments → View Logs
- **Metrics**: Railway Dashboard → Metrics (CPU, RAM, Network)
- **Alerts**: Admin Panel → `/admin` → Alerts & Notifications