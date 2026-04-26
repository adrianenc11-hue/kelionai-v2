const fs = require('fs');
const f = 'src/pages/KelionStage.jsx';
let code = fs.readFileSync(f, 'utf8');

// Find and gut the TTS useEffect
// Pattern: find "chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])"
const depsStr = 'chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])';
const depsIdx = code.indexOf(depsStr);
if (depsIdx < 0) { console.log('ERROR: TTS deps not found'); process.exit(1); }

// Find the useEffect that owns these deps — search backwards for "useEffect("
const searchArea = code.substring(Math.max(0, depsIdx - 6000), depsIdx);
const lastIdx = searchArea.lastIndexOf('useEffect(');
if (lastIdx < 0) { console.log('ERROR: useEffect not found'); process.exit(1); }

const globalStart = Math.max(0, depsIdx - 6000) + lastIdx;
const globalEnd = depsIdx + depsStr.length;

console.log(`Removing TTS useEffect: chars ${globalStart}-${globalEnd} (${globalEnd - globalStart} chars)`);

const replacement = `useEffect(() => {
    // PHYSICALLY REMOVED: TTS (/api/tts + speechSynthesis).
    // Voice comes ONLY from Canal B (Gemini Live WebSocket).
  }, [${depsStr}`;

code = code.substring(0, globalStart) + replacement + code.substring(globalEnd);

fs.writeFileSync(f, code, 'utf8');
console.log('TTS useEffect physically removed. File saved.');
