// ═══════════════════════════════════════════════════════════════
// KelionTools — Frontend tool executor for search, weather, images
// Connects frontend to backend APIs: /api/search, /api/weather, /api/imagine
// ═══════════════════════════════════════════════════════════════
const KelionTools = (function () {
    'use strict';

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function isWeatherRequest(t) {
        return /\b(vreme|meteo|temperatură|temperatura|grad|ploaie|soare|ninge|vânt|weather|forecast|prognoz)\b/i.test(t);
    }

    function isSearchRequest(t) {
        return /\b(caută|cauta|search|găsește|gaseste|informații|informatii|știri|stiri|ce e |cine e|cât costă|cat costa|când|cand|unde |how |what |who |when )\b/i.test(t);
    }

    function isImageGenRequest(t) {
        return /\b(generează|genereaza|creează|creeaza|desenează|deseneaza|picture|draw|generate|fă-mi|fa-mi)\b/i.test(t) &&
               /\b(imagine|poza|foto|poză|picture|image|desen)\b/i.test(t);
    }

    function extractCity(message) {
        const m = message.match(/(?:în|in|la|din|for|at)\s+([A-Za-zÀ-ÿ]+)/i);
        return m ? m[1] : null;
    }

    async function search(query) {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ query })
        });
        return res.json();
    }

    async function weather(city) {
        const res = await fetch('/api/weather', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ city })
        });
        return res.json();
    }

    async function generateImage(prompt) {
        const res = await fetch('/api/imagine', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ prompt })
        });
        return res.json();
    }

    async function preprocessMessage(message) {
        let extraContext = '';

        // AUTO-WEATHER
        if (isWeatherRequest(message)) {
            try {
                const city = extractCity(message) || 'București';
                const w = await weather(city);
                if (w && !w.error) {
                    extraContext += '\n[METEO REAL ' + w.city + ': ' + w.description + ']';
                    if (window.MonitorManager) MonitorManager.showWeather(w);
                }
            } catch (e) { /* ignore — AI will still respond */ }
        }

        // AUTO-SEARCH (skip if weather, since weather is more specific)
        if (isSearchRequest(message) && !isWeatherRequest(message)) {
            try {
                const s = await search(message);
                if (s && !s.error) {
                    extraContext += '\n[CĂUTARE WEB: ' + JSON.stringify(s).substring(0, 2000) + ']';
                    if (window.MonitorManager && s.results && s.results.length) MonitorManager.showSearchResults(s.results);
                }
            } catch (e) { /* ignore */ }
        }

        // AUTO-IMAGE GENERATION
        if (isImageGenRequest(message)) {
            try {
                const i = await generateImage(message);
                if (i && i.image) {
                    if (window.MonitorManager) MonitorManager.showImage(i.image, message);
                    extraContext += '\n[Imagine generată pe monitor.]';
                }
            } catch (e) { /* ignore */ }
        }

        return extraContext;
    }

    return { search, weather, generateImage, preprocessMessage, isWeatherRequest, isSearchRequest, isImageGenRequest };
})();

window.KelionTools = KelionTools;
