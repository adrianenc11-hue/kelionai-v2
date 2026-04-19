'use strict';

const { Router } = require('express');
const router = Router();

const ELEVENLABS_URL          = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVENLABS_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam (male, multilingual)

// Per-language ElevenLabs voice overrides. `eleven_multilingual_v2` lets
// a single voice speak 29+ languages natively, but Adrian asked for each
// language to use its own native voice. Operators set voice IDs from the
// ElevenLabs Voice Library via Railway env vars; when unset we fall back to
// the global default (Adam + multilingual_v2).
function elevenLabsVoiceFor(lang) {
  const perLangEnv = `ELEVENLABS_VOICE_${String(lang || 'en').toUpperCase()}`;
  return (
    process.env[perLangEnv] ||
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_ELEVENLABS_VOICE
  );
}

// Language detection.
//
// Truth sources, in order of reliability:
//   1. `lang` hint posted by the client (`navigator.language` — browser locale).
//      This is the single most reliable signal: it's what the user's OS / browser
//      are configured in, and matches the language the user actually types.
//   2. Heuristic detection on the text itself — script-based (Cyrillic, Arabic,
//      Han, Hangul, etc.) + diacritic/stopword checks for the major Latin-script
//      European languages. Covers ~25 languages confidently.
//   3. Fallback to English.
//
// ElevenLabs (eleven_multilingual_v2) accepts any ISO 639-1 `language_code`
// and speaks the text natively; operators can additionally pick a true
// native-speaker voice per language via ELEVENLABS_VOICE_<LANG> env vars.
// Gemini TTS accepts BCP-47 codes (en-US, ro-RO, …).
function detectLanguage(text) {
  const raw = String(text || '');
  if (!raw.trim()) return 'en';
  const s = raw.toLowerCase();

  // Script-first detection: any non-Latin script is a strong, near-unambiguous signal.
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(raw))               return 'ja'; // Japanese kana
  if (/[\uac00-\ud7af]/.test(raw))                            return 'ko'; // Hangul
  if (/[\u4e00-\u9fff]/.test(raw))                            return 'zh'; // Han / CJK (Chinese default)
  if (/[\u0600-\u06ff]/.test(raw))                            return 'ar'; // Arabic
  if (/[\u05d0-\u05ea]/.test(raw))                            return 'he'; // Hebrew
  if (/[\u0e00-\u0e7f]/.test(raw))                            return 'th'; // Thai
  if (/[\u0400-\u04ff]/.test(raw)) {
    if (/[іїєґ]/i.test(raw))                                   return 'uk'; // Ukrainian distinguishing letters
    if (/[ѓќљњџ]/i.test(raw))                                  return 'mk'; // Macedonian
    if (/[ђћџљњ]/i.test(raw))                                  return 'sr'; // Serbian Cyrillic
    return 'ru';
  }
  if (/[\u0900-\u097f]/.test(raw))                            return 'hi'; // Devanagari
  if (/[\u0980-\u09ff]/.test(raw))                            return 'bn'; // Bengali
  if (/[\u0370-\u03ff]/.test(raw))                            return 'el'; // Greek

  // Latin-script European languages via diacritics + frequent function words.
  if (/[șşţțăîâ]/.test(s) || /\b(este|sunt|pentru|salut|bună|mulțumesc|aceasta|acest)\b/.test(s)) return 'ro';
  if (/[ñ¿¡]/.test(s) || /\b(hola|gracias|por\s+favor|buenos|qué|cómo|estás|usted|dónde)\b/.test(s)) return 'es';
  if (/\b(ciao|grazie|buongiorno|buonasera|sono|perché|come\s+stai|dove|cosa)\b/.test(s)) return 'it';
  if (/ç/.test(s) || /\b(bonjour|merci|s'il\s+vous\s+plaît|comment|ça\s+va|où|vous\s+êtes)\b/.test(s)) return 'fr';
  if (/[ßäöü]/.test(s) || /\b(hallo|danke|bitte|guten\s+tag|wie\s+geht|sind\s+sie|ich\s+bin)\b/.test(s)) return 'de';
  if (/[ãõ]/.test(s) || /\b(olá|obrigado|obrigada|bom\s+dia|como\s+está|você|não)\b/.test(s)) return 'pt';
  if (/\b(hallo|bedankt|goedemorgen|hoe\s+gaat|waar|bent|alstublieft)\b/.test(s)) return 'nl';
  if (/[ą ć ę ł ń ó ś ź ż]/i.test(raw) || /\b(cześć|dziękuję|proszę|dzień\s+dobry|jak\s+się\s+masz)\b/.test(s)) return 'pl';
  if (/[ř ě ů]/i.test(raw) || /\b(ahoj|děkuji|prosím|dobrý\s+den|jak\s+se\s+máš)\b/.test(s)) return 'cs';
  if (/[ľ ĺ ŕ]/i.test(raw) || /\b(ahoj|ďakujem|dobrý\s+deň|ako\s+sa\s+máš)\b/.test(s)) return 'sk';
  if (/[ő ű]/i.test(raw) || /\b(szia|köszönöm|kérlek|jó\s+napot|hogy\s+vagy)\b/.test(s)) return 'hu';
  if (/\b(merhaba|teşekkür|lütfen|günaydın|nasılsın)\b/.test(s)) return 'tr';
  if (/[æøå]/i.test(raw)) {
    if (/\b(jeg|hvordan|takk|hei|god\s+morgen)\b/.test(s)) return 'no';
    if (/\b(hej|tak|godmorgen|hvordan\s+har)\b/.test(s))   return 'da';
    return 'no';
  }
  if (/[åäö]/i.test(raw) || /\b(hej|tack|god\s+morgon|hur\s+mår\s+du)\b/.test(s)) return 'sv';
  if (/\b(hei|kiitos|hyvää\s+päivää|miten\s+menee)\b/.test(s)) return 'fi';
  return 'en';
}

const GEMINI_TTS_BASE        = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
// "Charon" is a deeper male Gemini prebuilt voice. Default voice for Kelion
// (the male-presenting avatar) was "Kore" which is clearly female — that's a
// voice/avatar mismatch Adrian flagged explicitly. Use a male voice by default
// so the Gemini fallback matches the avatar even when ElevenLabs isn't wired.
const DEFAULT_GEMINI_VOICE     = 'Charon';

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

// ISO 639-1 -> BCP-47 (language + default region). Gemini TTS prefers a
// region-qualified code. For languages not listed we fall back to the bare
// ISO 639-1 code, which ElevenLabs accepts directly and Gemini tolerates.
const BCP47_BY_ISO = {
  en: 'en-US', ro: 'ro-RO', es: 'es-ES', it: 'it-IT', fr: 'fr-FR',
  de: 'de-DE', pt: 'pt-PT', nl: 'nl-NL', pl: 'pl-PL', cs: 'cs-CZ',
  sk: 'sk-SK', hu: 'hu-HU', tr: 'tr-TR', no: 'nb-NO', da: 'da-DK',
  sv: 'sv-SE', fi: 'fi-FI', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
  ar: 'ar-XA', he: 'he-IL', th: 'th-TH', hi: 'hi-IN', bn: 'bn-IN',
  el: 'el-GR', ru: 'ru-RU', uk: 'uk-UA', mk: 'mk-MK', sr: 'sr-RS',
};
function toBcp47(lang) {
  return BCP47_BY_ISO[lang] || `${lang}`;
}

async function synthesizeGemini(text, lang) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_TTS_MODEL;
  const voice  = process.env.GEMINI_TTS_VOICE_KELION || DEFAULT_GEMINI_VOICE;

  const languageCode = toBcp47(lang);
  const url = `${GEMINI_TTS_BASE}/${encodeURIComponent(model)}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          // languageCode tells Gemini TTS which accent/phonetics to use so a
          // Romanian reply is spoken natively instead of with an English
          // accent. The prebuilt voices (Charon, Puck, Fenrir, …) are all
          // multilingual under the hood.
          languageCode,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
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

async function synthesizeElevenLabs(text, lang) {
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = elevenLabsVoiceFor(lang);
  // eleven_multilingual_v2 auto-detects language natively and speaks with a
  // native accent (Adam sounds native in Romanian, English, Italian, etc).
  // We pass `language_code` only as an explicit hint — the provider accepts
  // ISO 639-1 codes (e.g. "ro", "en", "it") and uses them to disambiguate
  // short inputs.
  const r = await fetch(`${ELEVENLABS_URL}/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      ...(lang ? { language_code: lang } : {}),
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
  const { text, lang: langHint } = req.body || {};

  if (!text || typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'Text is required and must be under 2000 characters' });
  }

  const hasGemini     = !!process.env.GEMINI_API_KEY;
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
  if (!hasGemini && !hasElevenLabs) {
    return res.status(503).json({ error: 'TTS not configured. Set GEMINI_API_KEY or ELEVENLABS_API_KEY.' });
  }

  // Adrian: "vocea nu este elevenlab, nativa, barbateasca, voce de femeie acum".
  // Avatar Kelion is male-presenting — a female default voice breaks immersion.
  // Prefer ElevenLabs ("Adam" male) when configured; fall back to Gemini
  // ("Charon" male) only if ElevenLabs is not wired. Set TTS_PROVIDER=gemini
  // to force Gemini even when both are configured.
  const forceGemini = (process.env.TTS_PROVIDER || '').toLowerCase() === 'gemini';
  const useElevenLabs = hasElevenLabs && !forceGemini;
  // Frontend may send a language hint (e.g. `navigator.language`). Trust any
  // well-formed ISO 639-1 code the client supplies; otherwise auto-detect
  // from the reply text itself.
  const hint = typeof langHint === 'string' ? langHint.toLowerCase().slice(0, 2) : '';
  const lang = /^[a-z]{2}$/.test(hint) ? hint : detectLanguage(text);
  try {
    if (useElevenLabs) {
      const mp3 = await synthesizeElevenLabs(text, lang);
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': mp3.length,
        'X-TTS-Provider': 'elevenlabs',
        'X-TTS-Language': lang,
      });
      return res.send(mp3);
    }
    const wav = await synthesizeGemini(text, lang);
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': wav.length,
      'X-TTS-Provider': 'gemini',
      'X-TTS-Language': lang,
    });
    res.send(wav);
  } catch (err) {
    console.error('[tts] Error:', err.message);
    res.status(500).json({ error: 'Voice synthesis failed' });
  }
});

module.exports = router;
