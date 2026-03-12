"use strict";

const { buildNewbornPrompt, buildSystemPrompt, TRUTH_ENGINE } = require("../server/persona");

describe("buildNewbornPrompt", () => {
  test("returns empty string when no memory", () => {
    const prompt = buildNewbornPrompt("");
    expect(prompt).toBe("");
  });

  test("returns empty string when memory is null", () => {
    const prompt = buildNewbornPrompt(null);
    expect(prompt).toBe("");
  });

  test("returns empty string when memory is undefined", () => {
    const prompt = buildNewbornPrompt(undefined);
    expect(prompt).toBe("");
  });

  test("returns memory when provided", () => {
    const memory = "User likes coding. User speaks Romanian.";
    const prompt = buildNewbornPrompt(memory);
    expect(prompt).toBe(memory);
  });

  test("does NOT contain TRUTH_ENGINE", () => {
    const prompt = buildNewbornPrompt("some memory");
    expect(prompt).not.toContain("NENEGOCIABIL");
    expect(prompt).not.toContain("EXCLUDEREA MINCIUNII");
    expect(prompt).not.toContain("MOTORUL ADEVĂRULUI");
  });

  test("does NOT contain persona rules", () => {
    const prompt = buildNewbornPrompt("some memory");
    expect(prompt).not.toContain("KELION");
    expect(prompt).not.toContain("KIRA");
    expect(prompt).not.toContain("CATCHPHRASES");
    expect(prompt).not.toContain("EMOTION:");
  });

  test("does NOT contain hardcoded instructions", () => {
    const prompt = buildNewbornPrompt("");
    expect(prompt).not.toContain("PERCEIVE");
    expect(prompt).not.toContain("REMEMBER");
    expect(prompt).not.toContain("LEARN");
    expect(prompt).not.toContain("RESPOND");
  });

  test("normal buildSystemPrompt still works unchanged", () => {
    const prompt = buildSystemPrompt("kelion", "ro", "", null, false);
    expect(prompt).toContain("NENEGOCIABIL");
    expect(prompt.toUpperCase()).toContain("KELION");
  });
});

describe("k1-cognitive resetAll", () => {
  const cognitive = require("../server/k1-cognitive");

  test("resetAll clears performance history", () => {
    // Record some data first
    cognitive.recordFeedback("trading", true);
    cognitive.recordFeedback("trading", false);
    cognitive.think("test thought", { phase: "REFLECT" });

    // Reset
    cognitive.resetAll();

    const meta = cognitive.getMetaCognition();
    // After reset, all domains should have 0 tasks (except the reset think itself adds 1 monologue)
    for (const domain of meta.domains) {
      expect(domain.totalTasks).toBe(0);
    }
  });

  test("resetAll clears monologue (except the reset message itself)", () => {
    cognitive.think("thought 1");
    cognitive.think("thought 2");
    cognitive.think("thought 3");
    cognitive.resetAll();
    // After reset, only the reset message itself should be in monologue
    const monologue = cognitive.getMonologue();
    expect(monologue.length).toBe(1);
    expect(monologue[0].thought).toContain("newborn mode");
  });
});

describe("k1-meta-learning resetAll", () => {
  const metaLearning = require("../server/k1-meta-learning");

  test("resetAll resets user model interactions to 0", () => {
    metaLearning.recordUserInteraction({ domain: "trading" });
    metaLearning.recordUserInteraction({ domain: "coding" });
    metaLearning.resetAll();

    const model = metaLearning.getUserModel();
    expect(model.totalInteractions).toBe(0);
    expect(model.totalCorrections).toBe(0);
  });

  test("resetAll resets strategies", () => {
    metaLearning.resetAll();
    const strategies = metaLearning.getStrategies();
    for (const tmpl of strategies.promptTemplates) {
      expect(tmpl.uses).toBe(0);
    }
  });
});

describe("k1-memory clearHot", () => {
  const k1Memory = require("../server/k1-memory");

  test("clearHot empties hot memory", () => {
    k1Memory.addToHot({ content: "fact 1", type: "fact" });
    k1Memory.addToHot({ content: "fact 2", type: "fact" });
    expect(k1Memory.getHot().length).toBeGreaterThan(0);

    k1Memory.clearHot();
    expect(k1Memory.getHot().length).toBe(0);
  });

  test("stats show 0 after clearHot", () => {
    k1Memory.clearHot();
    const stats = k1Memory.getStats();
    expect(stats.hotCount).toBe(0);
  });
});
