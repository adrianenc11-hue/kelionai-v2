# Dependency Management

This document explains intentional version pins and why certain Dependabot upgrade PRs were closed.

## Intentionally Pinned Dependencies

### `node-fetch` — pinned at `^2.7.0`

**Do not upgrade to v3.**

`node-fetch` v3 is **ESM-only** (uses `import` / `export` syntax). The entire codebase uses **CommonJS** (`require()`). Upgrading will crash the server immediately with:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module node-fetch not supported
```

**When to upgrade:** Only after the project is fully migrated to ESM (`"type": "module"` in `package.json` and all `require()` calls replaced with `import`).

---

### `express` — pinned at `^4.21.0`

**Do not upgrade to v5.**

Express v5 introduces breaking changes that would require significant refactoring:

- `res.status()` only accepts integers (rejects strings)
- Routing regex syntax changed (uses updated `path-to-regexp`)
- `body-parser` is now a separate package at `@2.x`
- Many middleware behaviours changed

**When to upgrade:** Only after a dedicated Express v5 migration effort that updates all routes, middleware, and error-handling code.

---

### `three` — pinned at `^0.160.0`

**Do not upgrade in a single jump.**

The Dependabot PR proposed jumping from `0.160.0` to `0.183.1` — 23 minor versions at once. Three.js makes frequent API changes and deprecations between minor versions. Skipping 23 versions risks breaking the 3D avatar system in hard-to-diagnose ways.

**When to upgrade:** Incrementally, one or two minor versions at a time, with manual testing of the 3D avatar after each step.

---

## Safe Upgrades

### `dotenv` — upgraded to `^17.3.1`

dotenv v17 is fully backward compatible for standard usage (`require('dotenv').config()`). No code changes are needed.
