const https = require('https');

const data = JSON.stringify({
  message: "K1, ascultă comanda supremă: Adrian vrea SUNET în acest chat de admin ca să audă când îi răspunzi. Fără sunet nu ne crede. Ordinul tău imediat: Folosește `autoRepair` pe fișierul `app/admin/brain-chat.html`. Trebuie să modifici funcția `addMessage` sau `sendMessage` astfel încât atunci când tu (Brain) răspunzi, să apelezi automat endpoint-ul nostru de voce (ex: fetch `/api/voice` sau echivalentul tău existent) și să redai audio-ul răspunsului tău direct în pagină folosind new Audio(). Joacă și tu rolul de developer, scrie codul, testează-l și dă-i deploy!",
  sessionId: "admin-k1-master-session-002"
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
