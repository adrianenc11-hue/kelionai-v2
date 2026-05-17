# Archived projects (removed 2026-05-17)

This folder preserves the non-canonical projects that were removed from the active repository tree during consolidation to a server-first layout.

## Why archived

On 2026-05-17 the repository was consolidated so `server/` is the single canonical project for production and automation. The former desktop shell and root web-source trees were moved here before deletion from the active paths.

## Archived content

- `desktop/` — full Electron desktop project as it existed before removal.
- `web-root/` — root web/mobile source snapshot copied from:
  - `android/`
  - `ios/`
  - `src/`
  - `public/`
  - `extension/`
  - `index.html`
  - `vite.config.js`
  - `postcss.config.cjs`
  - `tailwind.config.js`
  - `capacitor.config.json`
  - `playwright.config.cjs`

## Restore options

### Option A (recommended full rollback)

Restore from backup branch created before destructive changes:

```bash
git fetch origin backup/pre-consolidation-2026-05-17
# inspect
git checkout backup/pre-consolidation-2026-05-17
```

### Option B (restore only archived trees)

```bash
# from the consolidation branch
git checkout backup/pre-consolidation-2026-05-17 -- desktop android ios src public extension index.html vite.config.js postcss.config.cjs tailwind.config.js capacitor.config.json playwright.config.cjs
```
