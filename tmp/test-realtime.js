// Quick test of /voice-realtime Socket.io namespace
const { io } = require('socket.io-client');

const socket = io('https://kelionai.app/voice-realtime', {
  query: { avatar: 'kelion', language: 'ro' },
  transports: ['polling', 'websocket'],
  upgrade: true,
  timeout: 15000,
});

socket.on('connect', () => console.log('CONNECTED, id:', socket.id));
socket.on('ready', (d) => console.log('READY:', JSON.stringify(d)));
socket.on('error_msg', (d) => console.log('ERROR_MSG:', JSON.stringify(d)));
socket.on('connect_error', (e) => console.log('CONNECT_ERROR:', e.message));
socket.on('disconnect', (r) => console.log('DISCONNECT:', r));
socket.on('disconnected', () => console.log('SERVER_DISCONNECTED'));
socket.on('transcript', (d) => console.log('TRANSCRIPT:', JSON.stringify(d)));
socket.on('audio_chunk', () => console.log('AUDIO_CHUNK received'));
socket.on('audio_end', () => console.log('AUDIO_END'));
socket.on('turn_complete', (d) => console.log('TURN_COMPLETE:', JSON.stringify(d)));

setTimeout(() => {
  console.log('\n--- Status after 12s ---');
  console.log('Connected:', socket.connected);
  socket.disconnect();
  process.exit(0);
}, 12000);
