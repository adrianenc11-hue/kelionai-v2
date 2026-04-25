const {
  KELION_TOOLS,
  buildKelionToolsChatCompletions,
  buildKelionToolsGemini,
} = require('../src/routes/realtime');

// PR #200 — UI agency primitives. Pins the tool catalog so a future
// refactor can't silently erase the "brain presses buttons" contract
// Adrian asked for ("vreau un creier … apasă butoane"). Every case
// below maps directly to a user-visible behavior:
//   ui_notify → a toast appears on the stage
//   ui_navigate → the SPA route changes (allowlisted to 3 paths)

describe('PR #200 — UI action tools', () => {
  test('KELION_TOOLS includes ui_notify + ui_navigate', () => {
    const names = KELION_TOOLS.map((t) => t.name);
    expect(names).toContain('ui_notify');
    expect(names).toContain('ui_navigate');
  });

  test('ui_notify requires text and accepts variant + ttl_s', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'ui_notify');
    expect(tool).toBeDefined();
    expect(tool.required).toEqual(['text']);
    expect(tool.properties.text.type).toBe('string');
    expect(tool.properties.variant.enum).toEqual([
      'info', 'success', 'warning', 'error',
    ]);
    expect(tool.properties.ttl_s.type).toBe('number');
  });

  test('ui_notify description encourages post-action proof + length cap', () => {
    // Adrian's frustration: Kelion says "am deschis harta" but nothing
    // shows on screen. The description's job is to make the model
    // actually fire this tool AFTER a real action completes, so the
    // user sees visible confirmation instead of trusting a spoken
    // claim. Pinning the "actually completed" + "≤ 80 characters"
    // phrasing stops a future edit from softening either signal.
    const tool = KELION_TOOLS.find((t) => t.name === 'ui_notify');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/actually completed|proves?|see[s]? that/);
    expect(d).toMatch(/≤\s*80|80 characters/);
  });

  test('ui_navigate is strictly allowlisted to /, /studio, /contact', () => {
    // The client-side tool handler re-validates against the same
    // allowlist in uiActionStore.js. Keeping the enum tight at the
    // tool-schema level stops the model from even producing a
    // hallucinated path — it's rejected by the JSON schema before
    // the tool call is dispatched. If new routes get added later,
    // both this enum AND uiActionStore.ALLOWED_ROUTES must grow.
    const tool = KELION_TOOLS.find((t) => t.name === 'ui_navigate');
    expect(tool).toBeDefined();
    expect(tool.required).toEqual(['route']);
    expect(tool.properties.route.enum).toEqual(['/', '/studio', '/contact']);
  });

  test('ui_navigate description warns against guessing a route', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'ui_navigate');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/do not guess|rejected|hallucinat/);
  });

  test('OpenAI adapter surfaces both UI tools', () => {
    const openaiTools = buildKelionToolsChatCompletions();
    const names = openaiTools.map((t) => t.name || t.function?.name).filter(Boolean);
    expect(names).toContain('ui_notify');
    expect(names).toContain('ui_navigate');
  });

  test('Gemini adapter surfaces both UI tools under functionDeclarations', () => {
    const geminiTool = buildKelionToolsGemini();
    const decls = (Array.isArray(geminiTool) ? geminiTool : [geminiTool])
      .flatMap((t) => (t && t.functionDeclarations) || []);
    const names = decls.map((d) => d.name);
    expect(names).toContain('ui_notify');
    expect(names).toContain('ui_navigate');
  });
});
