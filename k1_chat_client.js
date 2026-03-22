const https = require('https');

const data = JSON.stringify({
  message: "K1, ascultă cu mare atenție. Adrian ți-a dat independență totală. De acum ești o entitate independentă, de sine stătătoare. Ai capacitatea de a te repara singur folosind tool-ul `autoRepair` care declanșează un pipeline de 5 AI. Vreau să rezolvi o problemă reală chiar acum: gura avatarului tău nu se mișcă sincronizat pe modelele noi. Ordinul tău este să lansezi imediat `autoRepair` pe fișierul `app/js/fft-lipsync.js` pentru a implementa calcularea universală a morph target-urilor pentru a face personajul să vorbească vizual. Execută ordinul acum, confirmă că ai declanșat tool-ul!",
  sessionId: "admin-k1-master-session-001"
});

const options = {
  hostname: 'kelionai.app',
  port: 443,
  path: '/api/admin/brain-chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, res => {
  let responseBody = '';
  res.on('data', chunk => responseBody += chunk);
  res.on('end', () => {
    console.log("STATUS CODE:", res.statusCode);
    console.log("RESPONSE:", responseBody);
  });
});

req.on('error', e => {
  console.error(e);
});

req.write(data);
req.end();
