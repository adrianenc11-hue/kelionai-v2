'use strict';

// Tests for /api/conversations — the signed-in-user-only chat history
// endpoints added after Adrian's 2026-04-21 request ("sa aiba optiune
// de save … conversatia cu Kelion - nu se salveaza momentan intre
// sesiuni"). These tests:
//   • lock in ownership isolation (user B can't read/append/delete
//     user A's thread) so we don't ship a cross-account leak,
//   • exercise the GET list + GET detail + POST append + DELETE
//     round-trip against the SQLite mock DB,
//   • ensure empty batches / bad ids surface as 4xx rather than 5xx.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/conversations-route-test.db';

const express = require('express');
const request = require('supertest');

// Jest hoists `jest.mock(...)` above all imports, so the factory cannot
// close over outer variables unless their name starts with `mock`. We
// therefore stash the in-memory store on the mock factory itself (via
// `mockDbState`) and expose it after require() for test-side assertions.
jest.mock('../src/db', () => {
  const mockStore = new Map();
  let mockNextConvId = 1;
  let mockNextMsgId  = 1;
  const mockBucket = (uid) => {
    if (!mockStore.has(uid)) mockStore.set(uid, new Map());
    return mockStore.get(uid);
  };
  return {
    __mockReset: () => {
      mockStore.clear();
      mockNextConvId = 1;
      mockNextMsgId  = 1;
    },
    createConversation: async (userId, title) => {
      const bucket = mockBucket(userId);
      const id = mockNextConvId++;
      const now = new Date().toISOString();
      const conv = {
        id, user_id: userId, title: title || null,
        created_at: now, updated_at: now, messages: [],
      };
      bucket.set(id, conv);
      return conv;
    },
    appendConversationMessage: async (userId, id, role, content) => {
      const conv = mockBucket(userId).get(Number(id));
      if (!conv) return null;
      // Mirror the real impl's defense-in-depth dedupe: if the most
      // recent row matches (role, content) exactly, reuse it instead
      // of inserting a duplicate (fixes the orphan-thread bug on prod).
      const last = conv.messages[conv.messages.length - 1];
      if (last && last.role === role && last.content === content) {
        return { ...last };
      }
      const msg = {
        id: mockNextMsgId++, conversation_id: conv.id,
        role, content, created_at: new Date().toISOString(),
      };
      conv.messages.push(msg);
      conv.updated_at = msg.created_at;
      return msg;
    },
    listConversations: async (userId, limit) => {
      const rows = [...mockBucket(userId).values()]
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, limit);
      return rows.map((c) => ({
        id: c.id, title: c.title,
        created_at: c.created_at, updated_at: c.updated_at,
        message_count: c.messages.length,
      }));
    },
    getConversationWithMessages: async (userId, id) => {
      const conv = mockBucket(userId).get(Number(id));
      if (!conv) return null;
      return {
        id: conv.id, title: conv.title,
        created_at: conv.created_at, updated_at: conv.updated_at,
        messages: conv.messages.map((m) => ({
          id: m.id, role: m.role, content: m.content, created_at: m.created_at,
        })),
      };
    },
    updateConversationTitle: async (userId, id, title) => {
      const conv = mockBucket(userId).get(Number(id));
      if (!conv) return false;
      conv.title = title || null;
      conv.updated_at = new Date().toISOString();
      return true;
    },
    deleteConversation: async (userId, id) => mockBucket(userId).delete(Number(id)),
  };
});
const db = require('../src/db');

const conversationsRouter = require('../src/routes/conversations');

function makeApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: userId }; next(); });
  app.use('/api/conversations', conversationsRouter);
  return app;
}

beforeEach(() => {
  db.__mockReset();
});

describe('POST /api/conversations', () => {
  it('creates a new thread with a title', async () => {
    const app = makeApp(42);
    const res = await request(app)
      .post('/api/conversations')
      .send({ title: 'First chat' });
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(1);
    expect(res.body.conversation.title).toBe('First chat');
  });
  it('accepts a missing title', async () => {
    const app = makeApp(42);
    const res = await request(app).post('/api/conversations').send({});
    expect(res.status).toBe(200);
    expect(res.body.conversation.title).toBeNull();
  });
});

describe('GET /api/conversations', () => {
  it('lists only the caller\'s threads', async () => {
    const appA = makeApp(1);
    const appB = makeApp(2);
    await request(appA).post('/api/conversations').send({ title: 'A1' });
    await request(appA).post('/api/conversations').send({ title: 'A2' });
    await request(appB).post('/api/conversations').send({ title: 'B1' });
    const resA = await request(appA).get('/api/conversations');
    expect(resA.status).toBe(200);
    expect(resA.body.items).toHaveLength(2);
    expect(resA.body.items.map((c) => c.title).sort()).toEqual(['A1', 'A2']);
    const resB = await request(appB).get('/api/conversations');
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].title).toBe('B1');
  });
});

describe('POST /api/conversations/:id/messages', () => {
  it('appends a single message', async () => {
    const app = makeApp(7);
    const create = await request(app).post('/api/conversations').send({ title: 'x' });
    const id = create.body.conversation.id;
    const res = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ role: 'user', content: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].content).toBe('hi');
  });
  it('accepts a batch and preserves order', async () => {
    const app = makeApp(7);
    const create = await request(app).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const res = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ] });
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });
  it('rejects an empty batch with 400', async () => {
    const app = makeApp(7);
    const create = await request(app).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const res = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({});
    expect(res.status).toBe(400);
  });
  it('dedupes back-to-back identical messages (orphan-thread fix)', async () => {
    // Audit finding #1/#2: the client-side autosave cursor failed to
    // advance when the effect got cancelled mid-await, so a successfully
    // persisted message was sometimes re-POSTed on the next chunk. The
    // server-side guard returns the existing row instead of inserting
    // a duplicate, keeping the thread clean even with legacy clients.
    const app = makeApp(7);
    const create = await request(app).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const first = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ role: 'user', content: 'salut' });
    const second = await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ role: 'user', content: 'salut' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.messages[0].id).toBe(first.body.messages[0].id);
    const detail = await request(app).get(`/api/conversations/${id}`);
    expect(detail.body.conversation.messages).toHaveLength(1);
  });
  it('404s when appending to another user\'s thread', async () => {
    const appA = makeApp(1);
    const appB = makeApp(2);
    const create = await request(appA).post('/api/conversations').send({ title: 'A' });
    const id = create.body.conversation.id;
    const res = await request(appB)
      .post(`/api/conversations/${id}/messages`)
      .send({ role: 'user', content: 'leak?' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/conversations/:id', () => {
  it('returns full transcript for owner', async () => {
    const app = makeApp(5);
    const create = await request(app).post('/api/conversations').send({ title: 't' });
    const id = create.body.conversation.id;
    await request(app)
      .post(`/api/conversations/${id}/messages`)
      .send({ messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ] });
    const res = await request(app).get(`/api/conversations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.messages).toHaveLength(2);
    expect(res.body.conversation.messages[0].content).toBe('q');
  });
  it('404s for a non-owner', async () => {
    const appA = makeApp(1);
    const appB = makeApp(2);
    const create = await request(appA).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const res = await request(appB).get(`/api/conversations/${id}`);
    expect(res.status).toBe(404);
  });
  it('400s on a non-numeric id', async () => {
    const app = makeApp(5);
    const res = await request(app).get('/api/conversations/abc');
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/conversations/:id', () => {
  it('removes the owner\'s thread', async () => {
    const app = makeApp(9);
    const create = await request(app).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const del = await request(app).delete(`/api/conversations/${id}`);
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/conversations/${id}`);
    expect(after.status).toBe(404);
  });
  it('404s for a non-owner', async () => {
    const appA = makeApp(1);
    const appB = makeApp(2);
    const create = await request(appA).post('/api/conversations').send({});
    const id = create.body.conversation.id;
    const del = await request(appB).delete(`/api/conversations/${id}`);
    expect(del.status).toBe(404);
  });
});
