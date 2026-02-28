# KelionAI — Premium Website Redesign

## Design Guidelines

### Design References
- **Linear.app**: Clean dark UI, glassmorphism, subtle gradients
- **Vercel.com**: Premium dark theme, bold typography, smooth animations
- **Stripe.com**: Elegant cards, gradient accents, professional feel
- **Style**: Ultra-Modern Dark + Glassmorphism + Neon Accents

### Color Palette
- Background Primary: #050510 (Deep Space Black)
- Background Secondary: #0A0A1B (Dark Navy)
- Surface: rgba(15, 15, 40, 0.7) (Frosted Glass)
- Surface Hover: rgba(25, 25, 55, 0.8)
- Border: rgba(100, 100, 255, 0.12)
- Primary: #6366F1 (Indigo)
- Secondary: #06B6D4 (Cyan)
- Accent Gradient: linear-gradient(135deg, #6366F1, #06B6D4)
- Success: #10B981 (Emerald)
- Warning: #F59E0B (Amber)
- Danger: #EF4444 (Red)
- Text Primary: #F0F0FF
- Text Secondary: #8888AA
- Text Muted: #555577
- Glow Indigo: 0 0 30px rgba(99, 102, 241, 0.3)
- Glow Cyan: 0 0 30px rgba(6, 182, 212, 0.3)

### Typography
- Font Family: 'Inter', -apple-system, sans-serif
- Mono: 'JetBrains Mono', monospace
- H1: 700 weight, 3rem (hero), 2.2rem (page)
- H2: 600 weight, 1.6rem
- H3: 600 weight, 1.2rem
- Body: 400 weight, 0.95rem
- Small: 400 weight, 0.85rem
- Caption: 400 weight, 0.75rem

### Key Component Styles
- **Cards**: Glassmorphism with backdrop-filter: blur(20px), subtle border glow on hover
- **Buttons Primary**: Gradient bg (indigo→cyan), white text, 12px rounded, hover: lift + glow
- **Buttons Secondary**: Transparent bg, border, hover: surface fill
- **Inputs**: Dark bg, subtle border, focus: indigo glow ring
- **Navbar**: Sticky, glassmorphism, 64px height
- **Modals**: Centered, glassmorphism backdrop, scale-in animation

### Images to Generate
1. **hero-ai-brain-network.jpg** — Abstract AI neural network visualization with glowing indigo and cyan nodes connected by light beams on dark background (Style: photorealistic, dark mood, 1024x576)
2. **feature-avatar-3d.jpg** — Futuristic 3D holographic AI avatar head with glowing particles, dark background (Style: 3d, dark mood, 1024x576)
3. **feature-voice-wave.jpg** — Abstract sound wave visualization with gradient colors indigo to cyan, dark background (Style: minimalist, dark mood, 1024x576)
4. **feature-search-globe.jpg** — Digital globe with search connections and data streams, dark futuristic style (Style: photorealistic, dark mood, 1024x576)

---

## Development Tasks

### Task 1: Design System Update
- `styles/design-system.css` — Updated CSS variables, new tokens
- `styles/components.css` — Premium component styles
- `styles/animations.css` — New micro-animations
- `styles/mobile.css` — Improved responsive

### Task 2: Landing Page (index.html + css/app.css)
- Premium navbar with glassmorphism
- Hero section with animated gradient
- 3D avatar area with frosted panels
- Modernized chat interface
- Premium auth screen
- Redesigned pricing modal
- All text in English

### Task 3: Onboarding Page (onboarding.html)
- Premium multi-step wizard
- Animated transitions
- Plan selection cards
- English text

### Task 4: Pricing Page (pricing/index.html + pricing.css + pricing.js)
- Premium floating cards
- Feature comparison
- FAQ section
- English text

### Task 5: Settings Page (settings/index.html + settings.css)
- Dashboard-style layout
- Premium toggles and cards
- English text

### Task 6: Developer Portal (developer/index.html + developer.css)
- Premium code blocks
- Interactive sandbox
- Stats dashboard
- English text

### Task 7: Billing Page (dashboard/billing.html)
- Premium subscription card
- Usage visualization
- English text

### Task 8: 404 & Error Pages (404.html + error.html)
- Animated error display
- Navigation links
- English text