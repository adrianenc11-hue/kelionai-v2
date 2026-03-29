const fs = require('fs');
const path = require('path');

const indexJsPath = path.join(__dirname, '..', 'server', 'index.js');
const indexContent = fs.readFileSync(indexJsPath, 'utf8');

const toRemoveKeys = [
  './payments',
  './legal',
  './languages',
  './referral',
  './routes/developer',
  './routes/contact',
  './routes/export',
  './routes/gmail',
  './routes/images',
  './routes/weather',
  './routes/search',
  './routes/translate',
  './routes/scan',
  './routes/multimodal',
  './browser-agent',
  './quick-wins',
  './ab-testing',
  './sprint2',
  './cluster',
  './test_memory_load',
  './chain-of-thought',
  './collaboration',
  './fine-tune-collector',
  "app.use('/api/search'",
  "app.use('/api/weather'",
  "app.use('/api/vision'",
  "app.use('/api/imagine'",
  "app.use('/api/mobile/v1'",
  '/api/payments/webhook',
  'const mobileApiRouter',
  'const exportRouter',
  'const translateRouter',
  'const scanRouter',
  'const contactRouter',
  'const quickWins',
  'const searchRouter',
  'const weatherRouter',
  'const visionRouter',
  'const imagesRouter',
];

const lines = indexContent.split('\n');
const modifiedLines = lines.filter((line) => !toRemoveKeys.some((key) => line.includes(key)));

fs.writeFileSync(indexJsPath, modifiedLines.join('\n'), 'utf8');
console.log('Cleaned server/index.js');

// Now clean package.json
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const depsToRemove = ['stripe', 'exceljs', 'pdf-parse', 'puppeteer', 'mammoth', 'nodemailer', 'form-data', 'redis'];

if (pkg.dependencies) {
  depsToRemove.forEach((d) => {
    if (pkg.dependencies[d]) delete pkg.dependencies[d];
  });
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('Cleaned package.json');
