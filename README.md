# Kelion Voice

3D avatar voice-chat application with AI-powered conversation and Google OAuth authentication.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend (web) | React 18 + Vite, Three.js / React Three Fiber |
| Backend API | Node.js + Express |
| Authentication | Google OAuth 2.0 / OpenID Connect |
| Session (web) | `express-session` → HttpOnly cookie |
| Token (mobile) | Signed JWT (Bearer token) |
| Database | SQLite (`better-sqlite3`) |
| Deployment | Railway (API) + Vercel / Cloudflare Pages (web) |

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
   | Production  | `https://api.kelionai.app/auth/google/callback` |
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
| `GOOGLE_REDIRECT_URI` | Callback URL registered in Google Cloud | `https://api.kelionai.app/auth/google/callback` |
| `APP_BASE_URL` | Frontend URL (used for post-auth redirects) | `https://kelionai.app` |
| `API_BASE_URL` | Backend API URL | `https://api.kelionai.app` |
| `SESSION_SECRET` | Long random string for session signing | `openssl rand -hex 64` |
| `JWT_SECRET` | Long random string for JWT signing (different from SESSION_SECRET) | `openssl rand -hex 64` |
| `JWT_EXPIRES_IN` | JWT TTL | `7d` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `https://kelionai.app` |
| `COOKIE_DOMAIN` | Session cookie domain | `kelionai.app` |
| `DB_PATH` | SQLite file path | `./data/kelion.db` |
| `PORT` | API server port | `3001` |
| `NODE_ENV` | `development` or `production` | `production` |

---

## 3. Local Development

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
npm run server:install

# Start the backend API (in one terminal)
npm run server:dev

# Start the frontend dev server (in another terminal)
npm run dev
```

Frontend will be available at `http://localhost:5173`.  
Backend API will be available at `http://localhost:3001`.

---

## 4. API Endpoints

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google/start` | Starts the Google OAuth flow. Pass `?mode=mobile` for mobile clients (returns JWT instead of cookie). |
| `GET` | `/auth/google/callback` | Google redirects here after login. Handles code exchange, user upsert, and session/token issuance. |
| `GET` | `/auth/me` | Returns the current user's profile. Accepts session cookie (web) or `Authorization: Bearer <token>` (mobile). |
| `POST` | `/auth/logout` | Destroys the server-side session and clears the cookie. Mobile clients should discard the JWT locally. |

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health / readiness probe. Returns `{ status: "ok" }`. |

### Web flow

```
Browser  →  GET /auth/google/start
         ←  302 → accounts.google.com (with state + PKCE)

Google   →  GET /auth/google/callback?code=…&state=…
         ←  302 → https://kelionai.app/   (session cookie set)

Browser  →  GET /auth/me  (with cookie)
         ←  200 { id, email, name, picture }
```

### Mobile flow

```
App      →  GET /auth/google/start?mode=mobile  (open in system browser)
         ←  302 → accounts.google.com

Google   →  GET /auth/google/callback?code=…&state=…
         ←  200 { token: "<jwt>", user: { … } }

App      →  GET /auth/me  (Authorization: Bearer <jwt>)
         ←  200 { id, email, name, picture }
```

---

## 5. Railway Deployment

1. Create a new Railway project and **add a service** pointing to this repo.
2. Set the **root directory** to `server` (or use a Nixpacks/Dockerfile to build both).
3. Add all the [environment variables](#2-environment-variables) listed above in the Railway dashboard under **Variables**.
4. Set a **custom domain** for the service: `api.kelionai.app`.
5. The `PORT` variable is automatically set by Railway; the server reads it from `process.env.PORT`.

> **Important**: ensure `NODE_ENV=production` is set so that cookies are issued with `Secure` and the correct `SameSite` policy.

### Railway environment variable reference

```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_REDIRECT_URI=https://api.kelionai.app/auth/google/callback
APP_BASE_URL=https://kelionai.app
API_BASE_URL=https://api.kelionai.app
SESSION_SECRET=<openssl rand -hex 64>
JWT_SECRET=<openssl rand -hex 64>
CORS_ORIGINS=https://kelionai.app
COOKIE_DOMAIN=kelionai.app
DB_PATH=./data/kelion.db
NODE_ENV=production
```

---

## 6. Security Notes

- **State parameter**: generated per-request, stored in session, validated on callback — prevents CSRF.
- **PKCE** (Proof Key for Code Exchange): `code_challenge` / `code_verifier` pair protects the authorization code against interception.
- **HttpOnly cookie** (web): not accessible to JavaScript; `Secure` in production; `SameSite=Lax`.
- **JWT** (mobile): signed with `HS256`, short-lived (`JWT_EXPIRES_IN`). Never expose `JWT_SECRET`.
- **Token verification**: user info is fetched from Google's UserInfo endpoint (authenticated with the `access_token`), which server-side verifies the token — no client-side ID token parsing.
- **Email verification**: login is rejected if `email_verified` is `false` in Google's response.

---

## 7. Project Structure

```
kelion-voice/
├── src/                   # React frontend (Vite)
│   ├── components/
│   │   ├── AvatarSelect.jsx
│   │   └── VoiceChat.jsx
│   ├── App.jsx
│   └── main.jsx
├── server/                # Node.js/Express backend
│   ├── src/
│   │   ├── config.js      # Environment-based configuration
│   │   ├── index.js       # Express app entry point
│   │   ├── db/
│   │   │   └── index.js   # SQLite setup + user helpers
│   │   ├── middleware/
│   │   │   └── auth.js    # requireAuth middleware + signAppToken
│   │   ├── routes/
│   │   │   └── auth.js    # /auth/* route handlers
│   │   └── utils/
│   │       └── google.js  # OAuth helpers (state, PKCE, token exchange)
│   ├── .env.example       # Environment variable template
│   └── package.json
├── public/
├── index.html
├── package.json           # Frontend + convenience server scripts
└── vite.config.js
```
