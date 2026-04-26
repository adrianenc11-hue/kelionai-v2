const {
  KELION_TOOLS,
  buildKelionToolsChatCompletions,
  buildKelionToolsGemini,
} = require('../src/routes/realtime');
const {
  toolGetActionHistory,
  executeRealTool,
  REAL_TOOL_NAMES,
} = require('../src/services/realTools');
const { summarizeResultForHistory } = require('../src/services/actionHistorySummarizer');

// PR #8/N — Memory of Actions. Adrian's ask ("creier care ia decizii,
// apasă butoane, e clar, știe ce face") requires Kelion to NOT repeat
// actions it has already taken this session. get_action_history is the
// read side of that memory: it surfaces the caller's own recent tool
// invocations so the voice model can answer "did you already email
// that?" without re-running the tool. Write side (logAction) is wired
// inside /api/tools/execute and covered by tools-route tests.
//
// These tests pin the public contract:
//   • the tool is declared in KELION_TOOLS + both transport adapters
//   • REAL_TOOL_NAMES includes it so the client proxy allows it
//   • the executor refuses guests with { ok:false, signed_in:false }
//   • the executor returns rows for signed-in users, respecting limit
//   • the summariser reduces a tool result to a short speakable line
//     without ever leaking secret-looking fields.

describe('PR #8 — get_action_history (Memory of Actions)', () => {
  describe('tool declaration', () => {
    test('KELION_TOOLS includes get_action_history', () => {
      const names = KELION_TOOLS.map((t) => t.name);
      expect(names).toContain('get_action_history');
    });

    test('get_action_history has no required fields and optional limit + session_id', () => {
      const tool = KELION_TOOLS.find((t) => t.name === 'get_action_history');
      expect(tool).toBeDefined();
      expect(tool.required).toEqual([]);
      expect(tool.properties.limit.type).toBe('integer');
      expect(tool.properties.session_id.type).toBe('string');
    });

    test('description tells the model to check history BEFORE repeating an action', () => {
      // Adrian's pain point was Kelion forgetting what it just did
      // and repeating the action. The description must explicitly
      // instruct the model to call get_action_history BEFORE
      // re-running a potentially-repeated tool. Softening this
      // would reintroduce the "did you already?" confusion.
      const tool = KELION_TOOLS.find((t) => t.name === 'get_action_history');
      const d = tool.description.toLowerCase();
      expect(d).toMatch(/before/);
      expect(d).toMatch(/repeat|again|did you already|re-run/);
    });

    test('is advertised via REAL_TOOL_NAMES so the server executor wires it', () => {
      expect(REAL_TOOL_NAMES).toContain('get_action_history');
    });

    test('Chat Completions adapter surfaces get_action_history', () => {
      const ccTools = buildKelionToolsChatCompletions();
      const names = ccTools.map((t) => t.function?.name);
      expect(names).toContain('get_action_history');
    });

    test('Gemini adapter surfaces get_action_history', () => {
      const geminiTools = buildKelionToolsGemini();
      const names = geminiTools[0].functionDeclarations.map((t) => t.name);
      expect(names).toContain('get_action_history');
    });
  });

  describe('executor — guest path', () => {
    test('returns { ok:false, signed_in:false } when no user in ctx', async () => {
      const r = await toolGetActionHistory({}, undefined);
      expect(r.ok).toBe(false);
      expect(r.signed_in).toBe(false);
      expect(r.error).toMatch(/signed in/i);
    });

    test('executeRealTool routes guests the same way', async () => {
      const r = await executeRealTool('get_action_history', {}, undefined);
      expect(r.ok).toBe(false);
      expect(r.signed_in).toBe(false);
    });
  });

  describe('executor — signed-in path', () => {
    // `toolGetActionHistory` uses `lazy require('../db')` inside the
    // function body to avoid circular imports at boot. That gives us a
    // clean mocking seam: we doMock the db module, reset the require
    // cache, and re-require realTools so the lazy require picks up the
    // mock the next time the tool is called.
    let capturedOpts;
    let capturedUserId;
    let freshTool;
    let listMock;

    beforeEach(() => {
      capturedOpts = undefined;
      capturedUserId = undefined;
      listMock = jest.fn().mockImplementation((userId, opts) => {
        capturedUserId = userId;
        capturedOpts = opts;
        return Promise.resolve([]);
      });
      jest.resetModules();
      jest.doMock('../src/db', () => ({ listRecentActions: listMock }));
      freshTool = require('../src/services/realTools').toolGetActionHistory;
    });

    afterEach(() => {
      jest.dontMock('../src/db');
      jest.resetModules();
    });

    test('returns rows from listRecentActions with sanitised shape', async () => {
      const fakeRows = [
        {
          id: 7,
          tool_name: 'web_search',
          ok: 1,
          args_summary: 'q=kelion',
          result_summary: '3 results — Kelion Studio',
          duration_ms: 420,
          created_at: '2026-04-21T11:00:00Z',
          session_id: 'sess-1',
        },
        {
          id: 6,
          tool_name: 'send_email',
          ok: 1,
          args_summary: 'to=a@b.co',
          result_summary: 'email sent to a@b.co',
          duration_ms: 1200,
          created_at: '2026-04-21T10:59:00Z',
          session_id: 'sess-1',
        },
      ];
      listMock.mockImplementationOnce((userId, opts) => {
        capturedUserId = userId;
        capturedOpts = opts;
        return Promise.resolve(fakeRows);
      });
      const r = await freshTool({ limit: 10 }, { user: { id: 42 } });
      expect(r.ok).toBe(true);
      expect(r.count).toBe(2);
      expect(r.actions).toHaveLength(2);
      expect(capturedUserId).toBe(42);
      expect(r.actions[0]).toEqual(expect.objectContaining({
        id: 7,
        tool: 'web_search',
        ok: true,
        args: 'q=kelion',
        result: '3 results — Kelion Studio',
        duration_ms: 420,
        session_id: 'sess-1',
      }));
    });

    test('limit is clamped into the 1..40 window with default 10', async () => {
      await freshTool({ limit: 1000 }, { user: { id: 1 } });
      expect(capturedOpts.limit).toBe(40);
      await freshTool({ limit: -5 }, { user: { id: 1 } });
      expect(capturedOpts.limit).toBe(1);
      await freshTool({}, { user: { id: 1 } });
      expect(capturedOpts.limit).toBe(10);
    });

    test('session_id is trimmed and capped at 80 chars', async () => {
      await freshTool({ session_id: '   abc   ' }, { user: { id: 1 } });
      expect(capturedOpts.sessionId).toBe('abc');
      await freshTool(
        { session_id: 'x'.repeat(200) },
        { user: { id: 1 } }
      );
      expect(capturedOpts.sessionId.length).toBe(80);
    });

    test('treats ok:0 from SQLite as ok:false in the public shape', async () => {
      listMock.mockImplementationOnce(() => Promise.resolve([
        { id: 1, tool_name: 'send_email', ok: 0, result_summary: 'SMTP 550', created_at: 't' },
      ]));
      const r = await freshTool({}, { user: { id: 1 } });
      expect(r.actions[0].ok).toBe(false);
    });
  });
});

describe('PR #8 — summarizeResultForHistory', () => {
  test('surfaces the error when the tool failed', () => {
    const s = summarizeResultForHistory('send_email', {
      ok: false,
      error: 'SMTP 550 recipient rejected',
    });
    expect(s).toMatch(/send_email failed/);
    expect(s).toMatch(/SMTP 550/);
  });

  test('marks unavailable when the provider is missing', () => {
    const s = summarizeResultForHistory('some_tool', {
      ok: false,
      unavailable: true,
      error: 'Provider not configured',
    });
    expect(s).toMatch(/unavailable/);
  });

  test('condenses web_search into count + first hit', () => {
    const s = summarizeResultForHistory('web_search', {
      ok: true,
      results: [
        { title: 'Kelion Studio docs', url: 'https://kelionai.app/docs' },
        { title: 'another hit' },
      ],
    });
    expect(s).toMatch(/2 results/);
    expect(s).toMatch(/Kelion Studio docs/);
  });

  test('condenses get_weather to location + temp', () => {
    const s = summarizeResultForHistory('get_weather', {
      ok: true,
      location: { name: 'Cluj-Napoca' },
      current: { temperature_2m: 14.2, wind_speed_10m: 3, precipitation: 0 },
    });
    expect(s).toMatch(/Cluj-Napoca/);
    expect(s).toMatch(/14\.2°C/);
  });

  test('caps output at 300 characters', () => {
    const huge = 'x'.repeat(5000);
    const s = summarizeResultForHistory('translate', { ok: true, translated: huge });
    expect(s.length).toBeLessThanOrEqual(300);
  });

  test('falls back to key list for unknown tool shapes', () => {
    const s = summarizeResultForHistory('some_new_tool', {
      ok: true,
      foo: { nested: 1 },
      bar: 42,
    });
    expect(s).toMatch(/^ok/);
    expect(s).toMatch(/foo/);
  });
});
