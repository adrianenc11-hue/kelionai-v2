'use strict';

// Audit M8 — memory consolidation.
//
// Kelion keeps "durable facts" about each signed-in user in the
// `memory_items` table. Every voice/chat session loads the most
// recent 60 facts into the persona prompt so the assistant can
// remember name/preferences/job across sessions. The store is
// append-only: `addMemoryItems` only de-dupes by EXACT string
// match before insert, and there is no retirement policy. Over
// time three failure modes emerge:
//
//   1. CONTRADICTIONS — the user updates a single-valued fact
//      ("I'm an electrician" → "I'm a programmer") and both end
//      up in the prompt. The model sees two mutually exclusive
//      claims, picks one at random, sometimes wrongly.
//
//   2. UNBOUNDED GROWTH — facts accumulate forever. At ~2 000
//      items a prompt carries ~3 000 extra tokens per turn; at
//      provider list prices that is ~£0.001-0.005 wasted per
//      message plus a few hundred ms of latency.
//
//   3. STALE NOISE — one-off contextual notes ("on Aug 22 the
//      user asked about Mamaia") live forever and bias future
//      replies ("maybe you'd like Mamaia again?").
//
// This module is the pure, deterministic core of the fix. Given
// a flat list of memory items it emits a plan: for each item an
// action plus a human-readable reason. The caller (the DB helper
// in `services/memoryApply.js` or the admin endpoint) is free to
// preview the plan first (dry-run) and apply it once satisfied.
//
// Deliberate choices:
//   * Zero I/O — no DB, no LLM calls. Easy to unit-test.
//   * Zero randomness — same input always yields the same plan.
//   * Conservative — when in doubt, KEEP. Archiving a wrong fact
//     is fully reversible (the row stays in `memory_items`, just
//     with `archived_at` set). Losing a fact silently is not.
//
// Actions:
//   * keep        — leave the row unchanged.
//   * archive     — set archived_at = NOW, excluded from future
//                    prompts. Reversible.
//   * promote     — raise to tier='core' (always included in
//                    prompts up to a cap).
//   * demote      — lower to tier='recent' (eligible for later
//                    archival if stale / contradicted).
//
// Inputs (per item):
//   {
//     id:               number | string,
//     kind:             string,   // e.g. 'identity', 'preference'
//     fact:             string,   // the canonical text
//     tier:             'core'|'recent'|'archive',
//     created_at:       ISO string or ms epoch,
//     last_affirmed_at: ISO string or ms epoch,
//     archived_at:      ISO string or ms epoch or null,
//   }
//
// Output:
//   [{ id, action: 'keep'|'archive'|'promote'|'demote', reason: string }]

// ─────────────────────── tuning constants ───────────────────────

// Kinds where a fact tends to be single-valued per user (only one
// current job, age, home address, preferred language, etc). On a
// conflict we archive the older one and keep the newest.
const SINGLE_VALUED_KINDS = new Set([
  'identity',
  'profile',
  'locale',
  'language',
  'location',
  'home',
  'occupation',
  'job',
  'role',
]);

// One-off contextual notes. Eligible for automatic archival after
// STALE_MS of inactivity. Other kinds (preference / goal / skill)
// are not stale-archived automatically — the user still cares
// that they like pizza ten months later.
const EPHEMERAL_KINDS = new Set([
  'context',
  'note',
  'mood',
]);

// 90 days. A context-note older than this without any re-
// affirmation (no near-identical fact inserted since) is assumed
// stale. Conservative: 30 days would produce too many false
// positives on infrequent users.
const STALE_MS = 90 * 24 * 60 * 60 * 1000;

// Promotion threshold — a fact that has been repeatedly affirmed
// (last_affirmed_at > created_at by this much) becomes 'core',
// always included in the prompt up to a small cap. Typical signal:
// the user mentions their name / address a second time weeks later
// and the extractor re-emits an identical fact → `addMemoryItems`
// bumps `last_affirmed_at` instead of inserting a dup.
const PROMOTE_AFFIRM_MS = 14 * 24 * 60 * 60 * 1000;

// Hard cap on how many items of each tier the plan will keep. Beyond
// these counts the oldest are demoted/archived. Matches the ~60
// item budget already used by the live-session persona.
const MAX_CORE_KEPT    = 20;
const MAX_RECENT_KEPT  = 80;

// ───────────────────────── helpers ─────────────────────────

function toMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Normalise a fact string for similarity comparison: lowercase,
// strip diacritics, collapse whitespace, drop trailing punctuation.
// This is NOT stored — only used to bucket duplicates.
function normalise(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')     // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// True if `a` is a near-duplicate of `b`: identical normalised form,
// or one is a substring of the other and both are reasonably long.
// Deliberately strict — semantic clustering (e.g. "loves pizza" vs
// "pizza is their favourite food") is out of scope for the pure
// layer; that goes through the optional LLM pass in a follow-up PR.
function nearDuplicate(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 8 || b.length < 8) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

// ───────────────────────── main entry ─────────────────────────

function planConsolidation(items, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const out = [];
  if (!Array.isArray(items) || items.length === 0) return out;

  // Only consider rows that are still live (archived_at IS NULL).
  // Already-archived rows are implicitly 'keep' — the pure planner
  // never un-archives on its own; that's a manual admin action.
  const live = items.filter((it) => it && !it.archived_at);
  const byId = new Map(live.map((it) => [it.id, it]));

  // Bucket by normalised fact to detect near-duplicates regardless
  // of kind. Ties resolved by "newest wins, older archived".
  const dupBuckets = new Map();
  for (const it of live) {
    const key = normalise(it.fact);
    if (!key) continue;
    if (!dupBuckets.has(key)) dupBuckets.set(key, []);
    dupBuckets.get(key).push(it);
  }

  const decided = new Set();

  // Pass 1 — exact + near-duplicate collapse.
  for (const peers of dupBuckets.values()) {
    if (peers.length < 2) continue;
    // Newest by created_at wins; ties broken by larger id.
    const sorted = [...peers].sort((a, b) => {
      const da = toMs(a.created_at);
      const db = toMs(b.created_at);
      if (db !== da) return db - da;
      return Number(b.id) - Number(a.id);
    });
    const winner = sorted[0];
    decided.add(winner.id);
    for (let i = 1; i < sorted.length; i++) {
      out.push({
        id: sorted[i].id,
        action: 'archive',
        reason: `duplicate of #${winner.id} — identical normalised form`,
      });
      decided.add(sorted[i].id);
    }
  }

  // Pass 2 — substring near-duplicates ACROSS buckets. Catches
  // "Adrian likes pizza" vs "Adrian likes pizza a lot" which fall
  // in different exact buckets but one strictly subsumes the other.
  for (const a of live) {
    if (decided.has(a.id)) continue;
    const normA = normalise(a.fact);
    if (!normA) continue;
    for (const b of live) {
      if (b.id === a.id) continue;
      if (decided.has(b.id)) continue;
      const normB = normalise(b.fact);
      if (!nearDuplicate(normA, normB)) continue;
      if (normA === normB) continue; // already handled in Pass 1
      // Keep the longer / more specific string.
      const keep = normA.length >= normB.length ? a : b;
      const drop = keep === a ? b : a;
      out.push({
        id: drop.id,
        action: 'archive',
        reason: `subsumed by #${keep.id} — longer form captures same claim`,
      });
      decided.add(drop.id);
      decided.add(keep.id);
    }
  }

  // Pass 3 — contradictions on single-valued kinds. Within a kind
  // bucket keep only the newest; archive the rest with a clear
  // reason. NOTE: if the user happens to have multiple identities
  // (rare: "dual national") the rule still fires — they can
  // manually restore the archived row from the admin panel.
  const kindBuckets = new Map();
  for (const it of live) {
    if (decided.has(it.id)) continue;
    const kind = String(it.kind || '').toLowerCase();
    if (!SINGLE_VALUED_KINDS.has(kind)) continue;
    if (!kindBuckets.has(kind)) kindBuckets.set(kind, []);
    kindBuckets.get(kind).push(it);
  }
  for (const [kind, peers] of kindBuckets) {
    if (peers.length < 2) continue;
    const sorted = [...peers].sort((a, b) => toMs(b.created_at) - toMs(a.created_at));
    const winner = sorted[0];
    decided.add(winner.id);
    for (let i = 1; i < sorted.length; i++) {
      out.push({
        id: sorted[i].id,
        action: 'archive',
        reason: `contradicts newer '${kind}' fact #${winner.id}`,
      });
      decided.add(sorted[i].id);
    }
  }

  // Pass 4 — staleness. Ephemeral kinds that have not been re-
  // affirmed in STALE_MS become archive candidates. Core-tier items
  // are immune (they represent durable identity we want to keep).
  for (const it of live) {
    if (decided.has(it.id)) continue;
    if (it.tier === 'core') continue;
    const kind = String(it.kind || '').toLowerCase();
    if (!EPHEMERAL_KINDS.has(kind)) continue;
    const last = toMs(it.last_affirmed_at) || toMs(it.created_at);
    if (last && now - last > STALE_MS) {
      out.push({
        id: it.id,
        action: 'archive',
        reason: `stale '${kind}' fact — last affirmed > 90d ago`,
      });
      decided.add(it.id);
    }
  }

  // Pass 5 — promotion. A 'recent' fact that has been re-affirmed
  // (last_affirmed_at pulled forward by PROMOTE_AFFIRM_MS relative
  // to created_at) gets promoted to 'core'. Tightened to single-
  // valued kinds so we don't fill 'core' with preferences.
  for (const it of live) {
    if (decided.has(it.id)) continue;
    if (it.tier !== 'recent') continue;
    const kind = String(it.kind || '').toLowerCase();
    if (!SINGLE_VALUED_KINDS.has(kind)) continue;
    const created = toMs(it.created_at);
    const affirm = toMs(it.last_affirmed_at);
    if (created && affirm && affirm - created >= PROMOTE_AFFIRM_MS) {
      out.push({
        id: it.id,
        action: 'promote',
        reason: `re-affirmed over ${Math.round((affirm - created) / 86_400_000)}d — durable identity`,
      });
      decided.add(it.id);
    }
  }

  // Pass 6 — cap core + recent tiers. Demote / archive the oldest
  // beyond the per-tier budget so prompt size stays predictable.
  const liveFinal = live.map((it) => {
    const override = out.find((p) => p.id === it.id);
    if (!override) return { ...it, _tier: it.tier };
    if (override.action === 'archive') return { ...it, _tier: 'archive' };
    if (override.action === 'promote') return { ...it, _tier: 'core' };
    if (override.action === 'demote')  return { ...it, _tier: 'recent' };
    return { ...it, _tier: it.tier };
  });

  const coreItems = liveFinal
    .filter((it) => it._tier === 'core')
    .sort((a, b) => toMs(b.last_affirmed_at) - toMs(a.last_affirmed_at));
  if (coreItems.length > MAX_CORE_KEPT) {
    for (const extra of coreItems.slice(MAX_CORE_KEPT)) {
      if (decided.has(extra.id)) continue;
      out.push({
        id: extra.id,
        action: 'demote',
        reason: `core tier over budget (${coreItems.length}/${MAX_CORE_KEPT})`,
      });
      decided.add(extra.id);
    }
  }

  const recentItems = liveFinal
    .filter((it) => it._tier === 'recent')
    .sort((a, b) => toMs(b.last_affirmed_at) - toMs(a.last_affirmed_at));
  if (recentItems.length > MAX_RECENT_KEPT) {
    for (const extra of recentItems.slice(MAX_RECENT_KEPT)) {
      if (decided.has(extra.id)) continue;
      out.push({
        id: extra.id,
        action: 'archive',
        reason: `recent tier over budget (${recentItems.length}/${MAX_RECENT_KEPT})`,
      });
      decided.add(extra.id);
    }
  }

  // Sanity — `byId` is only used to make `id` lookups readable if a
  // future pass wants to emit context; referenced here to silence
  // lint on unused var if the passes are reshuffled.
  void byId;

  return out;
}

module.exports = {
  planConsolidation,
  // Exposed for tests / cross-module sanity.
  SINGLE_VALUED_KINDS,
  EPHEMERAL_KINDS,
  STALE_MS,
  PROMOTE_AFFIRM_MS,
  MAX_CORE_KEPT,
  MAX_RECENT_KEPT,
  normalise,
  nearDuplicate,
};
