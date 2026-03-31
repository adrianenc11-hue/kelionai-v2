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
- [ ] Add message streaming support for real-time responses
- [x] Create error handling and fallback logic for AI providers

### Phase 3: Voice Interaction System
- [x] Integrate speech-to-text (STT) using Whisper API
- [x] Integrate text-to-speech (TTS) for avatar voice output
- [x] Create voice recording UI component
- [x] Implement voice playback controls
- [x] Add voice usage tracking and limits
- [ ] Add audio quality and language selection options

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
- [ ] Build user registration and login pages
- [ ] Implement user profile management page
- [ ] Create password change functionality
- [ ] Add profile picture upload to S3
- [ ] Implement logout functionality
- [ ] Build protected routes for authenticated users

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
- [ ] Implement mobile-first responsive design
- [ ] Test on various screen sizes (mobile, tablet, desktop)
- [ ] Create mobile-optimized chat interface
- [ ] Optimize touch interactions for mobile
- [ ] Test voice input/output on mobile browsers
- [ ] Ensure avatar display works on mobile

## Phase 11: Security & Performance
- [x] Implement rate limiting on API endpoints (via subscription tiers)
- [ ] Add Content Security Policy (CSP) headers
- [ ] Implement input validation and sanitization
- [ ] Add CORS configuration
- [ ] Implement request logging and monitoring
- [ ] Add error tracking (Sentry integration)
- [ ] Optimize bundle size and lazy loading
- [ ] Implement caching strategies

## Phase 12: Testing & Documentation
- [ ] Write unit tests for core business logic
- [ ] Write integration tests for API endpoints
- [ ] Create end-to-end tests for critical user flows
- [ ] Write API documentation
- [ ] Create user manual and FAQ
- [ ] Document deployment instructions
- [ ] Create developer setup guide

## Phase 13: Deployment & Final Polish
- [ ] Set up CI/CD pipeline
- [ ] Configure production environment
- [ ] Perform security audit
- [ ] Load testing and performance optimization
- [ ] Final QA and bug fixes
- [ ] Deploy to production

## UI Fixes
- [ ] Mouth control bar: hidden by default, appears on click on "Gură" button, controls avatar mouth opening

## Bug Fixes - Laptop/Desktop
- [ ] Fix app not working when downloaded - ensure it works as web app in browser
- [ ] Fix conversation history persistence and display
- [ ] Ensure all features work on laptop/desktop browser
- [ ] Fix any broken API calls or routing issues
- [x] Move Kelion/Kira buttons from header to avatar panel - Kelion left of head, Kira right of head
