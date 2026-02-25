#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// KelionAI Brain v2 — ADVANCED TEST SUITE
// Tests every component HONESTLY. Reports real status.
// ═══════════════════════════════════════════════════════════════

(async () => {
const { KelionBrain } = require('./server/brain');
const { buildSystemPrompt } = require('./server/persona');

const PASS = '\x1b[32m✅ PASS\x1b[0m';
const FAIL = '\x1b[31m❌ FAIL\x1b[0m';
const WARN = '\x1b[33m⚠️  WARN\x1b[0m';
const INFO = '\x1b[36mℹ️  INFO\x1b[0m';

let passed = 0, failed = 0, warnings = 0;
const issues = [];

function test(name, fn) {
    try {
        const result = fn();
        if (result === true) { console.log(`${PASS}  ${name}`); passed++; }
        else if (result === 'warn') { console.log(`${WARN}  ${name}`); warnings++; }
        else { console.log(`${FAIL}  ${name}`); failed++; issues.push(name); }
    } catch (e) {
        console.log(`${FAIL}  ${name} — ${e.message}`);
        failed++;
        issues.push(`${name}: ${e.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        const result = await fn();
        if (result === true) { console.log(`${PASS}  ${name}`); passed++; }
        else if (result === 'warn') { console.log(`${WARN}  ${name}`); warnings++; }
        else { console.log(`${FAIL}  ${name} — got: ${JSON.stringify(result)}`); failed++; issues.push(name); }
    } catch (e) {
        console.log(`${FAIL}  ${name} — ${e.message}`);
        failed++;
        issues.push(`${name}: ${e.message}`);
    }
}

console.log('\n\x1b[1m══════════════════════════════════════════\x1b[0m');
console.log('\x1b[1m  KelionAI Brain v2 — TEST SUITE\x1b[0m');
console.log('\x1b[1m══════════════════════════════════════════\x1b[0m\n');

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 1: BRAIN INITIALIZATION
// ═══════════════════════════════════════════════════════════════
console.log('\x1b[1m─── 1. INITIALIZATION ───\x1b[0m');

const brain = new KelionBrain({
    anthropicKey: 'test-key',
    openaiKey: 'test-key',
    tavilyKey: null,          // No key — tests degradation
    togetherKey: null,
    supabaseAdmin: null       // No DB — tests fallbacks
});

test('Brain instantiates without crash', () => brain !== null && brain !== undefined);
test('Brain has all tool stats', () => {
    const required = ['search', 'weather', 'imagine', 'vision', 'memory', 'map'];
    return required.every(t => t in brain.toolStats);
});
test('Brain starts with zero counters', () => brain.conversationCount === 0 && brain.learningsExtracted === 0);
test('Brain has strategies object', () => brain.strategies && typeof brain.strategies === 'object');
test('Brain has journal array', () => Array.isArray(brain.journal));
test('Brain has conversation summaries map', () => brain.conversationSummaries instanceof Map);

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 2: INTENT ANALYSIS — The core intelligence
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 2. INTENT ANALYSIS (RO) ───\x1b[0m');

// Search
test('Detects "caută informații despre Python"', () => {
    const r = brain.analyzeIntent('caută informații despre Python', 'ro');
    return r.needsSearch === true && r.searchQuery.length > 0;
});
test('Detects "ce este inteligența artificială?"', () => {
    const r = brain.analyzeIntent('ce este inteligența artificială?', 'ro');
    return r.needsSearch === true;
});
test('Detects "cât costă un iPhone 16?"', () => {
    const r = brain.analyzeIntent('cât costă un iPhone 16?', 'ro');
    return r.needsSearch === true;
});

// Weather
test('Detects "cum e vremea în București?"', () => {
    const r = brain.analyzeIntent('cum e vremea în București?', 'ro');
    return r.needsWeather === true && r.weatherCity.length > 0;
});
test('Extracts city from "meteo la Cluj"', () => {
    const r = brain.analyzeIntent('meteo la Cluj', 'ro');
    return r.needsWeather === true && r.weatherCity === 'Cluj';
});
test('Default city when none specified: "e frig afară?"', () => {
    const r = brain.analyzeIntent('e frig afară?', 'ro');
    return r.needsWeather === true && r.weatherCity === 'Bucharest';
});

// Image
test('Detects "generează o imagine cu o pisică"', () => {
    const r = brain.analyzeIntent('generează o imagine cu o pisică', 'ro');
    return r.needsImage === true;
});
test('Does NOT trigger image on "imaginea de pe ecran"', () => {
    const r = brain.analyzeIntent('imaginea de pe ecran arată bine', 'ro');
    // This should NOT trigger image generation — "arată" is not "generate"
    return r.needsImage === false;
});

// Map
test('Detects "arată-mi harta către Sibiu"', () => {
    const r = brain.analyzeIntent('arată-mi harta către Sibiu', 'ro');
    return r.needsMap === true;
});
test('Detects "unde este Turnul Eiffel?"', () => {
    const r = brain.analyzeIntent('unde este Turnul Eiffel?', 'ro');
    return r.needsMap === true;
});

// Vision
test('Detects "ce e în fața mea?"', () => {
    const r = brain.analyzeIntent('ce e în fața mea?', 'ro');
    return r.needsVision === true;
});

// Memory
test('Detects "îți amintești ce am zis?"', () => {
    const r = brain.analyzeIntent('îți amintești ce am zis?', 'ro');
    return r.needsMemory === true;
});

// Emotion
test('Detects sadness: "sunt foarte trist"', () => {
    const r = brain.analyzeIntent('sunt foarte trist azi', 'ro');
    return r.isEmotional === true && r.emotionalTone === 'sad';
});
test('Detects anger: "sunt furios pe situație"', () => {
    const r = brain.analyzeIntent('sunt furios pe situație', 'ro');
    return r.isEmotional === true && r.emotionalTone === 'angry';
});
test('Detects anxiety: "mi-e frică de examen"', () => {
    const r = brain.analyzeIntent('mi-e frică de examen', 'ro');
    return r.isEmotional === true && r.emotionalTone === 'anxious';
});
test('Detects gratitude: "mulțumesc mult!"', () => {
    const r = brain.analyzeIntent('mulțumesc mult!', 'ro');
    return r.isEmotional === true && r.emotionalTone === 'grateful';
});

// Emergency
test('Detects emergency: "ajutor! pericol!"', () => {
    const r = brain.analyzeIntent('ajutor! pericol!', 'ro');
    return r.isEmergency === true;
});
test('Detects emergency: "sună la 112"', () => {
    const r = brain.analyzeIntent('sună la 112', 'ro');
    return r.isEmergency === true;
});

// Greeting
test('Detects greeting: "salut"', () => {
    const r = brain.analyzeIntent('salut', 'ro');
    return r.isGreeting === true;
});
test('Does NOT mark long message as greeting', () => {
    const r = brain.analyzeIntent('salut, cum e vremea azi și ce restaurante sunt în zonă?', 'ro');
    return r.isGreeting === false;
});

// Complexity
test('Simple: "salut" → simple', () => brain.analyzeIntent('salut', 'ro').complexity === 'simple');
test('Moderate: "caută hoteluri" → moderate', () => brain.analyzeIntent('caută hoteluri bune în Paris', 'ro').complexity === 'moderate');
test('Complex: multi-tool request → complex', () => {
    const r = brain.analyzeIntent('caută hoteluri în Paris și arată-mi vremea și generează o imagine cu Turnul Eiffel', 'ro');
    return r.complexity === 'complex';
});

// English
console.log('\n\x1b[1m─── 3. INTENT ANALYSIS (EN) ───\x1b[0m');
test('EN search: "what is quantum computing?"', () => brain.analyzeIntent('what is quantum computing?', 'en').needsSearch === true);
test('EN weather: "weather forecast for London"', () => brain.analyzeIntent('weather forecast for London', 'en').needsWeather === true);
test('EN image: "generate a picture of a sunset"', () => brain.analyzeIntent('generate a picture of a sunset', 'en').needsImage === true);

// Topic extraction
console.log('\n\x1b[1m─── 4. TOPIC EXTRACTION ───\x1b[0m');
test('Detects tech topic', () => brain.analyzeIntent('cum fac o aplicație în React?', 'ro').topics.includes('tech'));
test('Detects food topic', () => brain.analyzeIntent('dă-mi o rețetă de pizza', 'ro').topics.includes('food'));
test('Detects travel topic', () => brain.analyzeIntent('vreau să călătoresc în Italia', 'ro').topics.includes('travel'));

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 5: FALSE POSITIVES — Things that should NOT trigger
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 5. FALSE POSITIVE TESTS ───\x1b[0m');
test('Simple chat should not trigger search', () => {
    const r = brain.analyzeIntent('bună ziua, ce mai faci?', 'ro');
    return r.needsSearch === false;
});
test('"Mulțumesc" should not trigger search', () => {
    const r = brain.analyzeIntent('mulțumesc frumos!', 'ro');
    return r.needsSearch === false;
});
test('"OK" should not trigger anything', () => {
    const r = brain.analyzeIntent('ok', 'ro');
    return r.needsSearch === false && r.needsWeather === false && r.needsImage === false;
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 6: TASK DECOMPOSITION
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 6. TASK DECOMPOSITION ───\x1b[0m');

async function testDecomposition() {
    const analysis = brain.analyzeIntent('caută hoteluri și arată meteo', 'ro');
    analysis.complexity = 'complex';
    const tasks = await brain.decomposeTask('caută hoteluri și arată meteo', analysis, 'ro');
    return tasks.length >= 2;
}
await testAsync('Decomposes "X și Y" into 2+ subtasks', testDecomposition);

async function testSingleTask() {
    const analysis = brain.analyzeIntent('salut', 'ro');
    const tasks = await brain.decomposeTask('salut', analysis, 'ro');
    return tasks.length === 1;
}
await testAsync('Single simple task stays as 1', testSingleTask);

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 7: PLAN BUILDER
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 7. PLAN BUILDER ───\x1b[0m');

test('Builds plan with correct tools', () => {
    const analysis = brain.analyzeIntent('caută hoteluri și cum e vremea?', 'ro');
    const plan = brain.buildPlan([{ message: 'test', analysis }], 'user123');
    const tools = plan.map(p => p.tool);
    return tools.includes('search') && tools.includes('weather');
});

test('Skips degraded tools', () => {
    brain.toolErrors.search = 10; // Artificially degrade
    const analysis = brain.analyzeIntent('caută ceva', 'ro');
    const plan = brain.buildPlan([{ message: 'test', analysis }], null);
    const hasSearch = plan.some(p => p.tool === 'search');
    brain.toolErrors.search = 0; // Reset
    return hasSearch === false;
});

test('Adds memory tool when userId present', () => {
    const analysis = brain.analyzeIntent('îți amintești?', 'ro');
    const plan = brain.buildPlan([{ message: 'test', analysis }], 'user123');
    return plan.some(p => p.tool === 'memory');
});

test('Does NOT add memory without userId', () => {
    const analysis = brain.analyzeIntent('îți amintești?', 'ro');
    const plan = brain.buildPlan([{ message: 'test', analysis }], null);
    return !plan.some(p => p.tool === 'memory');
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 8: TOOL EXECUTION (with failures — no real APIs)
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 8. TOOL EXECUTION (graceful failures) ───\x1b[0m');

await testAsync('Search falls back to DuckDuckGo without API keys', async () => {
    // With no API keys, _search falls through all tiers to DuckDuckGo
    // DuckDuckGo may return empty results but shouldn't crash
    try { const r = await brain._search('test'); return typeof r === 'string'; }
    catch (e) { return e.message === 'All search engines failed'; }
});

await testAsync('Imagine fails gracefully without API key', async () => {
    try { await brain._imagine('test'); return false; }
    catch (e) { return e.message === 'No key'; }
});

await testAsync('Memory returns null without supabase', async () => {
    const r = await brain._memory('user123');
    return r === null;
});

test('Map returns URL without external call', () => {
    const r = brain._map('Paris');
    return r && r.url && r.url.includes('Paris') && r.place === 'Paris';
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 9: CONVERSATION SUMMARIZER
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 9. CONVERSATION SUMMARIZER ───\x1b[0m');

test('Short history passes through unchanged', () => {
    const history = Array(10).fill(null).map((_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` }));
    const result = brain.compressHistory(history, 'conv1');
    return result.length === 10;
});

test('Long history gets compressed', () => {
    const history = Array(30).fill(null).map((_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Mesaj important despre subiect ${i}?` }));
    const result = brain.compressHistory(history, 'conv2');
    // Should have: 1 summary + last 10 = 11
    return result.length === 11 && result[0].role === 'system' && result[0].content.includes('REZUMAT');
});

test('Compression caches results', () => {
    return brain.conversationSummaries.has('conv2');
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 10: SELF-REPAIR & MONITORING
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 10. SELF-REPAIR ───\x1b[0m');

test('recordError increments counter', () => {
    brain.recordError('search', 'test error');
    return brain.toolErrors.search === 1;
});

test('recordSuccess decrements error counter', () => {
    brain.recordSuccess('search', 100);
    return brain.toolErrors.search === 0;
});

test('Tool degrades at 5+ errors', () => {
    for (let i = 0; i < 6; i++) brain.recordError('vision', 'test');
    return brain.isToolDegraded('vision') === true;
});

test('resetTool clears errors', () => {
    brain.resetTool('vision');
    return brain.isToolDegraded('vision') === false;
});

test('Auto-recovery strategy runs', () => {
    brain.attemptRecovery('search', { query: 'a'.repeat(60) }, '400 Bad Request');
    return brain.strategies.searchRefinement.length > 0;
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 11: SEARCH QUERY REFINEMENT
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 11. SEARCH REFINEMENT ───\x1b[0m');

test('Removes filler words from queries', () => {
    const r = brain.refineSearchQuery('te rog spune-mi despre quantum computing');
    return !r.includes('te rog') && r.includes('quantum');
});

test('Truncates very long queries', () => {
    const longQ = 'tell me everything you know about the history of artificial intelligence from the very beginning until now including all major milestones';
    const r = brain.refineSearchQuery(longQ);
    return r.split(' ').length <= 8;
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 12: DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 12. DIAGNOSTICS ───\x1b[0m');

test('getDiagnostics returns complete report', () => {
    const d = brain.getDiagnostics();
    return d.status && d.version === '2.0' && d.toolStats && d.toolErrors && d.memory && d.strategies && Array.isArray(d.journal);
});

test('Diagnostics tracks memory usage', () => {
    const d = brain.getDiagnostics();
    return d.memory.rss.includes('MB') && d.memory.heap.includes('MB');
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 13: PERSONA ENGINE
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 13. PERSONA ENGINE ───\x1b[0m');

test('Kelion prompt builds correctly', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, null);
    return p.includes('Kelion') && p.includes('română') && p.includes('FRAMEWORK');
});

test('Kira prompt builds correctly', () => {
    const p = buildSystemPrompt('kira', 'ro', '', null, null);
    return p.includes('Kira') && p.includes('empatică');
});

test('Prompt includes memory when provided', () => {
    const p = buildSystemPrompt('kelion', 'ro', 'nume: Adrian; loc: Londra', null, null);
    return p.includes('Adrian') && p.includes('Londra');
});

test('Prompt includes failed tools warning', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', { failedTools: ['search', 'weather'] }, null);
    return p.includes('search') && p.includes('indisponibile');
});

test('Prompt includes CoT guidance', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, { tone: 'empatic si calm' });
    return p.includes('empatic si calm');
});

test('Prompt includes emotional intelligence section', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, null);
    return p.includes('TRISTEȚE') && p.includes('FURIE') && p.includes('ANXIETATE');
});

test('Prompt includes accessibility mode', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, null);
    return p.includes('OCHII') && p.includes('ATENȚIE');
});

test('Prompt includes self-repair section', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, null);
    return p.includes('AUTO-REPARARE');
});

test('Prompt handles all 6 languages', () => {
    const langs = { ro: 'română', en: 'English', es: 'español', fr: 'français', de: 'Deutsch', it: 'italiano' };
    return Object.entries(langs).every(([code, name]) => buildSystemPrompt('kelion', code, '', null, null).includes(name));
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 14: FULL THINK PIPELINE (integration)
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 14. FULL THINK PIPELINE ───\x1b[0m');

await testAsync('think() runs end-to-end for simple message', async () => {
    const result = await brain.think('salut', 'kelion', [], 'ro', null, null);
    return result && result.enrichedMessage && result.analysis && Array.isArray(result.toolsUsed);
});

await testAsync('think() runs for complex message', async () => {
    const result = await brain.think('caută hoteluri în Paris și cum e vremea acolo?', 'kira', [], 'ro', null, null);
    return result && result.analysis.complexity !== 'simple' && result.thinkTime > 0;
});

await testAsync('think() includes monitor for map request', async () => {
    const result = await brain.think('arată-mi harta către Sibiu', 'kelion', [], 'ro', null, null);
    return result.monitor && result.monitor.type === 'map' && result.monitor.content.includes('Sibiu');
});

await testAsync('think() increments conversation counter', async () => {
    const before = brain.conversationCount;
    await brain.think('test', 'kelion', [], 'ro', null, null);
    return brain.conversationCount === before + 1;
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 15: EDGE CASES & ROBUSTNESS
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 15. EDGE CASES ───\x1b[0m');

test('Handles empty string', () => {
    const r = brain.analyzeIntent('', 'ro');
    return r && r.complexity === 'simple' && r.needsSearch === false;
});

test('Handles very long input (1000+ chars)', () => {
    const r = brain.analyzeIntent('a'.repeat(1500), 'ro');
    return r && typeof r.complexity === 'string';
});

test('Handles unicode/emoji', () => {
    const r = brain.analyzeIntent('salut 🤖 cum e vremea? ☀️', 'ro');
    return r.needsWeather === true;
});

test('Handles mixed RO/EN', () => {
    const r = brain.analyzeIntent('search for restaurants în București', 'ro');
    return r.needsSearch === true;
});

test('Handles null language gracefully', () => {
    const r = brain.analyzeIntent('salut', null);
    return r && r.language !== undefined;
});

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 16: CHAIN-OF-THOUGHT (without real API)
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 16. CHAIN-OF-THOUGHT ───\x1b[0m');

await testAsync('CoT fails gracefully without real API', async () => {
    const r = await brain.chainOfThought('test question', {}, { emotionalTone: 'neutral', isEmergency: false }, [], 'ro');
    // Should return null (API call will fail with test key) — not crash
    return r === null;
});

test('CoT stat increments', () => brain.toolStats.chainOfThought > 0);

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 17: AUTO-DEPLOY CHECK
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 17. AUTO-DEPLOY VERIFICATION ───\x1b[0m');

const fs = require('fs');
const pkg = require('./package.json');

test('package.json has start script', () => !!pkg.scripts?.start);
test('Start script runs server/index.js', () => pkg.scripts.start.includes('server/index.js') || pkg.scripts.start.includes('node server'));
test('brain.js is importable from index.js', () => {
    const idx = fs.readFileSync('./server/index.js', 'utf8');
    return idx.includes("require('./brain')");
});
test('persona.js is importable from index.js', () => {
    const idx = fs.readFileSync('./server/index.js', 'utf8');
    return idx.includes("require('./persona')");
});
test('migrate.js is importable from index.js', () => {
    const idx = fs.readFileSync('./server/index.js', 'utf8');
    return idx.includes("require('./migrate')");
});
test('All dependencies in package.json', () => {
    const deps = pkg.dependencies || {};
    return !!deps['express'] && !!deps['node-fetch'] && !!deps['cors'];
});

// Check if git is clean (deployed)
const { execSync } = require('child_process');
try {
    const status = execSync('git status --porcelain', { cwd: __dirname }).toString().trim();
    test('Git is clean (all committed)', () => {
        if (status === '') return true;
        console.log(`   Uncommitted: ${status.split('\n').length} files`);
        return 'warn';
    });
} catch(e) {
    test('Git check', () => { console.log('   Cannot check git'); return 'warn'; });
}

try {
    const remote = execSync('git remote get-url origin', { cwd: __dirname }).toString().trim();
    test('Git remote is GitHub', () => remote.includes('github.com/adrianenc11-hue/kelionai-v2'));
} catch(e) {
    test('Git remote check', () => 'warn');
}

// ═══════════════════════════════════════════════════════════════
// TEST GROUP 18: CRITICAL BUG DETECTION
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m─── 18. CRITICAL BUG SCAN ───\x1b[0m');

const indexSrc = fs.readFileSync('./server/index.js', 'utf8');
const brainSrc = fs.readFileSync('./server/brain.js', 'utf8');
const personaSrc = fs.readFileSync('./server/persona.js', 'utf8');

test('No unhandled promise rejections in chat endpoint', () => {
    // Chat endpoint should have try/catch
    return indexSrc.includes("} catch(e) { console.error('[CHAT]'");
});

test('Brain think() has try/catch in tool execution', () => {
    return brainSrc.includes('Promise.allSettled') && brainSrc.includes('status === \'fulfilled\'');
});

test('Persona handles null memory', () => {
    const p = buildSystemPrompt('kelion', 'ro', null, null, null);
    return typeof p === 'string' && p.length > 100;
});

test('Persona handles empty string memory', () => {
    const p = buildSystemPrompt('kelion', 'ro', '', null, null);
    return typeof p === 'string' && !p.includes('undefined');
});

test('No console.log in production persona', () => {
    return !personaSrc.includes('console.log');
});

test('Brain has timeout on all tools', () => {
    return brainSrc.includes('Timeout') && brainSrc.includes('Promise.race');
});

test('Dashboard route before wildcard', () => {
    const dashIdx = indexSrc.indexOf('/dashboard');
    const wildIdx = indexSrc.indexOf("app.get('*'");
    return dashIdx < wildIdx;
});

// Check for potential memory leaks
test('Error log is bounded', () => brainSrc.includes('slice(-100)'));
test('Journal is bounded', () => brainSrc.includes('slice(-250)'));
test('Latency array is bounded', () => brainSrc.includes('slice(-25)'));
test('Summary cache is bounded', () => brainSrc.includes('conversationSummaries.size > 100'));

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m══════════════════════════════════════════\x1b[0m');
console.log('\x1b[1m  RESULTS\x1b[0m');
console.log('\x1b[1m══════════════════════════════════════════\x1b[0m');
console.log(`  ${PASS}  Passed: ${passed}`);
console.log(`  ${FAIL}  Failed: ${failed}`);
console.log(`  ${WARN}  Warnings: ${warnings}`);
console.log(`  Total: ${passed + failed + warnings}`);
console.log(`  Score: ${Math.round(passed / (passed + failed) * 100)}%`);

if (issues.length > 0) {
    console.log('\n\x1b[31mISSUES:\x1b[0m');
    issues.forEach(i => console.log(`  → ${i}`));
}

console.log('\n\x1b[1m══════════════════════════════════════════\x1b[0m\n');
process.exit(failed > 0 ? 1 : 0);

})().catch(e => { console.error('Test runner crashed:', e); process.exit(2); });
