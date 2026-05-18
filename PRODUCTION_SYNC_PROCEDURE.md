# Kelion Production Autosync Procedure

This is the rule for deciding whether Kelion is really working:

1. All code changes go through a pull request into `master`.
2. Railway deploys `master`.
3. `https://kelionai.app/health` must report the same `deploy_sha` as the merged commit.
4. The public site must pass production acceptance checks:
   - `voice-claude-sync`: voice session contract is `backend=openrouter`, `provider=openrouter`, `model=anthropic/claude-opus-4.7`.
   - `chat-roundtrip`: public `/api/chat` returns HTTP 200 with a non-empty assistant reply.
   - `voice-roundtrip`: existing voice bootstrap contract still works.

Internal Railway success is not enough. A deployment is accepted only when `kelionai.app` passes.

## Automatic Flow

The `.github/workflows/acceptance.yml` workflow runs on `master` pushes.

It first polls:

```text
https://kelionai.app/health
```

until:

```text
deploy_sha == github.sha
```

Only after the live public domain reports the new commit does it run the acceptance scripts.

## Manual Truth Check

Use these commands when debugging production:

```powershell
curl.exe -sS https://kelionai.app/health
node e2e/acceptance/voice-claude-sync.cjs
node e2e/acceptance/chat-roundtrip.cjs
node e2e/acceptance/voice-roundtrip.cjs
```

Expected voice result:

```text
backend: openrouter
model: anthropic/claude-opus-4.7
```

Expected chat result:

```text
ACCEPTANCE PASS: chat-roundtrip
```

If `voice-claude-sync` passes but `chat-roundtrip` fails, the UI and deployment are alive but the AI provider call is broken.
