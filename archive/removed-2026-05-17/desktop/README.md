# Kelion Desktop

Electron shell that packages `kelionai.app` as a native macOS / Windows / Linux app.
Same approach as the mobile apps (see `MOBILE.md`): the shell is a thin WebView
around the hosted web app, so all web UI updates ship instantly to every installed
desktop app the moment Railway redeploys — no rebuild / resubmit needed for normal
feature work.

Rebuild + redistribute only when:

- Native permissions change (`desktop/build/entitlements.mac.plist`, Windows
  capabilities in `desktop/package.json → build.win`).
- New Electron major version.
- App icon / splash / bundle id / version changes.
- Deep-link schemes change.

## Dev loop

From the repo root:

```bash
# one-time
cd desktop && npm install

# run the app against production kelionai.app
npm start

# or run against a local vite dev server + local backend
KELION_APP_URL=http://localhost:5173 npm run dev
```

The Electron window loads `https://kelionai.app` by default. Override with
`KELION_APP_URL=…` to point at staging or a local dev server.

## Build installers

```bash
cd desktop
npm run dist:mac      # → desktop/release/*.dmg + *.zip (arm64 + x64)
npm run dist:win      # → desktop/release/*.exe  (NSIS + portable)
npm run dist:linux    # → desktop/release/*.AppImage + *.deb
```

Outputs are gitignored and uploaded to GitHub Releases by the
`desktop-build.yml` workflow on tag pushes.

## Smoke test (runs in CI, no display required)

```bash
cd desktop && npm test
```

Validates `package.json`, `main.cjs` and `preload.cjs` without launching Electron.

## Deep links

Custom scheme: `kelion://`. On macOS, `open -g kelion://session/abc123` focuses
the running app and forwards the URL to the renderer via the `deep-link` event.

```js
window.kelion.on('deep-link', (url) => {
  // e.g. route the user to /chat?resume=abc123
});
```

## Native menu → renderer bridge

```js
window.kelion.on('new-session', () => {
  // triggered by File → New Session (Cmd/Ctrl+N)
});
```

## Distribution

Installers are produced by `electron-builder` on GitHub Actions runners
(macOS-14 for `.dmg`, windows-latest for `.exe`, ubuntu-latest for `.AppImage`).
Signing + notarization happen only on tagged builds (`v*`) and require the
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and
`CSC_LINK` / `CSC_KEY_PASSWORD` secrets to be present. Without them, builds
still succeed but produce an unsigned binary (fine for local testing and
nightly internal builds).
