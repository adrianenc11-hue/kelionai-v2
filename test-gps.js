const fetch = require('node-fetch');

async function simulateMobileGPS() {
  console.log('📡 Trimit semnal GPS simulat de pe "mobil" (București)...');

  try {
    const response = await fetch('http://localhost:3000/api/mobile/v1/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Parola secretă setată în backend:
        'x-mobile-secret': process.env.MOBILE_API_SECRET || 'kelion-mobile-dev-secret',
      },
      body: JSON.stringify({
        deviceId: 'TEST-IPHONE-15-PRO',
        lat: 44.4268, // Latitudine (București, Piața Unirii)
        lng: 26.1025, // Longitudine
        action: 'Scanner Code-Bare deschis',
        userId: 'Utilizator Kelion Mobil',
      }),
    });

    const data = await response.json();
    if (data.success) {
      console.log('✅ Semnalul GPS a fost primit de Master Server!');
      console.log('🗺️ Intră acum pe: http://localhost:3000/admin/live-users.html ca să vezi punctul pe hartă.');
    } else {
      console.error('❌ Eroare:', data);
    }
  } catch (err) {
    console.error('Eroare conexiune - Serverul Kelion node index.js e pornit pe portul 3000?');
  }
}

simulateMobileGPS();
