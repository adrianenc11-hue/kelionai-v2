'use strict';

/**
 * @fileoverview agentSandbox.js — Kelion Sandboxed Code Execution
 *
 * Provides isolated JavaScript execution for the autonomous agent.
 * Uses `isolated-vm` (V8 Isolates) for memory and CPU-safe code execution.
 *
 * Fallback: If `isolated-vm` is not available (e.g. local dev without
 * native compilation), falls back to Node.js `vm` module with timeout
 * (less secure, but functional for development).
 *
 * Safety:
 * - Memory limit: 128 MB per execution
 * - CPU timeout: 10s default, 60s max
 * - No filesystem, no network, no process access
 * - Whitelisted globals: console, JSON, Math, Date, Array, Object, String,
 *   Number, Boolean, RegExp, Map, Set, Promise, parseInt, parseFloat
 * - Output capture: console.log/warn/error redirected to output buffer
 *
 * @module services/agentSandbox
 */

// ── Isolated-VM loader (graceful fallback) ───────────────────────
let _ivm = undefined; // undefined = not tried yet, null = unavailable

function _getIvm() {
  if (_ivm === undefined) {
    try {
      _ivm = require('isolated-vm');
    } catch (_) {
      console.warn('[agentSandbox] isolated-vm not available — using vm fallback (less secure).');
      _ivm = null;
    }
  }
  return _ivm;
}

// ── Constants ────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MEMORY_LIMIT_MB = 128;
const MAX_OUTPUT_LENGTH = 64 * 1024; // 64 KB

// ── Static validation patterns ───────────────────────────────────
const BLOCKED_PATTERNS = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bglobalThis\b/,
  /\bBuffer\b/,
  /\bchild_process\b/,
  /\bfs\b\.\s*(read|write|unlink|mkdir|rmdir|stat|open)/,
];

/**
 * Validate code for obvious escape attempts before execution.
 * @param {string} code
 * @returns {{ ok: boolean, violations?: string[] }}
 */
function validateCode(code) {
  if (!code || typeof code !== 'string') return { ok: false, violations: ['No code provided.'] };
  const violations = [];
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      violations.push(`Blocked pattern: ${pattern.source}`);
    }
  }
  return { ok: violations.length === 0, violations: violations.length ? violations : undefined };
}

/**
 * Execute JavaScript code in an isolated V8 sandbox.
 *
 * @param {string} code — JavaScript source to execute
 * @param {object} [opts]
 * @param {number} [opts.timeout=10000] — max execution time in ms
 * @param {object} [opts.globals={}] — extra global variables to inject
 * @returns {Promise<{ok, result?, output?, error?, duration_ms}>}
 */
async function executeJs(code, opts = {}) {
  if (!code || typeof code !== 'string') {
    return { ok: false, error: 'No code provided.', output: '', duration_ms: 0 };
  }

  // Pre-validate
  const validation = validateCode(code);
  if (!validation.ok) {
    return { ok: false, error: `Code validation failed: ${validation.violations.join('; ')}`, output: '', duration_ms: 0 };
  }

  const timeout = Math.max(1000, Math.min(MAX_TIMEOUT_MS, Number(opts.timeout) || DEFAULT_TIMEOUT_MS));
  const started = Date.now();

  const ivm = _getIvm();
  if (ivm) {
    return _executeIsolatedVm(ivm, code, timeout, opts.globals);
  }
  return _executeVmFallback(code, timeout, opts.globals);
}

// ── Isolated-VM execution (production) ───────────────────────────
async function _executeIsolatedVm(ivm, code, timeout, extraGlobals = {}) {
  const started = Date.now();
  let isolate = null;

  try {
    isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    const context = await isolate.createContext();
    const jail = context.global;

    // Inject console capture
    const outputLines = [];
    const logCallback = new ivm.Callback((...args) => {
      const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      if (outputLines.join('\n').length < MAX_OUTPUT_LENGTH) {
        outputLines.push(line);
      }
    });

    await jail.set('_log', logCallback);
    await context.eval(`
      const console = {
        log: (...args) => _log(...args),
        warn: (...args) => _log('[WARN]', ...args),
        error: (...args) => _log('[ERROR]', ...args),
        info: (...args) => _log('[INFO]', ...args),
      };
    `);

    // Inject extra globals
    for (const [key, value] of Object.entries(extraGlobals || {})) {
      const safeKey = String(key).replace(/[^a-zA-Z0-9_$]/g, '');
      if (safeKey) {
        await jail.set(safeKey, new ivm.ExternalCopy(value).copyInto());
      }
    }

    // Execute
    const script = await isolate.compileScript(code);
    const result = await script.run(context, { timeout });

    const output = outputLines.join('\n');
    const serialized = result !== undefined
      ? (typeof result === 'object' ? JSON.stringify(result) : String(result))
      : undefined;

    return {
      ok: true,
      result: serialized?.slice(0, MAX_OUTPUT_LENGTH),
      output: output.slice(0, MAX_OUTPUT_LENGTH),
      duration_ms: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      output: '',
      duration_ms: Date.now() - started,
    };
  } finally {
    if (isolate) {
      try { isolate.dispose(); } catch (_) {}
    }
  }
}

// ── Node.js vm fallback (development only) ───────────────────────
async function _executeVmFallback(code, timeout, extraGlobals = {}) {
  const vm = require('vm');
  const started = Date.now();

  try {
    const outputLines = [];
    const mockConsole = {
      log: (...args) => {
        const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        if (outputLines.join('\n').length < MAX_OUTPUT_LENGTH) outputLines.push(line);
      },
      warn: (...args) => mockConsole.log('[WARN]', ...args),
      error: (...args) => mockConsole.log('[ERROR]', ...args),
      info: (...args) => mockConsole.log('[INFO]', ...args),
    };

    const sandbox = {
      console: mockConsole,
      JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set,
      parseInt, parseFloat, isNaN, isFinite, undefined, NaN, Infinity,
      ...extraGlobals,
    };

    vm.createContext(sandbox);
    const script = new vm.Script(code, { timeout });
    const result = script.runInContext(sandbox, { timeout });

    const output = outputLines.join('\n');
    const serialized = result !== undefined
      ? (typeof result === 'object' ? JSON.stringify(result) : String(result))
      : undefined;

    return {
      ok: true,
      result: serialized?.slice(0, MAX_OUTPUT_LENGTH),
      output: output.slice(0, MAX_OUTPUT_LENGTH),
      duration_ms: Date.now() - started,
      _fallback: true,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      output: '',
      duration_ms: Date.now() - started,
      _fallback: true,
    };
  }
}

module.exports = { executeJs, validateCode };
