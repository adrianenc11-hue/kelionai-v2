# Ghid Deploy KelionAI - Pas cu Pas

## 🎯 Ce vom face
1. Deploy frontend (deja făcut) ✅
2. Deploy backend pe Render (gratuit)
3. Conectare frontend cu backend

---

## 📋 PASUL 1: Pregătire Repository GitHub

### 1.1 Creare cont GitHub (dacă nu ai)
- Intră pe https://github.com
- Click "Sign up"
- Completează cu email, parolă, username
- Verifică email-ul

### 1.2 Creare repository nou
1. Loghează-te în GitHub
2. Click pe "+" (sus dreapta) → "New repository"
3. Numele: `kelionai-v2`
4. Selectează "Public"
5. Click "Create repository"

### 1.3 Upload codul (2 variante)

#### Varianta A - Direct pe site (cea mai ușoară):
1. În repository-ul nou creat, click pe "uploading an existing file"
2. Selectează toate fișierele din folderul `kelionai-v2`
3. Click "Commit changes"

#### Varianta B - Cu Git (pentru cei care știu):
```bash
cd /tmp/kelionai-v2
git remote add origin https://github.com/USERNAME/kelionai-v2.git
git push -u origin master
```

---

## 🚀 PASUL 2: Deploy Backend pe Render

### 2.1 Creare cont Render
1. Intră pe https://render.com
2. Click "Get Started for Free"
3. Alege "Sign up with GitHub"
4. Autorizează Render să acceseze GitHub

### 2.2 Deploy aplicația
1. În dashboard Render, click "New +"
2. Selectează "Web Service"
3. Alege repository-ul `kelionai-v2` din listă
4. Completează:
   - **Name**: `kelionai-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server/index.js`
   - **Plan**: Free
5. Click "Create Web Service"

### 2.3 Adăugare variabile de mediu (Environment Variables)
În pagina aplicației, click pe "Environment":

Adaugă aceste variabile:

```
NODE_ENV = production
PORT = 10000
SUPABASE_URL = https://xxx.supabase.co
SUPABASE_ANON_KEY = eyJ...
SUPABASE_SERVICE_KEY = eyJ...
SESSION_SECRET = (generează cu: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
OPENAI_API_KEY = sk-... (opțional)
GOOGLE_AI_KEY = ... (opțional)
GROQ_API_KEY = gsk-... (opțional)
```

**Cum obții cheile:**
- **Supabase**: https://supabase.com → New Project → Settings → API
- **OpenAI**: https://platform.openai.com/api-keys
- **Google AI**: https://aistudio.google.com/app/apikey
- **Groq**: https://console.groq.com/keys

### 2.4 Așteaptă deploy-ul
- Render va face deploy automat (durează ~2-3 minute)
- Vei vedea URL-ul în dashboard (ex: `https://kelionai-backend.onrender.com`)

---

## 🔗 PASUL 3: Conectare Frontend cu Backend

### 3.1 Update frontend cu URL backend
1. În codul frontend (app/js/client-config.js sau similar)
2. Caută `API_URL` sau `BACKEND_URL`
3. Înlocuiește cu URL-ul de la Render

### 3.2 Redeploy frontend
1. Fă commit cu modificările
2. Push pe GitHub
3. Render va redeploy automat (dacă ai auto-deploy activat)

---

## ✅ Verificare

Testează aplicația:
1. Deschide URL-ul frontend
2. Încearcă să trimiți un mesaj în chat
3. Verifică dacă primești răspuns de la AI

---

## 🆘 Dacă nu funcționează

### Problemă: "Cannot connect to backend"
**Soluție**: Verifică CORS în server/index.js - adaugă URL-ul frontend în allowedOrigins

### Problemă: "Database connection failed"
**Soluție**: Verifică variabilele SUPABASE_URL și cheile

### Problemă: "AI not responding"
**Soluție**: Adaugă cel puțin un API key (OpenAI, Google sau Groq)

---

## 📞 Suport

Dacă ai probleme, trimite-mi:
1. URL-ul aplicației
2. Mesajul de eroare exact
3. Ce pas nu merge

O să te ajut să rezolvăm! 🚀
