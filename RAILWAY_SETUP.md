# 🚀 RAILWAY DEPLOYMENT GUIDE - kelionai.app

## ✅ Status: READY FOR DEPLOYMENT

---

## 📋 STEP 1: Add Environment Variables in Railway

Go to **Railway Dashboard** → Your Project → **Variables**

Add these variables:

### Application
```
NODE_ENV=production
PORT=8080
DB_PATH=/app/server/data/kelion.db
```

### URLs
```
APP_BASE_URL=https://kelionai.app
API_BASE_URL=https://kelionai.app
CORS_ORIGINS=https://kelionai.app,https://kelionai-v2-production.up.railway.app
COOKIE_DOMAIN=kelionai.app
```

### Secrets
```
SESSION_SECRET=<generate-random-32-char-string>
JWT_SECRET=<generate-random-32-char-string>
```

### AI Services
```
OPENAI_API_KEY=<your-openai-key>
ELEVENLABS_API_KEY=<your-elevenlabs-key>
```

### Google OAuth
```
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_REDIRECT_URI=https://kelionai.app/auth/google/callback
```

### Stripe (Optional)
```
STRIPE_PUBLISHABLE_KEY=<your-stripe-key>
STRIPE_SECRET_KEY=<your-stripe-secret>
STRIPE_WEBHOOK_SECRET=<your-webhook-secret>
```

---

## 🌐 STEP 2: Configure Custom Domain

1. Railway Dashboard → Settings → Domains
2. Add: `kelionai.app`
3. Configure DNS at your provider:
   - A record: `@` → Railway IP
   - CNAME: `www` → `kelionai.app`

---

## 💾 STEP 2b: Attach Persistent Volume (REQUIRED)

Without a volume, the SQLite DB is recreated on every deploy.

1. Railway Dashboard → Service → **Volumes** → **New Volume**
2. **Mount Path:** `/app/server/data`
3. **Size:** 1 GB is plenty for tens of thousands of users
4. Redeploy once and confirm `GET /api/diag/db-path` returns
   `looksPersistent: true` and that `fileMtime` stays constant across
   redeploys (not reset to deploy time).

---

## 🔐 STEP 3: Google OAuth Setup

Google Cloud Console → Credentials:
- Add redirect URI: `https://kelionai.app/auth/google/callback`

---

## ✅ STEP 4: Verify

```bash
curl https://kelionai.app/health
```

Expected:
```json
{
  "status": "ok",
  "services": {
    "database": "connected",
    "openai": "configured",
    "elevenlabs": "configured"
  }
}
```

---

**Deploy complete!** 🎉
