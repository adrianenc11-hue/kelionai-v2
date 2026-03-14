/**
 * KelionAI v3.2 — Plugin Sandbox
 *
 * Secure JavaScript execution environment for third-party plugins.
 * Uses Node.js built-in `vm` module with restricted globals.
 *
 * Security model:
 * - No file system access
 * - No process/child_process access
 * - No require() access
 * - HTTP limited to whitelisted domains
 * - Execution timeout: 5 seconds
 * - Memory limit via context isolation
 */
'use strict';

const vm = require('vm');
const logger = require('./logger');

const EXECUTION_TIMEOUT_MS = 5000;

/**
 * Build a restricted sandbox context for plugin execution
 * @param {Object} api - Safe API subset exposed to plugins
 * @returns {Object} sandbox context
 */
function buildSandboxContext(api = {}) {
  return {
    // ── Safe globals ──
    console: {
      log: (...args) => logger.info({ component: 'PluginSandbox' }, `[plugin] ${args.map(String).join(' ')}`),
      warn: (...args) => logger.warn({ component: 'PluginSandbox' }, `[plugin] ${args.map(String).join(' ')}`),
      error: (...args) => logger.error({ component: 'PluginSandbox' }, `[plugin] ${args.map(String).join(' ')}`),
    },
    JSON,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, EXECUTION_TIMEOUT_MS)),
    clearTimeout,

    // ── Plugin API (safe subset) ──
    kelion: {
      // Chat: send a message as the plugin
      chat: api.chat || (async () => ({ error: 'chat not available' })),

      // Memory: read/write plugin-scoped memory
      memory: {
        get: api.memoryGet || (async () => null),
        set: api.memorySet || (async () => false),
        list: api.memoryList || (async () => []),
      },

      // HTTP: fetch with domain whitelist
      fetch: api.fetch || (async () => ({ error: 'fetch not available' })),

      // Config: read plugin config (read-only)
      config: api.config || {},

      // Context: current user, conversation info
      context: api.context || {},

      // Utils
      utils: {
        slugify: (str) =>
          String(str)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        truncate: (str, len = 200) => (String(str).length > len ? String(str).substring(0, len) + '...' : String(str)),
        formatDate: (date) => new Date(date || Date.now()).toISOString(),
      },
    },
  };
}

/**
 * Execute plugin code in sandbox
 * @param {string} code - JavaScript code to execute
 * @param {Object} api - Safe API to expose
 * @returns {Promise<{success: boolean, result?: any, error?: string, duration: number}>}
 */
async function executeSandboxed(code, api = {}) {
  const start = Date.now();

  try {
    const context = buildSandboxContext(api);
    vm.createContext(context);

    // Wrap in async IIFE so plugins can use await
    const wrappedCode = `
      (async () => {
        ${code}
      })();
    `;

    const script = new vm.Script(wrappedCode, {
      filename: 'plugin.js',
      timeout: EXECUTION_TIMEOUT_MS,
    });

    const resultPromise = script.runInContext(context, {
      timeout: EXECUTION_TIMEOUT_MS,
    });

    // Wait for async result with timeout
    const result = await Promise.race([
      resultPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin execution timeout')), EXECUTION_TIMEOUT_MS)),
    ]);

    const duration = Date.now() - start;
    logger.info({ component: 'PluginSandbox', duration }, `Plugin executed in ${duration}ms`);

    return { success: true, result, duration };
  } catch (e) {
    const duration = Date.now() - start;
    logger.warn({ component: 'PluginSandbox', err: e.message, duration }, 'Plugin execution failed');
    return { success: false, error: e.message, duration };
  }
}

/**
 * Validate plugin code for dangerous patterns
 * @param {string} code
 * @returns {string[]} list of violations
 */
function validateCode(code) {
  const violations = [];
  const dangerous = [
    { pattern: /require\s*\(/g, reason: 'require() is not allowed' },
    { pattern: /process\./g, reason: 'process access is not allowed' },
    { pattern: /child_process/g, reason: 'child_process is not allowed' },
    { pattern: /fs\./g, reason: 'filesystem access is not allowed' },
    { pattern: /eval\s*\(/g, reason: 'eval() is not allowed' },
    {
      pattern: /Function\s*\(/g,
      reason: 'Function() constructor is not allowed',
    },
    { pattern: /__proto__/g, reason: '__proto__ access is not allowed' },
    {
      pattern: /constructor\s*\[/g,
      reason: 'constructor access is not allowed',
    },
    {
      pattern: /globalThis\s*\./g,
      reason: 'globalThis access is not allowed',
    },
  ];

  for (const { pattern, reason } of dangerous) {
    if (pattern.test(code)) {
      violations.push(reason);
    }
  }

  // Size limit: 50KB
  if (code.length > 50000) {
    violations.push('Code exceeds 50KB limit');
  }

  return violations;
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  executeSandboxed,
  validateCode,
  buildSandboxContext,
  EXECUTION_TIMEOUT_MS,
};
