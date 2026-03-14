// ═══════════════════════════════════════════════════════════════
// KelionAI — Tools Module
// Connects frontend to backend API endpoints for search, weather,
// and image generation. preprocessMessage() auto-detects intent
// and enriches the AI prompt with real-time data.
// ═══════════════════════════════════════════════════════════════
var KelionTools = (function () {
  "use strict";
  var API = window.location.origin;

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      ...(window.KAuth ? KAuth.getAuthHeaders() : {}),
    };
  }

  async function search(query) {
    var r = await fetch(API + "/api/search", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ query: query }),
    });
    if (!r.ok) throw new Error("Search failed: " + r.status);
    return r.json();
  }

  async function weather(city) {
    var r = await fetch(API + "/api/weather", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ city: city }),
    });
    if (!r.ok) throw new Error("Weather failed: " + r.status);
    return r.json();
  }

  async function generateImage(prompt) {
    var r = await fetch(API + "/api/imagine", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ prompt: prompt }),
    });
    if (!r.ok) throw new Error("Image generation failed: " + r.status);
    return r.json();
  }

  var WEATHER_KEYWORDS = [
    "vreme",
    "meteo",
    "weather",
    "temperatură",
    "temperatura",
    "ploaie",
    "forecast",
  ];
  var SEARCH_KEYWORDS = [
    "caută",
    "cauta",
    "search",
    "găsește",
    "gaseste",
    "find",
    "ce este",
    "what is",
  ];
  var IMAGE_KEYWORDS = [
    "generează",
    "genereaza",
    "generate",
    "desenează",
    "deseneaza",
    "draw",
    "creează",
    "creeaza",
    "create",
    "imagine",
    "image",
    "picture",
    "pictură",
    "pictura",
  ];

  async function preprocessMessage(userMessage) {
    var lower = userMessage.toLowerCase();

    // ── Image Generation ─────────────────────────────────────
    if (
      IMAGE_KEYWORDS.some(function (k) {
        return lower.includes(k);
      }) &&
      (lower.includes("imagine") ||
        lower.includes("image") ||
        lower.includes("picture") ||
        lower.includes("desen") ||
        lower.includes("draw") ||
        lower.includes("genereaz") ||
        lower.includes("creeaz") ||
        lower.includes("create") ||
        lower.includes("pictur"))
    ) {
      // Extract the prompt — everything after the trigger keyword
      var imgPrompt = userMessage
        .replace(
          /^(generează|genereaza|generate|desenează|deseneaza|draw|creează|creeaza|create)\s*(o|un|una|an|a)?\s*(imagine|image|picture|pictură|pictura|desen)?\s*(cu|de|of|with|about)?\s*/i,
          "",
        )
        .trim();
      if (!imgPrompt || imgPrompt.length < 3) imgPrompt = userMessage;
      try {
        var imgResult = await generateImage(imgPrompt);
        if (imgResult && imgResult.image) {
          // Display on monitor
          if (window.MonitorManager)
            MonitorManager.show(imgResult.image, "image");
          return (
            "\n[IMAGE_GENERATED: " +
            imgPrompt +
            "]\n![Generated Image](" +
            imgResult.image +
            ")"
          );
        }
      } catch (e) {
        console.warn("[Tools] image error:", e.message);
        return "\n[Image generation failed: " + e.message + "]";
      }
    }

    // ── Weather ──────────────────────────────────────────────
    if (
      WEATHER_KEYWORDS.some(function (k) {
        return lower.includes(k);
      })
    ) {
      // Extract city — word(s) after "în"/"in"/"la"/"for"/"at"
      var cityMatch =
        lower.match(/(?:în|in|la|for|at)\s+([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,30})/) ||
        lower.match(/vreme(?:a)?\s+(?:din\s+)?([a-zA-ZăâîșțĂÂÎȘȚ\s]{2,20})/);
      var city = cityMatch ? cityMatch[1].trim() : "Bucharest";
      try {
        var data = await weather(city);
        if (window.MonitorManager) MonitorManager.showWeather(data);
        return (
          "\n[Weather " +
          city +
          ": " +
          (data.temperature !== undefined ? data.temperature : "") +
          "°C, " +
          (data.description || "") +
          "]"
        );
      } catch (e) {
        console.warn("[Tools] weather error:", e.message);
        return "";
      }
    }

    // ── Search ────────────────────────────────────────────────
    if (
      SEARCH_KEYWORDS.some(function (k) {
        return lower.includes(k);
      })
    ) {
      // Use the original message as the search query (strip trigger words)
      var query =
        userMessage
          .replace(/^(caută|cauta|search|găsește|gaseste|find)\s+/i, "")
          .trim() || userMessage;
      try {
        var result = await search(query);
        var results = result.results || result;
        if (window.MonitorManager && results && results.length)
          MonitorManager.showSearchResults(results);
        if (results && results.length) {
          var snippet = results
            .slice(0, 3)
            .map(function (r) {
              return (
                (r.title || "") + ": " + (r.snippet || r.description || "")
              );
            })
            .join(" | ");
          return "\n[Search results: " + snippet + "]";
        }
      } catch (e) {
        console.warn("[Tools] search error:", e.message);
      }
      return "";
    }

    return "";
  }

  return {
    search: search,
    weather: weather,
    generateImage: generateImage,
    preprocessMessage: preprocessMessage,
  };
})();
