'use strict';

// Stage 3 — M15: Fact extraction.
//
// Given a list of conversation turns (role + text), distills durable
// facts about the user via a Gemini Flash call. Durable = "worth
// remembering next week", not "Kelion said hi".
//
// Returns an array of { kind, fact } objects, bounded to a small size.
// Fails closed (returns []) if Gemini is unavailable or returns junk.

const config = require('../config');

const EXTRACTION_SYSTEM = `You extract durable facts from a conversation transcript.
Return ONLY a valid JSON array. No prose, no code fences.

Each item is one of TWO shapes:

1. Fact about the USER (the person talking to Kelion):
   { "kind": "<category>", "fact": "<short statement>", "subject": "self", "confidence": 0.0-1.0 }

2. Fact about someone ELSE the user mentioned (family, friend, colleague, pet, boss, …):
   { "kind": "<category>", "fact": "<short statement>", "subject": "other", "subject_name": "<the other person's name>", "confidence": 0.0-1.0 }

CRITICAL — do not mix subjects. If the user says "I'm a vet and my sister Ioana is a dancer":
  ✔ emit TWO items:
      { "kind":"identity","fact":"works as a veterinarian","subject":"self","confidence":0.9 }
      { "kind":"identity","fact":"works as a dancer","subject":"other","subject_name":"Ioana","confidence":0.85 }
  ✘ NEVER emit "works as a dancer" as a self-fact.

Allowed kinds (pick the closest): identity, preference, goal, routine, relationship, skill, context.

confidence guidance:
- 1.0 — user stated it about themselves in plain unambiguous terms ("I live in Cluj").
- 0.8 — inferred from context ("bought my third bike — I ride a lot").
- 0.5 — mentioned in passing or ambiguous ("might move to Madrid one day").
- < 0.5 — do NOT emit; it's not durable.

Rules:
- Durable only. Skip one-off mood notes ("I'm tired today"), small talk, retracted statements.
- Be specific. "Adrian is learning Spanish" > "likes languages".
- Fact text is SHORT (≤ 140 chars), third-person when a name is known, otherwise neutral ("lives in Cluj").
- subject_name is REQUIRED for "other" and MUST be the actual name the user used (not "the sister", not "a friend") — skip the item if you don't know the name.
- Max 8 items. Return [] if nothing durable.`;

async function extractFacts(turns, options = {}) {
  if (!config.gemini.apiKey) return [];
  if (!Array.isArray(turns) || turns.length === 0) return [];

  // Compact transcript (trim to ~6k chars to stay cheap)
  const transcript = turns
    .filter((t) => t && t.role && t.text)
    .map((t) => `${t.role === 'user' ? 'User' : 'Kelion'}: ${String(t.text).slice(0, 600)}`)
    .join('\n')
    .slice(-6000);

  if (!transcript) return [];

  const model = options.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: `Transcript:\n${transcript}` }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      maxOutputTokens: 600,
    },
  };

  let raw;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn('[factExtractor] Gemini HTTP', r.status);
      return [];
    }
    raw = await r.json();
  } catch (err) {
    console.warn('[factExtractor] fetch failed', err.message);
    return [];
  }

  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  // Audit M9 — propagate subject tagging. `_normalizeSubject` in db/index.js
  // defensively re-clamps these on write, so a malformed "subject":"ioana"
  // from the model cannot corrupt the self-profile — but we do a first pass
  // here so downstream logging / inspection sees clean values.
  return parsed
    .filter((x) => x && typeof x.fact === 'string' && x.fact.trim())
    .slice(0, 8)
    .map((x) => {
      const rawSubject = typeof x.subject === 'string' ? x.subject.trim().toLowerCase() : 'self';
      const subject = rawSubject === 'other' ? 'other' : 'self';
      const subject_name = (subject === 'other' && typeof x.subject_name === 'string')
        ? x.subject_name.trim().slice(0, 120) || null
        : null;
      let confidence = Number(x.confidence);
      if (!Number.isFinite(confidence)) confidence = 1.0;
      confidence = Math.max(0, Math.min(1, confidence));
      return {
        kind: typeof x.kind === 'string' ? x.kind.toLowerCase().slice(0, 40) : 'fact',
        fact: x.fact.trim().slice(0, 500),
        subject,
        subject_name,
        confidence,
      };
    })
    // Drop "other" rows with no usable name — the persona can't surface
    // "someone said dancer" meaningfully, and we don't want these landing
    // on the signed-in user's profile either.
    .filter((x) => x.subject !== 'other' || x.subject_name);
}

module.exports = { extractFacts };
