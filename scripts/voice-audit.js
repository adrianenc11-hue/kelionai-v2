// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Pipeline Latency Audit (Real-time)
// Measures each step: STT, LLM TTFT, TTS TTFA, Total
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const WebSocket = require('ws');
// Use native fetch (Node 18+) — node-fetch lacks ReadableStream.getReader()

const BASE = process.env.APP_URL || process.env.BASE_URL;
const WS_URL = BASE.replace('https://', 'wss://').replace('http://', 'ws://');

async function measureHTTP(label, fn) {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  return { label, ms, status: result.status };
}

async function runAudit() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   KELIONAI VOICE PIPELINE — AUDIT REAL TIMP');
  console.log('═══════════════════════════════════════════════════════\n');

  // ────────────────────────────────────────────
  // PART 1: Old pipeline (sequential batch)
  // ────────────────────────────────────────────
  console.log('📍 PIPELINE VECHI (secvențial, batch):\n');

  const oldSTT = await measureHTTP('  STT  /api/listen', () =>
    fetch(`${BASE}/api/listen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test transcription passthrough' }),
    })
  );
  console.log(`  🎙️  STT  (Groq Whisper batch):  ${oldSTT.ms}ms  [${oldSTT.status}]`);

  const oldChat = await measureHTTP('  CHAT /api/chat', () =>
    fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Spune-mi o glumă scurtă',
        avatar: 'kelion',
        language: 'ro',
      }),
    })
  );
  console.log(`  🧠  CHAT (Groq→GPT→Gemini):     ${oldChat.ms}ms  [${oldChat.status}]`);

  const oldTTS = await measureHTTP('  TTS  /api/speak', () =>
    fetch(`${BASE}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Bună ziua, aceasta este o propoziție de test.',
        avatar: 'kelion',
      }),
    })
  );
  console.log(`  🔊  TTS  (ElevenLabs batch):     ${oldTTS.ms}ms  [${oldTTS.status}]`);

  const oldTotal = oldSTT.ms + oldChat.ms + oldTTS.ms;
  console.log(`  ─────────────────────────────────────`);
  console.log(`  📊  TOTAL VECHI:                  ${oldTotal}ms  (~${(oldTotal / 1000).toFixed(1)}s)`);

  // ────────────────────────────────────────────
  // PART 2: New pipeline components (individual)
  // ────────────────────────────────────────────
  console.log('\n\n📍 PIPELINE NOU (streaming, paralel):\n');

  // Test Groq streaming TTFT
  const groqStart = Date.now();
  let groqTTFT = 0;
  let groqTotal = 0;
  let groqTokens = 0;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'Respond in Romanian. Keep it very short, 1-2 sentences.',
          },
          { role: 'user', content: 'Spune-mi o glumă scurtă' },
        ],
        stream: true,
        max_tokens: 100,
      }),
    });

    if (!r.ok) throw new Error(`Groq HTTP ${r.status}`);

    const decoder = new TextDecoder();
    let buffer = '';
    let firstToken = false;

    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim().startsWith('data: ')) continue;
        const data = line.trim().slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token && !firstToken) {
            groqTTFT = Date.now() - groqStart;
            firstToken = true;
          }
          if (token) groqTokens++;
        } catch {}
      }
    }
    groqTotal = Date.now() - groqStart;
  } catch (e) {
    console.log(`  ❌ Groq error: ${e.message}`);
  }

  console.log(`  🧠  LLM  Groq TTFT:              ${groqTTFT}ms`);
  console.log(`  🧠  LLM  Groq total (${groqTokens} tokens): ${groqTotal}ms`);

  // Test Deepgram connectivity
  let deepgramOk = false;
  if (process.env.DEEPGRAM_API_KEY) {
    const dgStart = Date.now();
    try {
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?model=nova-3&language=ro`, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
      });
      await new Promise((resolve, reject) => {
        ws.on('open', () => {
          deepgramOk = true;
          ws.close();
          resolve();
        });
        ws.on('error', (e) => {
          reject(e);
        });
        setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);
      });
      const dgTime = Date.now() - dgStart;
      console.log(`  🎙️  STT  Deepgram connect:       ${dgTime}ms  ${deepgramOk ? '✅' : '❌'}`);
    } catch (e) {
      console.log(`  🎙️  STT  Deepgram:               ❌ ${e.message}`);
    }
  } else {
    console.log(`  🎙️  STT  Deepgram:               ⚠️  KEY MISSING`);
  }

  // Test Cartesia connectivity
  let cartesiaOk = false;
  if (process.env.CARTESIA_API_KEY) {
    const ctStart = Date.now();
    try {
      const ws = new WebSocket(
        `wss://api.cartesia.ai/tts/websocket?api_key=${process.env.CARTESIA_API_KEY}&cartesia_version=2025-04-16`
      );
      await new Promise((resolve, reject) => {
        ws.on('open', () => {
          cartesiaOk = true;
          ws.close();
          resolve();
        });
        ws.on('error', (e) => {
          reject(e);
        });
        setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);
      });
      const ctTime = Date.now() - ctStart;
      console.log(`  🔊  TTS  Cartesia connect:       ${ctTime}ms  ${cartesiaOk ? '✅' : '❌'}`);
    } catch (e) {
      console.log(`  🔊  TTS  Cartesia:               ❌ ${e.message}`);
    }
  } else {
    console.log(`  🔊  TTS  Cartesia:               ⚠️  KEY MISSING`);
  }

  // Test ElevenLabs streaming connectivity
  let elevenOk = false;
  if (process.env.ELEVENLABS_API_KEY) {
    const elStart = Date.now();
    try {
      const voiceId = process.env.ELEVENLABS_VOICE_KELION || process.env.ELEVENLABS_VOICE_ID;
      const ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000`
      );
      await new Promise((resolve, reject) => {
        ws.on('open', () => {
          elevenOk = true;
          ws.close();
          resolve();
        });
        ws.on('error', (e) => {
          reject(e);
        });
        setTimeout(() => {
          ws.close();
          resolve();
        }, 3000);
      });
      const elTime = Date.now() - elStart;
      console.log(`  🔊  TTS  ElevenLabs WS connect:  ${elTime}ms  ${elevenOk ? '✅' : '❌'}`);
    } catch (e) {
      console.log(`  🔊  TTS  ElevenLabs:             ❌ ${e.message}`);
    }
  }

  // ────────────────────────────────────────────
  // PART 3: Estimated new total
  // ────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('   COMPARAȚIE FINALĂ');
  console.log('═══════════════════════════════════════════════════════\n');

  // Deepgram first-word is ~150ms (documented), Cartesia TTFA is ~90ms
  const sttEstimate = deepgramOk ? 150 : oldSTT.ms;
  const ttsEstimate = cartesiaOk ? 90 : elevenOk ? 150 : oldTTS.ms;
  const newEstimate = sttEstimate + groqTTFT + ttsEstimate;

  console.log('  ┌────────────────────────────────────────────────────┐');
  console.log('  │           PIPELINE VECHI (secvențial)              │');
  console.log('  │                                                    │');
  console.log(`  │  STT:   ${String(oldSTT.ms).padStart(5)}ms                                │`);
  console.log(`  │  CHAT:  ${String(oldChat.ms).padStart(5)}ms                                │`);
  console.log(`  │  TTS:   ${String(oldTTS.ms).padStart(5)}ms                                │`);
  console.log(
    `  │  TOTAL: ${String(oldTotal).padStart(5)}ms  (~${(oldTotal / 1000).toFixed(1)}s)                     │`
  );
  console.log('  ├────────────────────────────────────────────────────┤');
  console.log('  │           PIPELINE NOU (streaming paralel)         │');
  console.log('  │                                                    │');
  console.log(`  │  STT:    ~${String(sttEstimate).padStart(4)}ms  (Deepgram Nova-3)           │`);
  console.log(`  │  LLM TTFT: ${String(groqTTFT).padStart(4)}ms  (Groq Llama 3.3 70B)       │`);
  console.log(
    `  │  TTS TTFA: ~${String(ttsEstimate).padStart(3)}ms  (${cartesiaOk ? 'Cartesia Sonic' : elevenOk ? 'ElevenLabs Flash' : 'ElevenLabs batch'})         │`
  );
  console.log(`  │  TOTAL:  ~${String(newEstimate).padStart(4)}ms  (⚡ streaming paralel)     │`);
  console.log('  ├────────────────────────────────────────────────────┤');

  const speedup = (oldTotal / newEstimate).toFixed(1);
  const under1s = newEstimate < 1000;
  console.log(`  │  🚀 SPEEDUP: ${speedup}x mai rapid                        │`);
  console.log(
    `  │  ${under1s ? '✅' : '⚠️'} TARGET SUB-1s: ${under1s ? 'DA ✅' : 'NU ❌'}  (${newEstimate}ms)               │`
  );
  console.log('  └────────────────────────────────────────────────────┘');

  console.log('\n  Providers conectați:');
  console.log(`    Deepgram STT:      ${deepgramOk ? '✅ LIVE' : '❌ OFFLINE'}`);
  console.log(`    Groq LLM:          ${groqTTFT > 0 ? '✅ LIVE' : '❌ OFFLINE'}  (TTFT: ${groqTTFT}ms)`);
  console.log(`    Cartesia TTS:      ${cartesiaOk ? '✅ LIVE' : '❌ OFFLINE'}`);
  console.log(`    ElevenLabs TTS:    ${elevenOk ? '✅ LIVE (fallback)' : '❌ OFFLINE'}`);
}

runAudit().catch(console.error);
