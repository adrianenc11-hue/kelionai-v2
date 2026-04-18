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

const EXTRACTION_SYSTEM = `You extract durable facts about a user from a conversation transcript.
Return ONLY a valid JSON array. No prose, no code fences.

Each item: { "kind": "<category>", "fact": "<first-person statement about the user, ≤ 140 chars>" }

Allowed kinds (pick the closest): identity, preference, goal, routine, relationship, skill, context.

Rules:
- Extract ONLY facts about the USER, never about Kelion or hypotheticals.
- Durable only. Skip one-off mood notes ("I'm tired today"), small talk, and things the user retracted.
- Be specific. "Adrian is learning Spanish" > "likes languages".
- English, third-person if the user is named (e.g. "Adrian has two cats"); otherwise second-person ("You have two cats").
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

  return parsed
    .filter((x) => x && typeof x.fact === 'string' && x.fact.trim())
    .slice(0, 8)
    .map((x) => ({
      kind: typeof x.kind === 'string' ? x.kind.toLowerCase().slice(0, 40) : 'fact',
      fact: x.fact.trim().slice(0, 500),
    }));
}

module.exports = { extractFacts };
