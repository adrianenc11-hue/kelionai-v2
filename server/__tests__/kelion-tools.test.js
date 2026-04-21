'use strict';

// Unit tests for the provider-agnostic Kelion tool catalog and its two
// shape adapters. Guards against drift between the Gemini Live and
// OpenAI Realtime renderings when a new tool is added to KELION_TOOLS
// — both shapes must still emit the exact set of tool names and the
// same required-argument contracts.

// Minimal env so `src/routes/realtime` loads without exploding on
// config-required vars.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini';

const {
  KELION_TOOLS,
  buildKelionToolsGemini,
  buildKelionToolsOpenAI,
} = require('../src/routes/realtime');

const EXPECTED_TOOL_NAMES = [
  'browse_web',
  'read_calendar',
  'read_email',
  'search_files',
  'observe_user_emotion',
  'set_narration_mode',
  'what_do_you_see',
  'show_on_monitor',
  // Real professional tools added in this PR — all executed server-side
  // with deterministic/real APIs (see server/src/services/realTools.js).
  'calculate',
  'get_weather',
  'web_search',
  'translate',
];

describe('Kelion tool catalog', () => {
  test('KELION_TOOLS exports the expected tool set', () => {
    const names = KELION_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  test('every tool has a description and required-args array', () => {
    for (const t of KELION_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(20);
      expect(Array.isArray(t.required)).toBe(true);
      expect(t.properties && typeof t.properties).toBe('object');
      // Every required key must exist in properties
      for (const k of t.required) {
        expect(t.properties[k]).toBeDefined();
      }
    }
  });
});

describe('buildKelionToolsGemini', () => {
  const rendered = buildKelionToolsGemini();

  test('returns a single functionDeclarations wrapper (Gemini Live shape)', () => {
    expect(Array.isArray(rendered)).toBe(true);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveProperty('functionDeclarations');
    expect(Array.isArray(rendered[0].functionDeclarations)).toBe(true);
    expect(rendered[0].functionDeclarations).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  test('types are UPPERCASE (Gemini v1alpha convention)', () => {
    for (const fn of rendered[0].functionDeclarations) {
      expect(fn.parameters.type).toBe('OBJECT');
      for (const [, prop] of Object.entries(fn.parameters.properties)) {
        expect(prop.type).toMatch(/^(STRING|INTEGER|NUMBER|BOOLEAN|ARRAY|OBJECT)$/);
      }
    }
  });

  test('observe_user_emotion keeps its enum intact in Gemini shape', () => {
    const fn = rendered[0].functionDeclarations.find((f) => f.name === 'observe_user_emotion');
    expect(fn.parameters.properties.state.enum).toEqual([
      'neutral','happy','sad','surprised','angry','tired','focused','confused','anxious',
    ]);
  });
});

describe('buildKelionToolsOpenAI', () => {
  const rendered = buildKelionToolsOpenAI();

  test('returns a flat array of {type:"function", ...} entries', () => {
    expect(Array.isArray(rendered)).toBe(true);
    expect(rendered).toHaveLength(EXPECTED_TOOL_NAMES.length);
    for (const t of rendered) {
      expect(t.type).toBe('function');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.parameters).toBeDefined();
    }
  });

  test('types are lowercase (JSON-Schema convention)', () => {
    for (const t of rendered) {
      expect(t.parameters.type).toBe('object');
      for (const [, prop] of Object.entries(t.parameters.properties)) {
        expect(prop.type).toMatch(/^(string|integer|number|boolean|array|object)$/);
      }
    }
  });

  test('observe_user_emotion keeps its enum intact in OpenAI shape', () => {
    const fn = rendered.find((f) => f.name === 'observe_user_emotion');
    expect(fn.parameters.properties.state.enum).toEqual([
      'neutral','happy','sad','surprised','angry','tired','focused','confused','anxious',
    ]);
  });

  test('tool-name set matches the Gemini rendering exactly', () => {
    const openaiNames = buildKelionToolsOpenAI().map((t) => t.name).sort();
    const geminiNames = buildKelionToolsGemini()[0].functionDeclarations
      .map((t) => t.name).sort();
    expect(openaiNames).toEqual(geminiNames);
  });
});
