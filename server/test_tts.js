const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({path: './server/.env'});

async function test() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  console.log("Key length:", apiKey?.length);
  
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obbfDQGcgMyIGC/stream', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: 'Salutare, acesta este un test.',
      model_id: 'eleven_multilingual_v2',
      language_code: 'ro',
      voice_settings: { stability: 0.5, similarity_boost: 0.5 }
    })
  });
  
  console.log("Status:", r.status);
  if (!r.ok) {
    console.log("Error:", await r.text());
  } else {
    console.log("Success! Audio length:", (await r.arrayBuffer()).byteLength);
  }
}

test();
