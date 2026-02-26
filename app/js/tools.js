// ═══════════════════════════════════════════════════════════════
// KelionAI — Tools Module
// Connects frontend to backend API endpoints for search, weather,
// and image generation. preprocessMessage() auto-detects intent
// and enriches the AI prompt with real-time data.
// ═══════════════════════════════════════════════════════════════
var KelionTools = (function () {
    'use strict';
    var API = window.location.origin;

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    async function search(query) {
        var r = await fetch(API + '/api/search', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ query: query })
        });
        if (!r.ok) throw new Error('Search failed: ' + r.status);
        return r.json();
    }

    async function weather(city) {
        var r = await fetch(API + '/api/weather?city=' + encodeURIComponent(city), {
            headers: window.KAuth ? KAuth.getAuthHeaders() : {}
        });
        if (!r.ok) throw new Error('Weather failed: ' + r.status);
        return r.json();
    }

    async function generateImage(prompt) {
        var r = await fetch(API + '/api/generate-image', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ prompt: prompt })
        });
        if (!r.ok) throw new Error('Image generation failed: ' + r.status);
        return r.json();
    }

    var WEATHER_KEYWORDS = ['vreme', 'meteo', 'weather', 'temperatură', 'temperatura', 'ploaie', 'forecast'];
    var SEARCH_KEYWORDS  = ['caută', 'cauta', 'search', 'găsește', 'gaseste', 'find', 'ce este', 'what is'];

    async function preprocessMessage(userMessage) {
        var lower = userMessage.toLowerCase();

        // ── Weather ──────────────────────────────────────────────
        if (WEATHER_KEYWORDS.some(function (k) { return lower.includes(k); })) {
            // Extract city — word(s) after "în"/"in"/"la"/"for"/"at"
            var cityMatch = lower.match(/(?:în|in|la|for|at)\s+([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,30})/) ||
                            lower.match(/vreme(?:a)?\s+(?:din\s+)?([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,20})/);
            var city = cityMatch ? cityMatch[1].trim() : 'București';
            try {
                var data = await weather(city);
                if (window.MonitorManager) MonitorManager.showWeather(data);
                return '\n[Vreme ' + city + ': ' + (data.temperature !== undefined ? data.temperature : '') + '°C, ' + (data.description || '') + ']';
            } catch (e) {
                console.warn('[Tools] weather error:', e.message);
                return '';
            }
        }

        // ── Search ────────────────────────────────────────────────
        if (SEARCH_KEYWORDS.some(function (k) { return lower.includes(k); })) {
            // Use the original message as the search query (strip trigger words)
            var query = userMessage.replace(/^(caută|cauta|search|găsește|gaseste|find)\s+/i, '').trim() || userMessage;
            try {
                var result = await search(query);
                var results = result.results || result;
                if (window.MonitorManager && results && results.length) MonitorManager.showSearchResults(results);
                if (results && results.length) {
                    var snippet = results.slice(0, 3).map(function (r) {
                        return (r.title || '') + ': ' + (r.snippet || r.description || '');
                    }).join(' | ');
                    return '\n[Rezultate căutare: ' + snippet + ']';
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
        generateImage: generateImage,
        preprocessMessage: preprocessMessage
    };
})();
