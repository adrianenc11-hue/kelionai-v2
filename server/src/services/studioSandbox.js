'use strict';

// Dev Studio (DS-3) — E2B sandbox wiring for per-user Python projects.
//
// This module is the ONLY place in the backend that talks to
// `@e2b/code-interpreter`. Routes (server/src/routes/studio.js) call
// `runWorkspace({files, entry, installFirst, ...})` and get back a
// structured `{pip, run, duration_ms}` payload, never a live sandbox
// handle — the sandbox is created, hydrated, commanded, and killed
// inside one function call. This keeps resource accounting tight on
// E2B's free tier (100 h/mo — see scoping doc, answer 1A) and removes
// any chance of leaking a sandbox when a request aborts.
//
// Tests inject a fake Sandbox class via `__setSandboxImplForTests`
// so the Jest suite never touches the real E2B service. See
// server/__tests__/studio-sandbox.test.js.
//
// The routes contract is: DS-1 persists files in Postgres as JSON
// TEXT; DS-3 hydrates those files into `/home/user/project/` in a
// fresh Linux sandbox; then runs `pip install -r requirements.txt`
// (if present) followed by `python <entry>`. We do NOT keep the
// sandbox warm between requests — a voice call like "run it again"
// is a fresh sandbox. DS-8 will re-use sandboxes for Railway deploy
// sessions; until then the per-call overhead is ~2-3 s spin-up, which
// is fine for the first demo.

const SANDBOX_ROOT = '/home/user/project';

// E2B SDK is loaded lazily so the server still boots in environments
// without `@e2b/code-interpreter` (e.g. local dev without the SDK
// installed). A `null` cached value means "we tried and it failed",
// which is distinct from `undefined` ("we haven't tried yet").
let _SandboxClass;
let _testOverride = null;

async function getSandboxClass() {
  if (_testOverride) return _testOverride;
  if (_SandboxClass === undefined) {
    try {
      // eslint-disable-next-line global-require
      _SandboxClass = require('@e2b/code-interpreter').Sandbox || null;
    } catch (_) {
      _SandboxClass = null;
    }
  }
  return _SandboxClass;
}

// Test-only: override the Sandbox class used by runWorkspace. Pass
// `null` to restore real loading. Production code never calls this.
function __setSandboxImplForTests(impl) {
  _testOverride = impl || null;
}

// Shell-quote a single argument for `bash -c`. DS-1's
// `sanitizeStudioPath` already rejects backslash/NUL/.., so `path`
// only contains printable ASCII + Unicode — still, we wrap in single
// quotes to survive spaces in file names.
function shellEscape(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

// Truncate long stdout/stderr so a chatty `print` loop can't balloon
// the JSON response to megabytes. 64 KB per stream is plenty for a
// chat-style UI and matches what the existing `run_code` tool does
// in realTools.js (cap = 8 KB there; we allow more here because this
// is a full program, not a one-shot snippet).
const MAX_STREAM_BYTES = 64 * 1024;
function capStream(s) {
  const t = typeof s === 'string' ? s : '';
  if (t.length <= MAX_STREAM_BYTES) return t;
  return t.slice(0, MAX_STREAM_BYTES) + '\n[truncated, output exceeded 64 KB]';
}

// Hydrate the workspace into /home/user/project/ inside the sandbox.
// We use one `files.write` call per file so errors have useful
// context (the E2B batch-write shape doesn't surface which entry
// failed). Directories are created implicitly by `files.write` when
// supported, but we also makeDir for parent directories defensively.
async function hydrateFiles(sandbox, files) {
  const entries = Object.entries(files || {});
  if (typeof sandbox.files?.makeDir === 'function') {
    try { await sandbox.files.makeDir(SANDBOX_ROOT); } catch (_) { /* may already exist */ }
  }
  for (const [path, entry] of entries) {
    const abs = `${SANDBOX_ROOT}/${path}`;
    const content = typeof entry?.content === 'string' ? entry.content : '';
    // Make sure intermediate directories exist. The SDK sometimes
    // auto-creates them, sometimes not (varies by template); the
    // idempotent try/catch keeps us portable.
    const slashIdx = abs.lastIndexOf('/');
    if (slashIdx > SANDBOX_ROOT.length && typeof sandbox.files?.makeDir === 'function') {
      try { await sandbox.files.makeDir(abs.slice(0, slashIdx)); } catch (_) { /* ignore */ }
    }
    await sandbox.files.write(abs, content);
  }
}

// Normalize the result of `sandbox.commands.run`. E2B throws a
// `CommandExitError` on non-zero exit by default, which still carries
// stdout/stderr/exitCode fields — so we catch it and rebuild a plain
// `{stdout, stderr, exit_code}` shape. Real transport errors (no
// exitCode field) bubble up as `exit_code: -1` with the error message
// in stderr, so the UI always has something to show.
function normalizeCommandResult(err, ok) {
  if (ok) {
    return {
      stdout: capStream(ok.stdout || ''),
      stderr: capStream(ok.stderr || ''),
      exit_code: typeof ok.exitCode === 'number' ? ok.exitCode : 0,
    };
  }
  if (err && typeof err.exitCode === 'number') {
    return {
      stdout: capStream(err.stdout || ''),
      stderr: capStream(err.stderr || err.message || ''),
      exit_code: err.exitCode,
    };
  }
  return {
    stdout: '',
    stderr: capStream((err && err.message) ? err.message : String(err || 'command failed')),
    exit_code: -1,
  };
}

async function tryRun(sandbox, cmd, opts) {
  try {
    const res = await sandbox.commands.run(cmd, opts);
    return normalizeCommandResult(null, res);
  } catch (err) {
    return normalizeCommandResult(err, null);
  }
}

/**
 * Run a workspace in a fresh E2B sandbox.
 *
 * @param {object} opts
 * @param {object} opts.files         Workspace files map: `{ '<path>': { content, size, updated_at } }`.
 *                                    Same shape as DS-1 stores in Postgres.
 * @param {string|null} opts.entry    Path (relative to workspace) to run with `python`. `null` / `''`
 *                                    skips the run step (install-only mode).
 * @param {boolean} opts.installFirst If true AND `requirements.txt` exists in `files`, run
 *                                    `pip install -r requirements.txt` before the entry. Failed pip
 *                                    install still proceeds to the run step so the user sees both
 *                                    logs — it's cheap (the run will error with ModuleNotFoundError).
 * @param {number} [opts.timeoutMs]   Per-command timeout. Clamped to [1 000, 120 000].
 * @param {string} opts.apiKey        E2B API key. Routes pull this from `process.env.E2B_API_KEY`.
 * @param {object} [opts.env]         Extra env vars for the commands (merged with sandbox defaults).
 *
 * @returns {Promise<{pip: object|null, run: object|null, duration_ms: number}>}
 *          `pip` and `run` each contain `{stdout, stderr, exit_code}`. Either can be `null` if the
 *          corresponding step was skipped.
 *
 * @throws  `Error` with `.studioSandbox = 'UNAVAILABLE'` if the E2B SDK is not installed.
 *          `Error` with `.studioSandbox = 'CREATE_FAILED'` if `Sandbox.create` throws.
 */
async function runWorkspace(opts) {
  const {
    files = {},
    entry = null,
    installFirst = true,
    timeoutMs,
    apiKey,
    env,
  } = opts || {};

  const cappedTimeout = Math.max(1000, Math.min(120_000, Number(timeoutMs) || 30_000));
  // Sandbox lives a bit longer than the command itself so `kill()`
  // has room to flush. E2B defaults to 5 min; we use command+60s.
  const sandboxTimeout = cappedTimeout + 60_000;

  const SandboxCls = await getSandboxClass();
  if (!SandboxCls || typeof SandboxCls.create !== 'function') {
    const err = new Error('E2B SDK not installed — set E2B_API_KEY and install @e2b/code-interpreter');
    err.studioSandbox = 'UNAVAILABLE';
    throw err;
  }

  const startedAt = Date.now();
  const hasRequirements = Boolean(files && files['requirements.txt']);
  const doInstall = Boolean(installFirst && hasRequirements);
  const doRun = typeof entry === 'string' && entry.length > 0;

  let sandbox = null;
  let pip = null;
  let run = null;
  try {
    try {
      sandbox = await SandboxCls.create({ apiKey, timeoutMs: sandboxTimeout });
    } catch (err) {
      const wrapped = new Error(`sandbox create failed: ${err && err.message ? err.message : err}`);
      wrapped.studioSandbox = 'CREATE_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }

    await hydrateFiles(sandbox, files);

    const cmdOpts = {
      cwd: SANDBOX_ROOT,
      timeoutMs: cappedTimeout,
      ...(env && typeof env === 'object' ? { envs: env } : {}),
    };

    if (doInstall) {
      // --disable-pip-version-check keeps stderr free of the "new
      // pip available" nag that otherwise clutters the UI terminal.
      pip = await tryRun(sandbox, 'pip install --disable-pip-version-check -r requirements.txt', cmdOpts);
    }

    if (doRun) {
      run = await tryRun(sandbox, `python -u ${shellEscape(entry)}`, cmdOpts);
    }
  } finally {
    if (sandbox && typeof sandbox.kill === 'function') {
      try { await sandbox.kill(); } catch (_) { /* no-op */ }
    }
  }

  return {
    pip,
    run,
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  runWorkspace,
  __setSandboxImplForTests,
  SANDBOX_ROOT,
  MAX_STREAM_BYTES,
};
