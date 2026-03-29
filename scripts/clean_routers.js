const fs = require('fs');
const content = fs.readFileSync('server/index.js', 'utf8');
const lines = content.split('\n');

const missing = [
  'referralRouter',
  'paymentsRouter',
  'legalRouter',
  'getLanguagesPayload',
  'developerRouter',
  'adminApiRouter',
  'mobileApiRouter',
  'exportRouter',
  'translateRouter',
  'scanRouter',
  'contactRouter',
  'quickWins',
  'searchRouter',
  'weatherRouter',
  'visionRouter',
  'imagesRouter',
  'multimodalRouter',
];

const res = lines.filter((line) => {
  if (missing.some((m) => line.includes(m))) {
    // if it's app.use or app.get we remove it
    if (
      line.includes('app.use(') ||
      line.includes('app.get(') ||
      line.includes('app.post(') ||
      line.includes('app.delete(')
    ) {
      return false;
    }
  }
  return true;
});

fs.writeFileSync('server/index.js', res.join('\n'), 'utf8');
console.log('Cleaned undefined routers');
