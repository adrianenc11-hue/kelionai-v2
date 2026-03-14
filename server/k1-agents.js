"use strict";

/**
 * K1 AGENT MESH — Inteligență de roi
 *
 * Agent Lifecycle: NEED → SPAWN → BRIEF → EXECUTE → EVALUATE → PROMOTE/KILL
 *
 * Patterns:
 * - Debate: 2+ agenți argumentează, Executive decide
 * - Ensemble: 3 agenți răspund independent, se votează
 * - Pipeline: A → B → C (fiecare adaugă)
 * - Adversarial: Generator vs Critic vs Truth
 */

const logger = require("pino")({ name: "k1-agents" });
const k1Cognitive = require("./k1-cognitive");
const { MODELS } = require("./config/models");

// ═══════════════════════════════════════════════════════════════
// AGENT REGISTRY — Agenți activi și template-uri
// ═══════════════════════════════════════════════════════════════

const agents = {}; // Active agents by ID
const templates = {}; // Saved templates for proven agents
let agentIdCounter = 1;

// Default agent templates
const DEFAULT_TEMPLATES = {
  research: {
    role: "Research Agent",
    prompt:
      "Ești un cercetător. Analizezi date, cauți surse, compari evidențe. Răspunde factual cu surse.",
    capabilities: ["search", "compare", "summarize"],
    maxTokens: 1000,
  },
  trading: {
    role: "Trading Analyst",
    prompt:
      "Ești un analist de trading. Evaluezi indicatori tehnici (RSI, MACD, Bollinger, EMA), detectezi pattern-uri, și dai recomandări cu confidence score.",
    capabilities: ["indicators", "patterns", "signals"],
    maxTokens: 800,
  },
  critic: {
    role: "Critic Agent",
    prompt:
      "Ești un critic. Rolul tău e să găsești erori, contradicții, presupuneri nefondate și slăbiciuni în argumentul primit. Fii exigent dar constructiv.",
    capabilities: ["critique", "verify", "challenge"],
    maxTokens: 600,
  },
  truth: {
    role: "Truth Agent",
    prompt:
      "Ești un verificator de adevăr. Verifici fiecare claim contra datelor disponibile. Marchează: ✅ Verificat, ⚠️ Neverificabil, ❌ Fals. Nu acorda nicio trecere.",
    capabilities: ["verify", "fact-check", "evidence"],
    maxTokens: 600,
  },
  executive: {
    role: "Executive Agent",
    prompt:
      "Ești coordonatorul. Primești input-uri de la alți agenți și sintetizezi o concluzie finală. Pondereaza pe baza confidence-ului fiecărui agent.",
    capabilities: ["synthesize", "decide", "coordinate"],
    maxTokens: 800,
  },
};

// ═══════════════════════════════════════════════════════════════
// AGENT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

/**
 * SPAWN — Creează un agent din template sau ad-hoc
 */
function spawn(templateName, briefing = {}) {
  const template = templates[templateName] || DEFAULT_TEMPLATES[templateName];
  if (!template && !briefing.role) {
    return { error: `Template "${templateName}" nu există` };
  }

  const agent = {
    id: agentIdCounter++,
    templateName,
    role: briefing.role || template?.role || "Generic Agent",
    prompt: briefing.prompt || template?.prompt || "",
    capabilities: briefing.capabilities || template?.capabilities || [],
    maxTokens: briefing.maxTokens || template?.maxTokens || 500,
    status: "spawned", // spawned → briefed → executing → done → evaluated
    briefing: briefing.task || null,
    result: null,
    confidence: null,
    score: null, // Evaluation score 0-100
    createdAt: new Date().toISOString(),
    completedAt: null,
    history: [{ action: "spawned", at: new Date().toISOString() }],
  };

  agents[agent.id] = agent;
  k1Cognitive.think(`Agent #${agent.id} (${agent.role}) creat`, {
    phase: "ACT",
  });
  logger.info({ agentId: agent.id, role: agent.role }, "[K1-Agents] Spawned");
  return agent;
}

/**
 * BRIEF — Dă un task agentului
 */
function brief(agentId, task, context = {}) {
  const agent = agents[agentId];
  if (!agent) return { error: "Agent not found" };

  agent.briefing = task;
  agent.context = context;
  agent.status = "briefed";
  agent.history.push({
    action: "briefed",
    task: task.slice(0, 100),
    at: new Date().toISOString(),
  });
  return agent;
}

/**
 * EXECUTE — Agentul primește prompt-ul final pentru LLM
 * Returnează prompt-ul structurat (execuția LLM e externă)
 */
function getExecutionPrompt(agentId) {
  const agent = agents[agentId];
  if (!agent) return null;

  agent.status = "executing";
  agent.history.push({ action: "executing", at: new Date().toISOString() });

  return {
    agentId: agent.id,
    systemPrompt: agent.prompt,
    userPrompt: agent.briefing,
    context: agent.context || {},
    maxTokens: agent.maxTokens,
  };
}

/**
 * COMPLETE — Agentul a terminat, salvează rezultatul
 */
function complete(agentId, result, confidence = 50) {
  const agent = agents[agentId];
  if (!agent) return { error: "Agent not found" };

  agent.result = result;
  agent.confidence = confidence;
  agent.status = "done";
  agent.completedAt = new Date().toISOString();
  agent.history.push({
    action: "completed",
    confidence,
    at: agent.completedAt,
  });

  k1Cognitive.think(
    `Agent #${agentId} (${agent.role}) a terminat — confidence ${confidence}%`,
    { phase: "OBSERVE" },
  );
  return agent;
}

/**
 * EVALUATE — Evaluează rezultatul și decide promote/kill
 */
function evaluate(agentId, score, feedback = "") {
  const agent = agents[agentId];
  if (!agent) return { error: "Agent not found" };

  agent.score = score;
  agent.feedback = feedback;
  agent.status = score >= 70 ? "promoted" : "killed";
  agent.history.push({
    action: agent.status,
    score,
    feedback,
    at: new Date().toISOString(),
  });

  // PROMOTE: salvează ca template de succes
  if (agent.status === "promoted" && agent.templateName) {
    if (!templates[agent.templateName]) {
      templates[agent.templateName] = {
        ...DEFAULT_TEMPLATES[agent.templateName],
      };
    }
    templates[agent.templateName].lastSuccess = new Date().toISOString();
    templates[agent.templateName].avgScore = score;
    k1Cognitive.think(
      `Agent #${agentId} PROMOVAT (scor ${score}) — template salvat`,
      { phase: "LEARN" },
    );
  } else {
    k1Cognitive.think(
      `Agent #${agentId} ELIMINAT (scor ${score}) — lecție: ${feedback}`,
      { phase: "LEARN" },
    );
  }

  // Cleanup after evaluation
  setTimeout(
    () => {
      delete agents[agentId];
    },
    5 * 60 * 1000,
  ); // Keep 5 min for review

  return agent;
}

/**
 * KILL — Oprește un agent forțat
 */
function kill(agentId, reason = "manual") {
  const agent = agents[agentId];
  if (!agent) return { error: "Agent not found" };
  agent.status = "killed";
  agent.history.push({
    action: "killed",
    reason,
    at: new Date().toISOString(),
  });
  delete agents[agentId];
  return { killed: true, agentId, reason };
}

// ═══════════════════════════════════════════════════════════════
// SWARM PATTERNS
// ═══════════════════════════════════════════════════════════════

/**
 * DEBATE — 2 agenți argumentează, Executive sintetizează
 * Returnează prompts-urile pentru execuție externă (Gemini)
 */
function setupDebate(task, _options = {}) {
  const proAgent = spawn("research", { task: `Argumentează PRO: ${task}` });
  const conAgent = spawn("critic", { task: `Argumentează CONTRA: ${task}` });
  const judgeAgent = spawn("executive");

  brief(proAgent.id, `Argumentează PRO pentru: ${task}. Dă evidențe și surse.`);
  brief(
    conAgent.id,
    `Argumentează CONTRA pentru: ${task}. Găsește slăbiciuni și riscuri.`,
  );

  k1Cognitive.think(
    `Debate setup: PRO=#${proAgent.id}, CONTRA=#${conAgent.id}, Judge=#${judgeAgent.id}`,
    { phase: "PLAN" },
  );

  return {
    pattern: "debate",
    proAgent: { id: proAgent.id, prompt: getExecutionPrompt(proAgent.id) },
    conAgent: { id: conAgent.id, prompt: getExecutionPrompt(conAgent.id) },
    judgeAgent: { id: judgeAgent.id },
    task,
    // After getting PRO and CON results, brief the judge:
    // brief(judgeAgent.id, `PRO: ${proResult}\n\nCONTRA: ${conResult}\n\nDecide.`)
  };
}

/**
 * ENSEMBLE — 3 agenți răspund independent, se votează
 */
function setupEnsemble(task, agentTypes = ["research", "trading", "critic"]) {
  const ensembleAgents = agentTypes.map((type) => {
    const a = spawn(type, { task });
    brief(a.id, task);
    return { id: a.id, type, prompt: getExecutionPrompt(a.id) };
  });

  k1Cognitive.think(
    `Ensemble setup: ${ensembleAgents.map((a) => `#${a.id}(${a.type})`).join(", ")}`,
    { phase: "PLAN" },
  );

  return {
    pattern: "ensemble",
    agents: ensembleAgents,
    task,
    // After all respond, vote on the best answer
  };
}

/**
 * ADVERSARIAL — Generator → Critic → Truth
 */
function setupAdversarial(task) {
  const generator = spawn("research", { task });
  const critic = spawn("critic");
  const truth = spawn("truth");

  brief(generator.id, task);

  k1Cognitive.think(
    `Adversarial: Gen=#${generator.id}, Critic=#${critic.id}, Truth=#${truth.id}`,
    { phase: "PLAN" },
  );

  return {
    pattern: "adversarial",
    generator: { id: generator.id, prompt: getExecutionPrompt(generator.id) },
    critic: { id: critic.id }, // Brief with generator result
    truth: { id: truth.id }, // Brief with critic feedback
    task,
  };
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

function getActiveAgents() {
  return Object.values(agents).map((a) => ({
    id: a.id,
    role: a.role,
    status: a.status,
    confidence: a.confidence,
    score: a.score,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
  }));
}

function getAgent(id) {
  return agents[id] || null;
}

function getTemplates() {
  return { ...DEFAULT_TEMPLATES, ...templates };
}

function getStats() {
  const all = Object.values(agents);
  return {
    active: all.filter((a) =>
      ["spawned", "briefed", "executing"].includes(a.status),
    ).length,
    completed: all.filter((a) => a.status === "done").length,
    promoted: all.filter((a) => a.status === "promoted").length,
    killed: all.filter((a) => a.status === "killed").length,
    total: all.length,
    templates: Object.keys({ ...DEFAULT_TEMPLATES, ...templates }).length,
  };
}

// ═══════════════════════════════════════════════════════════════
// REAL LLM EXECUTION — Apelează Gemini API pentru agents
// ═══════════════════════════════════════════════════════════════

/**
 * Apelează Gemini API cu un prompt
 */
async function callGemini(systemPrompt, userPrompt, maxTokens = 600) {
  const key = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("No Gemini API key");

  const model = MODELS.GEMINI_CHAT;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

/**
 * EXECUTE DEBATE — Agenții PRO + CONTRA discută real via Gemini, Executive sintetizează
 */
async function executeDebate(task, options = {}) {
  const debate = setupDebate(task, options);
  const startTime = Date.now();

  k1Cognitive.think(`Executing debate via Gemini: "${task.slice(0, 80)}"`, {
    phase: "ACT",
  });

  // Run PRO and CONTRA in parallel via Gemini
  const [proResult, conResult] = await Promise.allSettled([
    callGemini(
      debate.proAgent.prompt.systemPrompt,
      debate.proAgent.prompt.userPrompt,
      800,
    ),
    callGemini(
      debate.conAgent.prompt.systemPrompt,
      debate.conAgent.prompt.userPrompt,
      800,
    ),
  ]);

  const proText =
    proResult.status === "fulfilled"
      ? proResult.value
      : "Fără argument PRO (eroare API)";
  const conText =
    conResult.status === "fulfilled"
      ? conResult.value
      : "Fără argument CONTRA (eroare API)";

  // Complete PRO and CONTRA agents
  complete(
    debate.proAgent.id,
    proText,
    proResult.status === "fulfilled" ? 75 : 20,
  );
  complete(
    debate.conAgent.id,
    conText,
    conResult.status === "fulfilled" ? 75 : 20,
  );

  // Brief the Judge with both arguments
  brief(
    debate.judgeAgent.id,
    `DEZBATERE pe tema: "${task}"\n\n` +
      `📗 ARGUMENT PRO:\n${proText}\n\n` +
      `📕 ARGUMENT CONTRA:\n${conText}\n\n` +
      `Sintetizează o concluzie finală. Care parte are dreptate și de ce? Dă un verdict clar.`,
  );

  // Judge synthesizes via Gemini
  let verdict;
  try {
    const judgePrompt = getExecutionPrompt(debate.judgeAgent.id);
    verdict = await callGemini(
      judgePrompt.systemPrompt,
      judgePrompt.userPrompt,
      1000,
    );
    complete(debate.judgeAgent.id, verdict, 85);
  } catch (_e) {
    verdict = `Sinteză automată: PRO a argumentat pentru, CONTRA a adus contraargumente. Concluzia necesită evaluare umană.`;
    complete(debate.judgeAgent.id, verdict, 30);
  }

  const elapsed = Date.now() - startTime;
  k1Cognitive.think(
    `Debate finalizat în ${elapsed}ms — Verdict: ${(verdict || "").slice(0, 100)}`,
    { phase: "OBSERVE" },
  );

  logger.info(
    { elapsed, task: task.slice(0, 60) },
    "[K1-Agents] Debate executed via Gemini",
  );

  return {
    pattern: "debate",
    task,
    pro: { agentId: debate.proAgent.id, response: proText },
    contra: { agentId: debate.conAgent.id, response: conText },
    verdict: { agentId: debate.judgeAgent.id, response: verdict },
    elapsed,
    llmPowered: true,
  };
}

/**
 * EXECUTE ENSEMBLE — 3 agenți răspund independent via Gemini, cel mai bun câștigă
 */
async function executeEnsemble(
  task,
  agentTypes = ["research", "trading", "critic"],
) {
  const ensemble = setupEnsemble(task, agentTypes);
  const startTime = Date.now();

  k1Cognitive.think(
    `Executing ensemble (${agentTypes.join(", ")}) via Gemini`,
    { phase: "ACT" },
  );

  // Run all agents in parallel
  const results = await Promise.allSettled(
    ensemble.agents.map((a) =>
      callGemini(a.prompt.systemPrompt, a.prompt.userPrompt, 800),
    ),
  );

  const responses = results.map((r, i) => ({
    agentId: ensemble.agents[i].id,
    type: ensemble.agents[i].type,
    response: r.status === "fulfilled" ? r.value : null,
    success: r.status === "fulfilled" && r.value,
  }));

  // Complete agents
  responses.forEach((r) => {
    complete(r.agentId, r.response || "N/A", r.success ? 70 : 20);
  });

  // Pick best: longest successful response (heuristic for detail)
  const successful = responses.filter((r) => r.success);
  const best =
    successful.sort(
      (a, b) => (b.response?.length || 0) - (a.response?.length || 0),
    )[0] || responses[0];

  const elapsed = Date.now() - startTime;
  k1Cognitive.think(
    `Ensemble finalizat în ${elapsed}ms — Best: ${best?.type}`,
    { phase: "OBSERVE" },
  );

  return {
    pattern: "ensemble",
    task,
    responses,
    best: best,
    consensus: successful.length >= 2,
    elapsed,
    llmPowered: true,
  };
}

module.exports = {
  spawn,
  brief,
  getExecutionPrompt,
  complete,
  evaluate,
  kill,
  setupDebate,
  setupEnsemble,
  setupAdversarial,
  executeDebate,
  executeEnsemble,
  getActiveAgents,
  getAgent,
  getTemplates,
  getStats,
};
