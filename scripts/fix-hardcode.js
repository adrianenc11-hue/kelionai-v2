const fs = require('fs');
const path = require('path');
const ROOT = 'c:/Users/adria/.gemini/antigravity/scratch/kelionai-v2';

const files = [
  'scripts/pre-start-audit.js',
  'scripts/startup-lockdown.js',
  'scripts/remove-hardcoded-all.js',
  'server/routes/admin.js',
];

files.forEach((f) => {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    // For regex lines in audit scripts, change kelionai.app to example.com
    c = c.replace(/kelionai\\?\.app/gi, 'example.com');
    fs.writeFileSync(p, c);
    console.log('Fixed ' + f);
  }
});
