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
  return `You extract durable facts about a user from a conversation transcript.
Return ONLY a valid JSON array. No prose, no code fences.

Each item: { "kind": "<category>", "fact": "<first-person statement about the user, ≤ 140 chars>" }

Allowed kinds (pick the closest): identity, preference, goal, routine, relationship, skill, context.

${who}

Rules:
- Extract ONLY facts about the USER (the person whose turns are labelled "User"). Never about Kelion. Never about people the user mentions ("my wife", "my brother", "my boss", "a friend", "colleagues", a named third party).
- If the user says "my wife loves skiing" you may keep "the user has a wife" as a relationship fact, but NEVER "the user loves skiing".
- If the user says "my son is 5" keep "the user has a son (age 5)" as relationship, NEVER "the user is 5".
- Durable only. Skip one-off mood notes ("I'm tired today"), small talk, and things the user retracted.
- Skip anything the user stated about ANOTHER named or pronoun-referenced person unless it describes the user's relationship to them.
- Be specific. "${(userName || 'The user')} is learning Spanish" > "likes languages".
- English, third-person if the user is named (e.g. "${userName || 'Alex'} has two cats"); otherwise second-person ("You have two cats").
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
      // If the fact starts with a personal name that isn't the user's.
      const nameMatch = f.match(/^([a-z][a-z\-']+)\s+(is|are|has|have|had|likes|loves|prefers|wants|needs|works|lives|speaks|studies|plays|enjoys|owns|hates|knows|remembers|thinks|believes|feels|said|says|was|were|did|does)\b/);
      if (nameMatch) {
        const first = nameMatch[1];
        // Reserved first words that are clearly not personal names.
        const reservedFirstWord = new Set([
          'the', 'you', 'your', 'user', 'this', 'that', 'they', 'their',
          'my', 'his', 'her', 'its', 'a', 'an', 'we', 'our', 'he', 'she',
        ]);
        if (!reservedFirstWord.has(first) && first !== uname) {
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

  return parsed
    .filter((x) => x && typeof x.fact === 'string' && x.fact.trim())
    // Final guardrail — drop items the model mis-attributed to the
    // user (e.g. "my wife is a vet"). See looksThirdParty() above.
    .filter((x) => !looksThirdParty(x.fact, userName))
    .slice(0, 8)
    .map((x) => ({
      kind: typeof x.kind === 'string' ? x.kind.toLowerCase().slice(0, 40) : 'fact',
      fact: x.fact.trim().slice(0, 500),
    }));
}

module.exports = { extractFacts };
module.exports._internal = { looksThirdParty, buildExtractionSystem };
