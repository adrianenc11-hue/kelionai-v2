const fetch = require('node-fetch');
async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/admin/brain-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.ADMIN_SECRET_KEY || 'keliongodd' },
      body: JSON.stringify({ message: 'autoRepair app/js/fft-lipsync.js gura avatarului se deschide prea mult, valorile MAX_VISEME_AA si MAX_VISEME sunt prea mari', sessionId: 'test_local_' + Date.now() })
    });
    const d = await res.json();
    console.log('--- REZULTAT API LOCAL ---');
    console.log('Provider:', d.provider);
    console.log('Reply:\n' + d.reply);
  } catch(e) { console.error('Eroare:', e.message); }
}
run();
