require('dotenv').config();
const fs = require('fs');
const content = fs.readFileSync('server/routes/brain-chat.js', 'utf8');
const exportLine = 'module.exports.autoRepairPipeline = autoRepairPipeline;';
if (!content.includes(exportLine)) {
  fs.writeFileSync('server/routes/brain-chat.js', content + '\n' + exportLine);
}
const chat = require('./server/routes/brain-chat.js');
chat.autoRepairPipeline('gura avatarului se deschide prea mult, valorile MAX_VISEME_AA si MAX_VISEME sunt prea mari', 'app/js/fft-lipsync.js').then(res => {
  console.log('--- REZULTAT ---');
  console.log(res);
  console.log('--- END ---');
  fs.writeFileSync('server/routes/brain-chat.js', content); // restore
}).catch(console.error);
