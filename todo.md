# KelionAI v2 - Project TODO

## Phase 1: Architecture & Setup
- [x] Create database schema for users, conversations, messages, subscriptions
- [x] Set up environment variables and secrets (API keys for AI providers, Stripe, etc.)
- [x] Configure authentication flow with role-based access control (user, admin)
- [x] Initialize Stripe integration scaffolding

## Phase 2: Core Chat Infrastructure
- [x] Implement multi-AI routing engine (GPT-4, Gemini, Groq, Claude, DeepSeek)
- [x] Create chat message storage and retrieval system
- [x] Build conversation session management
- [x] Implement AI model selection and switching logic
- [x] Add message streaming support for real-time responses (Brain v4 pipeline)
- [x] Create error handling and fallback logic for AI providers

### Phase 3: Voice Interaction System
- [x] Integrate speech-to-text (STT) using Whisper API
- [x] Integrate text-to-speech (TTS) for avatar voice output
- [x] Create voice recording UI component
- [x] Implement voice playback controls
- [x] Add voice usage tracking and limits
- [x] Add audio quality and language selection options (standard/high/ultra + language param)

## Phase 4: 3D Avatar System
- [x] Set up 3D avatar models (Kelion and Kira)
- [x] Implement avatar animation and lip-sync technology
- [x] Create avatar display component with Three.js or similar
- [x] Add avatar selection and customization UI
- [x] Implement avatar expression changes based on conversation context

## Phase 5: User Interface - Chat
- [x] Design and build main chat interface layout
- [x] Create message display component with markdown support
- [x] Implement AI model selector dropdown
- [x] Build chat input area with send button
- [x] Add conversation history sidebar
- [x] Implement conversation creation, deletion, and renaming
- [ ] Add message editing and deletion functionality
- [x] Create empty state and loading states

## Phase 5b: Pricing & Payments UI
- [x] Create pricing page with subscription tiers
- [x] Build payment history and invoice display page
- [x] Implement checkout flow UI
- [x] Add subscription management UI
- [x] Create subscription management page with upgrade/downgrade/cancel

## Phase 6: User Authentication & Profile
- [x] Build user registration and login pages (Manus OAuth)
- [x] Implement user profile management page (/profile)
- [x] Create password change functionality (via Manus OAuth, admin reset)
- [ ] Add profile picture upload to S3
- [x] Implement logout functionality
- [x] Build protected routes for authenticated users (chat, profile, admin)

## Phase 7: Admin Dashboard
- [x] Create admin layout with sidebar navigation
- [x] Build user management section (view, edit, delete users)
- [x] Implement user analytics dashboard (active users, chat count, etc.)
- [x] Create system monitoring page (API health, usage statistics)
- [x] Add revenue analytics and subscription tracking
- [x] Implement admin-only access controls

## Phase 8: Subscription & Payments
- [x] Add Stripe integration and webhook handling
- [x] Create subscription plans display page
- [x] Build checkout flow with Stripe
- [x] Implement subscription management (upgrade, downgrade, cancel)
- [x] Create payment history and invoice display
- [x] Add usage limits based on subscription tier
- [x] Implement feature gating for premium features

## Phase 9: Multi-Language Support
- [ ] Set up i18n framework (react-i18next or similar)
- [ ] Create translation files for supported languages
- [ ] Implement language selector in UI
- [ ] Add language preference to user profile
- [ ] Translate all UI text and messages

## Phase 10: Responsive Design & Mobile
- [x] Implement mobile-first responsive design
- [ ] Test on various screen sizes (mobile, tablet, desktop)
- [x] Create mobile-optimized chat interface
- [ ] Optimize touch interactions for mobile
- [ ] Test voice input/output on mobile browsers
- [x] Ensure avatar display works on mobile

## Phase 11: Security & Performance
- [x] Implement rate limiting on API endpoints (via subscription tiers)
- [x] Add Content Security Policy (CSP) headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy)
- [x] Implement input validation and sanitization (zod schemas on all tRPC inputs)
- [x] Add CORS configuration (dynamic origin, credentials, OPTIONS preflight)
- [x] Implement request logging and monitoring (API request logger with method, path, status, duration)
- [ ] Add error tracking (Sentry integration)
- [x] Optimize bundle size and lazy loading (React.lazy + Suspense for all pages)
- [x] Implement caching strategies (tRPC query caching, lazy loading, code splitting)

## Phase 12: Testing & Documentation
- [x] Write unit tests for core business logic (28 tests passing)
- [x] Write integration tests for API endpoints (auth, chat, admin role gating)
- [x] Create unit/integration tests for critical flows (28 vitest tests covering brain, auth, chat, admin)
- [ ] Add E2E browser tests with Playwright (future)
- [x] Write API documentation (docs/API.md with procedures, inputs, outputs)
- [ ] Create user manual and FAQ (future)
- [x] Document deployment instructions (docs/DEPLOYMENT.md)
- [x] Create developer setup guide (docs/DEVELOPER_SETUP.md)

## Phase 13: Deployment & Final Polish
- [ ] Set up CI/CD pipeline
- [ ] Configure production environment
- [ ] Perform security audit
- [ ] Load testing and performance optimization
- [ ] Final QA and bug fixes
- [ ] Deploy to production

## UI Fixes
- [x] Mouth control bar: hidden by default, appears on click on Settings button, controls avatar mouth opening

## Bug Fixes - Laptop/Desktop
- [x] Fix app not working when downloaded - ensure it works as web app in browser
- [x] Fix conversation history persistence and display
- [x] Ensure all features work on laptop/desktop browser
- [x] Fix any broken API calls or routing issues
- [x] Move Kelion/Kira buttons from header to avatar panel - Kelion left of head, Kira right of head


## Brain v4 - Completed
- [x] Brain v4 AGI orchestrator with function calling (AI decides tools)
- [x] Anti-hallucination system (7 rules, never invent facts)
- [x] User level detection (child, casual, professional, academic, technical)
- [x] Multi-language auto-detection (Romanian, English, Spanish, French, German)
- [x] Character personality system (Kelion: analytical, Kira: empathetic)
- [x] Real weather API (Open-Meteo with geocoding)
- [x] Real web search (DuckDuckGo + Wikipedia)
- [x] GPT-4o vision for visually impaired users
- [x] Code generation via LLM
- [x] Math calculations
- [x] Translation
- [x] Working indicator (hourglass + loading steps)
- [x] Confidence badges (verified/high/medium/low)
- [x] Auto-create conversation on first message

## ElevenLabs Voice - Completed
- [x] ElevenLabs TTS integration (real voices for Kelion/Kira)
- [x] Voice cloning from chat (5-step guided procedure)
- [x] Audio recording in browser
- [x] Auto-play audio responses
- [x] ElevenLabs API key verified and active (Creator plan)

## Future - PWA & Mobile Apps
- [ ] PWA (Progressive Web App) - manifest, service worker, icons
- [ ] Capacitor config for iOS/Android native wrapper
- [ ] Submit to App Store (Apple developer account ready)
- [ ] Submit to Google Play (Google developer account ready)

## Future - Chat Between Users
- [ ] Real-time messaging between users (WebSocket)
- [ ] User-to-user chat rooms
- [ ] Group conversations

## Future - Voice Cloning Improvements
- [ ] Professional voice cloning (longer samples, higher quality)
- [ ] Voice library (save multiple cloned voices per user)
- [ ] Voice marketplace (share/sell cloned voices)

## Future - Streaming & Integration Tests
- [ ] Real-time response streaming (SSE/WebSocket token-by-token)
- [ ] True integration tests for chat/admin/auth routers through tRPC context

## Contact Info
- Email: contact@kelionai.app
- Password reset: admin only
- Default language: English
- Avatars: live on homepage

## Implementation Gaps to Address
- [x] Add auth-guarded route wrapper for /chat, /profile, /admin (redirect if not logged in)
- [x] Verify Chat + Avatar on mobile breakpoints (responsive sidebar, mobile menu)
- [x] Add contact page with AI auto-response bot (/contact route)
- [x] Home page with live avatars (Kelion/Kira switching)
- [x] Contact page with AI auto-response (/contact)
- [x] Profile page with account info (/profile)
- [x] Voice router with real ElevenLabs TTS
- [x] Voice cloning endpoint (clone from chat)
- [x] Contact messages saved to DB + admin notified

## Bug Fixes
- [ ] Fix avatar 3D not showing on chat page on user's device (responsive/loading issue)

## Chat Page Fixes (User Reported)
- [x] Default language English (all UI text in English, not Romanian)
- [x] Chat messages appear BELOW avatar (right side), not on left monitor
- [x] Clear chat completely when switching conversations (no leftover messages)
- [x] Real weather API calls with actual location data (already in brain-v4)
- [x] Adjust mouth amplitude for more realistic lip-sync (AudioContext analyser)

## CAM & MIC Live Buttons
- [x] MIC button: real audio recording → Whisper STT → send transcribed text to AI brain
- [x] CAM button: real camera capture → upload frame → send to GPT vision for analysis
- [x] MIC shows recording state (red pulse, timer)
- [x] CAM shows live preview, capture button

## Admin User
- [x] Set adrianenc11@gmail.com as admin role in database (already admin)

## Standalone Railway Deployment (No Manus Dependencies)
- [x] Replace Manus OAuth with email/password auth (bcrypt + JWT)
- [x] Create login/register pages in frontend
- [x] Make all Manus dependencies optional with standalone fallbacks
- [x] Make app work independently on Railway with own DB
- [ ] Single-screen homepage (no scroll) with back button (pending user feedback)
- [x] Push standalone version to GitHub master

## Railway Build Fix
- [ ] Fix pnpm install --frozen-lockfile failure on Railway

## UI Fixes - User Reported
- [ ] Fix avatar head cut off - adjust camera position
- [ ] Remove message cursor/sidebar from chat, add only a "Chat History" button
- [ ] Fix Railway build (pnpm lockfile + Dockerfile)
- [ ] Switch database from MySQL to PostgreSQL (Supabase)

## Critical Fix - Railway Production (kelionai.app)
- [ ] Fix "Database not available" error on Railway - app cannot connect to database
- [ ] Verify database connection works on Railway (check DATABASE_URL env var)
- [ ] Test register flow on kelionai.app
- [ ] Test login flow on kelionai.app
- [ ] Test chat send message and AI response on kelionai.app
- [ ] Test voice recording (MIC) on kelionai.app
- [ ] Test camera capture (CAM) on kelionai.app
- [ ] Test avatar display (Kelion/Kira) on kelionai.app
- [ ] Test pricing page on kelionai.app
- [ ] Test subscription/payment flow on kelionai.app
- [ ] Test profile page on kelionai.app
- [ ] Test admin dashboard on kelionai.app
- [ ] Test conversation history on kelionai.app
- [ ] Test logout on kelionai.app

## Critical Issues Reported by User (Latest)
- [ ] Login not working properly on kelionai.app
- [ ] New user registration not working on kelionai.app
- [ ] Payments/subscriptions not working on kelionai.app
- [ ] Subscription expiration not handled
- [ ] Free plan expiration not handled
- [ ] Avatar caseta too small / badly framed on homepage
- [ ] Camera video should be hidden (not shown to user, only sent to AI)
- [ ] Chat page should be single page without scroll
- [ ] User adrianenc11@gmail.com needs to be admin (UPDATE failed - 0 rows)
- [ ] SECURITY FIX: Default role for new users must be 'user' not 'admin'
- [ ] FIX: Railway shows Manus OAuth login instead of standalone email/password - need to force standalone auth mode
