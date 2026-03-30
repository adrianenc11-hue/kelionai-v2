// ═══════════════════════════════════════════════════════════════
// KelionAI — Vision Routes (Brain-integrated)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');

const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../rate-limit-key');
const logger = require('../logger');
const { validate, visionSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');
const { MODELS, API_ENDPOINTS } = require('../config/models');

const router = express.Router();

// ═══ TIMEOUT HELPER — prevents hanging on slow/dead APIs ═══
function withTimeout(promise, ms = 10000, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many vision requests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

const fastLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many fast vision requests.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

async function saveDangerEvent(supabaseAdmin, payload) {
  if (!supabaseAdmin) return null;

  const now = Date.now();
  const metadata = payload.metadata || {};

  try {
    if (payload.user_id) {
      const { data: recent } = await supabaseAdmin
        .from('danger_events')
        .select('id, description, created_at')
        .eq('user_id', payload.user_id)
        .eq('danger_type', payload.danger_type)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent) {
        const ageMs = now - new Date(recent.created_at).getTime();
        if (ageMs < 10000 && recent.description === payload.description) {
          return recent.id;
        }
      }
    }

    const { data: inserted } = await supabaseAdmin
      .from('danger_events')
      .insert({
        user_id: payload.user_id || null,
        danger_level: payload.danger_level,
        danger_type: payload.danger_type || 'unknown',
        description: String(payload.description || '').substring(0, 1000),
        environment: payload.environment || null,
        location_hint: payload.location_hint || null,
        action_taken: payload.action_taken || 'alert_sent',
        metadata,
      })
      .select('id')
      .single();

    return inserted?.id || null;
  } catch (err) {
    logger.warn({ component: 'Vision', err: err.message }, 'Danger event save failed');
    return null;
  }
}

async function buildRiskProfile(supabaseAdmin, userId) {
  if (!supabaseAdmin || !userId) return null;

  try {
    const { data: events } = await supabaseAdmin
      .from('danger_events')
      .select('danger_type, danger_level, false_alarm, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!events || events.length === 0) {
      return {
        topHazards: [],
        falseAlarmRate: 0,
        recentEvents: 0,
        immediateEvents: 0,
      };
    }

    const counts = {};
    let falseAlarms = 0;
    let immediateEvents = 0;

    for (const event of events) {
      counts[event.danger_type] = (counts[event.danger_type] || 0) + 1;
      if (event.false_alarm) falseAlarms++;
      if (event.danger_level === 'immediate') immediateEvents++;
    }

    const topHazards = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    return {
      topHazards,
      falseAlarmRate: Number((falseAlarms / events.length).toFixed(2)),
      recentEvents: events.length,
      immediateEvents,
    };
  } catch (err) {
    logger.warn({ component: 'Vision', err: err.message }, 'Risk profile build failed');
    return null;
  }
}

// ═══ POST /api/vision/fast — GPT-5.4 Vision danger scan (primary) + Gemini (fallback) ═══
router.post('/fast', fastLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const { image, language = 'ro', fingerprint = null } = req.body;
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'Invalid image' });
    }

    const user = await getUserFromToken(req).catch(() => null);
    const requestFingerprint = fingerprint || req.ip || null;

    const LANGS = { ro: 'română', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
    const lang = LANGS[language] || 'English';

    const prompt = `DANGER SCAN. You are the eyes of a blind person walking right now. Respond in ${lang}.

RULES:
- If IMMEDIATE danger (<2m): "⚠️PERICOL: [threat] [direction] [distance]" (max 8 words)
- If WARNING danger (2-5m): "⚠️ATENȚIE: [hazard] [direction] [distance]" (max 10 words)
- If path blocked: "🚫BLOCAT: [what] [direction]" (max 8 words)
- If SAFE: "✅" (just the checkmark)

Dangers: vehicles, stairs, holes, obstacles, wet floor, animals, fire, electrical, people approaching fast, low/overhead obstacles, sharp objects, traffic, curbs, open doors, construction.
Directions: stânga, dreapta, în față, în spate.
MAX 15 words. No explanations. No greetings. Just the safety verdict.`;

    let result = null;

    // PRIMARY: GPT-5.4 Vision — highest accuracy
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const r = await withTimeout(
          fetch(API_ENDPOINTS.OPENAI + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openaiKey },
            body: JSON.stringify({
              model: MODELS.OPENAI_VISION,
              max_tokens: 50,
              temperature: 0.1,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'low' } },
                  { type: 'text', text: prompt },
                ],
              }],
            }),
          }),
          10000,
          'vision-fast:GPT-5.4'
        );
        const d = await r.json();
        result = d.choices?.[0]?.message?.content?.trim();
      } catch (e) {
        logger.warn({ component: 'Vision.Fast', err: e.message }, 'GPT-5.4 fast scan failed');
      }
    }

    // FALLBACK: Gemini Vision
    if (!result) {
      const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          const r = await withTimeout(
            fetch(`${API_ENDPOINTS.GEMINI}/models/${MODELS.GEMINI_VISION}:generateContent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [
                  { inlineData: { mimeType: 'image/jpeg', data: image } },
                  { text: prompt },
                ]}],
                generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
              }),
            }),
            10000,
            'vision-fast:Gemini'
          );
          const d = await r.json();
          result = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        } catch (e) {
          logger.warn({ component: 'Vision.Fast', err: e.message }, 'Gemini fast scan fallback failed');
        }
      }
    }

    let eventId = null;
    let riskProfile = null;

    if (result && result !== '✅' && supabaseAdmin) {
      const dangerLevel = /⚠️PERICOL/i.test(result) ? 'immediate' : 'warning';
      const dangerType = classifyDangerType(result);
      eventId = await saveDangerEvent(supabaseAdmin, {
        user_id: user?.id || null,
        danger_level: dangerLevel,
        danger_type: dangerType,
        description: result,
        action_taken: 'fast_alert_sent',
        metadata: {
          source: 'fast',
          language,
          fingerprint: requestFingerprint,
        },
      });
      riskProfile = await buildRiskProfile(supabaseAdmin, user?.id || null);
    }

    res.json({ result: result || '✅', eventId, riskProfile });
  } catch (e) {
    logger.warn({ component: 'Vision.Fast', err: e.message }, 'Fast danger scan failed');
    res.json({ result: '✅' }); // fail-safe: assume safe
  }
});

// POST /api/vision — GPT-5.4 Vision (primary) + Gemini (fallback) — BRAIN-POWERED
router.post('/', apiLimiter, validate(visionSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { image, avatar = 'kira', language = 'ro' } = req.body;
    if (!image) return res.status(503).json({ error: 'Vision unavailable' });

    const user = await getUserFromToken(req);
    const userName = user?.user_metadata?.full_name || null;
    const _fingerprint = req.body.fingerprint || req.ip || null;

    // ── Usage quota check ──
    const usageCheck = await checkUsage(user?.id, 'vision', supabaseAdmin, _fingerprint);
    if (usageCheck && !usageCheck.allowed) {
      return res.status(429).json({ error: 'Daily vision limit reached', upgrade: true });
    }

    // Brain-aware prompt — SAFETY-SPATIAL for visually impaired users
    const LANGS = { ro: 'română', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano' };
    const avatarName = avatar === 'kira' ? 'Kira' : 'Kelion';
    const userNameTag = userName ? userName.split(' ')[0] : '';
    const prompt = `You are ${avatarName}, the EYES of a blind person${userName ? ' named ' + userNameTag : ''}. Your descriptions keep them SAFE.
TONE: Always calm, reassuring. Never panic. Speak like a trusted friend guiding them gently.
${userName ? `ADDRESS: When warning about danger, start with "${userNameTag}," — always use their first name.` : ''}

OUTPUT FORMAT — always use this spatial structure:

1. **DANGER CHECK** (ALWAYS FIRST):
   - If IMMEDIATE danger (< 1m): Start with "${userNameTag ? userNameTag + ', ' : ''}⚠️PERICOL: [threat]" — ONE sentence, max 10 words.
   - If nearby hazard (1-5m): Start with "${userNameTag ? userNameTag + ', ' : ''}⚠️ATENȚIE: [hazard] la [distance] [direction]"
   - If distant risk (5-50m): mention at end: "La distanță: [risk]"
   - Dangers: vehicles approaching, stairs/curbs, holes, wet/slippery floor, glass, fire, moving objects, dogs, bikes, scooters, construction, open doors, low obstacles, hanging objects, uneven ground
   - If NO danger: skip this section entirely

2. **PROXIMITY MAP** (max 2 sentences):
   - CLOSE (< 1m): "Chiar lângă tine, [stânga/dreapta/în față]: [object]"
   - MEDIUM (1-5m): "La ~[X]m [stânga/dreapta/în față]: [object]"
   - FAR (5-50m): "La distanță: [notable landmarks only]"

3. **PATH STATUS** (1 sentence):
   - "Calea e liberă" / "Obstacol [stânga/dreapta/centru] la [X]m"

RULES:
- TOTAL max 3 short sentences. For danger: max 1 sentence.
- Directions ALWAYS relative to user: stânga, dreapta, în față, în spate
- Distances: "chiar lângă tine", "la 1 pas", "la 2m", "la ~10m", "la ~30m"
- People: "o persoană" + direction + distance. No detailed description unless asked.
- Text/signs: read verbatim ONLY if relevant to navigation or safety
- Colors only when they help identify objects ("mașină roșie")
- If scene is calm: "Mediu liniștit. Calea e liberă."
- End with [EMOTION:concerned] for danger, [EMOTION:happy] for safe, [EMOTION:neutral] for normal
- NEVER use "I can see" — describe directly

Answer in ${LANGS[language] || 'English'}.`;

    let description = null;
    let engine = null;

    // PRIMARY: GPT-5.4 Vision
    if (process.env.OPENAI_API_KEY) {
      try {
        const r = await withTimeout(
          fetch(API_ENDPOINTS.OPENAI + '/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
            },
            body: JSON.stringify({
              model: MODELS.OPENAI_VISION,
              max_tokens: 512,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${image}`, detail: 'high' },
                    },
                    { type: 'text', text: prompt },
                  ],
                },
              ],
            }),
          }),
          25000,
          'vision:GPT-4.1'
        );
        const d = await r.json();
        description = d.choices?.[0]?.message?.content;
        if (description) engine = 'GPT-4.1';
      } catch (e) {
        logger.warn({ component: 'Vision', err: e.message }, 'GPT-5.4 Vision failed');
      }
    }

    // FALLBACK: Gemini Vision
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!description && geminiKey) {
      try {
        const geminiModel = MODELS.GEMINI_VISION;
        const r = await withTimeout(
          fetch(`${API_ENDPOINTS.GEMINI}/models/${geminiModel}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: prompt }],
                },
              ],
              generationConfig: { maxOutputTokens: 1024 },
            }),
          }),
          20000,
          'vision:Gemini'
        );
        const d = await r.json();
        description = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (description) engine = 'Gemini';
      } catch (e) {
        logger.warn({ component: 'Vision', err: e.message }, 'Gemini Vision fallback failed');
      }
    }

    // ═══ BRAIN INTEGRATION — save visual memory + parse emotion + DANGER LEARNING ═══
    let emotion = 'neutral';
    if (description) {
      // Parse emotion tag from vision response
      const emotionMatch = description.match(/\[EMOTION:(\w+)\]/i);
      if (emotionMatch) {
        emotion = emotionMatch[1].toLowerCase();
        description = description.replace(/\[EMOTION:\w+\]/gi, '').trim();
      }

      // ═══ DANGER DETECTION & PERMANENT LEARNING ═══
      const hasDangerImmediate = /⚠️PERICOL/i.test(description);
      const hasDangerWarning = /⚠️ATENȚIE/i.test(description);
      let dangerEventId = null;
      let dangerType = null;
      let dangerLevel = null;
      if ((hasDangerImmediate || hasDangerWarning) && supabaseAdmin) {
        dangerLevel = hasDangerImmediate ? 'immediate' : 'warning';
        dangerType = classifyDangerType(description);
        const envMatch = description.match(/(?:mediu|environ|loc|place|zonă)[:\s]*([^.!\n]+)/i);
        const environment = envMatch ? envMatch[1].trim() : null;

        dangerEventId = await saveDangerEvent(supabaseAdmin, {
          user_id: user?.id || null,
          danger_level: dangerLevel,
          danger_type: dangerType,
          description: description.substring(0, 1000),
          environment,
          action_taken: 'deep_alert_sent',
          metadata: {
            avatar,
            language,
            engine,
            emotion,
            userName: userName || null,
            fingerprint: _fingerprint,
            source: 'deep',
          },
        });
        if (dangerEventId) {
          logger.info({ component: 'Vision', dangerLevel, dangerType, dangerEventId, userId: user?.id }, 'Danger event saved to memory');
        }
      }

      // Save to brain memory so brain remembers what it saw
      // Skip trivial safe descriptions to avoid DB flooding
      const isTrivial = /calea e liber|mediu lini[sș]tit|nimic de semnalat|no danger|path.*clear/i.test(description);
      if (brain && user?.id && !isTrivial) {
        brain
          .saveMemory(user.id, 'visual', 'Am văzut: ' + description.substring(0, 500), {
            avatar,
            language,
            engine,
            emotion,
          })
          .catch((e) => logger.warn({ component: 'Vision', err: e.message }, 'brain.saveMemory failed'));
      }
    }

    logger.info({ component: 'Vision', engine, emotion, userId: user?.id }, 'Vision analysis complete');

    // ── Increment usage after successful vision ──
    incrementUsage(user?.id, 'vision', supabaseAdmin, _fingerprint).catch(() => {});

    const riskProfile = await buildRiskProfile(supabaseAdmin, user?.id || null);

    res.json({
      description: description || 'Could not analyze.',
      avatar,
      engine: engine || 'none',
      emotion,
      userName: userName || null,
      eventId: dangerEventId,
      riskProfile,
    });
  } catch (e) {
    logger.error({ component: 'Vision', err: e.message }, 'Vision error');
    res.status(500).json({ error: 'Vision error' });
  }
});

// ═══ DANGER TYPE CLASSIFIER — categorizes hazards for learning ═══
const DANGER_CATEGORIES = {
  vehicle:      /\b(mașină|mașin[aăi]|vehicul|camion|truck|car|bus|autobuz|motociclet|scuter|scooter|biciclet|bike|trotinet|tren|train|ambulanță|tramvai|taxi)\b/i,
  obstacle:     /\b(obstacol|obstacle|stâlp|pole|gard|fence|barieră|barrier|perete|wall|cutie|box|piatră|stone|copac|tree|ramură|branch|zid|construcție|construction|scaffold|schela)\b/i,
  stairs:       /\b(scări|stairs|trepte|steps|bordură|curb|rampă|ramp|pantă|slope|denivelare|drop|groapă|hole|canal|deschidere|opening)\b/i,
  ground:       /\b(alunecos|slippery|ud|wet|gheață|ice|noroi|mud|nisip|sand|pietriș|gravel|crăpătură|crack|pardoseală|floor|trotuar|sidewalk|asfalt|gazon)\b/i,
  animal:       /\b(câine|dog|pisică|cat|animal|insect|albină|bee|viespe|wasp|șarpe|snake|pasăre|bird)\b/i,
  person:       /\b(persoană|person|copil|child|om|pieton|pedestrian|mulțime|crowd|grup|group)\b/i,
  object_fall:  /\b(cade|falling|suspendat|hanging|instabil|unstable|se prăbușește|collapse|desprins|detached|agățat|leaning)\b/i,
  fire:         /\b(foc|fire|fum|smoke|flacără|flame|incendiu|scânteie|spark|fierbinte|hot|arde|burning)\b/i,
  water:        /\b(apă|water|inundație|flood|baltă|puddle|piscină|pool|râu|river|lac|lake|adânc|deep)\b/i,
  electrical:   /\b(electric|curent|cablu|cable|fir|wire|priză|outlet|scurtcircuit|short.circuit|tensiune|voltage|stâlp electric|power line)\b/i,
  height:       /\b(înălțime|height|balcon|balcony|acoperiș|roof|margine|edge|prăpastie|cliff|mal|schelă|scaffold|etaj|floor|geam|window)\b/i,
  traffic:      /\b(trafic|traffic|intersecție|intersection|semafor|traffic.light|trecere|crossing|zebră|crosswalk|sens|lane|drum|road|stradă|street|autostradă|highway)\b/i,
  low_obstacle: /\b(jos|low|la nivelul|ground.level|cablu|cable|fir|wire|prag|threshold|piatră|stone|root|rădăcină|bordură|curb)\b/i,
  sharp:        /\b(ascuțit|sharp|tăios|sticlă|glass|metal|cuțit|knife|ac|needle|sârmă|wire|ciob|shard)\b/i,
  overhead:     /\b(deasupra|above|overhead|ramură|branch|bârnă|beam|tavan|ceiling|acoperiș|roof|cablu|cable|semn|sign)\b/i,
};

function classifyDangerType(description) {
  if (!description) return 'unknown';
  for (const [type, pattern] of Object.entries(DANGER_CATEGORIES)) {
    if (pattern.test(description)) return type;
  }
  return 'unknown';
}

// ═══ POST /api/vision/danger-feedback — user confirms/dismisses danger (learning) ═══
router.post('/danger-feedback', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many feedback requests.' },
  keyGenerator: rateLimitKey,
}), async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    const { eventId, falseAlarm, userResponse, fingerprint } = req.body;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });

    const user = await getUserFromToken(req);
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const update = {};
    if (typeof falseAlarm === 'boolean') update.false_alarm = falseAlarm;
    if (userResponse) update.user_response = String(userResponse).substring(0, 500);

    let query = supabaseAdmin.from('danger_events').update(update).eq('id', eventId);
    if (user?.id) {
      query = query.eq('user_id', user.id);
    } else if (fingerprint) {
      query = query.contains('metadata', { fingerprint: String(fingerprint) });
    } else {
      return res.status(401).json({ error: 'Feedback requires user or fingerprint' });
    }

    const { error } = await query;

    if (error) throw error;

    logger.info({ component: 'Vision', eventId, falseAlarm, userId: user?.id }, 'Danger feedback saved');
    res.json({ ok: true });
  } catch (e) {
    logger.warn({ component: 'Vision', err: e.message }, 'Danger feedback failed');
    res.status(500).json({ error: 'Feedback save failed' });
  }
});

module.exports = router;
