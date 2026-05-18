'use strict';

const { buildAutonomyStatus } = require('../src/services/autonomySupervisor');

const names = [
  'OpenRouter API Key',
  'Google AI Studio Keys',
  'GitHub Token',
  'Master Branch Protection',
  'AGENT_ENABLED',
  'AGENT_SHELL_CWD',
  'DATABASE_URL (Postgres)',
  'Secrets',
  'Google Search (Agent)',
];

function audit(okNames = []) {
  const ok = new Set(okNames);
  const results = names.map(name => ({
    name,
    ok: ok.has(name),
    requiredForAutonomy: true,
    error: ok.has(name) ? null : `${name} missing`,
  }));
  const blockers = results.filter(r => !r.ok).map(r => ({ name: r.name, error: r.error }));
  return {
    results,
    allOk: blockers.length === 0,
    fail: blockers.length,
    total: results.length,
    autonomy: {
      ready: blockers.length === 0,
      fail: blockers.length,
      total: results.length,
      blockers,
    },
  };
}

describe('autonomySupervisor', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.AGENT_ALLOW_DEGRADED_AUTONOMY;
    delete process.env.AGENT_ALLOW_PR_MERGE;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('blocks independent start when autonomy blockers remain', () => {
    const status = buildAutonomyStatus(audit(['OpenRouter API Key']));
    expect(status.ready).toBe(false);
    expect(status.mode).toBe('blocked');
    expect(status.canStart).toBe(false);
    expect(status.blockers.length).toBeGreaterThan(1);
  });

  test('allows explicit degraded mode but keeps blockers visible', () => {
    const status = buildAutonomyStatus(audit(['OpenRouter API Key']), { allowDegraded: true });
    expect(status.ready).toBe(false);
    expect(status.mode).toBe('degraded');
    expect(status.canStart).toBe(true);
    expect(status.blockers.some(b => b.name === 'GitHub Token')).toBe(true);
  });

  test('reports ready when every autonomy capability is configured', () => {
    const status = buildAutonomyStatus(audit(names));
    expect(status.ready).toBe(true);
    expect(status.mode).toBe('ready');
    expect(status.canStart).toBe(true);
    expect(status.canOpenPr).toBe(true);
    expect(status.capabilities).toMatchObject({
      models: true,
      gitPrWorkflow: true,
      shellWorkspace: true,
      durableState: true,
      webResearch: true,
    });
  });

  test('merge remains disabled unless explicitly allowed', () => {
    const status = buildAutonomyStatus(audit(names));
    expect(status.canMerge).toBe(false);
    process.env.AGENT_ALLOW_PR_MERGE = '1';
    expect(buildAutonomyStatus(audit(names)).canMerge).toBe(true);
  });
});
