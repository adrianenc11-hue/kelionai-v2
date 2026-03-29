// ═══════════════════════════════════════════════════════════════
// KelionAI — Tools Module
// Weather: GPS din browser (primar) → IP fallback → city name
// Search: Tavily / Perplexity
// Image: FLUX / DALL-E
// ZERO hardcode — totul live din browser sau server
// ═══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
const KelionTools = (function () {
  'use strict';
  const API = window.location.origin;

  function authHeaders() {
    return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
  }

  // ── Search ──
  async function search(query) {
    const r = await fetch(API + '/api/search', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: query }),
    });
    if (!r.ok) throw new Error('Search failed: ' + r.status);
    return r.json();
  }

  // ── Weather — GPS primar, city fallback ──
  async function weather(city, coords) {
    const body = {};
    // Prioritate: coords GPS din browser
    if (coords && typeof coords.lat === 'number') {
      body.lat = coords.lat;
      body.lon = coords.lng || coords.lon;
    } else if (city) {
      body.city = city;
    }
    const r = await fetch(API + '/api/weather', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('Weather failed: ' + r.status);
    return r.json();
  }

  // ── Weather cu GPS live ──
  async function weatherWithGPS(cityHint) {
    // Încearcă GPS din browser mai întâi
    let coords = null;
    if (window.KGeo) {
      try {
        coords = await KGeo.getLocation();
      } catch (e) {
        console.warn('[Tools] GPS unavailable:', e.message);
      }
    }
    return weather(cityHint || null, coords);
  }

  // ── Image generation ──
  async function generateImage(prompt) {
    const r = await fetch(API + '/api/imagine', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: prompt }),
    });
    if (!r.ok) throw new Error('Image generation failed: ' + r.status);
    return r.json();
  }

  // ── Keyword patterns ──
  const WEATHER_KEYWORDS = [
    'vreme', 'meteo', 'weather', 'temperatură', 'temperatura', 'temperature',
    'ploaie', 'rain', 'ninsoare', 'snow', 'forecast', 'prognoza', 'frig', 'cald',
    'soare', 'sunny', 'cloudy', 'noros', 'vant', 'wind', 'umiditate', 'humidity',
    'ce timp', "how's the weather", 'cum e vremea', 'ce temperatura', 'what temperature',
  ];
  const SEARCH_KEYWORDS = ['caută', 'cauta', 'search', 'găsește', 'gaseste', 'find', 'ce este', 'what is'];
  const IMAGE_KEYWORDS = [
    'generează', 'genereaza', 'generate', 'desenează', 'deseneaza', 'draw',
    'creează', 'creeaza', 'create', 'imagine', 'image', 'picture', 'pictură', 'pictura',
  ];

  // ── preprocessMessage — auto-detect intent și enrichment ──
  async function preprocessMessage(userMessage) {
    const lower = userMessage.toLowerCase();

    // ── Image Generation ──
    if (
      IMAGE_KEYWORDS.some(function (k) { return lower.includes(k); }) &&
      (lower.includes('imagine') || lower.includes('image') || lower.includes('picture') ||
       lower.includes('desen') || lower.includes('draw') || lower.includes('genereaz') ||
       lower.includes('creeaz') || lower.includes('create') || lower.includes('pictur'))
    ) {
      let imgPrompt = userMessage
        .replace(/^(generează|genereaza|generate|desenează|deseneaza|draw|creează|creeaza|create)\s*(o|un|una|an|a)?\s*(imagine|image|picture|pictură|pictura|desen)?\s*(cu|de|of|with|about)?\s*/i, '')
        .trim();
      if (!imgPrompt || imgPrompt.length < 3) imgPrompt = userMessage;
      try {
        const imgResult = await generateImage(imgPrompt);
        if (imgResult && imgResult.image) {
          if (window.MonitorManager) MonitorManager.show(imgResult.image, 'image');
          return '\n[IMAGE_GENERATED: ' + imgPrompt + ']\n![Generated Image](' + imgResult.image + ')';
        }
      } catch (e) {
        console.warn('[Tools] image error:', e.message);
        return '\n[Image generation failed: ' + e.message + ']';
      }
    }

    // ── Weather — cu GPS live din browser ──
    if (WEATHER_KEYWORDS.some(function (k) { return lower.includes(k); })) {
      // Extrage city din mesaj (opțional)
      const cityMatch =
        lower.match(/(?:în|in|la|for|at|din|from)\s+([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,30})/) ||
        lower.match(/vreme(?:a)?\s+(?:din\s+)?([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,20})/);
      const cityHint = cityMatch ? cityMatch[1].trim() : null;

      try {
        // weatherWithGPS: încearcă GPS din browser, fallback la city sau IP
        const data = await weatherWithGPS(cityHint);
        if (window.MonitorManager) MonitorManager.showWeather(data);

        const temp = data.current?.temperature_2m !== undefined
          ? data.current.temperature_2m
          : data.temperature;
        const feelsLike = data.current?.apparent_temperature;
        const desc = data.description || '';
        const city = data.city || cityHint || 'your location';

        let weatherSummary = '\n[LIVE WEATHER — ' + city + ': ' + (temp !== undefined ? Math.round(temp) + '°C' : 'N/A');
        if (feelsLike !== undefined) weatherSummary += ', feels like ' + Math.round(feelsLike) + '°C';
        if (desc) weatherSummary += ', ' + desc;
        weatherSummary += ' | Source: ' + (data.provider || 'open-meteo') + ']';
        return weatherSummary;
      } catch (e) {
        console.warn('[Tools] weather error:', e.message);
        return '';
      }
    }

    // ── Search ──
    if (SEARCH_KEYWORDS.some(function (k) { return lower.includes(k); })) {
      const query = userMessage.replace(/^(caută|cauta|search|găsește|gaseste|find)\s+/i, '').trim() || userMessage;
      try {
        const result = await search(query);
        const results = result.results || result;
        if (window.MonitorManager && results && results.length) MonitorManager.showSearchResults(results);
        if (results && results.length) {
          const snippet = results
            .slice(0, 3)
            .map(function (r) { return (r.title || '') + ': ' + (r.snippet || r.description || ''); })
            .join(' | ');
          return '\n[Search results: ' + snippet + ']';
        }
      } catch (e) {
        console.warn('[Tools] search error:', e.message);
      }
      return '';
    }

    return '';
  }

  return {
    search: search,
    weather: weather,
    weatherWithGPS: weatherWithGPS,
    generateImage: generateImage,
    preprocessMessage: preprocessMessage,
  };
})();