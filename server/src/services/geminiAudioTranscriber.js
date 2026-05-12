'use strict';

async function transcribeAudioPtt(base64Data, mimeType) {
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) throw new Error('GOOGLE_API_KEY not configured.');

  // We use gemini-2.5-flash for fast transcription since 1.5 models are deprecated/removed
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: "Transcribe this audio EXACTLY as spoken in its original language. Output ONLY the transcription, without any extra text, tags, or markdown." },
          { inlineData: { mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini STT failed: ${response.status} ${err}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ? text.trim() : '';
}

module.exports = { transcribeAudioPtt };
