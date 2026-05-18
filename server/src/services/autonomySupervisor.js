'use strict';

const { runEnvAudit } = require('./envAudit');

const CAPABILITY_NAMES = {
  models: ['OpenRouter API Key', 'Google AI Studio Keys'],
  git: ['GitHub Token', 'Master Branch Protection'],
  shell: ['AGENT_ENABLED', 'AGENT_SHELL_CWD'],
  persistence: ['DATABASE_URL (Postgres)', 'Secrets'],
  research: ['Google Search (Agent)'],
};

const ACTIONS = {
  'OpenRouter API Key': 'Set OPENROUTER_API_KEY.',
  'Google AI Studio Keys': 'Set GOOGLE_API_KEY or GOOGLE_API_KEYS.',
  'GitHub Token': 'Set GITHUB_TOKEN, AGENT_GITHUB_TOKEN, or GH_TOKEN with repo access.',
  'Google Search (Agent)': 'Set AGENT_GOOGLE_API_KEY and AGENT_GOOGLE_CX for independent web research.',
  AGENT_ENABLED: 'Set AGENT_ENABLED=1.',
  AGENT_SHELL_CWD: 'Set AGENT_SHELL_CWD to the repository root.',
  'Master Branch Protection': 'Protect master and require Pull Requests/status checks before merge.',
  'DATABASE_URL (Postgres)': 'Set DATABASE_URL to durable Postgres for production memory/state.',
  Secrets: 'Set SESSION_SECRET and JWT_SECRET.',
};

function _resultMap(audit) {
  const map = new Map();
  for (const r of audit?.results || []) map.set(r.name, r);
  return map;
}

function _ok(map, names) {
  return names.every(name => map.get(name)?.ok === true);
}

function _missing(map, names) {
  return names
    .map(name => map.get(name))
    .filter(r => !r || !r.ok)
    .map(r => ({
      name: r?.name || 'Unknown',
      error: r?.error || r?.note || 'not ready',
      action: ACTIONS[r?.name] || 'Fix the reported blocker.',
    }));
}

function buildAutonomyStatus(audit, options = {}) {
  const allowDegraded = options.allowDegraded === true || process.env.AGENT_ALLOW_DEGRADED_AUTONOMY === '1';
  const map = _resultMap(audit);
  const capabilities = {
    models: _ok(map, CAPABILITY_NAMES.models),
    gitPrWorkflow: _ok(map, CAPABILITY_NAMES.git),
    shellWorkspace: _ok(map, CAPABILITY_NAMES.shell),
    durableState: _ok(map, CAPABILITY_NAMES.persistence),
    webResearch: _ok(map, CAPABILITY_NAMES.research),
  };
  const blockers = [
    ..._missing(map, CAPABILITY_NAMES.models),
    ..._missing(map, CAPABILITY_NAMES.git),
    ..._missing(map, CAPABILITY_NAMES.shell),
    ..._missing(map, CAPABILITY_NAMES.persistence),
    ..._missing(map, CAPABILITY_NAMES.research),
  ];
  const ready = blockers.length === 0;
  const mode = ready ? 'ready' : (allowDegraded ? 'degraded' : 'blocked');

  return {
    ok: ready || allowDegraded,
    ready,
    mode,
    canStart: ready || allowDegraded,
    canCommit: capabilities.shellWorkspace,
    canOpenPr: capabilities.gitPrWorkflow && capabilities.shellWorkspace,
    canMerge: process.env.AGENT_ALLOW_PR_MERGE === '1' && capabilities.gitPrWorkflow,
    allowDegraded,
    capabilities,
    blockers,
    summary: ready
      ? 'Kelion autonomous agent is ready.'
      : `Kelion autonomous agent is ${mode}. ${blockers.length} blocker(s) remain.`,
    audit,
  };
}

async function checkAutonomyStatus(options = {}) {
  const audit = options.audit || await runEnvAudit();
  return buildAutonomyStatus(audit, options);
}

async function assertCanStart(options = {}) {
  const status = await checkAutonomyStatus(options);
  if (!status.canStart) {
    return {
      ok: false,
      error: 'autonomy_not_ready',
      status,
    };
  }
  return { ok: true, status };
}

module.exports = {
  buildAutonomyStatus,
  checkAutonomyStatus,
  assertCanStart,
};
