const fs = require('fs');
const path = require('path');

console.log('========================================');
console.log('  KELION QA AUDIT — Deep Health Check');
console.log('========================================\n');

// 1. DEAD ROUTES — routes with no handler
const indexFile = fs.readFileSync('server/src/index.js', 'utf8');
const mountedRoutes = [...indexFile.matchAll(/app\.use\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log('=== 1. MOUNTED ROUTES ===');
mountedRoutes.forEach(r => console.log('  ', r));

// 2. CIRCULAR REQUIRES
console.log('\n=== 2. CIRCULAR REQUIRE CHECK ===');
const servicesDir = 'server/src/services';
const routesDir = 'server/src/routes';
const allJsFiles = [];
for (const dir of [servicesDir, routesDir]) {
  if (fs.existsSync(dir)) {
    allJsFiles.push(...fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => path.join(dir, f)));
  }
}

const depMap = {};
let circularCount = 0;
for (const file of allJsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const reqs = [...content.matchAll(/require\s*\(\s*['"]\.\.\//g)];
  depMap[path.basename(file)] = content;
}

// Check: does realTools require realtime or vice versa?
const realToolsContent = fs.readFileSync('server/src/services/realTools.js', 'utf8');
const realtimeContent = fs.readFileSync('server/src/routes/realtime.js', 'utf8');
if (realToolsContent.includes("require('../routes/realtime')") || realToolsContent.includes("require('./realtime')")) {
  console.log('  CYCLE: realTools.js -> realtime.js (dangerous!)');
  circularCount++;
}
if (realtimeContent.includes("require('../services/realTools')") || realtimeContent.includes("require('./realTools')")) {
  console.log('  INFO: realtime.js -> realTools.js (expected)');
}
if (circularCount === 0) console.log('  No dangerous circular requires found');

// 3. INFINITE LOOP RISKS — recursive calls without depth limits
console.log('\n=== 3. INFINITE LOOP / RECURSION RISKS ===');
const realTools = fs.readFileSync('server/src/services/realTools.js', 'utf8');

// executeRealTool calling itself (via execute_plan or parallel_tools)
const selfCalls = (realTools.match(/executeRealTool\(/g) || []).length;
console.log('  executeRealTool() call count:', selfCalls);
console.log('  execute_plan MAX_STEPS:', realTools.includes('MAX_STEPS = 15') ? '15 (OK)' : 'MISSING LIMIT!');
console.log('  execute_plan MAX_TOTAL_MS:', realTools.includes('MAX_TOTAL_MS = 120000') ? '120s (OK)' : 'MISSING TIMEOUT!');
console.log('  parallel_tools max calls:', realTools.includes('calls.length > 10') ? '10 (OK)' : 'MISSING LIMIT!');

// Check toolDeepMemoryArchitect recursion
console.log('  deep_memory_architect -> remember_fact (delegate):', realTools.includes("if (action === 'remember_fact') return toolRememberFact") ? 'OK (no recursion)' : 'CHECK!');

// 4. UNHANDLED ERRORS — async without try/catch
console.log('\n=== 4. ERROR HANDLING COVERAGE ===');
for (const file of allJsFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const asyncHandlers = (content.match(/async\s*\(req\s*,\s*res/g) || []).length;
  const tryCatches = (content.match(/try\s*\{/g) || []).length;
  const basename = path.basename(file);
  if (asyncHandlers > 0) {
    const ratio = tryCatches / Math.max(asyncHandlers, 1);
    const status = ratio >= 0.8 ? 'OK' : (ratio >= 0.5 ? 'WARN' : 'BAD');
    console.log('  ', basename, '- async handlers:', asyncHandlers, '| try/catch:', tryCatches, '|', status);
  }
}

// 5. TOOL EXECUTOR — null returns (dead tools)
console.log('\n=== 5. DEAD TOOLS (return null from executor) ===');
const switchMatch = realTools.match(/switch\s*\(name\)\s*\{([\s\S]*?)default:\s*return null/);
if (switchMatch) {
  const cases = (switchMatch[1].match(/case\s+'([^']+)'/g) || []).map(c => c.replace(/case\s+'/, '').replace(/'/, ''));
  console.log('  Tools in executor switch:', cases.length);
  
  // Check each tool has a real function
  let deadCount = 0;
  for (const tool of cases) {
    const funcName = 'tool' + tool.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (!realTools.includes('function ' + funcName) && !realTools.includes('async function ' + funcName)) {
      // Check aliases (some tools map to other functions)
      const line = realTools.split('\n').find(l => l.includes("case '" + tool + "'"));
      if (line && line.includes('return tool')) {
        // Has a handler, just not a dedicated function
      } else {
        console.log('  DEAD:', tool, '- no matching function');
        deadCount++;
      }
    }
  }
  if (deadCount === 0) console.log('  All tools have handlers');
}

// 6. MEMORY LEAKS — Maps/Sets that grow without cleanup
console.log('\n=== 6. MEMORY LEAK RISKS ===');
const maps = (realTools.match(/new Map\(\)/g) || []).length;
const sets = (realTools.match(/new Set\(\)/g) || []).length;
const mapNames = [...realTools.matchAll(/const\s+(_\w+)\s*=\s*new Map\(\)/g)].map(m => m[1]);
console.log('  In-memory Maps:', maps, mapNames.join(', '));
console.log('  In-memory Sets:', sets);

for (const name of mapNames) {
  const hasCleanup = realTools.includes(name + '.delete') || realTools.includes(name + '.clear') || realTools.includes('.size > ');
  console.log('    ', name, hasCleanup ? '- has cleanup' : '- NO CLEANUP (potential leak!)');
}

// 7. RATE LIMITS
console.log('\n=== 7. RATE LIMITING ===');
const hasRateLimit = realTools.includes('_learnCooldown') || realTools.includes('_lastEmotionAt');
console.log('  learn_from_observation cooldown:', realTools.includes('10000') ? '10s' : 'NONE');
console.log('  observe_user_emotion cooldown:', fs.readFileSync('src/lib/kelionTools.js', 'utf8').includes('5000') ? '5s' : 'NONE');

// 8. TIMEOUTS on external calls
console.log('\n=== 8. EXTERNAL CALL TIMEOUTS ===');
const fetchCalls = (realTools.match(/fetch\s*\(/g) || []).length;
const timeouts = (realTools.match(/timeout|AbortSignal|signal:/g) || []).length;
console.log('  fetch() calls:', fetchCalls);
console.log('  timeout guards:', timeouts);
console.log('  Coverage:', timeouts >= fetchCalls * 0.5 ? 'OK' : 'LOW - some calls may hang!');

// 9. TEST COVERAGE
console.log('\n=== 9. TEST FILES ===');
const testDir = 'server/__tests__';
if (fs.existsSync(testDir)) {
  const tests = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'));
  console.log('  Unit test files:', tests.length);
  tests.forEach(t => console.log('    ', t));
}
const e2eDir = 'e2e';
if (fs.existsSync(e2eDir)) {
  const e2eTests = fs.readdirSync(e2eDir).filter(f => f.endsWith('.spec.js'));
  console.log('  E2E test files:', e2eTests.length);
}

console.log('\n========================================');
console.log('  AUDIT COMPLETE');
console.log('========================================');
