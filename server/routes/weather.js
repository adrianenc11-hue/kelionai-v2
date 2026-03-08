// ═══════════════════════════════════════════════════════════════
// KelionAI — Weather Routes
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { validate, weatherSchema } = require("../validation");

const router = express.Router();

const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many weather requests." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/weather — with IP geolocation fallback (no GPS popup needed)
router.post("/", weatherLimiter, validate(weatherSchema), async (req, res) => {
  try {
    const { getUserFromToken, brain } = req.app.locals;
    const user = await getUserFromToken(req).catch(() => null);
    let { city, lat, lng } = req.body;
    let latitude, longitude, name, country;

    // Priority: lat/lng (GPS) > city name > IP geolocation
    if (lat && lng) {
      // Client sent GPS coordinates directly
      latitude = lat;
      longitude = lng;
      // Reverse geocode to get city name
      try {
        const revGeoUrl = brain?.getToolUrl("open_meteo_reverse") || "https://geocoding-api.open-meteo.com/v1/reverse";
        const revGeo = await (await fetch(
          `${revGeoUrl}?latitude=${lat}&longitude=${lng}&count=1`
        )).json();
        name = revGeo.results?.[0]?.name || "Current Location";
        country = revGeo.results?.[0]?.country || "";
      } catch {
        name = "Current Location";
        country = "";
      }
    } else if (city) {
      // City name given — geocode it
      const geoSearchUrl = brain?.getToolUrl("open_meteo_geo") || "https://geocoding-api.open-meteo.com/v1/search";
      const geo = await (
        await fetch(
          geoSearchUrl + "?name=" +
          encodeURIComponent(city) +
          "&count=1&language=ro",
        )
      ).json();
      if (!geo.results?.[0])
        return res.status(404).json({ error: '"' + city + '" not found' });
      ({ latitude, longitude, name, country } = geo.results[0]);
    } else {
      // No city, no GPS → fallback to IP geolocation (no popup needed)
      try {
        const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
        const ipApiUrl = brain?.getToolUrl("ip_api") || "http://ip-api.com/json";
        const ipGeo = await (await fetch(`${ipApiUrl}/${clientIP}?fields=city,country,lat,lon`)).json();
        if (ipGeo.city) {
          latitude = ipGeo.lat;
          longitude = ipGeo.lon;
          name = ipGeo.city;
          country = ipGeo.country || "";
        } else {
          return res.status(400).json({ error: "Could not determine location. Send city name or enable GPS." });
        }
      } catch {
        return res.status(400).json({ error: "City is required (IP geolocation failed)" });
      }
    }
    const forecastUrl = brain?.getToolUrl("open_meteo_forecast") || "https://api.open-meteo.com/v1/forecast";
    const wx = await (
      await fetch(
        forecastUrl + "?latitude=" +
        latitude +
        "&longitude=" +
        longitude +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto",
      )
    ).json();
    const c = wx.current;
    const codes = {
      0: "Clear ☀️",
      1: "Mostly clear 🌤️",
      2: "Partly cloudy ⛅",
      3: "Cloudy ☁️",
      45: "Foggy 🌫️",
      51: "Drizzle 🌦️",
      61: "Rain 🌧️",
      71: "Snow 🌨️",
      80: "Showers 🌦️",
      95: "Thunderstorm ⛈️",
    };
    const cond = codes[c.weather_code] || "?";
    const weatherDesc = name + ", " + country + ": " + c.temperature_2m + "°C, " + cond + ", humidity " + c.relative_humidity_2m + "%, wind " + c.wind_speed_10m + " km/h";

    // ═══ BRAIN INTEGRATION — save weather context ═══
    if (brain && user?.id) {
      brain.saveMemory(user.id, "context", "Vremea la " + weatherDesc, { type: "weather" }).catch(() => { });
    }

    res.json({
      city: name,
      country,
      temperature: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      condition: cond,
      description: weatherDesc,
    });
  } catch {
    res.status(500).json({ error: "Weather error" });
  }
});

// GET /api/weather?city=X — convenience GET endpoint
router.get("/", weatherLimiter, async (req, res) => {
  try {
    const city = req.query.city;
    if (!city) return res.status(400).json({ error: "city query parameter required. Example: /api/weather?city=Bucharest" });

    const { brain } = req.app.locals;
    const geoSearchUrl = brain?.getToolUrl("open_meteo_geo") || "https://geocoding-api.open-meteo.com/v1/search";
    const geo = await (await fetch(geoSearchUrl + "?name=" + encodeURIComponent(city) + "&count=1&language=ro")).json();
    if (!geo.results?.[0]) return res.status(404).json({ error: '"' + city + '" not found' });
    const { latitude, longitude, name, country } = geo.results[0];

    const forecastUrl = brain?.getToolUrl("open_meteo_forecast") || "https://api.open-meteo.com/v1/forecast";
    const wx = await (await fetch(forecastUrl + "?latitude=" + latitude + "&longitude=" + longitude + "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto")).json();
    const c = wx.current;
    const codes = { 0: "Clear ☀️", 1: "Mostly clear 🌤️", 2: "Partly cloudy ⛅", 3: "Cloudy ☁️", 45: "Foggy 🌫️", 51: "Drizzle 🌦️", 61: "Rain 🌧️", 71: "Snow 🌨️", 80: "Showers 🌦️", 95: "Thunderstorm ⛈️" };
    const cond = codes[c.weather_code] || "?";

    res.json({
      city: name, country,
      temperature: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
      condition: cond,
      description: name + ", " + country + ": " + c.temperature_2m + "°C, " + cond + ", humidity " + c.relative_humidity_2m + "%, wind " + c.wind_speed_10m + " km/h",
    });
  } catch (e) {
    res.status(500).json({ error: "Weather error: " + (e.message || "unknown") });
  }
});

module.exports = router;
