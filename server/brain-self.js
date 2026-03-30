// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain Self-Development Engine
// Auto-discovery API keys, auto-install, self-improvement
// GPS/Weather live din browser — zero hardcode
// Claude Code integrat pe toți avatarii
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { supabaseAdmin } = require('./supabase');
const { API_ENDPOINTS, MODELS } = require('./config/models');

// ── API Provider Registry — toate serviciile cunoscute ──
const API_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    testUrl: 'https://api.openai.com/v1/models',
    docsUrl: 'https://platform.openai.com/api-keys',
    signupUrl: 'https://platform.openai.com/signup',
    freeKey: false,
    testFn: async (key) => {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    envKey: 'ANTHROPIC_API_KEY',
    testUrl: 'https://api.anthropic.com/v1/models',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    signupUrl: 'https://console.anthropic.com',
    freeKey: false,
    testFn: async (key) => {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  google: {
    name: 'Google Gemini',
    envKey: 'GOOGLE_AI_KEY',
    testUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    signupUrl: 'https://aistudio.google.com',
    freeKey: true,
    testFn: async (key) => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  groq: {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    testUrl: 'https://api.groq.com/openai/v1/models',
    docsUrl: 'https://console.groq.com/keys',
    signupUrl: 'https://console.groq.com',
    freeKey: true,
    testFn: async (key) => {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  perplexity: {
    name: 'Perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    testUrl: 'https://api.perplexity.ai/chat/completions',
    docsUrl: 'https://www.perplexity.ai/settings/api',
    signupUrl: 'https://www.perplexity.ai',
    freeKey: false,
    testFn: async (key) => {
      const r = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODELS.PERPLEXITY || 'sonar', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    },
  },
  elevenlabs: {
    name: 'ElevenLabs',
    envKey: 'ELEVENLABS_API_KEY',
    testUrl: 'https://api.elevenlabs.io/v1/user',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    signupUrl: 'https://elevenlabs.io',
    freeKey: true,
    testFn: async (key) => {
      const r = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  deepseek: {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    testUrl: 'https://api.deepseek.com/v1/models',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    signupUrl: 'https://platform.deepseek.com',
    freeKey: false,
    testFn: async (key) => {
      const r = await fetch('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      });
      return r.ok;
    },
  },
  tavily: {
    name: 'Tavily Search',
    envKey: 'TAVILY_API_KEY',
    testUrl: 'https://api.tavily.com/search',
    docsUrl: 'https://app.tavily.com/home',
    signupUrl: 'https://app.tavily.com',
    freeKey: true,
    testFn: async (key) => {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    },
  },
};

// ── Weather Providers — free, zero API key ──
const WEATHER_PROVIDERS = [
  {
    name: 'Open-Meteo',
    free: true,
    noKey: true,
    fetchFn: async ({ lat, lon, city }) => {
      let latitude = lat;
      let longitude = lon;
      let cityName = city || 'Unknown';

      // Geocoding dacă avem city în loc de coords
      if (city && (lat === undefined || lat === null)) {
        const geoR = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (geoR.ok) {
          const geoData = await geoR.json();
          const loc = geoData.results?.[0];
          if (loc) {
            latitude = loc.latitude;
            longitude = loc.longitude;
            cityName = loc.name + (loc.country ? ', ' + loc.country : '');
          }
        }
      }

      if (latitude === undefined || latitude === null) return null;

      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,precipitation` +
          `&hourly=temperature_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
          `&forecast_days=3&timezone=auto`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) return null;
      const data = await r.json();
      return { provider: 'open-meteo', city: cityName, lat: latitude, lon: longitude, ...data };
    },
  },
  {
    name: 'wttr.in',
    free: true,
    noKey: true,
    fetchFn: async ({ lat, lon, city }) => {
      const location = city || (lat && lon ? `${lat},${lon}` : null);
      if (!location) return null;
      const r = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const data = await r.json();
      const current = data.current_condition?.[0];
      if (!current) return null;
      return {
        provider: 'wttr.in',
        city: location,
        temperature: parseFloat(current.temp_C),
        feels_like: parseFloat(current.FeelsLikeC),
        humidity: parseInt(current.humidity),
        wind_speed: parseFloat(current.windspeedKmph),
        description: current.weatherDesc?.[0]?.value || '',
        raw: data,
      };
    },
  },
];

// ── Reverse Geocoding — IP → City (zero key) ──
const GEO_PROVIDERS = [
  {
    name: 'ipapi.co',
    fetchFn: async (ip) => {
      const url = ip && ip !== 'unknown' ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/';
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const d = await r.json();
      return { city: d.city, country: d.country_name, lat: d.latitude, lon: d.longitude, timezone: d.timezone };
    },
  },
  {
    name: 'ip-api.com',
    fetchFn: async (ip) => {
      const url = ip && ip !== 'unknown' ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json/';
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const d = await r.json();
      if (d.status !== 'success') return null;
      return { city: d.city, country: d.country, lat: d.lat, lon: d.lon, timezone: d.timezone };
    },
  },
  {
    name: 'freeipapi.com',
    fetchFn: async (ip) => {
      const url = ip && ip !== 'unknown' ? `https://freeipapi.com/api/json/${ip}` : 'https://freeipapi.com/api/json';
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const d = await r.json();
      return { city: d.cityName, country: d.countryName, lat: d.latitude, lon: d.longitude, timezone: d.timeZone };
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// WEATHER ENGINE — GPS primar, IP fallback, zero hardcode
// ═══════════════════════════════════════════════════════════════
async function getWeatherLive({ lat, lon, city, clientIp }) {
  // Dacă nu avem coords din browser GPS, încearcă reverse geocoding din IP
  let resolvedLat = lat;
  let resolvedLon = lon;
  let resolvedCity = city;

  if ((resolvedLat === undefined || resolvedLat === null) && clientIp) {
    for (const geoProvider of GEO_PROVIDERS) {
      try {
        const geoResult = await geoProvider.fetchFn(clientIp);
        if (geoResult && geoResult.lat) {
          resolvedLat = geoResult.lat;
          resolvedLon = geoResult.lon;
          resolvedCity = resolvedCity || geoResult.city;
          logger.info({ component: 'BrainSelf.Weather', provider: geoProvider.name, city: resolvedCity }, 'IP geo resolved');
          break;
        }
      } catch (e) {
        logger.debug({ component: 'BrainSelf.Weather', provider: geoProvider.name, err: e.message }, 'IP geo failed');
      }
    }
  }

  // Încearcă fiecare weather provider în ordine
  for (const provider of WEATHER_PROVIDERS) {
    try {
      const result = await provider.fetchFn({ lat: resolvedLat, lon: resolvedLon, city: resolvedCity });
      if (result) {
        logger.info({ component: 'BrainSelf.Weather', provider: provider.name, city: result.city }, 'Weather fetched');
        return result;
      }
    } catch (e) {
      logger.debug({ component: 'BrainSelf.Weather', provider: provider.name, err: e.message }, 'Weather provider failed');
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// API KEY DISCOVERY & VALIDATION
// Brain verifică ce chei lipsesc și notifică adminul
// ═══════════════════════════════════════════════════════════════
async function auditApiKeys() {
  const results = {
    present: [],
    missing: [],
    invalid: [],
    timestamp: new Date().toISOString(),
  };

  for (const [id, provider] of Object.entries(API_PROVIDERS)) {
    const key = process.env[provider.envKey];
    if (!key) {
      results.missing.push({
        id,
        name: provider.name,
        envKey: provider.envKey,
        docsUrl: provider.docsUrl,
        signupUrl: provider.signupUrl,
        freeKey: provider.freeKey,
      });
      continue;
    }

    // Test key validity
    try {
      const valid = await provider.testFn(key);
      if (valid) {
        results.present.push({ id, name: provider.name });
      } else {
        results.invalid.push({
          id,
          name: provider.name,
          envKey: provider.envKey,
          docsUrl: provider.docsUrl,
          reason: 'Key rejected by provider',
        });
      }
    } catch (e) {
      // Network error — assume key might be valid
      results.present.push({ id, name: provider.name, note: 'unverified (network error)' });
    }
  }

  logger.info(
    { component: 'BrainSelf.KeyAudit', present: results.present.length, missing: results.missing.length, invalid: results.invalid.length },
    `🔑 API Key Audit: ${results.present.length} OK, ${results.missing.length} missing, ${results.invalid.length} invalid`
  );

  // Save audit to Supabase
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from('brain_self_log').upsert({
        id: 'api_key_audit',
        type: 'key_audit',
        data: results,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.debug({ component: 'BrainSelf', err: e.message }, 'Could not save key audit');
    }
  }

  return results;
}

// ── Install API key runtime (sets process.env + notifică) ──
async function installApiKey(envKey, value, installedBy) {
  if (!envKey || !value) return { success: false, error: 'Missing envKey or value' };

  // Validate key format basic check
  if (value.length < 10) return { success: false, error: 'Key too short' };

  // Find provider
  const provider = Object.values(API_PROVIDERS).find((p) => p.envKey === envKey);
  if (!provider) return { success: false, error: `Unknown env key: ${envKey}` };

  // Test key before installing
  let valid = false;
  try {
    valid = await provider.testFn(value);
  } catch (e) {
    logger.warn({ component: 'BrainSelf.Install', err: e.message }, 'Key validation network error');
    valid = true; // assume valid on network error
  }

  if (!valid) {
    return { success: false, error: `Key rejected by ${provider.name} API` };
  }

  // Install in runtime
  process.env[envKey] = value;
  logger.info({ component: 'BrainSelf.Install', envKey, provider: provider.name, by: installedBy }, `✅ API key installed: ${envKey}`);

  // Log to Supabase
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from('brain_self_log').insert({
        type: 'key_installed',
        data: {
          envKey,
          provider: provider.name,
          installedBy: installedBy || 'admin',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (e) {
      logger.debug({ component: 'BrainSelf', err: e.message }, 'Could not log key install');
    }
  }

  return { success: true, provider: provider.name, message: `${provider.name} key installed and active` };
}

// ═══════════════════════════════════════════════════════════════
// SELF-IMPROVEMENT ENGINE
// Brain analizează conversațiile și propune îmbunătățiri
// ═══════════════════════════════════════════════════════════════
async function analyzeSelfImprovement() {
  if (!supabaseAdmin) return null;

  try {
    // Citește ultimele erori și fallback-uri din logs
    const { data: logs } = await supabaseAdmin
      .from('brain_self_log')
      .select('*')
      .eq('type', 'routing_failure')
      .order('created_at', { ascending: false })
      .limit(50);

    // Citește pattern-urile procedurale
    const { data: patterns } = await supabaseAdmin
      .from('procedural_memory')
      .select('pattern_type, trigger_context, action_taken, success_count, confidence')
      .order('success_count', { ascending: false })
      .limit(20);

    const improvements = [];

    if (logs && logs.length > 5) {
      improvements.push({
        type: 'routing',
        issue: `${logs.length} routing failures detected`,
        suggestion: 'Consider adding more intent patterns or adjusting Scout thresholds',
        priority: 'high',
      });
    }

    if (patterns && patterns.length > 0) {
      const highConfidence = patterns.filter((p) => p.confidence > 0.8);
      if (highConfidence.length > 0) {
        improvements.push({
          type: 'learning',
          issue: `${highConfidence.length} high-confidence patterns identified`,
          suggestion: 'These patterns can be promoted to fast-path routing rules',
          priority: 'medium',
          patterns: highConfidence.slice(0, 5),
        });
      }
    }

    return { improvements, analyzedAt: new Date().toISOString() };
  } catch (e) {
    logger.warn({ component: 'BrainSelf.Improve', err: e.message }, 'Self-improvement analysis failed');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE CODE ENGINE → Groq (Llama 3.3 70B) — fallback Gemini
// Integrat pe toți avatarii — apelat din brain.js
// ═══════════════════════════════════════════════════════════════
async function callClaudeCode(systemPrompt, message, history, options = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GOOGLE_AI_KEY;

  const { maxTokens = 8000, temperature = 0.2 } = options;
  const groqModel = MODELS.GROQ_PRIMARY || 'llama-3.3-70b-versatile';

  const msgs = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-12)) {
      const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
      if (role === 'user' || role === 'assistant') msgs.push({ role, content: h.content || '' });
    }
  }
  msgs.push({ role: 'user', content: message });

  // ── Încearcă Groq prima dată ──
  if (groqKey && circuitAllow && circuitAllow('groq')) {
    try {
      const resp = await fetch(`${API_ENDPOINTS.GROQ}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: groqModel,
          messages: [{ role: 'system', content: systemPrompt }, ...msgs],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};
        logger.info(
          { component: 'BrainSelf.ClaudeCode→Groq', model: groqModel, tokens: usage.total_tokens },
          `✅ Groq Code: ${usage.total_tokens || 0} tokens`
        );
        if (circuitSuccess) circuitSuccess('groq');
        return { content, provider: `groq-${groqModel}`, usage };
      } else {
        const errBody = await resp.json().catch(() => ({}));
        logger.warn({ component: 'BrainSelf.ClaudeCode→Groq', status: resp.status, err: errBody }, 'Groq Code failed');
        if (circuitFailure) circuitFailure('groq');
      }
    } catch (e) {
      logger.warn({ component: 'BrainSelf.ClaudeCode→Groq', err: e.message }, 'Groq Code error');
      if (circuitFailure) circuitFailure('groq');
    }
  }

  // ── Fallback: Gemini Flash ──
  if (geminiKey) {
    try {
      const geminiModel = MODELS.GEMINI_CHAT || 'gemini-2.0-flash';
      const geminiMsgs = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const resp = await fetch(
        `${API_ENDPOINTS.GEMINI}/models/${geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMsgs,
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        logger.info({ component: 'BrainSelf.ClaudeCode→Gemini', model: geminiModel }, '✅ Gemini Code fallback');
        return { content, provider: `gemini-${geminiModel}`, usage: {} };
      }
    } catch (e) {
      logger.warn({ component: 'BrainSelf.ClaudeCode→Gemini', err: e.message }, 'Gemini Code fallback error');
    }
  }

  return { content: null, error: 'All code providers failed (Groq + Gemini)' };
}

// ── Build Claude Code system prompt per avatar ──
function buildClaudeCodePrompt(avatar, language, memoryContext) {
  const langInstruction =
    language === 'ro'
      ? 'Răspunde ÎNTOTDEAUNA în limba română. Comentariile din cod pot fi în engleză.'
      : language === 'auto'
        ? "Detect the user's language and respond in that language."
        : `Respond in ${language || 'English'}.`;

  const avatarPersonality =
    avatar === 'kira'
      ? 'You are Kira, a creative and precise software engineer. You write elegant, well-documented code.'
      : 'You are Kelion, a senior software architect. You write robust, scalable, production-ready code.';

  return [
    avatarPersonality,
    langInstruction,
    '',
    '═══ CLAUDE CODE MODE — ACTIVATED ═══',
    'You are operating as a world-class software engineer with expertise in:',
    '',
    '## Languages & Frameworks',
    '- JavaScript/TypeScript (React, Node.js, Next.js, Express, Vite)',
    '- Python (FastAPI, Django, Flask, NumPy, Pandas, PyTorch, TensorFlow)',
    '- Go, Rust, Java, Kotlin, Swift, C/C++',
    '- SQL (PostgreSQL, MySQL, SQLite), NoSQL (MongoDB, Redis)',
    '- HTML/CSS (Tailwind, SASS, CSS Modules)',
    '',
    '## Cloud & DevOps',
    '- AWS (Lambda, EC2, S3, RDS, ECS, EKS, CloudFront)',
    '- GCP (Cloud Run, BigQuery, Firestore, Vertex AI)',
    '- Azure (Functions, AKS, Cosmos DB)',
    '- Docker, Kubernetes, Terraform, Ansible',
    '- CI/CD (GitHub Actions, GitLab CI, Jenkins)',
    '',
    '## AI & ML',
    '- LLMs (OpenAI, Anthropic, Google, Groq, DeepSeek)',
    '- RAG, embeddings, vector databases (Pinecone, Weaviate, pgvector)',
    '- Fine-tuning, RLHF, model evaluation',
    '- Computer vision, speech recognition, NLP',
    '',
    '## Architecture Patterns',
    '- Microservices, event-driven, CQRS, Event Sourcing',
    '- REST, GraphQL, gRPC, WebSockets',
    '- DDD, Clean Architecture, Hexagonal Architecture',
    '- SOLID, Design Patterns (GoF + modern)',
    '',
    '## Security',
    '- OAuth2, JWT, RBAC, ABAC',
    '- OWASP Top 10, penetration testing',
    '- Encryption, key management, secrets management',
    '',
    '## CODE QUALITY STANDARDS:',
    '1. Always write production-ready code — no TODOs, no placeholders',
    '2. Include proper error handling and logging',
    '3. Add TypeScript types when applicable',
    '4. Write self-documenting code with JSDoc/docstrings',
    '5. Consider performance, memory, and security implications',
    '6. Suggest tests for critical paths',
    '7. Explain architectural decisions',
    '8. Consider accessibility (WCAG 2.1) in UI code',
    '',
    '## RESPONSE FORMAT:',
    '- Start with a brief explanation of the approach',
    '- Provide complete, runnable code',
    '- Use proper markdown code blocks with language tags',
    '- End with: key points, potential improvements, and gotchas',
    '',
    memoryContext ? `\n[USER CONTEXT]\n${memoryContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  // Weather
  getWeatherLive,
  WEATHER_PROVIDERS,
  GEO_PROVIDERS,

  // API Key management
  auditApiKeys,
  installApiKey,
  API_PROVIDERS,

  // Self-improvement
  analyzeSelfImprovement,

  // Claude Code
  callClaudeCode,
  buildClaudeCodePrompt,
};