#!/usr/bin/env node
/**
 * Purge all AI channels except Canal B (geminiLive.js WebSocket).
 * 
 * Changes:
 * 1. geminiLive.js — add sendText() function + export
 * 2. KelionStage.jsx — replace sendTextMessage with WS wrapper, remove TTS useEffect body
 * 3. chat.js — disable the AI route (return 410)
 */
const fs = require('fs');
const path = require('path');

// ─── 1. geminiLive.js: add sendText ─────────────────────────────────────
const livePath = path.join(__dirname, '..', 'src', 'lib', 'geminiLive.js');
let live = fs.readFileSync(livePath, 'utf8');

// Add sendText function before the return statement
const returnBlock = `  return {
    status, error, start, stop, turns, userLevel,`;

const sendTextFn = `  // sendText — inject typed text into the live WebSocket as a user turn.
  // Replaces /api/chat so ALL communication uses Canal B.
  const sendText = useCallback(async (text) => {
    if (!text || typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed) return
    appendTurn('user', trimmed, true)
    lastActivityAtRef.current = Date.now()
    // Auto-start session if not connected.
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await start()
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) break
        await new Promise(r => setTimeout(r, 200))
      }
    }
    const activeWs = wsRef.current
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: trimmed }] }],
          turnComplete: true,
        },
      }))
      setStatus('thinking')
    }
  }, [appendTurn, start])

`;

if (!live.includes('sendText')) {
  live = live.replace(returnBlock, sendTextFn + returnBlock);
  // Add sendText to the return object
  live = live.replace(
    '    setMuted,\n  }\n}',
    '    setMuted,\n    sendText,\n  }\n}'
  );
  fs.writeFileSync(livePath, live, 'utf8');
  console.log('[1/3] geminiLive.js: sendText added');
} else {
  console.log('[1/3] geminiLive.js: sendText already exists, skipping');
}

// ─── 2. KelionStage.jsx ─────────────────────────────────────────────────
const stagePath = path.join(__dirname, '..', 'src', 'pages', 'KelionStage.jsx');
let stage = fs.readFileSync(stagePath, 'utf8');

// 2a. Add sendText to liveHook destructure
if (!stage.includes('liveSendText')) {
  stage = stage.replace(
    /trial: voiceTrial,\n\s*\} = liveHook/,
    'trial: voiceTrial,\n    sendText: liveSendText,\n  } = liveHook'
  );
  console.log('[2a] Added liveSendText to destructure');
}

// 2b. Replace sendTextMessage with WebSocket wrapper
// Find the function: starts with "const sendTextMessage = useCallback(async () => {"
// ends with the closing "}, [chatInput, chatBusy, chatMessages, attachedFile])"
const sendTextStart = stage.indexOf('const sendTextMessage = useCallback(async ()');
if (sendTextStart !== -1) {
  // Find the matching end — look for the deps array pattern
  const depsPatterns = [
    '], [chatInput, chatBusy, chatMessages, attachedFile])',
    '], [chatInput, chatBusy, chatMessages, attachedFile, authTokenRef])',
  ];
  let sendTextEnd = -1;
  for (const dp of depsPatterns) {
    const idx = stage.indexOf(dp, sendTextStart);
    if (idx !== -1) {
      sendTextEnd = idx + dp.length;
      break;
    }
  }
  if (sendTextEnd !== -1) {
    const replacement = `const sendTextMessage = useCallback(async () => {
    const text = chatInput.trim()
    if (!text) return
    applyMuteCommand(text)
    setChatError(null)
    setChatInput('')
    setAttachedFile(null)
    await liveSendText(text)
  }, [chatInput, liveSendText])`;
    stage = stage.substring(0, sendTextStart) + replacement + stage.substring(sendTextEnd);
    console.log('[2b] Replaced sendTextMessage with WebSocket wrapper');
  } else {
    console.log('[2b] WARNING: Could not find sendTextMessage end');
  }
}

// 2c. Remove TTS useEffect body (replace with no-op)
// Find: useEffect(() => {\n    if (chatBusy) return
// Through: }, [chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])
const ttsEffectDeps = '}, [chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])';
const ttsEffectDepsIdx = stage.indexOf(ttsEffectDeps);
if (ttsEffectDepsIdx !== -1) {
  // Search backwards from the deps to find the useEffect start
  const searchArea = stage.substring(Math.max(0, ttsEffectDepsIdx - 5000), ttsEffectDepsIdx);
  // Find the last "useEffect(() => {" before the deps
  let lastUseEffect = -1;
  let searchIdx = 0;
  while (true) {
    const idx = searchArea.indexOf('useEffect(() => {', searchIdx);
    if (idx === -1) break;
    lastUseEffect = idx;
    searchIdx = idx + 1;
  }
  if (lastUseEffect !== -1) {
    const globalStart = Math.max(0, ttsEffectDepsIdx - 5000) + lastUseEffect;
    const globalEnd = ttsEffectDepsIdx + ttsEffectDeps.length;
    const replacement = `useEffect(() => {
    // REMOVED: TTS (/api/tts + speechSynthesis) — voice is Canal B only.
  }, [chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])`;
    stage = stage.substring(0, globalStart) + replacement + stage.substring(globalEnd);
    console.log('[2c] Removed TTS useEffect body');
  } else {
    console.log('[2c] WARNING: Could not find TTS useEffect start');
  }
}

fs.writeFileSync(stagePath, stage, 'utf8');
console.log('[2/3] KelionStage.jsx: done');

// ─── 3. chat.js: disable AI route ──────────────────────────────────────
const chatPath = path.join(__dirname, '..', 'server', 'src', 'routes', 'chat.js');
let chat = fs.readFileSync(chatPath, 'utf8');

// Add early return at the start of the POST handler
if (!chat.includes('SUSPENDED: Canal B only')) {
  chat = chat.replace(
    "router.post('/', requireCsrf,",
    "// SUSPENDED: all AI now goes through Canal B (WebSocket live).\nrouter.post('/', requireCsrf, (_req, res) => res.status(410).json({ error: 'Chat API suspended. Use voice.' }),\n(_req, _res) => { /* original handler below — unreachable */ },\nrequireCsrf &&"
  );
  // Simpler approach: just add a guard at the top of the handler
  // Actually, let me just add a return at the start of the async handler
  // Revert the above and do it differently
  chat = fs.readFileSync(chatPath, 'utf8'); // re-read
  
  // Find "async (req, res) =>" after the POST route and add early return
  const postIdx = chat.indexOf("router.post('/',");
  if (postIdx !== -1) {
    // Find the first "try {" after the POST route (that's where the AI logic starts)
    const tryIdx = chat.indexOf('try {', postIdx);
    if (tryIdx !== -1) {
      chat = chat.substring(0, tryIdx) + 
        '// SUSPENDED: Canal B only. Chat AI disabled.\n    return res.status(410).json({ error: "Chat suspended. Use voice (Canal B)." });\n    ' + 
        chat.substring(tryIdx);
      fs.writeFileSync(chatPath, chat, 'utf8');
      console.log('[3/3] chat.js: AI route disabled with 410');
    }
  }
} else {
  console.log('[3/3] chat.js: already suspended');
}

console.log('\nDone! All other AI channels physically removed/disabled.');
console.log('Only Canal B (geminiLive.js WebSocket) remains active.');
