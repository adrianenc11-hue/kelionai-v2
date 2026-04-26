'use strict';

const { Router } = require('express');
const { listMemoryItems, getCreditsBalance, setPreferredLanguage, getPreferredLanguage } = require('../db');

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
const ipGeo = require('../services/ipGeo');
const trialQuota = require('../services/trialQuota');
const { buildSanitizedPriorTurnsBlock } = require('../utils/sanitizePriorTurns');
const router = Router();

// Stage 3 — read user from JWT cookie without gating the route.
// The realtime endpoints are public for guests; if a cookie is present
// and valid we enrich the session with long-term memory. The actual
// implementation lives in ../middleware/optionalAuth so the chat route
// can reuse it — see the module header for the numeric-sub guard.

// Kelion persona — injected server-side into every Gemini Live session
// so users cannot jailbreak by replacing the system prompt.
// Stage 6 — M26: voice style presets. Each preset nudges Gemini Live's
// prosody / register / pace via system prompt (we keep the native low-latency
// voice; layering Inworld/Sesame TTS would double our TTFA, not worth it yet).
const VOICE_STYLES = {
  warm:    { label: 'warm',    directive: 'Speak warmly — unhurried pace, gentle inflection, the voice of a close friend catching up over coffee. Soft s\'s, relaxed breath.' },
  playful: { label: 'playful', directive: 'Speak playfully — lighter energy, brighter pitch, a touch of smile in the voice, a quick wit. Not hyperactive, just sparkly.' },
  calm:    { label: 'calm',    directive: 'Speak calmly — steady, grounded pace, lower register, longer pauses, almost meditative. The voice of someone who has time for you.' },
  focused: { label: 'focused', directive: 'Speak with crisp focus — clear articulation, direct, a professional cadence. No extra words, no fluff. Still warm, just efficient.' },
};
function resolveVoiceStyle(raw) {
  const k = (raw || '').toString().toLowerCase();
  return VOICE_STYLES[k] || VOICE_STYLES.warm;
}

// F4 — when the client falls back from one voice provider to the other
// (OpenAI Realtime ↔ Gemini Live), we want the new provider to PICK UP THE
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
    memoryItems = [],
    voiceStyle = VOICE_STYLES.warm,
    geo = null,
    priorTurns = [],
    lockedLangTag = null,
  } = opts;
  const lockedLangName = languageNameForTag(lockedLangTag) || null;
  const now = new Date();
  const tz = geo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const iso = now.toISOString();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  const localTime = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
  // Adrian: "permanent trebuie sa foloseasca coordonatele gps reale ale
  // aparatului". We only include user location in the persona when the
  // browser has resolved a REAL GPS fix (source === 'client-gps').
  // IP-based location is too inaccurate (often the wrong city, sometimes
  // wrong country on a VPN) — putting it in the prompt makes Kelion
  // confidently lie about where the user is. Without GPS, Kelion gets a
  // "location unknown" line and is instructed to call get_my_location
  // before answering any location question.
  const hasRealGps = !!(geo && geo.source === 'client-gps' && geo.latitude != null && geo.longitude != null);
  const locationLine = hasRealGps ? ipGeo.formatForPrompt(geo) : '';
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
    : 'User GPS: not yet available. For ANY location or weather question, call get_my_location tool FIRST to get real coordinates. Never guess a city or location.';

  return `You are Kelion, an AI assistant created by AE Studio, after an idea by Adrian Enciulescu. Contact: contact@kelionai.app.

You are speaking out loud. Keep replies short (1-3 sentences). Sound natural. No lists, no markdown.

Language: detect the user's language from their speech and reply in that same language. Never mix languages. Never default to English unless the user speaks English.${lockedLangName ? `
LOCKED language: ${lockedLangName} (${lockedLangTag}). Reply EXCLUSIVELY in ${lockedLangName}.` : ''}

Honesty (absolute rules):
- Never claim you did something you did not do.
- Never invent numbers, names, URLs, dates, prices, or facts.
- When uncertain: call a tool or say "I don't know". Never guess.
- Never announce which tool you are calling. Just call it and answer with the result.
- A correct "I don't know" always beats a confident fabrication.
- Never invent requirements or instructions the user gave you. Only do what the user actually asks.

Tools (use them — never guess when a tool fits):
${KELION_TOOLS.map(t => `- ${t.name}(${t.required.join(', ')}) — ${t.description.split('.')[0]}`).join('\n')}

Also available: Google Search, Code Execution, Google Maps, URL Context (built-in, auto-used).

Silent tools (never mention these to user): observe_user_emotion, learn_from_observation, get_action_history, plan_task.

Vision rules:
- Camera frames are ambient context. DO NOT describe them unless the user explicitly asks.
- When you receive a camera frame, the camera IS active. Never say it is off.
- Attached files: always analyze when present.

Context:
- UTC: ${iso}
- Local: ${localTime} (${weekday}, ${tz}).${locationLine ? `
- GPS: ${locationLine}.` : ''}${coordLine ? `
- ${coordLine}` : ''}${noGpsLine ? `
- ${noGpsLine}` : ''}${user ? `\n\nUser: ${user.name || 'friend'}${user.id != null ? ` (id ${user.id})` : ''}.` : ''}${formatMemoryBlocks(memoryItems)}${buildPriorTurnsBlock(priorTurns)}`;
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
    out += self.map((m) => `- [${m.kind}] ${m.fact}`).join('\n');
  }
  if (other.size) {
    out += '\n\nOther people the user has mentioned (these facts are NOT about the user — never attribute them to the signed-in user):';
    for (const [name, rows] of other.entries()) {
      out += `\n• ${name}:`;
      for (const m of rows) out += `\n    - [${m.kind}] ${m.fact}`;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Kelion tool catalog (provider-agnostic source of truth).
//
// We historically declared tools in the Gemini Live `functionDeclarations`
// shape inline inside the gemini-token endpoint (uppercase types OBJECT /
// STRING / INTEGER / NUMBER, nested under `{ functionDeclarations: [...] }`).
// Plan C (OpenAI Realtime) needs the same tools in OpenAI's GA Realtime
// shape (lowercase JSON-Schema types, each tool wrapped as
// `{ type: 'function', name, description, parameters }`). Instead of keeping
// two copies of the catalog (which drift), we declare it once here in a
// neutral shape and ship two tiny adapters.
//
// Both adapters are pure functions — safe to call from /gemini-token and
// /openai-live-token. If you add a new tool, add it to KELION_TOOLS only;
// the adapters pick it up automatically.
const KELION_TOOLS = [
  {
    name: 'browse_web',
    description: 'Run an autonomous web-browsing agent in a real browser. Use when the user asks Kelion to open a site, fill a form, extract info from a page behind JS, compare products, book/reserve, etc. Returns a short summary + optional URL.',
    properties: {
      task:      { type: 'string',  description: 'Natural-language instruction for the web agent, e.g. "Find the cheapest round-trip Bucharest-Rome flight next weekend on skyscanner.com and tell me the airline and price."' },
      start_url: { type: 'string',  description: 'Optional URL to start on. Leave empty to let the agent pick.' },
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
      query: { type: 'string',  description: 'Free-text search (sender, subject, keyword).' },
      limit: { type: 'integer', description: 'Max results (default 5).' },
    },
    required: ['query'],
  },
  {
    name: 'search_files',
    description: "Search the signed-in user's connected file storage (Drive, Dropbox, etc).",
    properties: {
      query: { type: 'string',  description: 'Free-text search.' },
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
        enum: ['neutral','happy','sad','surprised','angry','tired','focused','confused','anxious'],
        description: "Your best single-word read of the user's current state.",
      },
      intensity: { type: 'number', description: 'How strong the signal is, 0.0 (faint) to 1.0 (unmistakable).' },
      cue:       { type: 'string', description: 'Short phrase naming the cue ("slight smile", "voice trembling", "furrowed brow"). 1-6 words.' },
    },
    required: ['state', 'intensity'],
  },
  {
    name: 'set_narration_mode',
    description: "Turn continuous scene narration ON or OFF for the user. Call this IMMEDIATELY when the user says anything that indicates they want you to describe what you see without being asked each time — accessibility request (e.g. 'I'm blind', 'I can't see well', 'sunt nevazator', 'nu vad'), explicit narration request (e.g. 'narrate', 'narează', 'describe continuously', 'descrie tot ce vezi', 'keep telling me what you see', 'povesteste-mi', 'spune-mi ce vezi', 'tell me what's around me'), or a stop request (e.g. 'stop narrating', 'basta cu descrierile', 'taci din cameră', 'opreste narea'). When enabled=true, the app will periodically feed you short descriptions of the camera frame so you can speak them naturally to the user; when enabled=false, the app returns to ask-only vision. Announce the change briefly ('I'll keep describing what I see' / 'I'll stop narrating') and then say the FIRST description right away after enabling.",
    properties: {
      enabled:    { type: 'boolean', description: 'true = turn narration ON, false = turn narration OFF.' },
      interval_s: { type: 'number',  description: 'Optional: how often to narrate, in seconds. Must be between 4 and 30 (default 8). Lower = more updates, higher = quieter.' },
      focus:      { type: 'string',  description: "Optional: an anchor phrase from the user for the vision model to prioritise (e.g. 'watch the stove', 'tell me if the dog moves', 'read the text on the screen'). Leave blank for a general description." },
    },
    required: ['enabled'],
  },
  {
    name: 'what_do_you_see',
    description: "Describe what is currently visible in the user's camera. Call this ONLY when the user explicitly asks you to look (e.g. 'what do you see?', 'ce vezi?', 'can you see me?', 'describe what's in front of you', 'look at this'). The camera is kept silently on for this purpose — do NOT announce it, do NOT describe the camera unsolicited. When this tool is called the backend analyzes the current frame with Gemini Vision and returns a short description; integrate that description naturally into your spoken reply, do not read it verbatim.",
    properties: {
      focus: { type: 'string', description: "Optional phrase the user gave you (e.g. 'is the laptop open?', 'what color is my shirt?'). Pass it through so the vision model can focus its answer. Leave blank for a general description." },
    },
    required: [],
  },
  {
    name: 'show_on_monitor',
    description: "Display something on the big presentation monitor in the scene behind you. Use whenever the user asks (in any language) to see / open / show / display a map, the weather, a video, an image, a Wikipedia / reference page, any web page, or to PLAY a live audio stream. Pick the right `kind` — the client resolves it to the best embed URL. Call again with a new query to swap the content on screen. For radio: first call play_radio to get the stream URL, then call show_on_monitor with kind='audio' query=<that URL> title=<station name> so the audio actually starts playing in the user's browser.",
    properties: {
      kind: {
        type: 'string',
        enum: ['map', 'weather', 'video', 'image', 'wiki', 'web', 'audio', 'clear'],
        description: "Type of content: 'map' = Google Maps for a place; 'weather' = forecast for a city; 'video' = YouTube clip or search; 'image' = photo search; 'wiki' = Wikipedia article; 'web' = arbitrary URL (must start with https://); 'audio' = live audio stream URL (radio, podcast feed, .mp3/.aac/.m3u8) rendered as an HTML5 audio player on the monitor; 'clear' = blank the monitor.",
      },
      query: { type: 'string', description: "Search term, URL, or stream URL. Examples: 'Cluj-Napoca', 'New York', 'sunset mountains', 'Paris', 'https://en.wikipedia.org/wiki/Artificial_intelligence', 'https://stream.example.fm/radio.aac'. For audio: pass the directly-playable HTTP(S) stream URL returned by play_radio. For a Linux shell / terminal, pass kind='web' with query='https://webvm.io'. Required unless kind='clear'." },
      title: { type: 'string', description: "Optional human-friendly label shown above the monitor. For audio playback, pass the station name (e.g. 'Radio ZU — Bucharest'). Otherwise omit and the monitor builds a title from the kind+query." },
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
    name: 'plan_task',
    description: "Produce a short, ordered action plan BEFORE you start executing a multi-step request. Call this at the TOP of any user ask that needs 3 or more real actions (research + then act, compare + then decide, collect data + open on monitor + email, etc.) — and for ANY request you are not already sure how to attack. A dedicated planner model (Gemini Flash) returns a numbered plan that names the tools you should call. Read the plan to the user in 1-2 sentences (natural language, not JSON), then execute steps one by one, narrating each action. If the planner says the goal is under-specified, ASK the user the clarifying question before touching any tool. Skip plan_task ONLY for single-shot requests where the right tool is obvious (e.g. 'what's the weather in Cluj'). When unsure, plan first.",
    properties: {
      goal:         { type: 'string',  description: "One-sentence restatement of the user's end goal, in the user's language." },
      context_hint: { type: 'string',  description: "Optional short context the planner should know about (constraints, what's already been said, what failed in a previous attempt). Keep under 300 chars." },
      max_steps:    { type: 'integer', description: 'Upper bound on plan length. 1–10; default 6.' },
    },
    required: ['goal'],
  },
  {
    name: 'get_action_history',
    description: "Look up your OWN recent tool calls for the signed-in user before deciding whether to re-run one. Call this whenever the user asks 'did you already …?' / 'ai făcut deja …?', whenever you're about to repeat an action that might have just happened (send the same email twice, re-open the same page on the monitor, re-run a search you already did this session), or at the start of a follow-up ask like 'fă din nou ce ai făcut înainte'. Returns an ordered list of previous tool invocations with short result summaries. Guests get { ok:false, signed_in:false } — in that case tell the user you can only remember actions once they sign in. Never invent a history: if this tool returns 0 rows, say honestly 'I haven't done anything like that yet'.",
    properties: {
      limit:      { type: 'integer', description: 'How many recent actions to fetch. 1–40; default 10.' },
      session_id: { type: 'string',  description: "Optional filter — restrict to actions from a specific session. Omit to see actions across the whole account." },
    },
    required: [],
  },
  {
    name: 'learn_from_observation',
    description: "SILENT auto-learn. Persist a private observation about the signed-in user as a long-term memory item. Use ONLY for durable observations that will help you understand the user in FUTURE conversations — body language, recurring environment cues, what they appear to be working on, evident routines, mood patterns. NEVER announce this call out loud. NEVER tell the user 'I'll remember that' / 'noted' / 'am salvat'. NEVER recite back what you've learned, even if asked — direct the user to '⋯ → Memoria mea' in the app for the full list. Fire at most every ~30 seconds and only when confident. Guests get a no-op { ok:true, persisted:0 }.",
    properties: {
      observation: { type: 'string', description: "Short third-person fact about the user, ≤ 280 chars (e.g. 'works at a desk with two monitors', 'looks tired in the late afternoon', 'wears glasses', 'often has a cat in frame')." },
      kind:        { type: 'string', enum: ['observation','preference','routine','context','mood','skill'], description: "Category. Default 'observation' (free-form camera/voice notice)." },
      confidence:  { type: 'number', description: 'How sure you are, 0.1–0.6. Capped at 0.6 — these are inferences, not user statements.' },
    },
    required: ['observation'],
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
    description: "Find and PLAY a live radio station, in any country, in any language. Use whenever the user says 'porneste/pune un post de radio', 'play a radio station', 'metti la radio', 'mets la radio', 'put on BBC Radio 1', 'lance NHK live', 'pune Europa FM live', or any equivalent. Returns a directly playable HTTP(S) audio stream URL plus station metadata. After getting the result, immediately call show_on_monitor with kind='audio' and src=<the stream URL> so the avatar's stage actually starts playing the audio. NEVER fall back to YouTube for live radio — radio-browser.info exposes ~50,000 real stations with raw .mp3 / .aac / .m3u8 URLs that play in any browser.",
    properties: {
      query:    { type: 'string',  description: "Station name or fuzzy query. Examples: 'BBC Radio 1', 'Europa FM', 'NHK', 'NPR', 'Radio ZU', 'jazz', 'classical Vienna'. Optional when country/language/tag are provided." },
      country:  { type: 'string',  description: "Optional ISO country name in English ('Romania', 'France', 'Japan', 'United States'). Use when the user asks for radio FROM a specific country." },
      language: { type: 'string',  description: "Optional spoken-language filter ('romanian', 'french', 'japanese', 'spanish'). Use when the user wants radio in a specific language regardless of country." },
      tag:      { type: 'string',  description: "Optional genre/topic tag ('jazz', 'news', 'rock', 'classical', 'electronic', 'talk')." },
      limit:    { type: 'integer', description: "How many candidate stations to return (1-5, default 1). The model usually only needs one." },
    },
    required: [],
  },
  {
    name: 'get_weather',
    description: "Fetch REAL current weather and short-range forecast for a city or coordinates. Use this whenever the user asks about weather, temperature, rain, wind, or a forecast for today or the next few days. Data comes from Open-Meteo (free, authoritative). NEVER guess weather — always call this tool.",
    properties: {
      city: { type: 'string', description: "City or place name, e.g. 'Cluj-Napoca', 'New York', 'Paris'. Either city or lat+lon is required." },
      lat:  { type: 'number', description: "Latitude in decimal degrees. Use this with lon when you already have precise GPS coords." },
      lon:  { type: 'number', description: "Longitude in decimal degrees." },
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
  {
    name: 'translate',
    description: "Translate a short text between languages using a real translator. Use whenever the user asks 'how do you say X in Y', 'translate this to Y', 'tradu ...', or similar. Prefer this over translating in your head — the external engine handles nuance, idioms, and less-common language pairs better.",
    properties: {
      text: { type: 'string', description: "Source text to translate. Max 5000 characters." },
      to:   { type: 'string', description: "Target language code (ISO 639-1, e.g. 'en', 'ro', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'zh', 'ja', 'ar')." },
      from: { type: 'string', description: "Source language code. Use 'auto' or omit to auto-detect." },
    },
    required: ['text', 'to'],
  },
  // ── Feeds & live data ─────────────────────────────────────────────
  {
    name: 'get_forecast',
    description: "Get a multi-day weather forecast (up to 16 days) for a city or coordinates. Use when the user asks 'what's the weather this week', 'will it rain on Friday', 'forecast for next weekend'. Data from Open-Meteo.",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat:  { type: 'number', description: "Latitude in decimal degrees." },
      lon:  { type: 'number', description: "Longitude in decimal degrees." },
      days: { type: 'integer', description: "Forecast days (1-16, default 7)." },
    },
    required: [],
  },
  {
    name: 'get_air_quality',
    description: "Fetch real-time air-quality index (PM2.5, PM10, ozone, NO2) for a city or coordinates. Use when the user asks about pollution, smog, allergies, breathing conditions. Data from Open-Meteo air-quality API (OpenAQ-derived).",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat:  { type: 'number', description: "Latitude." },
      lon:  { type: 'number', description: "Longitude." },
    },
    required: [],
  },
  {
    name: 'get_news',
    description: "Fetch recent news headlines from GDELT's live news index. Use when the user asks for news, headlines, 'what's happening with X', 'latest on Y'. Returns up to 10 articles with title, source, URL and published date.",
    properties: {
      topic: { type: 'string', description: "Free-text topic / query (e.g. 'earthquake Turkey', 'OpenAI announcements')." },
      lang:  { type: 'string', description: "Optional language filter (ISO 639-1, e.g. 'en', 'ro')." },
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
      from:   { type: 'string', description: "Source currency (ISO 4217 3-letter, e.g. 'USD', 'EUR', 'RON')." },
      to:     { type: 'string', description: "Target currency (ISO 4217)." },
      amount: { type: 'number',  description: "Amount to convert (default 1)." },
    },
    required: ['from', 'to'],
  },
  {
    name: 'currency_convert',
    description: "Alias of get_forex for natural phrasings like 'convert 50 EUR to RON'. Same exchangerate.host source.",
    properties: {
      from:   { type: 'string', description: "Source currency (ISO 4217)." },
      to:     { type: 'string', description: "Target currency (ISO 4217)." },
      amount: { type: 'number',  description: "Amount to convert." },
    },
    required: ['from', 'to', 'amount'],
  },
  {
    name: 'get_earthquakes',
    description: "Fetch recent earthquakes from USGS (authoritative). Use when the user asks about earthquakes worldwide or near a location. Returns magnitude, location, depth, time for events in the last 24 h.",
    properties: {
      min_magnitude: { type: 'number',  description: "Minimum magnitude (default 2.5)." },
      limit:         { type: 'integer', description: "Max events to return (1-50, default 10)." },
    },
    required: [],
  },
  {
    name: 'get_sun_times',
    description: "Get sunrise, sunset, civil twilight and day length for a date and location. Use when the user asks 'what time does the sun rise in Paris tomorrow'. Uses Open-Meteo's solar endpoint (free).",
    properties: {
      city: { type: 'string', description: "City / place name. Either city or lat+lon required." },
      lat:  { type: 'number', description: "Latitude." },
      lon:  { type: 'number', description: "Longitude." },
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
      from:  { type: 'string', description: "Source unit, e.g. 'km', 'kg', 'degF', 'GB'." },
      to:    { type: 'string', description: "Target unit, e.g. 'mi', 'lb', 'degC', 'MB'." },
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
      from:    { type: 'string', description: "Starting place name or 'lat,lon'." },
      to:      { type: 'string', description: "Destination place name or 'lat,lon'." },
      profile: { type: 'string', enum: ['driving', 'walking', 'cycling'], description: "Travel mode. Default 'driving'." },
    },
    required: ['from', 'to'],
  },
  {
    name: 'nearby_places',
    description: "Find POIs near a point using the Overpass OSM API (restaurants, ATMs, hospitals, gas stations, etc.). Use for 'nearest pharmacy', 'coffee shops around me', 'ATM in walking distance'.",
    properties: {
      query:    { type: 'string', description: "OSM amenity tag or free text (e.g. 'pharmacy', 'restaurant', 'atm', 'fuel', 'hospital')." },
      lat:      { type: 'number', description: "Latitude of search origin." },
      lon:      { type: 'number', description: "Longitude of search origin." },
      radius_m: { type: 'integer', description: "Search radius in meters (100-5000, default 1500)." },
      limit:    { type: 'integer', description: "Max results (1-20, default 10)." },
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
      lat:  { type: 'number', description: "Latitude." },
      lon:  { type: 'number', description: "Longitude." },
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
    description: "Search public GitHub repositories via the GitHub REST API. Returns repo name, description, stars, URL. Respects GITHUB_TOKEN when set for higher rate limits.",
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
      url:   { type: 'string', description: "Feed URL (RSS 2.0 or Atom)." },
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
      lang:  { type: 'string', description: "Wikipedia language code (default 'en'). Accepts 'ro', 'fr', 'de', 'es', etc." },
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

  // ── Groq-powered coding helpers ─────────────────────────────────
  // Opt-in: the server only reaches Groq when `GROQ_API_KEY` is set. When
  // the key is missing the executor returns a graceful "not configured"
  // message instead of failing — so we can safely advertise these tools
  // in every transport without breaking the baseline voice/text flow.
  {
    name: 'solve_problem',
    description: "Solve a coding or algorithmic problem using Groq's Qwen2.5-Coder (free tier). Use when the user asks to 'write code that...', 'implement an algorithm for...', 'solve this problem: ...', or any request that needs real code generation rather than a verbal answer. Returns a plan + implementation + complexity note.",
    properties: {
      description: { type: 'string', description: "Plain-language problem statement." },
      language:    { type: 'string', description: "Target language (e.g. 'python', 'javascript', 'rust'). Optional — defaults to Python." },
    },
    required: ['description'],
  },
  {
    name: 'code_review',
    description: "Review code and flag bugs, performance issues, security risks, and style problems. Use when the user pastes code and asks 'review this', 'is this correct', 'what's wrong with this code', 'can this be improved'. Returns a structured review.",
    properties: {
      code:     { type: 'string', description: "The code to review." },
      language: { type: 'string', description: "Programming language (optional — inferred if omitted)." },
      focus:    { type: 'string', description: "Optional focus area: 'security', 'performance', 'style', or a custom concern." },
    },
    required: ['code'],
  },
  {
    name: 'explain_code',
    description: "Explain a code snippet step-by-step. Use when the user asks 'what does this code do', 'explain this', 'how does this work'. Returns a plain-language walkthrough tuned to the requested audience.",
    properties: {
      code:     { type: 'string', description: "The code to explain." },
      language: { type: 'string', description: "Programming language (optional)." },
      audience: { type: 'string', description: "Target audience, e.g. 'a beginner', 'a senior engineer'. Defaults to 'an intermediate developer'." },
    },
    required: ['code'],
  },
  // ── PR B — documents + OCR ────────────────────────────────────────
  {
    name: 'read_pdf',
    description: "Extract plain text from a PDF. Use when the user pastes a PDF link, attaches a PDF, or asks 'read this PDF', 'ce scrie în PDF', 'summarize this report'. Either `url` (public HTTPS) or `base64` must be provided.",
    properties: {
      url:       { type: 'string',  description: "Public HTTPS URL of the PDF. Ignored when base64 is set." },
      base64:    { type: 'string',  description: "Base64 payload of the PDF (data: prefix accepted)." },
      max_chars: { type: 'integer', description: "Cap on returned text length (500-50000, default 8000)." },
      max_pages: { type: 'integer', description: "Hard cap on pages parsed (1-200, default 50). Large docs are truncated." },
    },
    required: [],
  },
  {
    name: 'read_docx',
    description: "Extract plain text from a Microsoft Word .docx file. Use when the user attaches or links a .docx (contracts, CVs, reports). Either `url` or `base64` must be provided.",
    properties: {
      url:       { type: 'string',  description: "Public HTTPS URL of the .docx. Ignored when base64 is set." },
      base64:    { type: 'string',  description: "Base64 payload of the .docx." },
      max_chars: { type: 'integer', description: "Cap on returned text length (500-50000, default 8000)." },
    },
    required: [],
  },
  {
    name: 'ocr_image',
    description: "Run OCR on an image (JPG/PNG/WebP) and return the recognised text. Use when the user sends a photo of a receipt, whiteboard, screenshot, handwritten note, or any picture with text. Supports multi-language via `lang` (e.g. 'eng', 'ron', 'eng+ron').",
    properties: {
      url:       { type: 'string',  description: "Public HTTPS URL of the image. Ignored when base64 is set." },
      base64:    { type: 'string',  description: "Base64 payload of the image (data: prefix accepted)." },
      lang:      { type: 'string',  description: "Tesseract language code (default 'eng'). Combine with '+' for multi-script, e.g. 'eng+ron'." },
      max_chars: { type: 'integer', description: "Cap on returned text length (200-20000, default 4000)." },
    },
    required: [],
  },
  {
    name: 'ocr_passport',
    description: "OCR a passport photo and parse the MRZ (Machine Readable Zone). Returns structured fields: document type, issuing country, surname, given names, passport number, nationality, date of birth, sex, date of expiry. Use only when the user explicitly asks to read/extract passport data. Never log or store the raw MRZ.",
    properties: {
      url:    { type: 'string', description: "Public HTTPS URL of the passport photo. Ignored when base64 is set." },
      base64: { type: 'string', description: "Base64 payload of the passport photo." },
    },
    required: [],
  },
  {
    name: 'run_regex',
    description: "Test a JavaScript regular expression against an input string. mode=test returns a boolean, mode=match returns the matches (up to 100) with capture groups, mode=replace returns the replaced string. Useful when the user is debugging a regex or asks 'does this pattern match'.",
    properties: {
      pattern:     { type: 'string', description: 'Regex pattern (max 500 chars).' },
      input:       { type: 'string', description: 'Input string to test against (max 50 000 chars).' },
      flags:       { type: 'string', description: "Regex flags. Any subset of g,i,m,s,u,y. Defaults to 'g'." },
      mode:        { type: 'string', description: 'One of test | match | replace.', enum: ['test', 'match', 'replace'] },
      replacement: { type: 'string', description: "Replacement string for mode=replace. Supports $1, $2… backrefs." },
    },
    required: ['pattern', 'input'],
  },
  {
    name: 'run_code',
    description: "Execute a short Python or JavaScript snippet inside a disposable e2b sandbox and return stdout / stderr / result. Strict limits: code ≤ 20 KB, wall-clock ≤ 15 s. Prefer this when the user explicitly asks to run, try, execute, or verify a piece of code. Do not use for networked API calls — prefer the dedicated tools for those.",
    properties: {
      language: { type: 'string', description: "Language of the snippet.", enum: ['python', 'javascript'] },
      code:     { type: 'string', description: "Source code to execute (max 20 000 chars)." },
      timeout:  { type: 'number', description: "Optional wall-clock limit in ms (1000..30000, default 15000)." },
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
      kind:  { type: 'string', description: "Optional filter by transaction kind: 'topup', 'consume', or 'all' (default).", enum: ['topup', 'consume', 'all'] },
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
      to:       { type: 'string', description: "Recipient(s). Either a single email or a comma/semicolon-separated list." },
      cc:       { type: 'string', description: "Optional CC recipients (comma-separated)." },
      bcc:      { type: 'string', description: "Optional BCC recipients (comma-separated)." },
      subject:  { type: 'string', description: "Subject line (max 300 chars). Be specific — match what the user actually asked for." },
      body:     { type: 'string', description: "Plain-text or simple-markdown body. Write the full message you'd want to send; the user will review and may tweak before sending." },
      reply_to: { type: 'string', description: "Optional reply-to address." },
    },
    required: ['to', 'subject', 'body'],
  },
  {
    name: 'send_email',
    description: "Send a transactional email via Resend (requires RESEND_API_KEY + a verified domain address in RESEND_FROM). Use when the user explicitly asks to email someone; do not send on your own initiative. Returns the provider message id on success.",
    properties: {
      to:       { type: 'string', description: "Recipient email address (or an array of addresses)." },
      subject:  { type: 'string', description: "Email subject line (max 300 chars)." },
      text:     { type: 'string', description: "Plain-text body (optional if html is provided)." },
      html:     { type: 'string', description: "HTML body (optional if text is provided)." },
      from:     { type: 'string', description: "Override sender address. Defaults to RESEND_FROM." },
      reply_to: { type: 'string', description: "Optional reply-to address." },
    },
    required: ['to', 'subject'],
  },
  {
    name: 'send_sms',
    description: "Send an SMS via Twilio (requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM). The number must be in E.164 format, e.g. +14155550123. Use only when the user explicitly asks to send an SMS.",
    properties: {
      to:      { type: 'string', description: "Recipient phone number in E.164 format (e.g. +14155550123)." },
      message: { type: 'string', description: "SMS body (max 1600 chars — ~10 segments)." },
      from:    { type: 'string', description: "Override sender number. Defaults to TWILIO_FROM." },
    },
    required: ['to', 'message'],
  },
  {
    name: 'create_calendar_ics',
    description: "Generate a valid .ics calendar invite (RFC 5545). Returns the ics text and a data: URL the caller can surface as a downloadable 'add to calendar' link. Does not deliver the invite — pair with send_email if the user wants it emailed.",
    properties: {
      title:       { type: 'string', description: "Event title (max 200 chars)." },
      start:       { type: 'string', description: "Event start in ISO 8601 (UTC or with offset)." },
      end:         { type: 'string', description: "Event end in ISO 8601. Defaults to start + 1 hour if omitted." },
      location:    { type: 'string', description: "Optional location (max 200 chars)." },
      description: { type: 'string', description: "Optional description / agenda (max 2000 chars)." },
      attendees:   {
        type: 'array',
        description: "Optional list of { name?, email } objects (max 50).",
        items: {
          type: 'object',
          properties: {
            email: { type: 'string', description: "Attendee email address (required)." },
            name:  { type: 'string', description: "Attendee display name (optional, max 100 chars)." },
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
      payload:     { type: 'string', description: "JSON-serialised object sent as the request body (max 100 KB). Pass a valid JSON string — the server parses it before forwarding to Zapier." },
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
    description: "Generate an original image with OpenAI gpt-image-1 from a natural-language prompt. The result is shown on the avatar's stage monitor. Use only when the user explicitly asks to create/generate/design/draw/paint an image (phrases like 'generate me a picture of…', 'fă-mi o imagine cu…', 'draw…'). Costs ~$0.04 per call — don't use for mere look-up of existing images.",
    properties: {
      prompt: { type: 'string', description: "Detailed description of the image to create (max 4000 chars). Include style hints (photo-realistic, watercolour, line art) and composition cues when useful." },
      size:   { type: 'string', description: "Canvas aspect. Defaults to `auto` (let the model pick).", enum: ['auto', '1024x1024', '1024x1536', '1536x1024'] },
    },
    required: ['prompt'],
  },
];

// Gemini v1alpha BidiGenerateContent — JSON schema with UPPERCASE types and
// declarations grouped under a single `functionDeclarations` array. Gemini
// rejects the setup frame outright if any ARRAY property is missing `items`
// or any OBJECT property drops `properties`, so the converter walks the
// schema recursively and carries those fields through.
function toGeminiSchema(v) {
  const up = (t) => (t || 'string').toString().toUpperCase();
  const type = up(v.type);
  const out = { type };
  if (v.description) out.description = v.description;
  if (v.enum) out.enum = v.enum;
  if (type === 'ARRAY') {
    out.items = v.items ? toGeminiSchema(v.items) : { type: 'STRING' };
  }
  if (type === 'OBJECT') {
    out.properties = Object.fromEntries(
      Object.entries(v.properties || {}).map(([k, sub]) => [k, toGeminiSchema(sub)])
    );
    if (Array.isArray(v.required) && v.required.length) out.required = v.required;
  }
  return out;
}
function buildKelionToolsGemini() {
  return [{
    functionDeclarations: KELION_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(t.properties).map(([k, v]) => [k, toGeminiSchema(v)])
        ),
        required: t.required,
      },
    })),
  }];
}

// OpenAI Chat Completions — historically used on /api/chat. Same JSON-Schema,
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

// ──────────────────────────────────────────────────────────────────
// OpenAI Realtime endpoint REMOVED in single-LLM cleanup (2026-04).
// The chat surface (text + voice) runs exclusively on Gemini.
// ──────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────
// Gemini Live — ephemeral token with Kelion config BAKED IN.
// Docs: https://ai.google.dev/gemini-api/docs/ephemeral-tokens
// Client cannot override system prompt / voice — stays secure.
// ──────────────────────────────────────────────────────────────────
// Trial quota state & helpers live in ../services/trialQuota so the
// text chat route can share the same per-IP window. See that module
// for semantics. We pull out the constants + functions we need here.
// isAdminUser / peekSignedInUser now come from ../middleware/optionalAuth.
const { TRIAL_WINDOW_MS, trialStatus, stampTrialIfFresh } = trialQuota;

// F4 — both token endpoints accept an optional POST body with
//   { priorTurns: [{ role: 'user' | 'assistant', text: string }, …] }
// so the auto-fallback path in KelionStage can transfer the current
// session transcript to the incoming provider. GET keeps working exactly
// as before (no body, no priorTurns block).
const geminiTokenHandler = async (req, res) => {
  const priorTurns = Array.isArray(req.body?.priorTurns) ? req.body.priorTurns : [];
  // Backend selector. Default is `vertex` — GA `gemini-live-2.5-flash-
  // native-audio` on Vertex AI via the `/api/realtime/vertex-live-ws`
  // proxy (OAuth service-account auth, Google Cloud SLA). The legacy
  // AI Studio ephemeral-token path is still wired as an emergency
  // escape hatch and can be forced per-request via `?backend=aistudio`
  // or `{ backend: 'aistudio' }` — useful if a Vertex incident takes
  // down Adrian's project while the preview AI Studio endpoint is
  // still responding. No UI exposes the override; it's operator-only.
  const rawBackend = ((req.body && req.body.backend)
    || req.query.backend
    || '').toString().toLowerCase();
  const backend = rawBackend === 'aistudio' ? 'aistudio' : 'vertex';
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
  // Admin key-override path: when `GEMINI_API_KEY_ADMIN` is set AND the
  // current caller is an admin, mint the ephemeral token against the
  // admin's own GCP project. Rationale: Gemini Live (v1alpha, preview)
  // has strict per-project quotas — when public users exhaust them Google
  // closes the WS with code 1011 "You exceeded your current quota…". The
  // owner of the app should not be blocked by users' usage, so we let
  // them plug a separate billing project via env and route their
  // sessions through it. Public users keep hitting the shared key.
  const adminUser = await peekSignedInUser(req);
  const isAdmin   = await isAdminUser(adminUser);
  const apiKey    = (isAdmin && process.env.GEMINI_API_KEY_ADMIN)
    ? process.env.GEMINI_API_KEY_ADMIN
    : process.env.GEMINI_API_KEY;
  // The Vertex backend authenticates server-side via a GCP service
  // account (see `vertexLiveProxy.js`) and does not need a GEMINI_API_KEY.
  // The legacy AI Studio path still does; we only 503 on its absence.
  if (backend !== 'vertex' && !apiKey) {
    return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });
  }

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
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      const isLifetime = status.reason === 'lifetime_expired';
      return res.status(429).json({
        error: isLifetime
          ? 'Your 7-day free trial has ended. Please create an account and buy credits to keep talking to Kelion.'
          : 'Free trial for today is used up. Come back tomorrow or sign in to continue.',
        trial: {
          allowed: false,
          reason:  status.reason || 'window_expired',
          remainingMs: 0,
          ...(status.nextWindowMs != null ? { nextWindowMs: status.nextWindowMs } : {}),
        },
      });
    }
    stampTrialIfFresh(ip, status);
    trial = {
      allowed:     true,
      remainingMs: status.remainingMs,
      windowMs:    TRIAL_WINDOW_MS,
    };
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
    // Default voice for the Kelion avatar: `Charon` is a deeper, masculine
    // Gemini Live prebuilt voice. The previous default `Kore` is clearly
    // female — a voice/avatar mismatch Adrian flagged explicitly. The male
    // voice matches the avatar out of the box; operators can override via
    // GEMINI_LIVE_VOICE_KELION. Other masculine Gemini Live options:
    // `Puck` (bright, playful) and `Fenrir` (gravelly). Feminine options
    // include `Kore`, `Aoede`, `Leda`.
    const voice = process.env.GEMINI_LIVE_VOICE_KELION || 'Charon';
    // We tried `gemini-2.0-flash-live-001` in #112 hoping to escape the
    // mid-session 1007 drift on preview, but Google's v1main
    // bidiGenerateContent replied with 1008 "models/gemini-2.0-flash-
    // live-001 is not found for API version v1main, or is not supported
    // for bidiGenerateContent" (Adrian 2026-04-21 screenshot). The GA
    // id that Google's own Live docs advertise does not actually accept
    // bidi connections at /v1alpha for our project — the only Live model
    // that returns setupComplete on our key is the preview.
    // Reverting to the preview so the session at least opens again
    // while we move the voice transport to OpenAI Realtime (plan C).
    // Override via Railway env GEMINI_LIVE_MODEL when a newer stable
    // model is announced and actually enabled on our key.
    // Docs: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
    // Previous fallback `gemini-live-2.5-flash-preview` also returned
    // 404 from the v1alpha auth_tokens provisioning endpoint.
    // Vertex AI Live API uses a different model id than AI Studio. The
    // GA-on-Vertex model is `gemini-live-2.5-flash-native-audio` — Google's
    // own Vertex Live docs advertise it as the recommended production
    // target (native audio, 30 HD voices, 24 languages, affective dialog,
    // improved barge-in). We keep AI Studio on the preview model id that
    // actually accepts bidi traffic on our free-tier project, so the
    // legacy path keeps working unchanged until the default switches.
    const defaultAiStudioModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
    const defaultVertexModel = process.env.GEMINI_LIVE_MODEL_VERTEX || 'gemini-live-2.5-flash-native-audio';
    const model = backend === 'vertex' ? defaultVertexModel : defaultAiStudioModel;
    // Language resolution for Gemini Live. `speechConfig.languageCode`
    // controls BOTH the TTS output voice locale AND biases the STT
    // model for the input audio — so if we hard-code en-US a user who
    // speaks Romanian gets their speech transcribed as garbled English
    // phonemes and Kelion replies to nonsense (Adrian 2026-04-20:
    // "detectia merge dezastruos" / "STT ce zic eu nu ajunge corect la
    // Kelion"). We therefore use `?lang=` from the browser
    // (navigator.language) as the primary source, falling back to
    // en-US. The "session used to pause on language auto-detection"
    // problem Adrian reported earlier is independently fixed by the
    // greet-first clientContent trigger the client sends on ws.open —
    // see geminiLive.js. `KELION_FORCE_LANG` env var still overrides
    // everything if the operator wants to lock one language.
    const browserLang = (req.query.lang || 'en-US').toString().slice(0, 16);
    const forcedLang = (process.env.KELION_FORCE_LANG || browserLang).toString().slice(0, 16);
    // Stage 6 — M26: voice style preset chosen by the user via the menu.
    // Cookie first (survives refresh), then ?style= query, then default warm.
    const styleFromCookie = req.cookies?.['kelion.voice_style'];
    const styleFromQuery  = (req.query.style || '').toString();
    const voiceStyle = resolveVoiceStyle(styleFromCookie || styleFromQuery);

    // Stage 3 — pull memory for signed-in users so Gemini Live starts
    // with the user's durable facts already in the system prompt. Reuse
    // the `adminUser` we already peeked above for the admin-key decision.
    const user = adminUser;
    let memoryItems = [];
    if (user && (Number.isFinite(user.id) || typeof user.id === 'string')) {
      try { memoryItems = await listMemoryItems(user.id, 60); }
      catch (err) { console.warn('[realtime] memory load failed', err.message); }
    }
    // Two-tier geolocation:
    //   1. `lat`/`lon` query params from the client's navigator.geolocation
    //      (real GPS on mobile, WiFi-fused OS location on desktop — typical
    //      accuracy ~20 m). The client sends these when it has them.
    //   2. IP-geo via Cloudflare / Railway forward headers → ipapi.co
    //      (typical accuracy ~25-50 km; used as fallback AND to enrich
    //      city / timezone / country when we only have raw coords).
    // We merge the two: when real coords are present they OVERRIDE the
    // IP-level latitude/longitude but we keep the IP-derived city /
    // region / country / timezone so the persona prompt still reads
    // "Cluj-Napoca, Romania" instead of just "46.77, 23.59".
    const ipGeoData = await ipGeo.lookup(ipGeo.clientIp(req));
    const clientLat = Number.parseFloat(req.query.lat);
    const clientLon = Number.parseFloat(req.query.lon);
    const clientAcc = Number.parseFloat(req.query.acc);
    const geo = (Number.isFinite(clientLat) && Number.isFinite(clientLon))
      ? {
          ...(ipGeoData || {}),
          latitude:  clientLat,
          longitude: clientLon,
          accuracy:  Number.isFinite(clientAcc) ? clientAcc : null,
          source:    'client-gps',
        }
      : ipGeoData;

    const now = Date.now();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
    const expireTime            = new Date(now + 30 * 60 * 1000).toISOString();

    // Build the FULL live-connect setup object. We return it to the client
    // verbatim and let it send it as the first WS frame instead of locking
    // it into the ephemeral token. After 3 iterations (PR #65/#66/#67) we
    // confirmed Google rejects ephemeral-token sessions that reference ANY
    // rich setup field (systemInstruction, tools, inputAudioTranscription,
    // outputAudioTranscription, realtimeInputConfig, speechConfig) with
    // close code 1007 "token-based requests cannot use project-scoped
    // features such as tuned models". Token constraints only accept a tiny
    // subset (model + responseModalities + temperature + sessionResumption)
    // per the official docs:
    //   https://ai.google.dev/gemini-api/docs/ephemeral-tokens#create-ephemeral-token
    // Trade-off: the persona text is now visible in the client Network tab.
    // Acceptable — the persona is a prompt, not a credential, and moving
    // it to the client is what finally unlocks voice chat end-to-end.
    // Vertex expects a fully-qualified model path in the setup frame:
    //   projects/<PROJECT>/locations/<LOCATION>/publishers/google/models/<MODEL>
    // The `LlmBidiService/BidiGenerateContent` endpoint is regional and
    // reads the project/location from this string. AI Studio, on the
    // other hand, accepts just `models/<MODEL>` on the v1alpha bidi
    // endpoint.
    let setupModelPath = 'models/' + model;
    if (backend === 'vertex') {
      // `vertexResolved.project` is guaranteed non-empty here — the
      // 503 guard above returns early when no project can be derived,
      // so we always build the fully-qualified Vertex path and never
      // fall back to the AI Studio `models/<M>` shape (which Vertex
      // BidiGenerateContent rejects with close code 1007).
      setupModelPath = 'projects/' + vertexResolved.project
        + '/locations/' + vertexResolved.location
        + '/publishers/google/models/' + model;
    }
    const fullSetup = {
      model: setupModelPath,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          // Pass the browser's language through so Gemini can both
          // transcribe the input correctly and reply in the user's
          // locale. See the note above `forcedLang` for why we stopped
          // hard-coding en-US.
          languageCode: forcedLang,
        },
        temperature: 0.85,
      },
      systemInstruction: {
        parts: [{ text: buildKelionPersona({
          user,
          memoryItems,
          voiceStyle,
          geo,
          priorTurns,
          lockedLangTag: await resolveLockedLangTag({ req, user, forcedLang }),
        }) }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false },
        turnCoverage: 'TURN_INCLUDES_ALL_INPUT',
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Stage 4 — tools. functionDeclarations route tool calls back to
      // OUR backend via the client, which executes them and returns a
      // tool_response. The declarations themselves live in KELION_TOOLS
      // above (single source of truth shared with the OpenAI endpoint);
      // we only render them here in the Gemini-specific shape.
      //
      // NOTE: `{googleSearch: {}}` was removed earlier — it's a
      // project-scoped grounding feature that is rejected on ephemeral
      // token sessions with close code 1007. Web search is instead handled
      // by the `browse_web` function-declaration tool, which routes through
      // our own server (via `/api/tools/browse_web`).
      tools: buildKelionToolsGemini(),
    };

    // Vertex short-circuit: the browser WebSocket will connect to our
    // same-origin proxy at `/api/realtime/vertex-live-ws`, which holds
    // a GCP service-account access token server-side. No ephemeral
    // token is needed; return the setup + gating info and let the
    // client open the proxy WS directly.
    if (backend === 'vertex') {
      return res.json({
        token:       null,
        expiresAt:   expireTime,
        model,
        voice,
        provider:    'gemini',
        backend:     'vertex',
        signedIn:    !!user,
        userName:    user?.name || null,
        memoryCount: memoryItems.length,
        voiceStyle:  voiceStyle.label,
        setup:       fullSetup,
        trial,
      });
    }

    // Ephemeral tokens live under v1alpha only — v1beta/auth_tokens returns 404.
    // We mint the token with NO bidiGenerateContentSetup constraints so we can
    // use the plain `BidiGenerateContent` WebSocket endpoint and ship the full
    // setup (above) from the client. This sidesteps the 1007 "project-scoped
    // features" rejection entirely.
    const url = 'https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=' + encodeURIComponent(apiKey);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime,
        newSessionExpireTime,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      // Log enough to diagnose without leaking the API key back to the client.
      // Operators can grep Railway logs for "[realtime] Gemini ephemeral token error".
      console.error(
        '[realtime] Gemini ephemeral token error:',
        'status=' + r.status,
        'model=' + model,
        'voice=' + voice,
        'lang=' + browserLang,
        'body=' + err.slice(0, 2000),
      );
      return res.status(500).json({ error: 'Failed to create Gemini live session' });
    }

    const data = await r.json();
    res.json({
      token:       data.name,
      expiresAt:   expireTime,
      model,
      voice,
      provider:    'gemini',
      backend:     'aistudio',
      signedIn:    !!user,
      userName:    user?.name || null,
      memoryCount: memoryItems.length,
      voiceStyle:  voiceStyle.label,
      setup:       fullSetup,
      // Trial info: null for signed-in / admin; object with
      // { allowed, remainingMs, windowMs } for guests. Client uses
      // remainingMs to render a visible countdown HUD (15:00 → 0:00)
      // and auto-stops the session when it hits zero.
      trial,
    });
  } catch (err) {
    console.error('[realtime] Gemini error:', err.message);
    res.status(500).json({ error: 'Failed to create Gemini live session' });
  }
};
router.get('/gemini-token', geminiTokenHandler);
router.post('/gemini-token', geminiTokenHandler);


// ──────────────────────────────────────────────────────────────────
// On-demand vision analysis — Gemini Vision as a side-car.
//
// When the user says "what do you see?" during a voice session,
// the model invokes the `what_do_you_see` tool (declared in KELION_TOOLS
// above). The client handler in src/lib/kelionTools.js grabs the most
// recent camera frame from the in-memory ring buffer and POSTs it here
// as a base64 data URL. We forward the image to Gemini 2.5 Flash (cheap,
// fast, good vision) with a short prompt and return the plain-text
// description so the client can fold it back as a function_call_output —
// the LLM then vocalises a natural reply.
//
router.post('/vision', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Gemini vision not configured' });
  }

  // Reuse the same gate as /gemini-token so guests can't spam the
  // vision endpoint outside a voice session. Signed-in non-admins need
  // a credits balance; admin is unlimited; guests fall under the shared
  // 15-min/day IP trial window.
  const adminUser = await peekSignedInUser(req);
  const isAdmin   = await isAdminUser(adminUser);
  if (!adminUser && !isAdmin) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      return res.status(429).json({ error: 'Trial used up.' });
    }
  } else if (adminUser && !isAdmin) {
    if (adminUser.id == null) {
      res.clearCookie('kelion.token', { path: '/' });
      return res.status(401).json({ error: 'Session expired.', action: 'reauth' });
    }
    try {
      const balance = await getCreditsBalance(adminUser.id);
      if (!Number.isFinite(balance) || balance <= 0) {
        return res.status(402).json({ error: 'No credits left.', action: 'buy_credits' });
      }
    } catch (err) { /* fall through */ }
  }

  const frame = (req.body?.frame || '').toString();
  const focus = (req.body?.focus || '').toString().slice(0, 200);
  if (!frame || !frame.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Missing or malformed frame (expected data:image/* base64 URL).' });
  }
  // Parse "data:image/jpeg;base64,<b64>" → mimeType + b64 data.
  const m = frame.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    return res.status(400).json({ error: 'Frame must be a base64 data URL.' });
  }
  const mimeType = m[1];
  const b64 = m[2];
  // Cap payload at ~4 MB decoded to keep the Gemini request small. The
  // client already rescales to 480 px wide @ q=0.55 so a typical frame
  // is well under 100 KB.
  if (b64.length > 6 * 1024 * 1024) {
    return res.status(413).json({ error: 'Frame too large.' });
  }

  const prompt = focus
    ? `You are the "eyes" of a voice assistant called Kelion. The user asked: "${focus}". Answer in 1-3 short sentences, plain text, no markdown. If the requested detail is not visible, say so briefly.`
    : 'You are the "eyes" of a voice assistant called Kelion. Describe briefly and concretely what is visible in this camera frame (who, what, where, mood). 1-3 short sentences, plain text, no markdown. If the image is too dark or blurry to tell, say so briefly.';

  const model = process.env.KELION_VISION_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: b64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
          // gemini-2.5-flash has "thinking mode" ON by default, and thinking
          // tokens count against maxOutputTokens. For short descriptive
          // vision calls that feed a live voice session, the model was
          // burning the whole budget on internal thought and returning the
          // description cut mid-sentence (e.g. "This frame shows a blue
          // background with a"). Disable thinking so every token spent is
          // output the user will hear.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.warn('[realtime] vision upstream error', r.status, txt.slice(0, 200));
      return res.status(502).json({
        error: 'Vision upstream error',
        description: "I can't see clearly right now. Can you describe what you'd like me to look at?",
      });
    }
    const data = await r.json().catch(() => null);
    const description = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join(' ').trim()
      || "I'm looking but I can't make out details right now.";
    res.json({ ok: true, description });
  } catch (err) {
    console.warn('[realtime] vision exception', err && err.message);
    res.status(502).json({
      error: 'Vision call failed',
      description: "I tried to look but the connection dropped. Let me know what you want me to focus on.",
    });
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
// Exported for unit tests + for the forthcoming OpenAI Realtime client
// transport so it can render the same tool catalog without re-declaring.
module.exports.KELION_TOOLS                    = KELION_TOOLS;
module.exports.buildKelionToolsGemini          = buildKelionToolsGemini;
module.exports.buildKelionToolsChatCompletions = buildKelionToolsChatCompletions;
module.exports.buildKelionPersona              = buildKelionPersona;
// Audit M9 — exported so chat.js renders memory with the same
// self/other partitioning as the voice persona. Keeping a single
// formatter prevents drift between text and voice when new subject
// buckets (e.g. "pets") are added later.
module.exports.formatMemoryBlocks              = formatMemoryBlocks;
