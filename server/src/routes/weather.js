'use strict';

// Weather embed route — server-side render of a self-contained HTML
// dashboard driven by Open-Meteo.
//
// Why not wttr.in? Adrian asked for the most precise weather for the
// user's GPS location. Open-Meteo uses the ICON-D2 model at 2.2 km
// resolution for Central Europe (vs ~10 km for OpenWeather/wttr.in),
// is free for commercial use, and requires no API key. Perfect fit
// for the Kelion stage monitor.
//
// GET /api/weather/embed?lat=X&lon=Y[&name=Label]
//   -> text/html  with a full dashboard ready to render in an <iframe>.
//
// Open-Meteo endpoint:
//   https://api.open-meteo.com/v1/forecast
//     ?latitude=<lat>
//     &longitude=<lon>
//     &current=temperature_2m,apparent_temperature,relative_humidity_2m,
//              wind_speed_10m,wind_direction_10m,weather_code,
//              is_day
//     &daily=temperature_2m_max,temperature_2m_min,weather_code,
//            sunrise,sunset
//     &timezone=auto
//     &forecast_days=4
//
// Open-Meteo CORS is open, but we proxy it through the server so the
// embedded page doesn't depend on client-side CORS and so we can style
// it to match the Kelion stage aesthetic (dark + violet accent).

const express = require('express');
const router = express.Router();

// Weather-code → human label + emoji icon. Mapping from Open-Meteo's
// WMO weather-code spec (https://open-meteo.com/en/docs).
const WEATHER_CODES = {
  0:  { label: 'Clear sky',            icon: '☀️' },
  1:  { label: 'Mainly clear',         icon: '🌤️' },
  2:  { label: 'Partly cloudy',        icon: '⛅' },
  3:  { label: 'Overcast',             icon: '☁️' },
  45: { label: 'Fog',                  icon: '🌫️' },
  48: { label: 'Depositing rime fog',  icon: '🌫️' },
  51: { label: 'Light drizzle',        icon: '🌦️' },
  53: { label: 'Moderate drizzle',     icon: '🌦️' },
  55: { label: 'Dense drizzle',        icon: '🌧️' },
  56: { label: 'Freezing drizzle',     icon: '🌧️' },
  57: { label: 'Freezing drizzle',     icon: '🌧️' },
  61: { label: 'Light rain',           icon: '🌦️' },
  63: { label: 'Moderate rain',        icon: '🌧️' },
  65: { label: 'Heavy rain',           icon: '🌧️' },
  66: { label: 'Freezing rain',        icon: '🌧️' },
  67: { label: 'Freezing rain',        icon: '🌧️' },
  71: { label: 'Light snow',           icon: '🌨️' },
  73: { label: 'Moderate snow',        icon: '🌨️' },
  75: { label: 'Heavy snow',           icon: '❄️' },
  77: { label: 'Snow grains',          icon: '🌨️' },
  80: { label: 'Rain showers',         icon: '🌦️' },
  81: { label: 'Rain showers',         icon: '🌧️' },
  82: { label: 'Violent rain showers', icon: '⛈️' },
  85: { label: 'Snow showers',         icon: '🌨️' },
  86: { label: 'Heavy snow showers',   icon: '❄️' },
  95: { label: 'Thunderstorm',         icon: '⛈️' },
  96: { label: 'Thunderstorm w/ hail', icon: '⛈️' },
  99: { label: 'Thunderstorm w/ hail', icon: '⛈️' },
};

function describeCode(code) {
  if (code == null) return { label: '—', icon: '❔' };
  return WEATHER_CODES[code] || { label: `Code ${code}`, icon: '❔' };
}

function fmtDayName(iso) {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } catch {
    return iso;
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderDashboard(payload, label) {
  const current = payload.current || {};
  const daily = payload.daily || {};
  const tz = payload.timezone || 'UTC';

  const cw = describeCode(current.weather_code);
  const currentTemp = Math.round(Number(current.temperature_2m || 0));
  const apparent = Math.round(Number(current.apparent_temperature || 0));
  const wind = Math.round(Number(current.wind_speed_10m || 0));
  const humidity = Math.round(Number(current.relative_humidity_2m || 0));
  const isDay = current.is_day === 1;

  const days = [];
  if (Array.isArray(daily.time)) {
    for (let i = 0; i < Math.min(daily.time.length, 4); i += 1) {
      const w = describeCode(daily.weather_code?.[i]);
      days.push({
        day: i === 0 ? 'Today' : fmtDayName(daily.time[i]),
        icon: w.icon,
        label: w.label,
        hi: Math.round(Number(daily.temperature_2m_max?.[i] || 0)),
        lo: Math.round(Number(daily.temperature_2m_min?.[i] || 0)),
      });
    }
  }

  const gradientTop = isDay ? '#1e1a3a' : '#0a0820';
  const gradientBottom = isDay ? '#2a1f54' : '#140f35';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Weather — ${esc(label || 'your location')}</title>
<style>
  :root {
    color-scheme: dark;
    --accent: #a78bfa;
    --muted: #9ca3af;
    --card: rgba(255,255,255,0.05);
    --card-border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    color: #f5f3ff;
    background: linear-gradient(180deg, ${gradientTop} 0%, ${gradientBottom} 100%);
    overflow: hidden;
  }
  .wrap {
    height: 100%; width: 100%;
    padding: 28px 32px;
    display: flex; flex-direction: column; gap: 20px;
  }
  .header {
    display: flex; align-items: baseline; justify-content: space-between;
  }
  .location {
    font-size: 22px; font-weight: 600; letter-spacing: 0.2px;
  }
  .sub {
    font-size: 13px; color: var(--muted); margin-top: 4px;
  }
  .hero {
    display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center;
    padding: 24px; border-radius: 16px;
    background: var(--card); border: 1px solid var(--card-border);
    backdrop-filter: blur(12px);
  }
  .hero-left { display: flex; gap: 20px; align-items: center; }
  .hero-icon { font-size: 64px; line-height: 1; }
  .temp { font-size: 64px; font-weight: 300; line-height: 1; letter-spacing: -2px; }
  .temp span { font-size: 28px; color: var(--muted); margin-left: 4px; }
  .condition { font-size: 16px; color: var(--muted); margin-top: 4px; }
  .metrics { display: flex; gap: 28px; }
  .metric { text-align: right; }
  .metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  .metric-val { font-size: 20px; font-weight: 500; margin-top: 4px; }
  .forecast {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  }
  .day {
    padding: 18px; border-radius: 14px;
    background: var(--card); border: 1px solid var(--card-border);
    text-align: center;
  }
  .day-name { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .day-icon { font-size: 40px; line-height: 1; margin-bottom: 8px; }
  .day-label { font-size: 11px; color: var(--muted); height: 14px; overflow: hidden; }
  .day-range { margin-top: 10px; font-size: 14px; }
  .day-hi { color: #f5f3ff; font-weight: 500; }
  .day-lo { color: var(--muted); margin-left: 6px; }
  .footer {
    margin-top: auto;
    font-size: 11px; color: var(--muted); text-align: right;
  }
  .footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div>
        <div class="location">${esc(label || 'Your location')}</div>
        <div class="sub">${esc(tz)} · Updated now</div>
      </div>
    </div>
    <div class="hero">
      <div class="hero-left">
        <div class="hero-icon">${cw.icon}</div>
        <div>
          <div class="temp">${currentTemp}<span>°C</span></div>
          <div class="condition">${esc(cw.label)} · feels like ${apparent}°</div>
        </div>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="metric-label">Wind</div>
          <div class="metric-val">${wind} km/h</div>
        </div>
        <div class="metric">
          <div class="metric-label">Humidity</div>
          <div class="metric-val">${humidity}%</div>
        </div>
      </div>
    </div>
    <div class="forecast">
      ${days.map((d) => `
        <div class="day">
          <div class="day-name">${esc(d.day)}</div>
          <div class="day-icon">${d.icon}</div>
          <div class="day-label">${esc(d.label)}</div>
          <div class="day-range">
            <span class="day-hi">${d.hi}°</span>
            <span class="day-lo">${d.lo}°</span>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="footer">
      Data · <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>
    </div>
  </div>
</body>
</html>`;
}

function renderError(message) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Weather</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#0a0820;color:#f5f3ff;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .box{max-width:480px}
  h1{font-size:18px;font-weight:500;margin:0 0 8px}
  p{color:#9ca3af;font-size:13px}
</style></head>
<body><div class="box">
  <h1>Weather unavailable</h1>
  <p>${esc(message)}</p>
</div></body></html>`;
}

// Resolve a free-text place name to { lat, lon, name, country } using
// Open-Meteo's free geocoding API. Returns null on miss.
async function geocode(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Kelion/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = j && Array.isArray(j.results) && j.results[0];
    if (!hit) return null;
    return {
      lat: Number(hit.latitude),
      lon: Number(hit.longitude),
      name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
    };
  } catch {
    return null;
  }
}

router.get('/embed', async (req, res) => {
  let lat = Number(req.query.lat);
  let lon = Number(req.query.lon);
  let label = (req.query.name || '').toString().slice(0, 120);
  const placeQuery = (req.query.q || '').toString().slice(0, 120);

  res.set('Content-Type', 'text/html; charset=utf-8');
  // Allow the iframe embed on the stage monitor; explicitly *don't* set
  // X-Frame-Options so same-origin framing works. We also set a short
  // cache so fast repeated loads don't hammer Open-Meteo.
  res.set('Cache-Control', 'public, max-age=120');

  // If caller passed ?q=<place> (no lat/lon), run Open-Meteo geocoding.
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && placeQuery) {
    const hit = await geocode(placeQuery);
    if (hit) {
      lat = hit.lat;
      lon = hit.lon;
      if (!label) label = hit.name;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).send(renderError('Missing or invalid lat/lon.'));
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=4`;

  try {
    // Node 18+ has global fetch; the project already runs on Node 20.
    const r = await fetch(url, { headers: { 'User-Agent': 'Kelion/1.0' } });
    if (!r.ok) {
      return res.status(502).send(renderError(`Upstream returned ${r.status}.`));
    }
    const payload = await r.json();
    return res.send(renderDashboard(payload, label));
  } catch (err) {
    console.warn('[weather/embed] fetch failed:', err && err.message);
    return res.status(502).send(renderError('Could not reach the weather provider.'));
  }
});

module.exports = router;
