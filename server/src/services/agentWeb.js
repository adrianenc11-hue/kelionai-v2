'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

async function fetchUrl(url, options = {}) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  try {
    const response = await new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: options.timeout || 15000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (options.body) req.write(options.body);
      req.end();
    });
    return { ok: true, ...response };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function searchWeb(query, numResults = 5) {
  if (!query || typeof query !== 'string') return { ok: false, error: 'No query provided.' };
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX;
  if (!apiKey || !cx) {
    return { ok: false, error: 'Google Custom Search not configured. Set GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_CX.' };
  }
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${Math.min(10, numResults)}`;
  const result = await fetchUrl(url);
  if (!result.ok) return result;
  try {
    const json = JSON.parse(result.body);
    const items = (json.items || []).map(i => ({
      title: i.title,
      link: i.link,
      snippet: i.snippet,
    }));
    return { ok: true, items };
  } catch {
    return { ok: false, error: 'Failed to parse search results.' };
  }
}

module.exports = { fetchUrl, searchWeb };
