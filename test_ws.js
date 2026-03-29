const io = require('socket.io-client');
console.log('⏳ Aștept ping de health de la noul deploy...');

async function checkHealth() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('https://kelionai.app/api/health');
      if (res.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 5000));
    console.log('... serverul inca booteaza, incerc din nou (' + i + '/20)');
  }
  return false;
}

async function run() {
  // await checkHealth();
  console.log('🔌 Conectare la Socket.io pentru a valida OPENAI_API_KEY...');

  const socket = io('wss://kelionai.app/live', {
    transports: ['websocket'],
    query: { avatar: 'kelion', language: 'ro' },
  });

  socket.on('connect', () => {
    console.log('✅ Socket conectat la /live');
  });

  socket.on('ready', (data) => {
    console.log('✅ [SUCCES!] Eveniment READY primit: Cheia OpenAI este preluată corect și Realtime API răspunde!');
    console.log(data);
    process.exit(0);
  });

  socket.on('error_msg', (err) => {
    console.error('❌ [EȘEC!] server/routes/live.js a returnat eroare (posibil cheie lipsă sau invalidă):');
    console.error(err);
    process.exit(1);
  });

  setTimeout(() => {
    console.error('⏳ Timeout: Niciun răspuns `ready` sau `error_msg` în 20 secunde.');
    process.exit(1);
  }, 20000);
}

run();
