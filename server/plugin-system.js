/**
 * KelionAI — Plugin System
 * 
 * Standard schema for external tool plugins.
 * Plugins can be installed/uninstalled, have manifests, and execute via brain.
 * Supabase table: brain_plugins
 */
"use strict";

const express = require("express");
const logger = require("./logger");
const router = express.Router();

// ═══ PLUGIN MANIFEST SCHEMA ═══
// Each plugin must provide:
// {
//   id: "weather-pro",              // unique identifier
//   name: "Weather Pro",            // display name
//   version: "1.0.0",              // semver
//   description: "Advanced weather with hourly forecasts",
//   author: "Adrian",
//   icon: "🌤️",
//   endpoints: [
//     { method: "GET", path: "/forecast", description: "Get forecast" }
//   ],
//   auth: { type: "api_key", envKey: "WEATHER_PRO_KEY" },
//   inputSchema: { query: "string", location: "string" },
//   outputSchema: { forecast: "object" },
//   category: "utility",
//   pricing: "free"                 // "free" | "pro" | "premium"
// }

// ═══ IN-MEMORY PLUGIN REGISTRY ═══
const installedPlugins = new Map(); // id → manifest + status

// ═══ BUILT-IN PLUGINS ═══
const BUILTIN_PLUGINS = [
  {
    id: "search-tavily",
    name: "Tavily Search",
    version: "1.0.0",
    description: "AI-optimized web search with summarized results",
    author: "KelionAI",
    icon: "🔍",
    category: "search",
    builtin: true,
    status: "active",
    endpoints: [{ method: "POST", path: "/api/brain/search", description: "Web search" }],
    auth: { type: "api_key", envKey: "TAVILY_API_KEY" },
  },
  {
    id: "tts-elevenlabs",
    name: "ElevenLabs TTS",
    version: "3.0.0",
    description: "Natural text-to-speech with emotion control and voice cloning",
    author: "KelionAI",
    icon: "🎙️",
    category: "voice",
    builtin: true,
    status: "active",
    endpoints: [{ method: "POST", path: "/api/voice/tts", description: "Text to speech" }],
    auth: { type: "api_key", envKey: "ELEVENLABS_API_KEY" },
  },
  {
    id: "vision-gpt",
    name: "GPT Vision",
    version: "5.4.0",
    description: "Image analysis, OCR, scene description with GPT-5.4",
    author: "KelionAI",
    icon: "👁️",
    category: "vision",
    builtin: true,
    status: "active",
    endpoints: [{ method: "POST", path: "/api/vision/analyze", description: "Analyze image" }],
    auth: { type: "api_key", envKey: "OPENAI_API_KEY" },
  },
  {
    id: "trading-engine",
    name: "Trading Intelligence",
    version: "2.0.0",
    description: "11 technical indicators, AI scoring, paper trading",
    author: "KelionAI",
    icon: "📈",
    category: "finance",
    builtin: true,
    status: "active",
    endpoints: [{ method: "GET", path: "/api/trading/analysis", description: "Market analysis" }],
    auth: { type: "none" },
  },
];

// Load builtins on startup
BUILTIN_PLUGINS.forEach(p => installedPlugins.set(p.id, p));

// ═══ PLUGIN VALIDATION ═══
function validateManifest(manifest) {
  const errors = [];
  if (!manifest.id || typeof manifest.id !== "string") errors.push("id required (string)");
  if (!manifest.name || manifest.name.length < 2) errors.push("name required (min 2 chars)");
  if (!manifest.version) errors.push("version required (semver)");
  if (!manifest.description) errors.push("description required");
  if (!manifest.endpoints || !Array.isArray(manifest.endpoints)) errors.push("endpoints required (array)");
  if (manifest.endpoints) {
    for (const ep of manifest.endpoints) {
      if (!ep.method || !ep.path) errors.push(`endpoint missing method/path`);
    }
  }
  if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) errors.push("id must be lowercase alphanumeric with hyphens");
  return errors;
}

// ═══ PLUGIN EXECUTOR ═══
async function executePlugin(pluginId, action, params = {}) {
  const plugin = installedPlugins.get(pluginId);
  if (!plugin) return { success: false, error: "Plugin not found" };
  if (plugin.status !== "active") return { success: false, error: "Plugin is disabled" };

  // Check auth
  if (plugin.auth?.type === "api_key" && plugin.auth.envKey) {
    if (!process.env[plugin.auth.envKey]) {
      return { success: false, error: `Missing env: ${plugin.auth.envKey}` };
    }
  }

  // Find matching endpoint
  const endpoint = plugin.endpoints.find(ep =>
    ep.path.includes(action) || ep.description?.toLowerCase().includes(action.toLowerCase())
  );

  if (!endpoint) {
    return { success: false, error: `No endpoint matching: ${action}` };
  }

  // For builtin plugins, route through internal handlers
  if (plugin.builtin) {
    return { success: true, route: endpoint.path, params, plugin: plugin.name };
  }

  // For external plugins, make HTTP call
  try {
    const headers = { "Content-Type": "application/json" };
    if (plugin.auth?.type === "api_key" && plugin.auth.envKey) {
      headers["Authorization"] = `Bearer ${process.env[plugin.auth.envKey]}`;
    }

    const response = await fetch(endpoint.path, {
      method: endpoint.method || "POST",
      headers,
      body: endpoint.method === "POST" ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { success: true, data, plugin: plugin.name };
  } catch (e) {
    logger.warn({ component: "Plugin", pluginId, err: e.message }, "Plugin execution failed");
    return { success: false, error: e.message, plugin: plugin.name };
  }
}

// ═══ ROUTES ═══

// GET /api/plugins — List all installed plugins
router.get("/", (_req, res) => {
  const plugins = [...installedPlugins.values()].map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    author: p.author,
    icon: p.icon,
    category: p.category,
    status: p.status,
    builtin: p.builtin || false,
    endpoints: p.endpoints?.length || 0,
    hasAuth: !!p.auth?.envKey && !!process.env[p.auth.envKey],
  }));
  res.json({ plugins, total: plugins.length });
});

// POST /api/plugins/install — Install a new plugin from manifest
router.post("/install", express.json(), async (req, res) => {
  try {
    const { manifest } = req.body;
    if (!manifest) return res.status(400).json({ error: "manifest required" });

    // Validate
    const errors = validateManifest(manifest);
    if (errors.length > 0) return res.status(400).json({ error: "Invalid manifest", errors });

    // Check for conflicts
    if (installedPlugins.has(manifest.id)) {
      return res.status(409).json({ error: `Plugin ${manifest.id} already installed. Uninstall first.` });
    }

    // Install
    const plugin = { ...manifest, status: "active", installedAt: new Date().toISOString() };
    installedPlugins.set(manifest.id, plugin);

    // Persist to Supabase
    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin.from("brain_plugins").upsert({
        id: manifest.id,
        manifest: JSON.stringify(plugin),
        status: "active",
        installed_at: new Date().toISOString(),
      }, { onConflict: "id" }).catch(() => { });
    }

    logger.info({ component: "Plugin", pluginId: manifest.id }, `🔌 Plugin installed: ${manifest.name}`);
    res.json({ success: true, plugin: { id: manifest.id, name: manifest.name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/plugins/:id — Uninstall plugin
router.delete("/:id", async (req, res) => {
  const pluginId = req.params.id;
  const plugin = installedPlugins.get(pluginId);
  if (!plugin) return res.status(404).json({ error: "Plugin not found" });
  if (plugin.builtin) return res.status(403).json({ error: "Cannot uninstall builtin plugins" });

  installedPlugins.delete(pluginId);

  const { supabaseAdmin } = req.app.locals;
  if (supabaseAdmin) {
    await supabaseAdmin.from("brain_plugins").delete().eq("id", pluginId).catch(() => { });
  }

  logger.info({ component: "Plugin", pluginId }, `🔌 Plugin uninstalled: ${plugin.name}`);
  res.json({ success: true });
});

// POST /api/plugins/:id/toggle — Enable/disable plugin
router.post("/:id/toggle", async (req, res) => {
  const plugin = installedPlugins.get(req.params.id);
  if (!plugin) return res.status(404).json({ error: "Plugin not found" });

  plugin.status = plugin.status === "active" ? "disabled" : "active";
  res.json({ success: true, status: plugin.status });
});

// ═══ RESTORE FROM DB ═══
async function restorePlugins(supabase) {
  if (!supabase) return;
  try {
    const { data } = await supabase.from("brain_plugins").select("manifest, status").eq("status", "active");
    if (data) {
      data.forEach(row => {
        try {
          const manifest = JSON.parse(row.manifest);
          if (manifest.id && !manifest.builtin) {
            installedPlugins.set(manifest.id, { ...manifest, status: row.status });
          }
        } catch { }
      });
      if (data.length > 0) {
        logger.info({ component: "Plugin", count: data.length }, `🔌 Restored ${data.length} plugins from DB`);
      }
    }
  } catch { }
}

module.exports = { router, executePlugin, installedPlugins, restorePlugins, validateManifest };
