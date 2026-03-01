// ═══════════════════════════════════════════════════════════════
// KelionAI v2.2 — BRAIN-POWERED SERVER
// Autonomous thinking, self-repair, auto-learning
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();

// Verify Node.js version — native fetch available from Node 18+
if (!globalThis.fetch) {
    throw new Error('Node.js 18+ required for native fetch. Current: ' + process.version);
}
const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0, integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()]
    });
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { supabase, supabaseAdmin } = require('./supabase');
const { runMigration } = require('./migrate');
const { KelionBrain } = require('./brain');

const logger = require('./logger');
const { router: paymentsRouter } = require('./payments');
const legalRouter = require('./legal');
const { router: messengerRouter, getStats: getMessengerStats, notifySubscribersNews, setSupabase: setMessengerSupabase } = require('./messenger');
const { router: telegramRouter, broadcastNews } = require('./telegram');
const { router: whatsappRouter } = require('./whatsapp');
const fbPage = require('./facebook-page');
const instagram = require('./instagram');
const developerRouter = require('./routes/developer');

// ═══ EXTRACTED ROUTE MODULES ═══
const chatRouter = require('./routes/chat');
const voiceRouter = require('./routes/voice');
const searchRouter = require('./routes/search');
const weatherRouter = require('./routes/weather');
const visionRouter = require('./routes/vision');
const imagesRouter = require('./routes/images');
const authRouter = require('./routes/auth');
const { router: adminRouter, adminAuth } = require('./routes/admin');
const healthRouter = require('./routes/health');

const app = express();
app.set('trust proxy', 1);

// ═══ HTTPS FORCE REDIRECT ═══
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
});

// ═══ CSP NONCE MIDDLEWARE — generates unique nonce per request ═══
app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
});

app.use((req, res, next) => {
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: [
                    "'self'",
                    (req, res) => `'nonce-${res.locals.cspNonce}'`,
                    // Required CDNs with pinned versions
                    "https://cdn.jsdelivr.net",
                    "https://browser.sentry-cdn.com",
                ],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: [
                    "'self'",
                    "blob:",
                    "https://api.openai.com",
                    "https://generativelanguage.googleapis.com",
                    "https://api.anthropic.com",
                    "https://api.elevenlabs.io",
                    "https://api.groq.com",
                    "https://api.perplexity.ai",
                    "https://api.tavily.com",
                    "https://google.serper.dev",
                    "https://api.duckduckgo.com",
                    "https://api.together.xyz",
                    "https://api.deepseek.com",
                    "https://geocoding-api.open-meteo.com",
                    "https://api.open-meteo.com",
                ],
                mediaSrc: ["'self'", "blob:"],
                workerSrc: ["'self'", "blob:"],
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: "cross-origin" }
    })(req, res, next);
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : null;

app.use(cors({
    origin: (origin, callback) => {
        if (!allowedOrigins) return callback(null, true);
        if (!origin) return callback(null, true);
        const env = process.env.NODE_ENV || 'development';
        if (env !== 'production' && (origin.startsWith('http://localhost') || origin.startsWith('http://127.'))) {
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
    },
    credentials: true
}));

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
// Messenger webhook needs raw body for HMAC-SHA256 validation
app.use('/api/messenger/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// ═══ HTTP REQUEST LOGGING ═══
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            component: 'HTTP',
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration,
            userAgent: req.get('user-agent')
        }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// ═══ RATE LIMITING ═══
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const metrics = require('./metrics');
app.use(metrics.metricsMiddleware);
app.get('/metrics', adminAuth, asyncHandler(async (req, res) => { res.set('Content-Type', metrics.register.contentType); res.end(await metrics.register.metrics()); }));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
// Read index.html once at startup, injecting Sentry DSN if configured
const _rawHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const _indexHtml = process.env.SENTRY_DSN
    ? _rawHtml.replace(
        '<meta name="sentry-dsn" content="">',
        `<meta name="sentry-dsn" content="${process.env.SENTRY_DSN.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`
    )
    : _rawHtml;

// Serve main app with CSP nonce injection (express.static skips index.html for /)
app.get('/', (req, res) => {
    const nonce = res.locals.cspNonce || '';
    const html = _indexHtml.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Read onboarding.html once at startup
const _rawOnboarding = fs.existsSync(path.join(__dirname, '..', 'app', 'onboarding.html'))
    ? fs.readFileSync(path.join(__dirname, '..', 'app', 'onboarding.html'), 'utf8')
    : null;

// Read reset-password.html once at startup
const _rawResetPassword = fs.existsSync(path.join(__dirname, '..', 'app', 'reset-password.html'))
    ? fs.readFileSync(path.join(__dirname, '..', 'app', 'reset-password.html'), 'utf8')
    : null;

// Serve onboarding with CSP nonce injection
app.get('/onboarding.html', (req, res) => {
    if (!_rawOnboarding) return res.redirect('/');
    const nonce = res.locals.cspNonce || '';
    const html = _rawOnboarding.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Serve reset-password with CSP nonce injection
app.get('/reset-password.html', (req, res) => {
    if (!_rawResetPassword) return res.redirect('/');
    const nonce = res.locals.cspNonce || '';
    const html = _rawResetPassword.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, '..', 'app')));
app.use('/api', globalLimiter);
const PORT = process.env.PORT || 3000;
const memFallback = Object.create(null);

// Cleanup memFallback every hour to prevent memory leaks
setInterval(() => {
    const keys = Object.keys(memFallback);
    if (keys.length > 1000) {
        // Keep only the most recent 500 entries
        const toDelete = keys.slice(0, keys.length - 500);
        for (const k of toDelete) delete memFallback[k];
        logger.info({ component: 'Memory', removed: toDelete.length, remaining: 500 }, 'memFallback cleanup');
    }
}, 60 * 60 * 1000);

// ═══ BRAIN INITIALIZATION ═══
const brain = new KelionBrain({
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    perplexityKey: process.env.PERPLEXITY_API_KEY,
    tavilyKey: process.env.TAVILY_API_KEY,
    serperKey: process.env.SERPER_API_KEY,
    togetherKey: process.env.TOGETHER_API_KEY,
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,
    supabaseAdmin
});
logger.info({ component: 'Brain' }, '🧠 Engine initialized');

// ═══ AUTH HELPER ═══
async function getUserFromToken(req) {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ') || !supabase) return null;
    try { const { data: { user } } = await supabase.auth.getUser(h.split(' ')[1]); return user; }
    catch (e) { return null; }
}

// ═══ SHARE HELPERS VIA app.locals (for all route modules) ═══
app.locals.getUserFromToken = getUserFromToken;
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;
app.locals.brain = brain;
app.locals.memFallback = memFallback;

// ═══ ROUTE MODULES ═══
app.use('/api/auth', authRouter);
app.use('/api', chatRouter);
app.use('/api', voiceRouter);
app.use('/api/search', searchRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/vision', visionRouter);
app.use('/api/imagine', imagesRouter);
app.use('/api', adminRouter);
app.use('/api/health', healthRouter);

// ═══ BRAIN DASHBOARD (live monitoring) ═══
app.get('/dashboard', adminAuth, (req, res) => {
    res.send(`<!DOCTYPE html>
<html><head><title>KelionAI Brain Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui,sans-serif;padding:20px}
h1{color:#00ffff;margin-bottom:20px;font-size:1.5rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px}
.card h2{color:#888;font-size:0.85rem;text-transform:uppercase;margin-bottom:12px;letter-spacing:1px}
.stat{font-size:2rem;font-weight:bold;color:#00ffff}
.stat.warn{color:#ffaa00}
.stat.bad{color:#ff4444}
.stat.good{color:#00ff88}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.row:last-child{border:none}
.label{color:#888}
.val{font-weight:bold}
.bar{height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin-top:4px}
.bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#00ffff,#00ff88)}
.journal{font-size:0.8rem;color:#aaa;margin-top:8px}
.journal-entry{padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03)}
.btns{position:fixed;top:15px;right:15px;display:flex;gap:8px}
.refresh{background:#00ffff;color:#000;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-btn{background:#1a1a2a;color:#00ffff;border:1px solid #00ffff;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px}
.hc-box{background:#0d0d20;border:1px solid rgba(0,255,255,0.2);border-radius:16px;padding:28px;width:100%;max-width:860px;margin:auto}
.hc-box h2{color:#00ffff;margin-bottom:4px;font-size:1.2rem}
.hc-score{font-size:3rem;font-weight:bold;margin:8px 0}
.hc-grade-A,.hc-grade-B{color:#00ff88}
.hc-grade-C{color:#ffaa00}
.hc-grade-D,.hc-grade-F{color:#ff4444}
.hc-bar-wrap{background:rgba(255,255,255,0.08);border-radius:6px;height:10px;margin-bottom:20px}
.hc-bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#00ffff,#00ff88);transition:width .4s}
.hc-section{margin-top:18px}
.hc-section h3{color:#888;font-size:0.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:6px}
.hc-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.85rem}
.hc-row:last-child{border:none}
.hc-ok{color:#00ff88}
.hc-err{color:#ff4444}
.hc-warn{color:#ffaa00}
.hc-rec{background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.25);border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#ffcc66;margin-top:6px}
.hc-footer{display:flex;gap:10px;margin-top:24px;justify-content:flex-end}
.hc-close{background:rgba(255,255,255,0.1);color:#e0e0e0;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:bold}
.hc-export{background:#00ffff;color:#000;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:bold}
</style></head>
<body>
<h1>\u{1F9E0} KelionAI Brain Dashboard</h1>
<div class="btns">
  <button class="hc-btn" onclick="runHealthCheck()">🏥 Health Check</button>
  <button class="refresh" onclick="load()">Refresh</button>
</div>
<div class="grid" id="grid"></div>
<div class="hc-modal" id="hc-modal">
  <div class="hc-box">
    <h2>🏥 Health Check Report</h2>
    <div id="hc-body"></div>
    <div class="hc-footer">
      <button class="hc-export" onclick="exportHC()">Exportă JSON</button>
      <button class="hc-close" onclick="document.getElementById('hc-modal').style.display='none'">Închide</button>
    </div>
  </div>
</div>
<script>
var _adminSecret=sessionStorage.getItem('kelion_admin_secret')||'';
var _hcData=null;
function adminHdrs(){return _adminSecret?{'x-admin-secret':_adminSecret}:{};}
async function load(){
  try{
    const r=await fetch('/api/brain',{headers:adminHdrs()});
    const d=await r.json();
    const g=document.getElementById('grid');
    const statusClass=d.status==='healthy'?'good':d.status==='degraded'?'bad':'warn';
    g.innerHTML=\`
    <div class="card"><h2>Status</h2><div class="stat \${statusClass}">\${d.status.toUpperCase()}</div>
    <div class="row"><span class="label">Version</span><span class="val">\${d.version}</span></div>
    <div class="row"><span class="label">Uptime</span><span class="val">\${Math.round(d.uptime/60)}m</span></div>
    <div class="row"><span class="label">Memory</span><span class="val">\${d.memory.rss} / \${d.memory.heap}</span></div></div>
    
    <div class="card"><h2>Conversations</h2><div class="stat">\${d.conversations}</div>
    <div class="row"><span class="label">Learnings</span><span class="val">\${d.learningsExtracted}</span></div>
    <div class="row"><span class="label">Errors (1h)</span><span class="val \${d.recentErrors>5?'bad':''}">\${d.recentErrors}</span></div></div>
    
    <div class="card"><h2>Tool Usage</h2>
    \${Object.entries(d.toolStats).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}</span></div>\`).join('')}</div>
    
    <div class="card"><h2>Tool Health</h2>
    \${Object.entries(d.toolErrors).map(([k,v])=>{
      const cls=v>=5?'bad':v>0?'warn':'good';
      return \`<div class="row"><span class="label">\${k}</span><span class="val \${cls}">\${v>=5?'DEGRADED':v>0?v+' errors':'OK'}</span></div>\`;
    }).join('')}</div>
    
    <div class="card"><h2>Latency (avg)</h2>
    \${Object.entries(d.avgLatency).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}ms</span>
    <div class="bar"><div class="bar-fill" style="width:\${Math.min(100,v/100*100)}%"></div></div></div>\`).join('')||'<div style="color:#888">No data yet</div>'}</div>
    
    <div class="card"><h2>Strategies</h2>
    <div class="row"><span class="label">Search refinements</span><span class="val">\${d.strategies.searchRefinements}</span></div>
    <div class="row"><span class="label">Failure recoveries</span><span class="val">\${d.strategies.failureRecoveries}</span></div>
    \${Object.entries(d.strategies.toolCombinations).map(([k,v])=>\`<div class="row"><span class="label">\${k}</span><span class="val">\${v}</span></div>\`).join('')}</div>
    
    <div class="card" style="grid-column:1/-1"><h2>Journal (last 10)</h2>
    <div class="journal">\${(d.journal||[]).map(j=>\`<div class="journal-entry">\${new Date(j.time).toLocaleTimeString()} — <strong>\${j.event}</strong>: \${j.lesson}</div>\`).join('')||'Empty'}</div></div>
    \`;
  }catch(e){document.getElementById('grid').innerHTML='<div class="card"><div class="stat bad">OFFLINE</div></div>';}
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function ic(ok){return ok?'<span class="hc-ok">✅</span>':'<span class="hc-err">❌</span>';}
function renderHC(d){
  const gc=d.grade==='A'||d.grade==='B'?'hc-grade-A':d.grade==='C'?'hc-grade-C':'hc-grade-D';
  let h='<div class="hc-score '+gc+'">'+d.score+'/100 <small style="font-size:1.2rem">Grade: '+esc(d.grade)+'</small></div>';
  h+='<div class="hc-bar-wrap"><div class="hc-bar-fill" style="width:'+d.score+'%"></div></div>';
  h+='<div class="hc-section"><h3>🖥 Server</h3>';
  h+='<div class="hc-row"><span>Version</span><span>'+esc(d.server.version)+'</span></div>';
  h+='<div class="hc-row"><span>Uptime</span><span>'+esc(d.server.uptime)+'</span></div>';
  h+='<div class="hc-row"><span>Node.js</span><span>'+esc(d.server.nodeVersion)+'</span></div>';
  h+='<div class="hc-row"><span>Memory RSS</span><span>'+esc(d.server.memory.rss)+'</span></div>';
  h+='<div class="hc-row"><span>Heap Used</span><span>'+esc(d.server.memory.heapUsed)+'</span></div></div>';
  h+='<div class="hc-section"><h3>⚙️ Services</h3>';
  for(const[k,s] of Object.entries(d.services)){h+='<div class="hc-row"><span>'+esc(s.label)+'</span><span>'+ic(s.active)+'</span></div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🗄 Database</h3>';
  h+='<div class="hc-row"><span>Connected</span><span>'+ic(d.database.connected)+'</span></div>';
  for(const[t,v] of Object.entries(d.database.tables||{})){h+='<div class="hc-row"><span>'+esc(t)+'</span><span>'+(v.ok?'<span class="hc-ok">✅ '+v.count+' rows</span>':'<span class="hc-err">❌ '+esc(v.error)+'</span>')+'</span></div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🧠 Brain</h3>';
  const bc=d.brain.status==='healthy'?'hc-ok':d.brain.status==='degraded'?'hc-err':'hc-warn';
  h+='<div class="hc-row"><span>Status</span><span class="'+bc+'">'+esc(d.brain.status)+'</span></div>';
  h+='<div class="hc-row"><span>Conversations</span><span>'+d.brain.conversations+'</span></div>';
  h+='<div class="hc-row"><span>Recent Errors</span><span class="'+(d.brain.recentErrors>0?'hc-err':'hc-ok')+'">'+d.brain.recentErrors+'</span></div>';
  if(d.brain.degradedTools&&d.brain.degradedTools.length){h+='<div class="hc-row"><span>Degraded Tools</span><span class="hc-err">'+esc(d.brain.degradedTools.join(', '))+'</span></div>';}
  if(d.brain.journal&&d.brain.journal.length){h+='<div style="margin-top:8px;font-size:0.78rem;color:#888">';for(const j of d.brain.journal){h+='<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">'+new Date(j.time).toLocaleTimeString()+' — <strong>'+esc(j.event)+'</strong>: '+esc(j.lesson)+'</div>';}h+='</div>';}
  h+='</div>';
  h+='<div class="hc-section"><h3>🔐 Auth & Security</h3>';
  h+='<div class="hc-row"><span>Supabase Auth</span><span>'+ic(d.auth.authAvailable)+'</span></div>';
  h+='<div class="hc-row"><span>CSP Enabled</span><span>'+ic(d.security.cspEnabled)+'</span></div>';
  h+='<div class="hc-row"><span>HTTPS Redirect</span><span>'+ic(d.security.httpsRedirect)+'</span></div>';
  h+='<div class="hc-row"><span>Admin Secret</span><span>'+ic(d.security.adminSecretConfigured)+'</span></div>';
  h+='</div>';
  h+='<div class="hc-section"><h3>💳 Payments</h3>';
  h+='<div class="hc-row"><span>Stripe</span><span>'+ic(d.payments.stripeConfigured)+'</span></div>';
  h+='<div class="hc-row"><span>Webhook</span><span>'+ic(d.payments.webhookConfigured)+'</span></div>';
  if(d.payments.activeSubscribers!==null){h+='<div class="hc-row"><span>Active Subscribers</span><span>'+d.payments.activeSubscribers+'</span></div>';}
  h+='</div>';
  if(d.recommendations&&d.recommendations.length){
    h+='<div class="hc-section"><h3>⚠️ Recomandări</h3>';
    for(const r of d.recommendations){h+='<div class="hc-rec">'+esc(r)+'</div>';}
    h+='</div>';
  }
  return h;
}
async function runHealthCheck(){
  const modal=document.getElementById('hc-modal');
  const body=document.getElementById('hc-body');
  modal.style.display='flex';
  body.innerHTML='<div style="text-align:center;color:#00ffff;padding:40px;font-size:1.1rem">⏳ Se verifică...</div>';
  try{
    const r=await fetch('/api/admin/health-check',{headers:adminHdrs()});
    const d=await r.json();
    if(r.status===401){body.innerHTML='<div style="color:#ff4444;padding:20px">❌ Unauthorized. Setează admin secret în sessionStorage (kelion_admin_secret).</div>';return;}
    _hcData=d;
    body.innerHTML=renderHC(d);
  }catch(e){body.innerHTML='<div style="color:#ff4444;padding:20px">❌ Eroare: '+esc(e.message)+'</div>';}
}
function exportHC(){
  if(!_hcData)return;
  const blob=new Blob([JSON.stringify(_hcData,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='health-check-'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.json';
  a.click();
}
load();setInterval(load,5000);
</script></body></html>`);
});

// ═══ PAYMENTS, LEGAL, MESSENGER & DEVELOPER ROUTES ═══
app.use('/api/payments', paymentsRouter);
app.use('/api/legal', legalRouter);
app.use('/api/messenger', messengerRouter);
app.use('/api/telegram', express.json(), telegramRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/developer', developerRouter);
app.use('/api', developerRouter); // mounts /api/v1/* endpoints

// ═══ MESSENGER STATS (admin only) ═══
app.get('/api/messenger/stats', adminAuth, (req, res) => {
    res.json(getMessengerStats());
});

// ═══ MEDIA HEALTH ENDPOINTS ═══
app.get('/api/media/facebook/health', (req, res) => {
    res.json(fbPage.getHealth());
});
app.get('/api/media/instagram/health', (req, res) => {
    res.json(instagram.getHealth());
});
app.get('/api/media/status', adminAuth, (req, res) => {
    res.json({
        messenger: { hasToken: !!process.env.FB_PAGE_ACCESS_TOKEN, health: '/api/messenger/health' },
        telegram: { hasToken: !!process.env.TELEGRAM_BOT_TOKEN, health: '/api/telegram/health' },
        facebook: fbPage.getHealth(),
        instagram: instagram.getHealth(),
        news: { scheduler: 'active', hours: [5, 12, 18], endpoint: '/api/news/public' }
    });
});

// ═══ PUBLISH NEWS TO ALL MEDIA (admin trigger) ═══
app.post('/api/media/publish-news', adminAuth, express.json(), asyncHandler(async (req, res) => {
    const articles = req.body.articles || [];
    const results = { facebook: null, telegram: null };
    if (articles.length > 0) {
        results.facebook = await fbPage.publishNewsBatch(articles, req.body.maxPosts || 3);
        await broadcastNews(articles);
        results.telegram = 'broadcasted';
    }
    res.json({ success: true, results });
}));

// POST /api/ticker/disable — save ticker preference (Premium only)
app.post('/api/ticker/disable', asyncHandler(async (req, res) => {
    const user = await getUserFromToken(req);
    if (!user || !supabaseAdmin) return res.status(401).json({ error: 'Auth required' });
    const { data: sub } = await supabaseAdmin.from('subscriptions').select('plan').eq('user_id', user.id).single();
    if (sub?.plan !== 'premium') return res.status(403).json({ error: 'Premium only' });
    await supabaseAdmin.from('user_preferences').upsert({ user_id: user.id, key: 'ticker_disabled', value: req.body.disabled }, { onConflict: 'user_id,key' });
    res.json({ success: true });
}));

// ═══ NEWS BOT ═══
const newsModule = require('./news');
// Public endpoint — no auth required (for frontend news widget)
app.get('/api/news/public', (req, res) => {
    const allReq = Object.assign({}, req, { url: '/latest', query: req.query });
    newsModule.router.handle(allReq, res, () => {
        res.json({ articles: [], total: 0, message: 'No articles cached yet. RSS fetches at 05:00, 12:00, 18:00 RO time.' });
    });
});
app.use('/api/news', adminAuth, newsModule.router);
newsModule.setSupabase(supabaseAdmin);
newsModule.restoreCache();
setMessengerSupabase(supabaseAdmin);

// ═══ AUTO-PUBLISH: when news fetches, distribute to all media ═══
newsModule.onNewsFetched(async (articles) => {
    logger.info({ component: 'MediaAutoPublish', count: articles.length }, '📢 Auto-publishing news...');
    // Facebook Page (top 3 articles)
    try { await fbPage.publishNewsBatch(articles, 3); } catch (e) { logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'FB Page publish failed'); }
    // Telegram channel broadcast
    try { await broadcastNews(articles); } catch (e) { logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Telegram broadcast failed'); }
    // Instagram auto-publish (top article with image)
    try {
        const topArticle = articles.find(a => a.imageUrl || a.image_url) || articles[0];
        if (topArticle && instagram.publishNewsBatch) {
            await instagram.publishNewsBatch([topArticle], 1);
        }
    } catch (e) { logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Instagram publish failed'); }
    // Messenger subscribers notification
    try { await notifySubscribersNews(articles); } catch (e) { logger.warn({ component: 'MediaAutoPublish', err: e.message }, 'Messenger subscribers notification failed'); }
});

// ═══ STORE ARTICLES REF IN app.locals for Telegram bot ═══
app.locals._getNewsArticles = newsModule.getArticlesArray;

// ═══ TRADING BOT (admin only) ═══
app.use('/api/trading', adminAuth, require('./trading'));

// ═══ SPORTS BOT (admin only) ═══
app.use('/api/sports', adminAuth, require('./sports'));

// 404 for unknown API routes — must come before the catch-all
app.use('/api', (req, res, next) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.get('*', (req, res) => {
    const nonce = res.locals.cspNonce || '';
    const html = _indexHtml.replace(
        /<script\b(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`
    );
    res.type('html').send(html);
});

// Sentry error handler must be registered after all routes
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

// ═══ GLOBAL ERROR HANDLER ═══
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    if (process.env.NODE_ENV === 'production') {
        logger.error({ component: 'Error', method: req.method, path: req.path }, err.message);
        return res.status(statusCode).json({
            error: statusCode === 500 ? 'Internal server error' : err.message
        });
    }
    logger.error({ component: 'Error', method: req.method, path: req.path, err: err.stack }, err.message);
    res.status(statusCode).json({
        error: err.message,
        stack: err.stack,
        details: err.details || undefined
    });
});

// ═══ STARTUP ═══
function logConfigHealth() {
    const checks = [
        { name: 'FB_PAGE_ACCESS_TOKEN', set: !!process.env.FB_PAGE_ACCESS_TOKEN, for: 'Messenger Bot' },
        { name: 'FB_APP_SECRET', set: !!process.env.FB_APP_SECRET, for: 'Messenger Security' },
        { name: 'FB_VERIFY_TOKEN', set: !!process.env.FB_VERIFY_TOKEN, for: 'Messenger Webhook' },
        { name: 'FB_PAGE_ID', set: !!process.env.FB_PAGE_ID, for: 'Facebook Page Posts' },
        { name: 'TELEGRAM_BOT_TOKEN', set: !!process.env.TELEGRAM_BOT_TOKEN, for: 'Telegram Bot' },
        { name: 'OPENAI_API_KEY', set: !!process.env.OPENAI_API_KEY, for: 'AI Brain (OpenAI)' },
        { name: 'GROQ_API_KEY', set: !!process.env.GROQ_API_KEY, for: 'AI Brain (Groq)' },
        { name: 'SUPABASE_URL', set: !!process.env.SUPABASE_URL, for: 'Database' },
        { name: 'SUPABASE_SERVICE_KEY', set: !!process.env.SUPABASE_SERVICE_KEY, for: 'Database Admin' },
        { name: 'ELEVENLABS_API_KEY', set: !!process.env.ELEVENLABS_API_KEY, for: 'Voice TTS' },
        { name: 'INSTAGRAM_ACCOUNT_ID', set: !!process.env.INSTAGRAM_ACCOUNT_ID, for: 'Instagram Posts' },
        { name: 'STRIPE_SECRET_KEY', set: !!process.env.STRIPE_SECRET_KEY, for: 'Payments' },
    ];
    const missing = checks.filter(c => !c.set);
    const configured = checks.filter(c => c.set);

    logger.info({ component: 'Config', configured: configured.length, total: checks.length },
        `✅ ${configured.length}/${checks.length} secrets configured`);

    if (missing.length > 0) {
        missing.forEach(m => {
            logger.warn({ component: 'Config', secret: m.name, service: m.for },
                `⚠️ Missing: ${m.name} — ${m.for} will not work`);
        });
    }
}

if (require.main === module) {
    process.on('uncaughtException', (err) => {
        logger.fatal({ component: 'Process', err: err.stack }, 'Uncaught Exception: ' + err.message);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        logger.fatal({ component: 'Process', reason: String(reason) }, 'Unhandled Rejection: ' + reason);
        process.exit(1);
    });

    runMigration().then(migrated => {
        logConfigHealth();
        app.listen(PORT, '0.0.0.0', () => {
            logger.info({ component: 'Server', port: PORT, ai: { claude: !!process.env.ANTHROPIC_API_KEY, gpt4o: !!process.env.OPENAI_API_KEY, deepseek: !!process.env.DEEPSEEK_API_KEY }, tts: !!process.env.ELEVENLABS_API_KEY, payments: !!process.env.STRIPE_SECRET_KEY, db: !!supabaseAdmin, migration: !!migrated }, 'KelionAI v2.3 started on port ' + PORT);
            // Auto-register Telegram webhook
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.APP_URL) {
                const webhookUrl = `${process.env.APP_URL}/api/telegram/webhook`;
                fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: webhookUrl })
                })
                .then(r => r.json())
                .then(data => {
                    if (data.ok) logger.info({ component: 'Telegram' }, `✅ Webhook registered: ${webhookUrl}`);
                    else logger.warn({ component: 'Telegram', error: data.description }, '❌ Webhook registration failed');
                })
                .catch(e => logger.error({ component: 'Telegram', err: e.message }, 'Webhook registration error'));
            }
        });
    }).catch(e => {
        logger.error({ component: 'Server' }, 'Migration error');
        app.listen(PORT, '0.0.0.0', () => logger.info({ component: 'Server', port: PORT }, 'KelionAI v2.3 on port ' + PORT + ' (migration failed)'));
    });
}

module.exports = app;
