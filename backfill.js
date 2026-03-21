require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function geoIp(ip) {
  try {
    const r = await fetch('https://api.country.is/' + ip);
    if (!r.ok) return null;
    const d = await r.json();
    return d.country || null;
  } catch (e) { return null; }
}

async function backfill() {
  console.log('Fetching null countries from page_views...');
  const { data: pvs } = await supabaseAdmin.from('page_views').select('id, ip').is('country', null).limit(200);
  if (pvs) {
    for (const v of pvs) {
      if (v.ip === '127.0.0.1' || v.ip.includes(':')) continue;
      const country = await geoIp(v.ip);
      if (country) {
        await supabaseAdmin.from('page_views').update({ country }).eq('id', v.id);
        console.log('page_views IP ' + v.ip + ' -> ' + country);
      }
    }
  }

  console.log('Fetching null countries from visitors...');
  const { data: vis } = await supabaseAdmin.from('visitors').select('id, ip').is('country', null).limit(100);
  if (vis) {
    for (const v of vis) {
      if (v.ip === '127.0.0.1' || v.ip.includes(':')) continue;
      const country = await geoIp(v.ip);
      if (country) {
        await supabaseAdmin.from('visitors').update({ country }).eq('id', v.id);
        console.log('visitors IP ' + v.ip + ' -> ' + country);
      }
    }
  }
  console.log('Backfill complete.');
}
backfill();
