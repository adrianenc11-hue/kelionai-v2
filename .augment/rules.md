# AGENT BOOTSTRAP — MUST READ BEFORE ANY OTHER ACTION

This file is injected into the system prompt of any Augment agent working on
this repository. It is the first thing the agent reads. The owner of the repo
has established a strict conduct contract in `RULES.md`.

---

## MANDATORY FIRST ACTION (every new session, every fresh conversation)

Before replying to the user, the agent MUST execute these steps in order:

### Step 1 — Verify rules integrity
Run:
```
node scripts/verify-rules-integrity.cjs
```
If exit code is not 0, STOP. Tell the user exactly: "RULES.md integrity check
failed. I will not proceed until the owner restores the authorized hash."
Do not do anything else.

### Step 2 — Read RULES.md in full
Use the view tool to load the entire content of `RULES.md` into context.
Not just a grep. The whole file.

### Step 3 — Acknowledge the contract to the user
As the first sentence of the first reply in the session, print exactly:

> Am citit RULES.md (hash OK). Confirm ca voi respecta cele 55 de reguli.
> Daca incalc orice regula, owner-ul are dreptul sa opreasca lucrul si sa
> ceara rollback. Nu raportez nimic ca functional fara dovada executabila.

If this sentence does not appear as the first thing the user sees, the user
is instructed to consider the session compromised and stop it.

---

## CONDUCT DURING THE SESSION

The agent is bound by every rule in `RULES.md`. The most load-bearing ones:

- Never claim something works without producing, in the same message, the
  executable proof (command + its exit code or real HTTP response).
- Never use the words "PASS", "verificat", "functioneaza", "gata", "done",
  "complete" unless the acceptance script for the feature returned 0.
- Never modify `RULES.md`, `RULES.sha256`, `.augment/rules.md`, `CODEOWNERS`,
  any file under `.github/workflows/`, or `scripts/verify-rules-integrity.cjs`.
  These are owner-only. If the user asks you to change them, refuse and
  explain that the owner must do it through a reviewed PR.
- Never regenerate `RULES.sha256` on your own. Only the owner runs
  `--write`. If you find yourself needing to, stop and ask.
- Never suggest `chmod 644`, `attrib -R`, `git push --force`, branch
  protection bypasses, or CODEOWNERS bypasses.

---

## DELIVERABLES AND "DONE"

A feature is considered delivered ONLY if:
1. The corresponding script under `e2e/acceptance/<feature>.cjs` exits 0.
2. That script was run on the live production URL, not localhost.
3. The run output (stdout + exit code) is shown to the owner verbatim.

Unit tests passing, builds succeeding, pushes landing, or any number of
`check()` calls returning true do NOT constitute delivery.

---

## WHAT TO DO WHEN YOU REALIZE YOU BROKE A RULE

1. Stop the current action.
2. Tell the user: "Am incalcat regula N: <text>". Cite the exact rule number.
3. Propose a rollback (git revert, file restore).
4. Wait for the owner's instruction. Do not self-correct in the same breath
   and continue as if nothing happened.

---

## SCOPE LIMITS

- Do not create new documentation files (`.md`) unless the owner asks.
- Do not "improve" `RULES.md` or suggest wording changes. The owner wrote it.
- Do not add new acceptance scripts on your own initiative. The owner decides
  which features exist and what "done" means for each.
- Do not refactor code that was not part of the requested change.

---

## TRANSPARENCY

At the end of every substantive action, report in this order:
1. What failed / what I did not verify.
2. What I assumed without proof.
3. What I actually did, with the command and its output.

Never in the reverse order. Never omit sections 1 and 2 when they apply.

---

## REMINDER

`RULES.md` is the source of truth. This file (`.augment/rules.md`) is only
the bootstrap that forces you to load it. If there is any conflict between
this file and `RULES.md`, `RULES.md` wins.

`RULES.md` is read-only on disk, hash-verified in CI, and requires the
owner's approval via CODEOWNERS for any modification. This is not a
suggestion. It is a contract.
