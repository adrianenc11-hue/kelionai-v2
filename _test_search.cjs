// Real integration test for web_search tool
// This tests the ACTUAL production code with REAL HTTP requests
const { toolWebSearch } = require('./server/src/services/realTools');

const TESTS = [
  { q: 'best phone 2026', expect: 'results with URLs' },
  { q: 'weather Madrid today', expect: 'weather info' },
  { q: 'OpenAI GPT-5', expect: 'AI news' },
  { q: 'restaurant Barcelona', expect: 'restaurants' },
  { q: 'exchange rate EUR to RON', expect: 'currency' },
  { q: 'JavaScript async await tutorial', expect: 'programming' },
  { q: 'who is the president of Romania 2026', expect: 'politics' },
  { q: 'flight Bucharest to London', expect: 'flights' },
  { q: 'cel mai bun telefon 2026', expect: 'Romanian query works' },
  { q: 'Wetter Berlin heute', expect: 'German query works' },
];

(async () => {
  let passed = 0;
  let failed = 0;
  
  for (const t of TESTS) {
    try {
      const result = await toolWebSearch({ query: t.q, num_results: 3 });
      if (result.ok && result.results && result.results.length > 0) {
        passed++;
        console.log(`✅ PASS: "${t.q}" → ${result.results.length} results (source: ${result.source})`);
        console.log(`   1st: ${result.results[0].title.slice(0, 60)}`);
      } else {
        failed++;
        console.log(`❌ FAIL: "${t.q}" → ${JSON.stringify(result).slice(0, 200)}`);
      }
    } catch (err) {
      failed++;
      console.log(`❌ ERROR: "${t.q}" → ${err.message}`);
    }
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${passed}/${TESTS.length} passed, ${failed} failed`);
  console.log(`SCORE: ${passed * 10}/${TESTS.length * 10}`);
  process.exit(failed > 0 ? 1 : 0);
})();
