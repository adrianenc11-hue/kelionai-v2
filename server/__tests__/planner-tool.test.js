const {
  KELION_TOOLS,
  buildKelionToolsOpenAI,
  buildKelionToolsGemini,
} = require('../src/routes/realtime');
const {
  toolPlanTask,
  executeRealTool,
  REAL_TOOL_NAMES,
} = require('../src/services/realTools');

// PR #7/N — Planner Brain. Adrian's ask
// ("ma asteptam sa fie ai de soft, sa stie sa decida, sa fie ca un
//  creier. sa gestioneze tot … un creier care ia decizii, apasa butoane,
//  e clar, stie ce face") requires Kelion to *think before acting* on
// multi-step requests. The plan_task tool routes the user goal to
// Gemini 2.5 Flash and returns a short numbered plan. These tests pin
// the public contract:
//   • the tool is declared in KELION_TOOLS + both transport adapters
//   • the executor validates input and degrades gracefully when the
//     Gemini key is missing (so CI/staging never 500s)
//   • the executor parses the planner JSON into a stable shape
//   • tool_hint is length-capped so a hallucinated 4 KB "tool_hint"
//     from the planner cannot flood the voice model's context.

describe('PR #7 — plan_task (Planner Brain)', () => {
  describe('tool declaration', () => {
    test('KELION_TOOLS includes plan_task', () => {
      const names = KELION_TOOLS.map((t) => t.name);
      expect(names).toContain('plan_task');
    });

    test('plan_task requires goal and accepts context_hint + max_steps', () => {
      const tool = KELION_TOOLS.find((t) => t.name === 'plan_task');
      expect(tool).toBeDefined();
      expect(tool.required).toEqual(['goal']);
      expect(tool.properties.goal.type).toBe('string');
      expect(tool.properties.context_hint.type).toBe('string');
      expect(tool.properties.max_steps.type).toBe('integer');
    });

    test('plan_task description tells the model to plan BEFORE acting', () => {
      // Adrian's pain was Kelion "just starting to do things" without
      // thinking. The description must explicitly order the model to
      // call plan_task FIRST on multi-step / ambiguous goals so it
      // acquires a plan before touching real tools. Any softening
      // of this instruction would reintroduce the loop behaviour.
      const tool = KELION_TOOLS.find((t) => t.name === 'plan_task');
      const d = tool.description.toLowerCase();
      expect(d).toMatch(/before/);
      expect(d).toMatch(/multi-?step|3\+|compound|ambiguous/);
      expect(d).toMatch(/first|at the top/);
    });

    test('plan_task is advertised via REAL_TOOL_NAMES so the server executor wires it', () => {
      expect(REAL_TOOL_NAMES).toContain('plan_task');
    });

    test('OpenAI adapter surfaces plan_task', () => {
      const openaiTools = buildKelionToolsOpenAI();
      const names = openaiTools.map((t) => t.name || t.function?.name).filter(Boolean);
      expect(names).toContain('plan_task');
    });

    test('Gemini adapter surfaces plan_task under functionDeclarations', () => {
      const geminiTool = buildKelionToolsGemini();
      const decls = (Array.isArray(geminiTool) ? geminiTool : [geminiTool])
        .flatMap((t) => (t && t.functionDeclarations) || []);
      const names = decls.map((d) => d.name);
      expect(names).toContain('plan_task');
    });
  });

  describe('executor', () => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalFetch = global.fetch;

    afterEach(() => {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
      global.fetch = originalFetch;
    });

    test('rejects empty goal', async () => {
      const r = await toolPlanTask({ goal: '   ' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/missing/i);
    });

    test('degrades gracefully when GEMINI_API_KEY is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      const r = await toolPlanTask({ goal: 'Book me a flight to Rome' });
      expect(r.ok).toBe(false);
      expect(r.unavailable).toBe(true);
      expect(r.error).toMatch(/GEMINI_API_KEY/);
    });

    test('parses a well-formed Gemini JSON response into a clean plan', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const planPayload = {
        summary: 'Find and email flights to Rome',
        steps: [
          { n: 1, action: 'Ask user travel dates', why: 'needed for search', tool_hint: null },
          { n: 2, action: 'Search flights', why: 'get options', tool_hint: 'web_search' },
          { n: 3, action: 'Email top 3 results', why: 'send to user', tool_hint: 'send_email' },
        ],
        cautions: ['Will send an email on the user\'s behalf'],
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(planPayload) }] } }],
        }),
        text: async () => '',
      });
      const r = await toolPlanTask({ goal: 'Find flights to Rome and email me the top 3' });
      expect(r.ok).toBe(true);
      expect(r.summary).toBe('Find and email flights to Rome');
      expect(r.steps).toHaveLength(3);
      expect(r.steps[0]).toEqual({ n: 1, action: 'Ask user travel dates', why: 'needed for search', tool_hint: null });
      expect(r.steps[1].tool_hint).toBe('web_search');
      expect(r.cautions).toEqual(['Will send an email on the user\'s behalf']);
    });

    test('strips ```json fences from the model response', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const wrapped = '```json\n' + JSON.stringify({
        summary: 's',
        steps: [{ n: 1, action: 'Do thing', why: 'y', tool_hint: 'calculate' }],
        cautions: [],
      }) + '\n```';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: wrapped }] } }] }),
        text: async () => '',
      });
      const r = await toolPlanTask({ goal: 'Do thing' });
      expect(r.ok).toBe(true);
      expect(r.steps[0].action).toBe('Do thing');
      expect(r.steps[0].tool_hint).toBe('calculate');
    });

    test('clamps step count to max_steps and caps field lengths', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const longStr = 'x'.repeat(2000);
      const planPayload = {
        summary: longStr,
        steps: Array.from({ length: 20 }, (_, i) => ({
          n: i + 1,
          action: longStr,
          why: longStr,
          tool_hint: longStr,
        })),
        cautions: Array.from({ length: 20 }, () => longStr),
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(planPayload) }] } }] }),
        text: async () => '',
      });
      const r = await toolPlanTask({ goal: 'huge', max_steps: 3 });
      expect(r.ok).toBe(true);
      expect(r.summary.length).toBeLessThanOrEqual(400);
      expect(r.steps.length).toBe(3);
      for (const s of r.steps) {
        expect(s.action.length).toBeLessThanOrEqual(400);
        expect(s.why.length).toBeLessThanOrEqual(400);
        expect(s.tool_hint.length).toBeLessThanOrEqual(60);
      }
      expect(r.cautions.length).toBeLessThanOrEqual(6);
      for (const c of r.cautions) {
        expect(c.length).toBeLessThanOrEqual(200);
      }
    });

    test('surfaces upstream errors without throwing', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => 'upstream down',
      });
      const r = await toolPlanTask({ goal: 'Plan something' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/503|upstream/i);
    });

    test('executeRealTool routes plan_task through toolPlanTask', async () => {
      delete process.env.GEMINI_API_KEY;
      const r = await executeRealTool('plan_task', { goal: 'Something' });
      expect(r).toBeTruthy();
      expect(r.ok).toBe(false);
      expect(r.unavailable).toBe(true);
    });
  });
});
