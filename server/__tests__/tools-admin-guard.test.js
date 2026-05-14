'use strict';

// Security regression: /api/tools/execute and /api/tools/terminal-stream
// MUST NOT execute dangerous tools (shell / filesystem mutation / repo
// mutation / DB writes) for non-admin callers. Without the guard, any
// visitor that holds the public CSRF cookie can POST
// {name: 'run_terminal_command', args: {command: '...'}} and turn the
// server into a shell-as-a-service. This suite locks the gate down.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/tools-admin-guard.db';

const { createMockDb } = require('./helpers/mockDb');
const mockDb = createMockDb();
jest.mock('../src/db', () => mockDb);
jest.mock('../src/utils/google', () => ({
  generateState: jest.fn().mockReturnValue('s'),
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier: 'v', codeChallenge: 'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/index');
const { ADMIN_ONLY_TOOLS } = require('../src/services/realTools');

beforeEach(() => mockDb._reset());

const unique = () => `tg_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const email = unique();
  const r = await request(app).post('/auth/local/register')
    .send({ email, password: 'ValidPass123!', name: 'Guard User' });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email, name: 'Guard User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, id, email };
}

async function createAdmin() {
  const user = await createUser();
  mockDb.updateRole(user.id, 'admin');
  const token = jwt.sign({ sub: user.id, email: user.email, name: 'Admin', role: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { ...user, token };
}

describe('POST /api/tools/execute — admin guard for dangerous tools', () => {
  it('exposes a non-empty ADMIN_ONLY_TOOLS set', () => {
    expect(ADMIN_ONLY_TOOLS instanceof Set).toBe(true);
    expect(ADMIN_ONLY_TOOLS.size).toBeGreaterThan(5);
  });

  it('covers the obvious RCE / FS / repo tools', () => {
    for (const name of [
      'run_terminal_command', 'run_command',
      'write_to_file', 'replace_file_content', 'edit_local_file',
      'read_local_file', 'list_local_files', 'search_codebase',
      'commit_and_push_to_github', 'create_github_pr',
      'query_database', 'execute_plan',
    ]) {
      expect(ADMIN_ONLY_TOOLS.has(name)).toBe(true);
    }
  });

  it('rejects run_terminal_command for an unauthenticated guest with 403', async () => {
    const r = await request(app)
      .post('/api/tools/execute')
      .send({ name: 'run_terminal_command', args: { command: 'pwd' } });
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error)).toMatch(/admin/i);
  });

  it('rejects run_terminal_command for a signed-in non-admin with 403', async () => {
    const { token } = await createUser();
    const r = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'run_terminal_command', args: { command: 'pwd' } });
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
  });

  it('rejects write_to_file for a guest with 403', async () => {
    const r = await request(app)
      .post('/api/tools/execute')
      .send({ name: 'write_to_file', args: { path: '/tmp/x', content: 'pwn' } });
    expect(r.status).toBe(403);
  });

  it('allows an admin to invoke run_terminal_command (not 403)', async () => {
    const admin = await createAdmin();
    const r = await request(app)
      .post('/api/tools/execute')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'run_terminal_command', args: { command: 'echo guard-ok' } });
    expect(r.status).not.toBe(403);
  });

  it('leaves safe tools usable for guests (unknown tool != 403)', async () => {
    // Pick a clearly-safe known tool (calculate). It must NOT 403.
    const r = await request(app)
      .post('/api/tools/execute')
      .send({ name: 'calculate', args: { expression: '2 + 2' } });
    expect(r.status).not.toBe(403);
  });
});

describe('POST /api/tools/terminal-stream — admin-only', () => {
  it('rejects guests with 403', async () => {
    const r = await request(app)
      .post('/api/tools/terminal-stream')
      .send({ command: 'pwd' });
    expect(r.status).toBe(403);
  });

  it('rejects non-admin signed-in users with 403', async () => {
    const { token } = await createUser();
    const r = await request(app)
      .post('/api/tools/terminal-stream')
      .set('Authorization', `Bearer ${token}`)
      .send({ command: 'pwd' });
    expect(r.status).toBe(403);
  });
});
