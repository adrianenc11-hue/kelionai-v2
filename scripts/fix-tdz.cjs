const fs = require('fs');
const f = 'src/pages/KelionStage.jsx';
let code = fs.readFileSync(f, 'utf8');

// Find sendTextMessage function
const fnStart = code.indexOf('const sendTextMessage = useCallback(async ()');
if (fnStart < 0) { console.log('ERROR: sendTextMessage not found'); process.exit(1); }

// Find its deps - search for "liveSendText])" after fnStart  
const depsStr = 'liveSendText])';
const depsIdx = code.indexOf(depsStr, fnStart);
if (depsIdx < 0) { console.log('ERROR: deps not found'); process.exit(1); }
const blockEnd = depsIdx + depsStr.length;

// Find comment block start (look for lines starting with // before the function)
let blockStart = fnStart;
const before = code.substring(Math.max(0, fnStart - 300), fnStart);
const lines = before.split('\n');
// Walk backwards from end to find comment lines
let commentLines = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].trim().startsWith('//') || lines[i].trim() === '') {
    commentLines++;
  } else {
    break;
  }
}
if (commentLines > 0) {
  const offset = lines.slice(lines.length - commentLines).join('\n').length + 1;
  blockStart = fnStart - offset;
}

const fnBlock = code.substring(blockStart, blockEnd);
console.log('Block size:', fnBlock.length, 'chars');
console.log('First 80:', fnBlock.substring(0, 80));

// Remove from current position
code = code.substring(0, blockStart) + code.substring(blockEnd);

// Insert after "} = liveHook"
const insertMarker = '} = liveHook';
const insertIdx = code.indexOf(insertMarker);
if (insertIdx < 0) { console.log('ERROR: liveHook not found'); process.exit(1); }

const eolIdx = code.indexOf('\n', insertIdx);
code = code.substring(0, eolIdx + 1) + '\n' + fnBlock + '\n' + code.substring(eolIdx + 1);

fs.writeFileSync(f, code, 'utf8');
console.log('DONE: sendTextMessage moved after liveHook.');
