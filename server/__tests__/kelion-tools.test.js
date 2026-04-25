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
  // Real professional tools — all executed server-side with
  // deterministic/real APIs (see server/src/services/realTools.js).
  // PR #133 seed: calculate, get_weather, web_search, translate.
  'calculate',
  'get_weather',
  'web_search',
  'translate',
  // PR A expansion — 24 additional real-API tools (all free, no key).
  'get_forecast',
  'get_air_quality',
  'get_news',
  'get_crypto_price',
  'get_stock_price',
  'get_forex',
  'currency_convert',
  'get_earthquakes',
  'get_sun_times',
  'get_moon_phase',
  'unit_convert',
  'geocode',
  'reverse_geocode',
  'get_route',
  'nearby_places',
  'get_elevation',
  'get_timezone',
  'search_academic',
  'search_github',
  'search_stackoverflow',
  'fetch_url',
  'rss_read',
  'wikipedia_search',
  'dictionary',
  // Groq-powered coding helpers (opt-in via GROQ_API_KEY). Advertised
  // unconditionally because the server returns a graceful "not
  // configured" message when the key is missing.
  'solve_problem',
  'code_review',
  'explain_code',
  // PR #139 — mobile GPS + camera switch. Both tools are client-handled
  // (src/lib/kelionTools.js) and reach into module-level registries
  // (clientGeoProvider, cameraControl) rather than the server.
  'get_my_location',
  'switch_camera',
  // PR #199 — verbal camera controls: on/off + digital zoom ("activează
  // camera spate", "oprește camera", "zoom 2x"). Client-handled via
  // cameraControl.js; the tools ride on the same module-level controller
  // registry as switch_camera so they work under both transports.
  'camera_on',
  'camera_off',
  'zoom_camera',
  // PR #200 — first UI-agency primitives. Client-handled; 'ui_notify'
  // paints a visible status on the stage (so actions the avatar just
  // took are observable, not just spoken), 'ui_navigate' flips the
  // SPA route via an allowlist ('/', '/studio', '/contact'). Later
  // PRs layer ui_click / ui_recording_* on the same controller.
  'ui_notify',
  'ui_navigate',
  // PR B — document readers + OCR (pdf-parse / mammoth / tesseract.js).
  // Inputs accept either a public HTTPS URL or a base64 blob.
  'read_pdf',
  'read_docx',
  'ocr_image',
  'ocr_passport',
  // PR C — regex tester + sandboxed code runner + user-intern tools.
  // run_code needs E2B_API_KEY; get_my_* need a signed-in user passed
  // through ctx. All degrade gracefully when the requirement is absent.
  'run_regex',
  'run_code',
  'get_my_credits',
  'get_my_usage',
  'get_my_profile',
  // PR D — communications + automations + package info.
  'send_email', 'send_sms', 'create_calendar_ics', 'zapier_trigger',
  'github_repo_info', 'npm_package_info', 'pypi_package_info',
  // F11 — AI image generation (OpenAI gpt-image-1). Graceful fallback when
  // OPENAI_API_KEY is absent.
  'generate_image',
  // PR #7/N — Planner Brain. Routes a user goal to Gemini 2.5 Flash and
  // returns a short JSON action plan so Kelion thinks before it acts on
  // compound / multi-step requests. Degrades gracefully when
  // GEMINI_API_KEY is absent (returns { ok:false, unavailable:true }).
  'plan_task',
  // PR #8/N — Memory of Actions. Read-only self-reflection tool: the
  // voice model queries action_history for the signed-in user before
  // repeating a tool call. Guests receive { ok:false, signed_in:false }.
  'get_action_history',
  // Silent vision auto-learn. Persists a private camera/voice
  // observation about the signed-in user as a low-confidence
  // memory_items row. Guests are a no-op. The persona forbids
  // announcing the call and forbids reciting accumulated memory back
  // to the user.
  'learn_from_observation',
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

  // Gemini BidiGenerateContent rejects the whole setup frame with
  // "missing field" if any ARRAY property omits `items`, and closes the
  // socket with code 1007 before setupComplete. Guard the adapter so new
  // array-typed parameters can't regress voice for everyone on Gemini.
  test('every ARRAY property carries an items schema', () => {
    const walk = (schema, path) => {
      if (!schema || typeof schema !== 'object') return;
      if (schema.type === 'ARRAY') {
        expect(schema.items).toBeDefined();
        expect(schema.items.type).toMatch(/^(STRING|INTEGER|NUMBER|BOOLEAN|ARRAY|OBJECT)$/);
        walk(schema.items, `${path}.items`);
      }
      if (schema.type === 'OBJECT') {
        for (const [k, sub] of Object.entries(schema.properties || {})) {
          walk(sub, `${path}.${k}`);
        }
      }
    };
    for (const fn of rendered[0].functionDeclarations) {
      walk(fn.parameters, fn.name);
    }
  });

  test('create_calendar_ics attendees is an array of {email, name?}', () => {
    const fn = rendered[0].functionDeclarations.find((f) => f.name === 'create_calendar_ics');
    const attendees = fn.parameters.properties.attendees;
    expect(attendees.type).toBe('ARRAY');
    expect(attendees.items).toBeDefined();
    expect(attendees.items.type).toBe('OBJECT');
    expect(attendees.items.properties).toHaveProperty('email');
    expect(attendees.items.properties).toHaveProperty('name');
    expect(attendees.items.required).toEqual(['email']);
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
