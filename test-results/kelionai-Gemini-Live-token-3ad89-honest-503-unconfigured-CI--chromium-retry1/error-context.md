# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: kelionai.spec.js >> Gemini Live token endpoint (Stage 1 precondition) >> Default (aistudio) returns a token (prod) or honest 503 (unconfigured CI)
- Location: e2e\kelionai.spec.js:109:3

# Error details

```
Error: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:5173
Call log:
  - → GET http://127.0.0.1:5173/api/realtime/gemini-token?lang=en-US
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br

```

# Test source

```ts
  18  |  *   2. The homepage HTML actually renders the Kelion shell (root div + JS).
  19  |  *   3. Old product routes do not leave the user on an admin/chat/plans page.
  20  |  *   4. The Gemini Live token endpoint responds with a structured JSON error
  21  |  *      when GEMINI_API_KEY is not set (the CI case) and does NOT crash the
  22  |  *      server or leak a stack trace.
  23  |  */
  24  | 
  25  | const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
  26  | 
  27  | test.describe('Server health', () => {
  28  |   test('GET /health returns 200 with status=ok', async ({ request }) => {
  29  |     const res = await request.get(`${BASE}/health`);
  30  |     expect(res.status()).toBe(200);
  31  |     const body = await res.json();
  32  |     expect(body.status).toBe('ok');
  33  |   });
  34  | 
  35  |   test('GET /ping returns a pong', async ({ request }) => {
  36  |     const res = await request.get(`${BASE}/ping`);
  37  |     expect(res.status()).toBe(200);
  38  |     const text = (await res.text()).toUpperCase();
  39  |     expect(text).toContain('PONG');
  40  |   });
  41  | 
  42  |   test('GET /api/nonexistent returns JSON 404', async ({ request }) => {
  43  |     const res = await request.get(`${BASE}/api/nonexistent-endpoint`);
  44  |     expect(res.status()).toBe(404);
  45  |     const body = await res.json().catch(() => null);
  46  |     expect(body).toBeTruthy();
  47  |   });
  48  | });
  49  | 
  50  | test.describe('Frontend shell', () => {
  51  |   test('GET / returns HTML with the Vite bundle and a root element', async ({ request }) => {
  52  |     const res = await request.get(`${BASE}/`);
  53  |     expect(res.status()).toBe(200);
  54  |     const html = await res.text();
  55  |     expect(html).toContain('<div id="root"');
  56  |     // Vite preview ships a module script built from src/main.jsx
  57  |     expect(html).toMatch(/<script[^>]+type="module"/);
  58  |   });
  59  | 
  60  |   test('Unknown route serves the SPA shell (client-side router takes over)', async ({ request }) => {
  61  |     const res = await request.get(`${BASE}/definitely-not-a-route-xyz`);
  62  |     expect(res.status()).toBe(200);
  63  |     const html = await res.text();
  64  |     expect(html).toContain('<div id="root"');
  65  |   });
  66  | 
  67  |   // DS-2 — Kelion Studio route must be served by the SPA shell so the
  68  |   // client router can mount <KelionStudio />. The Monaco bundle itself
  69  |   // is lazy-loaded and not worth asserting here; what we DO care about
  70  |   // is that a direct page-load of /studio (e.g. a bookmarked URL)
  71  |   // doesn't 404 or redirect away from the shell.
  72  |   test('GET /studio serves the SPA shell so client router can mount KelionStudio', async ({ request }) => {
  73  |     const res = await request.get(`${BASE}/studio`);
  74  |     expect(res.status()).toBe(200);
  75  |     const html = await res.text();
  76  |     expect(html).toContain('<div id="root"');
  77  |     expect(html).toMatch(/<script[^>]+type="module"/);
  78  |   });
  79  | });
  80  | 
  81  | test.describe('Kelion Studio API (DS-1 / DS-3) wiring', () => {
  82  |   // All /api/studio/* routes sit behind requireAuth; with no session
  83  |   // cookie the server must 401 and (crucially) not leak a stack trace
  84  |   // via the JSON body. These tests guard against accidentally making
  85  |   // the router public or letting a handler throw on the unauth path.
  86  |   test('GET /api/studio/usage rejects anonymous callers with JSON 401', async ({ request }) => {
  87  |     const res = await request.get(`${BASE}/api/studio/usage`);
  88  |     expect(res.status()).toBe(401);
  89  |     const body = await res.json().catch(() => null);
  90  |     expect(body).toBeTruthy();
  91  |     // Error shape is stable — UI (KelionStudio.jsx) shows the message
  92  |     // verbatim in a toast, so changes here are user-visible.
  93  |     expect(typeof body.error).toBe('string');
  94  |     expect(body.error.length).toBeGreaterThan(0);
  95  |     // No stack trace should ever bleed through.
  96  |     expect(JSON.stringify(body)).not.toMatch(/\bat [A-Za-z]+\s*\([^)]*\.js:/);
  97  |   });
  98  | 
  99  |   test('GET /api/studio/workspaces rejects anonymous callers with JSON 401', async ({ request }) => {
  100 |     const res = await request.get(`${BASE}/api/studio/workspaces`);
  101 |     expect(res.status()).toBe(401);
  102 |     const body = await res.json().catch(() => null);
  103 |     expect(body).toBeTruthy();
  104 |     expect(typeof body.error).toBe('string');
  105 |   });
  106 | });
  107 | 
  108 | test.describe('Gemini Live token endpoint (Stage 1 precondition)', () => {
  109 |   test('Default (aistudio) returns a token (prod) or honest 503 (unconfigured CI)', async ({ request }) => {
  110 |     // The default backend is AI Studio (see server/src/routes/realtime.js).
  111 |     // It uses GEMINI_API_KEY to mint an ephemeral token via the
  112 |     // generativelanguage.googleapis.com API.
  113 |     //
  114 |     // Shape depends on deployment:
  115 |     //   - Production (GEMINI_API_KEY set): 200 with backend='aistudio',
  116 |     //     a token string, and a setup block.
  117 |     //   - CI / fresh dev box (no key): 503 with a clear error.
> 118 |     const res = await request.get(`${BASE}/api/realtime/gemini-token?lang=en-US`);
      |                               ^ Error: apiRequestContext.get: connect ECONNREFUSED 127.0.0.1:5173
  119 |     if (res.status() === 503) {
  120 |       const body = await res.json();
  121 |       expect(body.error).toMatch(/GEMINI_API_KEY/i);
  122 |       return;
  123 |     }
  124 |     expect(res.status()).toBe(200);
  125 |     const body = await res.json();
  126 |     expect(body.backend).toBe('aistudio');
  127 |     expect(typeof body.token).toBe('string');
  128 |     expect(body.token.length).toBeGreaterThan(0);
  129 |   });
  130 | 
  131 |   test('Forcing ?backend=vertex exercises the Vertex AI path', async ({ request }) => {
  132 |     // On CI neither GOOGLE_CLOUD_PROJECT nor GCP_SERVICE_ACCOUNT_JSON
  133 |     // is set → 503 is the honest response. In production with the project
  134 |     // configured we accept a 200 with token=null and a setup block.
  135 |     const res = await request.get(`${BASE}/api/realtime/gemini-token?lang=en-US&backend=vertex`);
  136 |     if (res.status() === 503) {
  137 |       const body = await res.json();
  138 |       expect(body.error).toMatch(/Vertex backend is unconfigured/i);
  139 |       return;
  140 |     }
  141 |     expect(res.status()).toBe(200);
  142 |     const body = await res.json();
  143 |     expect(body.backend).toBe('vertex');
  144 |     expect(body.token).toBeNull();
  145 |     expect(body.setup).toBeTruthy();
  146 |     expect(typeof body.setup.systemInstruction.parts[0].text).toBe('string');
  147 |     expect(body.setup.model).toMatch(
  148 |       /^projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/.+$/,
  149 |     );
  150 |   });
  151 | });
  152 | 
```