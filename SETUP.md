# 🚀 Setup Guide - KelionAI Voice Assistant

## Quick Start

### 1. Install Dependencies

```bash
# Frontend
npm install

# Backend
cd server && npm install
```

### 2. Configure Environment Variables

**Backend (`server/.env`)**:
```bash
cp server/.env.example server/.env
```

Edit `server/.env` and add your API keys:

```env
# Required for AI features
GOOGLE_API_KEY=your-google-api-key
OPENROUTER_API_KEY=your-openrouter-api-key

# Required for voice synthesis
ELEVENLABS_API_KEY=your-key-here

# Required for Google login
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret

# Required - generate random strings
JWT_SECRET=generate-with-openssl-rand-hex-48
SESSION_SECRET=generate-with-openssl-rand-hex-48
```

### 3. Run Development Servers

**Terminal 1 - Backend**:
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend**:
```bash
npm run dev
```

### 4. Open Application

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Health Check: http://localhost:3001/health

---

## Features Implemented ✅

### Authentication
- ✅ Google OAuth 2.0 with PKCE
- ✅ JWT tokens for mobile clients
- ✅ Session cookies for web clients
- ✅ Protected routes with middleware

### User Management
- ✅ User profiles with subscription tracking
- ✅ Usage tracking (daily limits)
- ✅ Referral system
- ✅ Admin panel for user management

### AI Features
- ✅ Gemma 4 integration (via Google API + OpenRouter)
- ✅ Real-time voice chat (WebRTC)
- ✅ ElevenLabs TTS (multilingual)
- ✅ Vision support (camera frames)

### Subscription System
- ✅ Free tier (15 min/day)
- ✅ Basic tier (60 min/day)
- ✅ Premium tier (180 min/day)
- ✅ Enterprise (unlimited)

### Security
- ✅ CSRF protection
- ✅ Helmet CSP headers
- ✅ Rate limiting (20 req/min)
- ✅ Input validation
- ✅ CORS configuration

---

## API Endpoints

### Authentication
- `GET /auth/google/start` - Start OAuth flow
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/me` - Get current user
- `POST /auth/logout` - Logout

### Users (Protected)
- `GET /api/users/me` - Get profile
- `PUT /api/users/me` - Update profile
- `GET /api/users/subscription/plans` - Get plans
- `POST /api/users/subscription/upgrade` - Upgrade

### Admin (Protected + Admin Role)
- `GET /api/admin/users` - List all users
- `GET /api/admin/users/:id` - Get user details
- `PUT /api/admin/users/:id/subscription` - Update subscription
- `PUT /api/admin/users/:id/role` - Update role
- `DELETE /api/admin/users/:id` - Delete user

### AI Services (Protected + Subscription Check)
- `POST /api/chat` - Chat with AI (SSE)
- `POST /api/tts` - Text-to-speech
- `GET /api/realtime/token` - Get WebRTC token

---

## Testing

```bash
# Backend tests
cd server && npm test

# E2E tests
npm run test:e2e
```

---

## Deployment

### Railway (Recommended)

The app is pre-configured for Railway:

1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push

**Required Variables**:
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JWT_SECRET`
- `SESSION_SECRET`
- `ADMIN_EMAILS`

### Docker

```bash
docker build -t kelionai .
docker run -p 8080:8080 --env-file .env kelionai
```

---

## Troubleshooting

### "API key not configured"
Check that your `.env` file has the required keys set.

### "Database not initialized"
Ensure `DB_PATH` directory exists and is writable.

### CORS errors
Verify `CORS_ORIGINS` includes your frontend URL.

### OAuth fails
Check that `GOOGLE_REDIRECT_URI` matches exactly what's in Google Cloud Console.

---

## Project Structure

```
kelionai-v2/
├── server/
│   ├── src/
│   │   ├── config.js
│   │   ├── index.js
│   │   ├── db/
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   ├── csrf.js
│   │   │   └── subscription.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── users.js
│   │   │   ├── admin.js
│   │   │   ├── chat.js
│   │   │   ├── tts.js
│   │   │   └── realtime.js
│   │   └── services/
│   ├── .env.example
│   └── package.json
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── components/
│   │   ├── VoiceChat.jsx
│   │   └── AvatarSelect.jsx
│   ├── pages/
│   │   ├── LandingPage.jsx
│   │   └── ArmSettingsPage.jsx
│   └── lib/
│       ├── api.js
│       └── lipSync.js
├── package.json
├── vite.config.js
└── README.md
```

---

## Next Steps

1. **Get API Keys**:
   - [Google AI Studio](https://aistudio.google.com/app/apikey)
   - [OpenRouter](https://openrouter.ai/keys)
   - [ElevenLabs](https://elevenlabs.io/app/settings)
   - [Google OAuth](https://console.cloud.google.com/apis/credentials)

2. **Configure OAuth**:
   - Add redirect URI: `http://localhost:3001/auth/google/callback`
   - Enable email & profile scopes

3. **Test Locally**:
   - Run both servers
   - Test Google login
   - Try voice chat

4. **Deploy**:
   - Push to Railway
   - Set production env vars
   - Update CORS origins

---

**Need Help?** Check the full README.md or open an issue on GitHub.
