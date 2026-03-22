const fetch = require('node-fetch');
async function run() {
  try {
    const res = await fetch('https://kelionai.app/api/admin/brain-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.ADMIN_SECRET_KEY || 'keliongodd' },
      body: JSON.stringify({ message: 'autoRepair app/js/fft-lipsync.js gura avatarului se deschide prea mult si ciudat', sessionId: 'test_deploy_' + Date.now() })
    });
    const d = await res.json();
    console.log('Provider la fetch LIVE:', d.provider);
  } catch(e) { console.error(e.message); }
}
run();
