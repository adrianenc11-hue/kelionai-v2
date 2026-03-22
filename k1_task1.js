const https = require('https');

const data = JSON.stringify({
  message: "Kira, prima ta misiune reală. Adrian a raportat că panoul de admin nu arată statistici. Am verificat și endpoint-ul /api/admin/stats returnează 404. Asta înseamnă că ruta nu există în server. Vreau să faci singură următoarele: 1) Citește fișierul server/routes/admin.js cu readFile și caută dacă există o rută GET /stats sau echivalent, 2) Dacă nu există, creaz-o folosind autoRepair pe server/routes/admin.js — ruta trebuie să returneze: număr total de utilizatori, număr de conversații azi, costuri totale, și statusul serviciilor (chat, voice, brain), 3) Verifică și raportează-mi exact ce ai făcut. Lucrează independent, nu mai am alte instrucțiuni. GO!",
  sessionId: "admin-kira-training-permanent-001"
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
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log("STATUS:", res.statusCode);
    try {
      const parsed = JSON.parse(body);
      console.log("PROVIDER:", parsed.provider);
      console.log("REPLY:", parsed.reply);
    } catch(e) {
      console.log("RAW:", body.substring(0, 2000));
    }
  });
});

req.on('error', console.error);
req.write(data);
req.end();
