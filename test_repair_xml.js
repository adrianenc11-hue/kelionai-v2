require('dotenv').config();
const { autoRepairPipeline } = require('./server/routes/brain-chat.js');
async function test() {
   const res = await autoRepairPipeline('autoRepair app/js/fft-lipsync.js repara', 'app/js/fft-lipsync.js');
   console.log(res);
}
test();
