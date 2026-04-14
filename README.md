# Kelion Voice

3D avatar voice-chat application with AI-powered conversation, Google OAuth authentication, user management, subscription tiers, and an admin panel.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend (web) | React 18 + Vite, Three.js / React Three Fiber |
| Backend API | Node.js + Express |
| Authentication | Google OAuth 2.0 / OpenID Connect |
| Session (web) | `express-session` → HttpOnly cookie |
| Token (mobile) | Signed JWT (Bearer token) |
| Database | SQLite (`better-sqlite3`) |
| Deployment | Railway (API + frontend) |

---

## Features

- 🔐 **Google OAuth login** — one-click sign-in with Google
- 👥 **User management** — profiles, avatars, subscription tracking
- 💳 **Subscription tiers** — Free / Basic / Premium / Enterprise with daily usage limits
- 📊 **Admin panel** — manage users and subscriptions (admin-only)
- 💰 **Payment-ready** — Stripe integration endpoints (stubs, ready to activate)
- 🤖 **AI avatars** — Kelion & Kira, 3D voice-chat assistants

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A Google Cloud project with an OAuth 2.0 credential

---

## 1. Google Cloud Console Setup

### 1.1 Create / configure the OAuth consent screen

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **OAuth consent screen**.
2. Choose **External** (or Internal for a Workspace org).
3. Fill in the required fields:
   - **App name**: Kelion
   - **User support email**: your email
   - **Authorized domains**: `kelionai.app`
4. Add scopes: `openid`, `email`, `profile`.
5. Add test users if the app is still in **Testing** status.

### 1.2 Create OAuth 2.0 credentials

1. Go to **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**.
2. Application type: **Web application**.
3. Add the following **Authorized redirect URIs**:

   | Environment | Redirect URI |
   |-------------|-------------|
   | Production  | `https://kelionai.app/auth/google/callback` |
   | Local dev   | `http://localhost:3001/auth/google/callback` |

4. Save and note the **Client ID** and **Client Secret**.

---

## 2. Environment Variables

### Backend (`server/.env`)

Copy the template and fill in your values:

```bash
cp server/.env.example server/.env
```

| Variable | Description | Example (production) |
|----------|-------------|----------------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud | `123...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Callback URL registered in Google Cloud | `https://kelionai.app/auth/google/callback` |
| `APP_BASE_URL` | Frontend URL (used for post-auth redirects) | `https://kelionai.app` |
| `API_BASE_URL` | Backend API URL | `https://kelionai.app` |
| `SESSION_SECRET` | Long random string for session signing | `openssl rand -hex 64` |
| `JWT_SECRET` | Long random string for JWT signing (different from SESSION_SECRET) | `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | JWT TTL | `7d` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `https://kelionai.app` |
| `COOKIE_DOMAIN` | Session cookie domain | `kelionai.app` |
| `DB_PATH` | SQLite file path | `./data/kelion.db` |
| `PORT` | API server port | `3001` |
| `NODE_ENV` | `development` or `production` | `production` |
| `ADMIN_EMAILS` | Comma-separated admin email addresses | `your-admin@example.com` |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional, for payments) | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (optional) | `whsec_...` |

---

## 3. Local Development

```bash
# Install frontend dependencies
npm install --legacy-peer-deps

# Install backend dependencies
npm run server:install

# Start the backend API (in one terminal)
npm run server:dev

# Start the frontend dev server (in another terminal)
npm run dev
```

Frontend will be available at `http://localhost:5173`.  
Backend API will be available at `http://localhost:3001`.

The Vite dev server proxies `/api` and `/auth` requests to `http://localhost:3001` automatically.

---

## 4. API Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google/start` | Starts the Google OAuth flow. Pass `?mode=mobile` for mobile clients (returns JWT instead of cookie). |
| `GET` | `/auth/google/callback` | Google redirects here after login. Handles code exchange, user upsert, and session/token issuance. |
| `GET` | `/auth/me` | Returns the current user's profile. Accepts session cookie (web) or `Authorization: Bearer <token>` (mobile). |
| `POST` | `/auth/logout` | Destroys the server-side session and clears the cookie. Mobile clients should discard the JWT locally. |

### User Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/users/me` | ✅ | Get current user profile + subscription info + usage |
| `PUT` | `/api/users/me` | ✅ | Update profile (name) |

### Admin (admin-only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/users` | ✅ admin | List all users |
| `GET` | `/api/admin/users/:id` | ✅ admin | Get specific user |
| `PUT` | `/api/admin/users/:id/subscription` | ✅ admin | Update user subscription tier/status |

### Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/subscription/plans` | Public | List all available subscription plans with pricing |

### Payments (Stripe-ready stubs)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/payments/create-checkout-session` | ✅ | Create Stripe checkout session (returns 503 until Stripe is configured) |
| `POST` | `/api/payments/webhook` | Public | Stripe webhook handler |
| `GET` | `/api/payments/history` | ✅ | Get payment history for current user |

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health / readiness probe. Returns `{ status: "ok" }`. |

---

## 5. Subscription Tiers

| Tier | Price | Daily Limit |
|------|-------|-------------|
| Free | $0 | 10 voice generations |
| Basic | $9.99/month | 100 voice generations |
| Premium | $29.99/month | 1 000 voice generations |
| Enterprise | $99.99/month | Unlimited |

Admins can manually change any user's subscription tier via the admin panel or the `PUT /api/admin/users/:id/subscription` endpoint.

---

## 6. Frontend Pages

| Page | Route (state) | Description |
|------|---------------|-------------|
| Login | (unauthenticated) | Google login button |
| Dashboard | `dashboard` | User info, plan, usage stats, quick actions |
| Chat | `chat` | Avatar selection + 3D voice chat |
| Pricing | `pricing` | Subscription plans (public) |
| Profile | `profile` | Edit name, view subscription |
| Admin | `admin` | User list, subscription management (admin only) |

---

## 7. Railway Deployment

1. Create a new Railway project and **add a service** pointing to this repo.
2. Add all the [environment variables](#2-environment-variables) listed above in the Railway dashboard under **Variables**.
3. The `PORT` variable is automatically set by Railway; the server reads it from `process.env.PORT`.

### Railway environment variable reference

```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_REDIRECT_URI=https://kelionai.app/auth/google/callback
APP_BASE_URL=https://kelionai.app
API_BASE_URL=https://kelionai.app
SESSION_SECRET=<openssl rand -hex 64>
JWT_SECRET=<openssl rand -hex 64>
CORS_ORIGINS=https://kelionai.app
COOKIE_DOMAIN=kelionai.app
DB_PATH=./data/kelion.db
NODE_ENV=production
ADMIN_EMAILS=your-admin@example.com
```

### 7.1. Database Persistence (SQLite)

Since the app uses SQLite, you **must** mount a persistent volume in Railway to prevent data loss on every deploy:

1.  In Railway, go to **Settings** → **Volumes** → **+ Add Volume**.
2.  **Mount Path**: `/app/server/data`
3.  **Name**: `kelion-data` (or any name)
4.  This volume will host the `kelion.db` file and ensure your users and subscriptions are saved.

---

## 8. Security Notes

- **State parameter**: generated per-request, stored in session, validated on callback — prevents CSRF.
- **PKCE** (Proof Key for Code Exchange): `code_challenge` / `code_verifier` pair protects the authorization code against interception.
- **HttpOnly cookie** (web): not accessible to JavaScript; `Secure` in production; `SameSite=Lax`.
- **JWT** (mobile): signed with `HS256`, short-lived (`JWT_EXPIRES_IN`). Never expose `JWT_SECRET`.
- **Token verification**: user info is fetched from Google's UserInfo endpoint, which server-side verifies the token — no client-side ID token parsing.
- **Email verification**: login is rejected if `email_verified` is `false` in Google's response.
- **Admin access**: controlled by `ADMIN_EMAILS` environment variable.

---

## 9. Project Structure

```
kelion-voice/
├── src/                   # React frontend (Vite)
│   ├── components/
│   │   ├── AvatarSelect.jsx
│   │   ├── AvatarDebug.jsx
│   │   └── VoiceChat.jsx
│   ├── contexts/
│   │   └── AuthContext.jsx    # Auth state management + login/logout
│   ├── lib/
│   │   └── api.js             # API fetch helper
│   ├── pages/
│   │   ├── LoginPage.jsx      # Google login button
│   │   ├── Dashboard.jsx      # User dashboard
│   │   ├── PricingPage.jsx    # Subscription plans
│   │   ├── ProfilePage.jsx    # User profile editor
│   │   └── AdminPage.jsx      # Admin user management
│   ├── App.jsx
│   └── main.jsx
├── server/                # Node.js/Express backend
│   ├── src/
│   │   ├── config/
│   │   │   └── plans.js       # Subscription plan definitions
│   │   ├── config.js          # Environment-based configuration
│   │   ├── index.js           # Express app entry point
│   │   ├── db/
│   │   │   └── index.js       # SQLite setup + user/usage helpers
│   │   ├── middleware/
│   │   │   ├── auth.js        # requireAuth middleware + signAppToken
│   │   │   ├── admin.js       # requireAdmin middleware
│   │   │   └── subscription.js # checkSubscription middleware
│   │   ├── routes/
│   │   │   ├── auth.js        # /auth/* route handlers
│   │   │   ├── users.js       # /api/users/* route handlers
│   │   │   ├── admin.js       # /api/admin/* route handlers
│   │   │   ├── subscriptions.js # /api/subscription/* route handlers
│   │   │   └── payments.js    # /api/payments/* route handlers (Stripe stubs)
│   │   └── utils/
│   │       └── google.js      # OAuth helpers (state, PKCE, token exchange)
│   ├── __tests__/
│   ├── .env.example           # Environment variable template
│   └── package.json
├── public/
├── index.html
├── package.json               # Frontend + convenience server scripts
└── vite.config.js
```
