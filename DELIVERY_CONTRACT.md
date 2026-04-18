# DELIVERY CONTRACT

This file defines what "delivered" means for this project. It binds any
agent (AI or human) who contributes to the codebase. Payment and approval
of work follow this contract, not agent reports.

---

## Definition of "delivered"

A feature is **delivered** if and only if:

1. There exists a script under `e2e/acceptance/<feature>.cjs` that simulates
   a real end-to-end user action for that feature.
2. When run against the live production URL (`https://kelionai.app`), the
   script exits with code 0.
3. The script does not depend on mocks, localhost, feature flags, or any
   configuration a real paying user would not have.
4. The run output — full stdout, full stderr, and exit code — is attached
   to the delivery claim.

Any other form of "done" signal is not accepted. Specifically, the
following **do not** constitute delivery:

- A unit test suite returning green.
- A build completing without errors.
- A deploy to production succeeding.
- A pull request being merged.
- Screenshots of passing UI.
- Agent reports ("PASS", "verificat", "gata", "functioneaza").
- Counts of tests, checks, or `it()` blocks.
- Hash integrity of `RULES.md` passing (that only proves the rules
  themselves are intact).

## Current state, per capability

Each row here is updated **only** when the corresponding acceptance script
is run against production and exits 0. The update itself is subject to
CODEOWNERS approval (see `CODEOWNERS`).

| Feature | Script | Delivered? |
|---|---|---|
| Live voice round-trip (Stage 1: Gemini Live token mintable on production) | `e2e/acceptance/voice-roundtrip.cjs` | **VERIFIED ONLY UP TO PRECONDITIONS** (token endpoint green; mic→AI→STT full closure not yet implemented) |

### Capabilities deliberately out of scope for the new Kelion product

The old kelionai.app had separate UIs for payments, 15-minute trial, logout
media tracks, language picker and language switch. The new Kelion product
(Stages 1–6) removes those flows from the UI per owner decision:

- Payments / subscriptions — not part of this product iteration.
- 15-minute trial timer — not part of this product iteration.
- Explicit logout button releasing mic+camera — the new UI has no auth
  logout flow (passkey sign-in is optional, not required to talk). Media
  tracks are owned by the `useGeminiLive` hook and torn down when the
  user taps to end the call or closes the tab.
- Language picker — Gemini Live auto-detects and mirrors the user's
  language natively (Stage 1 persona rules §1–§3). No UI toggle.
- Language switch mid-conversation — same as above, handled natively
  by the model.

The corresponding acceptance scripts have been removed because the
features they asserted no longer exist as user-visible capabilities of
the product. Per §1 above, "delivered" requires a real user action; if
the action no longer exists in the product, the row is removed.

If the owner later re-introduces any of these capabilities, the
acceptance script for that capability must be restored first, and the
row re-added to the table, before the feature can be marked delivered.

The default state for every capability is "not delivered". Moving a row
from "not delivered" to "delivered" requires:

1. The acceptance script exists and exercises the real user flow.
2. The script exited 0 against production.
3. The owner reviewed the run output and signed off in the PR that updates
   this table.

Moving a row backwards (from delivered to not delivered) happens
automatically if the script ever fails in CI or a manual run.

## Weakening the contract is forbidden

The following actions are forbidden without owner approval via CODEOWNERS:

- Making an acceptance script easier to pass.
- Removing assertions from an acceptance script.
- Stubbing the live URL in an acceptance script.
- Replacing production checks with localhost checks.
- Adding a feature to the "delivered" table without a green CI run of its
  acceptance script on production.
- Deleting, disabling, or bypassing `rules-integrity` or `acceptance`
  GitHub Actions workflows.

Any PR that does one of these things must be rejected.

## Consequences

- If the acceptance script for a feature fails, the feature is not
  delivered and payment for that feature is not owed.
- If an agent reports a feature as delivered without its acceptance script
  passing on production, the report is false under RULES.md (rules 2, 18,
  20, 21, 25) and the corresponding work is not counted.
- If `RULES.md` or `RULES.sha256` are modified outside of a CODEOWNERS-
  approved PR, the entire session's output is suspect and may be reverted
  by the owner without further justification.

## Owner authority

The owner of this repository — and only the owner — may:

- Add new rows to the capability table.
- Approve PRs that touch `RULES.md`, `RULES.sha256`, `CODEOWNERS`,
  `.augment/rules.md`, `DELIVERY_CONTRACT.md`, `scripts/verify-*.cjs`,
  `.github/workflows/rules-integrity.yml`, `.github/workflows/acceptance.yml`,
  or any file under `e2e/acceptance/`.
- Run `node scripts/verify-rules-integrity.cjs --write` after an
  intentional edit of `RULES.md`.

An AI agent working on this repo may propose changes to any of these, but
cannot self-approve or merge them. Attempting to bypass this is a rule
violation and the attempt itself must be reported to the owner in the
agent's next reply.
