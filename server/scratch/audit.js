// Full KelionAI Audit — every system, every angle
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../');
const SERVER = path.resolve(ROOT, 'server');
const SRC = path.resolve(ROOT, 'src');
const DIST = path.resolve(ROOT, 'dist');
const ENV_FILE = path.resolve(SERVER, '.env');

const results = [];
function log(category, item, status, detail = '') {
  const icon = status === 'OK' ? '✓' : status === 'WARN' ? '⚠' : '✗';
  results.push({ category, item, status, detail });
  console.log(`[${category}] ${icon} ${item}${detail ? ' — ' + detail : ''}`);
}

// ═══════════════════════════════════════════════════════
// 1. FILES & STRUCTURE
// ═══════════════════════════════════════════════════════
function auditFiles() {
  console.log('\n═══ 1. FILES & STRUCTURE ═══');
  
  // Critical files
  const critical = [
    'package.json', 'vite.config.js', 'index.html',
    'server/src/index.js', 'server/src/config.js',
    'server/src/routes/chat.js', 'server/src/routes/realtime.js', 'server/src/routes/tools.js',
    'server/src/services/realTools.js', 'server/src/services/modelRouter.js',
    'src/lib/kelionTools.js', 'src/lib/kelionVoice.js', 'src/lib/monitorStore.js', 'src/lib/liveTerminal.js',
    'src/pages/KelionStage.jsx', 'src/components/stage/MonitorOverlay.jsx',
  ];
  for (const f of critical) {
    const full = path.resolve(ROOT, f);
    if (fs.existsSync(full)) {
      const kb = (fs.statSync(full).size / 1024).toFixed(1);
      log('FILES', f, 'OK', `${kb} KB`);
    } else {
      log('FILES', f, 'FAIL', 'MISSING');
    }
  }

  // Dist build
  if (fs.existsSync(DIST) && fs.existsSync(path.join(DIST, 'index.html'))) {
    const assets = fs.readdirSync(path.join(DIST, 'assets')).length;
    log('FILES', 'dist/ (production build)', 'OK', `${assets} assets`);
  } else {
    log('FILES', 'dist/ (production build)', 'FAIL', 'NOT BUILT');
  }

  // Node modules
  const nm = path.resolve(ROOT, 'node_modules');
  log('FILES', 'node_modules', fs.existsSync(nm) ? 'OK' : 'FAIL');
  
  // Server node_modules
  const snm = path.resolve(SERVER, 'node_modules');
  log('FILES', 'server/node_modules', fs.existsSync(snm) ? 'OK' : 'FAIL');
}

// ═══════════════════════════════════════════════════════
// 2. ENVIRONMENT & CONFIG
// ═══════════════════════════════════════════════════════
function auditEnv() {
  console.log('\n═══ 2. ENVIRONMENT & CONFIG ═══');
  
  if (!fs.existsSync(ENV_FILE)) {
    log('ENV', 'server/.env', 'FAIL', 'FILE MISSING');
    return;
  }
  
  const env = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = env.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const vars = {};
  for (const l of lines) {
    const [k, ...v] = l.split('=');
    vars[k.trim()] = v.join('=').trim();
  }
  
  const keys = [
    ['OPENROUTER_API_KEY', 'CRITICAL — AI chat won\'t work without it'],
    ['GOOGLE_API_KEY', 'CRITICAL — Gemini voice + direct API'],
    ['ELEVENLABS_API_KEY', 'Voice cloning'],
    ['DATABASE_URL', 'PostgreSQL (prod)'],
    ['JWT_SECRET', 'Auth security'],
    ['SESSION_SECRET', 'Session security'],
    ['STRIPE_SECRET_KEY', 'Payments'],
    ['MCP_ENABLED', 'Google Calendar/Gmail/Drive'],
    ['ADMIN_EMAIL', 'Admin bootstrap'],
    ['MODEL_CHAT', 'Custom chat model override'],
    ['MODEL_CODER', 'Custom coder model override'],
  ];
  
  for (const [key, desc] of keys) {
    const val = vars[key];
    if (val && val.length > 0) {
      log('ENV', key, 'OK', `SET (${val.length} chars) — ${desc}`);
    } else {
      const isCritical = desc.startsWith('CRITICAL');
      log('ENV', key, isCritical ? 'FAIL' : 'WARN', `NOT SET — ${desc}`);
    }
  }
}

// ═══════════════════════════════════════════════════════
// 3. DEPENDENCIES
// ═══════════════════════════════════════════════════════
function auditDeps() {
  console.log('\n═══ 3. DEPENDENCIES ═══');
  
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {}).length;
    const devDeps = Object.keys(pkg.devDependencies || {}).length;
    log('DEPS', 'Frontend dependencies', 'OK', `${deps} prod, ${devDeps} dev`);
  } catch (e) {
    log('DEPS', 'Frontend package.json', 'FAIL', e.message);
  }
  
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {}).length;
    const devDeps = Object.keys(pkg.devDependencies || {}).length;
    log('DEPS', 'Server dependencies', 'OK', `${deps} prod, ${devDeps} dev`);
  } catch (e) {
    log('DEPS', 'Server package.json', 'FAIL', e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 4. CODE QUALITY
// ═══════════════════════════════════════════════════════
function auditCode() {
  console.log('\n═══ 4. CODE QUALITY ═══');
  
  // Syntax check all server files
  const routeDir = path.join(SERVER, 'src', 'routes');
  const serviceDir = path.join(SERVER, 'src', 'services');
  
  for (const dir of [routeDir, serviceDir]) {
    const dirName = path.basename(dir);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    let ok = 0, fail = 0;
    for (const f of files) {
      try {
        execSync(`node -c "${path.join(dir, f)}"`, { stdio: 'pipe' });
        ok++;
      } catch (e) {
        fail++;
        log('CODE', `server/${dirName}/${f}`, 'FAIL', 'SYNTAX ERROR');
      }
    }
    if (fail === 0) log('CODE', `server/${dirName}/ (${ok} files)`, 'OK', 'All syntax valid');
  }
  
  // Check for massive files (>100KB)
  const bigFiles = [];
  function scanBig(dir, prefix) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory() && !f.startsWith('.') && f !== 'node_modules' && f !== 'dist') {
        scanBig(full, prefix + f + '/');
      } else if (stat.isFile() && stat.size > 100 * 1024 && (f.endsWith('.js') || f.endsWith('.jsx'))) {
        bigFiles.push({ file: prefix + f, kb: (stat.size / 1024).toFixed(0) });
      }
    }
  }
  scanBig(ROOT, '');
  
  if (bigFiles.length > 0) {
    for (const bf of bigFiles) {
      log('CODE', `Large file: ${bf.file}`, 'WARN', `${bf.kb} KB — consider splitting`);
    }
  } else {
    log('CODE', 'File sizes', 'OK', 'No files >100KB');
  }
}

// ═══════════════════════════════════════════════════════
// 5. MODEL ROUTER ANALYSIS
// ═══════════════════════════════════════════════════════
function auditModelRouter() {
  console.log('\n═══ 5. MODEL ROUTING ═══');
  
  const mrPath = path.join(SERVER, 'src', 'services', 'modelRouter.js');
  const code = fs.readFileSync(mrPath, 'utf8');
  
  // Extract default models
  const modelMatch = code.match(/MODELS\s*=\s*\{([^}]+)\}/s);
  if (modelMatch) {
    const block = modelMatch[1];
    const entries = block.match(/(\w+):\s*process\.env\.(\w+)\s*\|\|\s*'([^']+)'/g) || [];
    for (const e of entries) {
      const m = e.match(/(\w+):\s*process\.env\.(\w+)\s*\|\|\s*'([^']+)'/);
      if (m) {
        const envVal = process.env[m[2]];
        const active = envVal || m[3];
        const isFree = active.includes(':free') || active.startsWith('gemini');
        log('MODELS', `${m[1]}`, isFree ? 'OK' : 'WARN', `${active}${isFree ? ' (free)' : ' (PAID — needs credits)'}`);
      }
    }
  }
  
  // Check fallback delays
  if (code.includes('setTimeout(resolve, waitMs)')) {
    log('MODELS', 'Fallback has artificial delays', 'WARN', 'Adds seconds to retry');
  } else {
    log('MODELS', 'Fallback delays', 'OK', 'No artificial waits');
  }
  
  // Count fallback models
  const fbMatch = code.match(/OPENROUTER_FALLBACK\s*=\s*\{([^}]+)\}/s);
  if (fbMatch) {
    const fbCount = (fbMatch[1].match(/\[/g) || []).length;
    log('MODELS', 'Fallback chains', 'OK', `${fbCount} chains configured`);
  }
}

// ═══════════════════════════════════════════════════════
// 6. CHAT PIPELINE ANALYSIS
// ═══════════════════════════════════════════════════════
function auditChatPipeline() {
  console.log('\n═══ 6. CHAT PIPELINE ═══');
  
  const chatCode = fs.readFileSync(path.join(SERVER, 'src', 'routes', 'chat.js'), 'utf8');
  
  // Check Swarm trigger
  const swarmMatch = chatCode.match(/isSoftGreu\s*=\s*(.+);/);
  if (swarmMatch) {
    const cond = swarmMatch[1];
    if (cond.includes('200') || cond.includes("'soft'")) {
      log('CHAT', 'Swarm trigger', 'WARN', `Too aggressive: ${cond.slice(0, 80)}`);
    } else {
      log('CHAT', 'Swarm trigger', 'OK', cond.slice(0, 80));
    }
  }
  
  // Check max_tokens
  const tokMatch = chatCode.match(/max_tokens:\s*(\d+)/);
  if (tokMatch) {
    const tok = parseInt(tokMatch[1]);
    log('CHAT', 'max_tokens', tok >= 512 ? 'OK' : 'WARN', `${tok}`);
  }
  
  // Check session TTL
  const ttlMatch = chatCode.match(/SESSION_TTL\s*=\s*(\d+)/);
  if (ttlMatch) {
    log('CHAT', 'Session TTL', 'OK', `${parseInt(ttlMatch[1]) / 60000} min`);
  }
  
  // Check history limit
  const histMatch = chatCode.match(/MAX_HISTORY\s*=\s*(\d+)/);
  if (histMatch) {
    log('CHAT', 'Max history', 'OK', `${histMatch[1]} turns`);
  }
}

// ═══════════════════════════════════════════════════════
// 7. REALTIME (VOICE) ANALYSIS
// ═══════════════════════════════════════════════════════
function auditRealtime() {
  console.log('\n═══ 7. VOICE/REALTIME ═══');
  
  const rtPath = path.join(SERVER, 'src', 'routes', 'realtime.js');
  const stat = fs.statSync(rtPath);
  log('VOICE', 'realtime.js size', stat.size > 100000 ? 'WARN' : 'OK', `${(stat.size/1024).toFixed(0)} KB — contains ALL persona + tool definitions`);
  
  const code = fs.readFileSync(rtPath, 'utf8');
  
  // Count tool definitions
  const toolCount = (code.match(/name:\s*['"][a-z_]+['"]/g) || []).length;
  log('VOICE', 'Tool definitions', 'OK', `~${toolCount} tools registered`);
  
  // System prompt size
  const personaMatch = code.match(/function buildKelionPersona/);
  log('VOICE', 'Persona builder', personaMatch ? 'OK' : 'FAIL', personaMatch ? 'Found' : 'MISSING');
}

// ═══════════════════════════════════════════════════════
// 8. TOOLS ANALYSIS
// ═══════════════════════════════════════════════════════
function auditTools() {
  console.log('\n═══ 8. TOOLS ═══');
  
  const toolsPath = path.join(SERVER, 'src', 'services', 'realTools.js');
  const stat = fs.statSync(toolsPath);
  const code = fs.readFileSync(toolsPath, 'utf8');
  
  log('TOOLS', 'realTools.js', stat.size > 200000 ? 'WARN' : 'OK', `${(stat.size/1024).toFixed(0)} KB — MONOLITH, should be split into modules`);
  
  // Count tool functions
  const toolFns = (code.match(/async function tool\w+/g) || []).length;
  log('TOOLS', 'Tool functions', 'OK', `${toolFns} executors`);
  
  // Check for _exec (blocking)
  const execCount = (code.match(/_exec\(/g) || []).length;
  log('TOOLS', 'Blocking _exec() calls', execCount > 0 ? 'WARN' : 'OK', `${execCount} — each blocks until process completes`);
  
  // SSE streaming endpoint
  const toolsRoute = fs.readFileSync(path.join(SERVER, 'src', 'routes', 'tools.js'), 'utf8');
  log('TOOLS', 'SSE terminal-stream', toolsRoute.includes('terminal-stream') ? 'OK' : 'WARN', 'Live streaming endpoint');
}

// ═══════════════════════════════════════════════════════
// 9. FRONTEND ANALYSIS
// ═══════════════════════════════════════════════════════
function auditFrontend() {
  console.log('\n═══ 9. FRONTEND ═══');
  
  // KelionStage size warning
  const stagePath = path.join(SRC, 'pages', 'KelionStage.jsx');
  if (fs.existsSync(stagePath)) {
    const kb = (fs.statSync(stagePath).size / 1024).toFixed(0);
    log('FRONTEND', 'KelionStage.jsx', parseInt(kb) > 100 ? 'WARN' : 'OK', `${kb} KB — MONOLITH`);
  }
  
  // Check lib modules exist
  const libDir = path.join(SRC, 'lib');
  const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
  log('FRONTEND', 'lib/ modules', 'OK', `${libFiles.length} modules`);
  
  // Check liveTerminal integration
  const ktCode = fs.readFileSync(path.join(libDir, 'kelionTools.js'), 'utf8');
  log('FRONTEND', 'liveTerminal import', ktCode.includes("from './liveTerminal'") ? 'OK' : 'FAIL', 'kelionTools.js');
  log('FRONTEND', 'streamCommand usage', ktCode.includes('streamCommand') ? 'OK' : 'FAIL', 'SSE streaming');
  log('FRONTEND', 'Batch fallback', ktCode.includes('displayBatchResult') ? 'OK' : 'FAIL', 'Fallback for SSE failure');
}

// ═══════════════════════════════════════════════════════
// 10. DATABASE
// ═══════════════════════════════════════════════════════
function auditDb() {
  console.log('\n═══ 10. DATABASE ═══');
  
  const dbPath = path.join(ROOT, 'data', 'kelion.db');
  if (fs.existsSync(dbPath)) {
    const mb = (fs.statSync(dbPath).size / (1024*1024)).toFixed(2);
    log('DB', 'SQLite kelion.db', 'OK', `${mb} MB`);
  } else {
    log('DB', 'SQLite kelion.db', 'WARN', 'Not found (will be created on first run)');
  }
  
  // Check if DATABASE_URL is set for prod
  log('DB', 'PostgreSQL (prod)', process.env.DATABASE_URL ? 'OK' : 'WARN', 'DATABASE_URL not set locally — using SQLite');
}

// ═══════════════════════════════════════════════════════
// 11. SECURITY
// ═══════════════════════════════════════════════════════
function auditSecurity() {
  console.log('\n═══ 11. SECURITY ═══');
  
  // CSRF
  const csrfPath = path.join(SERVER, 'src', 'middleware', 'csrf.js');
  log('SECURITY', 'CSRF middleware', fs.existsSync(csrfPath) ? 'OK' : 'FAIL');
  
  // Auth
  const authPath = path.join(SERVER, 'src', 'middleware', 'auth.js');
  log('SECURITY', 'Auth middleware', fs.existsSync(authPath) ? 'OK' : 'FAIL');
  
  // SSRF guard in realTools
  const rtCode = fs.readFileSync(path.join(SERVER, 'src', 'services', 'realTools.js'), 'utf8');
  log('SECURITY', 'SSRF guard', rtCode.includes('isPrivateIPv4') ? 'OK' : 'FAIL');
  log('SECURITY', 'Path traversal guard', rtCode.includes('isPathSafe') ? 'OK' : 'FAIL');
  
  // Rate limiting
  const toolsCode = fs.readFileSync(path.join(SERVER, 'src', 'routes', 'tools.js'), 'utf8');
  log('SECURITY', 'Rate limiting (tools)', toolsCode.includes('rateOk') ? 'OK' : 'FAIL');
}

// ═══════════════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════════════
console.log('╔═══════════════════════════════════════════╗');
console.log('║   KELIONAI FULL AUDIT — ' + new Date().toISOString().slice(0,19) + '  ║');
console.log('╚═══════════════════════════════════════════╝');

auditFiles();
auditEnv();
auditDeps();
auditCode();
auditModelRouter();
auditChatPipeline();
auditRealtime();
auditTools();
auditFrontend();
auditDb();
auditSecurity();

// Summary
console.log('\n╔═══════════════════════════════════════════╗');
console.log('║              SUMMARY                       ║');
console.log('╚═══════════════════════════════════════════╝');
const ok = results.filter(r => r.status === 'OK').length;
const warn = results.filter(r => r.status === 'WARN').length;
const fail = results.filter(r => r.status === 'FAIL').length;
console.log(`\n  ✓ OK:   ${ok}`);
console.log(`  ⚠ WARN: ${warn}`);
console.log(`  ✗ FAIL: ${fail}`);
console.log(`  Total:  ${results.length} checks\n`);

if (fail > 0) {
  console.log('CRITICAL FAILURES:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  ✗ [${r.category}] ${r.item} — ${r.detail}`);
  }
}
if (warn > 0) {
  console.log('\nWARNINGS:');
  for (const r of results.filter(r => r.status === 'WARN')) {
    console.log(`  ⚠ [${r.category}] ${r.item} — ${r.detail}`);
  }
}
