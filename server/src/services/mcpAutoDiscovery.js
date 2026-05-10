'use strict';

/**
 * mcpAutoDiscovery.js — MCP Auto-Discovery & Auto-Install System
 *
 * Kelion's self-evolving tool infrastructure:
 * 1. Periodically scans MCP registries for available tool servers
 * 2. Maintains a local catalog of installed MCP servers
 * 3. Auto-installs missing servers when a user request requires them
 * 4. Keeps installed servers up-to-date
 * 5. Provides runtime API for the tool router to query capabilities
 *
 * Registries:
 *   - registry.modelcontextprotocol.io (official)
 *   - smithery.ai (popular marketplace)
 *   - mcp.directory (community directory)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Configuration ──
const CATALOG_DIR = path.join(__dirname, '..', '..', '.mcp-catalog');
const CATALOG_FILE = path.join(CATALOG_DIR, 'installed.json');
const REGISTRY_CACHE_FILE = path.join(CATALOG_DIR, 'registry-cache.json');
const REGISTRY_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INSTALLED_SERVERS = 50;

// Official MCP registry endpoint
const REGISTRIES = [
  { name: 'official', url: 'https://registry.modelcontextprotocol.io/servers' },
];

// ── In-memory state ──
let _catalog = null;       // Installed servers
let _registryCache = null; // Cached registry data
let _runningServers = new Map(); // serverId → child process
let _lastUpdateCheck = 0;
let _initialized = false;

// ── Catalog Management ──

function ensureCatalogDir() {
  if (!fs.existsSync(CATALOG_DIR)) {
    fs.mkdirSync(CATALOG_DIR, { recursive: true });
  }
}

function loadCatalog() {
  ensureCatalogDir();
  if (_catalog) return _catalog;
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      _catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[MCP-Discovery] Failed to load catalog:', err.message);
  }
  if (!_catalog) {
    _catalog = { servers: {}, lastUpdated: null, version: 1 };
  }
  return _catalog;
}

function saveCatalog() {
  ensureCatalogDir();
  const catalog = loadCatalog();
  catalog.lastUpdated = new Date().toISOString();
  try {
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), 'utf8');
  } catch (err) {
    console.warn('[MCP-Discovery] Failed to save catalog:', err.message);
  }
}

// ── Registry Scanning ──

async function fetchRegistry() {
  // Check cache first
  if (_registryCache && (Date.now() - _registryCache.fetchedAt) < REGISTRY_CACHE_TTL) {
    return _registryCache.servers;
  }

  // Try loading from disk cache
  try {
    if (fs.existsSync(REGISTRY_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(REGISTRY_CACHE_FILE, 'utf8'));
      if (cached.fetchedAt && (Date.now() - cached.fetchedAt) < REGISTRY_CACHE_TTL) {
        _registryCache = cached;
        return cached.servers;
      }
    }
  } catch (_) { /* ignore */ }

  // Fetch from registries
  const allServers = [];
  for (const reg of REGISTRIES) {
    try {
      const r = await fetch(reg.url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const data = await r.json();
        const servers = Array.isArray(data) ? data : (data.servers || data.items || []);
        for (const s of servers) {
          allServers.push({
            id: s.id || s.name || s.package_name,
            name: s.name || s.display_name || s.id,
            description: s.description || '',
            version: s.version || s.latest_version || '0.0.0',
            package: s.package_name || s.npm_package || s.id,
            install_type: s.install_type || (s.npm_package ? 'npm' : s.docker_image ? 'docker' : 'npx'),
            capabilities: s.capabilities || s.tools || [],
            categories: s.categories || s.tags || [],
            registry: reg.name,
            downloads: s.downloads || 0,
            stars: s.stars || s.github_stars || 0,
          });
        }
        console.log(`[MCP-Discovery] Fetched ${servers.length} servers from ${reg.name}`);
      }
    } catch (err) {
      console.warn(`[MCP-Discovery] Failed to fetch ${reg.name}:`, err.message);
    }
  }

  // Cache the results
  _registryCache = { servers: allServers, fetchedAt: Date.now() };
  try {
    ensureCatalogDir();
    fs.writeFileSync(REGISTRY_CACHE_FILE, JSON.stringify(_registryCache, null, 2), 'utf8');
  } catch (_) { /* ignore */ }

  return allServers;
}

// ── Search & Match ──

/**
 * Search the registry for servers matching a capability query.
 * @param {string} query - Natural language query or tool name
 * @returns {Array} Matching servers sorted by relevance
 */
async function searchServers(query) {
  const servers = await fetchRegistry();
  if (!servers.length) return [];

  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  return servers
    .map(s => {
      let score = 0;
      const searchText = `${s.name} ${s.description} ${(s.categories || []).join(' ')} ${(s.capabilities || []).join(' ')}`.toLowerCase();

      for (const term of terms) {
        if (s.name.toLowerCase().includes(term)) score += 10;
        if (s.description.toLowerCase().includes(term)) score += 5;
        if ((s.categories || []).some(c => c.toLowerCase().includes(term))) score += 8;
        if ((s.capabilities || []).some(c => c.toLowerCase().includes(term))) score += 12;
      }

      // Boost popular servers
      if (s.downloads > 10000) score += 3;
      if (s.stars > 100) score += 2;

      return { ...s, _score: score };
    })
    .filter(s => s._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);
}

// ── Install / Uninstall ──

/**
 * Install an MCP server by package name.
 * @param {string} packageName - npm package name (e.g., '@modelcontextprotocol/server-postgres')
 * @param {object} options - { version, config }
 * @returns {{ ok: boolean, serverId: string, error?: string }}
 */
async function installServer(packageName, options = {}) {
  const catalog = loadCatalog();
  const serverId = packageName.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Check if already installed
  if (catalog.servers[serverId]) {
    const existing = catalog.servers[serverId];
    if (!options.force && existing.version === (options.version || existing.version)) {
      return { ok: true, serverId, already_installed: true, version: existing.version };
    }
  }

  // Enforce limit
  if (Object.keys(catalog.servers).length >= MAX_INSTALLED_SERVERS) {
    return { ok: false, error: `Maximum ${MAX_INSTALLED_SERVERS} MCP servers. Uninstall unused ones first.` };
  }

  const installDir = path.join(CATALOG_DIR, 'servers', serverId);

  try {
    // Create directory
    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    // Install via npm
    const versionSuffix = options.version ? `@${options.version}` : '@latest';
    console.log(`[MCP-Discovery] Installing ${packageName}${versionSuffix}...`);

    execSync(`npm init -y 2>nul`, { cwd: installDir, timeout: 10000, stdio: 'pipe' });
    execSync(`npm install ${packageName}${versionSuffix} --save --no-audit --no-fund`, {
      cwd: installDir,
      timeout: 120000,
      stdio: 'pipe',
    });

    // Read installed version
    let installedVersion = 'unknown';
    try {
      const pkgPath = path.join(installDir, 'node_modules', packageName, 'package.json');
      if (fs.existsSync(pkgPath)) {
        installedVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || 'unknown';
      }
    } catch (_) { /* ignore */ }

    // Save to catalog
    catalog.servers[serverId] = {
      id: serverId,
      package: packageName,
      version: installedVersion,
      installDir,
      installedAt: new Date().toISOString(),
      config: options.config || {},
      status: 'installed',
    };
    saveCatalog();

    console.log(`[MCP-Discovery] ✅ Installed ${packageName}@${installedVersion}`);
    return { ok: true, serverId, version: installedVersion, package: packageName };
  } catch (err) {
    console.error(`[MCP-Discovery] ❌ Install failed for ${packageName}:`, err.message);
    return { ok: false, error: `Install failed: ${err.message.slice(0, 300)}` };
  }
}

/**
 * Uninstall an MCP server.
 */
function uninstallServer(serverId) {
  const catalog = loadCatalog();
  const entry = catalog.servers[serverId];
  if (!entry) return { ok: false, error: 'Server not found in catalog.' };

  // Stop if running
  stopServer(serverId);

  // Remove directory
  try {
    if (entry.installDir && fs.existsSync(entry.installDir)) {
      fs.rmSync(entry.installDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[MCP-Discovery] Failed to remove dir:`, err.message);
  }

  delete catalog.servers[serverId];
  saveCatalog();
  return { ok: true, uninstalled: serverId };
}

// ── Server Lifecycle ──

/**
 * Start an installed MCP server process.
 */
function startServer(serverId, config = {}) {
  if (_runningServers.has(serverId)) {
    return { ok: true, already_running: true };
  }

  const catalog = loadCatalog();
  const entry = catalog.servers[serverId];
  if (!entry) return { ok: false, error: 'Server not found' };

  try {
    // Find the executable — most MCP servers expose a bin entry
    const binPath = path.join(entry.installDir, 'node_modules', '.bin');
    const pkgJson = path.join(entry.installDir, 'node_modules', entry.package, 'package.json');
    let command = 'node';
    let args = ['.'];

    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      if (pkg.bin) {
        const binName = typeof pkg.bin === 'string' ? path.basename(entry.package) : Object.keys(pkg.bin)[0];
        const binFile = path.join(binPath, binName);
        if (fs.existsSync(binFile) || fs.existsSync(binFile + '.cmd')) {
          command = binFile;
          args = [];
        }
      } else if (pkg.main) {
        args = [path.join(entry.installDir, 'node_modules', entry.package, pkg.main)];
      }
    }

    // Merge config into env
    const env = { ...process.env, ...config };

    const child = spawn(command, args, {
      cwd: entry.installDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    child.on('error', (err) => {
      console.warn(`[MCP-Discovery] Server ${serverId} error:`, err.message);
      _runningServers.delete(serverId);
    });

    child.on('exit', (code) => {
      console.log(`[MCP-Discovery] Server ${serverId} exited with code ${code}`);
      _runningServers.delete(serverId);
    });

    _runningServers.set(serverId, { process: child, startedAt: Date.now() });
    entry.status = 'running';
    saveCatalog();

    return { ok: true, serverId, pid: child.pid };
  } catch (err) {
    return { ok: false, error: `Failed to start: ${err.message}` };
  }
}

function stopServer(serverId) {
  const entry = _runningServers.get(serverId);
  if (!entry) return { ok: true, already_stopped: true };

  try {
    entry.process.kill('SIGTERM');
  } catch (_) { /* ignore */ }

  _runningServers.delete(serverId);
  return { ok: true, stopped: serverId };
}

// ── Update Checker ──

/**
 * Check all installed servers for updates.
 */
async function checkForUpdates() {
  const catalog = loadCatalog();
  const updates = [];

  for (const [id, entry] of Object.entries(catalog.servers)) {
    try {
      // Check npm for latest version
      const result = execSync(`npm view ${entry.package} version 2>nul`, {
        timeout: 15000,
        stdio: 'pipe',
      }).toString().trim();

      if (result && result !== entry.version) {
        updates.push({
          id,
          package: entry.package,
          current: entry.version,
          latest: result,
        });
      }
    } catch (_) { /* skip */ }
  }

  _lastUpdateCheck = Date.now();
  return updates;
}

/**
 * Update a specific server to latest version.
 */
async function updateServer(serverId) {
  const catalog = loadCatalog();
  const entry = catalog.servers[serverId];
  if (!entry) return { ok: false, error: 'Server not found' };

  // Stop if running
  stopServer(serverId);

  // Reinstall with force
  return installServer(entry.package, { force: true });
}

// ── Status & Info ──

function getStatus() {
  const catalog = loadCatalog();
  const installed = Object.values(catalog.servers);
  const running = [..._runningServers.keys()];

  return {
    ok: true,
    installed_count: installed.length,
    running_count: running.length,
    max_servers: MAX_INSTALLED_SERVERS,
    last_registry_fetch: _registryCache?.fetchedAt
      ? new Date(_registryCache.fetchedAt).toISOString()
      : null,
    last_update_check: _lastUpdateCheck
      ? new Date(_lastUpdateCheck).toISOString()
      : null,
    servers: installed.map(s => ({
      id: s.id,
      package: s.package,
      version: s.version,
      status: _runningServers.has(s.id) ? 'running' : 'installed',
      installed_at: s.installedAt,
    })),
    running,
  };
}

// ── Auto-Discovery: Find & Install for a capability ──

/**
 * Given a natural-language request, find and install the best MCP server.
 * This is the main entry point for Kelion's self-evolving tool system.
 *
 * @param {string} need - What capability is needed (e.g., "postgres database", "slack messaging")
 * @returns {{ ok, installed?, servers?, error? }}
 */
async function autoDiscover(need) {
  if (!need || typeof need !== 'string') {
    return { ok: false, error: 'Describe what capability you need.' };
  }

  console.log(`[MCP-Discovery] Auto-discovering for: "${need}"`);

  // 1. Search registry
  const matches = await searchServers(need);
  if (!matches.length) {
    return {
      ok: false,
      error: 'No matching MCP servers found in the registry.',
      suggestion: 'Try broader search terms or check https://smithery.ai for available servers.',
    };
  }

  // 2. Check if best match is already installed
  const catalog = loadCatalog();
  const bestMatch = matches[0];
  const serverId = bestMatch.id.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (catalog.servers[serverId]) {
    return {
      ok: true,
      already_installed: true,
      server: catalog.servers[serverId],
      alternatives: matches.slice(1, 4).map(m => ({ name: m.name, description: m.description })),
    };
  }

  // 3. Auto-install the best match
  const installResult = await installServer(bestMatch.package || bestMatch.id, {
    config: {},
  });

  return {
    ok: installResult.ok,
    action: 'auto_installed',
    server: installResult,
    match: {
      name: bestMatch.name,
      description: bestMatch.description,
      package: bestMatch.package,
    },
    alternatives: matches.slice(1, 4).map(m => ({ name: m.name, description: m.description })),
    error: installResult.error,
  };
}

// ── Initialize ──

function init() {
  if (_initialized) return;
  _initialized = true;
  loadCatalog();
  console.log('[MCP-Discovery] Initialized. Installed servers:', Object.keys(loadCatalog().servers).length);
}

// Auto-init on require
init();

module.exports = {
  searchServers,
  installServer,
  uninstallServer,
  startServer,
  stopServer,
  checkForUpdates,
  updateServer,
  getStatus,
  autoDiscover,
  fetchRegistry,
};
