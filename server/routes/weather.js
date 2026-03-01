// ═══════════════════════════════════════════════════════════════
// KelionAI — Weather Routes
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate, weatherSchema } = require('../validation');

const router = express.Router();

const weatherLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many weather requests.' }, standardHeaders: true, legacyHeaders: false });

// POST /api/weather
router.post('/', weatherLimiter, validate(weatherSchema), async (req, res) => {
    try {
        const { city } = req.body;
        if (!city) return res.status(400).json({ error: 'City is required' });
        const geo = await (await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=ro')).json();
        if (!geo.results?.[0]) return res.status(404).json({ error: '"' + city + '" not found' });
        const { latitude, longitude, name, country } = geo.results[0];
        const wx = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto')).json();
        const c = wx.current;
        const codes = { 0: 'Clear ☀️', 1: 'Mostly clear 🌤️', 2: 'Partly cloudy ⛅', 3: 'Cloudy ☁️', 45: 'Foggy 🌫️', 51: 'Drizzle 🌦️', 61: 'Rain 🌧️', 71: 'Snow 🌨️', 80: 'Showers 🌦️', 95: 'Thunderstorm ⛈️' };
        const cond = codes[c.weather_code] || '?';
        res.json({
            city: name, country, temperature: c.temperature_2m, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, condition: cond,
            description: name + ', ' + country + ': ' + c.temperature_2m + '°C, ' + cond + ', humidity ' + c.relative_humidity_2m + '%, wind ' + c.wind_speed_10m + ' km/h'
        });
    } catch (e) { res.status(500).json({ error: 'Weather error' }); }
});

module.exports = router;
