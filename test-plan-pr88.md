# Test Plan — PR #88 (live vision + monitor image fix)

**Target:** https://kelionai.app (prod, post-merge redeploy — verified bundle contains `loremflickr` + `pointerdown` markers).
**Scope:** the two changes in PR #88. One regression probe for `show_on_monitor` kinds that were deliberately untouched.

---

## What changed (user-visible)

1. **Camera auto-start is now bulletproof on first visit.** Before: on a fresh Chrome profile, `getUserMedia` fired silently in a `useEffect` with no user gesture → browser denied quietly → Kelion's vision was dead until the user manually toggled the camera from the ⋯ menu. After: the effect also installs a one-shot `pointerdown` / `keydown` / `touchstart` listener so the very first interaction retries the call with a real gesture.

2. **`show_on_monitor('image', …)` works again.** Unsplash retired `source.unsplash.com` in 2024; every request returns `HTTP 503`. Replaced with `loremflickr.com/1280/720/{query}` which serves a topic-matched Flickr image directly.

Unchanged: `map`, `weather`, `video` (URL form), `wiki`, `web`, `clear`, the camera frame sender, the Gemini Live setup, the chat layout, the button panel.

---

## Flow 1 — Camera auto-start reaches Gemini Live (primary, tests fix #1)

Adversarial framing: if the one-shot gesture listener regressed or was never wired in, a first-visit user who never clicked the ⋯ → "Turn camera on" would end up with an unused camera stream and Kelion would answer every visual question with a hedged "I can't actually see you right now". That is the exact failure mode the fix targets.

**Pre-state:** fresh Chrome profile, no prior camera permission for `kelionai.app`. Signed in as `adrianenc11@gmail.com` via the email+password modal.

| # | Action | Expected (must match exactly) |
|---|---|---|
| 1.1 | Visit `https://kelionai.app/` with a fresh profile. Do not click anything yet. Wait 3 s. | No Chrome camera permission bubble appears (no gesture yet). `navigator.permissions.query({name:'camera'})` returns `state: 'prompt'`. |
| 1.2 | Click once inside the 3D stage (any empty area). | Chrome camera permission bubble appears within 2 s. |
| 1.3 | Click **Allow** on the permission bubble. | The top-right "off-screen self-view" slot (existing component, not touched by this PR) starts showing the live webcam feed. `document.querySelector('video')[0].srcObject.getVideoTracks()[0].readyState === 'live'`. |
| 1.4 | Start a voice session (tap the mic / greeting button — existing flow). Say aloud: **"What color am I wearing right now?"** | Kelion's spoken reply references a *concrete visible detail* (color of the shirt, glasses, background). A reply of "I can't see you / enable your camera" = FAIL. |
| 1.5 | Open DevTools → Network → WebSocket frame log for `wss://generativelanguage.googleapis.com/...`. | Outgoing frames labelled `realtimeInput` with `video/jpeg` inlineData at ~15 fps (≥ 10 per second). Absence of any video frames = FAIL (fix did not actually unblock the camera). |

Would this look identical if fix were broken? **No.** Without the gesture listener, step 1.2 would produce no prompt and step 1.5 would show zero video frames.

---

## Flow 2 — `show_on_monitor('image', …)` renders a LoremFlickr photo (primary, tests fix #2)

**Pre-state:** same signed-in voice session from flow 1.

| # | Action | Expected (must match exactly) |
|---|---|---|
| 2.1 | Say aloud: **"Show me a photo of mountains on the monitor."** | Kelion narrates briefly ("let me put that up" / similar). Within ~3 s the 3D monitor stops showing the idle grid and starts loading content. |
| 2.2 | DevTools → Elements → find the `<img>` inside `StageMonitorContent`'s `drei <Html>` layer. | `<img src>` matches `^https://loremflickr\.com/1280/720/.*mountain.*$`. An `<img src="https://source.unsplash.com/...">` or a blank monitor = FAIL (fix regressed / didn't ship). |
| 2.3 | DevTools → Network → find the request to the `src` above. | HTTP status **200** (after LoremFlickr's 302 → `/cache/resized/...jpg`). Content-Type `image/jpeg`. Body > 10 kB. A 503 = FAIL. |
| 2.4 | Visually confirm the 3D monitor plane shows a mountain photo, not an idle grid or a broken-image icon. | Screenshot shows a photograph mapped to the monitor plane. |

Would this look identical if fix were broken? **No.** Pre-fix, step 2.3 returned 503 and step 2.4 showed a broken-image icon.

---

## Flow 3 — Regression probe: `map` kind still works (tests no-regression claim)

Single probe because the `image` kind was the only resolver touched; other kinds re-use their own URL generators.

| # | Action | Expected |
|---|---|---|
| 3.1 | Say aloud: **"Show me Cluj on a map."** | 3D monitor swaps to a Google Maps iframe. DevTools → Elements: the iframe `src` starts with `https://www.google.com/maps?q=Cluj&output=embed`. Map tiles for Cluj-Napoca visible. |

If this fails we have a real regression to investigate even though we didn't touch this code path.

---

## Explicit non-goals

- Not re-testing every `show_on_monitor` kind (weather / video / wiki / web / clear) — they share no code with the changed resolver.
- Not re-testing memory / time / location context (user asked separately; code inspection showed these are implemented server-side in `realtime.js:33-118` but they are outside PR #88's diff). If time allows at the end I'll run one sanity probe ("What time is it / where am I?") but I will label it clearly as out-of-scope regression.
- Not retesting the JWT / admin bootstrap / credits paths from previous PRs.

---

## Evidence to capture

- Screen recording covering all of flow 1 and flow 2 end-to-end, with `record_annotate` markers on each test_start / assertion.
- One screenshot per failing assertion (if any).
- DevTools screenshots: (a) WebSocket outgoing `realtimeInput.video` frames count, (b) monitor `<img src>` attribute, (c) LoremFlickr response 200.
- One GitHub comment on PR #88 with the consolidated report.
