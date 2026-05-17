/* eslint-env node */
'use strict';

// ---------------------------------------------------------------------------
// Kelion Desktop — smoke test.
//
// This does NOT launch Electron (that would require a display in CI).
// Instead it exercises the static contract of the desktop package:
//
//   1. main.cjs and preload.cjs parse as valid Node modules.
//   2. package.json `main` points at an existing file.
//   3. package.json `build` has the expected electron-builder shape
//      (appId, mac/win/linux targets) — catches regressions where a
//      future PR accidentally empties the config.
//
// This runs in regular Node (no Electron binary) so it can execute in GitHub
// Actions without a runner display. A separate workflow (`desktop-build.yml`)
// does the real electron-builder build on each OS.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`[desktop-smoke] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[desktop-smoke] ok: ${msg}`);
}

// 1 — package.json sanity
const pkgPath = path.join(root, 'package.json');
if (!fs.existsSync(pkgPath)) fail('desktop/package.json missing');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== 'kelion-desktop') fail(`expected name=kelion-desktop, got ${pkg.name}`);
if (!pkg.main) fail('package.json missing `main`');
const mainAbs = path.join(root, pkg.main);
if (!fs.existsSync(mainAbs)) fail(`package.json main (${pkg.main}) does not exist`);
ok(`package.json → main → ${pkg.main}`);

// 2 — electron-builder shape
const build = pkg.build || {};
if (!build.appId) fail('build.appId missing');
if (!build.productName) fail('build.productName missing');
for (const os of ['mac', 'win', 'linux']) {
  if (!build[os] || !Array.isArray(build[os].target) || build[os].target.length === 0) {
    fail(`build.${os}.target missing or empty`);
  }
}
ok(`electron-builder config: ${build.appId} (${build.productName})`);

// 3 — parse main.cjs + preload.cjs without executing (syntax check only).
//     We *could* `require()` them, but that would pull in the `electron`
//     module, which is only present in Electron runtimes.
const vm = require('vm');
for (const rel of [pkg.main, 'src/preload.cjs']) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) fail(`${rel} missing`);
  const src = fs.readFileSync(abs, 'utf8');
  try {
    // Wrap like Node would; this validates syntax but never runs the code.
    new vm.Script(`(function(exports, require, module, __filename, __dirname){\n${src}\n})`, {
      filename: abs,
    });
  } catch (e) {
    fail(`${rel} failed to parse: ${e.message}`);
  }
  ok(`${rel} parses cleanly`);
}

console.log('[desktop-smoke] all checks passed');
