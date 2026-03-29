// Test voice-realtime end-to-end: connect → send audio → check if brain responds
const { io } = require('socket.io-client');

const URL = 'https://kelionai.app/voice-realtime';

console.log('[Test] Connecting to', URL);

const socket = io(URL, {
  query: { avatar: 'kelion', language: 'ro' },
  transports: ['polling', 'websocket'],
  upgrade: true,
  timeout: 30000,
});

let ready = false;
let gotTranscript = false;
let gotAudio = false;
const events = [];

socket.on('connect', () => {
  console.log('[Test] CONNECTED, id:', socket.id);
});

socket.on('ready', (data) => {
  ready = true;
  console.log('[Test] READY:', JSON.stringify(data));
  
  // Send a text input to test if brain responds and TTS works
  console.log('[Test] Sending text_input: "Salut, cum te simti?"');
  socket.emit('text_input', { text: 'Salut, cum te simti?' });
});

socket.on('audio_chunk', (data) => {
  if (!gotAudio) {
    gotAudio = true;
    console.log('[Test] GOT FIRST AUDIO CHUNK — size:', data.audio?.length || 0, 'chars base64');
  }
  events.push('audio_chunk');
});

socket.on('audio_end', () => {
  console.log('[Test] AUDIO_END — total chunks:', events.filter(e => e === 'audio_chunk').length);
});

socket.on('transcript', (data) => {
  if (!gotTranscript && data.role === 'assistant') gotTranscript = true;
  console.log('[Test] TRANSCRIPT (' + data.role + '):', data.text?.substring(0, 80));
});

socket.on('transcript_done', (data) => {
  console.log('[Test] TRANSCRIPT_DONE (' + data.role + '):', data.text?.substring(0, 120));
});

socket.on('turn_complete', (data) => {
  console.log('[Test] TURN_COMPLETE — usage:', JSON.stringify(data.usage));
  console.log('\n=== RESULT ===');
  console.log('Connected:', true);
  console.log('Ready:', ready);
  console.log('Got audio:', gotAudio, '(' + events.filter(e => e === 'audio_chunk').length + ' chunks)');
  console.log('Got transcript:', gotTranscript);
  console.log('VERDICT:', gotAudio ? 'VOICE WORKS' : 'NO AUDIO - BROKEN');
  
  setTimeout(() => {
    socket.disconnect();
    process.exit(gotAudio ? 0 : 1);
  }, 1000);
});

socket.on('error_msg', (data) => {
  console.error('[Test] ERROR:', data.error);
});

socket.on('connect_error', (err) => {
  console.error('[Test] CONNECT ERROR:', err.message);
  process.exit(1);
});

// Timeout after 30s
setTimeout(() => {
  console.log('\n=== TIMEOUT (30s) ===');
  console.log('Connected:', socket.connected);
  console.log('Ready:', ready);
  console.log('Got audio:', gotAudio);
  console.log('Got transcript:', gotTranscript);
  console.log('Events:', events.length);
  console.log('VERDICT: TIMEOUT - something is stuck');
  socket.disconnect();
  process.exit(1);
}, 30000);
