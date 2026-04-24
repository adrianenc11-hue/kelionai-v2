'use strict';

// Stage 3 — M15: Fact extraction.
//
// Given a list of conversation turns (role + text), distills durable
// facts about the user via a Gemini Flash call. Durable = "worth
// remembering next week", not "Kelion said hi".
//
// Returns an array of { kind, fact } objects, bounded to a small size.
// Fails closed (returns []) if Gemini is unavailable or returns junk.
//
// User-identity rules (Apr-2026): the signed-in user's name and id are
// threaded through as part of the system prompt so the extractor can
// tell "my wife loves skiing" (a fact about someone ELSE, skip) apart
// from "I love skiing" (a fact about THE USER, keep). Previously the
// extractor greedily kept anything the transcript mentioned, which is
// how facts about other people ended up labelled as user facts and how
// two different users could start to blur together in memory. We also
// strip every extracted fact through `looksThirdParty()` as a final
// guardrail for when the model ignores the system prompt.

const config = require('../config');

function buildExtractionSystem(userName) {
  const who = userName && String(userName).trim()
    ? `The user's real name is "${String(userName).trim().slice(0, 60)}". Every "I", "me", "my" in their turns refers to THEM.`
    : 'The user is anonymous. Every "I", "me", "my" in their turns refers to THEM.';
  return `You extract durable facts from a conversation transcript.
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

${who}

confidence guidance:
- 1.0 — user stated it about themselves in plain unambiguous terms ("I live in Cluj").
- 0.8 — inferred from context ("bought my third bike — I ride a lot").
- 0.5 — mentioned in passing or ambiguous ("might move to Madrid one day").
- < 0.5 — do NOT emit; it's not durable.

Rules:
- Never extract facts about Kelion itself. Users talking about Kelion are not durable user facts.
- When the user says something about someone ELSE ("my wife loves skiing"), emit it as subject:"other" with subject_name set — NEVER attribute it to the user. You may additionally emit the relationship as subject:"self" ("has a wife").
- Durable only. Skip one-off mood notes ("I'm tired today"), small talk, and retracted statements.
- Be specific. "${(userName || 'The user')} is learning Spanish" > "likes languages".
- Fact text is SHORT (≤ 140 chars), third-person when a name is known (e.g. "${userName || 'Adrian'} has two cats"), otherwise neutral/second-person ("has two cats" / "You have two cats").
- subject_name is REQUIRED for subject:"other" and MUST be the actual name the user used (not "the sister", not "a friend") — skip the item if you don't know the name.
- Max 8 items. Return [] if nothing durable.`;
}

// Quick guardrail: if a fact LOOKS like it was mis-attributed — it
// starts with another person's relation ("my wife", "his", "her",
// "their") or names a third party the system instruction named as
// someone else — drop it. The model obeys the system prompt ~95% of
// the time; this catches the other 5%.
function looksThirdParty(fact, userName) {
  const f = String(fact || '').toLowerCase().trim();
  if (!f) return true;
  // "my wife is a doctor" / "his brother works at X" / "her favourite
  // book is…" / "their son is five".
  if (/^(my|his|her|their)\s+(wife|husband|partner|boyfriend|girlfriend|spouse|mother|mom|mum|father|dad|son|daughter|brother|sister|friend|colleague|coworker|boss|teacher|neighbou?r|cousin|uncle|aunt|grandparent|grandmother|grandfather|kid|kids|children|child|pet|dog|cat|family member)\b/.test(f)) {
    return true;
  }
  // Pure third-person statements that never mention the user. "John is
  // a dentist" — clearly not about the user; we can't be 100% sure so
  // allow if the user's name is present, reject otherwise.
  if (/^(he|she|they)\s+(is|are|was|were|has|have|had|likes|prefers|wants|works|lives)/.test(f)) {
    return true;
  }
  // If the fact names someone who is NOT the user, reject.
  if (userName && typeof userName === 'string') {
    const uname = userName.trim().toLowerCase();
    if (uname) {
      // Split multi-word names ("Adrian Enciulescu") so first-name
      // abbreviations ("Adrian is learning Spanish") still count as
      // the user. Without this, any user with more than one word in
      // their display name loses every self-fact the LLM correctly
      // generated with just their first name.
      const unameParts = new Set(
        uname.split(/\s+/).filter((p) => p && p.length > 0)
      );
      // If the fact starts with a personal name that isn't the user's.
      const nameMatch = f.match(/^([a-z][a-z\-']+)\s+(is|are|has|have|had|likes|loves|prefers|wants|needs|works|lives|speaks|studies|plays|enjoys|owns|hates|knows|remembers|thinks|believes|feels|said|says|was|were|did|does)\b/);
      if (nameMatch) {
        const first = nameMatch[1];
        // Reserved first words that are clearly not personal names.
        const reservedFirstWord = new Set([
          'the', 'you', 'your', 'user', 'this', 'that', 'they', 'their',
          'my', 'his', 'her', 'its', 'a', 'an', 'we', 'our', 'he', 'she',
        ]);
        if (!reservedFirstWord.has(first) && first !== uname && !unameParts.has(first)) {
          return true;
        }
      }
    }
  }
  return false;
}

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

  const userName = typeof options.userName === 'string' ? options.userName : '';
  const extractionSystem = buildExtractionSystem(userName);

  const model = options.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: extractionSystem }] },
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
    // Final guardrail — drop items the model TRIED to attach to the
    // user but that look like third-party references (e.g. "my wife
    // is a vet" tagged subject:"self"). Items correctly tagged as
    // subject:"other" are legitimate and kept. See looksThirdParty().
    .filter((x) => {
      const subj = typeof x.subject === 'string' ? x.subject.trim().toLowerCase() : 'self';
      if (subj === 'other') return true;
      return !looksThirdParty(x.fact, userName);
    })
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
module.exports._internal = { looksThirdParty, buildExtractionSystem };
