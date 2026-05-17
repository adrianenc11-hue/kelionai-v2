# Acceptance criteria — the only definition of "done"

Each script in this folder corresponds to one user-facing capability of the
product. A feature is considered delivered **only if** its script returns
exit code 0 when run against the live production URL.

Nothing else counts as delivery:
- Unit tests passing — does not count.
- Build succeeding — does not count.
- Code pushed to master — does not count.
- Agent reports, screenshots, logs — do not count.

See `DELIVERY_CONTRACT.md` and `RULES.md`.

## Currently defined criteria

| Script | Feature | Current status |
|---|---|---|
| `payments.cjs` | A real user can pay and end up with an active subscription | NOT IMPLEMENTED (payments are mock) |
| `language-mirror.cjs` | The AI replies in the language of the user's last message | NOT TESTED |
| `language-switch.cjs` | Switching languages mid-conversation is honored on next reply | NOT TESTED |
| `trial-timer.cjs` | The 15-minute trial really expires and blocks further use | NOT TESTED |
| `logout-media.cjs` | Logout stops microphone and camera tracks | NOT TESTED |
| `voice-roundtrip.cjs` | A real audio message is sent and an audio reply comes back | NOT TESTED |

The initial status for all features is "NOT TESTED / NOT IMPLEMENTED" on
purpose. This is the honest baseline. Each capability gets marked as real
only when its acceptance script exits 0 on the live URL.

## How to run one

```
node e2e/acceptance/<name>.cjs
echo exit=$?
```

Exit 0 = capability works for a real user.
Any other exit code = capability is broken.

## How to add a new one

Only the owner may add acceptance scripts. Agents may propose content via PR,
but the script must be reviewed and merged by the owner under CODEOWNERS.
The script must:

1. Run against `https://kelionai.app` (not localhost).
2. Simulate a real user action end to end.
3. Print `ACCEPTANCE FAIL: <reason>` and `process.exit(1)` on any failure.
4. Print `ACCEPTANCE OK: <capability>` and `process.exit(0)` on success.
5. Not depend on mocks, env overrides, or feature flags that a real user
   would not have.
