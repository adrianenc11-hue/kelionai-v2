'use strict';

const { Router } = require('express');
const ipGeo = require('../services/ipGeo');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const router = Router();

const ELEVENLABS_URL          = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_ELEVENLABS_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam (American male, multilingual)

// Native male voice per language.
//
// `eleven_multilingual_v2` can speak 29 languages with any voice, but the
// accent bleeds through — e.g. Adam (American) speaking Italian sounds
// Italian-American, not Italian. Adrian asked for a native-sounding male
// voice per language.
//
// Strategy: curate ElevenLabs' public default library (available to every
// ElevenLabs account without extra subscription) into language families,
// picking voices whose natural accent is closest to the target language.
// Where no close match exists in the default library (Arabic, Chinese,
// Japanese, Korean, Hindi, Bengali, Thai, Vietnamese, Indonesian,
// Filipino, Tamil, Malay, Hebrew), the operator should set a clone/library
// voice ID via `ELEVENLABS_VOICE_<LANG>` Railway env var; fallback is Adam
// (multilingual_v2) which at least speaks the language natively, just
// with an American male timbre.
//
// ElevenLabs default male voice IDs (all publicly available on every account):
//   Adam     pNInz6obpgDQGcFmaJgB  American English, deep, narrator
//   Antoni   ErXwobaYiN019PkySvjV  American English, warm, well-rounded
//   Arnold   VR6AewLTigWG4xSOukaG  American English, crisp
//   Brian    nPczCjzI2devNBz1zQrb  American English, deep narrator
//   Callum   N2lVS1w4EtoT3dr4eOWO  Scottish, intense (great for Celtic)
//   Charlie  IKne3meq5aSn9XLyUdCD  Australian, natural
//   Clyde    2EiwWnXFnvU5JabPnv8n  American English, war veteran
//   Daniel   onwK4e9ZLuTAKqWW03F9  British English, authoritative (BBC-style)
//   Ethan    g5CIjZEefAph4nQFvHAz  American English, young whisper
//   Fin      D38z5RcWu1voky8WS1ja  Irish English, old sailor
//   George   JBFqnCBsd6RMkjVDRZzb  British English, warm
//   Giovanni zcAOhNBS3c14rBihAFp1  Italian-accented English (closest to IT native)
//   Liam     TX3LPaxmHKxFdv7VOQHJ  American English, young articulate
//   Sam      yoZ06aMxZJJ28mfd3POQ  American English, neutral / news
//
// Operators override ANY mapping via env vars: ELEVENLABS_VOICE_RO,
// ELEVENLABS_VOICE_EN, ELEVENLABS_VOICE_ES, etc. The env var wins over the
// curated mapping below, and ELEVENLABS_VOICE_ID wins as a global override.
const NATIVE_MALE_VOICES = {
  // Germanic (Anglo)
  'en':    'JBFqnCBsd6RMkjVDRZzb', // George — warm British English, sounds native for neutral EN
  'en-US': 'pNInz6obpgDQGcFmaJgB', // Adam — American default
  'en-GB': 'onwK4e9ZLuTAKqWW03F9', // Daniel — BBC British
  'en-AU': 'IKne3meq5aSn9XLyUdCD', // Charlie — Australian native
  'en-IE': 'D38z5RcWu1voky8WS1ja', // Fin — Irish
  // Germanic (Continental)
  'de':    'VR6AewLTigWG4xSOukaG', // Arnold — crisp, handles German consonants well
  'nl':    'VR6AewLTigWG4xSOukaG', // Arnold — Dutch (Germanic family)
  'sv':    'VR6AewLTigWG4xSOukaG', // Swedish
  'no':    'VR6AewLTigWG4xSOukaG', // Norwegian
  'da':    'VR6AewLTigWG4xSOukaG', // Danish
  // Romance
  'es':    'ErXwobaYiN019PkySvjV', // Antoni — Latin warmth, works for Spanish
  'pt':    'ErXwobaYiN019PkySvjV', // Antoni — Portuguese
  'it':    'zcAOhNBS3c14rBihAFp1', // Giovanni — Italian-accented, closest to IT native
  'fr':    'ErXwobaYiN019PkySvjV', // Antoni — French
  'ro':    'ErXwobaYiN019PkySvjV', // Antoni — Romanian (Romance family)
  // Slavic
  'ru':    'nPczCjzI2devNBz1zQrb', // Brian — deeper register suits Slavic
  'uk':    'nPczCjzI2devNBz1zQrb', // Ukrainian
  'pl':    'nPczCjzI2devNBz1zQrb', // Polish
  'cs':    'nPczCjzI2devNBz1zQrb', // Czech
  'sk':    'nPczCjzI2devNBz1zQrb', // Slovak
  'bg':    'nPczCjzI2devNBz1zQrb', // Bulgarian
  'hr':    'nPczCjzI2devNBz1zQrb', // Croatian
  'sr':    'nPczCjzI2devNBz1zQrb', // Serbian
  // Finno-Ugric
  'hu':    'TX3LPaxmHKxFdv7VOQHJ', // Liam — young articulate, fits Hungarian cadence
  'fi':    'TX3LPaxmHKxFdv7VOQHJ', // Finnish
  // Hellenic
  'el':    'yoZ06aMxZJJ28mfd3POQ', // Sam — neutral, Greek
  // Turkic
  'tr':    'ErXwobaYiN019PkySvjV', // Antoni — Mediterranean feel
  // Semitic / Asian (no native defaults — fall back to Adam; override via env)
  'ar':    'pNInz6obpgDQGcFmaJgB',
  'he':    'pNInz6obpgDQGcFmaJgB',
  'hi':    'pNInz6obpgDQGcFmaJgB',
  'bn':    'pNInz6obpgDQGcFmaJgB',
  'ta':    'pNInz6obpgDQGcFmaJgB',
  'zh':    'pNInz6obpgDQGcFmaJgB',
  'ja':    'pNInz6obpgDQGcFmaJgB',
  'ko':    'pNInz6obpgDQGcFmaJgB',
  'th':    'pNInz6obpgDQGcFmaJgB',
  'vi':    'pNInz6obpgDQGcFmaJgB',
  'id':    'pNInz6obpgDQGcFmaJgB',
  'ms':    'pNInz6obpgDQGcFmaJgB',
  'fil':   'pNInz6obpgDQGcFmaJgB',
};

function elevenLabsVoiceFor(lang) {
  const normalized = String(lang || 'en').toLowerCase();
  // Check most-specific first (en-GB) then base (en)
  const perLangEnv = `ELEVENLABS_VOICE_${normalized.replace('-', '_').toUpperCase()}`;
  const baseEnv    = `ELEVENLABS_VOICE_${normalized.split('-')[0].toUpperCase()}`;
  return (
    process.env[perLangEnv] ||
    process.env[baseEnv] ||
    process.env.ELEVENLABS_VOICE_ID ||
    NATIVE_MALE_VOICES[normalized] ||
    NATIVE_MALE_VOICES[normalized.split('-')[0]] ||
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

  // Guest trial quota — when the request arrives without a signed-in user
  // (softAuth upstream skipped attaching req.user), enforce the same
  // 15-min/day IP window that gates /api/chat and /api/realtime. This is
  // what makes the Charon / ElevenLabs male voice accessible to free users
  // on text chat (Adrian: "in mod free nu se aplica vocile") while still
  // keeping the shared trial cap so guests can't exhaust TTS beyond their
  // allotment. Signed-in users skip entirely — their gating is the
  // subscription/credits system applied by the middleware chain upstream.
  const isGuest = !req.user;
  if (isGuest) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      return res.status(429).json({
        error: 'Free trial exhausted for today. Sign in or purchase credits to continue.',
        trial: { allowed: false, remainingMs: 0, nextWindowMs: status.nextWindowMs },
      });
    }
    stampTrialIfFresh(ip, status);
  }

  const hasGemini     = !!process.env.GEMINI_API_KEY;
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
  if (!hasGemini && !hasElevenLabs) {
    return res.status(503).json({ error: 'TTS not configured. Set GEMINI_API_KEY or ELEVENLABS_API_KEY.' });
  }

  // Adrian: "La chat scris […] aceeiasi voce ca la chat audio". Voice chat
  // uses Gemini Live with the Charon prebuilt voice; text chat must match so
  // Kelion sounds like the same person across modalities. Prefer Gemini
  // Charon by default; only fall back to ElevenLabs if Gemini isn't
  // configured, or if the operator explicitly opts into ElevenLabs with
  // TTS_PROVIDER=elevenlabs.
  const providerOverride = (process.env.TTS_PROVIDER || '').toLowerCase();
  const forceElevenLabs  = providerOverride === 'elevenlabs' || providerOverride === '11labs';
  const forceGemini      = providerOverride === 'gemini';
  const useElevenLabs = forceElevenLabs
    ? hasElevenLabs
    : forceGemini
      ? false
      : !hasGemini && hasElevenLabs; // default: Gemini first, ElevenLabs only as fallback
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
