const fs = require('fs');
const path = require('path');
const _ROOT = 'c:/Users/adria/\"/antigravity/scratch/kelionai-v2'.replace('/\"/g', '.gemini');

const files = [
  'scripts/pre-start-audit.js',
  'scripts/startup-lockdown.js',
  'scripts/remove-hardcoded-all.js',
  'server/routes/admin.js',
];

files.forEach((f) => {
  const p = path.join('c:/Users/adria/.gemini/antigravity/scratch/kelionai-v2', f);
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/kelionai\.app/gi, 'YOUR_DOMAIN');
    fs.writeFileSync(p, c);
    console.log('Cleaned ' + f);
  }
});
