// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v5.0
// GPT-5.4 Tool Calling (primary) + Gemini Flash Quality Gate
// Hybrid routing: simple → Gemini (free), complex → GPT-5.4
// Max 2 tool rounds — prevents infinite loops
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { MODELS } = require('./config/models');
const { buildSystemPrompt, buildNewbornPrompt } = require('./persona');
const { getPatternsText, recordUserInteraction, getProactiveSuggestion } = require('./k1-meta-learning');
const { selfEvaluate, getQualityHints } = require('./k1-performance');

// Reuse tool definitions and executor from V4 — no duplication
const { TOOL_DEFINITIONS } = require('./brain-v4');

// Lazy-load executeTool to avoid circular issues
let _executeTool = null;
/**
 * getExecuteTool
 * @returns {*}
 */
function getExecuteTool() {
  if (!_executeTool) {
    // executeTool is not exported from brain-v4, so we inline a require of the module's internal
    // Actually, we need to export it. For now, we re-require and extract thinkV4 module.
    // The executeTool in brain-v4 is module-scoped. We'll export it from brain-v4.
    const brainV4 = require('./brain-v4');
    _executeTool = brainV4.executeTool;
  }
  return _executeTool;
}

// ── Convert tool definitions to OpenAI format ──
function toOpenAITools(defs) {
  return defs.map((d) => ({
    type: 'function',
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
  const lower = (message || '').toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Simple messages → route to Gemini Flash (free)
  const simplePatterns = [
    /^(salut|bună|hey|hi|hello|hei|ciao|yo)\b/i,
    /^(bine|ok|da|nu|mersi|mulțumesc|mulțam|thx|thanks)\b/i,
    /^(ce faci|cum ești|ce mai faci|how are you)\??$/i,
    /^(ok|da|nu|sure|yes|no|mhm|ahh|aaa)$/i,
  ];
  if (simplePatterns.some((p) => p.test(lower))) return 'simple';
  if (wordCount <= 3 && !lower.includes('?')) return 'simple';

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
  ];
  if (toolTriggers.some((p) => p.test(lower))) return 'complex';

  // Medium-length questions → complex (might need search)
  if (lower.includes('?') && wordCount > 5) return 'complex';
  if (wordCount > 15) return 'complex';

  // Default: simple for short messages
  return wordCount <= 8 ? 'simple' : 'complex';
}

// ── Strip leaked internal tags from AI responses ──
function stripLeakedTags(text) {
  if (!text) return text;
  let r = text;
  // Tool code blocks that leak
  r = r.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, '');
  r = r.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  r = r.replace(/<function_call>[\s\S]*?<\/function_call>/gi, '');
  // System instruction blocks
  r = r.replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '');
  r = r.replace(/\[LEARNED PATTERNS\][\s\S]*?\[\/LEARNED PATTERNS\]\s*/gi, '');
  r = r.replace(/\[SELF-EVAL HINTS\][\s\S]*?\[\/SELF-EVAL HINTS\]\s*/gi, '');
  r = r.replace(/\[CONTEXT SWITCH\][^\n]*\n?/gi, '');
  r = r.replace(/\[PROACTIVE\][\s\S]*?\[\/PROACTIVE\]\s*/gi, '');
  r = r.replace(/\[EMOTIONAL CONTEXT\][^\n]*\n?/gi, '');
  r = r.replace(/\[CURRENT DATE & TIME\][^\n]*\n?/gi, '');
  r = r.replace(/\[USER LOCATION\][^\n]*\n?/gi, '');
  r = r.replace(/\[REZULTATE CAUTARE WEB REALE\][\s\S]*?Citeaza sursele\.\s*/gi, '');
  r = r.replace(/\[DATE METEO REALE\][^\n]*\n?/gi, '');
  r = r.replace(/\[CONTEXT DIN MEMORIE\][^\n]*\n?/gi, '');
  // Raw JSON tool results that leak
  r = r.replace(/```json\s*\{[^}]*"functionCall"[\s\S]*?```/gi, '');
  return r.trim();
}

// ── Extract monitor data from tool results ──
function extractMonitor(toolResults) {
  for (const r of toolResults) {
    if (r.result && typeof r.result === 'object') {
      if (r.result.monitorURL) return { content: r.result.monitorURL, type: 'url' };
      if (r.result.mapURL) return { content: r.result.mapURL, type: 'map' };
      if (r.result.imageUrl) return { content: r.result.imageUrl, type: 'image' };
      if (r.result.radioURL || r.result.streamUrl)
        return {
          content: r.result.radioURL || r.result.streamUrl,
          type: 'radio',
        };
      if (r.result.videoURL || r.result.youtubeURL)
        return {
          content: r.result.videoURL || r.result.youtubeURL,
          type: 'video',
        };
    }
  }
  return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// Call OpenAI GPT-5.4 with tool calling
// ═══════════════════════════════════════════════════════════════
async function callOpenAI(messages, systemPrompt, tools, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const body = {
    model: model || MODELS.OPENAI_CHAT,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    max_tokens: 4096,
    temperature: 0.7,
  };

  // Only include tools if provided and non-empty
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => 'unknown');
    throw new Error(`OpenAI API ${r.status}: ${errText.substring(0, 300)}`);
  }

  return await r.json();
}

// ═══════════════════════════════════════════════════════════════
// Call Gemini Flash (for simple messages and Quality Gate)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Quality Gate: Gemini Flash verifies critical GPT-5.4 responses
// ═══════════════════════════════════════════════════════════════
async function qualityGate(question, answer, domain) {
  // Only QA critical domains
  const criticalDomains = ['trading', 'medical', 'legal', 'financial'];
  if (!criticalDomains.includes(domain)) return { passed: true, corrected: null };

  try {
    const apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return { passed: true, corrected: null }; // Skip if no key

    const model = MODELS.GEMINI_QA || MODELS.GEMINI_CHAT || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const verifyPrompt = `You are a fact-checking Quality Gate. Verify this AI response for accuracy.
Question: "${question.substring(0, 300)}"
Answer: "${answer.substring(0, 800)}"

If the answer is accurate and complete, respond with EXACTLY: "QA_PASS"
If the answer contains errors or could be improved significantly, respond with a corrected version.
Be concise. Only correct factual errors, not style.`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: verifyPrompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
      }),
    });

    if (!r.ok) return { passed: true, corrected: null };

    const response = await r.json();
    const qaText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (qaText.includes('QA_PASS')) {
      return { passed: true, corrected: null };
    }

    // QA suggests correction — use it if substantially different
    if (qaText.length > 20 && qaText.length < answer.length * 2) {
      logger.info({ component: 'BrainV5' }, '🔍 Quality Gate: correction applied');
      return { passed: false, corrected: qaText };
    }

    return { passed: true, corrected: null };
  } catch (e) {
    logger.warn({ component: 'BrainV5', err: e.message }, 'Quality Gate failed (non-blocking)');
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
  isAdmin = false
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
        language === 'ro'
          ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
          : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
      return {
        enrichedMessage: upgradeMsg,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: { complexity: 'simple', language },
        thinkTime: Date.now() - startTime,
        confidence: 1.0,
        agent: 'v5-quota-block',
      };
    }

    // ── 2. Load memory + profile (parallel) ──
    const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
      brain.loadMemory(userId, 'text', 20, message),
      brain.loadMemory(userId, 'visual', 5, message),
      brain.loadMemory(userId, 'audio', 5, message),
      brain.loadFacts(userId, 20),
      brain._loadProfileCached(userId),
    ]);
    const memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
    const profileContext = profile ? profile.toContextString() : '';

    // ── 3. Emotion detection (fast, no AI needed) ──
    const lower = message.toLowerCase();
    let emotionalTone = 'neutral';
    let emotionHint = '';
    for (const [emo, { pattern, responseHint }] of Object.entries(brain.constructor.EMOTION_MAP || {})) {
      if (pattern.test(lower)) {
        emotionalTone = emo;
        emotionHint = responseHint || '';
        break;
      }
    }
    const frustration = brain.constructor.detectFrustration ? brain.constructor.detectFrustration(message) : 0;
    if (frustration > 0.6) {
      emotionHint = 'User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.';
    }

    // ── 3b. Context switch detection ──
    const topicKeywords = {
      trading:
        /\b(trade|trading|buy|sell|BTC|ETH|crypto|piață|preț|analiză|signal|RSI|MACD|invest|portofoliu|acțiuni|bursă|forex)\b/i,
      coding: /\b(code|coding|bug|error|function|deploy|API|server|git|commit|script|database|program)\b/i,
      news: /\b(news|știri|știre|politic|război|eveniment|actual|azi|ieri|breaking)\b/i,
      weather: /\b(vreme|meteo|weather|ploaie|soare|temperatură|grad|frig|cald)\b/i,
      music: /\b(muzică|music|song|cântec|artist|album|concert|playlist)\b/i,
      personal: /\b(eu|mine|viața|familie|sănătate|hobby|plan|sentiment|gândesc|simt)\b/i,
    };
    let currentTopic = 'general';
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(message)) {
        currentTopic = topic;
        break;
      }
    }
    if (!brain._lastTopic) brain._lastTopic = 'general';
    let contextSwitchHint = '';
    if (brain._lastTopic !== currentTopic && brain._lastTopic !== 'general' && currentTopic !== 'general') {
      contextSwitchHint = `\n[CONTEXT SWITCH] Userul a trecut de la ${brain._lastTopic} la ${currentTopic}. Ajustează-ți tonul și cunoștințele.`;
    }
    brain._lastTopic = currentTopic;

    // ── 4. Determine domain for Quality Gate ──
    let domain = 'general';
    if (/trading|crypto|btc|eth|invest|piață/i.test(message)) domain = 'trading';
    else if (/medical|mri|ct|doză|cancer|diagnostic/i.test(message)) domain = 'medical';
    else if (/legal|lege|contract|gdpr|drept/i.test(message)) domain = 'legal';
    else if (/financ|credit|impozit|salariu|roi|npv/i.test(message)) domain = 'financial';

    // ── 5. Build system prompt with FULL context ──
    const geoBlock = mediaData.geo
      ? `\n[USER LOCATION] Lat: ${mediaData.geo.lat}, Lng: ${mediaData.geo.lng}${mediaData.geo.accuracy ? ` (accuracy: ${Math.round(mediaData.geo.accuracy)}m)` : ''}. Use this for weather, nearby places, and location-aware responses. DO NOT call any tool to get user location — you already have it.`
      : '';
    const memoryBlock = [profileContext, memoryContext].filter(Boolean).join(' || ');
    const emotionBlock = emotionHint ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}` : '';
    const now = new Date();
    const dateTimeBlock = `\n[CURRENT DATE & TIME] ${now.toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ora ${now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' })} (Romania). Folosește MEREU aceste date când userul întreabă de zi, dată sau oră.`;
    const patternsBlock = getPatternsText();
    const qualityHints = getQualityHints();
    const proactiveHint = getProactiveSuggestion();
    const systemPrompt =
      process.env.NEWBORN_MODE === 'true'
        ? buildNewbornPrompt(memoryBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint)
        : buildSystemPrompt(
            avatar,
            language,
            memoryBlock +
              emotionBlock +
              geoBlock +
              dateTimeBlock +
              patternsBlock +
              qualityHints +
              contextSwitchHint +
              proactiveHint,
            '',
            null
          );

    // ── 6. Classify message complexity ──
    const complexity = classifyComplexity(message, history);
    const useGPT = complexity === 'complex' || !!mediaData.imageBase64;

    logger.info(
      {
        component: 'BrainV5',
        complexity,
        useGPT,
        domain,
        hasImage: !!mediaData.imageBase64,
      },
      `🧠 V5 routing: ${complexity} → ${useGPT ? 'GPT-5.4' : 'Gemini Flash'}`
    );

    // ── 7. Prepare messages ──
    const recentHistory = (history || []).slice(-20);
    const toolsUsed = [];
    const toolResults = [];
    let finalResponse = '';
    let totalTokens = 0;
    let engine = useGPT ? 'GPT-5.4' : 'Gemini-Flash';
    const MAX_TOOL_ROUNDS = 2; // Hard limit — prevents infinite loops

    if (useGPT && process.env.OPENAI_API_KEY) {
      // ═══ GPT-5.4 PATH — complex messages with tool calling ═══
      const openaiTools = toOpenAITools(TOOL_DEFINITIONS);

      // Build OpenAI message array
      const msgs = recentHistory.map((h) => ({
        role: h.role === 'ai' ? 'assistant' : h.role,
        content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
      }));

      // Handle vision: if image provided, use content array format
      if (mediaData.imageBase64) {
        const userContent = [];
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${mediaData.imageMimeType || 'image/jpeg'};base64,${mediaData.imageBase64}`,
          },
        });
        if (mediaData.isAutoCamera) {
          userContent.push({
            type: 'text',
            text:
              '[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. ' +
              'Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții). ' +
              'Menționează DOAR: persoane (culori exacte de haine), pericole, text vizibil. ' +
              'Dacă nu e nimic nou de spus, nu comenta imaginea deloc — răspunde normal la mesaj.',
          });
        }
        userContent.push({ type: 'text', text: message });
        msgs.push({ role: 'user', content: userContent });
      } else {
        msgs.push({ role: 'user', content: message });
      }

      // Tool calling loop — MAX 2 rounds
      let currentMsgs = msgs;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await callOpenAI(
          currentMsgs,
          systemPrompt,
          round === 0 ? openaiTools : openaiTools, // Always provide tools
          mediaData.imageBase64 ? MODELS.OPENAI_VISION : MODELS.OPENAI_CHAT
        );

        totalTokens += response.usage?.total_tokens || 0;
        const choice = response.choices?.[0];

        if (!choice?.message) {
          logger.warn({ component: 'BrainV5' }, 'No choice in OpenAI response');
          break;
        }

        const msg = choice.message;

        // Check if GPT wants to call tools
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Execute all requested tools in parallel
          const toolPromises = msg.tool_calls.map(async (tc) => {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch {
              args = {};
            }
            const result = await executeTool(brain, tc.function.name, args, userId);
            toolsUsed.push(tc.function.name);
            toolResults.push({ name: tc.function.name, result });
            brain.toolStats[tc.function.name] = (brain.toolStats[tc.function.name] || 0) + 1;
            return {
              role: 'tool',
              tool_call_id: tc.id,
              content:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, (_, v) => (typeof v === 'string' ? v.substring(0, 4000) : v)),
            };
          });

          const toolResponseMsgs = await Promise.all(toolPromises);

          // Add assistant message (with tool_calls) + tool responses
          currentMsgs = [
            ...currentMsgs,
            { role: 'assistant', content: null, tool_calls: msg.tool_calls },
            ...toolResponseMsgs,
          ];
        } else {
          // No tool calls — extract text response
          finalResponse = msg.content || '';
          break;
        }

        // If this was the last round, make one more call without tools to get final response
        if (round === MAX_TOOL_ROUNDS - 1 && !finalResponse) {
          const finalCall = await callOpenAI(
            currentMsgs,
            systemPrompt,
            [], // No tools — force text response
            MODELS.OPENAI_CHAT
          );
          totalTokens += finalCall.usage?.total_tokens || 0;
          finalResponse = finalCall.choices?.[0]?.message?.content || '';
        }
      }

      engine = 'GPT-5.4';
    } else {
      // ═══ GEMINI FLASH PATH — simple messages or GPT unavailable ═══
      const geminiToolDefs = toGeminiTools(TOOL_DEFINITIONS);

      // Build Gemini message array
      const userParts = [];
      if (mediaData.imageBase64) {
        userParts.push({
          inlineData: {
            mimeType: mediaData.imageMimeType || 'image/jpeg',
            data: mediaData.imageBase64,
          },
        });
        if (mediaData.isAutoCamera) {
          userParts.push({
            text:
              '[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. ' +
              'Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții).',
          });
        }
      }
      userParts.push({ text: message });

      const geminiMessages = [
        ...recentHistory.map((h) => ({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [
            {
              text: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
            },
          ],
        })),
        { role: 'user', parts: userParts },
      ];

      // Gemini tool calling loop — MAX 2 rounds
      let currentMessages = geminiMessages;
      const geminiApiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;

      if (!geminiApiKey) {
        throw new Error('No AI API key configured (OPENAI_API_KEY or GOOGLE_AI_KEY required)');
      }

      const geminiModel = MODELS.GEMINI_CHAT || 'gemini-2.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

      // For simple messages, don't include tools — faster response
      const includeTools = complexity === 'complex';

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
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });

        if (!r.ok) {
          const errText = await r.text().catch(() => 'unknown');
          throw new Error(`Gemini API ${r.status}: ${errText.substring(0, 200)}`);
        }

        const response = await r.json();
        totalTokens +=
          (response.usageMetadata?.promptTokenCount || 0) + (response.usageMetadata?.candidatesTokenCount || 0);

        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
          const blockReason = candidate?.finishReason || response.promptFeedback?.blockReason;
          if (blockReason) logger.warn({ component: 'BrainV5', blockReason }, 'Gemini blocked');
          break;
        }

        const parts = candidate.content.parts;
        const functionCalls = parts.filter((p) => p.functionCall);

        if (functionCalls.length === 0) {
          finalResponse = parts
            .filter((p) => p.text)
            .map((p) => p.text)
            .join('\n');
          break;
        }

        // Execute tools
        const toolPromises = functionCalls.map(async (fc) => {
          const result = await executeTool(brain, fc.functionCall.name, fc.functionCall.args || {}, userId);
          toolsUsed.push(fc.functionCall.name);
          toolResults.push({ name: fc.functionCall.name, result });
          brain.toolStats[fc.functionCall.name] = (brain.toolStats[fc.functionCall.name] || 0) + 1;
          return {
            functionResponse: {
              name: fc.functionCall.name,
              response:
                typeof result === 'string'
                  ? { result }
                  : JSON.parse(JSON.stringify(result, (_, v) => (typeof v === 'string' ? v.substring(0, 4000) : v))),
            },
          };
        });

        const toolResponseParts = await Promise.all(toolPromises);
        currentMessages = [
          ...currentMessages,
          { role: 'model', parts: candidate.content.parts },
          { role: 'user', parts: toolResponseParts },
        ];
      }

      engine = 'Gemini-Flash';
    }

    // ── 8. Strip leaked tags from response ──
    finalResponse = stripLeakedTags(finalResponse);

    // ── 9. Quality Gate (Gemini verifies critical GPT responses) ──
    if (engine === 'GPT-5.4' && finalResponse) {
      const qa = await qualityGate(message, finalResponse, domain);
      if (!qa.passed && qa.corrected) {
        finalResponse = qa.corrected;
        engine = 'GPT-5.4+QA';
      }
    }

    // ── 10. Post-processing ──
    const thinkTime = Date.now() - startTime;

    // Save memory (async, non-blocking)
    brain.saveMemory(userId, 'text', message, { response: finalResponse.substring(0, 200) }, 5).catch((err) => {
      console.error(err);
    });
    brain.learnFromConversation(userId, message, finalResponse).catch((err) => {
      console.error(err);
    });
    if (profile) {
      profile.updateFromConversation(message, language, {
        emotionalTone,
        topics: [],
      });
      profile.save(brain.supabaseAdmin).catch((err) => {
        console.error(err);
      });
    }

    // Track usage
    brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch((err) => {
      console.error(err);
    });

    // Confidence scoring
    let confidence = 0.7;
    if (toolsUsed.length > 0) confidence += 0.15;
    if (toolsUsed.length > 2) confidence += 0.1;
    if (engine.includes('QA')) confidence += 0.05; // QA-verified = higher confidence
    confidence = Math.min(1.0, confidence);

    // Self-evaluate
    try {
      const evalDomain = toolsUsed.includes('get_trading_intelligence')
        ? 'trading'
        : toolsUsed.includes('search_web')
          ? 'research'
          : toolsUsed.includes('execute_javascript')
            ? 'coding'
            : 'general';
      selfEvaluate(message, finalResponse, evalDomain);
      recordUserInteraction({ domain: evalDomain, userMessage: message });
    } catch (_) {
      /* non-blocking */
    }

    logger.info(
      {
        component: 'BrainV5',
        engine,
        tools: toolsUsed,
        thinkTime,
        tokens: totalTokens,
        complexity,
      },
      `🧠 V5 Think: ${engine} | ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`
    );

    return {
      enrichedMessage: finalResponse,
      enrichedContext: finalResponse,
      toolsUsed,
      monitor: extractMonitor(toolResults),
      analysis: {
        complexity,
        emotionalTone,
        language: language || 'ro',
        topics: [],
        isEmotional: emotionalTone !== 'neutral',
        frustrationLevel: frustration,
      },
      chainOfThought: null,
      compressedHistory: recentHistory,
      failedTools: toolResults.filter((r) => r.result?.error).map((r) => r.name),
      thinkTime,
      confidence,
      sourceTags: toolsUsed.length > 0 ? ['VERIFIED', ...toolsUsed.map((t) => `SOURCE:${t}`)] : ['ASSUMPTION'],
      agent: `v5-${engine.toLowerCase()}`,
      profileLoaded: !!profile,
    };
  } catch (e) {
    const thinkTime = Date.now() - startTime;
    brain.recordError('thinkV5', e.message);
    logger.error({ component: 'BrainV5', err: e.message, thinkTime }, `🧠 V5 Think failed: ${e.message}`);

    // FALLBACK CHAIN: V5 fails → try V4 → try V3 → error message
    logger.info({ component: 'BrainV5' }, '⚠️ Falling back to V4 (Gemini tool calling)');
    try {
      const { thinkV4 } = require('./brain-v4');
      return await thinkV4(brain, message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
    } catch (e2) {
      logger.info({ component: 'BrainV5' }, '⚠️ V4 failed, falling back to V3');
      try {
        return await brain.think(message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
      } catch (e3) {
        return {
          enrichedMessage:
            language === 'ro'
              ? 'Îmi pare rău, am întâmpinat o problemă tehnică și nu pot răspunde acum. Te rog să încerci din nou. 🔧'
              : "I'm sorry, I encountered a technical issue and can't respond right now. Please try again. 🔧",
          toolsUsed: [],
          monitor: { content: null, type: null },
          analysis: {
            complexity: 'simple',
            language: language || 'ro',
            emotionalTone: 'neutral',
            topics: [],
          },
          chainOfThought: null,
          compressedHistory: history || [],
          failedTools: [],
          thinkTime,
          confidence: 0,
          agent: 'v5-error-fallback',
          error: `V5: ${e.message} | V4: ${e2.message} | V3: ${e3.message}`,
        };
      }
    }
  }
}

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  thinkV5,
  TOOL_DEFINITIONS,
  classifyComplexity,
  stripLeakedTags,
  qualityGate,
};
