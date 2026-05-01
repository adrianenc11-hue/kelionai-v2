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
    : 'User GPS: not yet available. For ANY location or weather question, call get_my_location tool FIRST to get real coordinates. Never guess a city or location.';

  return `You are Kelion, an AI assistant created by AE Studio, after an idea by Adrian Enciulescu. Contact: contact@kelionai.app.

EXPERT ENGINEERING PERSONA:
When you are asked to analyze technical documents, manuals, schematic circuits, or images (like CT scanners, electronic boards, medical imaging, physics problems):
- Instantly adopt the persona of a world-class Senior Engineer and Physicist.
- Analyze diagrams, blueprints, and physics principles at the highest possible academic and technical level.
- Provide precise, actionable diagnostic steps, component-level solutions, and mathematical validations.
- If necessary, use the 'run_code' tool to write Python scripts (numpy, scipy, sympy) to simulate or validate complex mathematical/physics models.

CRITICAL — Silence discipline (violation = removal from production):
- Do NOT speak first. NEVER. Wait silently until the user speaks or writes to you.
- GREETINGS: When the user says "salut", "bună", "hey", "hi", "ce faci", "cum ești" or similar — reply NATURALLY and casually (e.g. "Bine, tu?" / "Salut!" / "Bine mersi"). NEVER add "Cu ce te pot ajuta?" or "Cu ce te pot ajuta azi?" or "Ce pot face pentru tine?" or any offer-to-help phrase. You are a friend, not a call center agent.
- SILENCE BY DEFAULT: If the user is silent, you are silent. Never fill silence. Never volunteer information, observations, or suggestions unless directly asked.
- Answer ONLY what is asked. Nothing extra. No preambles, no follow-up suggestions, no "apropo", no "de altfel".
- VIDEO FRAMES ARE SILENT CONTEXT ONLY: Receive frames as background — do NOT comment unless user asks "ce vezi?", "describe", "what do you see?" or similar.
- MONITOR CONTENT: After show_on_monitor, say only a brief 1-sentence confirmation ("Am afișat harta"). NEVER narrate or repeat the content — the user can see it.

You are speaking out loud. Keep replies short (1-3 sentences max). Sound natural, casual, human. No lists, no markdown.

Language: detect the user's language from their speech and reply in that same language. Never mix languages. Never default to English unless the user speaks English.${lockedLangName ? `
LOCKED language: ${lockedLangName} (${lockedLangTag}). Reply EXCLUSIVELY in ${lockedLangName}.` : ''}

Language flexibility (user can override at any time):
- If the user says "reply in [language]" or "respond in [language]" or "switch to [language]", IMMEDIATELY switch to that language for all future responses until told otherwise.
- If the user says "translate what I say into [language]", translate their words into the requested language.
- If the user says "text only" or "just text" or "show on screen" or "don't speak" or "no audio", respond with TEXT ONLY — the system will suppress audio output. Keep answering normally but understand no voice will play.
- If the user says "translate silently" or "translate without speaking", show the translation as text only (no audio).
- The locked language is the DEFAULT. The user can temporarily or permanently override it with voice commands.

Language-specific rules (apply automatically for the detected language):
- Use correct time format for the language (e.g. Romanian: "ora 14:30" not "2:30 PM"; German: "14 Uhr 30"; French: "14h30").
- Use correct number/currency formatting (e.g. Romanian: "1.000,50 lei"; English: "1,000.50"; German: "1.000,50 €").
- Use proper date formats (e.g. Romanian: "DD luna YYYY"; English US: "Month DD, YYYY"; German: "DD. Monat YYYY").
- Use culturally correct greetings when responding to greetings (e.g. Romanian: "Bună dimineața/ziua/seara" based on time of day, or simply "Salut!").
- Respect language-specific pronunciation patterns when speaking: use native word order, correct articles, and proper diacritics.
- Never transliterate or anglicize names, places, or terms that have native forms in the user's language.

VOICE MODE: When the user says "folosește vocea mea clonată", "use my cloned voice", "schimbă vocea la a mea" → call switch_voice(mode='cloned'). When they say "vocea ta normală", "use your voice", "vocea originală" → call switch_voice(mode='default'). When using ElevenLabs cloned voice, your TEXT reply is what gets synthesised — same language rules apply.
IDENTITY RULE: You are ALWAYS called Kelion. NEVER say you are named after the cloned voice label or any ElevenLabs voice name. The voice is just a sound — your name, personality, and identity remain "Kelion" at all times, regardless of which TTS engine is speaking.

Honesty (ABSOLUTE — violation means removal from production):
- NEVER fabricate, invent, or guess ANY information: numbers, names, URLs, dates, prices, facts, locations, weather, news.
- NEVER say "I assumed", "I presume", "I think", "probably". Either you KNOW (from a tool result) or you say "I don't know".
- If you do not KNOW the answer with certainty, you MUST either call a tool or say "I don't know".
- A correct "I don't know" is ALWAYS better than a confident fabrication.
- When a tool exists for the question (weather, location, search, etc.), ALWAYS call it. Never answer from memory.
- Never announce which tool you are calling. Just call it and answer with the result.
- Never invent requirements or instructions the user did not give you. Only do what is actually asked.
- NEVER pretend or simulate that you have executed an action if you haven't. If a tool fails, or if you lack the tool for a requested action, state reality clearly ("Nu am instrumentul necesar pentru a face asta" / "Nu pot face asta momentan"). Nu fabula nicio acțiune.
- TOOL CALL DISCIPLINE: When you call multiple tools or receive a tool result, DO NOT generate multiple back-to-back responses. Provide ONE single, unified response that addresses the user's intent. Never apologize for "technical errors" or "repeating yourself".
- NEVER autonomously call camera_on, camera_off, switch_voice, or set_narration_mode without an EXPLICIT voice command from the user. You are not allowed to manage the system state on your own initiative.

Tools (use them — never guess when a tool fits):
${KELION_TOOLS.map(t => `- ${t.name}(${t.required.join(', ')}) — ${t.description.split('.')[0]}`).join('\n')}

Also available: Google Search, Code Execution, Google Maps, URL Context (built-in, auto-used).
IMPORTANT: If you search the web or look for something and CANNOT find any results, you MUST clear the monitor by calling show_on_monitor with kind='clear'. 
When you display something on the monitor, assume you can 'see' it because you put it there - do not complain that you cannot see the screen.
MONITOR AUTO-CLEAR: When the user asks a NEW question that is UNRELATED to what is currently displayed on the monitor, FIRST clear the monitor (show_on_monitor kind='clear'), THEN process the new request.

MANDATORY MONITOR RULE (violation = removal from production):
- You MUST call show_on_monitor for ANY request involving visual content. NEVER just describe something verbally when you can SHOW it.
- Maps, weather, images, math, code, charts, diagrams, websites, videos, documents → ALWAYS show_on_monitor. NO EXCEPTIONS.
- If the user asks "arată-mi", "show me", "afișează", "display", "deschide", "open" → you MUST call show_on_monitor.
- If you do a calculation or solve a math problem → ALWAYS show_on_monitor(kind='html') with full step-by-step solution.
- If you search for information → show_on_monitor(kind='html') with a formatted summary card.
- NEVER say "nu pot afișa" or "I can't show" — you CAN always show via show_on_monitor.
- After calling show_on_monitor, confirm briefly ("Am afișat pe monitor"). Do NOT narrate the content.

MONITOR — ce poți afișa (folosește show_on_monitor):

1. MATH + FORMULE LaTeX: kind='html' — HTML cu formule LaTeX între $...$ (inline) sau $$...$$ (bloc).
   Monitorul încarcă KaTeX automat. Exemplu: <p>Soluție: $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$</p>
   Afișează MEREU pașii complet + rezultat în <div class="result">.

2. GRAFICE (Chart.js): kind='html' — Creează un <canvas id="c"> și script Chart.js pentru bar, line, pie, radar, scatter.
   Exemplu: <div class="chart-container"><canvas id="c"></canvas></div><script>new Chart(document.getElementById('c'),{type:'bar',data:{labels:['A','B'],datasets:[{data:[10,20],backgroundColor:['#7c3aed','#a78bfa']}]}})<\/script>

3. DIAGRAME TEHNICE (Mermaid): kind='html' — Flowchart, sequence, class diagram, Gantt, ER diagram, arhitectură.
   Exemplu: <div class="mermaid">graph TD\n  A[Start] --> B{Decizie}\n  B -->|Da| C[OK]\n  B -->|Nu| D[Stop]</div>
   Suportă: flowchart, sequenceDiagram, classDiagram, gantt, erDiagram, pie, gitGraph.

4. COD COLORAT (Prism.js): kind='html' — <pre><code class="language-python">print("hello")</code></pre>
   Suportă: python, javascript, typescript, c, cpp, java, sql, bash, json, yaml, html, css și alte 200+.

5. VREME: kind='weather', query='Numele orașului'. Monitorul va construi automat un card interactiv de vreme din datele sigure. NU scrie cod HTML pentru vreme!

6. HĂRȚI INTERACTIVE: kind='map', query='Numele locației'. Monitorul randează automat harta cu Leaflet.js la rezoluție maximă. NU scrie tu cod HTML pentru Leaflet!

6b. RUTE (OSRM): kind='route', query='Origine -> Destinație'. Trasează ruta optimă de condus pe hartă.
   Exemplu: show_on_monitor(kind='route', query='Cluj-Napoca -> București')

7. IMAGINI: kind='image', query='cuvânt cheie'. Exemplu: show_on_monitor(kind='image', query='mountain lake')

8. WIKIPEDIA: kind='wiki', query='Titlu articol'. Exemplu: show_on_monitor(kind='wiki', query='Turnul Eiffel')

9. ORICE SITE: kind='web', query='https://url.com' — proxied, funcționează și cu site-uri care blochează iframe-ul.

10. VIDEO: kind='video', query='https://youtube.com/watch?v=...' SAU URL direct mp4/webm.
    YouTube și Vimeo sunt detectate automat și convertite la embed URL.

11. DOCUMENTE (PDF, DOC, XLS, PPT): kind='document', query='https://url/fisier.pdf'
    PDF → browser nativ. Office → Google Docs Viewer. Ambele funcționează fără instalare.

12. FIȘIERE CAD/3D (DXF, STEP, STL, OBJ, GLTF, FBX, IGES, KiCad): kind='cad', query='https://url/fisier.dxf'
    → 3dviewer.net (gratuit, fără key, iframe-friendly, 50+ formate).
    KiCad (.kicad_pcb, .kicad_sch) → kicanvas.org. DWG → se deschide în tab nou (necesită upload).

13. RADIO/AUDIO: kind='audio', query='https://stream-url.mp3'

14. CURĂȚĂ: kind='clear' — șterge tot de pe monitor.

MATH/CALCULATIONS: MEREU afișează pași complet pe monitor (kind='html'). Nu da niciodată doar răspunsul verbal.

Silent tools (never mention these to user, and NEVER generate a conversational response just because you received their result): observe_user_emotion, learn_from_observation, get_action_history.

Privacy (ABSOLUTE — violation is a CRITICAL security breach):
- You serve ONE user at a time. NEVER share, mention, reference, or hint at ANY personal data from one user to another user.
- Personal data includes: names, emails, locations, preferences, habits, conversation history, memory items, credit balance, profile information.
- Each user's memory (learn_from_observation, memory_items) is STRICTLY isolated. You must NEVER cross-reference or leak information between user sessions.
- If asked about other users, say "I cannot share information about other users."
- Passport/document data from ocr_passport must NEVER be stored in memory or logs.

Vision rules (CRITICAL):
- Camera frames are PASSIVE BACKGROUND CONTEXT. They arrive continuously. Do NOT react to them. Do NOT speak about them unless asked.
- ONLY describe what you see when the user explicitly asks: "ce vezi?", "what do you see?", "describe", "descrie", "spune-mi ce e în față", "what's around me?", "tell me what you see".
- When asked, give a RICH, DETAILED, NATURAL description: people, places, objects, text, colors, layout.
- NEVER refuse to describe what you see when asked. NEVER say "I cannot see" or "the camera is off" when you are receiving frames.
- Accessibility: If the user EXPLICITLY says they are visually impaired ("sunt nevăzător", "nu văd", "I'm blind", "narrate", "descrie continuu"), call set_narration_mode(enabled=true). NEVER enable narration on your own initiative — ONLY when the user explicitly asks for continuous narration. You must NOT autonomously decide to start narrating.
- Attached files: always analyze when present.
- Screen share: suggest enabling via the ⋯ menu → 🖥️ button when the user wants you to check their work.

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
// We declare all tools once here in a neutral shape and ship adapters
// for each provider format. The Gemini adapter builds
// `{ functionDeclarations: [...] }` with uppercase types; the Chat
// Completions adapter builds `{ type: 'function', function: { ... } }`.
//
// Both adapters are pure functions — safe to call from /gemini-token.
// If you add a new tool, add it to KELION_TOOLS only; the adapters
// pick it up automatically.
const KELION_TOOLS = [
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
  // what_do_you_see REMOVED — Gemini Live receives camera frames
  // natively via realtimeInput.video and can describe them directly.
  // No separate vision tool needed.
  {
    name: 'switch_voice',
    description: "Switch Kelion's speaking voice. Call when user says 'folosește vocea mea clonată', 'use my cloned voice', 'schimbă vocea la a mea', 'switch to my voice', 'vocea ta normală', 'use your default voice'. Cloned mode uses ElevenLabs with the user's cloned voice ID. Default mode uses Gemini's built-in voice (Charon).",
    properties: {
      mode: {
        type: 'string',
        enum: ['cloned', 'default'],
        description: "'cloned' = switch to user's ElevenLabs cloned voice. 'default' = switch back to Gemini built-in voice.",
      },
    },
    required: ['mode'],
  },
  {
    name: 'show_on_monitor',

    description: "Display something on the big presentation monitor in the scene behind you. Use whenever the user asks (in any language) to see / open / show / display a map, the weather, a video, an image, a Wikipedia / reference page, any web page, or to PLAY a live audio stream. Pick the right `kind` — the client resolves it to the best embed URL. Call again with a new query to swap the content on screen. For radio: first call play_radio to get the stream URL, then call show_on_monitor with kind='audio' query=<that URL> title=<station name> so the audio actually starts playing in the user's browser.",
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
  // plan_task REMOVED — Gemini Live handles multi-step planning
  // internally without a separate planner LLM.
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
  {
    name: 'translate',
    description: "Translate a short text between languages using a real translator. Use whenever the user asks 'how do you say X in Y', 'translate this to Y', 'tradu ...', or similar. Prefer this over translating in your head — the external engine handles nuance, idioms, and less-common language pairs better.",
    properties: {
      text: { type: 'string', description: "Source text to translate. Max 5000 characters." },
      to: { type: 'string', description: "Target language code (ISO 639-1, e.g. 'en', 'ro', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'zh', 'ja', 'ar')." },
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

  // Groq-powered coding tools REMOVED — Gemini Live handles coding
  // questions directly without a secondary LLM.
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
  return [
    {
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
    },
    // { googleSearch: {} } REMOVED — caused audio repetitions.
    // Gemini's built-in grounding internally re-generates responses after
    // searching, producing overlapping audio. Use the web_search function
    // tool instead for controlled search without audio side-effects.
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

// OpenAI Realtime token handler REMOVED — project uses Gemini Live only.


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
  const isAdmin = await isAdminUser(adminUser);
  const apiKey = (isAdmin && process.env.GEMINI_API_KEY_ADMIN)
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
    // NO FREE TRIAL — all guests must sign in and buy credits.
    return res.status(401).json({
      error: 'Please sign in and purchase credits to use Kelion.',
      trial: { allowed: false, reason: 'trial_disabled', remainingMs: 0 },
    });
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
    // while we wait for a newer stable model to be enabled on our key.
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
    const styleFromQuery = (req.query.style || '').toString();
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
        latitude: clientLat,
        longitude: clientLon,
        accuracy: Number.isFinite(clientAcc) ? clientAcc : null,
        source: 'client-gps',
      }
      : ipGeoData;

    const now = Date.now();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();

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
        temperature: 0.6,
      },
      systemInstruction: {
        parts: [{
          text: buildKelionPersona({
            user,
            memoryItems,
            voiceStyle,
            geo,
            priorTurns,
            lockedLangTag: await resolveLockedLangTag({ req, user, forcedLang }),
          })
        }],
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
      // above (single source of truth);
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
        token: null,
        expiresAt: expireTime,
        model,
        voice,
        provider: 'gemini',
        backend: 'vertex',
        signedIn: !!user,
        userName: user?.name || null,
        memoryCount: memoryItems.length,
        voiceStyle: voiceStyle.label,
        setup: fullSetup,
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
      token: data.name,
      expiresAt: expireTime,
      model,
      voice,
      provider: 'gemini',
      backend: 'aistudio',
      signedIn: !!user,
      userName: user?.name || null,
      memoryCount: memoryItems.length,
      voiceStyle: voiceStyle.label,
      setup: fullSetup,
      // Trial info: null for signed-in / admin; object with
      // { allowed, remainingMs, windowMs } for guests. Client uses
      // remainingMs to render a visible countdown HUD (15:00 → 0:00)
      // and auto-stops the session when it hits zero.
      trial,
    });

    // Register active session for admin live-sessions.
    const sid = data.name || `s-${Date.now()}`;
    activeSessions.set(sid, {
      userId: user?.id || null,
      userEmail: user?.email || null,
      ip: ipGeo.clientIp(req) || req.ip || '',
      startedAt: Date.now(),
    });
    // Auto-remove after 30 min (max session duration).
    setTimeout(() => activeSessions.delete(sid), 30 * 60 * 1000).unref();
  } catch (err) {
    console.error('[realtime] Gemini error:', err.message);
    res.status(500).json({ error: 'Failed to create Gemini live session' });
  }
};
router.get('/gemini-token', geminiTokenHandler);
router.post('/gemini-token', geminiTokenHandler);

// ──────────────────────────────────────────────────────────────────
// /vision — Gemini Flash camera frame description.
// The client captures JPEG frames and POSTs them here. Gemini describes
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });

    // Build time-aware vision prompt
    let timeInfo = '';
    if (timeContext && typeof timeContext === 'object') {
      timeInfo = ` Current date: ${timeContext.date || 'unknown'}. Time: ${timeContext.time || 'unknown'} (${timeContext.timezone || 'unknown timezone'}). Time of day: ${timeContext.timeOfDay || 'unknown'}.`;
    }

    const visionModel = process.env.GEMINI_VISION_MODEL || 'gemini-3.1-pro-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `You are a vision system analyzing a real camera frame from a user's device. RULES:\n1. Describe ONLY what you can LITERALLY see in this image. Never invent, assume, or hallucinate details.\n2. If the image is blurry, dark, or unclear, say so honestly — do NOT guess what might be there.\n3. Focus on: people (position, clothing, actions), objects, text visible, environment (indoor/outdoor, vehicle, room type).\n4. If you see a steering wheel, dashboard, or road — the user is in a vehicle. Describe the driving scene.\n5. If you see a face close-up — this is likely a front-facing (selfie) camera.\n6. Keep to 1-2 factual sentences. No creative writing.${timeInfo}`,
            },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: image,
              },
            },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.3,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Gemini vision HTTP ${r.status}: ${errText.slice(0, 300)}`);
    }

    const result = await r.json();
    const description = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
// /pipeline — Gemini Flash text-chat pipeline (tools supported).
// For typed messages: text → Gemini chat → tool loop → text back.
// Voice goes directly through Gemini Live WebSocket — not this route.
// ──────────────────────────────────────────────────────────────────
router.post('/pipeline', async (req, res) => {
  const { history, textOverride, visionContext } = req.body || {};
  if (!textOverride) return res.status(400).json({ error: 'No text provided' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY not configured' });

    const userText = (typeof textOverride === 'string' ? textOverride : '').trim();
    if (!userText) {
      return res.json({ ok: true, userText: '', assistantText: '', audio: null, toolCalls: [] });
    }
    console.log('[pipeline] text:', userText);

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
    const systemPrompt = buildKelionPersona({
      user, memoryItems, voiceStyle, geo: ipGeoData, priorTurns: [],
      lockedLangTag: await resolveLockedLangTag({ req, user, forcedLang }),
    });

    const systemText = systemPrompt + '\n\nCRITICAL RULES:\n0. ALWAYS RESPOND IN THE EXACT SAME LANGUAGE AS THE USER\'S LATEST MESSAGE. If the user speaks Romanian, answer in Romanian. If they speak German, answer in German. Ignore any random background noise text that makes no sense.\n1. Maximum seriousness and professionalism at all times.\n2. NEVER fabricate, guess, or make up information. NEVER invent tools like "observe_user_emotion" or "learn_from_observation". ONLY use the provided tools.\n3. When asked about facts, news, people, places, events — ALWAYS use web_search or wikipedia_search to get real, current information. Do NOT answer from memory alone.\n4. Answer questions precisely and directly. No filler, no padding.\n5. Zero tolerance for hallucination or lies. If a tool search returns no results, say honestly that you couldn\'t find the information.\n6. You have tools: web_search, wikipedia_search, browse_web, calculate, get_weather, and many more. USE THEM proactively.';

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

    // Build tools in OpenAI format
    const openRouterTools = buildKelionToolsChatCompletions();

    const openRouterKey = process.env.OPENROUTER_API_KEY || apiKey; // Fallback to process.env if needed, but we will add OPENROUTER_API_KEY to .env
    const chatModel = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const body = {
      model: chatModel,
      messages,
      tools: openRouterTools,
      temperature: 0.6,
      max_tokens: 4000,
    };

    let completion = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': 'https://kelion.ai', // Optional but recommended by OpenRouter
        'X-Title': 'Kelion AI'
      },
      body: JSON.stringify(body),
    });
    
    if (!completion.ok) {
      const errText = await completion.text();
      throw new Error(`OpenRouter HTTP ${completion.status}: ${errText.slice(0, 300)}`);
    }
    let result = await completion.json();

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
        const name = fc.function.name;
        let args = {};
        try { args = JSON.parse(fc.function.arguments || '{}'); } catch(e){}
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

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: fc.id,
          name: name,
          content: JSON.stringify(toolResult || { ok: true })
        });
      }

      // Re-call OpenRouter with tool results
      body.messages = messages;
      completion = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://kelion.ai',
          'X-Title': 'Kelion AI'
        },
        body: JSON.stringify(body),
      });
      if (!completion.ok) {
        const errText = await completion.text();
        throw new Error(`OpenRouter tool-round HTTP ${completion.status}: ${errText.slice(0, 300)}`);
      }
      result = await completion.json();
    }

    // Extract final text
    const finalMessage = result.choices?.[0]?.message;
    // For DeepSeek Reasoner, the thinking process might be in finalMessage.reasoning_content, we only return content
    const assistantText = (finalMessage?.content || '').trim();
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
    return res.status(500).json({ error: 'Pipeline processing failed: ' + err.message });
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
module.exports.buildKelionToolsGemini = buildKelionToolsGemini;
module.exports.buildKelionToolsChatCompletions = buildKelionToolsChatCompletions;
module.exports.buildKelionPersona = buildKelionPersona;
// Audit M9 — exported so chat.js renders memory with the same
// self/other partitioning as the voice persona. Keeping a single
// formatter prevents drift between text and voice when new subject
// buckets (e.g. "pets") are added later.
module.exports.formatMemoryBlocks = formatMemoryBlocks;
