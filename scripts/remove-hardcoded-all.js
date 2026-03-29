const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      results.push(file);
    }
  });
  return results;
}

const dirs = ['app', 'config', 'server', 'scripts'];
for (const d of dirs) {
  const walkPath = path.join(__dirname, '..', d);
  const files = walk(walkPath);
  for (const f of files) {
    if (f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.json')) {
      const content = fs.readFileSync(f, 'utf8');
      if (content.match(/kelionai\.app/i)) {
        const newContent = content.replace(/kelionai\.app/gi, 'domeniul-tau.app');
        fs.writeFileSync(f, newContent, 'utf8');
        console.log('Replaced in ' + f);
      }
    }
  }
}
