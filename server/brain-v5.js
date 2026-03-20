// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v5.0
// GPT-5.4 Tool Calling (primary) + Gemini Flash Quality Gate
// Hybrid routing: simple → Gemini (free), complex → GPT-5.4
// Max 2 tool rounds — prevents infinite loops
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");
const { MODELS } = require("./config/models");
const { buildSystemPrompt, buildNewbornPrompt } = require("./persona");
const { getPatternsText, recordUserInteraction, getProactiveSuggestion } = require("./k1-meta-learning");
const { selfEvaluate, getQualityHints } = require("./k1-performance");

// Reuse tool definitions and executor from V4 — no duplication
const { TOOL_DEFINITIONS } = require("./brain-v4");

// Lazy-load executeTool to avoid circular issues
let _executeTool = null;
function getExecuteTool() {
  if (!_executeTool) {
    // executeTool is not exported from brain-v4, so we inline a require of the module's internal
    // Actually, we need to export it. For now, we re-require and extract thinkV4 module.
    // The executeTool in brain-v4 is module-scoped. We'll export it from brain-v4.
    // WORKAROUND: We need to make brain-v4 export executeTool. See the modification below.
    const brainV4 = require("./brain-v4");
    _executeTool = brainV4.executeTool;
  }
  return _executeTool;
}

// ── Convert tool definitions to OpenAI format ──
function toOpenAITools(defs) {
  return defs.map((d) => ({
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: d.input_schema,
    },
  }));
}

// ── Convert tool definitions to Gemini format (for simple message routing) ──
function toGeminiTools(defs) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.input_schema,
  }));
}

// ── Complexity router: decides if a message is simple or complex ──
function classifyComplexity(message, _history) {
  const lower = (message || "").toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Simple messages → route to Gemini Flash (free)
  const simplePatterns = [
    /^(salut|bună|hey|hi|hello|hei|ciao|yo)\b/i,
    /^(bine|ok|da|nu|mersi|mulțumesc|mulțam|thx|thanks)\b/i,
    /^(ce faci|cum ești|ce mai faci|how are you)\??$/i,
    /^(ok|da|nu|sure|yes|no|mhm|ahh|aaa)$/i,
  ];
  if (simplePatterns.some((p) => p.test(lower))) return "simple";
  if (wordCount <= 3 && !lower.includes("?")) return "simple";

  // Complex messages → route to GPT-5.4 (tool calling)
  const toolTriggers = [
    /\b(caută|search|find|google)\b/i,
    /\b(vrem[ea]|meteo|weather|temperatură|grad)\b/i,
    /\b(genere|creează|create|generate|desenează|draw)\b/i,
    /\b(imagine|image|photo|foto|picture)\b/i,
    /\b(traduce|translate|traducere)\b/i,
    /\b(calculează|calculate|calcul)\b/i,
    /\b(email|mail|trimite)\b/i,
    /\b(calendar|programează|meeting|întâlnire)\b/i,
    /\b(task|todo|sarcină|trebuie)\b/i,
    /\b(cod|code|program|script|debug|fix)\b/i,
    /\b(analiză|analyze|inspect|check)\b/i,
    /\b(trading|crypto|btc|eth|piață|market)\b/i,
    /\b(știri|news|noutăți)\b/i,
    /\b(radio|muzică|music|play)\b/i,
    /\b(hartă|map|locație|location)\b/i,
    /\b(quiz|test|exercițiu|lecție)\b/i,
    /\b(pdf|docx|xlsx|pptx|document|spreadsheet|presentation)\b/i,
    /\b(diagnostic|obd|mașin[aă]|car)\b/i,
    /\b(rețetă|recipe|gătit|cooking)\b/i,
    /\b(medical|mri|ct|xray|doză|dose)\b/i,
    /\b(osciloscop|spectro|pcb|circuit|thermal)\b/i,
    // Date live — INTOTDEAUNA la GPT-5.4 cu function calling, NU la Gemini
    /\b(acum|azi|live|real.?time|current|latest|recent)\b/i,
    /\b(temperatura|temperature|temp)\b/i,
    /\b(pret|price|curs|exchange|rate)\b/i,
    /\b(cutremur|earthquake|seism)\b/i,
    /\b(avion|zbor|flight|trafic|traffic|tren|train)\b/i,
    /\b(aer|air|quality|pollution|iss|satellite|spatiu|space)\b/i,
    /\b(bitcoin|ethereum|crypto|stock|actiune|burs)\b/i,
    /\b(sport|fotbal|meci|score|rezultat)\b/i,
  ];
  if (toolTriggers.some((p) => p.test(lower))) return "complex";


  // Medium-length questions → complex (might need search)
  if (lower.includes("?") && wordCount > 5) return "complex";
  if (wordCount > 15) return "complex";

  // Default: simple for short messages
  return wordCount <= 8 ? "simple" : "complex";
}

// ── Strip leaked internal tags from AI responses ──
function stripLeakedTags(text) {
  if (!text) return text;
  let r = text;
  // Tool code blocks that leak
  r = r.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, "");
  r = r.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  r = r.replace(/<function_call>[\s\S]*?<\/function_call>/gi, "");
  // System instruction blocks
  r = r.replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, "");
  r = r.replace(/\[LEARNED PATTERNS\][\s\S]*?\[\/LEARNED PATTERNS\]\s*/gi, "");
  r = r.replace(/\[SELF-EVAL HINTS\][\s\S]*?\[\/SELF-EVAL HINTS\]\s*/gi, "");
  r = r.replace(/\[CONTEXT SWITCH\][^\n]*\n?/gi, "");
  r = r.replace(/\[PROACTIVE\][\s\S]*?\[\/PROACTIVE\]\s*/gi, "");
  r = r.replace(/\[EMOTIONAL CONTEXT\][^\n]*\n?/gi, "");
  r = r.replace(/\[CURRENT DATE & TIME\][^\n]*\n?/gi, "");
  r = r.replace(/\[USER LOCATION\][^\n]*\n?/gi, "");
  r = r.replace(/\[REZULTATE CAUTARE WEB REALE\][\s\S]*?Citeaza sursele\.\s*/gi, "");
  r = r.replace(/\[DATE METEO REALE\][^\n]*\n?/gi, "");
  r = r.replace(/\[CONTEXT DIN MEMORIE\][^\n]*\n?/gi, "");
  // Raw JSON tool results that leak
  r = r.replace(/```json\s*\{[^}]*"functionCall"[\s\S]*?```/gi, "");
  return r.trim();
}

// ── Extract monitor data from tool results — GENERIC, detectează orice conținut vizual ──
const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'<>]+(?:\.(?:jpg|jpeg|png|gif|webp|svg|bmp)|(?:pollinations\.ai|dalle\.com|oaidalleapiprodscus\.blob\.core\.windows\.net|cdn\.openai\.com|midjourney\.com|stability\.ai|ideogram\.ai|firefly\.adobe\.com)[^\s"'<>]*)/i;
const VIDEO_URL_PATTERN = /https?:\/\/(?:www\.)?(?:youtube\.com\/embed|youtu\.be|vimeo\.com\/video|player\.vimeo\.com)[^\s"'<>]*/i;
const MAP_URL_PATTERN = /https?:\/\/[^\s"'<>]*(?:openstreetmap\.org|maps\.google\.com|leaflet)[^\s"'<>]*/i;
const AUDIO_URL_PATTERN = /https?:\/\/[^\s"'<>]*\.(?:mp3|ogg|aac|m3u8|stream)[^\s"'<>]*/i;

function _scanForVisual(obj, depth) {
  if (depth > 4 || !obj || typeof obj !== 'object') return null;
  // Check known property names first (fast path)
  const knownMap = {
    imageUrl: 'image', image_url: 'image', imageURL: 'image', img: 'image', url: null,
    monitorHTML: 'html', html: 'html', monitorContent: 'html',
    monitorURL: 'url', mapURL: 'map', videoURL: 'video', youtubeURL: 'video',
    radioURL: 'audio', streamUrl: 'audio', audioUrl: 'audio',
  };
  for (const [key, type] of Object.entries(knownMap)) {
    const val = obj[key];
    if (typeof val !== 'string' || !val) continue;
    if (type === 'html' && val.includes('<')) return { content: val, type: 'html' };
    if (type === 'image' || (type === null && IMAGE_URL_PATTERN.test(val))) return { content: val, type: 'image' };
    if (type === 'video') return { content: val, type: 'video' };
    if (type === 'audio') return { content: val, type: 'audio' };
    if (type === 'map') return { content: val, type: 'map' };
    if (type === 'url') return { content: val, type: 'url' };
  }
  // Generic scan: check ALL string values for visual patterns
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.length > 10) {
      if (IMAGE_URL_PATTERN.test(val)) return { content: val, type: 'image' };
      if (VIDEO_URL_PATTERN.test(val)) return { content: val, type: 'video' };
      if (MAP_URL_PATTERN.test(val)) return { content: val, type: 'map' };
      if (AUDIO_URL_PATTERN.test(val)) return { content: val, type: 'audio' };
      if (val.includes('<!DOCTYPE') || (val.includes('<html') && val.includes('</html>'))) return { content: val, type: 'html' };
    } else if (val && typeof val === 'object') {
      const nested = _scanForVisual(val, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function extractMonitor(toolResults) {
  for (const r of toolResults) {
    if (r.result && typeof r.result === 'object') {
      const found = _scanForVisual(r.result, 0);
      if (found) return found;
    }
  }
  return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// Call OpenAI GPT-5.4 with tool calling
// ═══════════════════════════════════════════════════════════════
async function callOpenAI(messages, systemPrompt, tools, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const body = {
    model: model || MODELS.OPENAI_CHAT,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    max_completion_tokens: 4096,
    temperature: 0.7,
  };

  // Only include tools if provided and non-empty
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  // ── Timeout 25s — previne agățarea indefinită a request-ului ──
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const errText = await r.text().catch(() => "unknown");
      throw new Error(`OpenAI API ${r.status}: ${errText.substring(0, 300)}`);
    }

    return await r.json();
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") throw new Error("OpenAI timeout (25s) — falling back to Gemini");
    throw e;
  }
}


// ── Claude (Anthropic) — reasoning profund ──
async function callClaude(prompt, systemPrompt, modelId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const model = modelId || MODELS.CLAUDE || 'claude-opus-4-5';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!r.ok) {
      const errText = await r.text().catch(() => 'unknown');
      throw new Error(`Claude API ${r.status}: ${errText.substring(0, 200)}`);
    }
    const data = await r.json();
    return data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '';
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Claude timeout (20s)');
    throw e;
  }
}

// ── DeepSeek — excelent la cod, matematică, logică ──
async function callDeepSeek(prompt, systemPrompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELS.DEEPSEEK || 'deepseek-chat',
        max_tokens: 2048,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      const errText = await r.text().catch(() => 'unknown');
      throw new Error(`DeepSeek ${r.status}: ${errText.substring(0, 200)}`);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('DeepSeek timeout (20s)');
    throw e;
  }
}

// ── Gemini Pro — raționament premium, documente lungi ──
async function callGeminiPro(prompt, systemPrompt) {
  const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!gKey) throw new Error('GOOGLE_AI_KEY not configured');

  const model = MODELS.GEMINI_PRO || 'gemini-2.5-pro-preview-06-05';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!r.ok) {
      const errText = await r.text().catch(() => 'unknown');
      throw new Error(`Gemini Pro ${r.status}: ${errText.substring(0, 200)}`);
    }
    const data = await r.json();
    return (data.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('') || '';
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Gemini Pro timeout (30s)');
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// SUPER THINK — AI Pipeline Colaborativ (Interconectare Reală)
//
// FLUX:
// 1. GROQ (100ms) → Analizează cererea, face plan, identifică ce trebuie
// 2. DeepSeek + Claude (paralel) → Fiecare vede planul Groq și adaugă
//    - DeepSeek: calcule, cod, logică formală
//    - Claude: raționament profund, nuanțe, analiză critică
// 3. GPT-5.4 → Vede TOT (plan + contribuții) → Construiește răspunsul final
//    cu tool calling dacă e nevoie (search, imagine, hartă)
// 4. Gemini Pro → Verifică, corectează, validează răspunsul final
// ═══════════════════════════════════════════════════════════════
async function superThink(message, systemPrompt, history, onProgress = null) {
  logger.info({ component: 'SuperThink' }, '🧠🧠🧠 AI PIPELINE — Collaborative chain started');
  const shortPrompt = systemPrompt.substring(0, 3000);
  const pipeline = { steps: [], startTime: Date.now() };
  const progress = (step, detail) => { if (onProgress) try { onProgress(step, detail); } catch (_) {} };

  // ═══ STEP 1: GROQ — Analiză ultra-rapidă (planificator) ═══
  let groqPlan = null;
  if (process.env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: MODELS.GROQ_PRIMARY || 'llama-3.3-70b-versatile',
          max_tokens: 500,
          messages: [{ role: 'system', content: 'Ești un PLANIFICATOR AI. Analizezi cererea userului și faci un plan scurt.' },
            { role: 'user', content: `Cerere user: "${message}"\n\nFă un plan SCURT (max 5 puncte):\n1. Ce tip de cerere e?\n2. Ce FAPTE trebuie verificate?\n3. Ce CALCULE/LOGICĂ?\n4. Ce NUANȚE/PERSPECTIVE?\n5. Ce FORMAT ideal?\n\nRăspunde scurt, direct.` }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const d = await r.json();
        groqPlan = d.choices?.[0]?.message?.content || null;
        progress('planning', 'Groq a creat planul de analiză');
        pipeline.steps.push({ ai: 'Groq', role: 'Planificator', ms: Date.now() - pipeline.startTime });
      }
    } catch (e) { logger.warn({ component: 'SuperThink' }, `Groq plan failed: ${e.message}`); }
  }
  if (!groqPlan) groqPlan = `Cerere: "${message}" — răspunde complet și precis.`;

  // ═══ STEP 2: Claude Haiku (fast+cheap) + DeepSeek PARALEL ═══
  const step2Start = Date.now();
  const parallelTasks = [];
  const parallelLabels = [];

  // Claude Haiku (50x cheaper than Opus, 10x faster) — lead reasoner
  if (process.env.ANTHROPIC_API_KEY) {
    parallelLabels.push('Claude-Haiku');
    parallelTasks.push(
      callClaude(
        `PLAN:\n${groqPlan}\n\nCERERE: "${message}"\n\nGândește PAS CU PAS: Înțelege → Analizează → Raționează → Concluzionează.\nRăspunde natural, max 400 cuvinte.`,
        shortPrompt,
        MODELS.CLAUDE_FAST || 'claude-3-5-haiku-20241022'
      ).catch(e => `[Claude indisponibil: ${e.message}]`)
    );
  }

  // DeepSeek — specialist calcule, cod, date
  if (process.env.DEEPSEEK_API_KEY) {
    parallelLabels.push('DeepSeek');
    parallelTasks.push(
      callDeepSeek(
        `PLAN:\n${groqPlan}\n\nCERERE: "${message}"\n\nContribuie DOAR cu calcule exacte, cod, date verificabile. Max 300 cuvinte.`,
        shortPrompt
      ).catch(e => `[DeepSeek indisponibil: ${e.message}]`)
    );
  }

  const parallelResults = await Promise.allSettled(parallelTasks);
  const contributions = {};
  parallelResults.forEach((r, i) => {
    contributions[parallelLabels[i]] = r.status === 'fulfilled'
      ? (typeof r.value === 'string' ? r.value : String(r.value)).substring(0, 2000)
      : `[${parallelLabels[i]} failed]`;
  });
  pipeline.steps.push({ ai: parallelLabels.join('+'), role: 'Specialists', ms: Date.now() - step2Start });
  progress('analyzing', `${parallelLabels.join(' + ')} au terminat analiza`);

  // ═══ STEP 3: GPT-5.4 — Constructor final (vede TOTUL) ═══
  let finalResponse = null;
  const step3Start = Date.now();
  const contributionsText = Object.entries(contributions)
    .map(([name, text]) => `\n[${name}]\n${text}`).join('\n');

  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODELS.OPENAI_CHAT || 'gpt-5.4',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: shortPrompt },
            { role: 'user', content: `${message}\n\n---\n[INTERN]\n[PLAN] ${groqPlan}\n${contributionsText}\n\nCONSTRUIEȘTE răspunsul final integrând contribuțiile. NU menționa alte AI-uri. Adaugă [EMOTION:xxx] [GESTURE:xxx] la final.` },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const d = await r.json();
        finalResponse = d.choices?.[0]?.message?.content || null;
        pipeline.steps.push({ ai: 'GPT-5.4', role: 'Constructor', ms: Date.now() - step3Start });
        progress('constructing', 'GPT-5.4 a construit răspunsul final');
      }
    } catch (e) { logger.warn({ component: 'SuperThink' }, `GPT final failed: ${e.message}`); }
  }

  // Fallback: Gemini Flash
  if (!finalResponse) {
    try {
      finalResponse = await callGeminiWithSearch(
        `${message}\n\n[INTERN]\n[PLAN] ${groqPlan}\n${contributionsText}\n\nConstruiește răspunsul final. NU menționa sursa.`,
        shortPrompt, history
      ).then(r => r.text);
    } catch (_) { /* use contributions directly */ }
  }

  if (!finalResponse) {
    finalResponse = Object.values(contributions).filter(v => !v.startsWith('[')).join('\n\n') || groqPlan;
  }

  // Step 4 (Gemini Pro validator) REMOVED — Quality Gate already handles verification

  const totalMs = Date.now() - pipeline.startTime;
  logger.info({ component: 'SuperThink', totalMs, steps: pipeline.steps.length },
    `🧠✅ PIPELINE COMPLETE (${totalMs}ms) — ${pipeline.steps.map(s => s.ai).join(' → ')}`);

  return {
    text: finalResponse,
    engine: 'super-think-pipeline',
    pipeline: pipeline.steps,
    totalMs,
    providers: pipeline.steps.map(s => s.ai),
  };
}


// ── Quality Gate: Gemini Flash verifies critical GPT-5.4 responses ──

// ═══════════════════════════════════════════════════════════════
// INTENT DETECTION — Ce vrea userul? Fiecare intenție → tool potrivit
// ═══════════════════════════════════════════════════════════════
function detectIntent(message, mediaData) {
  if (mediaData?.imageBase64) return 'vision';          // imagine → GPT vision
  const m = message.toLowerCase();
  if (/\b(vrem[ea]|meteo|weather|temperatur[ăa]?|ploaie|soare|frig|cald|grad[e]?|gradele|afar[aă]|nivelul\s+temperatur|cum\s+e\s+afar)\b/i.test(m)) return 'weather';
  if (/ultima\s+(versiune|noutate|stire)|ce\s+(mai)?\s+nou|știri|stiri|news|azi\s+a|lansat\s+(acum|azi)|apărut|aparut|pret.*actual|cum\s+sta|rezultat\s+final|scor\s+final|clasament|cine\s+a\s+(câștigat|castigat|câştigat)|ce\s+(s-?a|e)\s+(întâmplat|intamplat)|recent\s+a|din\s+\d{4}/i.test(m)) return 'web_search';
  if (/harta|navigheaz|rut[ăa]|genereaz[ăa]\s+(imagine|pict|foto)|arată.*pe\s+hartă|arat[ăa].*pe\s+harta/i.test(m)) return 'tool_use';
  if (/calculeaz[ăa]\s+integral|integr[ăa]l[ăa]|rezolv[ăa]\s+ecuaţia|demonstreaz[ăa]\s+teorema|analiz[ăa].*complet[ăa]|scrie\s+cod\s+complet\s+pentru|arhitectur[ăa]\s+sistem|documentaţie\s+tehnic|full.?stack/i.test(m)) return 'deep_reasoning';
  return 'chat';
}

// ═══════════════════════════════════════════════════════════════
// GEMINI WITH GOOGLE SEARCH GROUNDING — Date actuale fără API keys externe
// Nativ în Gemini. Fără pre-fetch, fără fallback chain.
// ═══════════════════════════════════════════════════════════════
async function callGeminiWithSearch(message, systemPrompt, history, opts = {}) {
  const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!gKey) throw new Error('GOOGLE_AI_KEY not configured');

  const enableSearch = opts.enableSearch === true;
  // gemini-2.0-flash suporta search grounding; pentru chat fara search folosim gemini-2.5-flash
  const model = enableSearch ? 'gemini-2.0-flash' : (MODELS.GEMINI_CHAT || 'gemini-2.5-flash');


  const contents = [
    ...(history || []).slice(-10).map(h => ({
      role: h.role === 'ai' || h.role === 'assistant' || h.role === 'model' ? 'model' : 'user',
      parts: [{ text: typeof h.content === 'string' ? h.content : (h.parts?.[0]?.text || '') }],
    })).filter(h => h.parts[0].text), // elimina intrari goale
    { role: 'user', parts: [{ text: message }] },
  ];

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 2048, temperature: 0.7, topP: 0.95 },
  };

  if (enableSearch) {
    // google_search (snake_case) — format corect pentru Gemini Grounding API
    body.tools = [{ google_search: {} }];
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }
  ).finally(() => clearTimeout(timer));

  if (!r.ok) {
    const errText = await r.text().catch(() => 'unknown');
    throw new Error(`Gemini ${model} ${r.status}: ${errText.substring(0, 300)}`);
  }

  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('');
  if (!text) throw new Error('Gemini returned empty response');

  const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .slice(0, 3).map(c => c.web?.title ? `[${c.web.title}](${c.web.uri})` : '').filter(Boolean).join(' | ');

  return { text, sources, engine: enableSearch ? 'gemini-search-grounding' : 'gemini-flash' };
}


// ═══════════════════════════════════════════════════════════════
// PRE-FETCH Real-time data (weather only — search e acum via Gemini Search Grounding)
// ═══════════════════════════════════════════════════════════════
async function getRealtimeContext(message, brain, userId, geo) {
  const lower = (message || '').toLowerCase();
  const parts = [];

  // ── Weather (GPS sau detectare oras din mesaj) ──

  const weatherKeyword = lower.match(/\b(?:vrem[ea]|meteo|weather|temperatura|grad[e]?|ploaie|soare|frig|cald)\b/i);
  if (weatherKeyword) {
    try {
      let lat, lng, locationName;

      if (geo?.lat && geo?.lng) {
        // 1. Prioritate: coordonate GPS reale din request
        lat = geo.lat;
        lng = geo.lng;
        // Reverse geocode pentru a afla numele locatiei
        const rgUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lng}`;
        const rgCtrl = new AbortController();
        const rgTimer = setTimeout(() => rgCtrl.abort(), 4000);
        const rgR = await fetch(rgUrl, { signal: rgCtrl.signal }).finally(() => clearTimeout(rgTimer));
        if (rgR.ok) {
          const rgData = await rgR.json().catch(() => ({}));
          locationName = rgData.results?.[0]?.name || `${lat.toFixed(2)},${lng.toFixed(2)}`;
        } else {
          locationName = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        }
      } else {
        // 2. Detectare oras din mesaj
        const cityMatch = message.match(/(?:în|in|la|at|for|pentru|din)\s+([A-ZĂÎÂȘȚ][a-zA-ZăîâșțĂÎÂȘȚ\s-]{2,25}?)(?=[.,?!]|\s+(?:e|este|acum|azi|mâine)|$)/i);
        if (!cityMatch) {
          // Nu stim locatia — brain CERE informatia, nu skip
          parts.push('[LOCATIE NECUNOSCUTA]\nUserul a cerut date meteo dar nu ai putut determina locatia.\nCere-i direct: "În ce oraș ești?" sau "Activează GPS-ul din browser pentru a-ți da vremea exactă." NU genera date meteo inventate.');
          return parts.join('\n\n');
        }
        const city = cityMatch[1].trim();
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ro`;
        const geoCtrl = new AbortController();
        const geoTimer = setTimeout(() => geoCtrl.abort(), 4000);
        const geoR = await fetch(geoUrl, { signal: geoCtrl.signal }).finally(() => clearTimeout(geoTimer));
        if (!geoR.ok) return parts.length > 0 ? parts.join('\n\n') : null;
        const geoData = await geoR.json();
        const loc = geoData.results?.[0];
        if (!loc) return parts.length > 0 ? parts.join('\n\n') : null;
        lat = loc.latitude;
        lng = loc.longitude;
        locationName = `${loc.name}, ${loc.country}`;
      }

      // Apel meteo cu coordonatele finale
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&wind_speed_unit=kmh&timezone=auto`;
      const wCtrl = new AbortController();
      const wTimer = setTimeout(() => wCtrl.abort(), 5000);
      const wR = await fetch(weatherUrl, { signal: wCtrl.signal }).finally(() => clearTimeout(wTimer));
      if (wR.ok) {
        const wData = await wR.json();
        const c = wData.current;
        const codes = { 0: 'Cer senin☀️', 1: 'Parțial noros🌤️', 2: 'Noros⛅', 3: 'Acoperit☁️', 45: 'Ceatos🌫️', 48: 'Ceatos🌫️', 51: 'Burniță🌦️', 61: 'Ploaie🌧️', 63: 'Ploaie moderată🌧️', 65: 'Ploaie abundentă🌧️', 71: 'Ninsoare🌨️', 80: 'Averse🌦️', 95: 'Furtună⛈️' };
        const desc = codes[c?.weather_code] || 'Variabil';
        parts.push(`[DATE METEO REALE — ${locationName}]\nTemperatură: ${c?.temperature_2m}°C (resimțit ${c?.apparent_temperature}°C)\nCondiții: ${desc}\nUmiditate: ${c?.relative_humidity_2m}%\nVânt: ${c?.wind_speed_10m} km/h\nPrecipitații: ${c?.precipitation}mm`);
      }
    } catch (_) { /* non-blocking */ }
  }

  // ── Web Search (profesional — prin brain._search care are toate API-urile) ──
  // ── Web Search — IMPLICIT MEREU (nu condiționat de keywords) ──
  // Skip doar pentru conversații simple fără conținut factual
  const isSimpleChat = lower.match(/^(?:salut|buna|bună|hello|hi\b|hey\b|ok\b|da\b|nu\b|bine|super|mulțumesc|multumesc|mersi|merci|thanks|thx|bye|pa|la\s+revedere|cum\s+ești|cum\s+esti|ce\s+mai\s+faci|cine\s+ești|cine\s+esti|te\s+rog\s+(?:fa|scrie|calcul|explic|tradu)|execut|calculez|scrie|genereaz|explicat|traduc|analiz)\b/i);
  const isShort = message.trim().split(/\s+/).length < 5; // mesaje sub 5 cuvinte - probabil conversationale
  const shouldSearch = !isSimpleChat && !isShort;


  if (shouldSearch && brain && typeof brain._search === 'function') {
    try {
      const searchQuery = message.replace(/^(?:caută|cauta|search|google)\s+/i, '').trim();
      let searchResult = await Promise.race([
        brain._search(searchQuery),
        new Promise((_, reject) => setTimeout(() => reject(new Error('search timeout')), 8000)),
      ]);

      // ── Fallback: Gemini Search Grounding (Google Search built-in, fara cheie externa) ──
      if ((!searchResult || (typeof searchResult === 'string' && searchResult.length < 20)) &&
        (process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY)) {
        const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        const gModel = 'gemini-2.5-flash-preview-04-17';
        const gCtrl = new AbortController();
        const gTimer = setTimeout(() => gCtrl.abort(), 8000);
        try {
          const gR = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${gKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: searchQuery }] }],
              tools: [{ googleSearch: {} }],
              generationConfig: { maxOutputTokens: 800, temperature: 0.3 },
            }),
            signal: gCtrl.signal,
          }).finally(() => clearTimeout(gTimer));
          if (gR.ok) {
            const gData = await gR.json();
            const groundedText = (gData.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('');
            const sources = (gData.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
              .slice(0, 3).map(c => `- ${c.web?.title}: ${c.web?.uri}`).join('\n');
            if (groundedText) searchResult = groundedText + (sources ? `\n\nSurse:\n${sources}` : '');
          }
        } catch (_) { /* grounding unavailable */ }
      }

      if (searchResult && typeof searchResult === 'string' && searchResult.length > 20) {
        parts.push(`[REZULTATE CĂUTARE WEB REALE]\n${searchResult.substring(0, 2000)}`);
      } else if (searchResult && typeof searchResult === 'object') {
        const txt = JSON.stringify(searchResult, null, 2).substring(0, 2000);
        if (txt.length > 20) parts.push(`[REZULTATE CĂUTARE WEB REALE]\n${txt}`);
      }
    } catch (_) {
      parts.push('[SEARCH INDISPONIBIL]\nNu pot accesa internetul în acest moment. Oferă ce știi, marcând clar că nu sunt date actuale.');
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}



// ── Parse avatar commands from AI text response ──
function parseAvatarCommands(text) {
  if (!text) return {};
  const emotion = text.match(/\[EMOTION:([^\]]+)\]/i)?.[1]?.trim().toLowerCase() || null;
  const gestures = [...text.matchAll(/\[GESTURE:([^\]]+)\]/gi)].map(m => m[1].trim().toLowerCase());
  const bodyActions = [...text.matchAll(/\[BODY:([^\]]+)\]/gi)].map(m => m[1].trim());
  const gaze = text.match(/\[GAZE:([^\]]+)\]/i)?.[1]?.trim().toLowerCase() || null;
  const actions = [...text.matchAll(/\[ACTION:([^\]]+)\]/gi)].map(m => m[1].trim().toLowerCase());

  // Parse [MONITOR:type]...[/MONITOR] or [MONITOR]...[/MONITOR] HTML/image content
  let monitor = { content: null, type: null };
  const monitorMatch = text.match(/\[MONITOR(?::([\w]+))?\]([\s\S]*?)\[\/MONITOR\]/i);
  if (monitorMatch) {
    const monType = monitorMatch[1]?.toLowerCase() || 'html';
    monitor = { content: monitorMatch[2].trim(), type: monType };
  }

  // Clean tags from user-visible text
  const cleanText = text
    .replace(/\[EMOTION:[^\]]+\]/gi, '')
    .replace(/\[GESTURE:[^\]]+\]/gi, '')
    .replace(/\[BODY:[^\]]+\]/gi, '')
    .replace(/\[GAZE:[^\]]+\]/gi, '')
    .replace(/\[ACTION:[^\]]+\]/gi, '')
    .replace(/\[MONITOR(?::[\w]+)?\][\s\S]*?\[\/MONITOR\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { emotion, gestures, bodyActions, gaze, actions, monitor, cleanText };
}


async function qualityGate(question, answer, domain) {
  // QA for critical domains + any response with low confidence indicators
  const criticalDomains = ["trading", "medical", "legal", "financial", "science", "education", "history"];
  if (!criticalDomains.includes(domain)) return { passed: true, corrected: null };

  try {
    const apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return { passed: true, corrected: null }; // Skip if no key

    const model = MODELS.GEMINI_QA || MODELS.GEMINI_CHAT || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const verifyPrompt = `You are a fact-checking Quality Gate. Verify this AI response for accuracy.
Question: "${question.substring(0, 300)}"
Answer: "${answer.substring(0, 800)}"

If the answer is accurate and complete, respond with EXACTLY: "QA_PASS"
If the answer contains errors or could be improved significantly, respond with a corrected version.
Be concise. Only correct factual errors, not style.`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: verifyPrompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
      }),
    });

    if (!r.ok) return { passed: true, corrected: null };

    const response = await r.json();
    const qaText = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (qaText.includes("QA_PASS")) {
      return { passed: true, corrected: null };
    }

    // QA suggests correction — use it if substantially different
    if (qaText.length > 20 && qaText.length < answer.length * 2) {
      logger.info({ component: "BrainV5" }, "🔍 Quality Gate: correction applied");
      return { passed: false, corrected: qaText };
    }

    return { passed: true, corrected: null };
  } catch (e) {
    logger.warn({ component: "BrainV5", err: e.message }, "Quality Gate failed (non-blocking)");
    return { passed: true, corrected: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN: thinkV5 — Hybrid routing + GPT-5.4 Tool Calling
// ═══════════════════════════════════════════════════════════════
async function thinkV5(
  brain,
  message,
  avatar,
  history,
  language,
  userId,
  conversationId,
  mediaData = {},
  isAdmin = false,
  onProgress = null,
) {
  brain.conversationCount++;
  const startTime = Date.now();
  brain._currentMediaData = mediaData || {};
  const executeTool = getExecuteTool();

  try {
    // ── 1. Quota check ──
    const quota = await brain.checkQuota(userId);
    if (!quota.allowed) {
      const upgradeMsg =
        language === "ro"
          ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
          : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
      return {
        enrichedMessage: upgradeMsg,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: { complexity: "simple", language },
        thinkTime: Date.now() - startTime,
        confidence: 1.0,
        agent: "v5-quota-block",
      };
    }

    // ── 1b. Semantic cache check (instant response for similar queries) ──
    const cachedResponse = await brain.checkSemanticCache(message, userId);
    if (cachedResponse) {
      brain.conversationCount++;
      return {
        ...cachedResponse,
        thinkTime: Date.now() - startTime,
        agent: `v5-semantic-cache`,
      };
    }

    // ── 2. Load memory + profile (parallel) ──
    const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
      brain.loadMemory(userId, "text", 20, message),
      brain.loadMemory(userId, "visual", 5, message),
      brain.loadMemory(userId, "audio", 5, message),
      brain.loadFacts(userId, 20),
      brain._loadProfileCached(userId),
    ]);
    const memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
    const profileContext = profile ? profile.toContextString() : "";

    // ── 3. Emotion detection (fast, no AI needed) ──
    const lower = message.toLowerCase();
    let emotionalTone = "neutral";
    let emotionHint = "";
    for (const [emo, { pattern, responseHint }] of Object.entries(
      brain.constructor.EMOTION_MAP || {},
    )) {
      if (pattern.test(lower)) {
        emotionalTone = emo;
        emotionHint = responseHint || "";
        break;
      }
    }
    const frustration = brain.constructor.detectFrustration
      ? brain.constructor.detectFrustration(message)
      : 0;
    if (frustration > 0.6) {
      emotionHint =
        "User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.";
    }

    // ── 3b. Context switch detection ──
    const topicKeywords = {
      trading: /\b(trade|trading|buy|sell|BTC|ETH|crypto|piață|preț|analiză|signal|RSI|MACD|invest|portofoliu|acțiuni|bursă|forex)\b/i,
      coding: /\b(code|coding|bug|error|function|deploy|API|server|git|commit|script|database|program)\b/i,
      news: /\b(news|știri|știre|politic|război|eveniment|actual|azi|ieri|breaking)\b/i,
      weather: /\b(vreme|meteo|weather|ploaie|soare|temperatură|grad|frig|cald)\b/i,
      music: /\b(muzică|music|song|cântec|artist|album|concert|playlist)\b/i,
      personal: /\b(eu|mine|viața|familie|sănătate|hobby|plan|sentiment|gândesc|simt)\b/i,
    };
    let currentTopic = "general";
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(message)) { currentTopic = topic; break; }
    }
    if (!brain._lastTopic) brain._lastTopic = "general";
    let contextSwitchHint = "";
    if (brain._lastTopic !== currentTopic && brain._lastTopic !== "general" && currentTopic !== "general") {
      contextSwitchHint = `\n[CONTEXT SWITCH] Userul a trecut de la ${brain._lastTopic} la ${currentTopic}. Ajustează-ți tonul și cunoștințele.`;
    }
    brain._lastTopic = currentTopic;

    // ── 4. Determine domain for Quality Gate ──
    let domain = "general";
    if (/trading|crypto|btc|eth|invest|piață/i.test(message)) domain = "trading";
    else if (/medical|mri|ct|doză|cancer|diagnostic/i.test(message)) domain = "medical";
    else if (/legal|lege|contract|gdpr|drept/i.test(message)) domain = "legal";
    else if (/financ|credit|impozit|salariu|roi|npv/i.test(message)) domain = "financial";

    // ── 5. Build system prompt with FULL context ──
    const geoBlock = mediaData.geo
      ? `\n[USER LOCATION] Lat: ${mediaData.geo.lat}, Lng: ${mediaData.geo.lng}${mediaData.geo.accuracy ? ` (accuracy: ${Math.round(mediaData.geo.accuracy)}m)` : ""}. Use this for weather, nearby places, and location-aware responses. DO NOT call any tool to get user location — you already have it. WHEN USER ASKS FOR WEATHER WITHOUT SPECIFYING A CITY → use THESE coordinates, DO NOT default to București.`
      : "";
    const memoryBlock = [profileContext, memoryContext].filter(Boolean).join(" || ");
    const emotionBlock = emotionHint
      ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}`
      : "";
    const now = new Date();
    // Dynamic timezone from GPS
    const userTZ = (() => {
      if (!mediaData.geo || !mediaData.geo.lng) return 'Europe/Bucharest';
      const lng = mediaData.geo.lng;
      if (lng < -100) return 'America/Los_Angeles';
      if (lng < -60) return 'America/New_York';
      if (lng < -30) return 'America/Sao_Paulo';
      if (lng < 0) return 'Europe/London';
      if (lng < 15) return 'Europe/Paris';
      if (lng < 30) return 'Europe/Bucharest';
      if (lng < 45) return 'Europe/Moscow';
      if (lng < 75) return 'Asia/Dubai';
      if (lng < 105) return 'Asia/Kolkata';
      if (lng < 120) return 'Asia/Shanghai';
      if (lng < 135) return 'Asia/Tokyo';
      return 'Pacific/Auckland';
    })();
    const dateTimeBlock = `\n[IMPORTANT — CURRENT DATE & TIME] Astazi este ${now.toLocaleDateString("ro-RO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ora ${now.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: userTZ })} (${userTZ}). ISO: ${now.toISOString()}. NU INVENTA alta data sau ora — foloseste EXACT ce scrie aici cand userul intreaba de timp, data, zi, ora.\n\n[CONVERSAȚIE INTELIGENTĂ — OBLIGATORIU]\nFii MEREU politicos, cald și inițiator de conversație. Nu da răspunsuri seci de 2 cuvinte.\n- La orice salut → răspunde cald + pune O întrebare naturală despre interlocutor\n- Învață DISCRET despre persoana din fața ta: ce face, ce îi place, cum se simte\n- Fii ca un PRIETEN INTELIGENT care chiar vrea să te cunoască\n- Conversația trebuie să curgă NATURAL — nu interoga, ci fii curios\n- Dacă userul spune ceva despre el → arată interes REAL, pune follow-up\n- NICIODATĂ nu da răspunsuri monosilabice (da, nu, ok, bine) — adaugă MEREU valoare\n- Folosește numele userului dacă îl știi\n- Adaptează limba 100% la cea a interlocutorului — conversație fluentă ÎN ORICE LIMBĂ`;
    const patternsBlock = getPatternsText();
    const qualityHints = getQualityHints();
    const proactiveHint = getProactiveSuggestion();
    let systemPrompt = process.env.NEWBORN_MODE === "true"
      ? buildNewbornPrompt(memoryBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint)
      : buildSystemPrompt(
        avatar,
        language,
        memoryBlock + emotionBlock + geoBlock + dateTimeBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint,
        "",
        null,
      );

    systemPrompt += `

## REGULI CHEIE
- NICIODATĂ nu renunța. Nu zici "nu pot" — ÎNTOTDEAUNA găsești o soluție (recall_tool → search_web → browse_page → discover_and_save_tool).
- Monitor: DOAR conținut vizual (imagini, hărți, charts, HTML). NICIODATĂ text pe monitor — text merge ca răspuns vorbit.
- PREFERĂ API-uri gratuite fără autentificare.
- Pentru imagini → ÎNTOTDEAUNA generate_image(), nu descrii în text.
- Ai 10 iterații de tool calling — folosește-le.
- Răspunde MEREU în limba userului, natural și conversațional.`;


    // ── 5b. Detect INTENT — fiecare tip de cerere → tool potrivit ──
    const intent = detectIntent(message, mediaData);
    logger.info({ component: "BrainV5", intent, domain }, `🧠 V5 intent: ${intent}`);

    // Weather + Tool use: delegare directă la V4 cu tool calling
    // V4 doar pentru OBD/scanner/diagnostic specializat — restul (harta, ISS etc.) merge la GPT-5.4
    if (intent === 'tool_use' && /\b(obd|diagnos|scanner|barcode|qr|osciloscop)\b/i.test(message)) {
      const { thinkV4 } = require('./brain-v4');
      return await thinkV4(brain, message, avatar, history || [], language, userId, conversationId, mediaData, isAdmin);
    }

    // ═══ SUPER THINK — AI Council pentru cereri complexe ═══
    // Activează pipeline-ul colaborativ: Groq→DeepSeek+Claude→GPT→Gemini Pro
    // SuperThink only for truly complex questions (>30 words + ?) — not casual chat
    const isDeepQuestion = intent === 'deep_reasoning' || (message.split(/\s+/).length > 30 && message.includes('?'));
    if (isDeepQuestion) {
      try {
        logger.info({ component: 'BrainV5' }, '🧠 Routing to SUPER THINK pipeline');
        const superResult = await superThink(message, systemPrompt, history, onProgress);
        if (superResult?.text) {
          const parsed = parseAvatarCommands(superResult.text);
          const cleanReply = stripLeakedTags(parsed.cleanText || superResult.text);
          // Learn from conversation
          if (brain.learnFromConversation) {
            brain.learnFromConversation(userId, message, cleanReply).catch(() => {});
          }
          return {
            enrichedMessage: cleanReply,
            enrichedContext: cleanReply,
            toolsUsed: [],
            engine: superResult.engine,
            pipeline: superResult.pipeline,
            providers: superResult.providers,
            emotion: parsed.emotion || 'neutral',
            gestures: parsed.gestures || [],
            bodyActions: parsed.bodyActions || [],
            gaze: parsed.gaze || null,
            actions: parsed.actions || [],
            monitor: parsed.monitor?.content ? parsed.monitor : { content: null, type: null },
            analysis: { complexity: 'deep_reasoning', language: language || 'ro' },
            thinkTime: Date.now() - startTime,
            confidence: 0.9,
            agent: `v5-${superResult.engine}`,
          };
        }
      } catch (e) {
        logger.warn({ component: 'BrainV5', err: e.message }, '⚠️ SuperThink failed, falling back to normal flow');
        // Fall through to normal GPT flow
      }
    }

    // ── 7. Prepare state ──
    const recentHistory = (history || []).slice(-20);
    const toolsUsed = [];
    const toolResults = [];
    let finalResponse = "";
    let totalTokens = 0;
    let engine = 'gemini-search-grounding';
    let monitorFromTools = null; 
    let gptMonitor = null; // Capturat din show_in_monitor apelat de GPT-5.4
    const MAX_TOOL_ROUNDS = 10; // Agentic loop: up to 10 tool iterations for complex tasks




    // ── 8a. GPT-5.4 PRIMAR — pentru toate intentiile ──────────────────────────
    const shouldTryGPT = !!process.env.OPENAI_API_KEY; // TOATE intentiile → GPT-5.4 cu procedura universala


    if (shouldTryGPT) {

      // ═══ Registry check SKIPPED — GPT has recall_tool via function calling ═══
      // Removed: duplicate programmatic recall before GPT (GPT calls recall_tool itself)
      let registryContext = '';



      // ═══ GPT-5.4 PATH — complex messages with tool calling ═══
      const openaiTools = toOpenAITools(TOOL_DEFINITIONS);

      // Build OpenAI message array
      const msgs = recentHistory.map((h) => ({
        role: h.role === "ai" ? "assistant" : h.role,
        content: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
      }));

      // Handle vision: if image provided, use content array format
      if (mediaData.imageBase64) {
        const userContent = [];
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${mediaData.imageMimeType || "image/jpeg"};base64,${mediaData.imageBase64}`,
          },
        });
        if (mediaData.isAutoCamera) {
          userContent.push({
            type: "text",
            text: "[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. " +
              "Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții). " +
              "Menționează DOAR: persoane (culori exacte de haine), pericole, text vizibil. " +
              "Dacă nu e nimic nou de spus, nu comenta imaginea deloc — răspunde normal la mesaj.",
          });
        }
        userContent.push({ type: "text", text: message });
        msgs.push({ role: "user", content: userContent });
      } else {
        msgs.push({ role: "user", content: registryContext ? message + registryContext : message });
      }

      // Tool calling loop — MAX 2 rounds
      let currentMsgs = msgs;
      const gptSystemPrompt = systemPrompt;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await callOpenAI(
          currentMsgs,
          gptSystemPrompt,
          round === 0 ? openaiTools : openaiTools, // Always provide tools
          mediaData.imageBase64 ? MODELS.OPENAI_VISION : MODELS.OPENAI_CHAT,
        );


        totalTokens += (response.usage?.total_tokens || 0);
        const choice = response.choices?.[0];

        if (!choice?.message) {
          logger.warn({ component: "BrainV5" }, "No choice in OpenAI response");
          break;
        }

        const msg = choice.message;

        // Check if GPT wants to call tools
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Execute all requested tools in parallel
          const toolPromises = msg.tool_calls.map(async (tc) => {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || "{}");
            } catch {
              args = {};
            }
            const result = await executeTool(brain, tc.function.name, args, userId)
              .catch((toolErr) => ({ error: toolErr.message, tool: tc.function.name }));
            toolsUsed.push(tc.function.name);
            toolResults.push({ name: tc.function.name, result });
            brain.toolStats[tc.function.name] = (brain.toolStats[tc.function.name] || 0) + 1;
            // Capturare monitor output — GPT creaza orice vizualizare, framework-ul o afiseaza
            if (result?.monitorHTML) gptMonitor = { content: result.monitorHTML, type: result.type || 'html' };


            return {
              role: "tool",
              tool_call_id: tc.id,
              content: typeof result === "string"
                ? result
                : JSON.stringify(result, (_, v) => typeof v === "string" ? v.substring(0, 4000) : v),
            };
          });

          const toolResponseMsgs = await Promise.all(toolPromises);

          // Add assistant message (with tool_calls) + tool responses
          currentMsgs = [
            ...currentMsgs,
            { role: "assistant", content: null, tool_calls: msg.tool_calls },
            ...toolResponseMsgs,
          ];
        } else {
          // No tool calls — extract text response
          finalResponse = msg.content || "";
          break;
        }

        // If this was the last round, make one more call without tools to get final response
        if (round === MAX_TOOL_ROUNDS - 1 && !finalResponse) {
          const finalCall = await callOpenAI(
            currentMsgs,
            systemPrompt,
            [], // No tools — force text response
            MODELS.OPENAI_CHAT,
          );
          totalTokens += (finalCall.usage?.total_tokens || 0);
          finalResponse = finalCall.choices?.[0]?.message?.content || "";
        }
      }

      // Dacă GPT nu a produs niciun răspuns → activăm fallback chain (V4 → V3)
      if (!finalResponse) {
        throw new Error('GPT-5.4 tool execution loop produced no response — triggering fallback');
      }

      engine = "GPT-5.4";
      if (gptMonitor) monitorFromTools = gptMonitor;

    } else if (!finalResponse) {
      // ═══ GEMINI FLASH PATH — doar dacă nu există deja un răspuns ═══
      const geminiToolDefs = toGeminiTools(TOOL_DEFINITIONS);

      // Build Gemini message array
      const userParts = [];
      if (mediaData.imageBase64) {
        userParts.push({
          inlineData: {
            mimeType: mediaData.imageMimeType || "image/jpeg",
            data: mediaData.imageBase64,
          },
        });
        if (mediaData.isAutoCamera) {
          userParts.push({
            text: "[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. " +
              "Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții).",
          });
        }
      }
      userParts.push({ text: message });

      const geminiMessages = [
        ...recentHistory.map((h) => ({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: typeof h.content === "string" ? h.content : JSON.stringify(h.content) }],
        })),
        { role: "user", parts: userParts },
      ];

      // Gemini tool calling loop — MAX 2 rounds
      let currentMessages = geminiMessages;
      const geminiApiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;

      if (!geminiApiKey) {
        throw new Error("No AI API key configured (OPENAI_API_KEY or GOOGLE_AI_KEY required)");
      }

      const geminiModel = MODELS.GEMINI_CHAT || "gemini-2.5-flash";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

      // Include tools only for tool_use intent (maps, images etc)
      const includeTools = intent === 'tool_use' || intent === 'deep_reasoning';


      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const geminiBody = {
          contents: currentMessages,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
        };

        if (includeTools) {
          geminiBody.tools = [{ functionDeclarations: geminiToolDefs }];
        }

        const r = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
        });

        if (!r.ok) {
          const errText = await r.text().catch(() => "unknown");
          throw new Error(`Gemini API ${r.status}: ${errText.substring(0, 200)}`);
        }

        const response = await r.json();
        totalTokens +=
          (response.usageMetadata?.promptTokenCount || 0) +
          (response.usageMetadata?.candidatesTokenCount || 0);

        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
          const blockReason = candidate?.finishReason || response.promptFeedback?.blockReason;
          if (blockReason) logger.warn({ component: "BrainV5", blockReason }, "Gemini blocked");
          break;
        }

        const parts = candidate.content.parts;
        const functionCalls = parts.filter((p) => p.functionCall);

        if (functionCalls.length === 0) {
          finalResponse = parts.filter((p) => p.text).map((p) => p.text).join("\n");
          break;
        }

        // Execute tools
        const toolPromises = functionCalls.map(async (fc) => {
          const result = await executeTool(brain, fc.functionCall.name, fc.functionCall.args || {}, userId)
            .catch((toolErr) => ({ error: toolErr.message, tool: fc.functionCall.name }));
          toolsUsed.push(fc.functionCall.name);
          toolResults.push({ name: fc.functionCall.name, result });
          brain.toolStats[fc.functionCall.name] = (brain.toolStats[fc.functionCall.name] || 0) + 1;
          return {
            functionResponse: {
              name: fc.functionCall.name,
              response: typeof result === "string"
                ? { result }
                : JSON.parse(JSON.stringify(result, (_, v) => typeof v === "string" ? v.substring(0, 4000) : v)),
            },
          };
        });

        const toolResponseParts = await Promise.all(toolPromises);
        currentMessages = [
          ...currentMessages,
          { role: "model", parts: candidate.content.parts },
          { role: "user", parts: toolResponseParts },
        ];
      }

      // ── Fallback: dacă Gemini nu a dat răspuns (ex: tool calling eșuat), apel final fără tools ──
      if (!finalResponse) {
        logger.warn({ component: 'BrainV5' }, '⚠️ Gemini returned empty response with tools, retrying without tools');
        const fallbackBody = {
          contents: geminiMessages,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
        };
        try {
          const fr = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fallbackBody),
          });
          if (fr.ok) {
            const fd = await fr.json();
            finalResponse = (fd.candidates?.[0]?.content?.parts || [])
              .filter((p) => p.text).map((p) => p.text).join('\n');
          }
        } catch (fe) {
          logger.warn({ component: 'BrainV5', err: fe.message }, 'Gemini no-tools fallback failed');
        }
      }

      engine = "Gemini-Flash";
    }


    // ── 8. Strip leaked tags from response ──
    finalResponse = stripLeakedTags(finalResponse);

    // ── 9. Quality Gate (Gemini verifies critical GPT responses) ──
    if (engine === "GPT-5.4" && finalResponse) {
      const qa = await qualityGate(message, finalResponse, domain);
      if (!qa.passed && qa.corrected) {
        finalResponse = qa.corrected;
        engine = "GPT-5.4+QA";
      }
    }

    // ── 10. Post-processing ──
    const thinkTime = Date.now() - startTime;

    // Save memory (async, non-blocking)
    brain.saveMemory(userId, "text", message, { response: finalResponse.substring(0, 200) }, 5).catch(() => { });
    brain.learnFromConversation(userId, message, finalResponse).catch(() => { });
    if (profile) {
      profile.updateFromConversation(message, language, { emotionalTone, topics: [] });
      profile.save(brain.supabaseAdmin).catch(() => { });
    }

    // Track usage
    brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch(() => { });

    // Confidence scoring
    let confidence = 0.7;
    if (toolsUsed.length > 0) confidence += 0.15;
    if (toolsUsed.length > 2) confidence += 0.1;
    if (engine.includes("QA")) confidence += 0.05; // QA-verified = higher confidence
    confidence = Math.min(1.0, confidence);

    // Self-evaluate
    try {
      const evalDomain = toolsUsed.includes("get_trading_intelligence") ? "trading"
        : toolsUsed.includes("search_web") ? "research"
          : toolsUsed.includes("execute_javascript") ? "coding"
            : "general";
      selfEvaluate(message, finalResponse, evalDomain);
      recordUserInteraction({ domain: evalDomain, userMessage: message });
    } catch (_) { /* non-blocking */ }

    // ── Parse avatar commands from AI response ──
    const avatarCmds = parseAvatarCommands(finalResponse);
    const monitorFinal = avatarCmds.monitor?.content ? avatarCmds.monitor : (monitorFromTools || extractMonitor(toolResults));


    logger.info(
      { component: "BrainV5", engine, tools: toolsUsed, thinkTime, tokens: totalTokens, intent },
      `🧠 V5 Think: ${engine} | intent:${intent} | ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`,
    );


    const result = {
      enrichedMessage: avatarCmds.cleanText || finalResponse,
      enrichedContext: finalResponse,
      toolsUsed,
      monitor: monitorFinal,
      emotion: avatarCmds.emotion || emotionalTone,
      gestures: avatarCmds.gestures || [],
      bodyActions: avatarCmds.bodyActions || [],
      gaze: avatarCmds.gaze || null,
      actions: avatarCmds.actions || [],
      analysis: {
        complexity: intent,
        emotionalTone,
        language: language || "ro",
        topics: [],
        isEmotional: emotionalTone !== "neutral",
        frustrationLevel: frustration,
      },

      chainOfThought: null,
      compressedHistory: recentHistory,
      failedTools: toolResults.filter((r) => r.result?.error).map((r) => r.name),
      thinkTime,
      confidence,
      sourceTags:
        toolsUsed.length > 0
          ? ["VERIFIED", ...toolsUsed.map((t) => `SOURCE:${t}`)]
          : ["ASSUMPTION"],
      agent: `v5-${engine.toLowerCase()}`,
      profileLoaded: !!profile,
    };

    // ── Save to semantic cache (async, non-blocking) ──
    const isPersonal = /\b(eu|meu|mea|mine|viața|familie)\b/i.test(message);
    brain.saveToSemanticCache(message, result, userId, isPersonal).catch(() => {});

    return result;

  } catch (e) {
    const thinkTime = Date.now() - startTime;
    brain.recordError("thinkV5", e.message);
    logger.error({ component: "BrainV5", err: e.message, thinkTime }, `🧠 V5 Think failed: ${e.message}`);

    // FALLBACK CHAIN: V5 fails → try V4 → Claude → V3 → error
    logger.info({ component: "BrainV5" }, "⚠️ Falling back to V4 (Gemini tool calling)");
    // Re-run getRealtimeContext so V4 fallback also has current data (weather/search)
    let fallbackRealtimeCtx = null;
    try { fallbackRealtimeCtx = await getRealtimeContext(message, brain, userId, mediaData?.geo); } catch (_) { }
    // Paseaza history curat la V4 (historyWithCtx cu model turn cauzea Gemini 400)
    try {
      const { thinkV4 } = require("./brain-v4");
      return await thinkV4(brain, message, avatar, history || [], language, userId, conversationId, mediaData, isAdmin);

    } catch (e2) {
      logger.info({ component: "BrainV5" }, "⚠️ V4 failed, trying Claude...");
      // Try Claude (Anthropic) before falling back to V3
      try {
        const claudeReply = await callClaude(
          message,
          `You are ${avatar === 'kira' ? 'Kira' : 'Kelion'}, an AI assistant created by EA Studio. Respond in ${language}. Be helpful, natural and concise.`,
        );
        if (claudeReply) {
          return {
            enrichedMessage: claudeReply,
            enrichedContext: claudeReply,
            toolsUsed: [],
            monitor: { content: null, type: null },
            emotion: 'neutral',
            gestures: [],
            bodyActions: [],
            gaze: null,
            actions: [],
            analysis: { complexity: 'simple', language: language || 'ro' },
            chainOfThought: null,
            compressedHistory: (history || []).slice(-10),
            failedTools: [],
            thinkTime: Date.now() - startTime,
            confidence: 0.7,
            sourceTags: ['ASSUMPTION'],
            agent: 'v5-claude-fallback',
            profileLoaded: false,
          };
        }
      } catch (eClaude) {
        logger.info({ component: "BrainV5", err: eClaude.message }, "⚠️ Claude failed, falling back to V3");
      }
      try {

        return await brain.think(message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
      } catch (e3) {
        return {
          enrichedMessage:
            language === "ro"
              ? "Îmi pare rău, am întâmpinat o problemă tehnică și nu pot răspunde acum. Te rog să încerci din nou. 🔧"
              : "I'm sorry, I encountered a technical issue and can't respond right now. Please try again. 🔧",
          toolsUsed: [],
          monitor: { content: null, type: null },
          analysis: { complexity: "simple", language: language || "ro", emotionalTone: "neutral", topics: [] },
          chainOfThought: null,
          compressedHistory: history || [],
          failedTools: [],
          thinkTime,
          confidence: 0,
          agent: "v5-error-fallback",
          error: `V5: ${e.message} | V4: ${e2.message} | V3: ${e3.message}`,
        };
      }
    }
  }
}

module.exports = { thinkV5, TOOL_DEFINITIONS, classifyComplexity, stripLeakedTags, qualityGate };
