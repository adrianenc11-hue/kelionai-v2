import fetch from 'node-fetch';

export async function getWorldContext(location = {}) {
  const loc = location.city ? location : await getLocation(location.ip);
  const weather = await getWeather(loc.city);
  const now = new Date();

  return {
    time: {
      local: now.toLocaleString('en-US', { timeZone: loc.timezone }),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' })
    },
    location: {
      city: loc.city || 'Bucharest',
      country: loc.country || 'Romania'
    },
    weather: weather || { temp: 20, description: 'sunny' }
  };
}

async function getLocation(ip) {
  try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    return {
      city: data.city || 'Bucharest',
      country: data.country_name || 'Romania',
      timezone: data.timezone || 'Europe/Bucharest'
    };
  } catch {
    return { city: 'Bucharest', country: 'Romania', timezone: 'Europe/Bucharest' };
  }
}

async function getWeather(city) {
  if (!process.env.WEATHER_API_KEY) return null;
  try {
    const res = await fetch(
      https://api.openweathermap.org/data/2.5/weather?q=&appid=&units=metric
    );
    const data = await res.json();
    return {
      temp: Math.round(data.main.temp),
      description: data.weather[0].description
    };
  } catch {
    return null;
  }
}
