'use strict';

// Audit M8 — memory consolidation.
//
// This suite covers the PURE planner in services/memoryConsolidator.js
// (no DB, no LLM). Behavioural guarantees we lock down here:
//
//   * idempotent — re-running the plan over already-archived rows
//     emits nothing for those rows.
//   * contradiction-safe — when two single-valued facts clash
//     (old job + new job) the older one is always archived.
//   * dedup-safe — exact and substring duplicates collapse to the
//     newest/longer variant without touching their peers.
//   * stale-aware — only ephemeral kinds (context/note/mood) are
//     candidates for expiry; everything else is preserved unless a
//     more recent fact overrides it.
//   * promotion-gated — only single-valued kinds reach 'core' tier
//     so preferences don't flood the budget.
//   * budget-enforced — both core and recent tiers have hard caps
//     beyond which the oldest are demoted/archived.
//
// End-to-end apply-plan behaviour (archiveMemoryItem writes in the
// right rows, restore/setMemoryItemTier work against the DB adapter)
// is covered separately in memory-consolidate-endpoint.test.js.

const {
  planConsolidation,
  normalise,
  nearDuplicate,
  SINGLE_VALUED_KINDS,
  EPHEMERAL_KINDS,
  STALE_MS,
  PROMOTE_AFFIRM_MS,
  MAX_CORE_KEPT,
  MAX_RECENT_KEPT,
} = require('../src/services/memoryConsolidator');

const DAY = 24 * 60 * 60 * 1000;
const FIXED_NOW = Date.parse('2026-04-20T12:00:00Z');

function mkItem(overrides = {}) {
  return {
    id: 1,
    user_id: 7,
    kind: 'fact',
    fact: 'Default fact',
    tier: 'recent',
    created_at: new Date(FIXED_NOW - 10 * DAY).toISOString(),
    last_affirmed_at: new Date(FIXED_NOW - 10 * DAY).toISOString(),
    archived_at: null,
    ...overrides,
  };
}

function byId(plan, id) {
  return plan.find((p) => p.id === id) || null;
}

// ────────────────────────── pure helpers ──────────────────────────

describe('normalise', () => {
  test('collapses whitespace, punctuation and diacritics', () => {
    expect(normalise('  Adrián,  likes   PIZZA!  ')).toBe('adrian likes pizza');
  });
  test('handles null / undefined safely', () => {
    expect(normalise(null)).toBe('');
    expect(normalise(undefined)).toBe('');
    expect(normalise('')).toBe('');
  });
  test('preserves digits and hyphens', () => {
    expect(normalise('Lives in B-1000, zone 42')).toBe('lives in b-1000 zone 42');
  });
});

describe('nearDuplicate', () => {
  test('exact match returns true', () => {
    expect(nearDuplicate('hello world', 'hello world')).toBe(true);
  });
  test('substring match returns true when both are long enough', () => {
    expect(nearDuplicate('adrian likes pizza', 'adrian likes pizza a lot')).toBe(true);
  });
  test('short strings are never near-duplicates (too noisy)', () => {
    expect(nearDuplicate('hi', 'hi there')).toBe(false);
  });
  test('unrelated strings return false', () => {
    expect(nearDuplicate('adrian likes pizza', 'lives in london')).toBe(false);
  });
  test('empty strings never match', () => {
    expect(nearDuplicate('', '')).toBe(false);
    expect(nearDuplicate('abc', '')).toBe(false);
  });
});

// ────────────────────────── empty / trivial ───────────────────────

describe('planConsolidation — trivial inputs', () => {
  test('returns [] for non-array input', () => {
    expect(planConsolidation(null)).toEqual([]);
    expect(planConsolidation(undefined)).toEqual([]);
    expect(planConsolidation('nope')).toEqual([]);
  });
  test('returns [] for empty array', () => {
    expect(planConsolidation([])).toEqual([]);
  });
  test('single live item → no action', () => {
    const plan = planConsolidation([mkItem({ id: 1, fact: 'User is called Adrian', kind: 'identity' })]);
    expect(plan).toEqual([]);
  });
  test('all already-archived items → no action', () => {
    const archived = [
      mkItem({ id: 1, fact: 'A', archived_at: new Date(FIXED_NOW - 30 * DAY).toISOString() }),
      mkItem({ id: 2, fact: 'B', archived_at: new Date(FIXED_NOW - 30 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(archived, { now: FIXED_NOW });
    expect(plan).toEqual([]);
  });
});

// ────────────────────────── dedup ─────────────────────────────────

describe('planConsolidation — exact duplicates', () => {
  test('two identical facts → older archived, newer kept', () => {
    const items = [
      mkItem({
        id: 1,
        fact: 'Prefers tea over coffee',
        kind: 'preference',
        created_at: new Date(FIXED_NOW - 40 * DAY).toISOString(),
      }),
      mkItem({
        id: 2,
        fact: 'Prefers tea over coffee',
        kind: 'preference',
        created_at: new Date(FIXED_NOW - 5 * DAY).toISOString(),
      }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(plan).toHaveLength(1);
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 1).reason).toMatch(/duplicate of #2/);
    expect(byId(plan, 2)).toBe(null);
  });

  test('case/punctuation variants treated as same fact', () => {
    const items = [
      mkItem({ id: 1, fact: 'Prefers TEA.',      created_at: new Date(FIXED_NOW - 40 * DAY).toISOString() }),
      mkItem({ id: 2, fact: 'prefers tea',       created_at: new Date(FIXED_NOW - 10 * DAY).toISOString() }),
      mkItem({ id: 3, fact: '   Prefers tea!  ', created_at: new Date(FIXED_NOW -  5 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(plan.filter((p) => p.action === 'archive')).toHaveLength(2);
    expect(byId(plan, 3)).toBe(null);        // newest kept
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 2).action).toBe('archive');
  });

  test('substring variant → shorter archived, longer kept', () => {
    const items = [
      mkItem({ id: 1, fact: 'Adrian likes pizza',
        created_at: new Date(FIXED_NOW - 40 * DAY).toISOString() }),
      mkItem({ id: 2, fact: 'Adrian likes pizza a whole lot',
        created_at: new Date(FIXED_NOW - 10 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 1).reason).toMatch(/subsumed by #2/);
    expect(byId(plan, 2)).toBe(null);
  });

  test('tie-break on created_at falls back to higher id', () => {
    const sameTs = new Date(FIXED_NOW - 10 * DAY).toISOString();
    const items = [
      mkItem({ id: 1, fact: 'Same fact', created_at: sameTs }),
      mkItem({ id: 5, fact: 'Same fact', created_at: sameTs }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 5)).toBe(null);
  });

  test('three-way duplicate collapses to newest only', () => {
    const items = [
      mkItem({ id: 1, fact: 'Has a dog named Rex',
        created_at: new Date(FIXED_NOW - 60 * DAY).toISOString() }),
      mkItem({ id: 2, fact: 'Has a dog named Rex',
        created_at: new Date(FIXED_NOW - 30 * DAY).toISOString() }),
      mkItem({ id: 3, fact: 'Has a dog named Rex',
        created_at: new Date(FIXED_NOW -  5 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(plan.filter((p) => p.action === 'archive').map((p) => p.id).sort())
      .toEqual([1, 2]);
  });
});

// ────────────────────────── contradictions ────────────────────────

describe('planConsolidation — single-valued contradictions', () => {
  test('two identity facts → older archived, newer kept', () => {
    const items = [
      mkItem({ id: 1, kind: 'occupation', fact: 'Works as an electrician',
        created_at: new Date(FIXED_NOW - 120 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'occupation', fact: 'Works as a programmer',
        created_at: new Date(FIXED_NOW -   5 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 1).reason).toMatch(/contradicts newer 'occupation' fact #2/);
    expect(byId(plan, 2)).toBe(null);
  });

  test('three role facts → only newest wins, two archived', () => {
    const items = [
      mkItem({ id: 1, kind: 'role', fact: 'electrician',
        created_at: new Date(FIXED_NOW - 200 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'role', fact: 'IT support',
        created_at: new Date(FIXED_NOW - 100 * DAY).toISOString() }),
      mkItem({ id: 3, kind: 'role', fact: 'programmer',
        created_at: new Date(FIXED_NOW -   1 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(plan.filter((p) => p.action === 'archive').map((p) => p.id).sort())
      .toEqual([1, 2]);
  });

  test('multi-valued kinds (preference) never trigger contradictions', () => {
    const items = [
      mkItem({ id: 1, kind: 'preference', fact: 'Likes pizza',
        created_at: new Date(FIXED_NOW - 60 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'preference', fact: 'Likes sushi',
        created_at: new Date(FIXED_NOW - 30 * DAY).toISOString() }),
      mkItem({ id: 3, kind: 'preference', fact: 'Likes ramen',
        created_at: new Date(FIXED_NOW -  5 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(plan).toEqual([]);
  });

  test('case-insensitive kind matches SINGLE_VALUED_KINDS set', () => {
    const items = [
      mkItem({ id: 1, kind: 'Occupation', fact: 'a',
        created_at: new Date(FIXED_NOW - 40 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'OCCUPATION', fact: 'b',
        created_at: new Date(FIXED_NOW -  1 * DAY).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('archive');
  });

  test('SINGLE_VALUED_KINDS set is non-empty and includes the obvious kinds', () => {
    expect(SINGLE_VALUED_KINDS.size).toBeGreaterThan(0);
    ['identity', 'locale', 'language', 'location', 'occupation', 'job', 'role']
      .forEach((k) => expect(SINGLE_VALUED_KINDS.has(k)).toBe(true));
  });
});

// ────────────────────────── staleness ─────────────────────────────

describe('planConsolidation — staleness', () => {
  test('ephemeral kind older than STALE_MS → archive', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'context',
        fact: 'Asked about Mamaia in August',
        created_at: new Date(FIXED_NOW - (STALE_MS + 5 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - (STALE_MS + 5 * DAY)).toISOString(),
      }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 1).reason).toMatch(/stale 'context' fact/);
  });

  test('ephemeral kind younger than STALE_MS → kept', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'context',
        fact: 'Mentioned a new project last week',
        created_at: new Date(FIXED_NOW - 30 * DAY).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 30 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('re-affirming a stale context fact keeps it alive', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'context',
        fact: 'x',
        created_at: new Date(FIXED_NOW - (STALE_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 10 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('core tier is immune to staleness', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'context',
        tier: 'core',
        fact: 'Durable note',
        created_at: new Date(FIXED_NOW - 365 * DAY).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 365 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('non-ephemeral kinds are never stale-archived', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'preference',
        fact: 'Likes pizza',
        created_at: new Date(FIXED_NOW - 400 * DAY).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 400 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('EPHEMERAL_KINDS set is non-empty and includes the obvious kinds', () => {
    expect(EPHEMERAL_KINDS.size).toBeGreaterThan(0);
    ['context', 'note', 'mood'].forEach((k) => expect(EPHEMERAL_KINDS.has(k)).toBe(true));
  });
});

// ────────────────────────── promotion ─────────────────────────────

describe('planConsolidation — promotion', () => {
  test('single-valued fact re-affirmed past threshold → promoted', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'identity',
        fact: 'Name is Adrian',
        tier: 'recent',
        created_at: new Date(FIXED_NOW - (PROMOTE_AFFIRM_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 2 * DAY).toISOString(),
      }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    expect(byId(plan, 1).action).toBe('promote');
    expect(byId(plan, 1).reason).toMatch(/re-affirmed over \d+d/);
  });

  test('barely re-affirmed → no promotion', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'identity',
        fact: 'Name is Adrian',
        tier: 'recent',
        created_at: new Date(FIXED_NOW - 3 * DAY).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 1 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('preference kind is never promoted even if re-affirmed', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'preference',
        fact: 'Likes pizza',
        tier: 'recent',
        created_at: new Date(FIXED_NOW - (PROMOTE_AFFIRM_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 1 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });

  test('already-core fact is not re-promoted', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'identity',
        fact: 'Name is Adrian',
        tier: 'core',
        created_at: new Date(FIXED_NOW - (PROMOTE_AFFIRM_MS + 30 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - 1 * DAY).toISOString(),
      }),
    ];
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });
});

// ────────────────────────── tier budgets ──────────────────────────

describe('planConsolidation — tier budgets', () => {
  // Generate fact strings that are NOT substrings of each other so
  // the dedup/subsumption passes stay out of the way — e.g.
  // "alpha-001", "beta-002" don't share prefixes.
  const LABELS = [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
    'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho',
    'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega', 'aster',
    'bravo', 'charlie', 'dasher', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'mike', 'november', 'oscar', 'papa',
    'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whisky',
    'xray', 'yankee', 'zulu', 'amber', 'cobalt', 'ember', 'frost', 'garnet',
    'harbor', 'ivory', 'jade', 'koi', 'lumen', 'marble', 'nectar', 'opal',
    'pearl', 'quartz', 'ruby', 'slate', 'topaz', 'ultra', 'violet', 'wren',
    'xenon', 'yarrow', 'zinnia', 'almond', 'birch', 'cedar', 'dogwood',
    'elm', 'fir', 'gumbo', 'holly', 'ivy', 'junip', 'kumo', 'larch',
    'magnolia',
  ];
  // Each label is unique and not a substring of any other in the list.
  function uniqueFact(i) {
    const label = LABELS[i % LABELS.length];
    const ord = Math.floor(i / LABELS.length);
    // Add zero-padded suffix so fact length stays comparable across
    // items but strings never prefix one another.
    return `seed-${label}-${String(ord).padStart(3, '0')}`;
  }

  test('core tier over budget → oldest-by-affirm demoted', () => {
    const items = [];
    for (let i = 1; i <= MAX_CORE_KEPT + 3; i++) {
      items.push(mkItem({
        id: i,
        kind: 'preference',       // skip promotion pass
        tier: 'core',
        fact: uniqueFact(i),
        last_affirmed_at: new Date(FIXED_NOW - i * DAY).toISOString(),
        created_at: new Date(FIXED_NOW - i * DAY).toISOString(),
      }));
    }
    const plan = planConsolidation(items, { now: FIXED_NOW });
    const demoted = plan.filter((p) => p.action === 'demote');
    expect(demoted).toHaveLength(3);
    // The three with the oldest last_affirmed_at should be demoted.
    expect(demoted.map((p) => p.id).sort((a, b) => a - b))
      .toEqual([MAX_CORE_KEPT + 1, MAX_CORE_KEPT + 2, MAX_CORE_KEPT + 3]);
  });

  test('recent tier over budget → oldest archived', () => {
    const items = [];
    for (let i = 1; i <= MAX_RECENT_KEPT + 5; i++) {
      items.push(mkItem({
        id: i,
        kind: 'preference',
        tier: 'recent',
        fact: uniqueFact(i),
        last_affirmed_at: new Date(FIXED_NOW - i * DAY).toISOString(),
        created_at: new Date(FIXED_NOW - i * DAY).toISOString(),
      }));
    }
    const plan = planConsolidation(items, { now: FIXED_NOW });
    const archived = plan.filter((p) => p.action === 'archive');
    expect(archived).toHaveLength(5);
    expect(archived.every((a) => /recent tier over budget/.test(a.reason))).toBe(true);
  });

  test('at exactly the budget size no demotion/archival fires', () => {
    const items = [];
    for (let i = 1; i <= MAX_CORE_KEPT; i++) {
      items.push(mkItem({
        id: i,
        kind: 'preference',
        tier: 'core',
        fact: uniqueFact(i),
      }));
    }
    expect(planConsolidation(items, { now: FIXED_NOW })).toEqual([]);
  });
});

// ────────────────────────── idempotence ───────────────────────────

describe('planConsolidation — idempotence', () => {
  test('applying the plan and re-running produces no new actions', () => {
    const items = [
      mkItem({ id: 1, kind: 'occupation', fact: 'Works as electrician',
        created_at: new Date(FIXED_NOW - 120 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'occupation', fact: 'Works as programmer',
        created_at: new Date(FIXED_NOW -   5 * DAY).toISOString() }),
      mkItem({ id: 3, kind: 'preference', fact: 'Prefers tea',
        created_at: new Date(FIXED_NOW -  40 * DAY).toISOString() }),
      mkItem({ id: 4, kind: 'preference', fact: 'Prefers tea',
        created_at: new Date(FIXED_NOW -  10 * DAY).toISOString() }),
    ];
    const plan1 = planConsolidation(items, { now: FIXED_NOW });
    // Apply the plan to the input set.
    const applied = items.map((it) => {
      const step = plan1.find((p) => p.id === it.id);
      if (!step) return it;
      if (step.action === 'archive')  return { ...it, archived_at: new Date(FIXED_NOW).toISOString() };
      if (step.action === 'promote')  return { ...it, tier: 'core' };
      if (step.action === 'demote')   return { ...it, tier: 'recent' };
      return it;
    });
    const plan2 = planConsolidation(applied, { now: FIXED_NOW });
    expect(plan2).toEqual([]);
  });

  test('re-run on untouched input produces the same plan', () => {
    const items = [
      mkItem({ id: 1, kind: 'identity', fact: 'A',
        created_at: new Date(FIXED_NOW - 40 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'identity', fact: 'B',
        created_at: new Date(FIXED_NOW -  5 * DAY).toISOString() }),
    ];
    const a = planConsolidation(items, { now: FIXED_NOW });
    const b = planConsolidation(items, { now: FIXED_NOW });
    expect(a).toEqual(b);
  });
});

// ────────────────────────── combined scenarios ────────────────────

describe('planConsolidation — combined scenarios', () => {
  test('contradiction + dedup + stale together produce one action per id', () => {
    const items = [
      // dedup pair
      mkItem({ id: 1, kind: 'preference', fact: 'Prefers tea',
        created_at: new Date(FIXED_NOW - 40 * DAY).toISOString() }),
      mkItem({ id: 2, kind: 'preference', fact: 'Prefers tea',
        created_at: new Date(FIXED_NOW -  5 * DAY).toISOString() }),
      // contradiction pair
      mkItem({ id: 3, kind: 'occupation', fact: 'electrician',
        created_at: new Date(FIXED_NOW - 120 * DAY).toISOString() }),
      mkItem({ id: 4, kind: 'occupation', fact: 'programmer',
        created_at: new Date(FIXED_NOW -   2 * DAY).toISOString() }),
      // stale context
      mkItem({ id: 5, kind: 'context', fact: 'Asked about Mamaia',
        created_at: new Date(FIXED_NOW - (STALE_MS + 10 * DAY)).toISOString(),
        last_affirmed_at: new Date(FIXED_NOW - (STALE_MS + 10 * DAY)).toISOString() }),
    ];
    const plan = planConsolidation(items, { now: FIXED_NOW });
    const ids = plan.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates in plan
    expect(byId(plan, 1).action).toBe('archive');
    expect(byId(plan, 3).action).toBe('archive');
    expect(byId(plan, 5).action).toBe('archive');
    expect(byId(plan, 2)).toBe(null);
    expect(byId(plan, 4)).toBe(null);
  });

  test('deterministic output — same input always yields same plan', () => {
    const items = [
      mkItem({ id: 10, kind: 'occupation', fact: 'A',
        created_at: new Date(FIXED_NOW - 100 * DAY).toISOString() }),
      mkItem({ id: 11, kind: 'occupation', fact: 'B',
        created_at: new Date(FIXED_NOW -  10 * DAY).toISOString() }),
      mkItem({ id: 12, kind: 'preference', fact: 'Tea',
        created_at: new Date(FIXED_NOW -  30 * DAY).toISOString() }),
    ];
    const runs = Array.from({ length: 5 }, () =>
      JSON.stringify(planConsolidation(items, { now: FIXED_NOW }))
    );
    expect(new Set(runs).size).toBe(1);
  });

  test('now defaults to Date.now() when not provided', () => {
    const items = [
      mkItem({
        id: 1,
        kind: 'context',
        fact: 'Asked about something long ago',
        created_at: new Date(Date.now() - (STALE_MS + 20 * DAY)).toISOString(),
        last_affirmed_at: new Date(Date.now() - (STALE_MS + 20 * DAY)).toISOString(),
      }),
    ];
    const plan = planConsolidation(items);
    expect(byId(plan, 1)?.action).toBe('archive');
  });
});
