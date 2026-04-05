# Railway Environment Variables

Set these in Railway Dashboard → Variables for your service.

## Required

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | MySQL connection string | `mysql://user:pass@host:3306/db` |
| `JWT_SECRET` | Session cookie signing (min 32 chars) | `generate-random-string-here` |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o + Whisper | `sk-...` |
| `ELEVENLABS_API_KEY` | ElevenLabs API key for TTS voices | `your-key` |
| `ELEVENLABS_VOICE_KELION` | Kelion voice ID | `VR6AewLTigWG4xSOukaG` |
| `ELEVENLABS_VOICE_KIRA` | Kira voice ID | `EXAVITQu4vr4xnSDxMaL` |

## Optional

| Variable | Description |
|---|---|
| `S3_BUCKET` | AWS S3 bucket for file uploads |
| `S3_REGION` | AWS S3 region (default: us-east-1) |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |

## DO NOT SET on Railway

These are Manus-specific and will cause issues:
- `OAUTH_SERVER_URL`
- `VITE_APP_ID`
- `VITE_OAUTH_PORTAL_URL`
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`
