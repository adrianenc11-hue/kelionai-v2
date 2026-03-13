# 📋 AUDIT FIZIC INTEGRAL — KelionAI v2.5

> **Data**: 2026-03-05  
> **Regulă**: ❌ = NEVERIFICAT. Se marchează ✅ DOAR după testare fizică LIVE + confirmare utilizator.  
> **Sursă**: Fiecare rând = funcție/endpoint REAL din cod sursă (`server/`). Zero fake.

---

## Legendă Coloane

| Coloană | Sens |
|---------|------|
| **V.Fizic** | Verificat fizic, testat live |
| **Supa** | Folosește Supabase (DB/Auth) |
| **Brain** | Implică Brain/AI logic |
| **Chat** | Se poate apela din chat |
| **Media** | Legat de media (imagini/audio/video) |
| **Mess** | Messenger Facebook |
| **WA** | WhatsApp |
| **Trad** | Trading |
| **Admin** | Funcție admin-only |
| **Abon** | Legat de abonamente/plăți |

---

## 1. AUTENTIFICARE — `routes/auth.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 1 | Register | `POST /api/auth/register` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 2 | Login | `POST /api/auth/login` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 3 | Logout | `POST /api/auth/logout` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 4 | User Profile | `GET /api/auth/me` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 5 | Refresh Token | `POST /api/auth/refresh` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 6 | Forgot Password | `POST /api/auth/forgot-password` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 7 | Reset Password | `POST /api/auth/reset-password` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 8 | Change Password | `POST /api/auth/change-password` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 9 | Change Email | `POST /api/auth/change-email` | ❌ | ❌ | - | - | - | - | - | - | - | - |

---

## 2. CHAT & BRAIN — `routes/chat.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 10 | Chat Text → AI | `POST /api/chat` | ❌ | ❌ | ❌ | ❌ | - | - | - | - | - | ❌ |
| 11 | Chat Streaming SSE | `POST /api/chat/stream` | ❌ | ❌ | ❌ | ❌ | - | - | - | - | - | ❌ |

---

## 3. VOCE — `routes/voice.js` + `routes/voice-clone.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 12 | TTS (Speak) | `POST /api/speak` | ❌ | ❌ | - | ❌ | ❌ | - | - | - | - | ❌ |
| 13 | STT (Listen) | `POST /api/listen` | ❌ | ❌ | - | ❌ | ❌ | - | - | - | - | ❌ |
| 14 | Voice Clone — Create | `POST /api/voice/clone` | ❌ | ❌ | - | - | ❌ | - | - | - | - | - |
| 15 | Voice Clone — Delete | `DELETE /api/voice/clone` | ❌ | ❌ | - | - | ❌ | - | - | - | - | - |
| 16 | Voice Clone — Status | `GET /api/voice/clone` | ❌ | ❌ | - | - | - | - | - | - | - | - |

---

## 4. VIZIUNE — `routes/vision.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 17 | Vision Analysis | `POST /api/vision` | ❌ | ❌ | ❌ | ❌ | ❌ | - | - | - | - | ❌ |

---

## 5. GENERARE IMAGINI — `routes/images.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 18 | Image Gen (FLUX) | `POST /api/imagine` | ❌ | ❌ | - | ❌ | ❌ | - | - | - | - | ❌ |

---

## 6. CĂUTARE WEB — `routes/search.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 19 | Web Search (4-engine cascade) | `POST /api/search` | ❌ | ❌ | - | ❌ | - | - | - | - | - | ❌ |

---

## 7. METEO — `routes/weather.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 20 | Weather | `POST /api/weather` | ❌ | - | - | ❌ | - | - | - | - | - | - |

---

## 8. IDENTITATE (Face ID) — `routes/identity.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 21 | Register Face | `POST /api/identity/register-face` | ❌ | ❌ | - | - | ❌ | - | - | - | - | - |
| 22 | Face Check | `POST /api/identity/check` | ❌ | ❌ | ❌ | - | ❌ | - | - | - | - | - |

---

## 9. PLĂȚI & ABONAMENTE — `payments.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 23 | Plans List | `GET /api/payments/plans` | ❌ | - | - | - | - | - | - | - | - | ❌ |
| 24 | Plan Status | `GET /api/payments/status` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 25 | Checkout (Pro €9.99) | `POST /api/payments/checkout` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 26 | Checkout (Premium €19.99) | `POST /api/payments/checkout` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 27 | Billing Portal | `POST /api/payments/portal` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 28 | Stripe Webhook | `POST /api/payments/webhook` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 29 | Usage Check (checkUsage) | Funcție internă | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 30 | Usage Increment | Funcție internă | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |

> **⚠️ LIPSESC DIN COD**: Annual Plans, Family Promotion, Enterprise (alias pt Premium)

---

## 10. REFERRAL — `referral.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 31 | Generate Code (HMAC) | `POST /api/referral/generate` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 32 | Send Invite Email | `POST /api/referral/send-invite` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 33 | Verify Code | `POST /api/referral/verify` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 34 | Redeem Code | `POST /api/referral/redeem` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 35 | My Codes | `GET /api/referral/my-codes` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 36 | My Bonuses | `GET /api/referral/my-bonuses` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 37 | Revoke Code | `DELETE /api/referral/revoke/:id` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 38 | Apply Bonus (intern) | Funcție internă | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |

---

## 11. TRADING — `trading.js` + `trade-executor.js` + `trade-intelligence.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 39 | Trading Status | `GET /api/trading/status` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 40 | Full Analysis | `GET /api/trading/analysis` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 41 | Trading Signals | `GET /api/trading/signals` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 42 | Portfolio | `GET /api/trading/portfolio` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 43 | Backtest | `POST /api/trading/backtest` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 44 | Alerts | `GET /api/trading/alerts` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 45 | Correlation Matrix | `GET /api/trading/correlation` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 46 | Risk Analysis | `GET /api/trading/risk` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 47 | History | `GET /api/trading/history` | ❌ | - | - | - | - | - | - | ❌ | ❌ | - |
| 48 | Execute Trade | `POST /api/trading/execute` | ❌ | - | ❌ | ❌ | - | - | - | ❌ | ❌ | - |
| 49 | RSI Calc | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 50 | MACD Calc | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 51 | Bollinger Bands | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 52 | EMA Crossover | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 53 | Fibonacci Levels | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 54 | Volume/VWAP | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 55 | Sentiment Analysis | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 56 | Confluence Score | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |
| 57 | Real Price Fetch (CoinGecko) | Funcție internă | ❌ | - | - | - | - | - | - | ❌ | - | - |

> **Notă**: Trading = Admin-only. Paper trading only (nu live).

---

## 12. MESSENGER FACEBOOK — `messenger.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 58 | Webhook Verify | `GET /api/messenger/webhook` | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 59 | Webhook Handler | `POST /api/messenger/webhook` | ❌ | ❌ | ❌ | - | - | ❌ | - | - | - | - |
| 60 | Send Text Message | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 61 | Send Audio Message | Funcție internă | ❌ | - | - | - | ❌ | ❌ | - | - | - | - |
| 62 | Send Image Message | Funcție internă | ❌ | - | - | - | ❌ | ❌ | - | - | - | - |
| 63 | Send Generic Template | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 64 | Voice Reply (TTS) | Funcție internă | ❌ | - | - | - | ❌ | ❌ | - | - | - | - |
| 65 | Image Analysis | Funcție internă | ❌ | - | ❌ | - | ❌ | ❌ | - | - | - | - |
| 66 | Audio Transcribe | Funcție internă | ❌ | - | - | - | ❌ | ❌ | - | - | - | - |
| 67 | Document Extract | Funcție internă | ❌ | - | - | - | ❌ | ❌ | - | - | - | - |
| 68 | Persistent Menu | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 69 | Postback Handler | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 70 | Broadcast News | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 71 | Messenger Stats | `GET /api/messenger/stats` | ❌ | - | - | - | - | ❌ | - | - | ❌ | - |
| 72 | Context/History | Funcție internă | ❌ | ❌ | - | - | - | ❌ | - | - | - | - |
| 73 | Language Detection | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 74 | Rate Limiting | Funcție internă | ❌ | - | - | - | - | ❌ | - | - | - | - |
| 75 | Known User Tracking | Funcție internă | ❌ | ❌ | - | - | - | ❌ | - | - | - | - |

---

## 13. WHATSAPP — `whatsapp.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 76 | Webhook Verify | `GET /api/whatsapp/webhook` | ❌ | - | - | - | - | - | ❌ | - | - | - |
| 77 | Webhook Handler | `POST /api/whatsapp/webhook` | ❌ | ❌ | ❌ | - | - | - | ❌ | - | - | - |
| 78 | Send Text | Funcție internă | ❌ | - | - | - | - | - | ❌ | - | - | - |
| 79 | Send Audio | Funcție internă | ❌ | - | - | - | ❌ | - | ❌ | - | - | - |
| 80 | Download Media | Funcție internă | ❌ | - | - | - | ❌ | - | ❌ | - | - | - |
| 81 | Upload Media | Funcție internă | ❌ | - | - | - | ❌ | - | ❌ | - | - | - |
| 82 | Transcribe Audio | Funcție internă | ❌ | - | - | - | ❌ | - | ❌ | - | - | - |
| 83 | Generate Speech | Funcție internă | ❌ | - | - | - | ❌ | - | ❌ | - | - | - |
| 84 | Group Intervention | Funcție internă | ❌ | - | - | - | - | - | ❌ | - | - | - |
| 85 | Context/History | Funcție internă | ❌ | ❌ | - | - | - | - | ❌ | - | - | - |
| 86 | Known User Tracking | Funcție internă | ❌ | ❌ | - | - | - | - | ❌ | - | - | - |
| 87 | Language Detection | Funcție internă | ❌ | - | - | - | - | - | ❌ | - | - | - |
| 88 | Rate Limiting | Funcție internă | ❌ | - | - | - | - | - | ❌ | - | - | - |

> **⚠️ LIPSEȘTE**: endpoint standalone `POST /api/whatsapp/send` (rută inexistentă în cod)

---

## 14. TELEGRAM — `telegram.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 89 | Webhook Handler | `POST /api/telegram/webhook` | ❌ | ❌ | ❌ | - | - | - | - | - | - | - |
| 90 | /start Command | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 91 | /help Command | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 92 | /banc Command | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 93 | /stiri Command | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 94 | /breaking Command | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 95 | Broadcast to Channel | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 96 | FAQ Fallback | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 97 | Known User Tracking | Funcție internă | ❌ | ❌ | - | - | - | - | - | - | - | - |

---

## 15. INSTAGRAM — `instagram.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 98 | Webhook Verify | `GET /api/instagram/webhook` | ❌ | - | - | - | - | - | - | - | - | - |
| 99 | Webhook Handler (DM) | `POST /api/instagram/webhook` | ❌ | ❌ | ❌ | - | - | - | - | - | - | - |
| 100 | Handle DM | Funcție internă | ❌ | - | ❌ | - | - | - | - | - | - | - |
| 101 | Send DM | Funcție internă | ❌ | - | - | - | - | - | - | - | - | - |
| 102 | Create Media Container | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 103 | Publish Media | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 104 | Post News | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 105 | Publish News Batch | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | ❌ | - |

> **⚠️ INACTIV**: Necesită `INSTAGRAM_ACCOUNT_ID` și `INSTAGRAM_TOKEN` (lipsesc env vars)

---

## 16. NEWS / MEDIA — `news.js` + `facebook-page.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 106 | News Latest | `GET /api/news/latest` | ❌ | - | - | - | ❌ | - | - | - | ❌ | - |
| 107 | News Status | `GET /api/news/status` | ❌ | - | - | - | ❌ | - | - | - | ❌ | - |
| 108 | News Fetch Manual | `GET /api/news/fetch` | ❌ | ❌ | - | - | ❌ | - | - | - | ❌ | - |
| 109 | News Public | `GET /api/news/public` | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 110 | News Scheduler | Funcție internă | ❌ | ❌ | - | - | ❌ | - | - | - | - | - |
| 111 | RSS Fetch (8 surse RO) | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 112 | Anti-Fake-News Filter | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 113 | Breaking News Detection | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | - | - |
| 114 | Facebook Page Publish | Funcție internă | ❌ | - | - | - | ❌ | - | - | - | ❌ | - |
| 115 | Media Auto-Publish | `POST /api/news/publish` | ❌ | - | - | - | ❌ | ❌ | - | - | ❌ | - |
| 116 | Media Status | `GET /api/media/status` | ❌ | - | - | - | ❌ | - | - | - | ❌ | - |

---

## 17. DEVELOPER API — `routes/developer.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 117 | List API Keys | `GET /api/developer/keys` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 118 | Create API Key | `POST /api/developer/keys` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 119 | Revoke API Key | `DELETE /api/developer/keys/:id` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 120 | Dev Stats | `GET /api/developer/stats` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 121 | Save Webhook | `POST /api/developer/webhooks` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 122 | Get Webhook | `GET /api/developer/webhooks` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 123 | v1 Status | `GET /api/v1/status` | ❌ | - | - | - | - | - | - | - | - | - |
| 124 | v1 Models | `GET /api/v1/models` | ❌ | - | - | - | - | - | - | - | - | - |
| 125 | v1 User Profile | `GET /api/v1/user/profile` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 126 | v1 Chat | `POST /api/v1/chat` | ❌ | - | ❌ | ❌ | - | - | - | - | - | - |

---

## 18. ADMIN — `routes/admin.js` + `index.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 127 | Verify Admin Code | `POST /api/admin/verify-code` | ❌ | - | - | - | - | - | - | - | ❌ | - |
| 128 | Brain Diagnostics | `GET /api/brain` | ❌ | - | ❌ | - | - | - | - | - | ❌ | - |
| 129 | Brain Reset | `POST /api/brain/reset` | ❌ | - | ❌ | - | - | - | - | - | ❌ | - |
| 130 | Health Check Full | `GET /api/admin/health-check` | ❌ | ❌ | ❌ | - | - | - | - | - | ❌ | ❌ |
| 131 | Payment Admin Stats | `GET /api/payments/admin/stats` | ❌ | ❌ | - | - | - | - | - | - | ❌ | ❌ |

---

## 19. HEALTH & INFRA — `routes/health.js` + `index.js`

| # | Funcție | Endpoint | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|----------|---------|------|-------|------|-------|------|----|------|-------|------|
| 132 | Health Endpoint | `GET /api/health` | ❌ | ❌ | ❌ | - | - | - | - | - | - | - |
| 133 | Cookie Consent | `POST /api/cookie-consent` | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 134 | Ticker Disable | `POST /api/ticker/disable` | ❌ | ❌ | - | - | - | - | - | - | - | ❌ |
| 135 | Legal Pages | `/api/legal/*` | ❌ | - | - | - | - | - | - | - | - | - |
| 136 | HTTPS Force Redirect | Middleware | ❌ | - | - | - | - | - | - | - | - | - |
| 137 | CSP Nonce Injection | Middleware | ❌ | - | - | - | - | - | - | - | - | - |
| 138 | Rate Limiting Global | Middleware | ❌ | - | - | - | - | - | - | - | - | - |
| 139 | SPA Whitelist Routing | Middleware | ❌ | - | - | - | - | - | - | - | - | - |
| 140 | Supabase RLS | DB Config | ❌ | ❌ | - | - | - | - | - | - | - | - |
| 141 | Metrics Middleware | Middleware | ❌ | - | - | - | - | - | - | - | - | - |

---

## 20. BRAIN INTERN — `brain.js` + `persona.js`

| # | Funcție | Module | V.Fizic | Supa | Brain | Chat | Media | Mess | WA | Trad | Admin | Abon |
|---|--------|--------|---------|------|-------|------|-------|------|----|------|-------|------|
| 142 | Brain.think() | `brain.js` | ❌ | ❌ | ❌ | ❌ | - | - | - | - | - | - |
| 143 | Brain.getDiagnostics() | `brain.js` | ❌ | - | ❌ | - | - | - | - | - | ❌ | - |
| 144 | Brain.learnFromConversation() | `brain.js` | ❌ | ❌ | ❌ | ❌ | - | - | - | - | - | - |
| 145 | Brain.resetTool() | `brain.js` | ❌ | - | ❌ | - | - | - | - | - | ❌ | - |
| 146 | Brain.resetAll() | `brain.js` | ❌ | - | ❌ | - | - | - | - | - | ❌ | - |
| 147 | Persona buildSystemPrompt() | `persona.js` | ❌ | - | ❌ | ❌ | - | - | - | - | - | - |
| 148 | Multi-Engine Cascade | `brain.js` | ❌ | - | ❌ | ❌ | - | - | - | - | - | - |

---

## SUMAR TOTAL

| Categorie | Funcții Reale |
|-----------|:---:|
| Auth | 9 |
| Chat & Brain | 2 |
| Voce | 5 |
| Viziune | 1 |
| Imagini | 1 |
| Căutare | 1 |
| Meteo | 1 |
| Identitate | 2 |
| Plăți & Abonamente | 8 |
| Referral | 8 |
| Trading | 19 |
| Messenger FB | 18 |
| WhatsApp | 13 |
| Telegram | 9 |
| Instagram | 8 |
| News / Media | 11 |
| Developer API | 10 |
| Admin | 5 |
| Health & Infra | 10 |
| Brain Intern | 7 |
| **TOTAL** | **148** |

---

## ⚠️ FUNCȚII LIPSĂ DIN COD (documentate dar inexistente)

| Funcție | Status |
|---------|--------|
| Annual Plans (Stripe) | ❌ Nu există cod |
| Family Promotion | ❌ Nu există cod |
| Enterprise Tier (distinct) | ⚠️ Alias pt Premium |
| WhatsApp Send standalone | ❌ Rută inexistentă |
| Service Worker (sw.js) | ❌ Fișier inexistent |
| GPS Localization (brain) | ⚠️ Doar `getCurrentPosition` browser, fără integrare brain |

---

> **Acest tabel = SURSĂ DE ADEVĂR. Se lucrează DOAR după el.**  
> **Marchează ✅ NUMAI după test fizic live + confirmare.**
