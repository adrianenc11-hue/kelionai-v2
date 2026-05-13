const fs = require('fs');

try {
  const data = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  fs.writeFileSync('package.json', JSON.stringify(data, null, 2));
  console.log('package.json cleaned and rewritten successfully.');
} catch (e) {
  console.error('Error parsing package.json:', e);
  process.exit(1);
}
