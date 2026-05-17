const fs = require('fs');
const path = require('path');

const rootDist = path.resolve(__dirname, '..', 'dist');
const serverDist = path.resolve(__dirname, '..', 'server', 'dist');

if (!fs.existsSync(rootDist)) {
  console.error(`[build:server-dist] Missing root dist at ${rootDist}. Run npm run build first.`);
  process.exit(1);
}

fs.rmSync(serverDist, { recursive: true, force: true });
fs.mkdirSync(serverDist, { recursive: true });
fs.cpSync(rootDist, serverDist, { recursive: true });
console.log(`[build:server-dist] Copied ${rootDist} -> ${serverDist}`);
