const {
  KELION_TOOLS,
  buildKelionToolsOpenAI,
  buildKelionToolsGemini,
} = require('../src/routes/realtime');

// PR #199 — verbal camera controls. Pins the tool surface so future
// refactors can't silently break the voice model's ability to open,
// close, swap, and zoom the camera. Every assertion maps to a concrete
// user utterance Adrian asked for:
//   "activează / pornește camera [față|spate]"  → camera_on
//   "dezactivează / oprește camera"              → camera_off
//   "comută camerele" / "rotește camera"         → switch_camera
//   "focalizează pe X" / "zoom 2x"               → zoom_camera
// Removing any of these reopens the "Kelion pretends it opened the
// camera but actually did nothing" failure mode.

describe('PR #199 — verbal camera controls', () => {
  test('KELION_TOOLS includes camera_on / camera_off / zoom_camera', () => {
    const names = KELION_TOOLS.map((t) => t.name);
    expect(names).toContain('camera_on');
    expect(names).toContain('camera_off');
    expect(names).toContain('zoom_camera');
  });

  test('camera_on has optional front/back side argument', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'camera_on');
    expect(tool).toBeDefined();
    expect(tool.properties.side).toBeDefined();
    expect(tool.properties.side.enum).toEqual(['front', 'back']);
    // `side` must be OPTIONAL — when the user just says "pornește camera"
    // the client defaults to back (most performant lens per Adrian).
    expect((tool.required || []).length).toBe(0);
  });

  test('camera_on description names the Romanian trigger phrases', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'camera_on');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/pornește camera|activează camera/);
    expect(d).toMatch(/camera față/);
    expect(d).toMatch(/camera spate/);
  });

  test('camera_on description promises the most performant back lens + 4K', () => {
    // These phrases guard the two user-visible guarantees: (1) the
    // client auto-picks the primary rear lens instead of ultrawide,
    // and (2) capture goes up to 4K so distant text stays readable.
    const tool = KELION_TOOLS.find((t) => t.name === 'camera_on');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/most performant|primary back|best rear/);
    expect(d).toMatch(/ultrawide|ultra-wide/);
    expect(d).toMatch(/4k|2160|3840/);
  });

  test('camera_off has no arguments', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'camera_off');
    expect(tool).toBeDefined();
    expect(Object.keys(tool.properties || {}).length).toBe(0);
    expect((tool.required || []).length).toBe(0);
  });

  test('camera_off description names "oprește / dezactivează camera"', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'camera_off');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/oprește camera|dezactivează camera|închide camera/);
  });

  test('zoom_camera requires a numeric level', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'zoom_camera');
    expect(tool).toBeDefined();
    expect(tool.properties.level).toBeDefined();
    expect(tool.properties.level.type).toBe('number');
    expect(tool.required).toEqual(['level']);
  });

  test('zoom_camera description explains soft-zoom fallback', () => {
    // When the lens has no hardware zoom capability, the client returns
    // success with a soft-zoom flag. The model has to know this to
    // tell the user "zoom is limited" instead of silently lying.
    const tool = KELION_TOOLS.find((t) => t.name === 'zoom_camera');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/soft[- ]?zoom|software fallback|limited/);
    expect(d).toMatch(/focalizează|zoom/);
  });

  test('switch_camera description includes "comută" + "rotește" aliases', () => {
    // Adrian asked for both "comută camerele" and "rotește camera"
    // phrasings. Without them in the description the model might
    // treat those as unknown commands and fabricate a spoken
    // acknowledgement instead of invoking the tool.
    const tool = KELION_TOOLS.find((t) => t.name === 'switch_camera');
    const d = tool.description.toLowerCase();
    expect(d).toMatch(/comută/);
    expect(d).toMatch(/rotește|rotate|flip|switch/);
  });

  test('OpenAI adapter surfaces all four camera tools', () => {
    const openaiTools = buildKelionToolsOpenAI();
    const names = openaiTools.map((t) => t.name || t.function?.name).filter(Boolean);
    for (const n of ['switch_camera', 'camera_on', 'camera_off', 'zoom_camera']) {
      expect(names).toContain(n);
    }
  });

  test('Gemini adapter surfaces all four camera tools', () => {
    const geminiTool = buildKelionToolsGemini();
    const decls = (Array.isArray(geminiTool) ? geminiTool : [geminiTool])
      .flatMap((t) => (t && t.functionDeclarations) || []);
    const names = decls.map((d) => d.name);
    for (const n of ['switch_camera', 'camera_on', 'camera_off', 'zoom_camera']) {
      expect(names).toContain(n);
    }
  });
});
