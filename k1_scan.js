const https = require('https');

const data = JSON.stringify({
  message: "K1, acum ai o singură misiune: scanează tot codul din server/ și app/ și dă-mi o LISTĂ EXACTĂ cu fiecare fișier care are erori reale (nu warnings, ci erori care opresc funcționalitatea). Pentru fiecare eroare, spune: 1) fișierul exact, 2) linia exactă, 3) ce e stricat, 4) cum se repară. NU lansa autoRepair încă. Doar dă-mi lista completă ca să știu ce avem de reparat. Fii brutal de onest - nu ascunde nimic.",
  sessionId: "admin-k1-master-session-004"
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
