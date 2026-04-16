import google from '@google-cloud/text-to-speech';

let client;
try {
  client = new google.TextToSpeechClient();
} catch {
  console.log('TTS not configured');
}

const VOICES = {
  kelion: {
    ro: 'ro-RO-Wavenet-A',
    en: 'en-US-Wavenet-D',
    de: 'de-DE-Wavenet-A',
    fr: 'fr-FR-Wavenet-B',
    es: 'es-ES-Wavenet-B'
  },
  kira: {
    ro: 'ro-RO-Wavenet-B',
    en: 'en-US-Wavenet-F',
    de: 'de-DE-Wavenet-C',
    fr: 'fr-FR-Wavenet-D',
    es: 'es-ES-Wavenet-C'
  }
};

export async function synthesizeSpeech(text, avatar = 'kelion', lang = 'en') {
  if (!client) throw new Error('TTS not configured');

  const voiceName = VOICES[avatar]?.[lang] || VOICES.kelion[lang] || 'en-US-Wavenet-D';

  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: lang, name: voiceName },
    audioConfig: { audioEncoding: 'MP3' }
  });

  return response.audioContent;
}
