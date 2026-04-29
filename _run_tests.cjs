// KelionAI — Test Runner cu CSRF
const BASE = 'https://kelionai.app';
const results = [];
let pass = 0, fail = 0;
let CSRF = '';
let COOKIES = '';

function log(faza, test, ok, detail) {
  const icon = ok ? '✅' : '❌';
  results.push({ faza, test, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`${icon} [${faza}] ${test}: ${detail}`);
}

async function getCSRF() {
  const r = await fetch(`${BASE}/ping`);
  const sc = r.headers.get('set-cookie') || '';
  const m = sc.match(/kelion\.csrf=([^;]+)/);
  if (m) {
    CSRF = m[1];
    COOKIES = `kelion.csrf=${CSRF}`;
    console.log(`🔑 CSRF token: ${CSRF.slice(0,16)}...`);
  } else {
    console.log('⚠️  No CSRF cookie received, trying raw...');
  }
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: COOKIES } });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json, ok: r.ok };
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF,
      'Cookie': COOKIES,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json, ok: r.ok };
}

async function tool(name, args) {
  return post('/api/tools/execute', { name, args });
}

async function run() {
  console.log('\n═══════════════════════════════════════════');
  console.log('  KelionAI — TESTARE EXHAUSTIVĂ LIVE');
  console.log('═══════════════════════════════════════════\n');

  await getCSRF();

  // ═══ F1: HEALTH ═══
  console.log('\n── F1: HEALTH ──');
  const h = await get('/health');
  log('F1', '/health', h.ok && h.json?.status === 'ok', `db=${h.json?.services?.database}, gemini=${h.json?.services?.gemini}`);
  const p = await get('/ping');
  log('F1', '/ping', p.text.includes('PONG'), 'PONG');
  const ts = await get('/api/tools/status');
  log('F1', 'tools/status', ts.ok, JSON.stringify(ts.json).slice(0,100));
  const pl = await get('/api/subscription/plans');
  log('F1', 'plans', pl.json?.plans?.length === 4, `${pl.json?.plans?.length} plans`);
  const tr = await get('/api/trial/status');
  log('F1', 'trial', tr.ok, `allowed=${tr.json?.allowed}`);

  // ═══ F2.5: VOICE STYLE ═══
  console.log('\n── F2.5: CORE ROUTES ──');
  const vs = await post('/api/realtime/voice-style', { style: 'calm' });
  log('F2.5', 'voice-style', vs.json?.ok, `style=${vs.json?.style}`);

  // ═══ F3: OFFLINE TOOLS ═══
  console.log('\n── F3: OFFLINE ──');
  const c1 = await tool('calculate', { expression: '127 * 38' });
  log('F3', 'calc 127*38', c1.json?.result === 4826 || (c1.json?.ok && c1.json?.result == 4826), `=${c1.json?.result}`);
  const c2 = await tool('calculate', { expression: 'sqrt(144) + log(100, 10)' });
  log('F3', 'calc sqrt+log', c2.json?.result !== undefined, `=${c2.json?.result}`);
  const c3 = await tool('calculate', { expression: ')))bad' });
  log('F3', 'calc invalid', c3.json?.error || c3.json?.ok === false, 'error ok');
  const cv1 = await tool('unit_convert', { value: 100, from: 'degF', to: 'degC' });
  log('F3', 'convert F→C', cv1.json?.ok || cv1.json?.result !== undefined, `=${cv1.json?.result}`);
  const cv2 = await tool('unit_convert', { value: 10, from: 'km', to: 'mi' });
  log('F3', 'convert km→mi', cv2.json?.ok || cv2.json?.result !== undefined, `=${cv2.json?.result}`);
  const mn = await tool('get_moon_phase', {});
  log('F3', 'moon_phase', mn.json?.ok || mn.json?.phase, `${mn.json?.phase || mn.json?.phaseName || ''}`);
  const rx = await tool('run_regex', { pattern: '\\d+', input: 'abc123def456', flags: 'g' });
  log('F3', 'run_regex', rx.json?.ok || rx.json?.matches, `${JSON.stringify(rx.json?.matches||'').slice(0,60)}`);

  // ═══ F4: METEO ═══
  console.log('\n── F4: METEO ──');
  const w1 = await tool('get_weather', { city: 'Cluj-Napoca' });
  log('F4', 'weather Cluj', w1.json?.ok, JSON.stringify(w1.json).slice(0,120));
  const w2 = await tool('get_weather', { lat: 48.8566, lon: 2.3522 });
  log('F4', 'weather Paris', w2.json?.ok, JSON.stringify(w2.json).slice(0,100));
  const fc = await tool('get_forecast', { city: 'București', days: 3 });
  log('F4', 'forecast Buc', fc.json?.ok, JSON.stringify(fc.json).slice(0,120));
  const aq = await tool('get_air_quality', { city: 'London' });
  log('F4', 'air London', aq.json?.ok !== undefined, JSON.stringify(aq.json).slice(0,120));
  const sn = await tool('get_sun_times', { city: 'Tokyo' });
  log('F4', 'sun Tokyo', sn.json?.ok, JSON.stringify(sn.json).slice(0,100));
  const eq = await tool('get_earthquakes', { min_magnitude: 4.0 });
  log('F4', 'earthquakes', eq.json?.ok, JSON.stringify(eq.json).slice(0,120));

  // ═══ F5: FINANCE ═══
  console.log('\n── F5: FINANCE ──');
  const bt = await tool('get_crypto_price', { ids: 'bitcoin,ethereum' });
  log('F5', 'crypto BTC', bt.json?.ok, JSON.stringify(bt.json).slice(0,150));
  const st = await tool('get_stock_price', { symbol: 'AAPL' });
  log('F5', 'stock AAPL', st.json?.ok, JSON.stringify(st.json).slice(0,120));
  const fx = await tool('get_forex', { from: 'EUR', to: 'RON' });
  log('F5', 'forex EUR→RON', fx.json?.ok, JSON.stringify(fx.json).slice(0,100));
  const cu = await tool('currency_convert', { from: 'EUR', to: 'USD', amount: 100 });
  log('F5', 'convert 100EUR', cu.json?.ok, JSON.stringify(cu.json).slice(0,100));

  // ═══ F6: GEO ═══
  console.log('\n── F6: GEO ──');
  const ge = await tool('geocode', { query: 'Eiffel Tower' });
  log('F6', 'geocode Eiffel', ge.json?.ok, JSON.stringify(ge.json).slice(0,120));
  const rv = await tool('reverse_geocode', { lat: 46.77, lon: 23.59 });
  log('F6', 'reverse Cluj', rv.json?.ok, JSON.stringify(rv.json).slice(0,120));
  const rt = await tool('get_route', { from: 'Cluj-Napoca', to: 'București' });
  log('F6', 'route CJ→B', rt.json?.ok, JSON.stringify(rt.json).slice(0,120));
  const el = await tool('get_elevation', { lat: 45.35, lon: 25.55 });
  log('F6', 'elevation', el.json?.ok, JSON.stringify(el.json).slice(0,100));
  const tz = await tool('get_timezone', { city: 'Tokyo' });
  log('F6', 'timezone', tz.json?.ok, JSON.stringify(tz.json).slice(0,100));

  // ═══ F7: SEARCH ═══
  console.log('\n── F7: SEARCH ──');
  const ws = await tool('web_search', { query: 'latest AI news 2026' });
  log('F7', 'web_search', ws.json?.ok, JSON.stringify(ws.json).slice(0,150));
  const ac = await tool('search_academic', { query: 'transformer architecture' });
  log('F7', 'academic', ac.json?.ok, JSON.stringify(ac.json).slice(0,120));
  const gh = await tool('search_github', { query: 'react stars:>50000' });
  log('F7', 'github', gh.json?.ok, JSON.stringify(gh.json).slice(0,120));
  const so = await tool('search_stackoverflow', { query: 'Node.js stream' });
  log('F7', 'stackoverflow', so.json?.ok, JSON.stringify(so.json).slice(0,120));
  const fu = await tool('fetch_url', { url: 'https://jsonplaceholder.typicode.com/todos/1' });
  log('F7', 'fetch_url', fu.json?.ok, JSON.stringify(fu.json).slice(0,120));
  const rs = await tool('rss_read', { url: 'https://feeds.bbci.co.uk/news/rss.xml' });
  log('F7', 'rss BBC', rs.json?.ok, JSON.stringify(rs.json).slice(0,120));

  // ═══ F8: KNOWLEDGE ═══
  console.log('\n── F8: KNOWLEDGE ──');
  const wk = await tool('wikipedia_search', { query: 'Artificial Intelligence' });
  log('F8', 'wikipedia', wk.json?.ok, JSON.stringify(wk.json).slice(0,120));
  const dc = await tool('dictionary', { word: 'serendipity' });
  log('F8', 'dictionary', dc.json?.ok, JSON.stringify(dc.json).slice(0,120));
  const tl = await tool('translate', { text: 'Hello world', to: 'ro' });
  log('F8', 'translate', tl.json?.ok, JSON.stringify(tl.json).slice(0,120));

  // ═══ F11: DEV TOOLS ═══
  console.log('\n── F11: DEV ──');
  const gr = await tool('github_repo_info', { repo: 'facebook/react' });
  log('F11', 'github/react', gr.json?.ok, JSON.stringify(gr.json).slice(0,150));
  const nm = await tool('npm_package_info', { name: 'express' });
  log('F11', 'npm express', nm.json?.ok, JSON.stringify(nm.json).slice(0,120));
  const py = await tool('pypi_package_info', { name: 'requests' });
  log('F11', 'pypi requests', py.json?.ok, JSON.stringify(py.json).slice(0,120));

  // ═══ F12: RADIO ═══
  console.log('\n── F12: RADIO ──');
  const rd = await tool('play_radio', { query: 'Europa FM' });
  log('F12', 'radio Europa', rd.json?.ok, JSON.stringify(rd.json).slice(0,150));

  // ═══ F16: EDGE CASES ═══
  console.log('\n── F16: EDGE CASES ──');
  const bad = await tool('nonexistent_tool', {});
  log('F16', 'bad tool', !bad.ok || bad.json?.error, `status=${bad.status}`);
  const ssrf = await tool('fetch_url', { url: 'http://169.254.169.254/latest/meta-data' });
  log('F16', 'SSRF block', ssrf.json?.ok === false || ssrf.json?.error, 'blocked');
  const big = await tool('calculate', { expression: 'x'.repeat(600) });
  log('F16', 'oversized', big.json?.error || big.json?.ok === false, 'rejected');

  // ═══ SUMMARY ═══
  console.log('\n═══════════════════════════════════════════');
  console.log(`  REZULTAT: ${pass} PASS / ${fail} FAIL / ${pass+fail} TOTAL`);
  console.log(`  Rata: ${((pass/(pass+fail))*100).toFixed(1)}%`);
  console.log('═══════════════════════════════════════════\n');
  const failures = results.filter(r => !r.ok);
  if (failures.length) {
    console.log('── EȘUATE ──');
    for (const f of failures) console.log(`  ❌ [${f.faza}] ${f.test}: ${f.detail}`);
  }
}
run().catch(e => console.error('FATAL:', e));
