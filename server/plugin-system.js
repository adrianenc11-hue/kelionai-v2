/**
 * KelionAI v3.2 — Plugin System (Enhanced)
 *
 * Full plugin lifecycle: discover → validate → install → sandbox execute → uninstall
 * Plugin types: command, middleware, widget
 * Storage: Supabase brain_plugins + local server/plugins/ directory
 *
 * Features:
 * - Sandboxed execution via vm module
 * - Local plugin auto-discovery from server/plugins/
 * - Manifest validation + code security checks
 * - Middleware hooks (beforeResponse, afterResponse)
 * - Admin API for CRUD operations
 * - Persistent state via Supabase
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { executeSandboxed, validateCode } = require('./plugin-sandbox');

const router = express.Router();

// ═══ IN-MEMORY PLUGIN REGISTRY ═══
const installedPlugins = new Map(); // id → { manifest, module, status, type }

// ═══ BUILT-IN PLUGINS ═══
const BUILTIN_PLUGINS = [
  {
    id: 'search-tavily',
    name: 'Tavily Search',
    version: '1.0.0',
    description: 'AI-optimized web search with summarized results',
    author: 'KelionAI',
    icon: '🔍',
    category: 'search',
    builtin: true,
    status: 'active',
    type: 'builtin',
    endpoints: [{ method: 'POST', path: '/api/brain/search', description: 'Web search' }],
    auth: { type: 'api_key', envKey: 'TAVILY_API_KEY' },
  },
  {
    id: 'tts-elevenlabs',
    name: 'ElevenLabs TTS',
    version: '3.0.0',
    description: 'Natural text-to-speech with emotion control and voice cloning',
    author: 'KelionAI',
    icon: '🎙️',
    category: 'voice',
    builtin: true,
    status: 'active',
    type: 'builtin',
    endpoints: [
      {
        method: 'POST',
        path: '/api/voice/tts',
        description: 'Text to speech',
      },
    ],
    auth: { type: 'api_key', envKey: 'ELEVENLABS_API_KEY' },
  },
  {
    id: 'vision-gpt',
    name: 'GPT Vision',
    version: '5.4.0',
    description: 'Image analysis, OCR, scene description with GPT-5.4',
    author: 'KelionAI',
    icon: '👁️',
    category: 'vision',
    builtin: true,
    status: 'active',
    type: 'builtin',
    endpoints: [
      {
        method: 'POST',
        path: '/api/vision/analyze',
        description: 'Analyze image',
      },
    ],
    auth: { type: 'api_key', envKey: 'OPENAI_API_KEY' },
  },
  {
    id: 'trading-engine',
    name: 'Trading Intelligence',
    version: '2.0.0',
    description: '11 technical indicators, AI scoring, paper trading',
    author: 'KelionAI',
    icon: '📈',
    category: 'finance',
    builtin: true,
    status: 'active',
    type: 'builtin',
    endpoints: [
      {
        method: 'GET',
        path: '/api/trading/analysis',
        description: 'Market analysis',
      },
    ],
    auth: { type: 'none' },
  },
];

// Load builtins on startup
BUILTIN_PLUGINS.forEach((p) => installedPlugins.set(p.id, p));

// ═══ LOCAL PLUGIN DISCOVERY ═══
function discoverLocalPlugins() {
  const pluginsDir = path.join(__dirname, 'plugins');
  if (!fs.existsSync(pluginsDir)) return;

  const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.js'));
  let loaded = 0;

  for (const file of files) {
    try {
      const pluginPath = path.join(pluginsDir, file);
      const pluginModule = require(pluginPath);

      if (!pluginModule.manifest || !pluginModule.manifest.id) {
        logger.warn({ component: 'Plugin', file }, `Skipping ${file}: no manifest.id`);
        continue;
      }

      const m = pluginModule.manifest;
      installedPlugins.set(m.id, {
        ...m,
        status: m.status || 'active',
        local: true,
        module: pluginModule, // Keep reference to hooks
        loadedFrom: pluginPath,
      });

      loaded++;
      logger.info({ component: 'Plugin', id: m.id, type: m.type }, `🔌 Local plugin loaded: ${m.name} v${m.version}`);
    } catch (e) {
      logger.warn({ component: 'Plugin', file, err: e.message }, `Failed to load local plugin: ${file}`);
    }
  }

  if (loaded > 0) {
    logger.info({ component: 'Plugin', count: loaded }, `🔌 ${loaded} local plugins discovered`);
  }
}

// Auto-discover on module load
discoverLocalPlugins();

// ═══ PLUGIN MANIFEST VALIDATION ═══
function validateManifest(manifest) {
  const errors = [];
  if (!manifest.id || typeof manifest.id !== 'string') errors.push('id required (string)');
  if (!manifest.name || manifest.name.length < 2) errors.push('name required (min 2 chars)');
  if (!manifest.version) errors.push('version required (semver)');
  if (!manifest.description) errors.push('description required');
  if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) errors.push('id must be lowercase alphanumeric with hyphens');
  if (manifest.type && !['command', 'middleware', 'widget', 'builtin'].includes(manifest.type))
    errors.push('type must be: command, middleware, widget');
  return errors;
}

// ═══ MIDDLEWARE HOOKS ═══

/**
 * Run all active middleware plugins' beforeResponse hook
 * @param {Object} ctx - { userMessage, userId, language, conversationId }
 * @returns {Object|null} modified context or null
 */
async function runBeforeResponseHooks(ctx) {
  for (const [_id, plugin] of installedPlugins) {
    if (plugin.type === 'middleware' && plugin.status === 'active' && plugin.module?.beforeResponse) {
      try {
        const result = await plugin.module.beforeResponse(ctx);
        if (result) {
          ctx = { ...ctx, ...result };
        }
      } catch (e) {
        logger.warn({ component: 'Plugin', pluginId: plugin.id, err: e.message }, 'beforeResponse hook failed');
      }
    }
  }
  return ctx;
}

/**
 * Run all active middleware plugins' afterResponse hook
 * @param {Object} ctx - { userMessage, aiResponse, userId, language }
 * @returns {Object|null} modifications or null
 */
async function runAfterResponseHooks(ctx) {
  let modifications = null;
  for (const [_id, plugin] of installedPlugins) {
    if (plugin.type === 'middleware' && plugin.status === 'active' && plugin.module?.afterResponse) {
      try {
        const result = await plugin.module.afterResponse(ctx);
        if (result) {
          modifications = { ...(modifications || {}), ...result };
        }
      } catch (e) {
        logger.warn({ component: 'Plugin', pluginId: plugin.id, err: e.message }, 'afterResponse hook failed');
      }
    }
  }
  return modifications;
}

// ═══ PLUGIN EXECUTOR ═══

/**
 * Execute a plugin command
 * @param {string} pluginId - Plugin ID
 * @param {string} action - Command or action name
 * @param {Object} params - Parameters
 * @param {Object} ctx - Context { userId, kelion }
 */
async function executePlugin(pluginId, action, params = {}, ctx = {}) {
  const plugin = installedPlugins.get(pluginId);
  if (!plugin) return { success: false, error: 'Plugin not found' };
  if (plugin.status !== 'active') return { success: false, error: 'Plugin is disabled' };

  // Auth check
  if (plugin.auth?.type === 'api_key' && plugin.auth.envKey) {
    if (!process.env[plugin.auth.envKey]) {
      return { success: false, error: `Missing env: ${plugin.auth.envKey}` };
    }
  }

  // Local plugin with module — call directly
  if (plugin.module?.onCommand) {
    try {
      const result = await plugin.module.onCommand({
        command: action,
        args: params.args || [],
        userId: ctx.userId,
        kelion: ctx.kelion || {},
      });
      return { success: true, ...result, plugin: plugin.name };
    } catch (e) {
      logger.warn({ component: 'Plugin', pluginId, err: e.message }, 'Plugin command failed');
      return { success: false, error: e.message, plugin: plugin.name };
    }
  }

  // Sandboxed code execution
  if (plugin.code) {
    const violations = validateCode(plugin.code);
    if (violations.length > 0) {
      return {
        success: false,
        error: `Code security violations: ${violations.join(', ')}`,
      };
    }

    return executeSandboxed(plugin.code, {
      config: plugin.config || {},
      context: { userId: ctx.userId, action, params },
    });
  }

  // Builtin plugins — route through internal handlers
  if (plugin.builtin && plugin.endpoints?.length > 0) {
    const endpoint = plugin.endpoints.find(
      (ep) => ep.path.includes(action) || ep.description?.toLowerCase().includes(action.toLowerCase())
    );
    if (endpoint) {
      return {
        success: true,
        route: endpoint.path,
        params,
        plugin: plugin.name,
      };
    }
  }

  return { success: false, error: 'No executable handler found' };
}

// ═══ API ROUTES ═══

// GET /api/plugins — List all installed plugins
router.get('/', (_req, res) => {
  const plugins = [...installedPlugins.values()].map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    author: p.author || 'Unknown',
    icon: p.icon || '🔌',
    category: p.category || 'general',
    status: p.status,
    type: p.type || 'builtin',
    builtin: p.builtin || false,
    local: p.local || false,
    hasAuth: !!p.auth?.envKey && !!process.env[p.auth?.envKey],
    endpoints: p.endpoints?.length || 0,
    commands: p.commands || [],
  }));
  res.json({ plugins, total: plugins.length });
});

// GET /api/plugins/stats — Plugin system stats
router.get('/stats', (_req, res) => {
  const all = [...installedPlugins.values()];
  res.json({
    total: all.length,
    active: all.filter((p) => p.status === 'active').length,
    disabled: all.filter((p) => p.status === 'disabled').length,
    builtin: all.filter((p) => p.builtin).length,
    local: all.filter((p) => p.local).length,
    custom: all.filter((p) => !p.builtin && !p.local).length,
    byCategory: all.reduce((acc, p) => {
      acc[p.category || 'general'] = (acc[p.category || 'general'] || 0) + 1;
      return acc;
    }, {}),
    byType: all.reduce((acc, p) => {
      acc[p.type || 'unknown'] = (acc[p.type || 'unknown'] || 0) + 1;
      return acc;
    }, {}),
  });
});

// POST /api/plugins/install — Install a new plugin from manifest
router.post('/install', express.json(), async (req, res) => {
  try {
    const { manifest, code } = req.body;
    if (!manifest) return res.status(400).json({ error: 'manifest required' });

    const errors = validateManifest(manifest);
    if (errors.length > 0) return res.status(400).json({ error: 'Invalid manifest', errors });

    if (installedPlugins.has(manifest.id)) {
      return res.status(409).json({
        error: `Plugin ${manifest.id} already installed. Uninstall first.`,
      });
    }

    // Validate code if provided
    if (code) {
      const violations = validateCode(code);
      if (violations.length > 0) {
        return res.status(400).json({ error: 'Code security violations', violations });
      }
    }

    const plugin = {
      ...manifest,
      code: code || null,
      status: 'active',
      installedAt: new Date().toISOString(),
    };
    installedPlugins.set(manifest.id, plugin);

    // Persist to Supabase
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('brain_plugins')
        .upsert(
          {
            id: manifest.id,
            manifest: JSON.stringify(plugin),
            status: 'active',
            installed_by: 'admin',
            installed_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .catch(() => {});
    }

    logger.info({ component: 'Plugin', pluginId: manifest.id }, `🔌 Plugin installed: ${manifest.name}`);
    res.json({
      success: true,
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/plugins/:id — Uninstall plugin
router.delete('/:id', async (req, res) => {
  const pluginId = req.params.id;
  const plugin = installedPlugins.get(pluginId);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
  if (plugin.builtin) return res.status(403).json({ error: 'Cannot uninstall builtin plugins' });
  if (plugin.local)
    return res.status(403).json({ error: 'Cannot uninstall local plugins via API. Delete the file instead.' });

  installedPlugins.delete(pluginId);

  const { supabaseAdmin } = req.app.locals;
  if (supabaseAdmin) {
    await supabaseAdmin
      .from('brain_plugins')
      .delete()
      .eq('id', pluginId)
      .catch(() => {});
  }

  logger.info({ component: 'Plugin', pluginId }, `🔌 Plugin uninstalled: ${plugin.name}`);
  res.json({ success: true });
});

// POST /api/plugins/:id/toggle — Enable/disable plugin
router.post('/:id/toggle', async (req, res) => {
  const plugin = installedPlugins.get(req.params.id);
  if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

  plugin.status = plugin.status === 'active' ? 'disabled' : 'active';

  // Persist status change
  const { supabaseAdmin } = req.app.locals;
  if (supabaseAdmin && !plugin.builtin) {
    await supabaseAdmin
      .from('brain_plugins')
      .update({ status: plugin.status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .catch(() => {});
  }

  res.json({ success: true, id: req.params.id, status: plugin.status });
});

// POST /api/plugins/:id/execute — Execute plugin command
router.post('/:id/execute', express.json(), async (req, res) => {
  try {
    const result = await executePlugin(req.params.id, req.body.action, req.body.params, {
      userId: req.body.userId || 'admin',
      kelion: req.body.kelion || {},
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══ RESTORE FROM DB ═══
async function restorePlugins(supabase) {
  if (!supabase) return;
  try {
    const { data } = await supabase.from('brain_plugins').select('manifest, status').eq('status', 'active');
    if (data) {
      let restored = 0;
      data.forEach((row) => {
        try {
          const manifest = typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest;
          if (manifest.id && !manifest.builtin && !installedPlugins.has(manifest.id)) {
            installedPlugins.set(manifest.id, {
              ...manifest,
              status: row.status,
            });
            restored++;
          }
        } catch {
          /* ignored */
        }
      });
      if (restored > 0) {
        logger.info({ component: 'Plugin', count: restored }, `🔌 Restored ${restored} plugins from DB`);
      }
    }
  } catch {
    /* ignored */
  }
}

module.exports = {
  router,
  executePlugin,
  installedPlugins,
  restorePlugins,
  validateManifest,
  runBeforeResponseHooks,
  runAfterResponseHooks,
  discoverLocalPlugins,
};
