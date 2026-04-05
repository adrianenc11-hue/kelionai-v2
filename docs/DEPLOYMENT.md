# KelionAI v2 - Deployment Guide

## Manus Hosting (Recommended)

KelionAI v2 is built on the Manus platform with built-in hosting.

### Steps to Deploy:
1. Save a checkpoint in the Manus interface
2. Click the **Publish** button in the Management UI header
3. Your app is live at `https://your-domain.manus.space`

### Custom Domain:
1. Go to **Settings > Domains** in the Management UI
2. Either modify the auto-generated domain prefix or bind a custom domain
3. For custom domains, add the CNAME record as instructed

---

## Environment Variables

All environment variables are managed through **Settings > Secrets** in the Management UI or via `webdev_request_secrets`.

### Required Secrets:
| Variable | Description | How to Get |
|----------|-------------|------------|
| ELEVENLABS_API_KEY | ElevenLabs TTS & voice cloning | elevenlabs.io > Profile > API Keys |
| ELEVENLABS_VOICE_KELION | Voice ID for Kelion avatar | ElevenLabs voice library |
| ELEVENLABS_VOICE_KIRA | Voice ID for Kira avatar | ElevenLabs voice library |
| OPENAI_API_KEY | GPT-5.4 for vision (blind users) | platform.openai.com > API Keys |
| STRIPE_SECRET_KEY | Payment processing | dashboard.stripe.com > Developers > API Keys |
| STRIPE_WEBHOOK_SECRET | Webhook signature verification | Auto-configured |
| VITE_STRIPE_PUBLISHABLE_KEY | Frontend Stripe integration | dashboard.stripe.com |

### Auto-configured (do not change):
- DATABASE_URL, JWT_SECRET, VITE_APP_ID, OAUTH_SERVER_URL
- BUILT_IN_FORGE_API_URL, BUILT_IN_FORGE_API_KEY
- VITE_FRONTEND_FORGE_API_KEY, VITE_FRONTEND_FORGE_API_URL

---

## Database

- **Type:** MySQL/TiDB (managed)
- **Access:** Management UI > Database panel
- **Connection info:** Settings panel (bottom-left) - enable SSL for external connections
- **Migrations:** Run via `webdev_execute_sql` or Management UI SQL editor

### Key Tables:
- `user` - User accounts with roles and subscription tiers
- `conversations` - Chat conversations per user
- `messages` - Individual messages within conversations
- `user_cloned_voices` - Per-user cloned voice IDs from ElevenLabs
- `contact_messages` - Contact form submissions
- `user_usage` - Monthly usage tracking per user

---

## Stripe Webhook

The webhook endpoint is at `/api/stripe/webhook`.
- Test events (id starts with `evt_test_`) return `{ verified: true }`
- Production events are verified via `stripe.webhooks.constructEvent()`
- Handled events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

### Testing Payments:
- Use card number: `4242 4242 4242 4242`
- Any future expiry date, any CVC
- Claim test sandbox at: Settings > Payment

---

## Build Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Type check
npx tsc --noEmit
```

---

## Production Checklist

- [ ] All environment variables configured in Settings > Secrets
- [ ] ElevenLabs API key active with Creator plan or higher
- [ ] OpenAI API key active for vision features
- [ ] Stripe webhook verified (Settings > Payment)
- [ ] Custom domain configured (optional)
- [ ] SSL enabled for database connections
- [ ] Admin user promoted via database (role = 'admin')
