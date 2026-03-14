const fs = require('fs');

// Extract only the critical sections
const fftUpdate = fs.readFileSync('app/js/fft-lipsync.js', 'utf8')
    .split('\n').slice(41, 55).join('\n');

const alignParams = fs.readFileSync('app/js/alignment-lipsync.js', 'utf8')
    .split('\n').slice(12, 22).join('\n');

const voiceChunk = fs.readFileSync('app/js/voice.js', 'utf8')
    .split('\n').slice(163, 185).join('\n');

const avatarDecay = fs.readFileSync('app/js/avatar.js', 'utf8')
    .split('\n').slice(868, 878).join('\n');

const prompt = `Analizeaza acest cod de lip-sync (Three.js + MetaPerson + ElevenLabs TTS).

PROBLEME:
1. Gura ramane deschisa prea mult
2. Animatia dispare la text lung
3. Vocea suna trunchiat
4. Lip-sync imperceptibil

PARAMETRI FFT LIP-SYNC:
${fftUpdate}

PARAMETRI ALIGNMENT:
${alignParams}

VOICE CHUNKING:
${voiceChunk}

AVATAR MOUTH DECAY:
${avatarDecay}

Raspunde EXACT asa:
1. CE E DEFECT: lista concreta
2. COD CORECTAT: arata valorile noi pentru fiecare parametru
3. CE SOFT EXTERN ar imbunatati dramatic calitatea (NVIDIA Audio2Face, Azure Viseme, Rhubarb etc)`;


fetch('https://kelionai.app/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        message: prompt,
        userId: 'lipsync-fix-' + Date.now(),
    }),
})
    .then(r => r.json())
    .then(j => {
        fs.writeFileSync('C:/tmp/brain-lipsync-fix.txt', j.reply || 'NO REPLY');
    })
    .catch(e => /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* console.log('ERR:', e.message) (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */);
