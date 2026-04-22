'use strict';

// F8 — language utilities. Convert Accept-Language headers and user input
// to short BCP-47 primary tags we can safely persist on the user row and
// mirror as a `locale` memory_item so the voice/text personas see it
// without touching `chat.js`.

// Short (2-letter primary subtag) whitelist. Anything outside this list
// collapses to `en` rather than inventing a locale nobody on the stack
// supports. Keep in sync with the whitelist used by realtime.js/tts.js.
const SUPPORTED_SHORT = new Set([
  'en','ro','fr','es','it','de','pt','nl','pl','ru','uk','cs','hu',
  'tr','ar','he','el','sv','no','da','fi','bg','sr','hr','sk','sl',
  'ja','ko','zh','hi','bn','ta','te','th','vi','id','ms','fa','ur',
  'kk','uz','az','et','lv','lt','mk','sq','af','sw',
]);

// Human-readable English label for the persona line so the model knows
// what "ro" or "zh" refers to without guessing. Fallback = the tag itself.
const LABELS = {
  en: 'English', ro: 'Romanian', fr: 'French', es: 'Spanish', it: 'Italian',
  de: 'German', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian',
  uk: 'Ukrainian', cs: 'Czech', hu: 'Hungarian', tr: 'Turkish', ar: 'Arabic',
  he: 'Hebrew', el: 'Greek', sv: 'Swedish', no: 'Norwegian', da: 'Danish',
  fi: 'Finnish', bg: 'Bulgarian', sr: 'Serbian', hr: 'Croatian', sk: 'Slovak',
  sl: 'Slovenian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', hi: 'Hindi',
  bn: 'Bengali', ta: 'Tamil', te: 'Telugu', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', ms: 'Malay', fa: 'Persian', ur: 'Urdu', kk: 'Kazakh',
  uz: 'Uzbek', az: 'Azerbaijani', et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian',
  mk: 'Macedonian', sq: 'Albanian', af: 'Afrikaans', sw: 'Swahili',
};

/**
 * Normalize anything the caller might pass (browser tag "ro-RO", full
 * English name "Romanian", user-typed "RO") to a supported primary
 * subtag. Returns null for empty / unrecognized input so the caller can
 * decide between "keep existing" and "fall back to en".
 */
function normalizeLanguage(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  // Strip region/script subtags: "en-us" -> "en", "zh_hant" -> "zh".
  const primary = s.split(/[-_]/)[0];
  if (SUPPORTED_SHORT.has(primary)) return primary;
  // Also accept full English names ("romanian", "french") typed into an
  // API body. Cheap lookup against the inverted LABELS map.
  for (const [tag, label] of Object.entries(LABELS)) {
    if (label.toLowerCase() === primary) return tag;
  }
  return null;
}

/**
 * Parse an Accept-Language header ("ro-RO,ro;q=0.9,en;q=0.8,fr;q=0.7")
 * and return the highest-quality supported short tag, or null when none
 * of the listed tags survive the whitelist.
 */
function parseAcceptLanguage(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(',').map((chunk) => {
    const [rawTag, ...params] = chunk.trim().split(';').map((p) => p.trim());
    let q = 1;
    for (const p of params) {
      const m = /^q\s*=\s*([\d.]+)$/i.exec(p);
      if (m) {
        const parsed = parseFloat(m[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    return { tag: rawTag, q };
  });
  parts.sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    const norm = normalizeLanguage(tag);
    if (norm) return norm;
  }
  return null;
}

/**
 * Human-readable memory line the chat/realtime persona picks up through
 * `listMemoryItems`. Kept in English because the personas think in
 * English and already translate on demand.
 */
function memoryFactForLanguage(shortTag) {
  const norm = normalizeLanguage(shortTag);
  if (!norm) return null;
  const label = LABELS[norm] || norm;
  return `Preferred language: ${label} (${norm}). Greet and keep replying in ${label} unless the user switches language.`;
}

module.exports = {
  SUPPORTED_SHORT,
  LABELS,
  normalizeLanguage,
  parseAcceptLanguage,
  memoryFactForLanguage,
};
