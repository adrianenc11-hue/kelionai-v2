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

// ═══════════════════════════════════════════════════════════════
// AGENT REGISTRY — Agenți activi și template-uri
// ═══════════════════════════════════════════════════════════════

const agents = {};       // Active agents by ID
const templates = {};    // Saved templates for proven agents
let agentIdCounter = 1;

// Default agent templates
const DEFAULT_TEMPLATES = {
    research: {
        role: "Research Agent",
        prompt: "Ești un cercetător. Analizezi date, cauți surse, compari evidențe. Răspunde factual cu surse.",
        capabilities: ["search", "compare", "summarize"],
        maxTokens: 1000,
    },
    trading: {
        role: "Trading Analyst",
        prompt: "Ești un analist de trading. Evaluezi indicatori tehnici (RSI, MACD, Bollinger, EMA), detectezi pattern-uri, și dai recomandări cu confidence score.",
        capabilities: ["indicators", "patterns", "signals"],
        maxTokens: 800,
    },
    critic: {
        role: "Critic Agent",
        prompt: "Ești un critic. Rolul tău e să găsești erori, contradicții, presupuneri nefondate și slăbiciuni în argumentul primit. Fii exigent dar constructiv.",
        capabilities: ["critique", "verify", "challenge"],
        maxTokens: 600,
    },
    truth: {
        role: "Truth Agent",
        prompt: "Ești un verificator de adevăr. Verifici fiecare claim contra datelor disponibile. Marchează: ✅ Verificat, ⚠️ Neverificabil, ❌ Fals. Nu acorda nicio trecere.",
        capabilities: ["verify", "fact-check", "evidence"],
        maxTokens: 600,
    },
    executive: {
        role: "Executive Agent",
        prompt: "Ești coordonatorul. Primești input-uri de la alți agenți și sintetizezi o concluzie finală. Pondereaza pe baza confidence-ului fiecărui agent.",
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
        status: "spawned",    // spawned → briefed → executing → done → evaluated
        briefing: briefing.task || null,
        result: null,
        confidence: null,
        score: null,          // Evaluation score 0-100
        createdAt: new Date().toISOString(),
        completedAt: null,
        history: [{ action: "spawned", at: new Date().toISOString() }],
    };

    agents[agent.id] = agent;
    k1Cognitive.think(`Agent #${agent.id} (${agent.role}) creat`, { phase: "ACT" });
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
    agent.history.push({ action: "briefed", task: task.slice(0, 100), at: new Date().toISOString() });
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
    agent.history.push({ action: "completed", confidence, at: agent.completedAt });

    k1Cognitive.think(`Agent #${agentId} (${agent.role}) a terminat — confidence ${confidence}%`, { phase: "OBSERVE" });
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
    agent.history.push({ action: agent.status, score, feedback, at: new Date().toISOString() });

    // PROMOTE: salvează ca template de succes
    if (agent.status === "promoted" && agent.templateName) {
        if (!templates[agent.templateName]) {
            templates[agent.templateName] = { ...DEFAULT_TEMPLATES[agent.templateName] };
        }
        templates[agent.templateName].lastSuccess = new Date().toISOString();
        templates[agent.templateName].avgScore = score;
        k1Cognitive.think(`Agent #${agentId} PROMOVAT (scor ${score}) — template salvat`, { phase: "LEARN" });
    } else {
        k1Cognitive.think(`Agent #${agentId} ELIMINAT (scor ${score}) — lecție: ${feedback}`, { phase: "LEARN" });
    }

    // Cleanup after evaluation
    setTimeout(() => { delete agents[agentId]; }, 5 * 60 * 1000); // Keep 5 min for review

    return agent;
}

/**
 * KILL — Oprește un agent forțat
 */
function kill(agentId, reason = "manual") {
    const agent = agents[agentId];
    if (!agent) return { error: "Agent not found" };
    agent.status = "killed";
    agent.history.push({ action: "killed", reason, at: new Date().toISOString() });
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
function setupDebate(task, options = {}) {
    const proAgent = spawn("research", { task: `Argumentează PRO: ${task}` });
    const conAgent = spawn("critic", { task: `Argumentează CONTRA: ${task}` });
    const judgeAgent = spawn("executive");

    brief(proAgent.id, `Argumentează PRO pentru: ${task}. Dă evidențe și surse.`);
    brief(conAgent.id, `Argumentează CONTRA pentru: ${task}. Găsește slăbiciuni și riscuri.`);

    k1Cognitive.think(`Debate setup: PRO=#${proAgent.id}, CONTRA=#${conAgent.id}, Judge=#${judgeAgent.id}`, { phase: "PLAN" });

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
    const ensembleAgents = agentTypes.map(type => {
        const a = spawn(type, { task });
        brief(a.id, task);
        return { id: a.id, type, prompt: getExecutionPrompt(a.id) };
    });

    k1Cognitive.think(`Ensemble setup: ${ensembleAgents.map(a => `#${a.id}(${a.type})`).join(", ")}`, { phase: "PLAN" });

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

    k1Cognitive.think(`Adversarial: Gen=#${generator.id}, Critic=#${critic.id}, Truth=#${truth.id}`, { phase: "PLAN" });

    return {
        pattern: "adversarial",
        generator: { id: generator.id, prompt: getExecutionPrompt(generator.id) },
        critic: { id: critic.id },    // Brief with generator result
        truth: { id: truth.id },      // Brief with critic feedback
        task,
    };
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

function getActiveAgents() {
    return Object.values(agents).map(a => ({
        id: a.id, role: a.role, status: a.status,
        confidence: a.confidence, score: a.score,
        createdAt: a.createdAt, completedAt: a.completedAt,
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
        active: all.filter(a => ["spawned", "briefed", "executing"].includes(a.status)).length,
        completed: all.filter(a => a.status === "done").length,
        promoted: all.filter(a => a.status === "promoted").length,
        killed: all.filter(a => a.status === "killed").length,
        total: all.length,
        templates: Object.keys({ ...DEFAULT_TEMPLATES, ...templates }).length,
    };
}

module.exports = {
    spawn, brief, getExecutionPrompt, complete, evaluate, kill,
    setupDebate, setupEnsemble, setupAdversarial,
    getActiveAgents, getAgent, getTemplates, getStats,
};
