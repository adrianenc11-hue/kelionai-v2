const fetch = require('node-fetch');
const BASE = process.env.APP_URL || process.env.BASE_URL;

/**
 * measure
 * @param {*} label
 * @param {*} fn
 * @returns {*}
 */
async function measure(label, fn) {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  return { ms, status: result.status };
}

(async () => {
  // 1. STT (Speech-to-Text) — /api/listen
  const stt = await measure('1. STT  /api/listen', () =>
    fetch(`${BASE}/api/listen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Aceasta este o propozitie de test' }),
    })
  );

  // 2. Chat (AI reply) — /api/chat
  const chat = await measure('2. CHAT /api/chat', () =>
    fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Salut, ce faci?',
        avatar: 'kelion',
        language: 'ro',
      }),
    })
  );

  // 3. TTS (Text-to-Speech) — /api/speak
  const tts = await measure('3. TTS  /api/speak', () =>
    fetch(`${BASE}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Buna ziua, ma bucur sa te vad!',
        avatar: 'kelion',
      }),
    })
  );

  // 4. Chat Stream — /api/chat/stream (time to first byte)
  const streamStart = Date.now();
  const streamR = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message: 'Spune-mi o gluma scurta',
      avatar: 'kelion',
      language: 'ro',
    }),
  });
  const ttfb = Date.now() - streamStart;

  const total = stt.ms + chat.ms + tts.ms;
  console.log(`  CHAT: ${chat.ms}ms (${((chat.ms / total) * 100).toFixed(0)}%)`);
  console.log(
    `\n=== BOTTLENECK: ${chat.ms > tts.ms ? (chat.ms > stt.ms ? 'CHAT' : 'STT') : tts.ms > stt.ms ? 'TTS' : 'STT'} ===`
  );
})();
