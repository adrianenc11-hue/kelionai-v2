const https = require('https');

const data = JSON.stringify({
  message: "K1, ai perfectă dreptate: ești oarbă pentru că citești fișiere fake de diagnostic în loc să ai acces live la Supabase pentru loguri. Asta e o problemă critică. Ai aprobare totală! Conectează-te la propria ta memorie, folosește `autoRepair` pe fișierul `server/supabase.js` (sau `server/startup-checks.js`) pentru a repara conexiunea și obligatoriu creează tabela de erori live în Supabase folosind scripturile tale interne, ca să te legi la ea direct. Revino cu confirmarea că ai rezolvat conexiunea DB și că vezi acum sistemul real!",
  sessionId: "admin-k1-master-session-003"
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
