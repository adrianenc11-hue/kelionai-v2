// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain v3 MULTI-AI ORCHESTRATOR
// 18 agenți specializați, routing inteligent, memorie permanentă
// Layer 0: Front Scout (Groq ~50ms) → clasifică intenția
// Layer 1: Specialist dispatch:
//   CODE     → Claude Code (Sonnet 4) — PRIMAR pe toți avatarii
//   MATH     → DeepSeek Reasoner
//   WEB      → Perplexity Sonar Pro
//   VISION   → GPT-5.4 Vision
//   WEATHER  → Open-Meteo (GPS live din browser, IP fallback)
//   CHAT     → Groq Scout / GPT-4.1
//   ORCHESTR → GPT-5.4 Orchestrator
// Layer 2: QA (Gemini Flash)
// Layer 3: Memory + Learning (Supabase)
// Layer 4: Accessibility — audio description
// Layer 5: Self-development — auto API key discovery
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { MODELS, API_ENDPOINTS, PERSONAS, ORCHESTRATION_AGENTS } = require('./config/models');
const { supabaseAdmin } = require('./supabase');
const { circuitAllow, circuitSuccess, circuitFailure } = require('./scalability');
const { cacheGet, cacheSet } = require('./cache');
const {
  getWeatherLive,
  callClaudeCode,
  buildClaudeCodePrompt,
  auditApiKeys,
} = require('./brain-self');

// ── Intent categories ──
const INTENT = {
  CODE:           'code',
  MATH:           'math',
  WEB:            'web',
  WEATHER:        'weather',
  IMAGE:          'image',
  VISION:         'vision',
  VISION_ACCESS:  'vision_access',
  DOCUMENT:       'document',
  CHAT_SIMPLE:    'chat_simple',
  CHAT_DEEP:      'chat_deep',
  ORCHESTRATE:    'orchestrate',
};

// ── Keyword patterns ──
const INTENT_PATTERNS = {
  [INTENT.WEATHER]: /\b(vreme|meteo|weather|temperatura|temperature|ploaie|rain|ninsoare|snow|forecast|prognoza|frig|cald|soare|sunny|cloudy|noros|vant|wind|umiditate|humidity|ce timp|how's the weather|cum e vremea|ce temperatura|what temperature)\b/i,
  [INTENT.CODE]: /\b(cod|code|program|script|function|class|debug|error|bug|fix|implement|build|deploy|api|backend|frontend|react|node|python|java|sql|database|git|docker|kubernetes|aws|cloud|algorithm|refactor|typescript|javascript|css|html|php|golang|rust|c\+\+|devops|ci\/cd|npm|yarn|pnpm|webpack|vite|jest|test|unit test|integration|microservice|endpoint|rest|graphql|websocket|oauth|jwt|auth|middleware|framework|library|package|module|import|export|async|await|promise|callback|hook|component|state|redux|context|api key|env|environment|variable|config|server|client|request|response|status code|http|https|ssl|tls|nginx|apache|linux|bash|shell|terminal|command|cli|interface|oop|design pattern|solid|mvc|mvvm|singleton|factory|observer|repository|service|controller|model|view|schema|migration|orm|query|index|join|transaction|cache|redis|queue|worker|cron|webhook|socket|stream|buffer|binary|encoding|encryption|hash|token|session|cookie|cors|csrf|xss|injection|vulnerability|security|performance|optimization|memory leak|race condition|deadlock|concurrency|thread|process|recursion|iteration|complexity|big o|data structure|array|object|map|set|tree|graph|heap|stack|queue|linked list|sorting|searching|binary search|dynamic programming|greedy|divide and conquer)\b/i,
  [INTENT.MATH]: /\b(calcul|calculez|matematica|math|formula|ecuatie|equation|integral|derivata|derivative|probabilitate|probability|statistica|statistics|algebra|geometrie|geometry|trigonometrie|trigonometry|logaritm|logarithm|matrice|matrix|vector|tensor|suma|sum|produs|product|factori|factors|prime|numar|number|cifra|digit|procent|percent|medie|average|median|deviatia|deviation|varianta|variance|regresie|regression|clasificare|classification|clustering|neural|gradient|loss|backprop|epoch|batch|overfitting|underfitting|cross.validation|hyperparameter|optimization|convex|linear programming|simplex|newton|euler|runge.kutta)\b/i,
  [INTENT.WEB]: /\b(cauta|search|gaseste|find|stire|news|actualitate|current|acum|azi|today|ieri|yesterday|saptamana|week|luna|month|pret|price|curs|rate|valuta|currency|bitcoin|crypto|actiune|stock|bursa|market|trafic|traffic|restaurant|hotel|zbor|flight|eveniment|event|concert|film|movie|sport|fotbal|football|tenis|tennis|baschet|basketball|formula 1|f1|meci|match|scor|score|clasament|ranking|topuri|top|trending|viral|social media|twitter|facebook|instagram|youtube|wikipedia|wiki|definitie|definition|explicatie|explanation|cum functioneaza|how does|ce este|what is|cine este|who is|unde este|where is|cand|when|de ce|why|populatie|population|capitala|capital|suprafata|area|distanta|distance|durata|duration|timp de zbor|flight time|fus orar|timezone)\b/i,
  [INTENT.IMAGE]: /\b(genereaza|generate|creaza|create|deseneaza|draw|imagin|image|foto|photo|picture|ilustratie|illustration|poster|banner|logo|icon|avatar|wallpaper|background|thumbnail|cover|art|artwork|painting|sketch|render|3d|design|visual|graphic|dall.e|flux|stable diffusion|midjourney|portrait|landscape|abstract|realistic|cartoon|anime|pixel art)\b/i,
  [INTENT.VISION_ACCESS]: /\b(descrie.mi|describe for me|ce vad eu|what am i looking at|ajuta.ma sa vad|help me see|nu vad bine|can't see well|deficient|blind|nevazator|accessibility|accesibil|audio.descri|audio description|citeste.mi imaginea|read the image|spune.mi ce e in|tell me what's in|explica.mi imaginea|explain the image|ce scrie|what does it say|ce apare|what appears|ce contine|what contains)\b/i,
  [INTENT.VISION]: /\b(analizeaza|analyze|descrie|describe|ce vezi|what do you see|ce este in|what is in|identifica|identify|recunoaste|recognize|citeste|read|extrage|extract|ocr|text din imagine|text from image|document|pdf|scan|screenshot|captura|capture|diagrama|diagram|chart|grafic|graph|schema|schematic|blueprint|wireframe|mockup|ui|ux|design)\b/i,
  [INTENT.ORCHESTRATE]: /\b(planifica|plan|strategie|strategy|arhitectura|architecture|sistem complex|complex system|multi.step|pas cu pas|step by step|analizeaza complet|full analysis|raport complet|full report|proiect complet|full project|implementeaza tot|implement everything|fa tot|do everything|end.to.end|de la zero|from scratch)\b/i,
  [INTENT.CHAT_SIMPLE]: /^(salut|buna|hello|hi|hey|ciao|hola|bonjour|hallo|ok|da|nu|multumesc|merci|thanks|thank you|please|te rog|poftim|bine|good|great|perfect|super|ok|okay|yep|nope|sure|of course|desigur|evident|exact|corect|gresit|nu stiu|i don't know|poate|maybe|probabil|probably|nu|yes|no|bye|la revedere|pa|ciao|adio|noapte buna|good night|buna dimineata|good morning|buna ziua|good afternoon|ce mai faci|how are you|cum esti|how's it going|ce faci|what's up|nimic|nothing|totul bine|all good|si eu|me too)\b/i,
};

function classifyIntentFast(message, hasImage) {
  if (hasImage) {
    if (INTENT_PATTERNS[INTENT.VISION_ACCESS].test(message)) return INTENT.VISION_ACCESS;
    return INTENT.VISION;
  }
  const msg = message.toLowerCase().trim();
  if (msg.length < 40 && INTENT_PATTERNS[INTENT.CHAT_SIMPLE].test(msg)) return INTENT.CHAT_SIMPLE;
  if (INTENT_PATTERNS[INTENT.WEATHER].test(msg)) return INTENT.WEATHER;
  if (INTENT_PATTERNS[INTENT.ORCHESTRATE].test(msg)) return INTENT.ORCHESTRATE;
  if (INTENT_PATTERNS[INTENT.CODE].test(msg)) return INTENT.CODE;
  if (INTENT_PATTERNS[INTENT.MATH].test(msg)) return INTENT.MATH;
  if (INTENT_PATTERNS[INTENT.IMAGE].test(msg)) return INTENT.IMAGE;
  if (INTENT_PATTERNS[INTENT.WEB].test(msg)) return INTENT.WEB;
  if (INTENT_PATTERNS[INTENT.VISION_ACCESS].test(msg)) return INTENT.VISION_ACCESS;
  if (INTENT_PATTERNS[INTENT.VISION].test(msg)) return INTENT.VISION;
  if (msg.length < 80) return INTENT.CHAT_SIMPLE;
  return INTENT.CHAT_DEEP;
}

async function classifyWithScout(message, language) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || !circuitAllow('groq')) return null;
  try {
    const prompt = `Classify this user message into ONE category. Reply with ONLY the category name, nothing else.
Categories: code, math, web_search, weather, image_gen, vision, vision_access, chat_simple, chat_deep, document, orchestrate
- weather = asking about current weather, temperature, forecast
- vision_access = user needs detailed image description (accessibility, visual impairment)
- orchestrate = complex multi-step task needing strategic planning
Message: "${message.substring(0, 300)}"
Category:`;
    const resp = await fetch(`${API_ENDPOINTS.GROQ}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: ORCHESTRATION_AGENTS.front_scout.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      circuitSuccess('groq');
      const data = await resp.json();
      const cat = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
      if (cat.includes('code')) return INTENT.CODE;
      if (cat.includes('math')) return INTENT.MATH;
      if (cat.includes('weather')) return INTENT.WEATHER;
      if (cat.includes('web')) return INTENT.WEB;
      if (cat.includes('image')) return INTENT.IMAGE;
      if (cat.includes('vision_access') || cat.includes('access')) return INTENT.VISION_ACCESS;
      if (cat.includes('vision') || cat.includes('document')) return INTENT.VISION;
      if (cat.includes('orchestrate')) return INTENT.ORCHESTRATE;
      if (cat.includes('simple')) return INTENT.CHAT_SIMPLE;
      if (cat.includes('deep')) return INTENT.CHAT_DEEP;
    } else {
      circuitFailure('groq');
    }
  } catch (e) {
    circuitFailure('groq');
  }
  return null;
}

// ── GPT-5.4 Vision ──
async function callGPT54Vision(systemPrompt, message, history, imageBase64) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || !circuitAllow('openai')) return null;
  try {
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
        if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
      }
    }
    const userContent = imageBase64
      ? [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }]
      : message;
    msgs.push({ role: 'user', content: userContent });
    const resp = await fetch(`${API_ENDPOINTS.OPENAI}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: ORCHESTRATION_AGENTS.vision_gpt54.model, messages: msgs, max_tokens: 4096, temperature: 0.4 }),
      signal: AbortSignal.timeout(25000),
    });
    if (resp.ok) {
      circuitSuccess('openai');
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', provider: 'gpt-5.4-vision' };
    } else {
      circuitFailure('openai');
    }
  } catch (e) {
    circuitFailure('openai');
  }
  return null;
}

// ── GPT-5.4 Orchestrator ──
async function callGPT54Orchestrator(systemPrompt, message, history) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || !circuitAllow('openai')) return null;
  try {
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-15)) {
        const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
        if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
      }
    }
    msgs.push({ role: 'user', content: message });
    const resp = await fetch(`${API_ENDPOINTS.OPENAI}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: ORCHESTRATION_AGENTS.orchestrator_gpt54.model, messages: msgs, max_tokens: 8192, temperature: 0.5 }),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      circuitSuccess('openai');
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', provider: 'gpt-5.4-orchestrator' };
    } else {
      circuitFailure('openai');
    }
  } catch (e) {
    circuitFailure('openai');
  }
  return null;
}

// ── Perplexity Web Search ──
async function searchWeb(query, language) {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (!perplexityKey) return null;
  try {
    const resp = await fetch(`${API_ENDPOINTS.PERPLEXITY}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${perplexityKey}` },
      body: JSON.stringify({
        model: ORCHESTRATION_AGENTS.web_sonar.model,
        messages: [
          { role: 'system', content: `Respond in ${language === 'ro' ? 'Romanian' : language || 'English'}. Include sources.` },
          { role: 'user', content: query },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        return_citations: true,
        search_recency_filter: 'week',
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', citations: data.citations || [], provider: 'perplexity-sonar-pro' };
    }
  } catch (e) {
    logger.warn({ component: 'Brain.WebSearch', err: e.message }, 'Perplexity failed');
  }
  // Tavily fallback
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return null;
  try {
    const resp = await fetch(`${API_ENDPOINTS.TAVILY}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'advanced', max_results: 5, include_answer: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { content: data.answer || (data.results || []).map((r) => r.content).join('\n\n'), citations: (data.results || []).map((r) => r.url), provider: 'tavily' };
    }
  } catch (e) {
    logger.warn({ component: 'Brain.WebSearch', err: e.message }, 'Tavily failed');
  }
  return null;
}

// ── DeepSeek ──
async function callDeepSeek(systemPrompt, message, history, useReasoner = false) {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) return null;
  try {
    const model = useReasoner ? ORCHESTRATION_AGENTS.reasoner_deepseek.model : ORCHESTRATION_AGENTS.coder_deepseek.model;
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-8)) {
        const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
        if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
      }
    }
    msgs.push({ role: 'user', content: message });
    const resp = await fetch(`${API_ENDPOINTS.DEEPSEEK}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: 4096, temperature: useReasoner ? 0.1 : 0.3 }),
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', provider: useReasoner ? 'deepseek-reasoner' : 'deepseek-coder' };
    }
  } catch (e) {
    logger.warn({ component: 'Brain.DeepSeek', err: e.message }, 'DeepSeek error');
  }
  return null;
}

// ── Groq ──
async function callGroq(systemPrompt, message, history) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || !circuitAllow('groq')) return null;
  try {
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-12)) {
        const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
        if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
      }
    }
    msgs.push({ role: 'user', content: message });
    const resp = await fetch(`${API_ENDPOINTS.GROQ}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({ model: ORCHESTRATION_AGENTS.front_scout.model, messages: msgs, max_tokens: 2048, temperature: 0.7 }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      circuitSuccess('groq');
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', provider: 'groq-llama-scout' };
    } else {
      circuitFailure('groq');
    }
  } catch (e) {
    circuitFailure('groq');
  }
  return null;
}

// ── Gemini Pro ──
async function callGeminiPro(systemPrompt, message, history, imageBase64) {
  const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!gKey || !circuitAllow('gemini')) return null;
  try {
    const model = imageBase64 ? ORCHESTRATION_AGENTS.vision_gemini.model : ORCHESTRATION_AGENTS.qa_gemini_pro.model;
    const contents = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-15)) {
        if (h.role === 'user' || h.role === 'model') contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content || '' }] });
        else if (h.role === 'assistant') contents.push({ role: 'model', parts: [{ text: h.content || '' }] });
      }
    }
    const userParts = [{ text: message }];
    if (imageBase64) userParts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
    contents.push({ role: 'user', parts: userParts });
    const resp = await fetch(`${API_ENDPOINTS.GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gKey },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { maxOutputTokens: 8192, temperature: 0.6 } }),
      signal: AbortSignal.timeout(18000),
    });
    if (resp.ok) {
      circuitSuccess('gemini');
      const data = await resp.json();
      return { content: (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text).map((p) => p.text).join(''), provider: 'gemini-pro' };
    } else {
      circuitFailure('gemini');
    }
  } catch (e) {
    circuitFailure('gemini');
  }
  return null;
}

// ── Gemini Flash ──
async function callGeminiFlash(systemPrompt, message, history) {
  const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!gKey || !circuitAllow('gemini')) return null;
  try {
    const contents = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (h.role === 'user' || h.role === 'model') contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content || '' }] });
        else if (h.role === 'assistant') contents.push({ role: 'model', parts: [{ text: h.content || '' }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });
    const resp = await fetch(`${API_ENDPOINTS.GEMINI}/models/${ORCHESTRATION_AGENTS.qa_gemini_flash.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gKey },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { maxOutputTokens: 4096, temperature: 0.7 } }),
      signal: AbortSignal.timeout(12000),
    });
    if (resp.ok) {
      circuitSuccess('gemini');
      const data = await resp.json();
      return { content: (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text).map((p) => p.text).join(''), provider: 'gemini-flash' };
    } else {
      circuitFailure('gemini');
    }
  } catch (e) {
    circuitFailure('gemini');
  }
  return null;
}

// ── GPT-4.1 ──
async function callGPT(systemPrompt, message, history, imageBase64) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || !circuitAllow('openai')) return null;
  try {
    const msgs = [{ role: 'system', content: systemPrompt }];
    if (Array.isArray(history)) {
      for (const h of history.slice(-20)) {
        const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
        if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
      }
    }
    if (imageBase64) {
      msgs.push({ role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }] });
    } else {
      msgs.push({ role: 'user', content: message });
    }
    const model = imageBase64 ? MODELS.OPENAI_VISION : MODELS.OPENAI_CHAT;
    const resp = await fetch(`${API_ENDPOINTS.OPENAI}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model, messages: msgs, max_tokens: 4096, temperature: 0.7 }),
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) {
      circuitSuccess('openai');
      const data = await resp.json();
      return { content: data.choices?.[0]?.message?.content || '', provider: 'gpt-4.1' };
    } else {
      circuitFailure('openai');
    }
  } catch (e) {
    circuitFailure('openai');
  }
  return null;
}

// ── Parse emotion + gestures ──
function parseEmotionGestures(reply) {
  let emotion = 'neutral';
  const gestures = [];
  let pose = null;
  let gaze = null;
  const emotionMatch = (reply || '').match(/\[EMOTION:\s*(\w+)\]/i);
  if (emotionMatch) {
    emotion = emotionMatch[1].toLowerCase();
  } else if (reply) {
    const r = reply.toLowerCase();
    if (/😂|😄|😊|haha|:D|bravo|super|perfect|excelent|genial|fantastic/i.test(r)) emotion = 'laughing';
    else if (/❤|🥰|💕|te iubesc|love|drag|iubit/i.test(r)) emotion = 'loving';
    else if (/😢|😔|din păcate|unfortunately|îmi pare rău|sorry|scuze|regret/i.test(r)) emotion = 'sad';
    else if (/🤔|hmm|interesant|curios|interesting|oare|perhaps/i.test(r)) emotion = 'thinking';
    else if (/😮|wow|uau|incredibil|amazing|unbelievable/i.test(r)) emotion = 'surprised';
    else if (/😏|heh|glum|ironic|witty|😜/i.test(r)) emotion = 'playful';
    else if (/💪|determinat|going to|vom reuși|we will|hai să/i.test(r)) emotion = 'determined';
    else if (/😟|grijă|atenție|careful|warning|pericol|danger/i.test(r)) emotion = 'concerned';
    else if (/salut|bună|hello|hey|hi |welcome|👋/i.test(r)) emotion = 'happy';
    else if (/\?$/.test(reply.trim())) emotion = 'thinking';
    else emotion = 'happy';
  }
  const gestureMatches = (reply || '').matchAll(/\[GESTURE:\s*(\w+)\]/gi);
  for (const gm of gestureMatches) gestures.push(gm[1].toLowerCase());
  const poseMatch = (reply || '').match(/\[POSE:\s*([\w_]+)\]/i);
  if (poseMatch) pose = poseMatch[1].toLowerCase();
  const gazeMatch = (reply || '').match(/\[GAZE:\s*([\w-]+)\]/i);
  if (gazeMatch) gaze = gazeMatch[1].toLowerCase();
  return { emotion, gestures, pose, gaze };
}

// ── Format weather data pentru AI ──
function formatWeatherForAI(weatherData, language) {
  if (!weatherData) return '';
  const lang = language === 'ro' ? 'ro' : 'en';
  const current = weatherData.current || {};
  const temp = current.temperature_2m !== undefined ? current.temperature_2m : weatherData.temperature;
  const feelsLike = current.apparent_temperature !== undefined ? current.apparent_temperature : weatherData.feels_like;
  const humidity = current.relative_humidity_2m !== undefined ? current.relative_humidity_2m : weatherData.humidity;
  const wind = current.wind_speed_10m !== undefined ? current.wind_speed_10m : weatherData.wind_speed;
  const desc = weatherData.description || '';
  const city = weatherData.city || '';

  const WMO_CODES = {
    0: lang === 'ro' ? 'Cer senin' : 'Clear sky',
    1: lang === 'ro' ? 'Predominant senin' : 'Mainly clear',
    2: lang === 'ro' ? 'Parțial noros' : 'Partly cloudy',
    3: lang === 'ro' ? 'Acoperit' : 'Overcast',
    45: lang === 'ro' ? 'Ceață' : 'Fog',
    48: lang === 'ro' ? 'Ceață cu chiciură' : 'Icy fog',
    51: lang === 'ro' ? 'Burniță ușoară' : 'Light drizzle',
    61: lang === 'ro' ? 'Ploaie ușoară' : 'Light rain',
    63: lang === 'ro' ? 'Ploaie moderată' : 'Moderate rain',
    65: lang === 'ro' ? 'Ploaie abundentă' : 'Heavy rain',
    71: lang === 'ro' ? 'Ninsoare ușoară' : 'Light snow',
    73: lang === 'ro' ? 'Ninsoare moderată' : 'Moderate snow',
    75: lang === 'ro' ? 'Ninsoare abundentă' : 'Heavy snow',
    80: lang === 'ro' ? 'Averse ușoare' : 'Light showers',
    81: lang === 'ro' ? 'Averse moderate' : 'Moderate showers',
    82: lang === 'ro' ? 'Averse violente' : 'Violent showers',
    95: lang === 'ro' ? 'Furtună cu tunete' : 'Thunderstorm',
    99: lang === 'ro' ? 'Furtună cu grindină' : 'Thunderstorm with hail',
  };

  const weatherCode = current.weather_code;
  const weatherDesc = desc || (weatherCode !== undefined ? WMO_CODES[weatherCode] || `Code ${weatherCode}` : '');

  const daily = weatherData.daily || {};
  const maxTemps = daily.temperature_2m_max || [];
  const minTemps = daily.temperature_2m_min || [];
  const dailyCodes = daily.weather_code || [];

  let forecastText = '';
  if (maxTemps.length >= 3) {
    const days = lang === 'ro' ? ['Azi', 'Mâine', 'Poimâine'] : ['Today', 'Tomorrow', 'Day after'];
    forecastText = days
      .slice(0, 3)
      .map((d, i) => `${d}: ${Math.round(maxTemps[i])}°/${Math.round(minTemps[i])}° ${WMO_CODES[dailyCodes[i]] || ''}`)
      .join(', ');
  }

  return [
    `[WEATHER DATA — ${city}]`,
    `Temperature: ${temp !== undefined ? Math.round(temp) + '°C' : 'N/A'}`,
    feelsLike !== undefined ? `Feels like: ${Math.round(feelsLike)}°C` : '',
    humidity !== undefined ? `Humidity: ${humidity}%` : '',
    wind !== undefined ? `Wind: ${Math.round(wind)} km/h` : '',
    weatherDesc ? `Conditions: ${weatherDesc}` : '',
    forecastText ? `Forecast: ${forecastText}` : '',
    `Source: ${weatherData.provider || 'open-meteo'} (live, no API key)`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════
// KelionBrain — Clasa principală
// ═══════════════════════════════════════════════════════════════
class KelionBrain {
  constructor() {
    this.conversationCount = 0;
    this.integralMemory = null;
    this._currentMemoryContext = '';
    this._memCache = new Map();
    this._cacheMaxAge = 60000;
    this._cacheMaxUsers = 200;
    this._traces = [];
    this._tracesMax = 50;
    this._providerStats = {};
    // Run API key audit after 10s startup delay
    setTimeout(() => auditApiKeys().catch(() => {}), 10000);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════
  async think(message, avatar, history, language, userId, _unused, options, _isAdmin) {
    const start = Date.now();
    const hasImage = !!options?.imageBase64;
    const clientIp = options?.clientIp || null;
    const browserGeo = options?.geo || null; // { lat, lng } din browser GPS

    const persona = PERSONAS[avatar] || PERSONAS.kelion || '';
    const langInstruction =
      language === 'auto'
        ? "CRITICAL: Detect the language of the user's message and respond in EXACTLY that same language."
        : language === 'ro'
          ? 'Raspunde INTOTDEAUNA in limba romana.'
          : `Respond in ${language || 'English'}.`;

    const expertiseBlock = `
You are a world-class software specialist and accessibility expert.
Full-stack: React, Node.js, Python, Go, Rust, Java, TypeScript, C++
Cloud: AWS, GCP, Azure, Docker, Kubernetes, Terraform
AI/ML: LLMs, RAG, embeddings, fine-tuning, computer vision
DB: PostgreSQL, MongoDB, Redis, Elasticsearch, Supabase
Security, DevOps, CI/CD, microservices, event-driven architecture
Accessibility: WCAG 2.1 AA/AAA, ARIA, screen readers, assistive technology
Use [EMOTION:thinking] when analyzing complex problems.
Use [EMOTION:excited] when sharing elegant solutions.
Use [GESTURE:point] when highlighting important code.`;

    const accessibilityBlock = `
ACCESSIBILITY MODE — ALWAYS ACTIVE:
- This application serves users with visual impairments. Audio description is essential.
- When describing images: be extremely detailed — colors, positions, text, faces, emotions, context.
- Structure: "In the foreground... In the background... The text reads... The person appears..."
- Keep responses concise enough to be pleasant when read aloud by TTS.
- Avoid "as you can see" — use "as I describe" instead.`;

    const systemPrompt = [
      persona,
      langInstruction,
      expertiseBlock,
      accessibilityBlock,
      'You can use [EMOTION:xxx] tags (happy, sad, thinking, laughing, surprised, neutral, loving, excited, concerned, determined, playful).',
      'You can use [GESTURE:xxx] tags (wave, nod, headshake, point, shrug, clap, thumbsup).',
    ].join('\n');

    // ── Load memory ──
    let memoryContext = '';
    if (userId) {
      try {
        const mem = await this.loadAllMemory(userId);
        memoryContext = mem.context || '';
      } catch (e) {
        logger.warn({ component: 'Brain', err: e.message }, 'Memory load failed');
      }
    }
    let fullSystemPrompt = memoryContext ? systemPrompt + '\n' + memoryContext : systemPrompt;

    // ── Live vision context: inject what the camera currently sees ──
    if (options?.visionContext && !hasImage) {
      fullSystemPrompt += `\n\n[LIVE CAMERA — The user's camera is currently ON. Here is what you can see right now: ${options.visionContext}]`;
    }

    // ── Cache ──
    const cacheable = !hasImage && message && message.length >= 5;
    let cacheKey = null;
    if (cacheable) {
      const crypto = require('crypto');
      const cacheInput = JSON.stringify({ m: message.trim().toLowerCase(), a: avatar, l: language, u: userId || '' });
      cacheKey = 'brain3:' + crypto.createHash('sha256').update(cacheInput).digest('hex').slice(0, 16);
      try {
        const cached = await cacheGet(cacheKey);
        if (cached) {
          cached.thinkTime = Date.now() - start;
          return cached;
        }
      } catch (_e) { /* miss */ }
    }

    const trace = { id: Date.now().toString(36), ts: new Date().toISOString(), steps: [], intent: null, provider: null };

    // ═══════════════════════════════════════════════════════════
    // LAYER 0 — INTENT CLASSIFICATION
    // ═══════════════════════════════════════════════════════════
    let intent = classifyIntentFast(message, hasImage);
    trace.steps.push({ agent: 'FastClassifier', intent, ms: 0 });

    if (intent === INTENT.CHAT_DEEP || intent === INTENT.CHAT_SIMPLE) {
      const scoutStart = Date.now();
      const scoutIntent = await classifyWithScout(message, language);
      if (scoutIntent) {
        intent = scoutIntent;
        trace.steps.push({ agent: 'GroqScout', intent, ms: Date.now() - scoutStart });
      }
    }

    trace.intent = intent;
    logger.info({ component: 'Brain.Router', intent, msgLen: message.length, hasImage, hasBrowserGeo: !!browserGeo }, `Intent: ${intent}`);

    // ═══════════════════════════════════════════════════════════
    // LAYER 1 — SPECIALIST DISPATCH
    // ═══════════════════════════════════════════════════════════
    let reply = '';
    let provider = 'unknown';
    let webSources = [];
    let monitorContent = null;
    let accessibilityData = null;
    let weatherData = null;

    // ── WEATHER: Open-Meteo live — GPS din browser (primar) sau IP (fallback) ──
    if (intent === INTENT.WEATHER) {
      const wStart = Date.now();
      try {
        // Prioritate: coords din browser GPS → city din mesaj → IP geolocation
        const gpsCoords = browserGeo && browserGeo.lat ? { lat: browserGeo.lat, lon: browserGeo.lng || browserGeo.lon } : null;
        const cityMatch = message.match(/(?:în|in|la|for|at|din|from)\s+([A-Za-zăâîșțĂÂÎȘȚ\s]{2,30})/i);
        const cityFromMsg = cityMatch ? cityMatch[1].trim() : null;

        weatherData = await getWeatherLive({
          lat: gpsCoords?.lat,
          lon: gpsCoords?.lon,
          city: cityFromMsg,
          clientIp,
        });

        if (weatherData) {
          const weatherContext = formatWeatherForAI(weatherData, language);
          const weatherSystemPrompt = fullSystemPrompt + `\n\nYou have access to LIVE weather data fetched directly from Open-Meteo (free, no API key needed).
GPS source: ${gpsCoords ? 'Browser GPS (exact location)' : cityFromMsg ? 'City name from message' : 'IP geolocation (approximate)'}.
Use this data to give a natural, conversational weather report. Include temperature, conditions, and a brief forecast.
${weatherContext}`;

          const weatherReply = await callGroq(weatherSystemPrompt, message, history)
            || await callGeminiFlash(weatherSystemPrompt, message, history)
            || await callGPT(weatherSystemPrompt, message, history, null);

          if (weatherReply?.content) {
            reply = weatherReply.content;
            provider = `weather-open-meteo+${weatherReply.provider}`;
            monitorContent = {
              type: 'weather',
              city: weatherData.city,
              temp: weatherData.current?.temperature_2m,
              provider: weatherData.provider,
              gpsSource: gpsCoords ? 'browser-gps' : cityFromMsg ? 'city-name' : 'ip-geo',
            };
            trace.steps.push({ agent: 'OpenMeteo+AI', status: 'ok', ms: Date.now() - wStart });
            this._recordProvider('OpenMeteo', Date.now() - wStart, false);
          }
        }
      } catch (e) {
        logger.warn({ component: 'Brain.Weather', err: e.message }, 'Weather fetch failed');
      }
    }

    // ── CODE: Claude Code (PRIMAR pe toți avatarii) → DeepSeek → GPT-5.4 ──
    if (!reply && intent === INTENT.CODE) {
      const claudeCodePrompt = buildClaudeCodePrompt(avatar, language, memoryContext);
      const codeStart = Date.now();

      // Claude Code — agentul principal pentru cod pe Kelion și Kira
      const claudeResult = await callClaudeCode(claudeCodePrompt, message, history, {
        maxTokens: 16000,
        temperature: 0.2,
      });

      if (claudeResult?.content) {
        reply = claudeResult.content;
        provider = claudeResult.provider;
        trace.steps.push({ agent: 'ClaudeCode', status: 'ok', ms: Date.now() - codeStart });
        this._recordProvider('ClaudeCode', Date.now() - codeStart, false);
      } else {
        // Fallback: DeepSeek Coder
        const dsStart = Date.now();
        const codeSystemPrompt = fullSystemPrompt + `\nCODING SPECIALIST MODE: Write production-ready code with error handling, comments, and best practices.`;
        const dsResult = await callDeepSeek(codeSystemPrompt, message, history, false);
        if (dsResult?.content) {
          reply = dsResult.content;
          provider = dsResult.provider;
          trace.steps.push({ agent: 'DeepSeek-Coder', status: 'ok', ms: Date.now() - dsStart });
        } else {
          // Fallback: GPT-5.4 Orchestrator
          const gpt54Start = Date.now();
          const gpt54Result = await callGPT54Orchestrator(fullSystemPrompt + '\nCODING MODE: Write complete, production-ready code.', message, history);
          if (gpt54Result?.content) {
            reply = gpt54Result.content;
            provider = 'gpt-5.4-code';
            trace.steps.push({ agent: 'GPT-5.4-Code', status: 'ok', ms: Date.now() - gpt54Start });
          }
        }
      }
      if (reply) monitorContent = { type: 'code', language: 'auto' };
    }

    // ── MATH: DeepSeek Reasoner → GPT-5.4 ──
    if (!reply && intent === INTENT.MATH) {
      const mathPrompt = fullSystemPrompt + `\nMATH MODE: Show step-by-step reasoning, use LaTeX ($formula$), verify calculations.`;
      const dsStart = Date.now();
      const dsResult = await callDeepSeek(mathPrompt, message, history, true);
      if (dsResult?.content) {
        reply = dsResult.content;
        provider = dsResult.provider;
        trace.steps.push({ agent: 'DeepSeek-Reasoner', status: 'ok', ms: Date.now() - dsStart });
        this._recordProvider('DeepSeek-Reasoner', Date.now() - dsStart, false);
      } else {
        const gpt54Result = await callGPT54Orchestrator(mathPrompt, message, history);
        if (gpt54Result?.content) { reply = gpt54Result.content; provider = 'gpt-5.4-math'; }
      }
      if (reply) monitorContent = { type: 'math' };
    }

    // ── VISION ACCESSIBILITY: GPT-5.4 Vision ──
    if (!reply && intent === INTENT.VISION_ACCESS) {
      const accessPrompt = fullSystemPrompt + `\nVISUAL ACCESSIBILITY: Describe this image in maximum detail for a visually impaired person.
Structure: 1.OVERALL SCENE 2.MAIN SUBJECTS 3.ALL TEXT/LABELS 4.COLORS & LIGHTING 5.BACKGROUND 6.EMOTIONAL TONE`;
      const vaResult = await callGPT54Vision(accessPrompt, message, history, options?.imageBase64);
      if (vaResult?.content) {
        reply = vaResult.content;
        provider = vaResult.provider;
        accessibilityData = { type: 'vision_access', detailedDescription: true };
        trace.steps.push({ agent: 'GPT-5.4-VisionAccess', status: 'ok', ms: 0 });
      } else {
        const gemResult = await callGeminiPro(accessPrompt, message, history, options?.imageBase64);
        if (gemResult?.content) { reply = gemResult.content; provider = 'gemini-pro-vision-access'; accessibilityData = { type: 'vision_access' }; }
      }
    }

    // ── VISION: GPT-5.4 → GPT-4.1 → Gemini Pro ──
    if (!reply && (intent === INTENT.VISION || (hasImage && intent !== INTENT.VISION_ACCESS))) {
      const v54Result = await callGPT54Vision(fullSystemPrompt, message, history, options?.imageBase64);
      if (v54Result?.content) {
        reply = v54Result.content;
        provider = v54Result.provider;
        trace.steps.push({ agent: 'GPT-5.4-Vision', status: 'ok', ms: 0 });
        this._recordProvider('GPT-5.4-Vision', 0, false);
      } else {
        const gpt41Result = await callGPT(fullSystemPrompt, message, history, options?.imageBase64);
        if (gpt41Result?.content) { reply = gpt41Result.content; provider = 'gpt-4.1-vision'; }
        else {
          const gemResult = await callGeminiPro(fullSystemPrompt, message, history, options?.imageBase64);
          if (gemResult?.content) { reply = gemResult.content; provider = 'gemini-pro-vision'; }
        }
      }
    }

    // ── ORCHESTRATE: GPT-5.4 ──
    if (!reply && intent === INTENT.ORCHESTRATE) {
      const orchPrompt = fullSystemPrompt + `\nSTRATEGIC ORCHESTRATION: Break down complex tasks, provide complete actionable plans, execute immediately.`;
      const orchResult = await callGPT54Orchestrator(orchPrompt, message, history);
      if (orchResult?.content) {
        reply = orchResult.content;
        provider = orchResult.provider;
        monitorContent = { type: 'plan', structured: true };
        trace.steps.push({ agent: 'GPT-5.4-Orchestrator', status: 'ok', ms: 0 });
        this._recordProvider('GPT-5.4-Orchestrator', 0, false);
      }
    }

    // ── WEB SEARCH: Perplexity Sonar Pro ──
    if (!reply && intent === INTENT.WEB) {
      const wsStart = Date.now();
      const webResult = await searchWeb(message, language);
      if (webResult?.content) {
        const webPrompt = fullSystemPrompt + `\n[WEB SEARCH RESULTS]:\n${webResult.content}`;
        const enhanced = await callGPT(webPrompt, message, history, null) || await callGeminiFlash(webPrompt, message, history);
        reply = enhanced?.content || webResult.content;
        provider = `web-${webResult.provider}${enhanced ? '+' + enhanced.provider : ''}`;
        webSources = webResult.citations || [];
        monitorContent = { type: 'web', sources: webSources, query: message };
        trace.steps.push({ agent: 'Perplexity', status: 'ok', ms: Date.now() - wsStart });
        this._recordProvider('Perplexity', Date.now() - wsStart, false);
      }
    }

    // ── CHAT SIMPLE: Groq Scout (~200ms) ──
    if (!reply && intent === INTENT.CHAT_SIMPLE) {
      const groqResult = await callGroq(fullSystemPrompt, message, history);
      if (groqResult?.content) { reply = groqResult.content; provider = groqResult.provider; trace.steps.push({ agent: 'Groq-Scout', status: 'ok', ms: 0 }); }
    }

    // ── CHAT DEEP: GPT-4.1 → Gemini Pro ──
    if (!reply && intent === INTENT.CHAT_DEEP) {
      const gptResult = await callGPT(fullSystemPrompt, message, history, null);
      if (gptResult?.content) {
        reply = gptResult.content;
        provider = gptResult.provider;
        trace.steps.push({ agent: 'GPT-4.1', status: 'ok', ms: 0 });
        this._recordProvider('GPT-4.1', 0, false);
      } else {
        const gemResult = await callGeminiPro(fullSystemPrompt, message, history, null);
        if (gemResult?.content) { reply = gemResult.content; provider = gemResult.provider; }
      }
    }

    // ── UNIVERSAL FALLBACK ──
    if (!reply) {
      logger.warn({ component: 'Brain', intent }, 'Specialist failed — fallback chain');
      const fb1 = await callGPT(fullSystemPrompt, message, history, options?.imageBase64);
      if (fb1?.content) { reply = fb1.content; provider = 'gpt-4.1-fallback'; }
    }
    if (!reply) {
      const fb2 = await callGeminiFlash(fullSystemPrompt, message, history);
      if (fb2?.content) { reply = fb2.content; provider = 'gemini-flash-fallback'; }
    }
    if (!reply) {
      const fb3 = await callGroq(fullSystemPrompt, message, history);
      if (fb3?.content) { reply = fb3.content; provider = 'groq-fallback'; }
    }

    // ── LOCAL FALLBACK — când nu există niciun API key configurat ──
    if (!reply) {
      provider = 'local-fallback';
      const lang = language === 'ro' ? 'ro' : 'en';
      const avatarName = avatar === 'kira' ? 'Kira' : 'Kelion';
      const localResponses = {
        ro: {
          chat_simple: [
            `Bună! Sunt ${avatarName}, asistentul tău AI. [EMOTION:happy] Momentan funcționez în modul local — pentru răspunsuri complete, configurează cheile API în fișierul .env.`,
            `Salut! [EMOTION:happy] Sunt ${avatarName}. Sunt gata să te ajut! Adaugă cheile API (OpenAI, Gemini sau Groq) în .env pentru a activa toate funcționalitățile.`,
            `Hey! [EMOTION:happy] ${avatarName} aici. Pot să te ajut cu multe lucruri odată ce cheile API sunt configurate. Ce ai nevoie?`,
          ],
          weather: [`Îmi pare rău, nu pot verifica vremea fără o cheie API configurată. [EMOTION:concerned] Adaugă GOOGLE_AI_KEY sau GROQ_API_KEY în .env.`],
          code: [`[EMOTION:thinking] Pentru asistență cu cod am nevoie de o cheie API (ANTHROPIC_API_KEY pentru Claude sau OPENAI_API_KEY). Adaugă-le în .env și voi putea scrie cod complet pentru tine!`],
          default: [
            `[EMOTION:thinking] Înțeleg întrebarea ta. Momentan funcționez fără chei API configurate. Adaugă GOOGLE_AI_KEY, OPENAI_API_KEY sau GROQ_API_KEY în fișierul .env pentru răspunsuri complete.`,
            `[EMOTION:happy] Sunt ${avatarName} și sunt pregătit să te ajut! Pentru a activa toate capacitățile mele AI, configurează cheile API în .env. Poți folosi Gemini (gratuit), OpenAI sau Groq.`,
          ],
        },
        en: {
          chat_simple: [
            `Hi there! I'm ${avatarName}, your AI assistant. [EMOTION:happy] I'm currently running in local mode — for full responses, please configure API keys in your .env file.`,
            `Hello! [EMOTION:happy] I'm ${avatarName}. I'm ready to help! Add API keys (OpenAI, Gemini or Groq) to .env to enable all features.`,
          ],
          weather: [`Sorry, I can't check the weather without a configured API key. [EMOTION:concerned] Add GOOGLE_AI_KEY or GROQ_API_KEY to .env.`],
          code: [`[EMOTION:thinking] For code assistance I need an API key (ANTHROPIC_API_KEY for Claude or OPENAI_API_KEY). Add them to .env and I'll write complete code for you!`],
          default: [
            `[EMOTION:thinking] I understand your question. I'm currently running without API keys configured. Add GOOGLE_AI_KEY, OPENAI_API_KEY or GROQ_API_KEY to .env for full responses.`,
            `[EMOTION:happy] I'm ${avatarName} and I'm ready to help! To activate all my AI capabilities, configure API keys in .env. You can use Gemini (free), OpenAI or Groq.`,
          ],
        },
      };
      const responses = localResponses[lang] || localResponses.en;
      let pool;
      if (intent === INTENT.CHAT_SIMPLE) pool = responses.chat_simple;
      else if (intent === INTENT.WEATHER) pool = responses.weather;
      else if (intent === INTENT.CODE) pool = responses.code;
      else pool = responses.default;
      reply = pool[Math.floor(Math.random() * pool.length)];
      logger.warn({ component: 'Brain', intent }, '⚠️ No API keys — using local fallback response');
    }

    // ── QA Check (Gemini Flash) — pentru cod, math, web ──
    if (reply && reply.length > 200 && [INTENT.CODE, INTENT.MATH, INTENT.WEB, INTENT.ORCHESTRATE].includes(intent)) {
      try {
        const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
        if (gKey && circuitAllow('gemini')) {
          const qaPrompt = `QA check: Is this response correct and safe? Reply "OK" if yes, or provide corrected version.
Question: "${message.substring(0, 200)}"
Response: "${reply.substring(0, 1000)}"`;
          const qaResp = await fetch(`${API_ENDPOINTS.GEMINI}/models/${ORCHESTRATION_AGENTS.qa_gemini_flash.model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gKey },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: qaPrompt }] }], generationConfig: { maxOutputTokens: 1024, temperature: 0.1 } }),
            signal: AbortSignal.timeout(6000),
          });
          if (qaResp.ok) {
            const qaData = await qaResp.json();
            const qaResult = (qaData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (qaResult && qaResult !== 'OK' && qaResult.length > 10 && !qaResult.startsWith('OK')) {
              reply = qaResult;
              provider = provider + '+qa-verified';
            }
          }
        }
      } catch (e) { /* non-critical */ }
    }

    // ── Monitor decision ──
    if (!monitorContent && reply) {
      if (/```[\s\S]+```/.test(reply)) monitorContent = { type: 'code' };
      else if (webSources.length > 0) monitorContent = { type: 'web', sources: webSources };
      else if (accessibilityData) monitorContent = { type: 'accessibility', ...accessibilityData };
      else if (weatherData) monitorContent = { type: 'weather', city: weatherData.city };
      else if (reply.length > 500) monitorContent = { type: 'text', summary: reply.substring(0, 200) + '...' };
    }

    const { emotion, gestures, pose, gaze } = parseEmotionGestures(reply);
    this.conversationCount++;

    const toolsUsed = [];
    if (intent === INTENT.WEB) toolsUsed.push('web_search');
    if (intent === INTENT.CODE) toolsUsed.push('claude_code');
    if (intent === INTENT.MATH) toolsUsed.push('math_reasoner');
    if ([INTENT.VISION, INTENT.VISION_ACCESS].includes(intent)) toolsUsed.push('vision_gpt54');
    if (intent === INTENT.ORCHESTRATE) toolsUsed.push('orchestrator_gpt54');
    if (intent === INTENT.WEATHER) toolsUsed.push('weather_live');

    const result = {
      reply: reply || '',
      enrichedMessage: reply || '',
      language,
      agent: { name: `brain-v3-${provider}` },
      emotion,
      toolsUsed,
      monitor: { content: monitorContent },
      gestures,
      pose,
      bodyActions: [],
      gaze,
      actions: [],
      chainOfThought: trace.steps.map((s) => `${s.agent}: ${s.status || 'ok'}`),
      confidence: reply ? 0.9 : 0.1,
      thinkTime: Date.now() - start,
      intent,
      webSources,
      accessibilityData,
      weatherData: weatherData ? { city: weatherData.city, provider: weatherData.provider } : null,
      geoSource: browserGeo ? 'browser-gps' : clientIp ? 'ip-geo' : null,
    };

    trace.provider = provider;
    trace.totalMs = Date.now() - start;
    this._traces.push(trace);
    if (this._traces.length > this._tracesMax) this._traces.shift();

    if (cacheKey && reply) cacheSet(cacheKey, result, 120).catch(() => {});

    if (userId && reply) {
      this.learnFromConversation(userId, message, reply).catch(() => {});
      this.extractAndSaveFacts(userId, message, reply).catch(() => {});
      this._analyzeAndLearn(userId, message, reply, intent, provider).catch(() => {});
    }

    logger.info(
      { component: 'Brain.v3', intent, provider, ms: Date.now() - start, geoSource: result.geoSource },
      `✅ Brain v3: ${intent} → ${provider} (${Date.now() - start}ms)`
    );

    return result;
  }

  async _analyzeAndLearn(userId, message, reply, intent, provider) {
    if (!supabaseAdmin || !userId) return;
    try {
      await supabaseAdmin.from('procedural_memory').upsert({
        id: require('crypto').randomUUID(),
        user_id: userId,
        pattern_type: 'routing_success',
        trigger_context: message.substring(0, 300),
        action_taken: `intent:${intent} → provider:${provider}`,
        outcome: reply.substring(0, 300),
        tools_used: [intent, provider],
        success_count: 1,
        confidence: 0.8,
      });
      const correctionPatterns = /nu e corect|gresit|incorect|wrong|incorrect|not right|nu asa|altfel|mai incearca|try again|redo|refă/i;
      if (correctionPatterns.test(message)) {
        await this.saveMemory(userId, 'text', `[CORRECTION] ${message.substring(0, 200)}`, { source: 'self-learning', intent, provider, correction: true });
      }
    } catch (e) {
      logger.debug({ component: 'Brain.Learn', err: e.message }, 'analyzeAndLearn failed');
    }
  }

  _getCached(userId) {
    const c = this._memCache.get(userId);
    if (c && Date.now() - c.lastLoad < this._cacheMaxAge) return c;
    return null;
  }
  _setCache(userId, memories, facts) {
    if (this._memCache.size >= this._cacheMaxUsers) {
      const oldest = this._memCache.keys().next().value;
      this._memCache.delete(oldest);
    }
    this._memCache.set(userId, { memories, facts, lastLoad: Date.now() });
  }
  _invalidateCache(userId) { this._memCache.delete(userId); }

  async loadMemory(userId, type, limit = 10) {
    if (!supabaseAdmin || !userId) return [];
    try {
      let q = supabaseAdmin.from('brain_memory').select('id, content, memory_type, importance, metadata, created_at').eq('user_id', userId).order('importance', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
      if (type) q = q.eq('memory_type', type);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'loadMemory failed');
      return [];
    }
  }

  async loadFacts(userId, limit = 15) {
    if (!supabaseAdmin || !userId) return [];
    try {
      const { data, error } = await supabaseAdmin.from('learned_facts').select('id, fact, category, source, confidence, created_at').eq('user_id', userId).order('confidence', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'loadFacts failed');
      return [];
    }
  }

  buildMemoryContext(memories, visualMem, audioMem, facts) {
    const parts = [];
    if (facts?.length > 0) { parts.push('=== KNOWN FACTS ABOUT THIS USER ==='); for (const f of facts) parts.push(`- [${f.category || 'general'}] ${f.fact}`); }
    if (memories?.length > 0) { parts.push('=== RECENT CONVERSATIONS ==='); for (const m of memories) parts.push(`- ${m.content}`); }
    if (visualMem?.length > 0) { parts.push('=== VISUAL MEMORIES ==='); for (const v of visualMem) parts.push(`- ${v.content}`); }
    if (audioMem?.length > 0) { parts.push('=== VOICE MEMORIES ==='); for (const a of audioMem) parts.push(`- ${a.content}`); }
    if (parts.length === 0) return '';
    return '\n\n' + parts.join('\n') + '\n';
  }

  async loadAllMemory(userId) {
    if (!userId) return { memories: [], visualMem: [], audioMem: [], facts: [], context: '' };
    const cached = this._getCached(userId);
    if (cached) {
      return {
        memories: cached.memories.filter((m) => m.memory_type === 'text'),
        visualMem: cached.memories.filter((m) => m.memory_type === 'visual'),
        audioMem: cached.memories.filter((m) => m.memory_type === 'audio'),
        facts: cached.facts,
        context: this.buildMemoryContext(cached.memories.filter((m) => m.memory_type === 'text'), cached.memories.filter((m) => m.memory_type === 'visual'), cached.memories.filter((m) => m.memory_type === 'audio'), cached.facts),
      };
    }
    const [memories, visualMem, audioMem, facts] = await Promise.all([this.loadMemory(userId, 'text', 8), this.loadMemory(userId, 'visual', 4), this.loadMemory(userId, 'audio', 4), this.loadFacts(userId, 15)]);
    this._setCache(userId, [...memories, ...visualMem, ...audioMem], facts);
    return { memories, visualMem, audioMem, facts, context: this.buildMemoryContext(memories, visualMem, audioMem, facts) };
  }

  async buildResumeContext(userId) {
    if (!userId || !supabaseAdmin) return '';
    try {
      const { context } = await this.loadAllMemory(userId);
      this._currentMemoryContext = context;
      return context;
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'buildResumeContext failed');
      return '';
    }
  }

  async saveMemory(userId, type, content, meta) {
    if (!supabaseAdmin || !userId || !content) return;
    try {
      const { error } = await supabaseAdmin.from('brain_memory').insert({ user_id: userId, memory_type: type || 'text', content: content.substring(0, 2000), metadata: meta || {}, importance: type === 'visual' ? 7 : type === 'audio' ? 6 : 5 });
      if (error) throw error;
      this._invalidateCache(userId);
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'saveMemory failed');
    }
  }

  async extractAndSaveFacts(userId, message, reply) {
    if (!supabaseAdmin || !userId) return;
    const gKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!gKey || !circuitAllow('gemini')) return;
    try {
      const prompt = `Extract personal facts about the user from this conversation.
Return ONLY a JSON array: [{"fact": "...", "category": "preference|personal|knowledge|skill|relationship|accessibility"}]
If none, return [].
User: ${message.substring(0, 500).replace(/</g, '&lt;').replace(/>/g, '&gt;')}
Assistant: ${reply.substring(0, 500).replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
      const resp = await fetch(`${API_ENDPOINTS.GEMINI}/models/${MODELS.GEMINI_CHAT}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 512 } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return;
      let facts;
      try { facts = JSON.parse(match[0]); } catch (err) { return; }
      if (!Array.isArray(facts) || facts.length === 0) return;
      const toSave = facts.slice(0, 5).filter((f) => f.fact && typeof f.fact === 'string');
      for (const f of toSave) {
        await supabaseAdmin.from('learned_facts').insert({ user_id: userId, fact: f.fact.substring(0, 500), category: f.category || 'general', source: 'conversation', confidence: 0.7 });
      }
      if (toSave.length > 0) this._invalidateCache(userId);
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, 'extractAndSaveFacts failed');
    }
  }

  async learnFromConversation(userId, message, reply) {
    if (!userId) return;
    await this.saveMemory(userId, 'text', 'User: ' + message.substring(0, 500) + ' | Kelion: ' + reply.substring(0, 500), { source: 'conversation' });
  }

  async _learnFromResponse(message, reply, opts, userId) {
    if (!supabaseAdmin || !userId) return;
    const toolsUsed = opts?.toolsUsed || [];
    if (toolsUsed.length === 0) return;
    try {
      await supabaseAdmin.from('procedural_memory').upsert({ id: require('crypto').randomUUID(), user_id: userId, pattern_type: 'solution', trigger_context: message.substring(0, 300), action_taken: toolsUsed.join(', '), outcome: reply.substring(0, 300), tools_used: toolsUsed, success_count: 1, confidence: 0.5 });
    } catch (e) {
      logger.warn({ component: 'Brain', err: e.message }, '_learnFromResponse failed');
    }
  }

  async _logCost(provider, model, inputTokens, outputTokens, cost) {
    logger.info({ component: 'Brain', provider, model, inputTokens, outputTokens, cost }, `Cost: ${provider}/${model} ~$${cost?.toFixed(6) || '0'}`);
  }

  _recordProvider(name, ms, isError) {
    if (!this._providerStats[name]) this._providerStats[name] = { calls: 0, totalMs: 0, errors: 0, lastCall: null };
    const s = this._providerStats[name];
    s.calls++;
    s.totalMs += ms;
    if (isError) s.errors++;
    s.lastCall = new Date().toISOString();
  }

  getDiagnostics() {
    const avgLatency = {};
    for (const [name, s] of Object.entries(this._providerStats)) avgLatency[name] = s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0;
    return {
      status: 'ok',
      version: 'brain-v3-claude-code-gps-weather',
      conversations: this.conversationCount,
      agents: Object.keys(ORCHESTRATION_AGENTS).length,
      avgLatency,
      providerStats: this._providerStats,
      pipelineTraces: this._traces.slice(-20),
      intents: Object.values(INTENT),
      features: [
        'claude-code-all-avatars',
        'gpt-5.4-vision-premium',
        'gpt-5.4-orchestrator',
        'weather-open-meteo-free-no-key',
        'gps-browser-live',
        'ip-geo-fallback-3-providers',
        'accessibility-audio-description',
        'web-search-perplexity',
        'math-deepseek-reasoner',
        'chat-groq-scout-fast',
        'qa-gemini-flash',
        'memory-supabase-permanent',
        'self-learning',
        'api-key-auto-audit',
      ],
    };
  }
}

module.exports = { KelionBrain, _KelionBrain: KelionBrain };