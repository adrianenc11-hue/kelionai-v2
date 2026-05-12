// Benchmark REAL — măsoară timpii de execuție KelionAI cu CSRF bypass
const http = require('http');
const BASE = 'http://localhost:3001';
const CSRF = 'benchmark_token_000';

function req(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method, hostname: 'localhost', port: 3001,
      path,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `kelion.csrf=${CSRF}`,
        'x-csrf-token': CSRF,
      },
      timeout: 30000,
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const t0 = performance.now();
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const ms = (performance.now() - t0).toFixed(1);
        resolve({ method, path, status: res.statusCode, ms, bytes: d.length, body: d });
      });
    });
    r.on('error', e => resolve({ method, path, status: 'ERR', ms: (performance.now()-t0).toFixed(1), error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ method, path, status: 'TIMEOUT', ms: '30000' }); });
    if (payload) r.write(payload);
    r.end();
  });
}

async function main() {
  console.log('=== KelionAI Real Benchmark ===\n');
  console.log('ENDPOINT'.padEnd(55) + 'STATUS'.padEnd(8) + 'TIME'.padStart(12) + '  BYTES');
  console.log('-'.repeat(85));

  const tests = [
    ['GET',  '/api/tools/status',                                     null,                                                    'Tools status'],
    ['GET',  '/api/trial/status',                                     null,                                                    'Trial status'],
    ['POST', '/api/tools/execute', { name: 'calculate', args: { expression: '2+2' } },                                         'calculate(2+2)'],
    ['POST', '/api/tools/execute', { name: 'unit_convert', args: { value: 100, from: 'km', to: 'miles' } },                     'unit_convert(km→mi)'],
    ['POST', '/api/tools/execute', { name: 'get_moon_phase', args: {} },                                                        'get_moon_phase'],
    ['POST', '/api/tools/execute', { name: 'get_sun_times', args: { lat: 44.43, lon: 26.1 } },                                  'get_sun_times(Buc)'],
    ['POST', '/api/tools/execute', { name: 'get_timezone', args: { lat: 44.43, lon: 26.1 } },                                   'get_timezone(Buc)'],
    ['POST', '/api/tools/execute', { name: 'get_weather', args: { location: 'Bucharest' } },                                    'get_weather(Buc)'],
    ['POST', '/api/tools/execute', { name: 'get_forecast', args: { location: 'Bucharest' } },                                   'get_forecast(Buc)'],
    ['POST', '/api/tools/execute', { name: 'geocode', args: { query: 'Bucharest' } },                                           'geocode(Buc)'],
    ['POST', '/api/tools/execute', { name: 'get_crypto_price', args: { ids: 'bitcoin', vs: 'usd' } },                           'get_crypto_price(BTC)'],
    ['POST', '/api/tools/execute', { name: 'get_stock_price', args: { symbol: 'AAPL' } },                                       'get_stock_price(AAPL)'],
    ['POST', '/api/tools/execute', { name: 'currency_convert', args: { from: 'EUR', to: 'RON', amount: 1 } },                   'currency_convert(EUR→RON)'],
    ['POST', '/api/tools/execute', { name: 'web_search', args: { query: 'KelionAI' } },                                         'web_search(KelionAI)'],
    ['POST', '/api/tools/execute', { name: 'wikipedia_search', args: { query: 'Romania' } },                                    'wikipedia_search(Romania)'],
    ['POST', '/api/tools/execute', { name: 'dictionary', args: { word: 'hello', lang: 'en' } },                                 'dictionary(hello)'],
    ['POST', '/api/tools/execute', { name: 'translate', args: { text: 'Hello world', from: 'en', to: 'ro' } },                  'translate(en→ro)'],
    ['POST', '/api/tools/execute', { name: 'run_terminal_command', args: { command: 'echo benchmark_test' } },                   'terminal(echo)'],
    ['POST', '/api/tools/execute', { name: 'list_local_files', args: { dir: '.' } },                                            'list_local_files(.)'],
    ['POST', '/api/tools/execute', { name: 'read_local_file', args: { path: 'package.json' } },                                 'read_local_file(pkg)'],
    ['POST', '/api/tools/execute', { name: 'search_codebase', args: { query: 'handleShowOnMonitor' } },                          'search_codebase'],
    ['POST', '/api/tools/execute', { name: 'run_regex', args: { pattern: '\\d+', text: 'abc123def456' } },                       'run_regex'],
    ['POST', '/api/tools/execute', { name: 'get_news', args: { query: 'Romania' } },                                            'get_news(Romania)'],
  ];

  for (const [method, path, body, label] of tests) {
    const r = await req(method, path, body);
    const tag = (label || path).padEnd(55);
    const st = String(r.status).padEnd(8);
    const tm = (r.ms + 'ms').padStart(12);
    const by = String(r.bytes || 0).padStart(7);
    console.log(`${tag}${st}${tm}${by}`);
  }
}

main().catch(console.error);
