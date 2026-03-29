// Test voice-realtime with REAL audio (simulated speech PCM)
// Generates a 1-second tone to verify the audio pipeline works
const { io } = require('socket.io-client');

const URL = 'https://kelionai.app/voice-realtime';
const SAMPLE_RATE = 24000;

// Generate 2 seconds of a 440Hz sine wave (sounds like "aahhh")
function generateTone(durationSec, freq) {
  const samples = SAMPLE_RATE * durationSec;
  const int16 = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    // Add some variation to sound more speech-like
    const amplitude = 0.5 + 0.3 * Math.sin(2 * Math.PI * 3 * t); // amplitude modulation
    int16[i] = Math.round(amplitude * 16000 * Math.sin(2 * Math.PI * freq * t));
  }
  return int16;
}

console.log('[Test] Connecting to', URL);

const socket = io(URL, {
  query: { avatar: 'kelion', language: 'ro' },
  transports: ['polling', 'websocket'],
  upgrade: true,
  timeout: 30000,
});

let ready = false;
const events = [];

socket.on('connect', () => console.log('[Test] CONNECTED'));

socket.on('ready', (data) => {
  ready = true;
  console.log('[Test] READY —', data.engine);
  
  // Send audio tone in chunks (like browser does with ScriptProcessor 4096 samples)
  console.log('[Test] Sending 2s of audio PCM (440Hz tone)...');
  const tone = generateTone(2, 440);
  const CHUNK = 4096;
  let sent = 0;
  
  for (let offset = 0; offset < tone.length; offset += CHUNK) {
    const chunk = tone.slice(offset, offset + CHUNK);
    socket.emit('audio', Buffer.from(chunk.buffer));
    sent++;
  }
  console.log('[Test] Sent', sent, 'chunks of audio');
  
  // Wait 1s then send silence (to trigger VAD speech_stopped)
  setTimeout(() => {
    console.log('[Test] Sending 1.5s of silence...');
    const silence = new Int16Array(SAMPLE_RATE * 1.5); // all zeros
    for (let offset = 0; offset < silence.length; offset += CHUNK) {
      const chunk = silence.slice(offset, offset + CHUNK);
      socket.emit('audio', Buffer.from(chunk.buffer));
    }
    console.log('[Test] Silence sent — waiting for VAD + transcript...');
  }, 500);
});

socket.on('speech_started', () => {
  console.log('[Test] >>> SPEECH_STARTED detected by OpenAI VAD');
  events.push('speech_started');
});

socket.on('speech_stopped', () => {
  console.log('[Test] >>> SPEECH_STOPPED — waiting for transcript...');
  events.push('speech_stopped');
});

socket.on('transcript', (data) => {
  console.log('[Test] TRANSCRIPT (' + data.role + '):', data.text);
  events.push('transcript_' + data.role);
});

socket.on('transcript_done', (data) => {
  console.log('[Test] TRANSCRIPT_DONE (' + data.role + '):', data.text?.substring(0, 120));
});

socket.on('audio_chunk', () => events.push('audio_chunk'));
socket.on('audio_end', () => {
  console.log('[Test] AUDIO_END — got', events.filter(e => e === 'audio_chunk').length, 'audio chunks back');
});

socket.on('turn_complete', (data) => {
  console.log('[Test] TURN_COMPLETE');
  console.log('\n=== EVENTS ===');
  console.log('speech_started:', events.includes('speech_started'));
  console.log('speech_stopped:', events.includes('speech_stopped'));
  console.log('user transcript:', events.includes('transcript_user'));
  console.log('assistant transcript:', events.includes('transcript_assistant'));
  console.log('audio chunks:', events.filter(e => e === 'audio_chunk').length);
  
  setTimeout(() => { socket.disconnect(); process.exit(0); }, 1000);
});

socket.on('error_msg', (data) => {
  console.error('[Test] ERROR:', data.error);
});

socket.on('connect_error', (err) => {
  console.error('[Test] CONNECT ERROR:', err.message);
  process.exit(1);
});

// Timeout after 25s
setTimeout(() => {
  console.log('\n=== TIMEOUT (25s) ===');
  console.log('Connected:', socket.connected);
  console.log('Ready:', ready);
  console.log('Events:', JSON.stringify(events));
  console.log('speech_started received:', events.includes('speech_started'));
  console.log('speech_stopped received:', events.includes('speech_stopped'));
  if (!events.includes('speech_started')) {
    console.log('DIAGNOSIS: OpenAI VAD never detected speech from our audio');
    console.log('This means the audio format/content is not recognized as speech');
  } else if (!events.includes('transcript_user')) {
    console.log('DIAGNOSIS: OpenAI detected speech but never transcribed it');
  }
  socket.disconnect();
  process.exit(1);
}, 25000);
