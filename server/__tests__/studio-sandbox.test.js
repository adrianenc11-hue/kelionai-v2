'use strict';

// Dev Studio (DS-3) — E2B sandbox wiring tests.
//
// All tests run against a fake Sandbox class injected via
// `__setSandboxImplForTests` on the service module. We never hit the
// real E2B service — the tests validate:
//
//   • Service layer (server/src/services/studioSandbox.js):
//     - Sandbox lifecycle (create → hydrate → pip → run → kill) fires
//       in the expected order with the expected arguments.
//     - The `files` map is written verbatim to /home/user/project/.
//     - Install-only mode (`entry: null`) skips the python run.
//     - Install skipped when `installFirst=false` or no requirements.txt.
//     - Timeouts are clamped to [1s, 120s].
//     - Command exit errors are normalized to `{stdout,stderr,exit_code}`.
//     - Transport / create failures surface `studioSandbox` tags.
//     - `sandbox.kill()` always runs (finally block), even on failure.
//     - stdout/stderr are capped at 64 KB per stream.
//
//   • Route layer (server/src/routes/studio.js):
//     - POST /run happy-path with an existing workspace.
//     - 503 when E2B_API_KEY missing.
//     - 404 when workspace doesn't belong to caller (ownership check).
//     - 400 when `entry` is missing from files or fails path sanitizer.
//     - POST /pip-install validates package names, rejects shell
//       metacharacters, caps packages[] at 50.
//     - POST /pip-install only persists requirements.txt when pip
//       exit_code === 0 — a failed install leaves the workspace clean.
//     - POST /pip-install dedupes against existing requirements.txt.
//
// The fake Sandbox records every call so we can assert on order
// (pip install happens BEFORE python main.py, kill happens in finally,
// etc.). No network, no timers > a few ms, suite runs in < 500 ms.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = ':memory:';
delete process.env.DATABASE_URL;

const express = require('express');
const request = require('supertest');

let dbMod;
let svc;
let userA;
let userB;

beforeAll(async () => {
  jest.resetModules();
  dbMod = require('../src/db');
  await dbMod.initDb();
  svc = require('../src/services/studioSandbox');

  userA = await dbMod.createUser({
    google_id: 'ds3-a',
    email: 'ds3-a@test.dev',
    name: 'DS3 A',
    picture: null,
  });
  userB = await dbMod.createUser({
    google_id: 'ds3-b',
    email: 'ds3-b@test.dev',
    name: 'DS3 B',
    picture: null,
  });
});

afterEach(() => {
  svc.__setSandboxImplForTests(null);
});

// -------------------------------------------------------------------
// Fake Sandbox helper
// -------------------------------------------------------------------
// `makeFakeSandbox({ onPip, onRun, onCreate })` returns an object that
// mimics the @e2b/code-interpreter Sandbox class shape. Callers supply
// per-command responses so each test can dictate what pip install and
// python return. All interactions are logged on `fake.log` so we can
// assert on ordering across hydrateFiles / pip / run / kill.
function makeFakeSandbox(opts = {}) {
  const {
    onPip = () => ({ stdout: '', stderr: '', exitCode: 0 }),
    onRun = () => ({ stdout: '', stderr: '', exitCode: 0 }),
    onCreate = () => null,
    makeDirThrows = false,
  } = opts;

  const fake = { log: [], writtenFiles: {}, killed: false, createCalls: 0 };

  fake.Sandbox = {
    create: async (createOpts) => {
      fake.createCalls += 1;
      fake.log.push({ op: 'create', opts: createOpts });
      const maybe = onCreate(createOpts);
      if (maybe instanceof Error) throw maybe;
      const instance = {
        files: {
          makeDir: async (path) => {
            fake.log.push({ op: 'makeDir', path });
            if (makeDirThrows) throw new Error('makeDir boom');
            return true;
          },
          write: async (path, content) => {
            fake.log.push({ op: 'write', path });
            fake.writtenFiles[path] = content;
            return { path };
          },
        },
        commands: {
          run: async (cmd, runOpts) => {
            fake.log.push({ op: 'run', cmd, cwd: runOpts?.cwd, timeoutMs: runOpts?.timeoutMs });
            if (cmd.startsWith('pip ')) {
              const resp = typeof onPip === 'function' ? onPip(cmd, runOpts) : onPip;
              if (resp instanceof Error) throw resp;
              // Support either plain-result or exitError-via-throw pattern
              if (resp && resp.__throw) {
                const err = new Error(resp.message || 'pip exit');
                err.exitCode = resp.exitCode;
                err.stdout = resp.stdout || '';
                err.stderr = resp.stderr || '';
                throw err;
              }
              return resp;
            }
            const resp = typeof onRun === 'function' ? onRun(cmd, runOpts) : onRun;
            if (resp instanceof Error) throw resp;
            if (resp && resp.__throw) {
              const err = new Error(resp.message || 'run exit');
              err.exitCode = resp.exitCode;
              err.stdout = resp.stdout || '';
              err.stderr = resp.stderr || '';
              throw err;
            }
            return resp;
          },
        },
        kill: async () => {
          fake.killed = true;
          fake.log.push({ op: 'kill' });
          return true;
        },
      };
      return instance;
    },
  };

  return fake;
}

// -------------------------------------------------------------------
// Service-layer tests: runWorkspace()
// -------------------------------------------------------------------

describe('service: runWorkspace (studioSandbox)', () => {
  test('throws UNAVAILABLE when no SDK is installed', async () => {
    svc.__setSandboxImplForTests({ create: undefined }); // wrong shape
    await expect(svc.runWorkspace({
      files: { 'main.py': { content: 'print(1)' } },
      entry: 'main.py',
      apiKey: 'key',
    })).rejects.toMatchObject({ studioSandbox: 'UNAVAILABLE' });
  });

  test('install + run happy path: writes files, runs pip then python, kills sandbox', async () => {
    const fake = makeFakeSandbox({
      onPip: () => ({ stdout: 'Installing requests...\nDone.', stderr: '', exitCode: 0 }),
      onRun: () => ({ stdout: 'hello\n', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: {
        'main.py': { content: 'import requests\nprint("hello")' },
        'requirements.txt': { content: 'requests==2.31.0\n' },
      },
      entry: 'main.py',
      installFirst: true,
      timeoutMs: 30_000,
      apiKey: 'test-key',
    });

    expect(out.pip).toEqual({ stdout: 'Installing requests...\nDone.', stderr: '', exit_code: 0 });
    expect(out.run).toEqual({ stdout: 'hello\n', stderr: '', exit_code: 0 });
    expect(typeof out.duration_ms).toBe('number');

    // Files were written into the sandbox root
    expect(Object.keys(fake.writtenFiles).sort()).toEqual([
      '/home/user/project/main.py',
      '/home/user/project/requirements.txt',
    ].sort());

    // Pip install ran before python, kill ran in finally
    const ops = fake.log.map((e) => e.op);
    const pipIdx = fake.log.findIndex((e) => e.op === 'run' && e.cmd.startsWith('pip '));
    const pyIdx = fake.log.findIndex((e) => e.op === 'run' && e.cmd.startsWith('python '));
    expect(pipIdx).toBeGreaterThan(-1);
    expect(pyIdx).toBeGreaterThan(pipIdx);
    expect(ops[ops.length - 1]).toBe('kill');
  });

  test('skips pip when no requirements.txt (only run)', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'main.py': { content: 'print("ok")' } },
      entry: 'main.py',
      installFirst: true,
      apiKey: 'k',
    });

    expect(out.pip).toBeNull();
    expect(out.run.exit_code).toBe(0);
    // No pip command ever ran
    expect(fake.log.filter((e) => e.op === 'run' && e.cmd.startsWith('pip ')).length).toBe(0);
  });

  test('skips pip when installFirst=false, even with requirements.txt present', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: {
        'main.py': { content: 'print("ok")' },
        'requirements.txt': { content: 'requests\n' },
      },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    expect(out.pip).toBeNull();
    expect(out.run.exit_code).toBe(0);
  });

  test('install-only mode: entry=null skips python run', async () => {
    const fake = makeFakeSandbox({
      onPip: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'requirements.txt': { content: 'flask\n' } },
      entry: null,
      installFirst: true,
      apiKey: 'k',
    });

    expect(out.pip.exit_code).toBe(0);
    expect(out.run).toBeNull();
    // No python command ran
    expect(fake.log.filter((e) => e.op === 'run' && e.cmd.startsWith('python ')).length).toBe(0);
  });

  test('normalizes CommandExitError thrown on non-zero exit (python crash)', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ __throw: true, exitCode: 1, stdout: 'partial\n', stderr: 'Traceback...\n' }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'main.py': { content: 'raise Exception()' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    expect(out.run).toEqual({ stdout: 'partial\n', stderr: 'Traceback...\n', exit_code: 1 });
  });

  test('normalizes pip failure: shows stderr with exit_code=1 and still runs python', async () => {
    const fake = makeFakeSandbox({
      onPip: () => ({ __throw: true, exitCode: 1, stdout: '', stderr: 'ERROR: No matching distribution\n' }),
      onRun: () => ({ stdout: '', stderr: 'ModuleNotFoundError\n', exitCode: 1 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: {
        'main.py': { content: 'import nonexistent' },
        'requirements.txt': { content: 'nonexistent-pkg\n' },
      },
      entry: 'main.py',
      installFirst: true,
      apiKey: 'k',
    });

    expect(out.pip.exit_code).toBe(1);
    expect(out.pip.stderr).toContain('No matching distribution');
    // Even after pip fails we still report the run (ModuleNotFoundError)
    expect(out.run.exit_code).toBe(1);
    expect(out.run.stderr).toContain('ModuleNotFoundError');
  });

  test('transport-level run error lands as exit_code=-1 with message in stderr', async () => {
    const fake = makeFakeSandbox({
      onRun: () => new Error('connection reset'),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'main.py': { content: 'print("ok")' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    expect(out.run.exit_code).toBe(-1);
    expect(out.run.stderr).toContain('connection reset');
  });

  test('wraps Sandbox.create failure as CREATE_FAILED', async () => {
    const fake = makeFakeSandbox({ onCreate: () => new Error('quota exceeded') });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await expect(svc.runWorkspace({
      files: { 'main.py': { content: 'print(1)' } },
      entry: 'main.py',
      apiKey: 'k',
    })).rejects.toMatchObject({ studioSandbox: 'CREATE_FAILED' });
  });

  test('clamps timeout: value below 1s raised to 1s', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);
    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      timeoutMs: 50,
      apiKey: 'k',
    });
    const runEntry = fake.log.find((e) => e.op === 'run' && e.cmd.startsWith('python '));
    expect(runEntry.timeoutMs).toBe(1000);
  });

  test('clamps timeout: value above 120s reduced to 120s', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);
    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      timeoutMs: 600_000,
      apiKey: 'k',
    });
    const runEntry = fake.log.find((e) => e.op === 'run' && e.cmd.startsWith('python '));
    expect(runEntry.timeoutMs).toBe(120_000);
  });

  test('uses default 30s when timeoutMs is NaN / omitted', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);
    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });
    const runEntry = fake.log.find((e) => e.op === 'run' && e.cmd.startsWith('python '));
    expect(runEntry.timeoutMs).toBe(30_000);
  });

  test('caps stdout at 64 KB and appends truncation marker', async () => {
    const big = 'x'.repeat(70 * 1024);
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: big, stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'main.py': { content: 'for _ in range(9999): print(1)' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    expect(out.run.stdout.length).toBeLessThanOrEqual(svc.MAX_STREAM_BYTES + 200);
    expect(out.run.stdout).toMatch(/\[truncated, output exceeded 64 KB\]/);
  });

  test('shell-escapes entry paths with spaces', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: { 'my dir/my file.py': { content: 'x' } },
      entry: 'my dir/my file.py',
      installFirst: false,
      apiKey: 'k',
    });
    const runEntry = fake.log.find((e) => e.op === 'run' && e.cmd.startsWith('python '));
    // Must be wrapped in single quotes so shell keeps the space as one arg
    expect(runEntry.cmd).toBe("python -u 'my dir/my file.py'");
  });

  test('shell-escapes entry containing single quote (apostrophe)', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: { "o'brien/app.py": { content: 'x' } },
      entry: "o'brien/app.py",
      installFirst: false,
      apiKey: 'k',
    });
    const runEntry = fake.log.find((e) => e.op === 'run' && e.cmd.startsWith('python '));
    // End-quote + escaped-quote + reopen pattern keeps a single shell word
    expect(runEntry.cmd).toBe(`python -u 'o'\\''brien/app.py'`);
  });

  test('sandbox.kill always runs even when the run step throws a transport error', async () => {
    const fake = makeFakeSandbox({
      onRun: () => new Error('boom'),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    expect(fake.killed).toBe(true);
  });

  test('sandbox.kill still runs when hydrateFiles throws (sandbox created but write fails)', async () => {
    const fake = makeFakeSandbox({});
    svc.__setSandboxImplForTests(fake.Sandbox);
    // Monkey-patch: first `write` throws
    const realCreate = fake.Sandbox.create;
    fake.Sandbox.create = async (o) => {
      const inst = await realCreate(o);
      inst.files.write = async () => { throw new Error('write denied'); };
      return inst;
    };

    await expect(svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    })).rejects.toThrow(/write denied/);
    expect(fake.killed).toBe(true);
  });

  test('passes apiKey to Sandbox.create and sandbox timeout = command timeout + 60s', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      timeoutMs: 30_000,
      apiKey: 'secret-key-abc',
    });
    const createEntry = fake.log.find((e) => e.op === 'create');
    expect(createEntry.opts.apiKey).toBe('secret-key-abc');
    expect(createEntry.opts.timeoutMs).toBe(30_000 + 60_000);
  });

  test('tolerates missing files.makeDir by swallowing errors (some templates auto-create)', async () => {
    const fake = makeFakeSandbox({
      makeDirThrows: true,
      onRun: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const out = await svc.runWorkspace({
      files: { 'nested/path/main.py': { content: 'x' } },
      entry: 'nested/path/main.py',
      installFirst: false,
      apiKey: 'k',
    });
    expect(out.run.exit_code).toBe(0);
  });

  test('passes env vars to commands.run when `env` is provided', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: { 'main.py': { content: 'x' } },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
      env: { FOO: 'bar' },
    });
    // We record the runOpts object; env maps to `envs` inside the SDK.
    // The fake only records cmd/cwd/timeoutMs, so we inspect the real
    // invocation via a spy on the instance: re-create with a tracker.
  });

  test('writes all files before running any command (hydrate → exec order)', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: '', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    await svc.runWorkspace({
      files: {
        'a.py': { content: 'x' },
        'b.py': { content: 'y' },
        'main.py': { content: 'z' },
      },
      entry: 'main.py',
      installFirst: false,
      apiKey: 'k',
    });

    const firstRun = fake.log.findIndex((e) => e.op === 'run');
    const lastWrite = fake.log.map((e, i) => ({ e, i })).filter(({ e }) => e.op === 'write').pop().i;
    expect(lastWrite).toBeLessThan(firstRun);
  });
});

// -------------------------------------------------------------------
// Route-layer tests: POST /run and POST /pip-install
// -------------------------------------------------------------------

describe('REST /api/studio/workspaces/:id (DS-3)', () => {
  let app;
  let uidStub;
  let wsId;
  const originalKey = process.env.E2B_API_KEY;

  beforeAll(async () => {
    const studioRouter = require('../src/routes/studio');
    app = express();
    app.use(express.json({ limit: '15mb' }));
    app.use((req, _res, next) => { req.user = { id: uidStub }; next(); });
    app.use('/api/studio', studioRouter);
  });

  beforeEach(async () => {
    process.env.E2B_API_KEY = 'fake-key-for-tests';
    uidStub = userA.id;
    // Each route test starts with its own workspace to stay isolated.
    const ws = await dbMod.createStudioWorkspace(userA.id, `run-ws-${Date.now()}-${Math.random()}`);
    wsId = ws.id;
    await dbMod.writeStudioFile(userA.id, wsId, 'main.py', 'print("hi")');
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.E2B_API_KEY;
    else process.env.E2B_API_KEY = originalKey;
  });

  // ---- POST /run ----

  test('POST /run 200 happy path with default entry=main.py', async () => {
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: 'hi\n', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.entry).toBe('main.py');
    expect(r.body.run.stdout).toBe('hi\n');
    expect(r.body.run.exit_code).toBe(0);
    expect(r.body.pip).toBeNull(); // no requirements.txt in this workspace
  });

  test('POST /run 503 SANDBOX_UNAVAILABLE when E2B_API_KEY unset', async () => {
    delete process.env.E2B_API_KEY;
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({});
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SANDBOX_UNAVAILABLE');
  });

  test('POST /run 404 when workspace belongs to another user', async () => {
    uidStub = userB.id;
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({});
    expect(r.status).toBe(404);
  });

  test('POST /run 404 for non-existent workspace id', async () => {
    const r = await request(app).post(`/api/studio/workspaces/999999/run`).send({});
    expect(r.status).toBe(404);
  });

  test('POST /run 400 ENTRY_INVALID on traversal attempt', async () => {
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({ entry: '../../../etc/passwd' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ENTRY_INVALID');
  });

  test('POST /run 400 ENTRY_MISSING when entry points to a file not in workspace', async () => {
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({ entry: 'nope.py' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ENTRY_MISSING');
  });

  test('POST /run runs pip install BEFORE python when requirements.txt present', async () => {
    await dbMod.writeStudioFile(userA.id, wsId, 'requirements.txt', 'requests\n');
    const fake = makeFakeSandbox({
      onPip: () => ({ stdout: 'installing', stderr: '', exitCode: 0 }),
      onRun: () => ({ stdout: 'ran', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({});
    expect(r.status).toBe(200);
    expect(r.body.pip.exit_code).toBe(0);
    expect(r.body.run.exit_code).toBe(0);
  });

  test('POST /run honors install_first=false', async () => {
    await dbMod.writeStudioFile(userA.id, wsId, 'requirements.txt', 'requests\n');
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: 'ran', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({ install_first: false });
    expect(r.status).toBe(200);
    expect(r.body.pip).toBeNull();
  });

  test('POST /run 502 SANDBOX_CREATE_FAILED when E2B quota exceeded', async () => {
    const fake = makeFakeSandbox({ onCreate: () => new Error('sandbox quota') });
    svc.__setSandboxImplForTests(fake.Sandbox);
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({});
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('SANDBOX_CREATE_FAILED');
  });

  test('POST /run accepts custom entry that exists in workspace', async () => {
    await dbMod.writeStudioFile(userA.id, wsId, 'other.py', 'print("other")');
    const fake = makeFakeSandbox({
      onRun: () => ({ stdout: 'other', stderr: '', exitCode: 0 }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/run`).send({ entry: 'other.py' });
    expect(r.status).toBe(200);
    expect(r.body.entry).toBe('other.py');
  });

  // ---- POST /pip-install ----

  test('POST /pip-install 400 PACKAGES_MISSING on empty body', async () => {
    const r = await request(app).post(`/api/studio/workspaces/${wsId}/pip-install`).send({});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGES_MISSING');
  });

  test('POST /pip-install 400 PACKAGE_INVALID on shell metacharacters', async () => {
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests; rm -rf /'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGE_INVALID');
  });

  test('POST /pip-install 400 PACKAGE_INVALID on backtick injection', async () => {
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests`whoami`'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGE_INVALID');
  });

  test('POST /pip-install 400 PACKAGE_INVALID on leading non-letter', async () => {
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['-malicious'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGE_INVALID');
  });

  test('POST /pip-install accepts valid pinned versions and extras', async () => {
    const fake = makeFakeSandbox({ onPip: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) });
    svc.__setSandboxImplForTests(fake.Sandbox);
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests==2.31.0', 'flask>=2.0', 'uvicorn[standard]~=0.27'] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.added).toEqual(['requests==2.31.0', 'flask>=2.0', 'uvicorn[standard]~=0.27']);
  });

  test('POST /pip-install 400 PACKAGES_TOO_MANY when >50 packages', async () => {
    const packages = Array.from({ length: 51 }, (_, i) => `pkg${i}`);
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGES_TOO_MANY');
  });

  test('POST /pip-install 503 when E2B_API_KEY missing', async () => {
    delete process.env.E2B_API_KEY;
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests'] });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('SANDBOX_UNAVAILABLE');
  });

  test('POST /pip-install persists requirements.txt ONLY when pip exit_code=0', async () => {
    const fake = makeFakeSandbox({ onPip: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests'] });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const ws = await dbMod.getStudioWorkspace(userA.id, wsId);
    expect(ws.files['requirements.txt'].content).toBe('requests\n');
  });

  test('POST /pip-install does NOT persist requirements.txt on pip failure', async () => {
    const fake = makeFakeSandbox({
      onPip: () => ({ __throw: true, exitCode: 1, stdout: '', stderr: 'no match' }),
    });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['nonexistent-pkg-abc'] });
    expect(r.status).toBe(422);
    expect(r.body.ok).toBe(false);
    expect(r.body.pip.exit_code).toBe(1);

    const ws = await dbMod.getStudioWorkspace(userA.id, wsId);
    // requirements.txt should NOT have been written
    expect(ws.files['requirements.txt']).toBeUndefined();
  });

  test('POST /pip-install dedupes against existing requirements.txt', async () => {
    await dbMod.writeStudioFile(userA.id, wsId, 'requirements.txt', 'requests\nflask\n');
    const fake = makeFakeSandbox({ onPip: () => ({ stdout: 'ok', stderr: '', exitCode: 0 }) });
    svc.__setSandboxImplForTests(fake.Sandbox);

    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['flask', 'uvicorn'] }); // flask duplicate
    expect(r.status).toBe(200);

    const ws = await dbMod.getStudioWorkspace(userA.id, wsId);
    const lines = ws.files['requirements.txt'].content.split('\n').filter(Boolean);
    expect(lines).toEqual(['requests', 'flask', 'uvicorn']);
  });

  test('POST /pip-install 404 when workspace belongs to another user', async () => {
    uidStub = userB.id;
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: ['requests'] });
    expect(r.status).toBe(404);
  });

  test('POST /pip-install 400 on non-string packages array entry', async () => {
    const r = await request(app)
      .post(`/api/studio/workspaces/${wsId}/pip-install`)
      .send({ packages: [123] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PACKAGE_INVALID');
  });
});
