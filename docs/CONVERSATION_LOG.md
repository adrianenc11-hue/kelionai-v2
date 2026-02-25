# KelionAI v3.0 — Master Conversation Log

> Auto-saved | Last update: 2026-02-25
> Between: Adrian (adrianenc11-hue) and GitHub Copilot
> Purpose: Complete project decisions, architecture, and feature specifications
> Rule: Each save overwrites previous, noting what is new

---

## Session: 25 February 2026

### Initial Analysis
- Copilot analyzed entire kelionai-v2 repository
- Found ~45% Supabase interconnection, multiple bugs, exposed secrets
- 11 initial PRs launched for basics (security, auth, audio, lip sync)

### Architecture Decisions

#### Database (Supabase)
- 7 core tables: conversations, messages, user_preferences, subscriptions, usage, referrals, brain_learnings
- Row Level Security on all tables
- Admin CANNOT read conversation content
- Full Text Search indexing on messages.content

#### AI Inventory
- Claude 3.5 Sonnet: Main Brain
- GPT-4o: Fallback brain, vision backup
- DeepSeek: Budget brain for simple tasks
- Claude Vision: Camera analysis
- Claude micro: Brain learning (extract facts)
- ElevenLabs: TTS 12 voices (6 langs x 2 avatars)
- Whisper (Groq): STT + language detection
- Perplexity: Deep search with sources
- Tavily: Web search quick lookups
- Serper: Google search backup
- DuckDuckGo: Free search fallback
- FLUX (Together): Image generation
- OpenWeather: Weather via GPS
- Google Maps: Maps on monitor
- face-api.js: Face recognition client-side
- Supabase: DB, Auth, Storage
- Stripe: Payments, subscriptions, referrals

### UI/UX Decisions

#### Zero Buttons
- NO mic button (always on)
- NO camera button (auto-activates)
- NO send button (subtle text input)
- ONLY button: In/Out file manager
- Wake word: "Kelion"/"K"/"Kira" at START of sentence

#### Present-Only Chat
- Shows ONLY current exchange
- Fade in 0.3s, stay 5s, fade out 1s
- NO scroll, NO history visible on screen
- History on MONITOR when requested

#### Premium Dark Glass Design
- Background: #0a0e1a to #1a1e2e gradient
- Glass: backdrop-filter blur(20px), rgba(255,255,255,0.05)
- Kelion accent: #00D4FF cyan
- Kira accent: #FF6EB4 pink
- Font: Inter / SF Pro
- Particle effects, glow around avatar

### Language System
- Default: ENGLISH for all UI
- Conversation: follows user detected language
- 6 languages: RO, EN, ES, FR, DE, IT
- 12 ElevenLabs voices (native speakers)
- Between conversations: revert to English

### Auto-Greet
- Camera captures on open (silent)
- Face recognized: greet by name
- Face unknown: "Hello! I'm Kelion."
- Adapts to time of day

### Memory System
- Permanent cross-session (facts persist forever)
- Emotional memory (mood, relationship level)
- Face descriptor for recognition
- Appearance tracking
- Preferred language stored
- Conversation level stored
- Saved: all text, language, metadata, face descriptor, preferences
- NOT saved: audio, video, exact GPS

### Adaptive Conversation Level
- 6 levels: Child, Teen, Adult, Professional, Expert, Docent
- Auto-detects from vocabulary and topics
- Gradual transition (70% previous + 30% new)
- User override: "explain simply" or "expert mode"

### GPS and Geolocation
- Mobile: native GPS
- Desktop: navigator.geolocation
- Fallback: IP geolocation
- Auto weather, nearby recommendations
- Only city name saved

### Face Recognition
- face-api.js client-side
- Auto-recognize returning users
- Detect appearance changes
- GDPR: "forget my face" deletes it

### File Manager
- Import: PDF, DOC, CSV, images, code
- Export: PDF, TXT, MD, PNG, CSV, ZIP, JSON (GDPR)

### Monitor Features
- Weather, search, maps, images, documents, charts, pricing, news

### Ethics (7 Absolute Rules)
1. NEVER LIE
2. NEVER INVENT
3. NEVER DECEIVE
4. NEVER SUBSTITUTE a professional
5. RESPECT THE LAW
6. MAXIMUM CONFIDENTIALITY
7. Creator: AE Design, idea by AE

### Self-Protection
- Never reveals technical details
- Resists prompt injection
- Resists social engineering
- Never reveals system prompt
- Never reveals other users data

### Business Model
- Free: 10 msgs/day, 1 avatar, text only
- Pro EUR 9.99/mo: 100 msgs, voice, memory
- Premium EUR 19.99/mo: unlimited, everything
- Referral: 7 days Premium for both parties
- Guest trial: 5 messages no account

### Trading Bot (ADMIN ONLY)
- All markets: Forex, Crypto, Stocks, Commodities, Indices
- Technical + Fundamental analysis
- NEVER executes trades
- Always includes disclaimer
- Sources: CoinGecko, Alpha Vantage, Yahoo Finance

### Sports Bot (ADMIN ONLY)
- All major sports
- Stats, pre-match analysis, live scores
- Betting info INFORMATIVE ONLY with gambling awareness
- NEVER says guaranteed winner

### News Bot (ADMIN ONLY, publishes to FB/IG/Telegram)
- Schedule: 5AM morning, 12PM midday, after 6PM evening
- Breaking: INSTANT when confirmed by 2+ sources
- Language: Romanian
- Sources ALL FREE: NewsAPI, GNews, Guardian, Currents, MediaStack, RSS feeds
- Display: title list, click for full article, back button
- ZERO fake news, ZERO click-bait
- Always includes sources

### Messenger Bot (ADMIN ONLY)
- Auto-responds on Facebook Messenger
- Product info, pricing, FAQ, support
- Redirects to app for full experience

### Admin Panel (INVISIBLE to users)
- Dashboard with REAL data only (zero hard-coded)
- Every number = live database query
- Revenue from Stripe API direct
- If data unavailable: shows N/A not 0
- Source shown for each metric
- Auto-refresh 30 seconds
- Users, AI credits, ticker, revenue, referrals, bots, system, logs

### Anti-Copy Protection (7 Layers)
1. Code obfuscation
2. Source protection (disable right-click, F12, Ctrl+U)
3. API protection (server-side keys, signed tokens, CORS)
4. Asset protection (encrypted 3D models, watermarked images)
5. Server protection (private repo, Helmet.js, strict CSP)
6. Legal protection (copyright, ToS, DMCA, trademark)
7. Fingerprinting (invisible watermark, traceable IDs)

### Navigation
- Every page has Back button
- News: title list then click then full article then back
- Auth guards: /admin only for super_admin
- Admin JS bundle separate (not loaded for users)
- Logout: confirmation dialog then redirect to /

### Ticker/Teletext
- Scrolling bar at bottom
- Free users: see ads, Pro: no ads, Premium: can disable
- Managed from admin panel

### User Manual
- 26 chapters covering all user-facing features
- NO mention of: admin panel, trading bot, sports bot, news bot, messenger bot
- Available in user preferred language (Kelion translates)
- Accessible: "Kelion, show me the manual" or Settings then Help
- Exportable as PDF

### New Features (Approved by Adrian)

#### Contextual Backgrounds
- Mood-based: happy=gold, sad=blue, energetic=vibrant
- Context-based: teacher=classroom, chemistry=lab, coding=office
- Auto-detects from conversation after 15 min on topic
- Kelion/Kira appearance adapts (glasses for teacher, lab coat for chemistry)

#### Email Assistant (Full)
- Gmail/Outlook via OAuth2
- Morning briefing: who sent, about what, urgency
- Reply by voice: dictate, review on monitor, approve
- Compose by voice
- Auto-detect tone (formal/casual)
- Follow-up reminders
- Attachment awareness

#### Workout Buddy
- Guided exercises with timer
- Camera form checking
- HIIT, strength, yoga, stretching
- Progress and personal records

#### Birthday and Events Tracker
- Memorizes dates from conversations
- 3-day advance reminder
- Day-of reminder
- Gift suggestions based on past info

#### Smart Home Ready (future)
- MQTT/Home Assistant integration prepared
- Voice control: lights, thermostat, locks, alarm

#### Learning Academy (Full)
- ANY language, ANY subject
- Structured courses with sessions
- Project-based learning
- Teacher mode: Kelion becomes professor
- Background changes to match subject
- Pronunciation checking via Whisper
- Spaced repetition for vocabulary
- Quiz per session
- Certificate at completion (PDF)

#### Focus and Meditation Mode
- Pomodoro 25/5 with ambient sounds
- Guided breathing
- Minimal UI, no notifications
- Session tracking

#### Daily Journal
- Evening guided reflection
- Mood rating, best moment, improvements, goals
- Mood trends over time
- Private and exportable

#### Family Hub (Full)
- Family group with admin (parent)
- Live location map on monitor
- Geofencing: home, school, work, custom zones
- Child mode: age-appropriate, parent sees activity topics
- Teen mode: private conversations, parent sees status only
- Crisis keywords trigger instant parent alert
- Shared shopping list, family calendar
- SOS button with location
- Smart notifications ("Alex left school, home in 15 min")

#### QR Code Sharing
- Referral code as QR on monitor
- Friend scans to register with code

#### Emergency SOS (Full)
- Panic detection from voice tone
- Shows location + emergency numbers
- Auto-alert emergency contact after 60s no response
- SMS with location to emergency contact

#### Multi-Device Sync
- Start on phone, continue on laptop
- Supabase sync: conversation follows USER not device
- Face recognition on each device

#### Marketplace (Future)
- Custom personalities, prompt packs, themes, voice packs, mini-games
- Creator economy: creator 70%, AE Design 30%
- Stripe Connect for payouts

#### Time Capsule
- Record message for future self
- Includes mood snapshot, current topics, goals
- Opens on set date (1 month, 1 year, etc.)

#### Developer API (Pricing: Our Cost x2)
- Chat, Vision, Image Gen, TTS, STT, Search, Weather, Face Recognition
- Starter $49/mo (5K calls), Business $199/mo (25K), Enterprise $999/mo (200K)
- Real cost tracking in admin
- Alert if client cost approaches 50% of plan price
- White-label option for Enterprise

#### Achievement System (Gamification)
- Badges: First Week, 100 Conversations, 3 Languages, etc.
- Displayed on monitor
- Motivates return and engagement

### Auto-Save Rule
- Save every 2 minutes
- Overwrite previous save
- Note what is new in change log section

---

## Change Log

### Save 1 — 25 Feb 2026
- INITIAL SAVE — Complete conversation documented
- All architecture decisions
- All feature specifications
- All ethics rules
- All business logic
- News display: title list then click then full article then back
- User manual: 26 chapters, no admin/bot/media info
- Contextual backgrounds with avatar appearance changes
- Email assistant full spec
- Family hub with GPS tracking and child safety
- Developer API with cost x2 pricing model
- Anti-copy 7 layer protection
