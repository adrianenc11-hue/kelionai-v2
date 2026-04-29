// Test alternative free search APIs
// 1. Wikipedia API - always works, good for factual queries  
// 2. Google Programmable Search (needs key but 100/day free)
// 3. Brave Search API (needs key, 2000/month free)

async function testWikipedia(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&srprop=snippet`;
  const r = await fetch(url);
  const data = await r.json();
  return data?.query?.search || [];
}

async function testGoogleScrape(query) {
  // Google's JSON API for custom search (lite version)
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=test&cx=test`;
  try {
    const r = await fetch(url);
    return { status: r.status };
  } catch (e) {
    return { error: e.message };
  }
}

// Bing Web Search via scraping
async function testBingScrape(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=5`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    const html = await r.text();
    // Bing uses <li class="b_algo"> for organic results
    const blocks = html.split('class="b_algo"');
    const results = [];
    for (let i = 1; i < blocks.length && results.length < 5; i++) {
      const titleMatch = blocks[i].match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = blocks[i].match(/class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
      if (titleMatch) {
        results.push({
          title: titleMatch[2].replace(/<[^>]*>/g, '').trim(),
          url: titleMatch[1],
          snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim().slice(0, 200) : '',
        });
      }
    }
    return results;
  } catch (e) {
    return [];
  }
}

(async () => {
  const queries = [
    'OpenAI GPT-5',
    'restaurant Barcelona',
    'cel mai bun telefon 2026',
    'exchange rate EUR to RON',
  ];
  
  console.log('=== WIKIPEDIA API ===');
  for (const q of queries) {
    const results = await testWikipedia(q);
    console.log(`  "${q}" → ${results.length} results${results[0] ? ': ' + results[0].title : ''}`);
  }
  
  console.log('\n=== BING SCRAPE ===');
  for (const q of queries) {
    const results = await testBingScrape(q);
    console.log(`  "${q}" → ${results.length} results${results[0] ? ': ' + results[0].title.slice(0, 50) : ''}`);
  }
})();
