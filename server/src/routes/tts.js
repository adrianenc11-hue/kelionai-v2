'use strict';

const { Router } = require('express');
const router = Router();

const ELEVENLABS_URL          = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVENLABS_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam

const GEMINI_TTS_BASE        = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_GEMINI_VOICE     = 'Kore';

// Gemini TTS returns raw PCM (24kHz, 16-bit, mono). Wrap in a WAV container
// so browsers can play it directly from <audio src>.
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate   = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize   = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);               // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function synthesizeGemini(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_TTS_MODEL;
  const voice  = process.env.GEMINI_TTS_VOICE_KELION || DEFAULT_GEMINI_VOICE;

  const url = `${GEMINI_TTS_BASE}/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini TTS error: ${r.status} ${err}`);
  }

  const data = await r.json();
  const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error('Gemini TTS returned no audio data');
  return pcmToWav(Buffer.from(b64, 'base64'));
}

async function synthesizeElevenLabs(text) {
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE;
  const r = await fetch(`${ELEVENLABS_URL}/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`ElevenLabs error: ${r.status} ${err}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'Text is required and must be under 2000 characters' });
  }

  const hasGemini     = !!process.env.GEMINI_API_KEY;
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
  if (!hasGemini && !hasElevenLabs) {
    return res.status(503).json({ error: 'TTS not configured. Set GEMINI_API_KEY or ELEVENLABS_API_KEY.' });
  }

  try {
    if (hasGemini) {
      const wav = await synthesizeGemini(text);
      res.set({ 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      return res.send(wav);
    }
    const mp3 = await synthesizeElevenLabs(text);
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length });
    res.send(mp3);
  } catch (err) {
    console.error('[tts] Error:', err.message);
    res.status(500).json({ error: 'Voice synthesis failed' });
  }
});

module.exports = router;
