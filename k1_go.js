const https = require('https');
const data = JSON.stringify({
  message: "Kira, lansează autoRepair pe app/js/fft-lipsync.js — gura avatarului nu se mișcă pe modelele noi. Repară-l acum.",
  sessionId: "kira-main-session"
});
const options = {
  hostname: 'kelionai.app', port: 443,
  path: '/api/admin/brain-chat', method: 'POST',
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
      const p = JSON.parse(body);
      console.log("PROVIDER:", p.provider);
      console.log("REPLY:", p.reply);
    } catch(e) { console.log("RAW:", body.substring(0, 2000)); }
  });
});
req.on('error', console.error);
req.write(data);
req.end();
