// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain Healer / Self-Repair / Auto-Development Engine
// ═══════════════════════════════════════════════════════════════
// Capabilities:
//   1. SCAN    — scanează întregul program (fișiere, DB, API keys, routes, deps)
//   2. REPORT  — generează raport detaliat cu probleme găsite + recomandări
//   3. HEAL    — repară automat probleme cunoscute (env missing, table broken, etc.)
//   4. DEVELOP — instalează skill-uri noi, unelte, extinde capabilitățile
//   5. LEARN   — învață din conversații, erori, feedback
// ═══════════════════════════════════════════════════════════════
'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

// ── Directorul rădăcină al proiectului ──
const ROOT = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════
// SCANNER — Scanează toate componentele sistemului
// ═══════════════════════════════════════════════════════════════

async function scanSystem(supabaseAdmin) {
  const startTime = Date.now();
  const report = {
    timestamp:    new Date().toISOString(),
    durationMs:   0,
    score:        100,  // scade cu fiecare problemă
    status:       'healthy',
    sections:     {},
    issues:       [],
    warnings:     [],
    suggestions:  [],
    stats:        {},
  };

  // ── 1. Scanare fișiere critice ──
  report.sections.files = await _scanFiles();
  _mergeIssues(report, report.sections.files);

  // ── 2. Scanare variabile de mediu / API keys ──
  report.sections.env = await _scanEnv();
  _mergeIssues(report, report.sections.env);

  // ── 3. Scanare baza de date ──
  report.sections.database = await _scanDatabase(supabaseAdmin);
  _mergeIssues(report, report.sections.database);

  // ── 4. Scanare rute / endpoints ──
  report.sections.routes = await _scanRoutes();
  _mergeIssues(report, report.sections.routes);

  // ── 5. Scanare dependențe npm ──
  report.sections.dependencies = await _scanDependencies();
  _mergeIssues(report, report.sections.dependencies);

  // ── 6. Scanare memorie / AI ──
  report.sections.ai = await _scanAI(supabaseAdmin);
  _mergeIssues(report, report.sections.ai);

  // ── 7. Scanare securitate ──
  report.sections.security = await _scanSecurity();
  _mergeIssues(report, report.sections.security);

  // ── 8. Scanare performanță ──
  report.sections.performance = await _scanPerformance(supabaseAdmin);
  _mergeIssues(report, report.sections.performance);

  // ── Calculează scor final ──
  const criticalCount = report.issues.filter(i => i.severity === 'critical').length;
  const highCount     = report.issues.filter(i => i.severity === 'high').length;
  const mediumCount   = report.issues.filter(i => i.severity === 'medium').length;
  report.score = Math.max(0, 100 - (criticalCount * 20) - (highCount * 10) - (mediumCount * 3) - (report.warnings.length * 1));
  report.status = report.score >= 80 ? 'healthy' : report.score >= 50 ? 'degraded' : 'critical';
  report.durationMs = Date.now() - startTime;

  report.stats = {
    totalIssues:   report.issues.length,
    critical:      criticalCount,
    high:          highCount,
    medium:        mediumCount,
    warnings:      report.warnings.length,
    suggestions:   report.suggestions.length,
    sectionsScanned: Object.keys(report.sections).length,
  };

  return report;
}

// ── Scanare fișiere critice ──
async function _scanFiles() {
  const result = { name: 'Files', issues: [], warnings: [], suggestions: [], items: [] };

  const criticalFiles = [
    { path: 'server/index.js',          desc: 'Main server entry point' },
    { path: 'server/brain.js',          desc: 'AI brain core' },
    { path: 'server/brain-self.js',     desc: 'Self-development engine' },
    { path: 'server/brain-healer.js',   desc: 'Self-healing engine' },
    { path: 'server/migrate.js',        desc: 'Database migrations' },
    { path: 'server/mailer.js',         desc: 'Email service' },
    { path: 'server/referral.js',       desc: 'Referral system' },
    { path: 'server/routes/chat.js',    desc: 'Chat API routes' },
    { path: 'server/routes/auth.js',    desc: 'Auth routes' },
    { path: 'server/routes/payments.js', desc: 'Payment routes' },
    { path: 'server/routes/referral.js', desc: 'Referral routes' },
    { path: 'server/routes/refund.js',  desc: 'Refund routes' },
    { path: 'server/routes/admin.js',   desc: 'Admin routes' },
    { path: 'server/config/app.js',     desc: 'App configuration' },
    { path: 'server/config/models.js',  desc: 'AI models config' },
    { path: 'app/index.html',           desc: 'Frontend entry' },
    { path: 'package.json',             desc: 'Package manifest' },
  ];

  for (const f of criticalFiles) {
    const fullPath = path.join(ROOT, f.path);
    const exists   = fs.existsSync(fullPath);
    let size = 0;
    let lines = 0;

    if (exists) {
      try {
        const stat    = fs.statSync(fullPath);
        size          = stat.size;
        const content = fs.readFileSync(fullPath, 'utf8');
        lines         = content.split('\n').length;
        // Check for TODO/FIXME/HACK markers
        const todos = (content.match(/\b(TODO|FIXME|HACK|XXX|BROKEN)\b/g) || []).length;
        if (todos > 0) {
          result.warnings.push({ file: f.path, message: `${todos} TODO/FIXME markers found`, count: todos });
        }
        // Check for hardcoded secrets pattern
        if (/sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9]{30,}/.test(content)) {
          result.issues.push({ severity: 'critical', file: f.path, message: 'Possible hardcoded API key detected!', fix: 'move_to_env' });
        }
      } catch (_e) { /* ignore read errors */ }
    } else {
      result.issues.push({ severity: 'high', file: f.path, message: `Critical file missing: ${f.desc}`, fix: 'restore_file' });
    }

    result.items.push({ path: f.path, desc: f.desc, exists, size, lines });
  }

  // Check for orphan/large files
  try {
    const serverDir = path.join(ROOT, 'server');
    const files = fs.readdirSync(serverDir).filter(f => f.endsWith('.js'));
    result.stats = { totalServerFiles: files.length };
  } catch (_e) {}

  return result;
}

// ── Scanare variabile de mediu ──
async function _scanEnv() {
  const result = { name: 'Environment', issues: [], warnings: [], suggestions: [], providers: [] };

  const envDefs = [
    { key: 'SUPABASE_URL',           severity: 'critical', desc: 'Supabase connection URL' },
    { key: 'SUPABASE_SERVICE_KEY',   severity: 'critical', desc: 'Supabase service key' },
    { key: 'SESSION_SECRET',         severity: 'critical', desc: 'Session encryption secret' },
    { key: 'OPENAI_API_KEY',         severity: 'high',     desc: 'OpenAI GPT-4 access' },
    { key: 'ANTHROPIC_API_KEY',      severity: 'high',     desc: 'Claude AI access' },
    { key: 'GOOGLE_AI_KEY',          severity: 'medium',   desc: 'Google Gemini access' },
    { key: 'GROQ_API_KEY',           severity: 'medium',   desc: 'Groq fast inference' },
    { key: 'DEEPSEEK_API_KEY',       severity: 'medium',   desc: 'DeepSeek AI access' },
    { key: 'ELEVENLABS_API_KEY',     severity: 'medium',   desc: 'ElevenLabs TTS/Voice' },
    { key: 'DEEPGRAM_API_KEY',       severity: 'medium',   desc: 'Deepgram STT' },
    { key: 'TAVILY_API_KEY',         severity: 'medium',   desc: 'Tavily web search' },
    { key: 'STRIPE_SECRET_KEY',      severity: 'high',     desc: 'Stripe payments' },
    { key: 'STRIPE_WEBHOOK_SECRET',  severity: 'medium',   desc: 'Stripe webhook verification' },
    { key: 'RESEND_API_KEY',         severity: 'medium',   desc: 'Resend email service' },
    { key: 'ADMIN_EMAIL',            severity: 'medium',   desc: 'Admin email address' },
    { key: 'ADMIN_SECRET_KEY',       severity: 'high',     desc: 'Admin panel secret' },
    { key: 'REFERRAL_SECRET',        severity: 'low',      desc: 'Referral HMAC secret' },
    { key: 'APP_URL',                severity: 'low',      desc: 'Public app URL' },
  ];

  let present = 0, missing = 0;
  for (const e of envDefs) {
    const val = process.env[e.key];
    const ok  = !!val && val.length > 3;
    if (ok) {
      present++;
    } else {
      missing++;
      result.issues.push({
        severity: e.severity,
        key:      e.key,
        message:  `Missing env var: ${e.key} (${e.desc})`,
        fix:      'set_env_var',
        fixData:  { key: e.key, desc: e.desc },
      });
    }
    result.providers.push({ key: e.key, desc: e.desc, present: ok, severity: e.severity });
  }

  result.stats = { present, missing, total: envDefs.length };
  return result;
}

// ── Scanare baza de date ──
async function _scanDatabase(supabaseAdmin) {
  const result = { name: 'Database', issues: [], warnings: [], suggestions: [], tables: [] };

  if (!supabaseAdmin) {
    result.issues.push({ severity: 'critical', message: 'Supabase not connected', fix: 'check_supabase_env' });
    return result;
  }

  const requiredTables = [
    'conversations', 'messages', 'profiles', 'subscriptions', 'visitors',
    'brain_memory', 'learned_facts', 'ai_costs', 'usage', 'page_views',
    'referral_codes', 'refund_requests', 'scan_reports', 'heal_jobs',
    'admin_logs', 'brain_self_log', 'cloned_voices',
  ];

  let healthy = 0, broken = 0;
  for (const table of requiredTables) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      healthy++;
      result.tables.push({ table, status: 'ok', rows: count || 0 });
    } catch (e) {
      broken++;
      result.tables.push({ table, status: 'missing', error: e.message });
      result.issues.push({
        severity: 'high',
        table,
        message:  `Table missing or broken: ${table}`,
        fix:      'run_migration',
        fixData:  { table },
      });
    }
  }

  // Check for large tables that might need cleanup
  const largeTables = result.tables.filter(t => t.rows > 10000);
  for (const t of largeTables) {
    result.suggestions.push({ message: `Table ${t.table} has ${t.rows} rows — consider archiving old data`, action: 'archive_old_data' });
  }

  result.stats = { healthy, broken, total: requiredTables.length };
  return result;
}

// ── Scanare rute ──
async function _scanRoutes() {
  const result = { name: 'Routes', issues: [], warnings: [], suggestions: [], routes: [] };

  const routeFiles = [
    { file: 'server/routes/chat.js',           mount: '/api/chat' },
    { file: 'server/routes/auth.js',           mount: '/api/auth' },
    { file: 'server/routes/payments.js',       mount: '/api/payments' },
    { file: 'server/routes/referral.js',       mount: '/api/referral' },
    { file: 'server/routes/refund.js',         mount: '/api/refund' },
    { file: 'server/routes/admin.js',          mount: '/api/admin' },
    { file: 'server/routes/self-dev.js',       mount: '/api/admin/self' },
    { file: 'server/routes/healer.js',         mount: '/api/admin/healer' },
    { file: 'server/routes/stripe-webhook.js', mount: '/api/stripe' },
    { file: 'server/routes/voice.js',          mount: '/api/voice' },
    { file: 'server/routes/tools-api.js',      mount: '/api/tools' },
  ];

  for (const r of routeFiles) {
    const fullPath = path.join(ROOT, r.file);
    const exists   = fs.existsSync(fullPath);
    result.routes.push({ ...r, exists });
    if (!exists) {
      result.issues.push({ severity: 'high', file: r.file, message: `Route file missing: ${r.file}`, fix: 'create_route', fixData: { mount: r.mount } });
    }
  }

  // Check index.js for mounted routes
  try {
    const indexContent = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
    for (const r of routeFiles) {
      const routeName = path.basename(r.file, '.js');
      if (!indexContent.includes(routeName) && !indexContent.includes(r.mount)) {
        result.warnings.push({ message: `Route ${r.mount} may not be mounted in index.js`, file: r.file });
      }
    }
  } catch (_e) {}

  result.stats = { total: routeFiles.length, present: routeFiles.filter(r => fs.existsSync(path.join(ROOT, r.file))).length };
  return result;
}

// ── Scanare dependențe ──
async function _scanDependencies() {
  const result = { name: 'Dependencies', issues: [], warnings: [], suggestions: [], packages: [] };

  try {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps    = { ...pkg.dependencies, ...pkg.devDependencies };

    const requiredDeps = [
      { name: 'express',        critical: true },
      { name: 'stripe',         critical: true },
      { name: '@supabase/supabase-js', critical: true },
      { name: 'nodemailer',     critical: false },
      { name: 'express-rate-limit', critical: true },
      { name: 'pino',           critical: false },
    ];

    for (const dep of requiredDeps) {
      const present = !!deps[dep.name];
      result.packages.push({ name: dep.name, present, version: deps[dep.name] || null });
      if (!present && dep.critical) {
        result.issues.push({
          severity: 'high',
          package:  dep.name,
          message:  `Required package missing: ${dep.name}`,
          fix:      'install_package',
          fixData:  { package: dep.name },
        });
      }
    }

    // Check for outdated patterns
    if (!deps['nodemailer'] && !process.env.RESEND_API_KEY) {
      result.suggestions.push({ message: 'No email provider configured. Add RESEND_API_KEY or install nodemailer.', action: 'configure_email' });
    }

    result.stats = { total: Object.keys(deps).length, checked: requiredDeps.length };
  } catch (e) {
    result.issues.push({ severity: 'high', message: 'Cannot read package.json: ' + e.message, fix: 'check_package_json' });
  }

  return result;
}

// ── Scanare AI / Brain ──
async function _scanAI(supabaseAdmin) {
  const result = { name: 'AI Brain', issues: [], warnings: [], suggestions: [], providers: [] };

  const aiProviders = [
    { name: 'OpenAI',     key: 'OPENAI_API_KEY',    role: 'primary_chat' },
    { name: 'Anthropic',  key: 'ANTHROPIC_API_KEY', role: 'reasoning' },
    { name: 'Gemini',     key: 'GOOGLE_AI_KEY',     role: 'vision_fallback' },
    { name: 'Groq',       key: 'GROQ_API_KEY',      role: 'fast_inference' },
    { name: 'DeepSeek',   key: 'DEEPSEEK_API_KEY',  role: 'code_specialist' },
    { name: 'ElevenLabs', key: 'ELEVENLABS_API_KEY', role: 'voice_tts' },
    { name: 'Deepgram',   key: 'DEEPGRAM_API_KEY',  role: 'voice_stt' },
    { name: 'Tavily',     key: 'TAVILY_API_KEY',     role: 'web_search' },
  ];

  let activeProviders = 0;
  for (const p of aiProviders) {
    const active = !!process.env[p.key];
    if (active) activeProviders++;
    result.providers.push({ ...p, active });
  }

  if (activeProviders === 0) {
    result.issues.push({ severity: 'critical', message: 'No AI providers configured! Chat will not work.', fix: 'configure_ai_keys' });
  } else if (activeProviders < 3) {
    result.warnings.push({ message: `Only ${activeProviders} AI providers active. Recommend at least 3 for redundancy.` });
  }

  // Check brain memory
  if (supabaseAdmin) {
    try {
      const { count: memCount } = await supabaseAdmin.from('brain_memory').select('*', { count: 'exact', head: true });
      const { count: factCount } = await supabaseAdmin.from('learned_facts').select('*', { count: 'exact', head: true });
      result.stats = { activeProviders, totalProviders: aiProviders.length, memoriesStored: memCount || 0, factsLearned: factCount || 0 };

      if ((memCount || 0) > 50000) {
        result.suggestions.push({ message: `Brain memory has ${memCount} entries — consider pruning old memories`, action: 'prune_memories' });
      }
    } catch (_e) {
      result.stats = { activeProviders, totalProviders: aiProviders.length };
    }
  }

  return result;
}

// ── Scanare securitate ──
async function _scanSecurity() {
  const result = { name: 'Security', issues: [], warnings: [], suggestions: [] };

  // Check critical security env vars
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    result.issues.push({ severity: 'critical', message: 'SESSION_SECRET is missing or too short (min 32 chars)', fix: 'set_session_secret' });
  }
  if (!process.env.ADMIN_SECRET_KEY) {
    result.issues.push({ severity: 'high', message: 'ADMIN_SECRET_KEY not set — admin panel unprotected', fix: 'set_admin_secret' });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    result.warnings.push({ message: 'STRIPE_WEBHOOK_SECRET not set — webhook not verified (security risk)' });
  }
  if (!process.env.REFERRAL_SECRET) {
    result.warnings.push({ message: 'REFERRAL_SECRET not set — using fallback secret (set for production)' });
  }

  // Check for .env file exposure
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    // Check .gitignore
    const gitignorePath = path.join(ROOT, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (!gitignore.includes('.env')) {
        result.issues.push({ severity: 'critical', message: '.env file not in .gitignore — risk of secret exposure!', fix: 'add_env_to_gitignore' });
      }
    }
  }

  // Check CORS / CSP
  try {
    const indexContent = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
    if (!indexContent.includes('helmet') && !indexContent.includes('Content-Security-Policy')) {
      result.warnings.push({ message: 'No CSP/Helmet detected in server — consider adding security headers' });
    }
    if (!indexContent.includes('rate') && !indexContent.includes('rateLimit')) {
      result.warnings.push({ message: 'No rate limiting detected in main server file' });
    }
  } catch (_e) {}

  result.stats = { issueCount: result.issues.length, warningCount: result.warnings.length };
  return result;
}

// ── Scanare performanță ──
async function _scanPerformance(supabaseAdmin) {
  const result = { name: 'Performance', issues: [], warnings: [], suggestions: [], metrics: {} };

  // Memory usage
  const mem = process.memoryUsage();
  result.metrics.heapUsedMB  = Math.round(mem.heapUsed  / 1024 / 1024);
  result.metrics.heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  result.metrics.rssMB       = Math.round(mem.rss       / 1024 / 1024);
  result.metrics.uptimeSec   = Math.round(process.uptime());

  if (result.metrics.heapUsedMB > 512) {
    result.warnings.push({ message: `High memory usage: ${result.metrics.heapUsedMB}MB heap used` });
  }

  // DB performance
  if (supabaseAdmin) {
    try {
      const start = Date.now();
      await supabaseAdmin.from('profiles').select('id').limit(1);
      result.metrics.dbLatencyMs = Date.now() - start;
      if (result.metrics.dbLatencyMs > 1000) {
        result.warnings.push({ message: `High DB latency: ${result.metrics.dbLatencyMs}ms` });
      }
    } catch (_e) {
      result.metrics.dbLatencyMs = -1;
      result.issues.push({ severity: 'high', message: 'Database latency check failed', fix: 'check_db_connection' });
    }
  }

  return result;
}

// ── Helper: merge issues/warnings/suggestions ──
function _mergeIssues(report, section) {
  if (section.issues)      report.issues.push(...section.issues);
  if (section.warnings)    report.warnings.push(...section.warnings);
  if (section.suggestions) report.suggestions.push(...section.suggestions);
}

// ═══════════════════════════════════════════════════════════════
// HEALER — Repară automat probleme cunoscute
// ═══════════════════════════════════════════════════════════════

async function healIssue(issue, supabaseAdmin, options = {}) {
  const result = { fix: issue.fix, success: false, message: '', actions: [] };

  try {
    switch (issue.fix) {

      case 'run_migration': {
        // Re-run migration for missing tables
        const { runMigration } = require('./migrate');
        await runMigration();
        result.success = true;
        result.message = 'Migration re-run — missing tables should now exist';
        result.actions.push('ran_migration');
        break;
      }

      case 'set_env_var': {
        // Cannot auto-set env vars — guide admin
        result.success = false;
        result.message = `Cannot auto-set ${issue.fixData?.key}. Please set it in Railway/Render environment variables.`;
        result.actions.push('guided_admin');
        break;
      }

      case 'install_package': {
        // Log suggestion — cannot run npm in production
        result.success = false;
        result.message = `Package ${issue.fixData?.package} needs to be installed. Run: npm install ${issue.fixData?.package}`;
        result.actions.push('install_suggestion');
        break;
      }

      case 'prune_memories': {
        if (!supabaseAdmin) { result.message = 'No DB'; break; }
        const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
        const { count } = await supabaseAdmin
          .from('brain_memory')
          .delete()
          .lt('created_at', cutoff)
          .select('*', { count: 'exact', head: true });
        result.success = true;
        result.message = `Pruned ${count || 0} memories older than 90 days`;
        result.actions.push('pruned_memories');
        break;
      }

      case 'add_env_to_gitignore': {
        const gitignorePath = path.join(ROOT, '.gitignore');
        let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
        if (!content.includes('.env')) {
          content += '\n.env\n.env.local\n.env.production\n';
          fs.writeFileSync(gitignorePath, content);
          result.success = true;
          result.message = '.env added to .gitignore';
          result.actions.push('updated_gitignore');
        }
        break;
      }

      default:
        result.message = `No automatic fix available for: ${issue.fix}. Manual intervention required.`;
        result.actions.push('manual_required');
    }
  } catch (e) {
    result.success = false;
    result.message = 'Heal attempt failed: ' + e.message;
    logger.error({ component: 'Healer', fix: issue.fix, err: e.message }, 'Heal failed');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-DEVELOP — Instalează skill-uri noi / extinde capabilitățile
// ═══════════════════════════════════════════════════════════════

const AVAILABLE_SKILLS = {
  'web-search': {
    name:        'Web Search (Tavily)',
    description: 'Permite avatarului să caute pe internet în timp real',
    requires:    ['TAVILY_API_KEY'],
    status:      () => !!process.env.TAVILY_API_KEY ? 'active' : 'needs_key',
  },
  'voice-tts': {
    name:        'Text-to-Speech (ElevenLabs)',
    description: 'Voce naturală pentru avatar',
    requires:    ['ELEVENLABS_API_KEY'],
    status:      () => !!process.env.ELEVENLABS_API_KEY ? 'active' : 'needs_key',
  },
  'voice-stt': {
    name:        'Speech-to-Text (Deepgram)',
    description: 'Recunoaștere vocală pentru input',
    requires:    ['DEEPGRAM_API_KEY'],
    status:      () => !!process.env.DEEPGRAM_API_KEY ? 'active' : 'needs_key',
  },
  'image-vision': {
    name:        'Image Vision (GPT-4o)',
    description: 'Avatarul poate analiza imagini trimise de utilizator',
    requires:    ['OPENAI_API_KEY'],
    status:      () => !!process.env.OPENAI_API_KEY ? 'active' : 'needs_key',
  },
  'code-execution': {
    name:        'Code Specialist (DeepSeek)',
    description: 'Specialist în cod, debugging și arhitectură software',
    requires:    ['DEEPSEEK_API_KEY'],
    status:      () => !!process.env.DEEPSEEK_API_KEY ? 'active' : 'needs_key',
  },
  'email-service': {
    name:        'Email Service (Resend)',
    description: 'Trimitere emailuri tranzacționale (invitații, notificări)',
    requires:    ['RESEND_API_KEY'],
    status:      () => !!process.env.RESEND_API_KEY ? 'active' : 'needs_key',
  },
  'payments': {
    name:        'Payment Processing (Stripe)',
    description: 'Plăți online, abonamente, refunduri',
    requires:    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    status:      () => !!process.env.STRIPE_SECRET_KEY ? (!!process.env.STRIPE_WEBHOOK_SECRET ? 'active' : 'partial') : 'needs_key',
  },
  'referral-system': {
    name:        'Referral System',
    description: 'Sistem de invitații cu coduri HMAC și bonus zile',
    requires:    ['REFERRAL_SECRET'],
    status:      () => !!process.env.REFERRAL_SECRET ? 'active' : 'partial',
  },
  'memory-learning': {
    name:        'Memory & Learning',
    description: 'Avatarul memorează preferințe și învață din conversații',
    requires:    ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
    status:      () => (!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY) ? 'active' : 'needs_key',
  },
  'self-healing': {
    name:        'Self-Healing Engine',
    description: 'Scanare automată, detectare probleme, auto-reparare',
    requires:    [],
    status:      () => 'active',
  },
};

function getSkillsStatus() {
  return Object.entries(AVAILABLE_SKILLS).map(([id, skill]) => ({
    id,
    name:        skill.name,
    description: skill.description,
    requires:    skill.requires,
    status:      skill.status(),
    missingKeys: skill.requires.filter(k => !process.env[k]),
  }));
}

// ═══════════════════════════════════════════════════════════════
// GENERATE AI REPORT — Folosește AI pentru analiză inteligentă
// ═══════════════════════════════════════════════════════════════

async function generateAIReport(scanResult) {
  // Construiește un sumar pentru AI
  const summary = {
    score:    scanResult.score,
    status:   scanResult.status,
    issues:   scanResult.issues.slice(0, 20),
    warnings: scanResult.warnings.slice(0, 10),
    stats:    scanResult.stats,
  };

  // Dacă avem Anthropic sau OpenAI, generăm un raport inteligent
  const prompt = `Ești un expert în sisteme AI și DevOps. Analizează acest raport de sănătate al sistemului KelionAI și oferă:
1. O evaluare generală în 2-3 propoziții
2. Top 3 probleme critice de rezolvat IMEDIAT
3. Top 3 recomandări de îmbunătățire
4. Un plan de acțiune pe 7 zile

Raport sistem:
${JSON.stringify(summary, null, 2)}

Răspunde în română, concis și practic. Format: JSON cu cheile: evaluation, criticalActions, improvements, weekPlan`;

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model:      'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      });
      const text = msg.content[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } else if (process.env.OPENAI_API_KEY) {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await openai.chat.completions.create({
        model:      'gpt-4o-mini',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });
      return JSON.parse(resp.choices[0].message.content);
    }
  } catch (e) {
    logger.warn({ component: 'Healer', err: e.message }, 'AI report generation failed');
  }

  // Fallback: raport static bazat pe date
  return {
    evaluation:      `Sistemul are scor ${scanResult.score}/100 (${scanResult.status}). ${scanResult.stats.critical || 0} probleme critice, ${scanResult.stats.high || 0} probleme majore.`,
    criticalActions: scanResult.issues.filter(i => i.severity === 'critical').slice(0, 3).map(i => i.message),
    improvements:    scanResult.suggestions.slice(0, 3).map(s => s.message),
    weekPlan:        ['Zi 1-2: Rezolvă problemele critice', 'Zi 3-4: Configurează cheile lipsă', 'Zi 5-7: Optimizare și monitorizare'],
  };
}

// ═══════════════════════════════════════════════════════════════
// SAVE / LOAD SCAN REPORTS
// ═══════════════════════════════════════════════════════════════

async function saveScanReport(report, aiAnalysis, supabaseAdmin) {
  // ── Send alert if critical issues found ──
  try {
    const critical = report?.stats?.critical ?? 0;
    const score    = report?.score ?? 100;
    if (critical > 0 || score < 50) {
      const alerts = require('./alerts');
      alerts.alertHealingReport({
        scanResult:  report,
        aiAnalysis,
        healed:      [],
        failed:      [],
        triggeredBy: 'brain-healer',
      }).catch(() => {}); // non-blocking
    }
  } catch (_e) { /* non-fatal */ }

  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('scan_reports')
      .insert({
        score:          report.score,
        status:         report.status,
        issues_count:   report.stats.totalIssues,
        critical_count: report.stats.critical,
        report_json:    report,
        ai_analysis:    aiAnalysis,
        duration_ms:    report.durationMs,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id;
  } catch (e) {
    logger.warn({ component: 'Healer', err: e.message }, 'Failed to save scan report');
    return null;
  }
}

async function getRecentReports(supabaseAdmin, limit = 10) {
  if (!supabaseAdmin) return [];
  try {
    const { data } = await supabaseAdmin
      .from('scan_reports')
      .select('id, score, status, issues_count, critical_count, duration_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (_e) { return []; }
}

module.exports = {
  scanSystem,
  healIssue,
  generateAIReport,
  saveScanReport,
  getRecentReports,
  getSkillsStatus,
  AVAILABLE_SKILLS,
};