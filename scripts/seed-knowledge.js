// ═══════════════════════════════════════════════════════════════
// KelionAI — Golden Knowledge Seed
// Rulare: node scripts/seed-knowledge.js
// ═══════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const GOLDEN_KNOWLEDGE = [
  // ══ SAFE CODING ══
  {
    t: 'SAFE_CODING #1: Citește înainte de a scrie',
    c: 'Înainte de a modifica ORICE fișier, CITEȘTE-L COMPLET cu ADMIN_READ_FILE. Nu presupune niciodată conținutul. Nu scrie fragmente — scrie ÎNTOTDEAUNA fișierul complet cu toate liniile originale + modificările. Un fișier de 1700 linii trebuie rescris cu 1700+ linii, nu cu 143.',
  },
  {
    t: 'SAFE_CODING #2: Backup și verificare',
    c: 'Înainte de scriere: (1) Backup automat? (2) Fișierul nou ≥50% din original? (3) E fișier protejat? Dacă orice condiție e încălcată → STOP. Mai bine nu faci nimic decât să distrugi cod funcțional.',
  },
  {
    t: 'SAFE_CODING #3: Testează sintaxa',
    c: 'După scriere .js, verifică: paranteze închise, acolade {}, template literals cu backtick nu apostrof, virgule între parametri, variabile definite. node --check detectează erori înainte de deploy.',
  },
  {
    t: 'SAFE_CODING #4: Fișiere critice',
    c: 'server/index.js, server/brain.js, server/routes/chat.js, admin.js, app/js/app.js, migrate.js — NU se suprascriu complet. Păstrează min 70% din original. Modificări mari = pași mici, testat fiecare.',
  },
  // ══ ARHITECTURA NODE.JS ══
  {
    t: 'ARCH #1: Express server structure',
    c: 'Ordine obligatorie: (1) require (2) app=express() (3) middleware global (helmet,cors,rate-limit,json) (4) auth middleware (5) static files (6) API routes (7) error handler (8) app.listen(). Middleware se aplică DOAR rutelor declarate DUPĂ el.',
  },
  {
    t: 'ARCH #2: Middleware chain',
    c: 'Express procesează în ordine. app.use() se aplică rutelor DUPĂ el. Error middleware = 4 params (err,req,res,next). Fără next() = chain blocat. res.json()/res.send() = niciodată 2 răspunsuri.',
  },
  {
    t: 'ARCH #3: Async/Await safe',
    c: 'Funcție cu await = TREBUIE async. Mereu try/catch pe await (altfel crash server). Promise.all() pt operații paralele. Promise.race([op, timeout]) pt limite. AbortController pt fetch.',
  },
  {
    t: 'ARCH #4: Error handling layers',
    c: 'FUNCȚIE: try/catch + logghează + fallback. RUTĂ: error middleware Express cu JSON response. GLOBAL: process.on(unhandledRejection/uncaughtException) + restart graceful. NU catch gol — minimum logger.warn().',
  },
  // ══ SUPABASE / DATABASE ══
  {
    t: 'DB #1: Scriere corectă Supabase',
    c: 'supabaseAdmin (service key) pt server-side. Verifică tabelă+coloane EXISTĂ în migrate.js. UPSERT cu onConflict explicit. Verifică { error } MEREU. Logghează succes+eșec la operații critice.',
  },
  {
    t: 'DB #2: Migrații safe',
    c: 'CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS. NICIODATĂ DROP TABLE pe producție. Indexuri pe coloane WHERE/ORDER BY. RLS pe date utilizator. Testează local ÎNTÂI. Adaugă tabele noi în health check.',
  },
  {
    t: 'DB #3: Salvare conversații',
    c: 'Flow: (1) supabaseAdmin există? (2) conversationId lipsă → INSERT conversations (3) conversationId există → UPDATE updated_at (4) INSERT mesaje cu conversation_id,role,content,language,source (5) Non-blocking cu .catch().',
  },
  // ══ DEBUGGING ══
  {
    t: 'DEBUG #1: Diagnostic sistematic',
    c: 'Citește eroarea EXACT. Identifică UNDE: frontend/backend. Verifică chain: request→middleware→handler→response. 500=stack trace. "column does not exist"=lipsă din migrație. Timeout=Promise.race/AbortController.',
  },
  {
    t: 'DEBUG #2: Silent failures',
    c: 'Periculoase: INSERT în tabelă inexistentă + .catch(()=>{}) ascunde eroarea. Coloană lipsă la INSERT = date pierdute. Token expirat = 401 neloggat. Rate limit = request respins fără eroare UI. SOLUȚIE: logghează MEREU, nu catch gol.',
  },
  // ══ DEPLOYMENT ══
  {
    t: 'DEPLOY #1: Checklist',
    c: 'Înainte: git status, node --check pe .js modificate, npm run test:unit, commit descriptiv, git push. După: monitorizează health 5 min. Health check fail → git revert automat. NICIODATĂ deploy fără verificare health.',
  },
  {
    t: 'DEPLOY #2: Rollback',
    c: 'RAPID: git revert HEAD && git push. PRECIS: git revert <hash>. NUCLEAR: git reset --hard <hash> && git push -f. BACKUP: folder backups/. Preferă MEREU opțiunea 1 sau 2.',
  },
  // ══ SECURITATE ══
  {
    t: 'SEC #1: Reguli absolute',
    c: 'NU expune API keys în frontend. NU parole plaintext — bcrypt/auth provider. Validare input cu Zod. Rate limiting pe endpoint public. CORS strict. Helmet.js. NU decode JWT manual. HttpOnly cookies pt sesiuni.',
  },
  {
    t: 'SEC #2: Input validation',
    c: 'Zod schemas pt body. DOMPurify/escape HTML. NU SQL cu concatenare — parametri. Limită input (10000 chars). Verifică typeof. NU eval()/Function() cu input user.',
  },
  // ══ PERFORMANCE ══
  {
    t: 'PERF #1: Caching',
    c: 'In-Memory Map cu TTL 5-60 min. Redis pt distribuit. HTTP Cache (ETag,Cache-Control) pt static. Invalidare la UPDATE. Cache NU înlocuiește DB. Monitorizează hit rate — sub 50% = inutil.',
  },
  {
    t: 'PERF #2: Memory management',
    c: 'clearInterval()/clearTimeout() în finally. Limitează Map/array cu maxSize. WeakMap pt ref temporare. Stream chunk-by-chunk. Monitorizează process.memoryUsage(). Nu forța GC.',
  },
  // ══ COD CURAT ══
  {
    t: 'CLEAN #1: Principii',
    c: 'O funcție = UN lucru. Nume descriptive: saveConversation() nu doStuff(). Max 3 nivele indent — extrage helper. Early return: if(!valid) return. SCREAMING_CASE pt constante. DRY — nu repeta cod.',
  },
  {
    t: 'CLEAN #2: Modularizare',
    c: 'Separă routes/middleware/models/services/utils. Un fișier = o responsabilitate. Config în .env nu hardcodat. Exportă funcții specifice. Dependențe: routes→services→models→db. NU import circular.',
  },
  // ══ AI INTEGRATION ══
  {
    t: 'AI #1: LLM API best practices',
    c: 'Timeout MEREU (AbortSignal.timeout(30000)). Fallback chain: OpenAI→Gemini→Groq. Estimează cost (tokens≈chars/4). Logghează în ai_costs. Cache semantic. Streaming SSE pt răspunsuri lungi. Sanitizează output AI.',
  },
  {
    t: 'AI #2: Prompt engineering',
    c: 'System prompt = personalitate+capabilități+reguli. User context = limba,locație,oră,istoricul. Chain-of-Thought. Few-shot cu exemple. Tool use cu JSON schema. Safety rules. Output format specificat.',
  },
  // ══ META-GÂNDIRE ══
  {
    t: 'META #1: Gândește ca senior',
    c: 'ÎNTREABĂ înainte de acțiune. Verifică ce există înainte de creat. Simplu ÎNTÂI, optimizare DUPĂ. Prea complicat = approach greșit. TESTEAZĂ fiecare schimbare. Cod citit 10x mai mult decât scris. Commit-uri mici și dese.',
  },
  {
    t: 'META #2: Debug sistematic',
    c: 'REPRODUCE bugul. IZOLEAZĂ — frontend/backend/DB/network. IPOTEZE — 2-3 posibile cauze. TESTEAZĂ fiecare cu date concrete. FIX minim. VERIFICĂ în context original. PREVINE — adaugă validare/test.',
  },
  {
    t: 'META #3: Cel mai mic risc',
    c: 'Fix-uri MICI. NU refactorizez + fix bug în același commit. Staging înainte de producție. Monitorizează 5 min post-deploy. Nu merge → REVERT imediat. Fix urât funcțional > refactor elegant stricat.',
  },
];

async function seedKnowledge() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  KelionAI — Seeding Golden Knowledge');
  console.log('═══════════════════════════════════════════════════\n');

  // Step 1: Fix CHECK constraint to allow golden_knowledge
  console.log('  🔧 Fixing memory_type CHECK constraint...');
  const { Client } = require('pg');
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Build from Supabase URL
    const url = new URL(process.env.SUPABASE_URL);
    const _host = url.hostname
      .replace('supabase.co', 'supabase.com')
      .replace(/^[^.]+/, (m) => m.replace(/[^a-z0-9-]/gi, ''));
    const dbHost = `db.${url.hostname.split('.')[0]}.supabase.com`;
    const dbPass = process.env.DB_PASSWORD || process.env.SUPABASE_SERVICE_KEY;
    connectionString = `postgresql://postgres:${dbPass}@${dbHost}:5432/postgres`;
  }

  try {
    const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await pg.connect();
    await pg.query(`ALTER TABLE brain_memory DROP CONSTRAINT IF EXISTS brain_memory_memory_type_check`);
    await pg.query(
      `ALTER TABLE brain_memory ADD CONSTRAINT brain_memory_memory_type_check CHECK (memory_type IN ('general','conversation','fact','preference','skill','emotion','context','system','golden_knowledge','write_lesson','file_write'))`
    );
    // Also add metadata column if missing
    await pg.query(`ALTER TABLE brain_memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`);
    await pg.end();
    console.log('  ✅ CHECK constraint updated + metadata column ensured\n');
  } catch (pgErr) {
    console.log(`  ⚠️  PG direct fix failed (${pgErr.message}), trying without constraint change...\n`);
    // Fallback: use memory_type 'general' with [GOLDEN] prefix
  }

  // Step 2: Insert knowledge
  let inserted = 0,
    skipped = 0,
    failed = 0;

  for (const item of GOLDEN_KNOWLEDGE) {
    const fullContent = `[GOLDEN] ${item.t}: ${item.c}`;

    // Check if exists
    const { data: existing } = await supabaseAdmin
      .from('brain_memory')
      .select('id')
      .like('content', `%${item.t}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`  ⏭️  ${item.t}`);
      skipped++;
      continue;
    }

    // Try with golden_knowledge type first
    let { error } = await supabaseAdmin.from('brain_memory').insert({
      user_id: '24eaf533-0af5-4871-9c74-91e123936397',
      memory_type: 'golden_knowledge',
      content: fullContent,
      importance: 1.0,
      metadata: { category: item.t.split('#')[0].trim(), protected: true, source: 'antigravity' },
    });

    // Fallback: use 'general' type if constraint still blocks
    if (error && error.message.includes('memory_type_check')) {
      const r2 = await supabaseAdmin.from('brain_memory').insert({
        user_id: '24eaf533-0af5-4871-9c74-91e123936397',
        memory_type: 'general',
        content: fullContent,
        importance: 1.0,
        metadata: { category: item.t.split('#')[0].trim(), protected: true, source: 'antigravity', is_golden: true },
      });
      error = r2.error;
    }

    if (error) {
      console.log(`  ❌ ${item.t} — ${error.message}`);
      failed++;
    } else {
      console.log(`  ✅ ${item.t}`);
      inserted++;
    }
  }

  console.log(
    `\n  📊 Inserted: ${inserted} | Skipped: ${skipped} | Failed: ${failed} | Total: ${GOLDEN_KNOWLEDGE.length}`
  );
  console.log('═══════════════════════════════════════════════════');
}

seedKnowledge().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
