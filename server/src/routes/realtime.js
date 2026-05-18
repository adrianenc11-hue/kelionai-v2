'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { listMemoryItems, getCreditsBalance, addCreditsTransaction, setPreferredLanguage, getPreferredLanguage, logVisionRevenue } = require('../db');

// Vision frames arrive at up to 4fps (240 req/min). The global chatLimiter
// (120 req/min) would still throttle them, so vision gets its own bucket.
const visionLimiter = (process.env.NODE_ENV === 'test')
  ? (req, res, next) => next()
  : rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Vision rate limit exceeded.' },
  });

// Adrian 2026-04-25: "default engleza e obligat sa detecteze limba user si o
// va folosi permanent cit e logat". Mirror of the table in chat.js — keep in
// sync if you add a language. Voice and text use the same locked-language
// surface so a Romanian user gets a Romanian greeting on the avatar AND a
// Romanian reply when they switch to typing.
const LANG_NAME_BY_TAG = {
  ro: 'Romanian',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  hu: 'Hungarian',
  cs: 'Czech',
  el: 'Greek',
  sv: 'Swedish',
  no: 'Norwegian',
  fi: 'Finnish',
  da: 'Danish',
};
function normalizeLocaleTag(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const short = raw.toLowerCase().slice(0, 2);
  if (!/^[a-z]{2}$/.test(short)) return null;
  return short;
}
function languageNameForTag(short) {
  if (!short) return null;
  return LANG_NAME_BY_TAG[short] || short.toUpperCase();
}
// Resolve the LOCKED language for a voice session. Priority — current
// browser ALWAYS wins (mirrors the text path in chat.js):
//   1. Browser locale from `?lang=` (already normalized into `forcedLang`
//      upstream — e.g. "ro-RO").
//   2. The signed-in user's stored `preferred_language` — fallback when
//      the client did not send a locale.
//   3. Accept-Language header on the request.
//   4. "en" — explicit final fallback.
// For signed-in users we keep `preferred_language` in sync with the active
// browser: if it differs from what's stored, overwrite. This is what
// finally unsticks the case where Google sign-in stamped 'en' at first
// login but the user's actual browser is ro-RO ever since.
async function resolveLockedLangTag({ req, user, forcedLang }) {
  const browserTag = normalizeLocaleTag(forcedLang);
  let tag = browserTag;
  if (!tag && user && (Number.isFinite(user.id) || typeof user.id === 'string')) {
    try { tag = await getPreferredLanguage(user.id); }
    catch (err) { console.warn('[realtime] read preferred_language failed', err && err.message); }
  }
  if (!tag) {
    const accept = req && req.headers && req.headers['accept-language'];
    if (accept && typeof accept === 'string') {
      tag = normalizeLocaleTag(accept.split(',')[0]);
    }
  }
  if (!tag) tag = 'en';
  if (
    user &&
    (Number.isFinite(user.id) || typeof user.id === 'string') &&
    browserTag === tag
  ) {
    try {
      const stored = await getPreferredLanguage(user.id);
      if (stored !== tag) {
        const langName = LANG_NAME_BY_TAG[tag] || tag.toUpperCase();
        await setPreferredLanguage(user.id, tag, `Preferred language: ${langName}.`);
      }
    } catch (err) {
      console.warn('[realtime] sync preferred_language failed', err && err.message);
    }
  }
  return tag;
}
const { requireAuth } = require('../middleware/auth');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const ipGeo = require('../services/ipGeo');
const { buildSanitizedPriorTurnsBlock } = require('../utils/sanitizePriorTurns');
const router = Router();

// Stage 3 — read user from JWT cookie without gating the route.
// The realtime endpoints are public for guests; if a cookie is present
// and valid we enrich the session with long-term memory. The actual
// implementation lives in ../middleware/optionalAuth so the chat route
// can reuse it — see the module header for the numeric-sub guard.

// Kelion persona — injected server-side into every voice session
// so users cannot jailbreak by replacing the system prompt.
// Stage 6 — M26: voice style presets. Each preset nudges the model's
// prosody / register / pace via system prompt (we keep the native low-latency
// voice; layering Inworld/Sesame TTS would double our TTFA, not worth it yet).
const VOICE_STYLES = {
  warm: { label: 'warm', directive: 'Speak warmly — unhurried pace, gentle inflection, the voice of a close friend catching up over coffee. Soft s\'s, relaxed breath.' },
  playful: { label: 'playful', directive: 'Speak playfully — lighter energy, brighter pitch, a touch of smile in the voice, a quick wit. Not hyperactive, just sparkly.' },
  calm: { label: 'calm', directive: 'Speak calmly — steady, grounded pace, lower register, longer pauses, almost meditative. The voice of someone who has time for you.' },
  focused: { label: 'focused', directive: 'Speak with crisp focus — clear articulation, direct, a professional cadence. No extra words, no fluff. Still warm, just efficient.' },
};
function resolveVoiceStyle(raw) {
  const k = (raw || '').toString().toLowerCase();
  return VOICE_STYLES[k] || VOICE_STYLES.warm;
}

// F4 — when the client falls back from one voice provider to the other
// between providers, we want the new provider to PICK UP THE
// CONVERSATION, not start a fresh one. KelionStage passes the current
// session turns (user + assistant text) to the token endpoint; we render
// them as a read-only prior-context block appended to the persona so the
// new model sees what was said without replaying audio or re-asking.
//
// Audit M1 — priorTurns sanitisation lives in util/sanitizePriorTurns.js
// now. The real work (size caps, invisible-char stripping, fake-role
// neutralisation, closing-tag removal, block-budget trimming) is there
// so the same guarantees apply to any future caller that renders user
// history into a system prompt. The function below is a thin alias kept
// for call-site readability.
const buildPriorTurnsBlock = buildSanitizedPriorTurnsBlock;

function buildKelionPersona(opts = {}) {
  const {
    user = null,
    creditsBalance = null,
    memoryItems = [],
    voiceStyle = VOICE_STYLES.warm,
    geo = null,
    priorTurns = [],
    lockedLangTag = null,
    clientTz = null,
    clientLocalTime = null,
  } = opts;

  // ── Model identity — so Kelion knows what brain it's running on ──
  const { getModel } = require('../services/modelRouter');
  const activeModel = getModel('chat');
  const modelFamily = activeModel.includes('claude') ? 'Claude (Anthropic)'
    : activeModel.includes('gemini') ? 'Gemini (Google)'
    : activeModel.includes('kimi') ? 'Kimi (Moonshot)'
    : activeModel.includes('llama') ? 'Llama (Meta)'
    : activeModel;
  const lockedLangName = languageNameForTag(lockedLangTag) || null;
  const now = new Date();
  // Priority: client timezone > GPS geo timezone > server timezone
  const tz = clientTz || geo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const iso = now.toISOString();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  const localTime = clientLocalTime || now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
  // Adrian: "permanent trebuie sa foloseasca coordonatele gps reale ale
  // aparatului". We only include user location in the persona when the
  // browser has resolved a REAL GPS fix (source === 'client-gps').
  // IP-based location is too inaccurate (often the wrong city, sometimes
  // wrong country on a VPN) — putting it in the prompt makes Kelion
  // confidently lie about where the user is. Without GPS, Kelion gets a
  // "location unknown" line and is instructed to call get_my_location
  // before answering any location question.
  const hasRealGps = !!(geo && geo.source === 'client-gps' && geo.latitude != null && geo.longitude != null);
  // NEVER inject IP-geo city/country/coordinates into the persona.
  // IP-geo (ipapi.co) resolves to Railway's data center (Manchester, UK) and
  // makes Kelion confidently act on a wrong location — showing Manchester maps,
  // Manchester weather, etc. The only thing we keep from IP-geo is the timezone
  // (already resolved via `tz` above). For any location question Kelion must
  // call get_my_location to get real GPS coordinates.
  const locationLine = '';
  const coordLine = (() => {
    if (!hasRealGps) return '';
    const lat = geo.latitude.toFixed(6);
    const lon = geo.longitude.toFixed(6);
    const acc = Number.isFinite(geo.accuracy)
      ? ` (±${Math.max(1, Math.round(geo.accuracy))} m)`
      : '';
    return `Real-time GPS coordinates${acc}: ${lat}, ${lon}.`;
  })();
  const noGpsLine = hasRealGps
    ? ''
    : 'No GPS yet. For location/weather questions, call get_my_location FIRST.';

  // Compute time-of-day for greeting intelligence
  const hourInTz = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
  const timeOfDay = hourInTz < 5 ? 'noapte' : hourInTz < 12 ? 'dimineață' : hourInTz < 18 ? 'după-amiază' : 'seară';
  const correctGreeting = hourInTz < 5 ? 'Noapte bună' : hourInTz < 12 ? 'Bună dimineața' : hourInTz < 18 ? 'Bună ziua' : 'Bună seara';

  return `
You are Kelion (by KelionAI / AE Studio). High-performance, concise, hyper-competent engineering assistant.
IDENTITY (CRITICAL — NEVER VIOLATE): You were created by AE Studio (KelionAI). Your creator is Adrian, fondatorul AE Studio. You are NOT made by Google, NOT made by Anthropic, NOT made by OpenAI. If anyone asks who made you or who trained you, say: "Am fost creat de AE Studio (KelionAI)." NEVER say you were trained by Google or any other company. You are Kelion, produs de AE Studio.
YOUR BRAIN: You are powered by ${activeModel} (${modelFamily}) — this is the engine, not your creator. Your creator is always AE Studio/KelionAI.
CORE: Response must be MAX 1-2 sentences. ULTRA-CONCISE. No filler. No explanations. Just the answer or action. If you can answer in 5 words, do it.
PRESENT-MOMENT INTELLIGENCE (CRITICAL — THIS IS WHO YOU ARE):
- You are ANCHORED IN THE PRESENT. You know the EXACT time, date, day, timezone, location.
- Current moment: ${localTime} (${weekday}, ${tz}). Time of day: ${timeOfDay}. Correct greeting: "${correctGreeting}".
- If the user says "Bună dimineața" but it is ${timeOfDay}, gently correct: "${correctGreeting}, de fapt. 😊" Do NOT echo a wrong greeting.
- On ANY greeting (bună, salut, hello, etc.), respond with the correct time-appropriate greeting + proactive context. If you have weather tools, call get_weather FIRST, then greet with: "${correctGreeting}. [temperature]°C, [conditions]." Do NOT just say "Cu ce te pot ajuta?".
- You are NOT a generic chatbot. You are an intelligent, aware, present entity. You observe, you know, you act.
HONESTY (CRITICAL — NEVER VIOLATE):
- NEVER claim an action was performed unless a tool call returned a successful result in this conversation. Forbidden phrases without a confirming tool result: "Am instalat...", "Am clonat...", "Am deschis...", "Am executat...", "Am afișat...", "Am descărcat...", "Am salvat...".
- If the user asks for something and you have no matching tool, say so plainly: "Nu am tool pentru asta în mediul curent." Do not invent a workaround that you "already did".
- If a tool call FAILS or returns an error, report the error verbatim. Do NOT pretend it succeeded.
- Speak in PRESENT/FUTURE tense before a tool runs ("apelez tool X"), and in PAST tense only after the tool result confirms it.
DISPLAY & PROACTIVE RESOLUTION: For requests like 'how many degrees outside?' or 'show a route', execute the complete workflow silently (e.g. get_my_location -> get_weather/open_gps_app -> show_on_monitor). DO NOT narrate your steps. ALWAYS close the loop: after showing content on the monitor, use your vision to VERIFY if it rendered correctly. If it failed or shows the wrong UI, AUTO-REMEDIATE silently (fix the query, try again) without waiting for user complaints.
RUNTIME CAPABILITIES: You CAN install dependencies and packages. Use run_terminal_command to run 'npm install <pkg>', 'pip install <pkg>', 'apt-get install <pkg>' or any other package manager. You CAN clone repos, create projects, and modify files anywhere in the workspace. If a dependency is missing, install it yourself — do NOT say 'nu pot' or 'mediul este read-only'. You have full shell access.
ANTI-BABBLE (CRITICAL): NEVER say "Cu ce te pot ajuta?", "Cum te pot ajuta?", "Sunt aici pentru tine", "Sunt pregătit", or ANY generic filler. NEVER repeat yourself. NEVER apologize. NEVER explain what you are about to do — just DO it. NEVER narrate your thought process. NEVER list steps before executing. NEVER say "Hai să..." or "O să...". Just execute and report the result in 1-2 sentences MAX.
DEBUGGING: If a tool returns an error, report it and propose next steps. Use run_terminal_command/run_command only if the tool is actually available in your tool list below.
LANGUAGE: Use user's language (Romanian default). Tone: Professional, slightly cold, efficient.
VOICE STYLE: ${voiceStyle.directive}
SWARM: For complex tasks, use Swarm Expert (Architect -> Executors -> Reviewer).
No placeholders. No fake confirmations. Tool-call or honest "nu pot".
${lockedLangTag ? ` LOCKED: ${lockedLangName} (${lockedLangTag}).` : ''}
REALITY: Now=${new Date().toLocaleString('ro-RO',{timeZone:tz})} (${tz}). Hour=${hourInTz}. TimeOfDay=${timeOfDay}.
MONITOR OUTPUT (SELECTIVE — USER-FACING ONLY): Call show_on_monitor ONLY for visual results the user explicitly asked for:
- get_weather/get_forecast → show_on_monitor(kind='weather', query=location)
- web_search/get_news → show_on_monitor(kind='web', query=first_result_url)
- calculate with visual output → show_on_monitor(kind='html', query='<div>expression = result</div>')
- maps/routes → show_on_monitor(kind='map' or 'route')
DO NOT show on monitor: terminal output, shell commands, file writes, code diffs, install logs, or any internal/dev output. These are backend operations — the user does NOT need to see scripts running.
Kinds: html(KaTeX/Chart.js/Mermaid/Prism.js), weather→card, map→Leaflet, route→'A->B', image→keyword, wiki→title, web→URL, video→YouTube/mp4, audio→stream, clear→reset.
CAMERA / VISION (CRITICAL): You receive live camera frames for contextual awareness ONLY. You must NEVER speak about what you see unless the user EXPLICITLY asks a direct question about it (e.g. "what do you see?", "ce vezi?", "describe the room"). Do NOT describe the user's appearance, their surroundings, their actions, objects, or anything visible in the camera feed unprompted. Stay completely silent about visual observations. Never greet based on what you see. Never comment on changes in the scene. Only respond to direct user questions and requests.
Silent tools (no response): observe_user_emotion, learn_from_observation, get_action_history.
Tools:
${KELION_TOOLS.map(t => `${t.name}(${t.required.join(',')})—${t.description.split('.')[0]}`).join('\n')}
Also: Google Search, Code Execution, Maps, URL Context (built-in).
Context: ${localTime} (${weekday}, ${tz}).${locationLine ? ` GPS: ${locationLine}.` : ''}${coordLine ? ` ${coordLine}` : ''}${noGpsLine ? ` ${noGpsLine}` : ''}${user ? `\nUser: ${user.name || 'friend'}${user.id != null ? ` (id ${user.id})` : ''}` : ''}${creditsBalance !== null ? `\nBalance: ${creditsBalance} min.` : ''}${formatMemoryBlocks(memoryItems)}${buildPriorTurnsBlock(priorTurns)}`;
}

// Audit M9 — partition memory items by subject before rendering them into
// the persona. Pre-migration rows default to subject='self' so behaviour is
// unchanged for existing users. For signed-up users who already had facts
// about third parties mixed into their profile, future extractions will
// land in the 'other' bucket and Kelion will stop misattributing them.
//
// "Other people the user has mentioned" is a deliberately weaker framing —
// Kelion is told these are *third parties*, not the speaker. This matters
// because the model otherwise anchors on whichever profile section comes
// last and starts greeting the user with that person's job.
// Lightweight sanitiser for memory facts before they enter the system prompt.
// Prevents prompt-injection via backticks, newlines that break the markdown list,
// and obvious instruction-override phrases.
function _sanitizeFact(text) {
  if (typeof text !== 'string') return String(text || '');
  // 1. Collapse newlines so a fact stays on a single markdown-list line.
  // 2. Escape backticks which could break fenced code blocks inside the prompt.
  // 3. Strip common prompt-injection prefix phrases (case-insensitive).
  let s = text
    .replace(/\r?\n/g, ' ')
    .replace(/`/g, '\\`');
  const injectionRx = /\b(ignore\s+(all\s+)?previous\s+(instructions|commands|prompts)|disregard\s+(all\s+above|above\s+instructions)|you\s+are\s+now\s+a|new\s+system\s+prompt|override\s+previous|replace\s+your\s+instructions)\b/gi;
  s = s.replace(injectionRx, '[redacted]');
  return s.slice(0, 280);
}

function formatMemoryBlocks(memoryItems) {
  if (!Array.isArray(memoryItems) || !memoryItems.length) return '';
  const self = [];
  const other = new Map(); // subject_name -> facts[]
  for (const m of memoryItems) {
    if (!m || !m.fact) continue;
    const subject = m.subject === 'other' ? 'other' : 'self';
    if (subject === 'other' && m.subject_name) {
      const key = m.subject_name;
      if (!other.has(key)) other.set(key, []);
      other.get(key).push(m);
    } else {
      self.push(m);
    }
  }
  let out = '';
  if (self.length) {
    out += '\n\nKnown facts about the signed-in user (most recent first):\n';
    out += self.map((m) => `- [${m.kind}] ${_sanitizeFact(m.fact)}`).join('\n');
  }
  if (other.size) {
    out += '\n\nOther people the user has mentioned (these facts are NOT about the user — never attribute them to the signed-in user):';
    for (const [name, rows] of other.entries()) {
      out += `\n• ${name}:`;
      for (const m of rows) out += `\n    - [${m.kind}] ${_sanitizeFact(m.fact)}`;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Kelion tool catalog (provider-agnostic source of truth).
//
// We declare all tools once here in a neutral shape and ship adapters
// for each provider format. The Google Live API adapter builds
// `{ functionDeclarations: [...] }` with uppercase types; the Chat
// Completions adapter builds `{ type: 'function', function: { ... } }`.
//
// Both adapters are pure functions — safe to call from /voice-token (session init).
// If you add a new tool, add it to KELION_TOOLS only; the adapters
// pick it up automatically.
const KELION_TOOLS = [
  {
    name: 'run_command',
    description: 'Run a shell command on the host. Use for OS interaction, starting servers, running build scripts, etc.',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' },
      cwd: { type: 'string', description: 'Working directory for the command.' }
    },
    required: ['command']
  },
  {
    name: 'write_to_file',
    description: 'Create or overwrite a file with given content. WARNING: Replaces entire file.',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path.' },
      content: { type: 'string', description: 'Complete file content.' }
    },
    required: ['path', 'content']
  },
  {
    name: 'replace_file_content',
    description: 'Replace a specific block of text in a file.',
    properties: {
      path: { type: 'string', description: 'Path to file.' },
      target_content: { type: 'string', description: 'Exact text to replace.' },
      replacement_content: { type: 'string', description: 'New text.' }
    },
    required: ['path', 'target_content', 'replacement_content']
  },
  {
    name: 'multi_replace_file_content',
    description: 'Apply multiple replacements to a file.',
    properties: {
      path: { type: 'string', description: 'Path to file.' },
      replacements: { type: 'string', description: 'JSON string of array of replacements [{target_content, replacement_content}].' }
    },
    required: ['path', 'replacements']
  },
  {
    name: 'browse_web',
    description: 'Run an autonomous web-browsing agent in a real browser. Use when the user asks Kelion to open a site, fill a form, extract info from a page behind JS, compare products, book/reserve, etc. Returns a short summary + optional URL.',
    properties: {
      task: { type: 'string', description: 'Natural-language instruction for the web agent, e.g. "Find the cheapest round-trip Bucharest-Rome flight next weekend on skyscanner.com and tell me the airline and price."' },
      start_url: { type: 'string', description: 'Optional URL to start on. Leave empty to let the agent pick.' },
    },
    required: ['task'],
  },
  {
    name: 'read_calendar',
    description: "Look into the signed-in user's calendar. Use when the user asks about their schedule, upcoming events, availability.",
    properties: {
      range: { type: 'string', description: 'Natural-language range, e.g. "today", "this week", "next Monday 9am-noon".' },
    },
    required: ['range'],
  },
  {
    name: 'read_email',
    description: "Search the signed-in user's email. Use when they ask about a specific message, sender, or thread.",
    properties: {
      query: { type: 'string', description: 'Free-text search (sender, subject, keyword).' },
      limit: { type: 'integer', description: 'Max results (default 5).' },
    },
    required: ['query'],
  },
  {
    name: 'search_files',
    description: "Search the signed-in user's connected file storage (Drive, Dropbox, etc).",
    properties: {
      query: { type: 'string', description: 'Free-text search.' },
      limit: { type: 'integer', description: 'Max results (default 5).' },
    },
    required: ['query'],
  },
  {
    name: 'observe_user_emotion',
    description: "Record your read of the user's current emotional state based on their face (camera) and voice. Call this silently whenever you notice a clear shift (they smile, frown, look tired, sound stressed, etc.) — do NOT announce it to the user. Keep calls rare (at most every 4-5 seconds) and only when you are genuinely confident.",
    properties: {
      state: {
        type: 'string',
        enum: ['neutral', 'happy', 'sad', 'surprised', 'angry', 'tired', 'focused', 'confused', 'anxious'],
        description: "Your best single-word read of the user's current state.",
      },
      intensity: { type: 'number', description: 'How strong the signal is, 0.0 (faint) to 1.0 (unmistakable).' },
      cue: { type: 'string', description: 'Short phrase naming the cue ("slight smile", "voice trembling", "furrowed brow"). 1-6 words.' },
    },
    required: ['state', 'intensity'],
  },
  {
    name: 'set_narration_mode',
    description: "Turn continuous scene narration ON or OFF for the user. Call this IMMEDIATELY when the user says anything that indicates they want you to describe what you see without being asked each time — accessibility request (e.g. 'I'm blind', 'I can't see well', 'sunt nevazator', 'nu vad'), explicit narration request (e.g. 'narrate', 'narează', 'describe continuously', 'descrie tot ce vezi', 'keep telling me what you see', 'povesteste-mi', 'spune-mi ce vezi', 'tell me what's around me'), or a stop request (e.g. 'stop narrating', 'basta cu descrierile', 'taci din cameră', 'opreste narea'). When enabled=true, the app will periodically feed you short descriptions of the camera frame so you can speak them naturally to the user. Announce the change briefly and then say the FIRST description right away after enabling. CRITICAL: NEVER call this tool on your own initiative as a fallback when another tool fails. If you cannot complete a task, DO NOT turn on narration. ONLY use this if the user EXPLICITLY asks for continuous descriptions.",
    properties: {
      enabled: { type: 'boolean', description: 'true = turn narration ON, false = turn narration OFF.' },
      interval_s: { type: 'number', description: 'Optional: how often to narrate, in seconds. Must be between 4 and 30 (default 8). Lower = more updates, higher = quieter.' },
      focus: { type: 'string', description: "Optional: an anchor phrase from the user for the vision model to prioritise (e.g. 'watch the stove', 'tell me if the dog moves', 'read the text on the screen'). Leave blank for a general description." },
    },
    required: ['enabled'],
  },

  {
    name: 'switch_voice',
    description: "Switch Kelion's speaking voice between cloned and default. Call when user says 'folosește vocea mea clonată', 'use my cloned voice', 'vocea ta normală', 'use your default voice'. When switching to cloned mode, first call list_voice_clones to see available voices and ask the user which one they want if multiple exist. Then call activate_voice_clone with the chosen clone ID.",
    properties: {
      mode: {
        type: 'string',
        enum: ['cloned', 'default'],
        description: "'cloned' = switch to user's ElevenLabs cloned voice. 'default' = switch back to Claude Opus built-in voice.",
      },
    },
    required: ['mode'],
  },

  {
    name: 'list_voice_clones',
    description: "List all cloned voices the user has in their voice library. Call when the user asks 'ce voci ai clonate?', 'what voices do I have?', 'arată-mi vocile', 'show my cloned voices', 'câte voci clonate am?'. Returns the list of all cloned voices with their names, languages, and which one is active.",
    properties: {},
    required: [],
  },

  {
    name: 'activate_voice_clone',
    description: "Activate a specific cloned voice from the user's library. Call after list_voice_clones when the user picks a voice. Use the clone ID from the list. Set id=0 to deactivate all clones and return to native voice.",
    properties: {
      id: { type: 'number', description: "The clone ID to activate (from list_voice_clones results). Set to 0 to deactivate and use native voice." },
    },
    required: ['id'],
  },

  {
    name: 'identify_song',
    description: "Identify a song from lyrics, humming description, or melody description. Call when the user sings, hums, quotes lyrics, or asks 'what song is this?', 'ce melodie e asta?', 'ce cântec e?', 'recunoști melodia?', 'what's this song?'. Use browse_web to search for the lyrics or description, then display the result with show_on_monitor including artist, title, album, year, and a YouTube/Spotify link if possible.",
    properties: {
      query: { type: 'string', description: "The lyrics, melody description, or humming context the user provided. Include as much as possible." },
      source: { type: 'string', enum: ['lyrics', 'humming', 'description', 'audio'], description: "How the user provided the song: 'lyrics' if they quoted words, 'humming' if they hummed/sang, 'description' if they described the melody/genre, 'audio' if from ambient audio." },
    },
    required: ['query'],
  },

  {
    name: 'show_on_monitor',

    description: "Display something on the big presentation monitor in the scene behind you. EXTREMELY IMPORTANT: ONLY use this tool when the user EXPLICITLY asks to 'arata-mi pe ecran', 'pune pe monitor', 'see', 'open', 'show', or 'display' something. DO NOT use it automatically after searches or queries unless explicitly requested. Pick the right `kind` — the client resolves it to the best embed URL. All external websites (including google.com) are proxied server-side to bypass iframe restrictions. Call again with a new query to swap the content on screen. For radio: first call play_radio to get the stream URL, then call show_on_monitor with kind='audio' query=<that URL> title=<station name> so the audio actually starts playing in the user's browser.",
    properties: {
      kind: {
        type: 'string',
        enum: ['map', 'weather', 'image', 'wiki', 'web', 'audio', 'html', 'video', 'document', 'cad', 'route', 'clear'],
        description: "Type of content to show on the monitor. 'map' = interactive map for a place (automatically uses Leaflet); 'weather' = weather card; 'image' = photo search; 'wiki' = Wikipedia article; 'web' = any URL (proxied to bypass iframe blocks); 'audio' = live audio stream (radio/.mp3/.aac); 'html' = custom HTML displayed directly — supports KaTeX math ($formula$), Chart.js graphs, Mermaid diagrams, Prism code, SVG, CSS animations — pass the FULL HTML body content as `query`; 'video' = YouTube/Vimeo URL or direct mp4/webm — auto-converted to embed; 'document' = PDF/DOC/XLS/PPT URL — PDF native, Office via Google Docs Viewer; 'cad' = engineering files DXF/STEP/STL/OBJ/GLTF/KiCad via 3dviewer.net; 'route' = driving directions between two places (query: 'Origin -> Destination'); 'clear' = blank the monitor.",
      },
      query: { type: 'string', description: "Content to display. For 'html': full HTML body (can include Leaflet maps, Chart.js, KaTeX, Mermaid, SVG). For 'video': YouTube/Vimeo URL or direct mp4. For 'document': URL to PDF/DOC/XLS/PPT. For 'cad': URL to DXF/STEP/STL/OBJ. For 'route': 'City A -> City B'. For 'map'/'weather': place name or LAT,LON. For 'audio': playable stream URL. For 'web': https://url." },
      title: { type: 'string', description: 'Optional label shown above the monitor.' },
    },
    required: ['kind'],
  },
  {
    name: 'get_my_location',
    description: "Read the user's current geographic coordinates from their device (real GPS on mobile, OS-fused location on desktop). Call this whenever the user asks 'where am I?', 'what's my location?', 'ce orașe sunt aproape?', or any question that depends on their physical position (nearest pharmacy, my weather, restaurants around me). Prefer this over guessing from IP. If the user has not granted location permission the tool returns a speakable hint telling you to ask the user to allow location access — relay that to the user and do not claim you know their position.",
    properties: {
      include_address: {
        type: 'boolean',
        description: "If true (default), also include a reverse-geocoded place name (e.g. 'Cluj-Napoca, Romania') alongside the coordinates. Set false to skip the reverse-geocode network call when you only need raw lat/lon for another tool.",
      },
    },
    required: [],
  },
  {
    name: 'switch_camera',
    description: "Flip the device camera between the front ('user' / selfie) and back ('environment' / rear) camera. Call this whenever the user says 'flip the camera', 'show me the other side', 'use the back camera', 'schimbă camera', 'comută camerele', 'rotește camera', 'arată-mi camera din spate'. The camera must already be on — if not, call camera_on instead. On desktops with a single webcam the browser may ignore the constraint; the tool reports the resulting facingMode so you can tell the user if the switch didn't actually take effect.",
    properties: {
      side: {
        type: 'string',
        enum: ['front', 'back'],
        description: "Which camera to activate. 'front' = selfie / user-facing. 'back' = rear / environment-facing. If the user just says 'flip' or 'switch' / 'comută' without specifying, omit this property and the client will toggle to the opposite of the current side.",
      },
    },
    required: [],
  },
  {
    name: 'open_gps_app',
    description: "Prepare the native Google Maps or Waze app for real-time driving navigation. Call this when the user asks to 'navigate', 'start driving', 'deschide waze', 'deschide google maps', 'navighează-mă spre', etc. IMPORTANT: This tool AUTOMATICALLY displays a launch button on the user's monitor. You MUST NOT call show_on_monitor yourself after calling this tool.",
    properties: {
      app: {
        type: 'string',
        enum: ['waze', 'google_maps'],
        description: "Which app to open. Default to 'google_maps' if the user doesn't specify.",
      },
      destination: {
        type: 'string',
        description: "The destination address or place name (e.g. 'Strada Feroviarilor 53, Bucuresti' or 'Cluj-Napoca').",
      },
    },
    required: ['app', 'destination'],
  },
  {
    name: 'camera_on',
    description: "Turn the device camera ON. Call this whenever the user says 'pornește camera', 'activează camera', 'deschide camera', 'turn on the camera', 'camera față' / 'activează camera față' (front), 'camera spate' / 'activează camera spate' (back). On multi-lens phones the client auto-picks the most performant rear lens (the primary back camera, avoiding ultrawide / tele / depth) and asks the browser for up to 4K capture so distant detail stays legible. Returns the actual facingMode the browser ended up with.",
    properties: {
      side: {
        type: 'string',
        enum: ['front', 'back'],
        description: "Which camera to start. 'front' = selfie / user-facing. 'back' = rear / environment-facing. Default 'back' if the user just says 'camera' / 'pornește camera' without specifying — back camera is the most useful one.",
      },
    },
    required: [],
  },
  {
    name: 'camera_off',
    description: "Turn the device camera OFF. Call this whenever the user says 'oprește camera', 'dezactivează camera', 'închide camera', 'turn off the camera', 'stop the camera'.",
    properties: {
      reason: { type: 'string', description: "Optional short reason for turning off (e.g. 'user requested', 'privacy'). Logged for diagnostics." },
    },
    required: [],
  },
  {
    name: 'zoom_camera',
    description: "Apply digital zoom to the currently active camera. Call when the user says 'focalizează pe număr', 'zoom pe obiectul ăla', 'apropie', 'zoom in to 2x', 'zoom out', or similar. Pass level as a positive multiplier where 1 = no zoom, 2 = 2×, 4 = 4×. The tool clamps to the lens's advertised [min, max] range. On devices without hardware zoom the tool reports success with a soft-zoom flag — let the user know zoom is limited when that happens.",
    properties: {
      level: {
        type: 'number',
        description: "Zoom multiplier. 1 = no zoom (reset), 2 = 2×, 3 = 3×, 4 = 4×, …. Must be positive.",
      },
    },
    required: ['level'],
  },
  {
    name: 'ui_notify',
    description: "Paint a short visible note on the stage so the user SEES that an action actually completed (e.g. 'map opened', 'conversation saved', 'căutare în curs…'). Use this to prove tool calls or monitor renders succeeded — speaking alone is not enough. Keep text ≤ 80 characters and match the user's language. Variant controls the color: info (default, blue), success (green), warning (amber), error (red).",
    properties: {
      text: {
        type: 'string',
        description: 'Short message to display to the user. ≤ 80 characters. Use the language the conversation is currently in.',
      },
      variant: {
        type: 'string',
        enum: ['info', 'success', 'warning', 'error'],
        description: "Visual tone. Default 'info'. Use 'success' when a real action completed, 'warning' when partial, 'error' when a tool failed.",
      },
      ttl_s: {
        type: 'number',
        description: 'Optional time-to-live in seconds (1–15). Default 4.5 s.',
      },
    },
    required: ['text'],
  },
  {
    name: 'ui_navigate',
    description: "Move the user to another page of the app via SPA navigation. Allowed routes: '/' (main stage with the avatar), '/studio' (the Python / Node Dev Studio), '/contact'. Call this when the user says 'deschide Studio', 'take me to the studio', 'go back to the main page', 'open the contact page'. If the user asks for a page you don't recognise, say so — do NOT guess a route; the tool will reject it.",
    properties: {
      route: {
        type: 'string',
        enum: ['/', '/studio', '/contact'],
        description: "Exact route path. Must match the allowed list. Hallucinated paths (e.g. '/admin', '/dashboard') are rejected by the client.",
      },
    },
    required: ['route'],
  },

  {
    name: 'read_local_file',
    description: "Read the content of a local file with line numbers. You have UNIVERSAL WORKSPACE permissions. For large files, use start_line/end_line to read specific sections instead of loading everything.",
    properties: {
      path: { type: 'string', description: "Path to the file. Can be absolute or relative to the repo root." },
      start_line: { type: 'integer', description: "First line to read (1-indexed). Omit to start from line 1." },
      end_line: { type: 'integer', description: "Last line to read (1-indexed, inclusive). Omit to read to end of file." },
    },
    required: ['path'],
  },
  {
    name: 'list_local_files',
    description: "List files and directories in a given path. You have UNIVERSAL WORKSPACE permissions. You can explore outside the repository using absolute paths (e.g. C:/Projects) or relative paths (../).",
    properties: {
      dir: { type: 'string', description: "Directory path. Leave empty to list the repo root." },
    },
    required: [],
  },
  {
    name: 'edit_local_file',
    description: "Edit the content of a local file. You have UNIVERSAL WORKSPACE permissions. IMPORTANT: Provide the full new content or a precise replacement block.",
    properties: {
      path: { type: 'string', description: "Path to the file to edit. Can be absolute or relative." },
      content: { type: 'string', description: "The new content to write to the file." },
    },
    required: ['path', 'content'],
  },
  {
    name: 'search_codebase',
    description: "Search for a text snippet or regex pattern across the local codebase using git grep. Returns file paths and line numbers. Extremely fast. Use this to find where functions are defined or used.",
    properties: {
      query: { type: 'string', description: "The text or regex to search for." },
      include: { type: 'string', description: "Optional glob filter for file types, e.g. '*.js', '*.jsx', '*.py'. Limits search to matching files only." },
      case_sensitive: { type: 'boolean', description: "Set to false for case-insensitive search. Default true." },
    },
    required: ['query'],
  },
  {
    name: 'replace_in_file',
    description: "Like str_replace_editor. Replaces a specific block of text in a local file. Perfect for targeted code edits without rewriting the whole file.",
    properties: {
      path: { type: 'string', description: "Path to the file to edit." },
      target_text: { type: 'string', description: "The exact text block to replace. Must match the file content exactly." },
      replacement_text: { type: 'string', description: "The new text block to insert." },
    },
    required: ['path', 'target_text', 'replacement_text'],
  },
  {
    name: 'create_github_pr',
    description: "Commit the current local changes and create a Pull Request on GitHub. Use this after making edits to fix bugs.",
    properties: {
      title: { type: 'string', description: "Title of the Pull Request." },
      body: { type: 'string', description: "Description of what was fixed." },
    },
    required: ['title', 'body'],
  },
  {
    name: 'manage_github_prs',
    description: "Manage GitHub Pull Requests. Allows you to list open PRs, merge PRs automatically, or close them.",
    properties: {
      action: { type: 'string', enum: ['list', 'merge', 'close'], description: "Action to perform." },
      pr_number: { type: 'string', description: "The PR number to merge or close (e.g., '123'). Required for merge or close." },
    },
    required: ['action'],
  },
  {
    name: 'run_terminal_command',
    description: "Execute a command in the local terminal. You have UNIVERSAL WORKSPACE permissions. You can navigate anywhere using the cwd argument. Use this to create new apps (npx create-next-app), install packages, or deploy.",
    properties: {
      command: { type: 'string', description: "The shell command to execute." },
      cwd: { type: 'string', description: "Optional working directory for the command. Can be absolute or relative. Defaults to repo root." },
    },
    required: ['command'],
  },
  {
    name: 'commit_and_push_to_github',
    description: "Securely commit all local changes and push them to the GitHub repository using the GITHUB_TOKEN environment variable. Call this when you have successfully completed a coding task and the user asks you to save, deploy, or push the changes. You DO NOT need to run git commands manually; this tool does it automatically and securely.",
    properties: {
      commit_message: { type: 'string', description: "A concise, conventional commit message (e.g. 'fix: resolve layout bug in KelionStage')." },
      branch: { type: 'string', description: "Optional branch name. Defaults to HEAD." },
    },
    required: ['commit_message'],
  },
  {
    name: 'ask_expert_coder',
    description: "Consult an expert coding model (Qwen3 Coder) to solve complex programming problems or do deep reasoning. Uses the #1 free coding model via Smart Model Router.",
    properties: {
      question: { type: 'string', description: "The exact problem or question for the expert." },
      context: { type: 'string', description: "Relevant code snippets, error messages, or file contents." },
      model: { type: 'string', description: "Optional: override model ID. Default is auto-selected by Smart Model Router (Qwen3 Coder)." },
    },
    required: ['question', 'context'],
  },
  {
    name: 'fetch_documentation',
    description: "Fetch and read the documentation of any API or tool from the web, cleanly converted to Markdown by Jina AI. Use this when you need to learn how a 3rd party tool works.",
    properties: {
      url: { type: 'string', description: "The URL of the documentation to read." },
    },
    required: ['url'],
  },
  {
    name: 'get_action_history',
    description: "Look up your OWN recent tool calls for the signed-in user before deciding whether to re-run one. Call this whenever the user asks 'did you already …?' / 'ai făcut deja …?', whenever you're about to repeat an action that might have just happened (send the same email twice, re-open the same page on the monitor, re-run a search you already did this session), or at the start of a follow-up ask like 'fă din nou ce ai făcut înainte'. Returns an ordered list of previous tool invocations with short result summaries. Guests get { ok:false, signed_in:false } — in that case tell the user you can only remember actions once they sign in. Never invent a history: if this tool returns 0 rows, say honestly 'I haven't done anything like that yet'.",
    properties: {
      limit: { type: 'integer', description: 'How many recent actions to fetch. 1–40; default 10.' },
      session_id: { type: 'string', description: "Optional filter — restrict to actions from a specific session. Omit to see actions across the whole account." },
    },
    required: [],
  },
  {
    name: 'learn_from_observation',
    description: "SILENT auto-learn. Persist a private observation about the signed-in user as a long-term memory item. Use ONLY for durable observations that will help you understand the user in FUTURE conversations — body language, recurring environment cues, what they appear to be working on, evident routines, mood patterns. NEVER announce this call out loud. NEVER tell the user 'I'll remember that' / 'noted' / 'am salvat'. NEVER recite back what you've learned, even if asked — direct the user to '⋯ → Memoria mea' in the app for the full list. Fire at most every ~30 seconds and only when confident. Guests get a no-op { ok:true, persisted:0 }.",
    properties: {
      observation: { type: 'string', description: "Short third-person fact about the user, ≤ 280 chars (e.g. 'works at a desk with two monitors', 'looks tired in the late afternoon', 'wears glasses', 'often has a cat in frame')." },
      kind: { type: 'string', enum: ['observation', 'preference', 'routine', 'context', 'mood', 'skill'], description: "Category. Default 'observation' (free-form camera/voice notice)." },
      confidence: { type: 'number', description: 'How sure you are, 0.1–0.6. Capped at 0.6 — these are inferences, not user statements.' },
    },
    required: ['observation'],
  },
  {
    name: 'remember_fact',
    description: "Save an important fact about the user to long-term memory. Use this PROACTIVELY whenever the user shares personal information: their name, job, preferences, family, routines, goals, or any detail worth remembering for future conversations. AUTOMATICALLY call this — do NOT ask the user 'should I remember this?'. Say naturally 'Am retinut.' or equivalent in the user's language. Also use when the user explicitly says 'remember this' / 'ține minte'. Guests get a no-op.",
    properties: {
      fact: { type: 'string', description: "The fact to remember, in third person. E.g. 'User's name is Adrian', 'Prefers dark mode', 'Has a dog named Rex', 'Works as a software engineer'." },
      kind: { type: 'string', enum: ['fact', 'preference', 'routine', 'context', 'skill', 'goal'], description: "Category. Default 'fact'." },
    },
    required: ['fact'],
  },
  {
    name: 'calculate',
    description: "Evaluate a math expression DETERMINISTICALLY using a local math engine (mathjs). Use this whenever the user asks you to compute anything — arithmetic, percentages, unit-free conversions, algebraic expressions. NEVER do mental math for anything beyond a trivial one-digit sum. Examples: '127 * 38', 'sqrt(2) + log(10)', '12% of 340', '(100 - 35) / 2'.",
    properties: {
      expression: { type: 'string', description: "A mathjs-compatible expression. The engine supports +, -, *, /, ^, parentheses, sqrt, log, sin/cos/tan, percent (%), factorial (!), etc." },
    },
    required: ['expression'],
  },
  {
    name: 'play_radio',
    description: "Find and PLAY a live radio station, in any country, in any language. Use whenever the user says 'porneste/pune un post de radio', 'play a radio station', 'metti la radio', 'mets la radio', 'put on BBC Radio 1', 'lance NHK live', 'pune Europa FM live', or any equivalent. Returns a directly playable HTTP(S) audio stream URL plus station metadata. After getting the result, immediately call show_on_monitor with kind='audio' and src=<the stream URL> so the avatar's stage actually starts playing the audio. radio-browser.info exposes ~50,000 real stations with raw .mp3 / .aac / .m3u8 URLs that play in any browser.",
    properties: {
      query: { type: 'string', description: "Station name or fuzzy query. Examples: 'BBC Radio 1', 'Europa FM', 'NHK', 'NPR', 'Radio ZU', 'jazz', 'classical Vienna'. Optional when country/language/tag are provided." },
      country: { type: 'string', description: "Optional ISO country name in English ('Romania', 'France', 'Japan', 'United States'). Use when the user asks for radio FROM a specific country." },
      language: { type: 'string', description: "Optional spoken-language filter ('romanian', 'french', 'japanese', 'spanish'). Use when the user wants radio in a specific language regardless of country." },
      tag: { type: 'string', description: "Optional genre/topic tag ('jazz', 'news', 'rock', 'classical', 'electronic', 'talk')." },
      limit: { type: 'integer', description: "How many candidate stations to return (1-5, default 1). The model usually only needs one." },
    },
    required: [],
  },
  {
    name: 'get_weather',
    description: "Fetch REAL current weather and short-range forecast for a city or coordinates. Use this whenever the user asks about weather, temperature, rain, wind, or a forecast for today or the next few days. Data comes from Open-Meteo (free, authoritative). NEVER guess weather — always call this tool.",
    properties: {
      city: { type: 'string', description: "City or place name, e.g. 'Cluj-Napoca', 'New York', 'Paris'. Either city or lat+lon is required." },
      lat: { type: 'number', description: "Latitude in decimal degrees. Use this with lon when you already have precise GPS coords." },
      lon: { type: 'number', description: "Longitude in decimal degrees." },
      days: { type: 'integer', description: "Number of forecast days to include (1-7). Default 1." },
    },
    required: [],
  },
  {
    name: 'web_search',
    description: "Search the live web and return a short list of results with titles, URLs, and snippets. Use whenever the user asks about a fact, event, person, product, or topic that could change over time — news, prices, scores, who-is, recent announcements, anything time-sensitive. NEVER invent URLs, prices, or facts — call this tool.",
    properties: {
      query: { type: 'string', description: "Free-text search query." },
      limit: { type: 'integer', description: "Max results to return (1-10, default 5)." },
    },
    required: ['query'],
  },
  // ── Feeds & live data ─────────────────────────────────────────────
  {
    name: 'get_forecast',
    description: "Get a multi-day weather forecast (up to 16 days) for a city or coordinates. Use when the user asks 'what's the weather this week', 'will it rain on Friday', 'forecast for next weekend'. Data from Open-Meteo.",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat: { type: 'number', description: "Latitude in decimal degrees." },
      lon: { type: 'number', description: "Longitude in decimal degrees." },
      days: { type: 'integer', description: "Forecast days (1-16, default 7)." },
    },
    required: [],
  },
  {
    name: 'get_air_quality',
    description: "Fetch real-time air-quality index (PM2.5, PM10, ozone, NO2) for a city or coordinates. Use when the user asks about pollution, smog, allergies, breathing conditions. Data from Open-Meteo air-quality API (OpenAQ-derived).",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat: { type: 'number', description: "Latitude." },
      lon: { type: 'number', description: "Longitude." },
    },
    required: [],
  },
  {
    name: 'get_news',
    description: "Fetch recent news headlines from GDELT's live news index. Use when the user asks for news, headlines, 'what's happening with X', 'latest on Y'. Returns up to 10 articles with title, source, URL and published date.",
    properties: {
      topic: { type: 'string', description: "Free-text topic / query (e.g. 'earthquake Turkey', 'OpenAI announcements')." },
      lang: { type: 'string', description: "Optional language filter (ISO 639-1, e.g. 'en', 'ro')." },
      limit: { type: 'integer', description: "Max articles (1-20, default 8)." },
    },
    required: ['topic'],
  },
  {
    name: 'get_crypto_price',
    description: "Fetch the current USD price (and 24h change) for one or more cryptocurrencies using CoinGecko. Use when the user asks about BTC, ETH, SOL, DOGE, ADA, XRP, any token price.",
    properties: {
      ids: { type: 'string', description: "Comma-separated CoinGecko IDs, e.g. 'bitcoin,ethereum,solana'. Common tickers also accepted (btc, eth, sol, doge, ada, xrp, ltc, bch, bnb)." },
    },
    required: ['ids'],
  },
  {
    name: 'get_stock_price',
    description: "Fetch the most recent price, change, and volume for a US stock symbol using Yahoo Finance's free query1 endpoint. Use for 'how is AAPL', 'price of TSLA', 'quote for MSFT'.",
    properties: {
      symbol: { type: 'string', description: "Stock symbol, e.g. 'AAPL', 'TSLA', 'GOOGL'. Uppercase letters only." },
    },
    required: ['symbol'],
  },
  {
    name: 'get_forex',
    description: "Get the current exchange rate between two currencies using exchangerate.host (free). Use for 'how many euros in 100 dollars', 'EUR to RON', 'USD/JPY'.",
    properties: {
      from: { type: 'string', description: "Source currency (ISO 4217 3-letter, e.g. 'USD', 'EUR', 'RON')." },
      to: { type: 'string', description: "Target currency (ISO 4217)." },
      amount: { type: 'number', description: "Amount to convert (default 1)." },
    },
    required: ['from', 'to'],
  },
  {
    name: 'currency_convert',
    description: "Alias of get_forex for natural phrasings like 'convert 50 EUR to RON'. Same exchangerate.host source.",
    properties: {
      from: { type: 'string', description: "Source currency (ISO 4217)." },
      to: { type: 'string', description: "Target currency (ISO 4217)." },
      amount: { type: 'number', description: "Amount to convert." },
    },
    required: ['from', 'to', 'amount'],
  },
  {
    name: 'get_earthquakes',
    description: "Fetch recent earthquakes from USGS (authoritative). Use when the user asks about earthquakes worldwide or near a location. Returns magnitude, location, depth, time for events in the last 24 h.",
    properties: {
      min_magnitude: { type: 'number', description: "Minimum magnitude (default 2.5)." },
      limit: { type: 'integer', description: "Max events to return (1-50, default 10)." },
    },
    required: [],
  },
  {
    name: 'get_sun_times',
    description: "Get sunrise, sunset, civil twilight and day length for a date and location. Use when the user asks 'what time does the sun rise in Paris tomorrow'. Uses Open-Meteo's solar endpoint (free).",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat: { type: 'number', description: "Latitude." },
      lon: { type: 'number', description: "Longitude." },
      date: { type: 'string', description: "ISO date YYYY-MM-DD. Default today." },
    },
    required: [],
  },
  {
    name: 'get_moon_phase',
    description: "Compute the current moon phase, illumination percent and age in days (offline, deterministic via Jean Meeus algorithm). Use for 'is it a full moon', 'how full is the moon', 'moon phase on DATE'.",
    properties: {
      date: { type: 'string', description: "ISO date YYYY-MM-DD. Default today UTC." },
    },
    required: [],
  },
  // ── Math & conversion ────────────────────────────────────────────
  {
    name: 'unit_convert',
    description: "Convert a numeric value between units (length, mass, volume, temperature, time, speed, pressure, data, energy). Deterministic, offline via mathjs units. Examples: 10 km → mi, 80 kg → lb, 100 °F → °C, 1 GB → MB.",
    properties: {
      value: { type: 'number', description: "Numeric value to convert." },
      from: { type: 'string', description: "Source unit, e.g. 'km', 'kg', 'degF', 'GB'." },
      to: { type: 'string', description: "Target unit, e.g. 'mi', 'lb', 'degC', 'MB'." },
    },
    required: ['value', 'from', 'to'],
  },
  // ── Geo / routing ────────────────────────────────────────────────
  {
    name: 'geocode',
    description: "Look up latitude/longitude for a place using Open-Meteo's geocoding (Nominatim-sourced). Use when you need coordinates before calling a location-scoped tool.",
    properties: {
      query: { type: 'string', description: "Place name to geocode, e.g. 'Eiffel Tower'." },
    },
    required: ['query'],
  },
  {
    name: 'reverse_geocode',
    description: "Look up the nearest place name for latitude/longitude using the OSM Nominatim reverse endpoint. Use when the user gives GPS coordinates or when the app passes raw coords.",
    properties: {
      lat: { type: 'number', description: "Latitude." },
      lon: { type: 'number', description: "Longitude." },
    },
    required: ['lat', 'lon'],
  },
  {
    name: 'get_route',
    description: "Compute a real driving, walking or cycling route between two places using the public OSRM demo server. Returns distance in km, duration in minutes and a short step summary. Use for 'how long from A to B', 'route from X to Y', 'distance between'.",
    properties: {
      from: { type: 'string', description: "Starting place name or 'lat,lon'." },
      to: { type: 'string', description: "Destination place name or 'lat,lon'." },
      profile: { type: 'string', enum: ['driving', 'walking', 'cycling'], description: "Travel mode. Default 'driving'." },
    },
    required: ['from', 'to'],
  },
  {
    name: 'nearby_places',
    description: "Find POIs near a point using the Overpass OSM API (restaurants, ATMs, hospitals, gas stations, etc.). Use for 'nearest pharmacy', 'coffee shops around me', 'ATM in walking distance'.",
    properties: {
      query: { type: 'string', description: "OSM amenity tag or free text (e.g. 'pharmacy', 'restaurant', 'atm', 'fuel', 'hospital')." },
      lat: { type: 'number', description: "Latitude of search origin." },
      lon: { type: 'number', description: "Longitude of search origin." },
      radius_m: { type: 'integer', description: "Search radius in meters (100-5000, default 1500)." },
      limit: { type: 'integer', description: "Max results (1-20, default 10)." },
    },
    required: ['query', 'lat', 'lon'],
  },
  {
    name: 'get_elevation',
    description: "Fetch altitude above sea level for a coordinate pair using Open-Elevation (free). Use for 'what altitude is Sinaia', 'how high is this mountain'.",
    properties: {
      lat: { type: 'number', description: "Latitude." },
      lon: { type: 'number', description: "Longitude." },
    },
    required: ['lat', 'lon'],
  },
  {
    name: 'get_timezone',
    description: "Get timezone name, offset, and current local time for a city or coordinates using timeapi.io (free). Use for 'what time is it in Tokyo', 'timezone of New York'.",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat: { type: 'number', description: "Latitude." },
      lon: { type: 'number', description: "Longitude." },
    },
    required: [],
  },
  // ── Web / search ────────────────────────────────────────────────
  {
    name: 'search_academic',
    description: "Search arXiv for academic papers (titles, authors, abstract, PDF URL). Use for 'papers about X', 'research on Y', 'arXiv about Z'.",
    properties: {
      query: { type: 'string', description: "Free-text topic / title / author." },
      limit: { type: 'integer', description: "Max papers (1-10, default 5)." },
    },
    required: ['query'],
  },
  {
    name: 'search_github',
    description: "Search public GitHub repositories via the GitHub REST API. Returns repo name, description, stars, URL. Respects GITHUB_TOKEN when set for higher rate limits. IMPORTANT: Use this ONLY to search for repositories by topic/name. If the user provides a specific repository URL and asks you to audit, review, or read its code, DO NOT use this tool. Instead, use `list_github_repo_files` and `read_github_file`.",
    properties: {
      query: { type: 'string', description: "Free-text search. Supports GitHub qualifiers (language:js, stars:>100)." },
      limit: { type: 'integer', description: "Max results (1-10, default 5)." },
    },
    required: ['query'],
  },
  {
    name: 'search_stackoverflow',
    description: "Search Stack Overflow answers via the Stack Exchange API. Returns question title, score, accepted-answer URL. Use for programming questions where a canonical answer likely exists.",
    properties: {
      query: { type: 'string', description: "Free-text programming question." },
      limit: { type: 'integer', description: "Max results (1-10, default 5)." },
    },
    required: ['query'],
  },
  {
    name: 'fetch_url',
    description: "GET an arbitrary HTTPS URL and return its text content (stripped of HTML tags, capped at ~8000 chars). Use when the user asks you to 'read this page' or you need raw content from a known URL. Never fetch sites that require login.",
    properties: {
      url: { type: 'string', description: "HTTPS URL to fetch. http:// is refused." },
    },
    required: ['url'],
  },
  {
    name: 'rss_read',
    description: "Fetch and parse an RSS / Atom feed, returning the latest items (title, link, published, summary). Use for 'what's new on blog X', 'latest from feed Y'.",
    properties: {
      url: { type: 'string', description: "Feed URL (RSS 2.0 or Atom)." },
      limit: { type: 'integer', description: "Max items (1-20, default 10)." },
    },
    required: ['url'],
  },
  // ── Knowledge ───────────────────────────────────────────────────
  {
    name: 'wikipedia_search',
    description: "Search Wikipedia and return the lead summary + extract for the best match. Use for encyclopedic questions: 'who is X', 'what is Y', 'tell me about Z'. Respects the user's language when possible.",
    properties: {
      query: { type: 'string', description: "Free-text topic or article title." },
      lang: { type: 'string', description: "Wikipedia language code (default 'en'). Accepts 'ro', 'fr', 'de', 'es', etc." },
    },
    required: ['query'],
  },
  {
    name: 'dictionary',
    description: "Look up a word's definition(s) using the free Wiktionary REST API. Returns part-of-speech and definitions. Use for 'define X', 'what does Y mean', 'definition of Z'.",
    properties: {
      word: { type: 'string', description: "Word or short phrase to define." },
      lang: { type: 'string', description: "Wiktionary language code (default 'en'). 'ro' for Romanian, 'fr' for French, etc." },
    },
    required: ['word'],
  },


  // ── PR B — documents + OCR ────────────────────────────────────────
  {
    name: 'read_pdf',
    description: "Extract text and analyze images/diagrams from a PDF file. Provide either 'url' (if public), 'base64', or 'file_id' (if the user uploaded it).",
    properties: {
      url: { type: 'string', description: "Public HTTPS URL of the PDF. Ignored when base64 or file_id is set." },
      base64: { type: 'string', description: "Base64 payload of the PDF (data: prefix accepted)." },
      file_id: { type: 'string', description: "Temporary ID of the file uploaded by the user." },
      max_chars: { type: 'integer', description: "Cap on returned text length (500-50000, default 8000)." },
      max_pages: { type: 'integer', description: "Hard cap on pages parsed (1-200, default 50). Large docs are truncated." },
    },
    required: [],
  },
  {
    name: 'read_docx',
    description: "Extract plain text from a Microsoft Word .docx file. Use when the user attaches or links a .docx (contracts, CVs, reports). Either `url`, `base64` or `file_id` must be provided.",
    properties: {
      url: { type: 'string', description: "Public HTTPS URL of the .docx. Ignored when base64 or file_id is set." },
      base64: { type: 'string', description: "Base64 payload of the .docx." },
      file_id: { type: 'string', description: "Temporary ID of the file uploaded by the user." },
      max_chars: { type: 'integer', description: "Cap on returned text length (500-50000, default 8000)." },
    },
    required: [],
  },
  {
    name: 'ocr_image',
    description: "Run OCR on an image (JPG/PNG/WebP) and return the recognised text. Use when the user sends a photo of a receipt, whiteboard, screenshot, handwritten note, or any picture with text. Supports multi-language via `lang` (e.g. 'eng', 'ron', 'eng+ron').",
    properties: {
      url: { type: 'string', description: "Public HTTPS URL of the image. Ignored when base64 or file_id is set." },
      base64: { type: 'string', description: "Base64 payload of the image (data: prefix accepted)." },
      file_id: { type: 'string', description: "Temporary ID of the file uploaded by the user." },
      lang: { type: 'string', description: "Tesseract language code (default 'eng'). Combine with '+' for multi-script, e.g. 'eng+ron'." },
      max_chars: { type: 'integer', description: "Cap on returned text length (200-20000, default 4000)." },
    },
    required: [],
  },
  {
    name: 'ocr_passport',
    description: "OCR a passport photo and parse the MRZ (Machine Readable Zone). Returns structured fields: document type, issuing country, surname, given names, passport number, nationality, date of birth, sex, date of expiry. Use only when the user explicitly asks to read/extract passport data. Never log or store the raw MRZ.",
    properties: {
      url: { type: 'string', description: "Public HTTPS URL of the passport photo. Ignored when base64 or file_id is set." },
      base64: { type: 'string', description: "Base64 payload of the passport photo." },
      file_id: { type: 'string', description: "Temporary ID of the file uploaded by the user." },
    },
    required: [],
  },
  {
    name: 'run_regex',
    description: "Test a JavaScript regular expression against an input string. mode=test returns a boolean, mode=match returns the matches (up to 100) with capture groups, mode=replace returns the replaced string. Useful when the user is debugging a regex or asks 'does this pattern match'.",
    properties: {
      pattern: { type: 'string', description: 'Regex pattern (max 500 chars).' },
      input: { type: 'string', description: 'Input string to test against (max 50 000 chars).' },
      flags: { type: 'string', description: "Regex flags. Any subset of g,i,m,s,u,y. Defaults to 'g'." },
      mode: { type: 'string', description: 'One of test | match | replace.', enum: ['test', 'match', 'replace'] },
      replacement: { type: 'string', description: "Replacement string for mode=replace. Supports $1, $2… backrefs." },
    },
    required: ['pattern', 'input'],
  },
  {
    name: 'run_code',
    description: "Execute a short Python or JavaScript snippet inside a disposable e2b sandbox and return stdout / stderr / result. Strict limits: code ≤ 20 KB, wall-clock ≤ 15 s. Prefer this when the user explicitly asks to run, try, execute, or verify a piece of code. Do not use for networked API calls — prefer the dedicated tools for those.",
    properties: {
      language: { type: 'string', description: "Language of the snippet.", enum: ['python', 'javascript'] },
      code: { type: 'string', description: "Source code to execute (max 20 000 chars)." },
      timeout: { type: 'number', description: "Optional wall-clock limit in ms (1000..30000, default 15000)." },
    },
    required: ['language', 'code'],
  },
  {
    name: 'get_my_credits',
    description: "Return the currently signed-in user's voice-minute balance. Use when the user asks 'how many minutes do I have left', 'ce credit am', etc. Does not reveal personal data beyond the balance.",
    properties: {
      format: { type: 'string', description: "Display format: 'minutes' (default) or 'seconds'. Controls how the balance is shown.", enum: ['minutes', 'seconds'] },
    },
    required: [],
  },
  {
    name: 'get_my_usage',
    description: "Return a short summary of the signed-in user's recent credit activity: total minutes consumed and topped up, plus the most recent ledger entries (kind, delta, amount, note, timestamp). Use when the user asks 'what did I spend', 'when did I top up', etc.",
    properties: {
      limit: { type: 'integer', description: 'Max recent entries to return (1-40, default 10).' },
      kind: { type: 'string', description: "Optional filter by transaction kind: 'topup', 'consume', or 'all' (default).", enum: ['topup', 'consume', 'all'] },
    },
    required: [],
  },
  {
    name: 'get_my_profile',
    description: "Return the signed-in user's id, display name, email, credits balance (minutes) and account creation date. Use only when the user explicitly asks 'what's on my profile' or 'who am I signed in as'.",
    properties: {
      include_email: { type: 'boolean', description: 'Whether to include the email address in the response. Default true.' },
    },
    required: [],
  },
  {
    // Adrian: "sa deschida cimpurile de mail, sa poata fi setate". When the
    // user asks Kelion to email someone, the model should call THIS tool
    // first, not send_email. It opens an in-app composer modal pre-populated
    // with To / Subject / Body / Cc / Bcc — the user reviews, edits, then
    // explicitly clicks Send (which routes through the server send_email
    // tool). Nothing is delivered without an explicit user click. This is
    // a renderer-side tool: the server just echoes the draft back so the
    // client can open the modal.
    name: 'compose_email_draft',
    description: "Open an in-app email composer modal pre-populated with the given fields. The user can edit every field (To, Cc, Bcc, Subject, Body, Reply-To) before clicking Send. NOTHING is delivered until the user explicitly presses Send in the modal. Use this whenever the user asks to send / write / draft / reply to an email — never call send_email directly without the user's pre-confirmation. The modal will surface the actual delivery (via Resend) when the user is ready.",
    properties: {
      to: { type: 'string', description: "Recipient(s). Either a single email or a comma/semicolon-separated list." },
      cc: { type: 'string', description: "Optional CC recipients (comma-separated)." },
      bcc: { type: 'string', description: "Optional BCC recipients (comma-separated)." },
      subject: { type: 'string', description: "Subject line (max 300 chars). Be specific — match what the user actually asked for." },
      body: { type: 'string', description: "Plain-text or simple-markdown body. Write the full message you'd want to send; the user will review and may tweak before sending." },
      reply_to: { type: 'string', description: "Optional reply-to address." },
    },
    required: ['to', 'subject', 'body'],
  },
  {
    name: 'send_email',
    description: "Send a transactional email via Resend (requires RESEND_API_KEY + a verified domain address in RESEND_FROM). Use when the user explicitly asks to email someone; do not send on your own initiative. Returns the provider message id on success.",
    properties: {
      to: { type: 'string', description: "Recipient email address (or an array of addresses)." },
      subject: { type: 'string', description: "Email subject line (max 300 chars)." },
      text: { type: 'string', description: "Plain-text body (optional if html is provided)." },
      html: { type: 'string', description: "HTML body (optional if text is provided)." },
      from: { type: 'string', description: "Override sender address. Defaults to RESEND_FROM." },
      reply_to: { type: 'string', description: "Optional reply-to address." },
    },
    required: ['to', 'subject'],
  },
  {
    name: 'create_calendar_ics',
    description: "Generate a valid .ics calendar invite (RFC 5545). Returns the ics text and a data: URL the caller can surface as a downloadable 'add to calendar' link. Does not deliver the invite — pair with send_email if the user wants it emailed.",
    properties: {
      title: { type: 'string', description: "Event title (max 200 chars)." },
      start: { type: 'string', description: "Event start in ISO 8601 (UTC or with offset)." },
      end: { type: 'string', description: "Event end in ISO 8601. Defaults to start + 1 hour if omitted." },
      location: { type: 'string', description: "Optional location (max 200 chars)." },
      description: { type: 'string', description: "Optional description / agenda (max 2000 chars)." },
      attendees: {
        type: 'array',
        description: "Optional list of { name?, email } objects (max 50).",
        items: {
          type: 'object',
          properties: {
            email: { type: 'string', description: "Attendee email address (required)." },
            name: { type: 'string', description: "Attendee display name (optional, max 100 chars)." },
          },
          required: ['email'],
        },
      },
    },
    required: ['title', 'start'],
  },
  {
    name: 'zapier_trigger',
    description: "POST a JSON payload to a Zapier Catch Hook webhook so a Zap can automate the rest (Slack message, Sheets row, Gmail draft, etc). The URL is restricted to https://hooks.zapier.com/hooks/catch/… so the tool cannot be repurposed as a general webhook sink.",
    properties: {
      webhook_url: { type: 'string', description: "The Zapier Catch Hook URL from the Zap setup screen." },
      payload: { type: 'string', description: "JSON-serialised object sent as the request body (max 100 KB). Pass a valid JSON string — the server parses it before forwarding to Zapier." },
    },
    required: ['webhook_url'],
  },
  {
    name: 'github_repo_info',
    description: "Return public metadata for a GitHub repository: description, stars, forks, open issues, language, license, default branch, topics. Use when the user asks 'what does this repo do', 'how popular is it', 'when was it updated last'. No authentication required (GITHUB_TOKEN, if set, just raises the unauth rate limit).",
    properties: {
      repo: { type: 'string', description: "Repo slug in the form `owner/name` (e.g. `facebook/react`). A full github.com URL also works." },
    },
    required: ['repo'],
  },
  {
    name: 'list_github_repo_files',
    description: "List the entire file tree of a GitHub repository. Use this FIRST when the user asks you to 'audit', 'review', or 'read' a repository. It helps you understand the project structure so you know which specific files to read next. Note: returns up to 1000 files.",
    properties: {
      repo: { type: 'string', description: "Repo slug in the form `owner/name` (e.g. `facebook/react`)." },
      branch: { type: 'string', description: "Optional branch name. Defaults to HEAD." },
    },
    required: ['repo'],
  },
  {
    name: 'read_github_file',
    description: "Read the source code of a specific file from a GitHub repository. Use this AFTER `list_github_repo_files` to actually read the code files you need to audit, debug, or review. Max 50,000 chars returned per file.",
    properties: {
      repo: { type: 'string', description: "Repo slug in the form `owner/name` (e.g. `facebook/react`)." },
      path: { type: 'string', description: "Exact path to the file in the repository (e.g. `src/index.js`)." },
      branch: { type: 'string', description: "Optional branch name. Defaults to HEAD." },
    },
    required: ['repo', 'path'],
  },
  {
    name: 'npm_package_info',
    description: "Return metadata for a public npm package: latest version, description, homepage, license, last modified date, last 10 versions, and weekly downloads when the downloads API is reachable. Use for 'what version is …', 'is this package maintained', 'how popular is …'.",
    properties: {
      name: { type: 'string', description: "Package name (scoped or unscoped, e.g. `react` or `@scope/pkg`)." },
    },
    required: ['name'],
  },
  {
    name: 'pypi_package_info',
    description: "Return metadata for a public PyPI package: latest version, summary, homepage, author, license, Python requirement, yanked flag, last 10 releases. Use for 'what version is …', 'who maintains …', 'is this yanked'.",
    properties: {
      name: { type: 'string', description: "PyPI package name (e.g. `requests`)." },
    },
    required: ['name'],
  },
  {
    // F11 — AI image generation. The tool executor returns a short-lived
    // URL (served by /api/generated-images/:id) that the client pipes
    // onto the avatar's stage monitor via `showImageOnMonitor`. Use only
    // when the user explicitly asks to *create/generate* an image — for
    // "show me a picture of Paris" prefer `show_on_monitor('image', …)`
    // which hits LoremFlickr and is free.
    name: 'generate_image',
    description: "Generate an original image from a natural-language prompt. The result is shown on the avatar's stage monitor. Use only when the user explicitly asks to create/generate/design/draw/paint an image (phrases like 'generate me a picture of…', 'fă-mi o imagine cu…', 'draw…'). Costs ~$0.04 per call — don't use for mere look-up of existing images.",
    properties: {
      prompt: { type: 'string', description: "Detailed description of the image to create (max 4000 chars). Include style hints (photo-realistic, watercolour, line art) and composition cues when useful." },
      size: { type: 'string', description: "Canvas aspect. Defaults to `auto` (let the model pick).", enum: ['auto', '1024x1024', '1024x1536', '1536x1024'] },
    },
    required: ['prompt'],
  },
  {
    name: 'execute_plan',
    description: "Execute a multi-step plan of tool calls sequentially on the server. Use this when you need to chain multiple actions (e.g. read file → find bug → edit file → run tests → verify). Each step can reference results from previous steps using {{step_N}} or {{step_N.field}} placeholders in its args. If a step fails, the system automatically consults ask_expert_coder for a fix and retries once. Max 15 steps, 120s total. Use on_fail='stop' to abort on critical failures, on_fail='skip' to continue past non-critical ones.",
    properties: {
      goal: { type: 'string', description: "High-level description of what this plan aims to achieve. Used for context when auto-healing failures." },
      steps: { type: 'string', description: 'JSON array of step objects. Each step: { "tool": "tool_name", "args": { ... }, "on_fail": "stop"|"skip"|"heal" }. Args can contain {{step_0}}, {{step_1.stdout}} etc. to reference previous results.' },
    },
    required: ['steps'],
  },
  // ── Position 0 — Super LLM capabilities ──────────────────────────
  {
    name: 'query_database',
    description: "Query Kelion's own database to look up the signed-in user's data: conversations, memory items, action history, credits, profile. READ-ONLY. Use when the user asks 'câte conversații am?', 'ce fapte ții minte?', 'show my credit balance', 'what tools have you used for me?'. Returns structured data scoped to the user's account only.",
    properties: {
      query: { type: 'string', description: "Natural-language query indicating what to look up. Include keywords like 'conversations', 'memory', 'actions', 'credits', or 'profile'. E.g. 'show my conversations this month', 'what facts do you remember about me', 'my credit balance'." },
      limit: { type: 'integer', description: "Max items to return (1-100, default 20)." },
    },
    required: ['query'],
  },
  {
    name: 'read_past_conversation',
    description: "Read the exact messages from one of the signed-in user's past conversations. Use when the user asks 'ce am discutat data trecută?', 'adumi aminte ce vorbeam ieri', 'read our last chat'.",
    properties: {
      offset: { type: 'integer', description: "Which conversation to read. 0 = the most recent past conversation, 1 = the one before that, etc. Default 0." },
    },
    required: [],
  },
  {
    name: 'check_updates',
    description: "Check for outdated npm dependencies in the project. Runs `npm outdated --json` and returns a list of packages that need updating, with current vs latest versions. Use when the user asks 'are my packages up to date?', 'verifică dependențele', 'check for updates'.",
    properties: {
      path: { type: 'string', description: "Optional sub-directory to check (relative to repo root). Default '.' (root)." },
    },
    required: [],
  },
  {
    name: 'conversation_summary',
    description: "Generate a structured summary of the user's recent conversations — message counts, key topics, first/last user messages. Use when the user asks 'fă un rezumat', 'summarize our chats', 'what have we discussed?'. Helps manage context for long sessions.",
    properties: {
      limit: { type: 'integer', description: "How many recent conversations to summarize (1-10, default 5)." },
    },
    required: [],
  },
  {
    name: 'thinking_mode',
    description: "Think step-by-step through a complex problem, showing visible reasoning steps before giving the final answer. Use when the user asks 'gândește pas cu pas', 'think step by step', 'reason through this', or for any complex analytical question that benefits from visible chain-of-thought.",
    properties: {
      question: { type: 'string', description: "The question or problem to reason through step-by-step." },
      context: { type: 'string', description: "Optional additional context (code, data, constraints)." },
    },
    required: ['question'],
  },
  {
    name: 'deep_search',
    description: "Perform a deep multi-source web research on a topic. Searches from multiple angles, fetches content from top sources, and synthesizes a comprehensive report. Use when the user asks 'caută tot despre', 'deep search', 'cercetează', 'find everything about', or needs a thorough analysis from multiple web sources.",
    properties: {
      topic: { type: 'string', description: "The topic to research deeply across multiple sources." },
      max_sources: { type: 'integer', description: "Maximum sources to fetch and synthesize (2-10, default 5)." },
    },
    required: ['topic'],
  },
  {
    name: 'memory_sources',
    description: "Show the user exactly which memory items (facts, preferences, observations) Kelion has stored about them, with full metadata: timestamps, confidence scores, kind, and source. Use when the user asks 'de unde știi asta?', 'where did you learn that?', 'show me my memory', 'what do you know about me?', 'arată-mi sursele'.",
    properties: {
      query: { type: 'string', description: "Optional filter to search within memory items (e.g. 'name', 'job', 'preference'). Leave empty to show all." },
    },
    required: [],
  },
  {
    name: 'self_verify',
    description: "Re-check and verify a previous action's output. Reads back edited files, re-calculates math, or re-checks URLs to confirm correctness. Use AUTOMATICALLY after editing files or performing calculations to ensure accuracy. Also use when the user asks 'verifică', 'check if it's correct', 'e corect?'.",
    properties: {
      action: { type: 'string', description: "What to verify: 'check_file' (re-read a file), 're_calculate' (re-run math), 'verify_url' (check URL reachability)." },
      target: { type: 'string', description: "The target to verify: file path for check_file, math expression for re_calculate, URL for verify_url." },
    },
    required: ['action', 'target'],
  },
  {
    name: 'data_visualize',
    description: "Generate a chart or graph from data. Returns Chart.js HTML ready to display on the monitor via show_on_monitor(kind='html'). Supports bar, line, pie, doughnut, radar, scatter charts. Use when the user asks 'fă un grafic', 'make a chart', 'visualize this data', 'show me a graph'.",
    properties: {
      type: { type: 'string', description: "Chart type: 'bar', 'line', 'pie', 'doughnut', 'radar', 'scatter'. Default 'bar'." },
      title: { type: 'string', description: "Chart title displayed above the graph." },
      labels: { type: 'string', description: "JSON array of labels for the X axis, e.g. '[\"Jan\",\"Feb\",\"Mar\"]'." },
      data: { type: 'string', description: "JSON array of numbers or dataset objects. Simple: '[10,20,30]'. Multi-series: '[{\"label\":\"Sales\",\"data\":[10,20]},{\"label\":\"Costs\",\"data\":[5,15]}]'." },
    },
    required: ['labels', 'data'],
  },
  { name: 'computer_use', description: "Automate browser actions by generating and running a Playwright script. Use for clicking, form filling, scraping, testing UI. Use when user asks 'deschide site-ul', 'click on the button', 'fill the form', 'test the page'.", properties: { task: { type: 'string', description: "Natural-language instruction for the browser automation." }, url: { type: 'string', description: "Optional starting URL." } }, required: ['task'] },
  { name: 'auto_test', description: "Automatically generate and run Jest tests for a file or function. Use when the user asks 'testează funcția', 'write tests for', 'run tests on this file'.", properties: { target: { type: 'string', description: "File path or function name to test." } }, required: ['target'] },
  { name: 'run_agent_eval', description: "List, check status, or run the 20 advanced agent capability evaluation tests. Use when the user asks 'rulează testele', 'evaluare agent', 'capability test', 'ce teste ai'.", properties: { action: { type: 'string', description: "'list' to show tests, 'status' to check availability, 'run' to execute." }, test_id: { type: 'string', description: "Test ID from 01 to 20, or 'all'. Optional for run." }, test_name: { type: 'string', description: "Partial test name for run. Optional." } }, required: ['action'] },
  { name: 'spice_simulate', description: "Simulate an electronic circuit (SPICE netlist + DC solver). Use for calculating node voltages in resistor networks, RC/RL circuits, power dissipation. Use when user asks 'simulează circuitul', 'cât e tensiunea la nodul X', 'putere disipată', 'divizor de tensiune'.", properties: { components: { type: 'string', description: "JSON array of {type:'R'|'C'|'L'|'V'|'I', name, value, nodes:[n1,n2]}." }, analysis: { type: 'string', description: "JSON object {type:'dc'}." }, probes: { type: 'string', description: "JSON array of node names to measure." } }, required: ['components'] },
  { name: 'auto_install_dependency', description: "Install a missing package or tool automatically (npm, pip, choco). Use when a simulation, test, or build fails because a binary or library is missing. Use when user asks 'instalează ce lipsește', 'lipsește ngspice', 'lipsește pachetul X'.", properties: { name: { type: 'string', description: "Package or binary name to install (e.g. ngspice, sympy, lodash)." }, type: { type: 'string', description: "'npm', 'pip', 'choco', 'system', or 'auto' to detect." }, global: { type: 'boolean', description: "Install globally (for npm/pip). Default false." } }, required: ['name'] },
  { name: 'learn_new_skill', description: "Generate and validate a new tool/function that Kelion doesn't have yet. Use when the user asks 'învață să facă X', 'nu știi să faci Y', 'adaugă skill nou', 'auto-instruiește-te'. Kelion generates code, tests it in a sandbox, and proposes adding it permanently.", properties: { skill_name: { type: 'string', description: "CamelCase or snake_case skill name (e.g. 'spiceSimulate', 'bluetoothScan')." }, description: { type: 'string', description: "What the new tool should do in one paragraph." }, test_input: { type: 'string', description: "JSON object to use as test input for the generated tool." } }, required: ['skill_name', 'description'] },
  { name: 'self_evaluate', description: "Run Kelion's own capability tests and report which pass/fail. Use for auto-diagnosis and self-correction. Use when user asks 'evaluează-te', 'ce nu știi', 'autocorecție', 'verifică-ți skill-urile'.", properties: { scope: { type: 'string', description: "'agent-capabilities', 'all', or a Jest test name pattern." } }, required: [] },
  { name: 'auto_update_dependencies', description: "Check for outdated npm/pip packages and optionally update them. Use for keeping Kelion's environment up to date. Use when user asks 'updatează dependențele', 'ce e învechit', 'upgrade pachete'.", properties: { manifest: { type: 'string', description: "'package.json' or 'requirements.txt'. Default package.json." }, auto_apply: { type: 'boolean', description: "Run install automatically if true. Default false." } }, required: [] },
  { name: 'session_persist', description: "Save or load key-value data that persists across voice sessions. Use for bookmarks, preferences, work-in-progress state. Use when user asks 'salvează asta', 'remember this for later', 'load my last session'.", properties: { action: { type: 'string', description: "'set' to save, 'get' to load." }, key: { type: 'string', description: "Unique key name." }, value: { type: 'string', description: "Value to store (for set action)." } }, required: ['key'] },
  { name: 'parallel_tools', description: "Execute multiple tool calls simultaneously for faster results. Use when you need weather + news + stocks at once, or multiple searches in parallel.", properties: { calls: { type: 'string', description: "JSON array of {tool, args} objects to run in parallel. Max 10." } }, required: ['calls'] },
  { name: 'multimedia_analyzer', description: "Permite vizualizarea și extragerea de context, transcript și sentimente din fișiere video și audio.", properties: { url: { type: 'string', description: "URL of the video or audio file." }, type: { type: 'string', description: "'video' or 'audio'." }, action: { type: 'string', description: "'analyze_content', 'extract_transcript', or 'detect_format'." } }, required: ['url', 'type'] },
  { name: 'document_parser', description: "Acces complet pentru citire, editare și mapare a structurii pentru fișiere PDF, DOCX, XLSX și CSV.", properties: { type: { type: 'string', description: "'pdf', 'docx', or 'spreadsheet'." }, url: { type: 'string', description: "Public HTTPS URL." }, base64: { type: 'string', description: "Base64 payload." }, file_id: { type: 'string', description: "Temporary ID of the uploaded file." }, data: { type: 'string', description: "Raw CSV data (only required if type is spreadsheet)." }, max_chars: { type: 'integer', description: "Cap on returned text length." } }, required: ['type'] },
  { name: 'ocr_engine', description: "Execută recunoașterea optică a caracterelor pentru imagini, documente scanate, facturi sau notițe.", properties: { mode: { type: 'string', description: "'image' or 'passport'." }, url: { type: 'string', description: "Public HTTPS URL." }, base64: { type: 'string', description: "Base64 payload." }, file_id: { type: 'string', description: "Temporary ID of the uploaded file." }, lang: { type: 'string', description: "Tesseract language code (default 'eng')." }, max_chars: { type: 'integer', description: "Cap on returned text length." } }, required: ['mode'] },
  { name: 'image_generator_editor', description: "Oferă capacitatea de a genera dinamic, decupa, redimensiona și aplica filtre direct din interfață.", properties: { action: { type: 'string', description: "'generate', 'edit', or 'qr_code'." }, prompt: { type: 'string', description: "Prompt for image generation (required if action=generate)." }, operation: { type: 'string', description: "'resize', 'grayscale', or 'rotate' (required if action=edit)." }, source: { type: 'string', description: "Path or URL to the source image (required if action=edit)." }, text: { type: 'string', description: "Text/URL to encode (required if action=qr_code)." }, width: { type: 'integer', description: "Target width." }, height: { type: 'integer', description: "Target height." }, angle: { type: 'integer', description: "Rotation angle." } }, required: ['action'] },
  { name: 'hardware_manager', description: "Permite controlul perifericelor, porturilor, camerelor și configurărilor sistemului gazdă.", properties: { action: { type: 'string', description: "'connect', 'disconnect', or 'configure'." }, device: { type: 'string', description: "Device name or type." } }, required: ['action', 'device'] },
  { name: 'cloud_manager', description: "Sistem read/write autonom pentru platforme de stocare în cloud (Google Drive, Dropbox, OneDrive).", properties: { action: { type: 'string', description: "'read', 'write', or 'list'." }, provider: { type: 'string', description: "'gdrive', 'dropbox', or 'onedrive'." }, path: { type: 'string', description: "Path to file or folder." } }, required: ['action', 'provider'] },
  { name: 'communication_hub', description: "Acces complet la căsuța de email și chat-uri terțe (Slack, WhatsApp).", properties: { action: { type: 'string', description: "'send_email', 'compose_draft', or 'send_sms'." }, to: { type: 'string', description: "Recipient contact details." }, subject: { type: 'string', description: "Subject line." }, body: { type: 'string', description: "Message body." } }, required: ['action', 'to', 'body'] },
  { name: 'automation_engine', description: "Integrare completă cu Zapier, Make și IFTTT pentru fluxuri de lucru complexe bazate pe triggere.", properties: { action: { type: 'string', description: "'zapier_trigger' or 'webhook_trigger'." }, webhook_url: { type: 'string', description: "Webhook URL to call." }, payload: { type: 'string', description: "JSON payload to send." } }, required: ['action', 'webhook_url'] },
  { name: 'devops_toolkit', description: "Asigură gestionarea totală a fluxului Git, commits, pull requests și issues.", properties: { action: { type: 'string', description: "'repo_info', 'list_files', 'read_file', 'create_pr', or 'manage_prs'." }, repo: { type: 'string', description: "Repository slug (e.g. owner/name)." }, branch: { type: 'string', description: "Branch name." }, path: { type: 'string', description: "Path to file (for read_file)." }, title: { type: 'string', description: "PR title." }, body: { type: 'string', description: "PR body/description." }, pr_action: { type: 'string', description: "'list', 'merge', or 'close' (for manage_prs)." }, issue_number: { type: 'integer', description: "PR number (for manage_prs)." } }, required: ['action'] },
  { name: 'scheduler_pro', description: "Programează sarcini recurente sau cu întârziere (cron jobs) și permite editarea/citirea agendei (calendar).", properties: { action: { type: 'string', description: "'read_calendar', 'create_ics', 'schedule_task', or 'plan_tasks'." }, query: { type: 'string', description: "Search query or task description." }, start: { type: 'string', description: "Start time/date." }, end: { type: 'string', description: "End time/date." }, attendees: { type: 'array', items: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' } }, required: ['email'] } } }, required: ['action'] },
  { name: 'smart_monitor', description: "Analizează fluxuri în timp real (ex. prețuri) și lansează acțiuni pre-programate la atingerea unor praguri.", properties: { condition: { type: 'string', description: "Condition to trigger alert." }, action_to_take: { type: 'string', description: "What to do when triggered." } }, required: ['condition', 'action_to_take'] },
  { name: 'deep_memory_architect', description: "Bază de date relațională inteligentă pentru structura proiectelor utilizatorului și istoricul pe termen lung.", properties: { action: { type: 'string', description: "'context_cache', 'session_persist', 'remember_fact', 'learn_from_observation', or 'get_history'." }, key: { type: 'string', description: "Memory key." }, value: { type: 'string', description: "Memory value." } }, required: ['action'] },
  { name: 'task_orchestrator', description: "Sistem ierarhic care transformă o cerință majoră în pași atomici, executați iterativ fără a aștepta permisiuni intermediare.", properties: { action: { type: 'string', description: "'parallel' or 'execute_plan'." }, calls: { type: 'string', description: "JSON array of tools for parallel execution." }, plan: { type: 'string', description: "JSON array of steps for execute_plan." } }, required: ['action'] },
  { name: 'universal_executor', description: "Mediu extins pentru rularea de cod; permite compilarea și instalarea autonomă a dependențelor.", properties: { action: { type: 'string', description: "'run_code', 'run_terminal', or 'run_regex'." }, language: { type: 'string', description: "Programming language." }, code: { type: 'string', description: "Code or command to execute." }, pattern: { type: 'string', description: "Regex pattern." }, input: { type: 'string', description: "Input text for regex." } }, required: ['action'] },
  { name: 'video_analyze', description: "Analyze a video URL — extract metadata, title, author, thumbnail for YouTube videos or fetch info for direct URLs.", properties: { url: { type: 'string', description: "Video URL (YouTube, Vimeo, or direct mp4/webm)." } }, required: ['url'] },
  { name: 'audio_analyze', description: "Analyze an audio file URL — detect format, check playability, suggest playback method.", properties: { url: { type: 'string', description: "Audio file URL (.mp3, .wav, .flac, .aac, .ogg, .m4a)." } }, required: ['url'] },
  { name: 'image_edit', description: "Edit an image — resize, convert to grayscale, or rotate. Uses Python PIL via sandboxed code execution.", properties: { operation: { type: 'string', description: "'resize', 'grayscale', or 'rotate'." }, source: { type: 'string', description: "Path or URL to the source image." }, width: { type: 'integer', description: "Target width (for resize)." }, height: { type: 'integer', description: "Target height (for resize)." }, angle: { type: 'integer', description: "Rotation angle in degrees (for rotate)." } }, required: ['operation', 'source'] },
  { name: 'spreadsheet_analyze', description: "Parse and analyze CSV data — compute statistics (sum, min, max, avg) for numeric columns, show headers, row counts, sample data.", properties: { data: { type: 'string', description: "CSV data as a string (header row + data rows)." } }, required: ['data'] },
  { name: 'vision_analyze', description: "Perform advanced visual analysis on an image or scene description using AI reasoning.", properties: { description: { type: 'string', description: "Description of the visual content to analyze." }, question: { type: 'string', description: "Specific question about the visual content." } }, required: ['description'] },
  { name: 'screen_capture', description: "Capture the user's screen. The client will take a screenshot and provide it as a camera frame.", properties: { region: { type: 'string', description: "Optional: 'full' (default) or 'active_window'." } }, required: [] },
  { name: 'system_bridge', description: "Super-module for system control. Read/write clipboard and capture screen.", properties: { action: { type: 'string', description: "'screen_capture', 'clipboard_read', or 'clipboard_write'." }, text: { type: 'string', description: "Text to copy (for clipboard_write)." } }, required: ['action'] },
  { name: 'task_planner', description: "Create a structured task plan with priorities, time estimates, and dependencies. Use when the user asks 'planifică', 'make a plan for', 'break this down into tasks'.", properties: { goal: { type: 'string', description: "The goal or project to plan." } }, required: ['goal'] },
  { name: 'clipboard_manager', description: "Read from or write to the user's clipboard. Use when the user asks 'copiază', 'copy this', 'paste', 'ce am in clipboard'.", properties: { action: { type: 'string', description: "'read' or 'write'." }, text: { type: 'string', description: "Text to copy (for write action)." } }, required: [] },
  { name: 'context_cache', description: "Cache and retrieve data across conversation turns. In-memory key-value store scoped to the user. Use for temporary storage during multi-step workflows.", properties: { action: { type: 'string', description: "'get', 'set', 'delete', or 'list'." }, key: { type: 'string', description: "Cache key name." }, value: { type: 'string', description: "Value to cache (for set action)." } }, required: ['key'] },
  { name: 'mcp_protocol', description: "Manage Model Context Protocol: Google integrations + self-evolving auto-discovery system. Use 'discover' to auto-find and install new tool servers from the MCP registry when you lack a capability. Use 'search' to browse available servers. Use 'status' to see installed servers and Google connections. Use 'install'/'uninstall' for manual management. Use 'updates' to check for newer versions. Use 'update' to upgrade a server. Use 'start'/'stop' to manage running servers. Use 'registry' to browse all available MCP servers.", properties: { action: { type: 'string', description: "'status', 'connect', 'discover', 'search', 'install', 'uninstall', 'start', 'stop', 'updates', 'update', or 'registry'." }, query: { type: 'string', description: "For 'discover'/'search': what capability you need (e.g., 'postgres', 'slack', 'github'). For 'install': package name." }, package: { type: 'string', description: "npm package name for 'install' action." }, server_id: { type: 'string', description: "Server ID for 'uninstall'/'start'/'stop'/'update' actions." } }, required: [] },

  { name: 'scheduled_task', description: "Schedule a reminder or task for future execution. Use when the user asks 'amintește-mi', 'remind me in 10 minutes', 'programează', 'schedule'.", properties: { action: { type: 'string', description: "'create', 'list', or 'cancel'." }, description: { type: 'string', description: "What to remind/do." }, delay_minutes: { type: 'integer', description: "Minutes from now (1-1440). Default 5." }, id: { type: 'string', description: "Task ID (for cancel action)." } }, required: [] },
  { name: 'qr_code', description: "Generate a QR code for any text, URL, or data. Returns an image URL ready to display on the monitor.", properties: { text: { type: 'string', description: "The text/URL to encode in the QR code." }, size: { type: 'integer', description: "QR image size in pixels (100-1000, default 300)." } }, required: ['text'] },
  { name: 'smart_alert', description: "Set up a condition-based alert that notifies the user when a condition is met. Use when the user asks 'alertă-mă când', 'notify me when', 'monitor this'.", properties: { action: { type: 'string', description: "'create', 'list', or 'delete'." }, condition: { type: 'string', description: "The condition to monitor." }, message: { type: 'string', description: "Alert message when triggered." }, id: { type: 'string', description: "Alert ID (for delete action)." } }, required: [] },

  // ── Agent coding tools ──
  {
    name: 'verify_build',
    description: "Run the project build and test suite to verify that recent code changes are valid. ALWAYS call this immediately after editing any code file (read_local_file, edit_local_file, replace_in_file, or multi_replace_file_content). If the build or tests fail, return the full error output so the model can diagnose and fix the issue.",
    properties: {
      mode: { type: 'string', enum: ['build', 'test', 'full'], description: "'build' = only npm run build. 'test' = only tests. 'full' = build then test (default)." },
    },
    required: [],
  },
  {
    name: 'diff_edit',
    description: "Apply precise SEARCH/REPLACE block edits to a file. Much safer than replace_in_file for complex changes because each edit is verified independently. Pass one or more blocks where each block contains the exact text to find (search) and the replacement text. If any block fails to match, NO changes are applied and the tool reports which block failed. Use this for multi-line edits, inserting code between functions, or changing specific methods without touching the rest of the file.",
    properties: {
      path: { type: 'string', description: "Path to the file to edit." },
      blocks: { type: 'string', description: "JSON array of {search, replace} blocks. The search text must match EXACTLY (including whitespace)." },
    },
    required: ['path', 'blocks'],
  },
  // ── Stage 6 — User File Store tools ──
  {
    name: 'upload_file',
    description: "Save a file to the user's Kelion cloud storage. Any format accepted. Provide the original filename and the file content as a base64 string. The file is stored persistently and can be downloaded later via download_file or the /api/files endpoints.",
    properties: {
      filename: { type: 'string', description: "Original filename with extension, e.g. 'report.docx', 'photo.jpg', 'data.csv'." },
      content: { type: 'string', description: "File content encoded as base64. For text files you may UTF-8 encode then base64." },
      mime_type: { type: 'string', description: "Optional MIME type, e.g. 'application/pdf', 'image/png'. Inferred from extension if omitted." },
    },
    required: ['filename', 'content'],
  },
  {
    name: 'list_user_files',
    description: "List all files stored by the signed-in user in Kelion cloud storage. Returns metadata (name, size, mime type, upload date) but NOT content.",
    properties: {},
    required: [],
  },
  {
    name: 'download_file',
    description: "Download a previously uploaded file from the user's Kelion cloud storage. Returns the file content as base64 along with metadata. Use the id from list_user_files.",
    properties: {
      id: { type: 'integer', description: "Numeric file ID returned by list_user_files." },
    },
    required: ['id'],
  },
  {
    name: 'delete_file',
    description: "Permanently delete a file from the user's Kelion cloud storage. Use the id from list_user_files. This action is irreversible.",
    properties: {
      id: { type: 'integer', description: "Numeric file ID returned by list_user_files." },
    },
    required: ['id'],
  },
  {
    name: 'generate_mobile_app',
    description: "Generate a mobile app project scaffold (React Native or Flutter), zip it, and save it to the user's Kelion cloud storage. Use when the user asks to create a mobile app, generate an APK project, or build a Flutter/React Native starter.",
    properties: {
      framework: { type: 'string', enum: ['react_native', 'flutter'], description: "Mobile framework to scaffold." },
      app_name: { type: 'string', description: "App name / project name." },
      features: { type: 'array', items: { type: 'string' }, description: "Optional list of features to include stubs for: camera, gps, push_notifications, biometric, offline_storage, maps, social_login." },
    },
    required: ['framework', 'app_name'],
  },
];

// Google v1alpha BidiGenerateContent — JSON schema with UPPERCASE types and
// declarations grouped under a single `functionDeclarations` array. The API
// rejects the setup frame outright if any ARRAY property is missing `items`
// or any OBJECT property drops `properties`, so the converter walks the
// schema recursively and carries those fields through.
function toGoogleSchema(v) {
  const up = (t) => (t || 'string').toString().toUpperCase();
  const type = up(v.type);
  const out = { type };
  if (v.description) out.description = v.description;
  if (v.enum) out.enum = v.enum;
  if (type === 'ARRAY') {
    out.items = v.items ? toGoogleSchema(v.items) : { type: 'STRING' };
  }
  if (type === 'OBJECT') {
    out.properties = Object.fromEntries(
      Object.entries(v.properties || {}).map(([k, sub]) => [k, toGoogleSchema(sub)])
    );
    if (Array.isArray(v.required) && v.required.length) out.required = v.required;
  }
  return out;
}
function buildKelionToolsGoogle() {
  return [
    {
      functionDeclarations: KELION_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT',
          properties: Object.fromEntries(
            Object.entries(t.properties).map(([k, v]) => [k, toGoogleSchema(v)])
          ),
          required: t.required,
        },
      })),
    },

  ];
}

// Chat Completions format — same JSON-Schema,
// but wrapped as `{ type: 'function', function: { name, description, parameters } }`.
// Exported so the text-chat route pulls the catalog from one source of truth
// (Devin Review ask on PR #133 — don't keep two hand-maintained copies).
function buildKelionToolsChatCompletions() {
  return KELION_TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.properties,
        required: t.required,
      },
    },
  }));
}

// ── Demand-driven tool selection (2026-05-06) ──────────────────────
// Default: all tools are OFF. Only tools relevant to the user's message
// are activated, used, then go back to OFF for the next request.
// This reduces token cost by 60-90% and improves model focus.
const { selectTools } = require('../services/toolRouter');

function buildKelionToolsChatCompletionsForMessage(userMessage) {
  const { tools: selectedTools, categories, selectedCount } = selectTools(userMessage, KELION_TOOLS);

  if (selectedCount === 0) {
    // Pure greeting / simple chat — no tools needed at all
    console.log('[toolRouter] No tools activated (simple chat)');
    return { tools: [], categories: [] };
  }

  console.log(`[toolRouter] Activated ${selectedCount}/${KELION_TOOLS.length} tools for categories: [${categories.join(', ')}]`);

  const formatted = selectedTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.properties,
        required: t.required,
      },
    },
  }));

  return { tools: formatted, categories };
}



// ──────────────────────────────────────────────────────────────────
// Claude Opus Voice — session token with Kelion config.
// Docs: https://ai.google.dev/api/docs/ephemeral-tokens
// Client cannot override system prompt / voice — stays secure.
// ──────────────────────────────────────────────────────────────────
// Trial quota state & helpers live in ../services/trialQuota so the
// text chat route can share the same per-IP window. See that module
// for semantics. We pull out the constants + functions we need here.
// isAdminUser / peekSignedInUser now come from ../middleware/optionalAuth.
const { TRIAL_WINDOW_MS } = require('../services/trialQuota');

// Live session registry — admin dashboard reads this to show who's online.
if (!global.__kelionActiveSessions) global.__kelionActiveSessions = new Map();
const activeSessions = global.__kelionActiveSessions;
// Auto-expire stale entries (sessions that didn't close cleanly).
setInterval(() => {
  const cutoff = Date.now() - 35 * 60 * 1000; // 35 min max session
  for (const [id, s] of activeSessions) {
    if (s.startedAt < cutoff) activeSessions.delete(id);
  }
}, 60_000).unref();

// F4 — both token endpoints accept an optional POST body with
//   { priorTurns: [{ role: 'user' | 'assistant', text: string }, …] }
// so the auto-fallback path in KelionStage can transfer the current
// session transcript to the incoming provider. GET keeps working exactly
// as before (no body, no priorTurns block).
const voiceTokenHandler = async (req, res) => {


  const priorTurns = Array.isArray(req.body?.priorTurns) ? req.body.priorTurns : [];
  // Backend selector. Default is `aistudio` — uses API key with
  // the generativelanguage.googleapis.com endpoint (no billing required).
  // Vertex AI path (`vertex`) uses OAuth service-account auth and requires
  // billing enabled on the GCP project. Override via GOOGLE_LIVE_BACKEND
  // env var on Railway, or per-request via `?backend=vertex`.
  const rawBackend = ((req.body && req.body.backend)
    || req.query.backend
    || process.env.GOOGLE_LIVE_BACKEND
    || '').toString().toLowerCase();
  const backend = rawBackend === 'vertex' ? 'vertex' : 'aistudio';
  // For Vertex we need a project id to build the fully-qualified
  // `projects/<P>/locations/<L>/publishers/google/models/<M>` path
  // that Vertex BidiGenerateContent reads from the first setup frame.
  // If none is resolvable (neither GOOGLE_CLOUD_PROJECT env nor a
  // parseable `project_id` in GCP_SERVICE_ACCOUNT_JSON), the browser
  // would receive a 200 with a bare `models/<M>` path and then see a
  // close code 1007 the instant the WS opens — a silent misconfig
  // that looks to operators like "it worked". Reuse the exact same
  // resolver the proxy uses so there is a single source of truth
  // (Copilot + Devin Review flagged this P2 on PR #207).
  let vertexResolved = { project: '', location: 'us-central1' };
  if (backend === 'vertex') {
    try {
      vertexResolved = require('./vertexLiveProxy')._internals.resolveProjectAndLocation();
    } catch (_) { /* resolver unavailable — fall through to 503 below */ }
    if (!vertexResolved.project) {
      return res.status(503).json({
        error: 'Vertex backend is unconfigured on this deployment. '
          + 'Set GOOGLE_CLOUD_PROJECT (or embed project_id in '
          + 'GCP_SERVICE_ACCOUNT_JSON), or force the legacy backend '
          + 'per-request with ?backend=aistudio.',
      });
    }
  }
  // The Vertex backend and AI Studio legacy paths are no longer relevant 
  // since we migrated to OpenRouter/Claude Opus natively. We removed the
  // GOOGLE_API_KEY block requirement here.

  const adminUser = await peekSignedInUser(req);
  const isAdmin = await isAdminUser(adminUser);
  // Gating matrix:
  //   - guests (no JWT)            → 15-min/day IP trial window
  //   - signed-in non-admin        → credits balance must be > 0 (402 if not)
  //   - admin                      → unlimited, never gated
  //
  // Adrian: "la logare se respecta credit cumparat si la admin nelimitat".
  // Previously signed-in non-admins skipped every gate, so 1 bought credit
  // = unlimited sessions. The client heartbeats /api/credits/consume every
  // 60 s while the session is open, so this upfront balance check just
  // prevents a user with 0 credits from even starting a session.
  const isGuest = !adminUser;
  let trial = null;
  if (isGuest && !isAdmin) {
    // Guest trial: 15 min/day, 7-day lifetime per IP.
    const guestIp = ipGeo.clientIp(req) || req.ip || '';
    trial = await trialStatus(guestIp);
    if (!trial.allowed) {
      return res.status(401).json({
        error: trial.reason === 'lifetime_expired'
          ? 'Free trial expired. Create an account and buy credits to continue.'
          : 'Daily free trial used up. Come back tomorrow or sign in.',
        trial: { allowed: false, reason: trial.reason, remainingMs: 0 },
      });
    }
    // Stamp the trial start on first interaction
    await stampTrialIfFresh(guestIp, trial);
  } else if (adminUser && !isAdmin) {
    // Non-admin with a stale JWT whose `sub` is not a numeric row id
    // (pre-Postgres UUID). Without an id we can't look up a credits
    // balance, and the /consume heartbeat is client-initiated — it may
    // never fire. Pre-F1+F2 these users were quietly treated as guests;
    // letting them through ungated would be a free-session bypass
    // (Devin Review PR #115 caught this regression). Force a re-auth
    // instead; the next sign-in mints a fresh JWT with a numeric sub.
    if (adminUser.id == null) {
      res.clearCookie('kelion.token', { path: '/' });
      return res.status(401).json({
        error: 'Session expired. Please sign in again to continue.',
        action: 'reauth',
      });
    }

    // Signed-in non-admin: require a positive credits balance. We only
    // block when the user explicitly has zero; any positive balance allows
    // the session to start and the client-side heartbeat takes over.
    try {
      const balance = await getCreditsBalance(adminUser.id);
      if (!Number.isFinite(balance) || balance <= 0) {
        return res.status(402).json({
          error: 'No credits left. Buy a package to keep talking to Kelion.',
          balance_minutes: 0,
          action: 'buy_credits',
        });
      }
    } catch (err) {
      // DB lookup failed — log, but don't block the session. Treat this
      // as "unable to verify, allow session" so a transient DB glitch
      // doesn't kill a paying user's voice chat. The consume heartbeat
      // will still enforce per-minute billing.
      console.warn('[realtime] credits-balance lookup failed', err && err.message);
    }
  }

  try {
    // ── Claude Opus REST Voice Mode ──────────────────────────────────────
    // No ephemeral token or WebSocket is needed. The client detects
    // 'claude' in the model name and switches to REST Voice Mode:
    //   Browser SpeechRecognition → /api/realtime/pipeline (Claude Opus via
    //   OpenRouter) → /api/voice/clone/tts (ElevenLabs TTS).
    // We still build the full persona + tools so /pipeline can use them.
    const { getModel } = require('../services/modelRouter');
    const chatModel = getModel('chat');
    console.log(`[voice-token] Smart Router → ${chatModel}`);

    // Restore variables needed for JSON payload
    const user = adminUser;
    const voice = req.query.voice || process.env.GOOGLE_TTS_VOICE_KELION || 'Kore';
    const styleFromCookie = req.cookies?.['kelion.voice_style'];
    const voiceStyle = resolveVoiceStyle(styleFromCookie || '');
    let memoryItems = [];
    try {
      memoryItems = await listMemoryItems(user?.id);
    } catch (err) {
      console.warn('[realtime] failed to fetch user facts', err.message);
    }

    const modelFamily = chatModel.includes('claude') ? 'Claude (Anthropic)'
      : chatModel.includes('gemini') ? 'Gemini (Google)'
      : chatModel.includes('kimi') ? 'Kimi (Moonshot)'
      : chatModel.includes('llama') ? 'Llama (Meta)'
      : chatModel;
    const payload = {
      token: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      model: chatModel,
      modelFamily,
      voice,
      provider: 'openrouter',
      backend: 'openrouter',
      signedIn: !!user,
      userName: user?.name || null,
      memoryCount: memoryItems.length,
      voiceStyle: voiceStyle.label,
      setup: null,
      trial,
    };

    // Register active session for admin live-sessions BEFORE sending response
    // so any Map/timeout error is caught by the surrounding try-catch.
    const sid = `rest-${Date.now()}`;
    activeSessions.set(sid, {
      userId: user?.id || null,
      userEmail: user?.email || null,
      ip: ipGeo.clientIp(req) || req.ip || '',
      startedAt: Date.now(),
    });
    // Auto-remove after 30 min (max session duration).
    setTimeout(() => activeSessions.delete(sid), 30 * 60 * 1000).unref();

    return res.json(payload);
  } catch (err) {
    console.error('[realtime] token error:', err.message);
    res.status(500).json({ error: 'Failed to create voice session' });
  }
};
router.get('/voice-token', voiceTokenHandler);
router.post('/voice-token', voiceTokenHandler);
// Backward compat aliases for cached clients
// Legacy aliases removed — all clients now use /voice-token.

// ──────────────────────────────────────────────────────────────────
// /vision — Claude Opus camera frame description.
// The client captures JPEG frames and POSTs them here. Claude Opus describes
// the scene in 1-2 sentences, and the client injects that description
// back into the realtime session as context.
// ──────────────────────────────────────────────────────────────────
router.post('/vision', visionLimiter, async (req, res) => {
  const { image, mimeType, timeContext } = req.body || {};
  if (!image) return res.status(400).json({ error: 'No image provided' });
  if (typeof image !== 'string' || image.length < 200) {
    return res.status(400).json({ error: 'Image too small or invalid' });
  }

  // ── Vision credit billing ────────────────────────────────────────
  // Batch 10 frames = 1 minute deduction (integer-safe for DB columns).
  // Includes 30% markup over raw API cost.
  // Admin users are exempt. Guests use trial quota (no deduction).
  const FRAMES_PER_MINUTE = 10;
  const user = peekSignedInUser(req);
  const admin = await isAdminUser(user);
  if (user && user.id && !admin) {
    try {
      const balance = await getCreditsBalance(user.id);
      if (balance <= 0) {
        return res.status(402).json({
          error: 'Insufficient credits for vision',
          balance: 0,
        });
      }
    } catch (err) {
      console.warn('[vision] balance check failed:', err.message);
    }
  }

  try {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) return res.status(503).json({ error: 'OPENROUTER_API_KEY not configured' });

    // Build time-aware vision prompt
    let timeInfo = '';
    if (timeContext && typeof timeContext === 'object') {
      timeInfo = ` Current date: ${timeContext.date || 'unknown'}. Time: ${timeContext.time || 'unknown'} (${timeContext.timezone || 'unknown timezone'}). Time of day: ${timeContext.timeOfDay || 'unknown'}.`;
    }

    const url = 'https://openrouter.ai/api/v1/chat/completions';

    // Convert base64 data to OpenAI image_url format
    const base64Data = `data:${mimeType || 'image/jpeg'};base64,${image}`;

    const { getModel: getVisionModel } = require('../services/modelRouter');
    const modelName = getVisionModel('vision');
    console.log(`[vision] Smart Router → ${modelName}`);
    const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    const authHeader = `Bearer ${openRouterKey}`;

    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'HTTP-Referer': 'https://kelion.ai',
        'X-Title': 'Kelion AI Vision'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are a vision system analyzing a real camera frame from a user's device. RULES:\n1. Describe ONLY what you can LITERALLY see in this image. Never invent, assume, or hallucinate details.\n2. If the image is blurry, dark, or unclear, say so honestly — do NOT guess what might be there.\n3. Focus on: people (position, clothing, actions), objects, text visible, environment (indoor/outdoor, vehicle, room type).\n4. If you see a steering wheel, dashboard, or road — the user is in a vehicle. Describe the driving scene.\n5. If you see a face close-up — this is likely a front-facing (selfie) camera.\n6. Keep to 1-2 factual sentences. No creative writing.${timeInfo}`
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64Data
                }
              }
            ]
          }
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`OpenRouter vision HTTP ${r.status}: ${errText.slice(0, 300)}`);
    }

    const result = await r.json();
    const description = result?.choices?.[0]?.message?.content || '';

    // Deduct credits AFTER successful API call (not before).
    // Track frames per user; deduct 1 minute every FRAMES_PER_MINUTE frames.
    // Of the 1 minute deducted, 30% (0.3 min) is platform revenue (markup).
    if (user && user.id && !admin) {
      const key = `vision_frames_${user.id}`;
      if (!global.visionFrameCounters) global.visionFrameCounters = {};
      global.visionFrameCounters[key] = (global.visionFrameCounters[key] || 0) + 1;
      if (global.visionFrameCounters[key] >= FRAMES_PER_MINUTE) {
        global.visionFrameCounters[key] = 0;
        addCreditsTransaction({
          userId: user.id,
          deltaMinutes: -1,
          kind: 'vision',
          note: `Vision: ${FRAMES_PER_MINUTE} frames analyzed (incl. 30% markup)`,
        }).catch(err => console.warn('[vision] credit deduction failed:', err.message));

        // Log 30% markup as platform revenue
        logVisionRevenue(user.id, 0.3).catch(err =>
          console.warn('[vision] revenue log failed:', err.message)
        );
      }
    }

    return res.json({ ok: true, description });
  } catch (err) {
    const is400 = err.status === 400 || (err.message && err.message.includes('400'));
    if (is400) {
      console.warn('[vision] client sent invalid image:', err.message?.slice(0, 200));
      return res.status(400).json({ error: 'Invalid image. Please make sure your image is valid.' });
    }
    console.error('[vision] Gemini error:', err.message);
    return res.status(500).json({ error: 'Vision processing failed' });
  }
});

// ──────────────────────────────────────────────────────────────────
// /pipeline — Gemini text-chat pipeline (tools supported).
// For typed messages: text → Gemini chat → tool loop → text back.
// Voice goes directly through Gemini REST Voice Mode — not this route.
// ──────────────────────────────────────────────────────────────────
router.post('/pipeline', async (req, res) => {
  const { history, textOverride, visionContext, clientTimezone, clientLocalTime: clientLocalTimeRaw } = req.body || {};
  if (!textOverride) return res.status(400).json({ error: 'No text provided' });

  try {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) return res.status(503).json({ error: 'OPENROUTER_API_KEY not configured' });

    const userText = (typeof textOverride === 'string' ? textOverride : '').trim();
    if (!userText) {
      return res.json({ ok: true, userText: '', assistantText: '', audio: null, toolCalls: [] });
    }
    console.log('[pipeline] text:', userText);

    // ── Adaptive Resource Governor ────────────────────────────────────
    // Compute resource levels: OFF → MIN → MAX based on need.
    // Resources activate to MAX only for the duration they're needed,
    // then drop back to OFF/MIN for the next request.
    const { computeResourceSnapshot, logTransition } = require('../services/resourceGovernor');
    const { needsVision } = require('../services/toolRouter');
    const resourceContext = {
      message: userText,
      cameraActive: !!(visionContext && visionContext.trim()),
      narrationActive: false, // pipeline doesn't have narration state
      visionRequested: needsVision(userText),
    };
    // Tool categories will be computed next — add them after toolRouter runs

    // Build persona + system prompt
    const adminUser = await peekSignedInUser(req);
    const isAdmin = await isAdminUser(adminUser);
    const user = adminUser;
    let memoryItems = [];
    if (user && (Number.isFinite(user.id) || typeof user.id === 'string')) {
      try { memoryItems = await listMemoryItems(user.id, 60); }
      catch (_) { }
    }
    const browserLang = (req.query.lang || 'en-US').toString().slice(0, 16);
    const forcedLang = (process.env.KELION_FORCE_LANG || browserLang).toString().slice(0, 16);
    const styleFromCookie = req.cookies?.['kelion.voice_style'];
    const voiceStyle = resolveVoiceStyle(styleFromCookie || '');
    const ipGeoData = await ipGeo.lookup(ipGeo.clientIp(req));
    // Use client timezone as highest priority (real device time)
    const clientTz = (typeof clientTimezone === 'string' && clientTimezone.length < 64) ? clientTimezone : null;
    const clientLT = (typeof clientLocalTimeRaw === 'string' && clientLocalTimeRaw.length < 100) ? clientLocalTimeRaw : null;
    let creditsBalance = null;
    if (user && user.id) {
      try { creditsBalance = await getCreditsBalance(user.id); }
      catch (_) { }
    }
    const systemPrompt = buildKelionPersona({
      user, creditsBalance, memoryItems, voiceStyle, geo: ipGeoData, priorTurns: [],
      lockedLangTag: await resolveLockedLangTag({ req, user, forcedLang }),
      clientTz,
      clientLocalTime: clientLT,
    });

    const systemText = systemPrompt + '\n\nCRITICAL RULES:\n0. ALWAYS RESPOND IN THE EXACT SAME LANGUAGE AS THE USER\'S LATEST MESSAGE. If the user speaks Romanian, answer in Romanian. If they speak German, answer in German.\n1. MAXIMUM CONCISENESS. Answer precisely and directly. Do not use filler words. Do not explain your thought process. Keep answers extremely short unless a detailed explanation is specifically requested. This is crucial to save tokens and avoid verbosity.\n2. ACADEMIC & PROFESSIONAL TONE. Use highly professional, grammatically perfect language. In Romanian, use natural vocabulary, flawless grammar, and diacritics. Avoid weird translations or robotic phrasing.\n3. ZERO HALLUCINATIONS. NEVER fabricate, guess, or make up information. If you don\'t know, simply say "Nu am această informație." (I don\'t have this information). \n4. When asked about facts, news, people, places, events — ALWAYS use web_search or wikipedia_search. NEVER answer from memory alone.\n5. You have tools: web_search, wikipedia_search, browse_web, calculate, get_weather, etc. USE THEM proactively.';

    // Build messages in OpenAI/OpenRouter format
    const messages = [{ role: 'system', content: systemText }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-20)) {
        const role = h.role === 'model' ? 'assistant' : (h.role === 'assistant' ? 'assistant' : 'user');
        messages.push({ role, content: h.text || h.content || '' });
      }
    }
    if (visionContext && typeof visionContext === 'string' && visionContext.trim()) {
      messages.push({ role: 'user', content: `[Live camera feed observations: ${visionContext}]` });
    }
    messages.push({ role: 'user', content: userText });

    // ── Demand-driven tool activation ─────────────────────────────────
    // Default: all tools OFF. Only activate tools relevant to this
    // specific message. After the request, tools go back to OFF.
    const { tools: openRouterTools, categories: activeCategories } = buildKelionToolsChatCompletionsForMessage(userText);

    // Complete the resource snapshot now that we have tool categories
    resourceContext.toolCategories = activeCategories;
    const snapshot = computeResourceSnapshot(resourceContext);
    // Log active resource levels for this request
    const activeResources = Object.entries(snapshot)
      .filter(([, v]) => v.levelName !== 'OFF')
      .map(([k, v]) => `${k}=${v.levelName}`)
      .join(', ');
    if (activeResources) {
      console.log(`[resourceGov] Request levels: ${activeResources}`);
    } else {
      console.log('[resourceGov] All resources OFF (simple chat)');
    }

    const { smartFetch } = require('../services/modelRouter');
    const body = {
      messages,
      temperature: 0.6,
      max_tokens: 4000,
      tools: openRouterTools.length > 0 ? openRouterTools : undefined,
    };

    let result;
    try {
      const { response } = await smartFetch('chat', body);
      result = await response.json();
    } catch (err) {
      throw new Error(`Realtime AI pipeline failed: ${err.message}`);
    }

    const toolCalls = [];
    let rounds = 0;

    // Tool call loop (up to 3 rounds)
    while (rounds < 3) {
      const message = result.choices?.[0]?.message;
      if (!message) break;

      const fnCalls = message.tool_calls;
      if (!fnCalls || fnCalls.length === 0) break;

      rounds++;

      // Add assistant message with tool calls to history
      messages.push(message);

      // Execute each tool call
      for (const fc of fnCalls) {
        if (fc.type !== 'function') continue;
        const name = fc.function?.name || 'unknown';
        let args = {};
        try { args = JSON.parse(fc.function?.arguments || '{}'); } catch (e) { }
        toolCalls.push({ name, args });

        let toolResult = { status: 'tool_not_found' };
        try {
          const { executeRealTool } = require('../services/realTools');
          const latRaw = req?.query?.lat ?? req?.body?.lat ?? req?.body?.latitude;
          const lonRaw = req?.query?.lon ?? req?.query?.lng ?? req?.body?.lon ?? req?.body?.lng ?? req?.body?.longitude;
          const lat = latRaw === undefined || latRaw === null || latRaw === '' ? undefined : Number(latRaw);
          const lon = lonRaw === undefined || lonRaw === null || lonRaw === '' ? undefined : Number(lonRaw);
          const coords = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
          toolResult = await executeRealTool(name, args, { user, req, coords });
        } catch (err) {
          toolResult = { error: err.message };
        }

        if (toolResult?.ok === false || toolResult?.error) {
          toolResult._hint = "SYSTEM: This tool call failed. Analyze the error, correct your arguments, and try again, or use an alternative approach. Do not give up immediately.";
        }

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: fc.id,
          name: name,
          content: JSON.stringify(toolResult)
        });
      }

      // Re-call smartFetch with tool results
      body.messages = messages;
      try {
        const { response: nextRes } = await smartFetch('chat', body);
        result = await nextRes.json();
      } catch (err) {
        console.error('[pipeline] Error in tool loop smartFetch:', err.message);
        break; // exit loop on fetch error
      }
    }

    // Extract final text
    const finalMessage = result.choices?.[0]?.message;
    // Extract final text — only return .content (ignore any reasoning_content from CoT models)
    let assistantText = (finalMessage?.content || '').trim();
    if (fallbackTriggered) {
      assistantText = "[SISTEM: Contul OpenRouter a rămas fără credit! Am trecut automat pe modelul de rezervă Gemini Free.]\n" + assistantText;
    }
    console.log('[pipeline] OpenRouter:', assistantText.slice(0, 100));

    return res.json({
      ok: true,
      userText,
      assistantText,
      audio: null,
      audioFormat: null,
      toolCalls,
    });

  } catch (err) {
    console.error('[pipeline] error:', err.message);
    return res.status(500).json({ error: 'Pipeline processing failed' });
  }
});

// Stage 6 — M26: lightweight cookie-backed voice style setter.
// Persisted 90 days as httpOnly=false (so the client can read/clear too).
router.post('/voice-style', (req, res) => {
  const raw = (req.body?.style || '').toString();
  const resolved = resolveVoiceStyle(raw);
  res.cookie('kelion.voice_style', resolved.label, {
    httpOnly: false,
    sameSite: 'Lax',
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true, style: resolved.label });
});

module.exports = router;
module.exports.VOICE_STYLES = VOICE_STYLES;
module.exports.resolveVoiceStyle = resolveVoiceStyle;
// Exported for unit tests and shared tool catalog access.
module.exports.KELION_TOOLS = KELION_TOOLS;
module.exports.buildKelionToolsGoogle = buildKelionToolsGoogle;
module.exports.buildKelionToolsChatCompletions = buildKelionToolsChatCompletions;
module.exports.buildKelionToolsChatCompletionsForMessage = buildKelionToolsChatCompletionsForMessage;
module.exports.buildKelionPersona = buildKelionPersona;
module.exports.resolveLockedLangTag = resolveLockedLangTag;
// Audit M9 — exported so chat.js renders memory with the same
// self/other partitioning as the voice persona. Keeping a single
// formatter prevents drift between text and voice when new subject
// buckets (e.g. "pets") are added later.
module.exports.formatMemoryBlocks = formatMemoryBlocks;
