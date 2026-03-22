const fetch = require('node-fetch');
async function run() {
  try {
    const res = await fetch('https://kelionai.app/api/admin/brain-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d' },
      body: JSON.stringify({ message: 'autoRepair app/js/fft-lipsync.js gura avatarului se deschide prea mult, valorile MAX_VISEME_AA si MAX_VISEME sunt prea mari', sessionId: 'test_deploy_v5_' + Date.now() })
    });
    const d = await res.json();
    console.log('Provider la fetch LIVE:', d.provider || d.engine);
    if ((d.provider || d.engine) === 'AutoRepair-Pipeline') {
       console.log('SUCCESS! INTERCEPT WORKED!');
    } else {
       console.log('NOT YET DEPLOYED OR FAILED. Tag:', d.provider || d.engine);
       console.log('REPLY:', d.reply?.substring(0, 100));
    }
  } catch(e) { console.error('Eroare fetch:', e.message); }
}
run();
