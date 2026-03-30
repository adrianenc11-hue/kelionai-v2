// Verificare completă a pipeline-ului KelionAI — toate interconectările
'use strict';
let pass = 0, fail = 0;

function check(name, condition, detail) {
  if (condition) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n═══ VERIFICARE PIPELINE KELIONAI ═══\n');

// 1. Config models
console.log('📦 config/models.js');
const { MODELS, API_ENDPOINTS, ORCHESTRATION_AGENTS } = require('../server/config/models');
check('OPENAI_CHAT = gpt-4o (chat live)', MODELS.OPENAI_CHAT === 'gpt-4o');
check('OPENAI_VISION = gpt-5.4 (doar viziune)', MODELS.OPENAI_VISION === 'gpt-5.4');
check('OPENAI_TTS = gpt-4o-mini-tts (primar)', MODELS.OPENAI_TTS === 'gpt-4o-mini-tts');
check('ELEVENLABS_MODEL definit', !!MODELS.ELEVENLABS_MODEL);
check('GPT_REALTIME definit', !!MODELS.GPT_REALTIME);
check('WHISPER STT definit', !!MODELS.WHISPER);
check('API_ENDPOINTS.OPENAI setat', !!API_ENDPOINTS.OPENAI);
check('API_ENDPOINTS.ELEVENLABS setat', !!API_ENDPOINTS.ELEVENLABS);
check('API_ENDPOINTS.OPENAI_REALTIME setat', !!API_ENDPOINTS.OPENAI_REALTIME);
check('Orchestration agents >= 15', Object.keys(ORCHESTRATION_AGENTS).length >= 15);

// 2. Brain.js — verificare structură
console.log('\n🧠 brain.js');
const { KelionBrain } = require('../server/brain');
const brain = new KelionBrain();
check('KelionBrain se instanțiază', !!brain);
check('brain.think() există', typeof brain.think === 'function');
check('brain.saveMemory() există', typeof brain.saveMemory === 'function');
check('brain.learnFromConversation() există', typeof brain.learnFromConversation === 'function');
check('brain.extractAndSaveFacts() există', typeof brain.extractAndSaveFacts === 'function');
check('brain.loadAllMemory() există', typeof brain.loadAllMemory === 'function');
check('brain.getDiagnostics() există', typeof brain.getDiagnostics === 'function');
check('brain._logCost() există', typeof brain._logCost === 'function');

// 3. Voice.js — verificare structură TTS
console.log('\n🔊 voice.js — Pipeline TTS');
const voiceSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'routes', 'voice.js'), 'utf-8');
check('ttsEngine default = OpenAI', voiceSrc.includes("let ttsEngine = 'OpenAI'"));
check('ElevenLabs DOAR clonare (cloned_voices query)', voiceSrc.includes("from('cloned_voices')") && voiceSrc.includes("eq('is_active', true)"));
check('ElevenLabs NU mai e primar (fără langVoices fallback)', !voiceSrc.includes('langVoices'));
check('ElevenLabs-Clone ca engine', voiceSrc.includes("ttsEngine = 'ElevenLabs-Clone'"));
check('OpenAI TTS = TRY 1 (PRIMAR)', voiceSrc.includes('TRY 1: OpenAI TTS'));
check('Google Cloud = TRY 2 (FALLBACK)', voiceSrc.includes('TRY 2: Google Cloud TTS'));
check('Ordinea corectă: Clone → OpenAI → Google', 
  voiceSrc.indexOf('TRY 0') < voiceSrc.indexOf('TRY 1') && 
  voiceSrc.indexOf('TRY 1') < voiceSrc.indexOf('TRY 2'));
check('Lip sync alignment păstrat', voiceSrc.includes('alignment') && voiceSrc.includes('character_start_times_seconds'));

// 4. Chat.js — fallback corect
console.log('\n💬 chat.js');
const chatSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'routes', 'chat.js'), 'utf-8');
check('Emergency fallback = gpt4o (nu gpt54)', chatSrc.includes("engine: 'gpt4o-emergency'"));
check('Brain.think() integrat', chatSrc.includes('brain.think('));
check('imageBase64 suportat în chat', chatSrc.includes('imageBase64'));
check('Safety classifier activ', chatSrc.includes('safetyClassifier'));
check('Identity guard activ', chatSrc.includes('identityGuard'));

// 5. Voice-realtime.js — camera + brain
console.log('\n🎙️ voice-realtime.js — Cameră + Brain');
const vrSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'routes', 'voice-realtime.js'), 'utf-8');
check('latestCameraFrame variabilă', vrSrc.includes('latestCameraFrame'));
check('socket camera_frame handler', vrSrc.includes("socket.on('camera_frame'"));
check('brain.think() primește imageBase64', vrSrc.includes('imageBase64: latestCameraFrame'));
check('isAutoCamera flag trimis', vrSrc.includes('isAutoCamera: !!latestCameraFrame'));
check('brain.think() apelat la transcript', vrSrc.includes('brain') && vrSrc.includes('.think(userText'));
check('brain.think() apelat la text_input', vrSrc.includes("socket.on('text_input'") && vrSrc.includes('brain'));
check('Realtime TTS injection (response.create)', vrSrc.includes("type: 'response.create'"));
check('Conversație salvată în Supabase', vrSrc.includes("from('conversations')") && vrSrc.includes("from('messages')"));
check('Brain learning la response.done', vrSrc.includes('learnFromConversation') && vrSrc.includes('extractAndSaveFacts'));

// 6. Voice-realtime-client.js — cameră client
console.log('\n📷 voice-realtime-client.js — Cameră Client');
const vrcSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'voice-realtime-client.js'), 'utf-8');
check('cameraInterval variabilă', vrcSrc.includes('cameraInterval'));
check('_startCameraCapture() funcție', vrcSrc.includes('function _startCameraCapture'));
check('_stopCameraCapture() funcție', vrcSrc.includes('function _stopCameraCapture'));
check('Capturează din KAutoCamera', vrcSrc.includes('KAutoCamera.captureFrame'));
check('Emite camera_frame la server', vrcSrc.includes("socket.emit('camera_frame'"));
check('Camera pornește la ready', vrcSrc.includes('_startCameraCapture()'));
check('Camera se oprește la disconnect', vrcSrc.includes('_stopCameraCapture()'));
check('Lip sync FFT conectat', vrcSrc.includes('getLipSync') && vrcSrc.includes('connectToContext'));

// 7. Auto-camera.js — captură disponibilă
console.log('\n📸 auto-camera.js');
const acSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'auto-camera.js'), 'utf-8');
check('captureFrame() exportat', acSrc.includes('captureFrame'));
check('isActive() exportat', acSrc.includes('isActive'));
check('Face tracking disponibil', acSrc.includes('trackFace') && acSrc.includes('FaceDetector'));
check('KAutoCamera global', acSrc.includes('window.KAutoCamera'));

// REZULTAT
console.log('\n═══════════════════════════════════════');
console.log('  REZULTAT: ' + pass + ' OK / ' + fail + ' EȘUATE');
console.log('═══════════════════════════════════════\n');
if (fail > 0) process.exit(1);
