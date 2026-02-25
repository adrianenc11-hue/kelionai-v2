# KelionAI v2.3 — Deploy Guide

## Pre-Deploy Checklist

### 1. Supabase Database
- [ ] Rulează `server/schema-full.sql` în Supabase SQL Editor
- [ ] Verifică tabelele: conversations, messages, user_preferences, subscriptions, usage, referrals, brain_learnings

### 2. Stripe Setup
- [ ] Creează cont Stripe: https://dashboard.stripe.com
- [ ] Creează 2 produse cu prețuri recurente:
  - **Pro**: €9.99/lună → copiază Price ID (price_xxx)
  - **Premium**: €19.99/lună → copiază Price ID (price_xxx)
- [ ] Setează Webhook endpoint: `https://kelionai.app/api/payments/webhook`
  - Evenimente: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
  - Copiază Webhook Secret (whsec_xxx)
- [ ] Activează Billing Portal: https://dashboard.stripe.com/settings/billing/portal

### 3. Domeniu
- [ ] Cumpără `kelionai.app` (Namecheap / Cloudflare)
- [ ] Configurează DNS → Railway custom domain

### 4. Railway Environment Variables
Project: "just-communication" → kelionai-v2 service → Variables tab

```
# AI
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
DEEPSEEK_API_KEY=sk-xxx

# Voice
ELEVENLABS_API_KEY=xxx

# Search
PERPLEXITY_API_KEY=pplx-xxx
TAVILY_API_KEY=tvly-xxx
SERPER_API_KEY=xxx

# Images
TOGETHER_API_KEY=xxx

# Database
SUPABASE_URL=https://nqlobybfwmtkmsqadqqr.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx

# Payments (NEW v2.3)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_PREMIUM=price_xxx

# App
APP_URL=https://kelionai.app
NODE_ENV=production
PORT=3000
```

### 5. Git Push & Deploy
```bash
git add -A
git commit -m "v2.3: Payments + Legal + GDPR + Schema"
git push origin master
```
Railway auto-deploys on push to master.

### 6. Post-Deploy Verification
- [ ] `https://kelionai.app/api/health` → all services green
- [ ] `https://kelionai.app/api/payments/plans` → shows 3 plans
- [ ] `https://kelionai.app/api/legal/terms` → returns terms
- [ ] `https://kelionai.app/api/legal/privacy` → returns privacy policy
- [ ] Test Stripe checkout flow with test card: 4242 4242 4242 4242
- [ ] Test webhook: `stripe listen --forward-to localhost:3000/api/payments/webhook`

## API Endpoints (v2.3 new)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/payments/plans | List plans & prices |
| GET | /api/payments/status | User plan + usage |
| POST | /api/payments/checkout | Create Stripe checkout |
| POST | /api/payments/portal | Stripe billing portal |
| POST | /api/payments/webhook | Stripe webhook handler |
| POST | /api/payments/referral | Generate referral code |
| POST | /api/payments/redeem | Redeem referral code |
| GET | /api/legal/terms | Terms of Service |
| GET | /api/legal/privacy | Privacy Policy |
| GET | /api/legal/gdpr/export | Export all user data |
| DELETE | /api/legal/gdpr/delete | Delete all user data |
| GET | /api/legal/gdpr/consent | Get consent status |
| POST | /api/legal/gdpr/consent | Update consent |
