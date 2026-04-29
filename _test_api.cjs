// Direct local test of each tool function (no HTTP, no CSRF)
const {
  toolCalculate, toolGetWeather, toolWebSearch, toolTranslate,
  toolGetCryptoPrice, toolGetEarthquakes, toolGetRoute, toolGetForex,
  toolGetSunTimes, toolWikipediaSearch,
} = require('./server/src/services/realTools');

const tests = [
  { name: 'calculate', fn: () => toolCalculate({ expression: '127 * 38' }) },
  { name: 'get_weather', fn: () => toolGetWeather({ city: 'Bucharest' }) },
  { name: 'web_search', fn: () => toolWebSearch({ query: 'cel mai bun telefon 2026', num_results: 3 }) },
  { name: 'get_crypto_price', fn: () => toolGetCryptoPrice({ coin: 'bitcoin' }) },
  { name: 'translate', fn: () => toolTranslate({ text: 'Bună ziua, mă bucur', to: 'de' }) },
  { name: 'wikipedia_search', fn: () => toolWikipediaSearch({ query: 'Albert Einstein' }) },
  { name: 'get_earthquakes', fn: () => toolGetEarthquakes({ min_magnitude: 4 }) },
  { name: 'get_route', fn: () => toolGetRoute({ from: 'Bucharest, Romania', to: 'Brasov, Romania' }) },
  { name: 'get_forex', fn: () => toolGetForex({ base: 'EUR', quote: 'RON' }) },
  { name: 'get_sun_times', fn: () => toolGetSunTimes({ city: 'Bucharest' }) },
];

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      const result = await t.fn();
      const ok = result && result.ok !== false && !result.error;
      if (ok) {
        pass++;
        let summary = JSON.stringify(result).slice(0, 120);
        if (t.name === 'calculate') summary = `result=${result.result}`;
        else if (t.name === 'get_weather') summary = `${result.temperature}°, ${result.condition || result.description}`;
        else if (t.name === 'web_search') summary = `${result.results?.length} results (${result.source}), 1st: ${result.results?.[0]?.title?.slice(0,40)}`;
        else if (t.name === 'get_crypto_price') summary = `$${result.price_usd || result.usd || JSON.stringify(result).slice(0,80)}`;
        else if (t.name === 'translate') summary = result.translated;
        else if (t.name === 'wikipedia_search') summary = (result.extract || '').slice(0, 60);
        else if (t.name === 'get_earthquakes') summary = `${result.count} quakes`;
        else if (t.name === 'get_route') summary = `${result.distance || result.summary || JSON.stringify(result).slice(0,80)}`;
        else if (t.name === 'get_forex') summary = `rate=${result.rate}`;
        else if (t.name === 'get_sun_times') summary = `sunrise=${result.sunrise}`;
        console.log(`✅ ${t.name}: ${summary}`);
      } else {
        fail++;
        console.log(`❌ ${t.name}: ${result?.error || JSON.stringify(result).slice(0,150)}`);
      }
    } catch (err) {
      fail++;
      console.log(`❌ ${t.name}: CRASH — ${err.message}`);
    }
  }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS: ${pass}/10 passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
