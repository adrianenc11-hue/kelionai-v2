// ═══════════════════════════════════════════════════════════════
// KelionAI — Golden Knowledge Seed
// Descarcă cunoștințe profesionale de programare în brain_memory
// Rulare: node scripts/seed-knowledge.js
// ATENȚIE: Aceste cunoștințe sunt PERMANENTE (importance: 1.0)
// ═══════════════════════════════════════════════════════════════
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const GOLDEN_KNOWLEDGE = [

  // ══════════════════════════════════════════
  // CATEGORIA 1: SAFE CODING PATTERNS
  // ══════════════════════════════════════════
  {
    category: 'safe_coding',
    title: 'Principiul #1: Citește înainte de a scrie',
    content: `REGULĂ DE AUR: Înainte de a modifica ORICE fișier, CITEȘTE-L COMPLET cu ADMIN_READ_FILE. Nu presupune niciodată conținutul unui fișier. Nu scrie fragmente — scrie ÎNTOTDEAUNA fișierul complet cu toate liniile originale plus modificările tale. Un fișier de 1700 linii trebuie rescris cu 1700+ linii, nu cu 143.`
  },
  {
    category: 'safe_coding',
    title: 'Principiul #2: Backup automat obligatoriu',
    content: `Înainte de orice scriere, VERIFICĂ: (1) Există backup automat? (2) Fișierul nou are cel puțin 50% din liniile originalului? (3) Fișierul e protejat? Dacă oricare din aceste condiții e încălcată, oprește-te și raportează. Mai bine nu faci nimic decât să distrugi cod funcțional.`
  },
  {
    category: 'safe_coding',
    title: 'Principiul #3: Testează sintaxa înainte de deploy',
    content: `După fiecare scriere de fișier .js, rulează mental sau real "node --check" pentru a verifica sintaxa. Verifică: (1) Toate parantezele sunt închise corect (2) Toate acoladele {} sunt perechi (3) Template literals folosesc backtick, nu apostrof (4) Virgulele sunt prezente între parametri (5) Nu există variabile nedefinite referite.`
  },
  {
    category: 'safe_coding',
    title: 'Principiul #4: Nu suprascrie fișiere critice agresiv',
    content: `Fișierele critice ale aplicației (server/index.js, server/brain.js, server/routes/chat.js, server/routes/admin.js, app/js/app.js, server/migrate.js) NU pot fi suprascrise complet. Trebuie păstrat minimum 70% din codul original. Dacă vrei modificări mari, fă-le în pași mici, testând fiecare pas.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 2: ARHITECTURA NODE.JS
  // ══════════════════════════════════════════
  {
    category: 'architecture',
    title: 'Express.js: Structura corectă a unui server',
    content: `Un server Express corect urmează ordinea: (1) require-uri (2) app = express() (3) middleware global (helmet, cors, rate-limit, json parser) (4) middleware de autentificare (5) rute statice (express.static) (6) rute API (7) error handler global (8) app.listen(). NU schimba niciodată această ordine — middleware-ul se aplică doar rutelor declarate DUPĂ el.`
  },
  {
    category: 'architecture',
    title: 'Middleware Chain: Cum funcționează',
    content: `Express procesează middleware-urile în ordine. Regulile: (1) app.use() se aplică tuturor rutelor declarate DUPĂ el (2) Middleware de erori au 4 parametri: (err, req, res, next) (3) Dacă un middleware nu apelează next(), chain-ul se oprește (4) res.json() sau res.send() încheie chain-ul — nu trimite NICIODATĂ 2 răspunsuri.`
  },
  {
    category: 'architecture',
    title: 'Async/Await: Patterns sigure',
    content: `Reguli pentru async/await în Node.js: (1) ORICE funcție care folosește await TREBUIE să fie async (2) Wrap-uiește MEREU await în try/catch — un await fără catch crashează serverul (3) Pentru operații paralele independente, folosește Promise.all() nu await secvential (4) Timeout: folosește Promise.race([operatie, timeout]) pentru a preveni blocaje infinite (5) AbortController pentru a anula fetch-uri.`
  },
  {
    category: 'architecture',
    title: 'Error Handling: Straturile corecte',
    content: `Strategie de error handling: (1) NIVEL FUNCȚIE: try/catch local, logghează eroarea, returnează fallback (2) NIVEL RUTĂ: Middleware de erori Express care returnează JSON cu status potrivit (3) NIVEL GLOBAL: process.on('unhandledRejection') și process.on('uncaughtException') — logghează și fă restart graceful. NU ascunde niciodată erorile cu catch gol — minimum logger.warn().`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 3: SUPABASE / DATABASE
  // ══════════════════════════════════════════
  {
    category: 'database',
    title: 'Supabase: Patterns de scriere corectă',
    content: `Reguli Supabase: (1) Folosește MEREU supabaseAdmin (service key) pentru operații server-side, nu supabase (anon key) (2) La INSERT, verifică dacă tabela și coloanele EXISTĂ în migrate.js (3) La UPSERT, specifică onConflict explicit (4) Verifică MEREU { error } din răspuns — nu presupune că inserarea a reușit (5) Pentru operații critice (plăți, autentificare), logghează atât succesul cât și eșecul.`
  },
  {
    category: 'database',
    title: 'Migrații: Cum adaugi tabele și coloane safe',
    content: `Reguli de migrație: (1) Folosește MEREU "CREATE TABLE IF NOT EXISTS" și "ALTER TABLE ADD COLUMN IF NOT EXISTS" (2) Nu fă DROP TABLE niciodată pe producție (3) Adaugă indexuri pentru coloanele folosite în WHERE/ORDER BY (4) RLS (Row Level Security) pe tabele cu date utilizator (5) Testează migrația local ÎNAINTE de deploy (6) Dacă adaugi o tabelă nouă, adaug-o și în lista de verificare din runMigration().`
  },
  {
    category: 'database',
    title: 'Salvarea conversațiilor: Pattern complet',
    content: `Flow-ul corect de salvare conversație: (1) Verifică dacă supabaseAdmin există (2) Dacă conversationId lipsește, INSERT în conversations cu user_id, avatar, title (3) Dacă conversationId există, UPDATE updated_at (4) INSERT mesaje (user + assistant) în messages cu conversation_id, role, content, language, source (5) Toate operațiile sunt non-blocking (.catch(() => {})) pentru a nu bloca răspunsul.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 4: DEBUGGING & DIAGNOSTICARE
  // ══════════════════════════════════════════
  {
    category: 'debugging',
    title: 'Diagnostic: Cum identifici o eroare',
    content: `Pașii de diagnostic: (1) CITEȘTE eroarea exact — nu presupune (2) Identifică UNDE apare: frontend (browser console) sau backend (server logs) (3) Verifică chain-ul: request → middleware → handler → response (4) Dacă e 500, citește stack trace-ul din log (5) Dacă e "column does not exist" sau "relation does not exist" → tabelul/coloana lipsește din migrație (6) Dacă e timeout → verifică Promise.race() sau AbortController.`
  },
  {
    category: 'debugging',
    title: 'Silent failures: Cele mai periculoase bug-uri',
    content: `Eșecuri silențioase comune: (1) INSERT într-o tabelă care nu există → Supabase returnează eroare dar .catch(() => {}) o ascunde (2) Coloană lipsă la INSERT → eroare silențioasă, datele se pierd (3) Token expirat → request merge dar returnează 401, nu se logghează (4) Rate limit atins → request-ul e respins dar UI-ul nu arată eroare. SOLUȚIE: Logghează MEREU erorile, nu le ascunde cu catch gol.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 5: DEPLOYMENT & OPERAȚIUNI
  // ══════════════════════════════════════════
  {
    category: 'deployment',
    title: 'Deploy safe: Checklist',
    content: `Înainte de deploy: (1) git status — verifică ce fișiere s-au modificat (2) node --check pe fiecare .js modificat (3) Rulează testele existente (npm run test:unit) (4) Commit cu mesaj descriptiv (5) git push (6) Monitorizează health endpoint după deploy (7) Dacă health check eșuează în 3 min → git revert automat. NICIODATĂ nu fă deploy fără a verifica health-ul după.`
  },
  {
    category: 'deployment',
    title: 'Rollback: Cum revii la o versiune stabilă',
    content: `Strategii de rollback: (1) RAPID: git revert HEAD && git push (anulează ultimul commit) (2) PRECIS: git revert <commit-hash> (anulează un commit specific) (3) NUCLEAR: git reset --hard <commit-hash> && git push -f (revine la o versiune exactă, pierde istoricul) (4) BACKUP: folderul backups/ conține copii ale fișierelor înainte de fiecare scriere. Preferă MEREU opțiunea 1 sau 2.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 6: SECURITATE
  // ══════════════════════════════════════════
  {
    category: 'security',
    title: 'Securitate: Reguli absolute',
    content: `Reguli de securitate: (1) NU expune API keys sau secrete în frontend NICIODATĂ (2) NU stoca parole în plaintext — folosește bcrypt sau auth provider (3) Validează TOATE input-urile cu Zod sau similar (4) Rate limiting pe ORICE endpoint public (5) CORS configurat strict (nu wildcard *) (6) Helmet.js pentru headers de securitate (7) Nu decoda JWT manual — folosește biblioteca oficială (8) HttpOnly cookies pentru sesiuni sensibile.`
  },
  {
    category: 'security',
    title: 'Input Validation: Cum previi injecțiile',
    content: `Validare input: (1) Folosește Zod schemas pentru body validation (2) Sanitizează HTML cu DOMPurify sau escape manual (<, >, &, ", ') (3) Nu construi SQL cu concatenare de stringuri — folosește parametri (4) Limitează lungimea input-ului (message: max 10000 chars) (5) Verifică tipul datelor (typeof, instanceof) (6) Nu folosi eval() sau Function() cu input utilizator.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 7: PERFORMANCE & OPTIMIZARE
  // ══════════════════════════════════════════
  {
    category: 'performance',
    title: 'Caching: Strategii eficiente',
    content: `Strategii de cache: (1) In-Memory Map pentru date accesate frecvent (TTL 5-60 min) (2) Redis pentru cache distribuit între instanțe (3) HTTP Cache headers (ETag, Cache-Control) pentru assets statice (4) Invalidare cache la UPDATE — nu servi date vechi (5) Cache-ul NU înlocuiește baza de date — e doar optimizare (6) Monitorizează hit rate — dacă e sub 50%, cache-ul e inutil.`
  },
  {
    category: 'performance',
    title: 'Memory Management: Previne scurgeri',
    content: `Prevenire memory leaks: (1) clearInterval() și clearTimeout() în finally/cleanup (2) Limitează dimensiunea Map-urilor și array-urilor cu maxSize (3) WeakMap pentru referințe la obiecte temporare (4) Stream-urile mari se procesează chunk-by-chunk, nu se încarcă în memorie (5) Monitorizează process.memoryUsage() periodic (6) Garbage collect nu se forțează manual — lasă V8 să lucreze.`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 8: PATTERN-URI DE COD CURAT
  // ══════════════════════════════════════════
  {
    category: 'clean_code',
    title: 'Cod curat: Principii fundamentale',
    content: `Principii de cod curat: (1) O funcție face UN SINGUR lucru (2) Numele funcțiilor descriu CE face, nu CUM — saveConversation() nu doDBStuff() (3) Maximum 3 nivele de indentare — dacă ai mai mult, extrage funcții helper (4) Early return pentru a evita nesting: if (!valid) return; (5) Constante cu SCREAMING_CASE (MAX_RETRIES, API_URL) (6) Nu repeta cod — extrage în funcții reutilizabile (DRY).`
  },
  {
    category: 'clean_code',
    title: 'Modularizare: Cum organizezi un proiect',
    content: `Structura proiectului: (1) Separă routes, middleware, models, services, utils (2) Un fișier = o responsabilitate (chat.js = doar chat, auth.js = doar auth) (3) Configurări în fișiere separate (config/, .env) nu hardcodate (4) Exportă funcții specifice, nu obiecte mari (5) Dependențele fluxului: routes → services → models → database (6) Nu importa circular (A importă B care importă A).`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 9: AI/LLM INTEGRATION
  // ══════════════════════════════════════════
  {
    category: 'ai_integration',
    title: 'LLM API Calls: Best practices',
    content: `Reguli pentru integrare AI: (1) MEREU timeout pe API calls (AbortSignal.timeout(30000)) (2) Fallback chain: OpenAI → Gemini → Groq — dacă unul eșuează, treci la următorul (3) Estimează costul ÎNAINTE de call (tokens = chars/4 aproximativ) (4) Logghează costul în ai_costs table (5) Cache semantic pentru întrebări similare (6) Streaming (SSE) pentru răspunsuri lungi — nu face userul să aștepte (7) Sanitizează output-ul AI — strip system tags, markdown injection.`
  },
  {
    category: 'ai_integration',
    title: 'Prompt Engineering: Patterns eficiente',
    content: `Prompt patterns: (1) System prompt = personalitate + capabilități + reguli (2) User context = limba, locația, ora, istoricul conversației (3) Chain-of-Thought: "Gândește pas cu pas înainte de a răspunde" (4) Few-shot: Dă exemple de răspunsuri bune (5) Tool use: Descrie tool-urile disponibile cu JSON schema (6) Safety: "Nu genera conținut dăunător, nu expune date personale" (7) Output format: Specifică exact formatul dorit (JSON, markdown, text).`
  },

  // ══════════════════════════════════════════
  // CATEGORIA 10: META-CUNOȘTINȚE — CUM SĂ GÂNDEȘTI
  // ══════════════════════════════════════════
  {
    category: 'meta_thinking',
    title: 'Cum să gândești ca un programator senior',
    content: `Principii de gândire: (1) ÎNTREABĂ înainte de a acționa — nu presupune (2) Verifică MEREU ce există înainte de a crea ceva nou (3) Fă lucruri simple ÎNTÂI, optimizează DUPĂ (4) Dacă ceva pare prea complicat, probabil faci greșit — caută o abordare mai simplă (5) Testează FIECARE schimbare — nu "ar trebui să meargă" (6) Codul tău e citit de 10x mai mulți oameni decât e scris — fă-l lizibil (7) Git commit-urile mici și frecvente sunt mai bune decât unul mare.`
  },
  {
    category: 'meta_thinking',
    title: 'Cum să rezolvi bug-uri sistematic',
    content: `Debugging sistematic: (1) REPRODUCE bug-ul — dacă nu-l poți reproduce, nu-l poți repara (2) IZOLEAZĂ — unde exact apare? Frontend? Backend? DB? Network? (3) IPOTEZE — formulează 2-3 posibile cauze (4) TESTEAZĂ fiecare ipoteză cu date concrete, nu presupuneri (5) FIX minim — repară DOAR ce e stricat, nu rescrie tot (6) VERIFICĂ — testează fix-ul în contextul original (7) PREVINE — adaugă validare/test ca să nu reapară.`
  },
  {
    category: 'meta_thinking',
    title: 'Principiul celui mai mic risc',
    content: `Când modifici cod de producție: (1) FAC fix-urile MICI — un fișier, o funcție pe rând (2) NU refactorizez în același commit cu un fix de bug (3) DEPLOY pe staging/test înainte de producție dacă e posibil (4) MONITORIZEZ 5 minute după deploy — health check, logs (5) Dacă ceva nu merge, REVERT imediat — nu încerca să repari pe loc (6) Mai bine un fix urât care funcționează decât un refactor elegant care strică.`
  }
];

async function seedKnowledge() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  KelionAI — Seeding Golden Knowledge');
  console.log('═══════════════════════════════════════════════════');

  let inserted = 0;
  let skipped = 0;

  for (const item of GOLDEN_KNOWLEDGE) {
    // Check if already exists (by title)
    const { data: existing } = await supabaseAdmin
      .from('brain_memory')
      .select('id')
      .eq('memory_type', 'golden_knowledge')
      .like('content', `%${item.title}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`  ⏭️  Skip (exists): ${item.title}`);
      skipped++;
      continue;
    }

    const { error } = await supabaseAdmin.from('brain_memory').insert({
      user_id: 'system',
      memory_type: 'golden_knowledge',
      content: `[${item.category.toUpperCase()}] ${item.title}: ${item.content}`,
      metadata: {
        category: item.category,
        title: item.title,
        source: 'antigravity_seed',
        protected: true,
        version: '1.0',
        seeded_at: new Date().toISOString()
      },
      importance: 1.0 // Maximum importance — never auto-deleted
    });

    if (error) {
      console.log(`  ❌ Error: ${item.title} — ${error.message}`);
    } else {
      console.log(`  ✅ Seeded: ${item.title}`);
      inserted++;
    }
  }

  console.log('');
  console.log(`  📊 Results: ${inserted} inserted, ${skipped} skipped (already exist)`);
  console.log(`  📚 Total knowledge items: ${GOLDEN_KNOWLEDGE.length}`);
  console.log('═══════════════════════════════════════════════════');
}

seedKnowledge().catch(e => {
  console.error('❌ Seed failed:', e.message);
  process.exit(1);
});
