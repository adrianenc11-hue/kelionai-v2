'use strict';

// POST /api/chat - primary text chat route via OpenRouter (Claude Opus 4.7).
// Supports escalation to heavy models for coding/complex tasks.
// Uses in-memory session history + real tool execution (search, weather, wiki).

const { Router } = require('express');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const { executeRealTool } = require('../services/realTools');
const ipGeo = require('../services/ipGeo');
const { buildKelionToolsChatCompletions, buildKelionToolsChatCompletionsForMessage } = require('./realtime');
const { recordCost, checkBudget, isFastAllowed } = require('../services/aiCostGuard');

const router = Router();

// In-memory conversation history per session (simple, resets on server restart)
const sessions = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 30 * 60 * 1000; // 30 min
const CHAT_AI_TIMEOUT_MS = Number(process.env.CHAT_AI_TIMEOUT_MS) || 25_000;

// Cleanup old sessions every 5 min
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) {
    if (s.lastUsed < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = 'CHAT_AI_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

router.post('/', async (req, res) => {
  const t0 = Date.now();
  let currentStep = 'init';
  const step = (n) => {
    currentStep = String(n).split(' ')[0];
    console.log(`[chat] step=${n} t=${Date.now() - t0}ms`);
  };
  let adminUser = null;
  let isAdmin = false;
  try {
    step('start');
    const { hasAiProvider } = require('../services/modelRouter');
    if (!hasAiProvider()) {
      return res.status(503).json({
        code: 'AI_PROVIDER_NOT_CONFIGURED',
        error: 'AI provider is not configured. Set OPENROUTER_API_KEY in Railway.',
      });
    }

    // Auth / trial gating (same logic as realtime)
    adminUser = await peekSignedInUser(req);
    isAdmin = await isAdminUser(adminUser);
    const isGuest = !adminUser;
    step(`auth user=${adminUser?.id || 'guest'} admin=${isAdmin}`);

    if (isGuest && !isAdmin) {
      const guestIp = ipGeo.clientIp(req) || req.ip || '';
      const trial = await trialStatus(guestIp);
      if (!trial.allowed) {
        return res.status(401).json({
          error: trial.reason === 'lifetime_expired'
            ? 'Free trial expired. Create an account to continue.'
            : 'Daily free trial used up. Come back tomorrow or sign in.',
        });
      }
      await stampTrialIfFresh(guestIp, trial);
    }

    const { message, sessionId, toolResponses, image, lat, lon, clientTimezone, clientLocalTime, fastMode } = req.body || {};
    if (!message && !toolResponses) {
      return res.status(400).json({ error: 'message or toolResponses is required' });
    }

    // Session history
    const sid = sessionId || 'default';
    if (!sessions.has(sid)) {
      sessions.set(sid, { history: [], lastUsed: Date.now() });
    }
    const session = sessions.get(sid);
    session.lastUsed = Date.now();

    // Add user message or function responses to history
    if (toolResponses) {
      session.history.push({
        role: 'function',
        parts: toolResponses.map(tr => ({
          functionResponse: {
            name: tr.name,
            response: { result: tr.response },
            id: tr.id
          }
        }))
      });
    } else if (message) {
      const parts = [{ text: message.trim() }];
      if (image) {
        // image should be base64 string
        parts.push({
          inlineData: { mimeType: 'image/jpeg', data: image.replace(/^data:image\/\w+;base64,/, '') }
        });
      }
      session.history.push({ role: 'user', parts });
    }

    if (session.history.length > MAX_HISTORY * 2) {
      session.history = session.history.slice(-MAX_HISTORY * 2);
    }

    // Smart Model Router — unified stable routing
    const { smartFetch, runTandem, isCodingTask, isComplexTask } = require('../services/modelRouter');
    const swarmExpert = require('../services/swarmExpert');


    // ── Demand-driven tool activation ─────────────────────────────────
    // Select only tools relevant to the user's message (cuts token cost
    // 60-90%) and force tool-calling when the intent is clearly action-based.
    const { tools: openRouterTools, categories: toolCategories } = buildKelionToolsChatCompletionsForMessage(message);
    const hasActionIntent = toolCategories && toolCategories.length > 0 && toolCategories.some(c => c !== 'CORE');

    // ── Persona & Identity ────────────────────────────────────────────
    // Build the unified Kelion persona (same as voice) for text chat.
    // This ensures identity consistency and follows the "Extra Credits" rule.
    const { buildKelionPersona, resolveLockedLangTag } = require('./realtime');
    const { listMemoryItems, getCreditsBalance, addCreditsTransaction } = require('../db');
    
    let memoryItems = [];
    let creditsBalance = null;
    if (adminUser && adminUser.id) {
      try {
        [memoryItems, creditsBalance] = await Promise.all([
          listMemoryItems(adminUser.id, 60),
          getCreditsBalance(adminUser.id)
        ]);
      } catch (err) { console.warn('[chat] memory/credits fetch failed:', err && err.message); }
    }
    step(`db mem=${memoryItems.length} bal=${creditsBalance}`);

    // ── Task Detection: Basic Chat vs Complex Coding ──────────────────
    // Two independent signals trigger the premium model:
    //   - isCodingTask: explicit software/code request
    //   - isComplexTask: audit/analysis/planning/strategy/long prompt
    const codingTask = isCodingTask(message);
    const complexTask = isComplexTask(message);
    const taskType = codingTask ? 'coder' : 'chat';
    // Premium brain (e.g. Opus 4.7 Fast) is gated by credit balance to protect margin.
    // Revenue is ~£0.25/credit (Standard/Pro pack), gross margin 25% = £0.0625/credit.
    // One premium query costs ~£0.07 (≈3K in + 600 out tokens at Claude 4 rates), so
    // the >=10 threshold guarantees every premium user has at least £2.50 of realised
    // margin before the heavy model is unlocked (covers ~35 queries with positive PnL).
    // Admin always qualifies; free users and low-balance users get the light model.
    const PREMIUM_CREDITS_THRESHOLD = Number(process.env.PREMIUM_CREDITS_THRESHOLD) || 10;
    const canUsePremium = isAdmin || (Number(creditsBalance) >= PREMIUM_CREDITS_THRESHOLD);
    // ── Cost Guard ───────────────────────────────────────────────────────────
    const budget = checkBudget();
    // Adrian 2026-05-18: "revenire dupa incarcare credit la varianta maxima"
    // If the global server budget is blocked, we normally force the light model.
    // However, if the user has purchased credits (balance > 0), they bypass the global
    // block and get the premium model they paid for.
    const hasPaidCredits = !isAdmin && Number(creditsBalance) > 0;
    const isGlobalBlocked = budget.blocked && !hasPaidCredits;
    
    if (isGlobalBlocked && (codingTask || complexTask)) {
      console.warn(`[chat] Daily AI budget HARD CAP reached ($${budget.dailyCost.toFixed(2)}). Forcing light model.`);
    }

    let isHeavy = (codingTask || complexTask) && canUsePremium && !isGlobalBlocked;
    // Adrian: "Să lucreze cu agenți la orice task mai complex".
    // Lowering threshold to 150 chars and adding more keywords.
    const isSoftGreu = false; // Disabled to force frontend tool execution for live progress

    // ── Text-chat credit consumption ─────────────────────────────────
    const TEXT_HEAVY_COST = Number(process.env.TEXT_HEAVY_COST_MINUTES) || 3;
    let creditsConsumed = 0;
    let balanceRemaining = creditsBalance;
    let creditsWarning = null;
    if (isHeavy && adminUser?.id && !isAdmin) {
      if (Number(creditsBalance) < TEXT_HEAVY_COST) {
        console.log(`[chat] User ${adminUser.id} has ${creditsBalance} credits, needs ${TEXT_HEAVY_COST} for heavy. Falling back to light.`);
        isHeavy = false;
        creditsWarning = 'insufficient';
      }
    }

    // ── Tandem Mode (dual-brain) ───────────────────────────────────────────────────────
    // When TANDEM_ENABLED=1, heavy tasks run Opus 4.7 + Kimi K2.6 in parallel.
    // Primary (Opus) is returned; secondary (Kimi) is logged for comparison.
    const TANDEM_ENABLED = process.env.TANDEM_ENABLED === '1';
    const useTandem = TANDEM_ENABLED && isHeavy;

    const browserLang = (req.query.lang || 'en-US').toString().slice(0, 16);
    const forcedLang = (process.env.KELION_FORCE_LANG || browserLang).toString().slice(0, 16);
    let ipGeoData = null;
    try { ipGeoData = await ipGeo.lookup(ipGeo.clientIp(req)); }
    catch (err) { console.warn('[chat] ipGeo lookup failed:', err && err.message); }
    step('ipgeo');
    
    const systemPrompt = buildKelionPersona({
      user: adminUser,
      creditsBalance,
      memoryItems,
      geo: ipGeoData,
      lockedLangTag: await resolveLockedLangTag({ req, user: adminUser, forcedLang }),
      clientTz: clientTimezone,
      clientLocalTime: clientLocalTime
    });

    // Convert history to OpenAI format
    const sanitizedMessages = [
      { role: 'system', content: systemPrompt }
    ];
    
    session.history.forEach(h => {
      if (h.role === 'function') {
        // OpenAI expects each tool response as a separate message
        h.parts.forEach(p => {
          sanitizedMessages.push({
            role: 'tool',
            tool_call_id: p.functionResponse.id,
            name: p.functionResponse.name,
            content: JSON.stringify(p.functionResponse.response.result)
          });
        });
      } else {
        let text = '';
        let tool_calls = undefined;
        let hasImage = false;
        let contentArr = [];
        
        h.parts.forEach(p => { 
          if (p.text) {
            text += p.text; 
            contentArr.push({ type: 'text', text: p.text });
          }
          if (p.inlineData) {
            hasImage = true;
            contentArr.push({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
          }
          if (p.functionCall) {
            if (!tool_calls) tool_calls = [];
            tool_calls.push({
              id: p.functionCall.id,
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: typeof p.functionCall.args === 'string' ? p.functionCall.args : JSON.stringify(p.functionCall.args)
              }
            });
          }
        });

        const msg = { role: h.role };
        
        if (hasImage) {
          msg.content = contentArr;
        } else {
          msg.content = text;
        }

        if (tool_calls) {
          msg.tool_calls = tool_calls;
          if (!msg.content) msg.content = ""; // Required by OpenAI if tool_calls are present
        }

        sanitizedMessages.push(msg);
      }
    });



    const body = {
      messages: sanitizedMessages,
      tools: openRouterTools.length > 0 ? openRouterTools : undefined,
      // Force the model to use a tool when the user clearly asked for an
      // action (map, weather, search, calculation, etc.). Otherwise let
      // the model decide (greetings, simple chat).
      tool_choice: openRouterTools.length > 0
        ? (hasActionIntent ? 'required' : 'auto')
        : undefined,
      temperature: 0.7,
      max_tokens: 4096,
    };

    let result;
    let activeModel = 'Swarm (Multi-Agent)';
    step(`pre-model task=${taskType} heavy=${isHeavy} msgs=${sanitizedMessages.length} tools=${openRouterTools.length}`);

    try {
      if (isSoftGreu) {
        console.log('[chat] Triggering Swarm Expert for Soft Greu task...');
        const swarmResult = await swarmExpert.runSwarmTask(message, { history: session.history.slice(-5) }, creditsBalance, openRouterTools);
        result = {
          choices: [{
            message: {
              content: swarmResult.reply,
              tool_calls: swarmResult.toolCalls
            }
          }]
        };
      } else {
        const fetchRes = await withTimeout(
          useTandem
            ? runTandem(taskType, body)
            : smartFetch(taskType, body, isHeavy, Boolean(fastMode) && isFastAllowed()),
          CHAT_AI_TIMEOUT_MS,
          'chat model request'
        );
        activeModel = fetchRes.model;
        step(`smartFetch ok model=${activeModel}`);
        result = await fetchRes.response.json();
        step('json parsed');
        if (result?.usage) {
          const { cost, dailyCost, remaining } = recordCost(activeModel, result.usage);
          console.log(`[chat] cost=$${cost.toFixed(4)} daily=$${dailyCost.toFixed(2)} remaining=$${remaining.toFixed(2)} model=${activeModel}`);
        }
      }

      // Charge credits for heavy text-chat usage (non-admin, signed-in users)
      if (isHeavy && adminUser?.id && !isAdmin && TEXT_HEAVY_COST > 0) {
        try {
          const tx = await addCreditsTransaction({
            userId: adminUser.id,
            deltaMinutes: -TEXT_HEAVY_COST,
            kind: 'consume',
            note: `Text heavy: ${activeModel}`,
            idempotencyKey: `txt-heavy-${sessionId}-${Date.now()}`,
          });
          creditsConsumed = TEXT_HEAVY_COST;
          balanceRemaining = tx.balance;
          console.log(`[chat] Charged ${TEXT_HEAVY_COST} credits for heavy text. Balance=${tx.balance}`);
        } catch (err) {
          console.warn('[chat] Credit charge failed:', err.message);
        }
      }

      const choice = result?.choices?.[0];

      if (choice?.message?.tool_calls) {
        console.log(`[chat] Returning ${choice.message.tool_calls.length} tools to client for execution...`);
        
        // Save the assistant's tool calls to session history so the next request is valid.
        const parts = [];
        if (choice.message.content) {
          parts.push({ text: choice.message.content });
        }
        choice.message.tool_calls.forEach(tc => {
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function?.name || 'unknown',
              args: tc.function?.arguments || '{}'
            }
          });
        });
        session.history.push({ role: 'assistant', parts });

        return res.json({
          reply: '',
          toolCalls: choice.message.tool_calls.map(tc => {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore — model emitted bad JSON */ }
            return { id: tc.id, name: tc.function?.name || 'unknown', args };
          }),
          model: activeModel,
          creditsConsumed,
          balanceRemaining,
          creditsWarning,
        });
      }

      // Standard text reply
      const reply = choice?.message?.content || '';
      if (reply) {
        session.history.push({ role: 'assistant', parts: [{ text: reply }] });
      }
      // Surface upstream provider error so we don't return a silent empty reply.
      if (!reply && result && result.error) {
        const detail = typeof result.error === 'string' ? result.error : (result.error.message || JSON.stringify(result.error));
        console.error('[chat] upstream returned error payload:', detail);
        return res.status(502).json({
          error: 'AI is temporarily unavailable. Please try again.',
          ...(isAdmin ? { detail, model: activeModel, step: currentStep } : {})
        });
      }
      // ── Reflection Loop (Faza 5) ─────────────────────────────────────────────────────────────────
      // After every heavy task, save a 1-2 sentence summary to memory as "lessons learned".
      if (isHeavy && reply && reply.length > 200 && adminUser?.id) {
        try {
          const sentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];
          const reflection = sentences.slice(0, 2).join(' ').trim();
          if (reflection.length > 20 && reflection.length < 500) {
            const { addMemoryItems } = require('../db');
            await addMemoryItems(adminUser.id, [{ content: reflection, kind: 'reflection', source: 'self' }]);
            console.log(`[chat] Reflection saved for user=${adminUser.id}: ${reflection.substring(0, 80)}...`);
          }
        } catch (err) {
          console.warn('[chat] Reflection save failed:', err.message);
        }
      }

      return res.json({ reply, model: activeModel });
    } catch (err) {
      console.error(`[chat] AI generation failed at step=${currentStep}:`, err && err.stack || err && err.message || err);
      if (err && err.code === 'CHAT_AI_TIMEOUT') {
        return res.status(504).json({
          code: 'CHAT_AI_TIMEOUT',
          error: 'AI request timed out before the public edge limit. Please try again.',
          ...(isAdmin ? { detail: String(err.message || err), step: currentStep } : {})
        });
      }
      if (err && err.code === 'OPENROUTER_INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          code: 'OPENROUTER_INSUFFICIENT_CREDITS',
          error: 'AI/OpenRouter nu are credit. Adauga credit in OpenRouter, apoi testeaza din nou Kelion.',
          ...(isAdmin ? { detail: String(err.message || err), model: err.model, step: currentStep } : {})
        });
      }
      return res.status(502).json({
        code: 'AI_UPSTREAM_FAILED',
        error: 'AI is temporarily unavailable. Please try again.',
        ...(isAdmin ? { detail: String(err && err.message || err), step: currentStep } : {})
      });
    }
  } catch (error) {
    console.error(`[chat] Error at step=${currentStep}:`, error && error.stack || error && error.message || error);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Internal server error during chat',
      ...(isAdmin ? { detail: String(error && error.message || error), step: currentStep } : {})
    });
  }
});

module.exports = router;
