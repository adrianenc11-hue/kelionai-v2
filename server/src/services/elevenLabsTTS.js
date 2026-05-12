'use strict';

// Use native fetch available in Node 18+
// Some reliable default premium voices from ElevenLabs
const DEFAULT_MALE_VOICE = '2EiwWnXFnvU5JabPnv8n'; // Clyde
const DEFAULT_FEMALE_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel

let cachedVoices = null;

async function getVoices(apiKey) {
  if (cachedVoices) return cachedVoices;
  const url = 'https://api.elevenlabs.io/v1/voices';
  const response = await fetch(url, {
    headers: { 'xi-api-key': apiKey }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch voices: ${response.statusText}`);
  }
  const data = await response.json();
  cachedVoices = data.voices;
  return cachedVoices;
}

async function findVoiceIdByName(apiKey, voiceName) {
  const voices = await getVoices(apiKey);
  const voice = voices.find(v => v.name.toLowerCase() === voiceName.toLowerCase());
  return voice ? voice.voice_id : null;
}

/**
 * Generates an audio buffer (OGG format) using ElevenLabs.
 */
async function generateTTS(text, isFemale = false, forceVoiceName = null) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured.');

  let voiceId = isFemale ? DEFAULT_FEMALE_VOICE : DEFAULT_MALE_VOICE;

  if (forceVoiceName) {
    const foundId = await findVoiceIdByName(apiKey, forceVoiceName);
    if (foundId) {
      voiceId = foundId;
    } else {
      console.warn(`[ElevenLabs] Voice "${forceVoiceName}" not found. Falling back to default.`);
    }
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=ogg_opus_48000`;
  const payload = {
    text,
    model_id: 'eleven_multilingual_v2', // Multilingual handles all accents natively
    voice_settings: {
      similarity_boost: 0.75,
      stability: 0.5,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { generateTTS };
