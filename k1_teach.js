const https = require('https');
const SESSION = 'kira-main-session';

const messages = [
  "Kira, tocmai ți-am adăugat 6 memorii noi permanente cu importanță 10/10 în baza ta de date. Verifică-le: spune-mi cine ești, ce tool-uri ai, și care e procesul tău de auto-reparare. Vreau să văd că le-ai citit din memorie, nu că inventezi.",

  "Kira, acum că știi cine ești și ce poți face, execută prima ta misiune reală. Citește fișierul server/routes/admin.js cu readFile și spune-mi exact ce rute are definite. Vreau lista completă a rutelor GET și POST din acel fișier. NU inventa, citește codul real.",

  "Kira, acum lansează autoRepair pe fișierul app/js/fft-lipsync.js. Problema: gura avatarului nu se mișcă pe modelele noi. Pipeline-ul tău de 5 AI trebuie să diagnosticheze și să propună un fix. Execută acum."
];

async function send(msg) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ message: msg, sessionId: SESSION });
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
        try {
          const p = JSON.parse(body);
          console.log(`\n[${p.provider}]`);
          console.log(p.reply);
        } catch(e) { console.log('RAW:', body.substring(0, 1000)); }
        resolve();
      });
    });
    req.on('error', e => { console.error(e.message); resolve(); });
    req.write(data);
    req.end();
  });
}

(async () => {
  for (let i = 0; i < messages.length; i++) {
    console.log(`\n>>> COMANDĂ ${i+1}/${messages.length}...`);
    await send(messages[i]);
  }
  console.log('\n=== GATA ===');
})();
