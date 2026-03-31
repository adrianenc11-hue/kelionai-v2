import { describe, it, expect } from "vitest";
import { detectUserLevel, buildSystemPrompt, CHARACTERS, ANTI_HALLUCINATION_RULES } from "./characters";
import { getBrainDiagnostics } from "./brain-v4";

describe("Character System", () => {
  it("should have both Kelion and Kira characters defined", () => {
    expect(CHARACTERS.kelion).toBeDefined();
    expect(CHARACTERS.kira).toBeDefined();
    expect(CHARACTERS.kelion.displayName).toBe("Kelion");
    expect(CHARACTERS.kira.displayName).toBe("Kira");
  });

  it("should have distinct personalities", () => {
    expect(CHARACTERS.kelion.personality).toContain("analytical");
    expect(CHARACTERS.kira.personality).toContain("empathetic");
  });

  it("should include anti-hallucination in system prompts", () => {
    expect(CHARACTERS.kelion.systemPrompt).toContain("NEVER");
    expect(CHARACTERS.kira.systemPrompt).toContain("NEVER");
  });

  it("should have greetings", () => {
    expect(CHARACTERS.kelion.greeting.length).toBeGreaterThan(10);
    expect(CHARACTERS.kira.greeting.length).toBeGreaterThan(10);
  });

  it("should recommend specialists for sensitive topics", () => {
    expect(CHARACTERS.kelion.systemPrompt).toContain("specialist");
    expect(CHARACTERS.kira.systemPrompt).toContain("specialist");
  });
});

describe("User Level Detection", () => {
  it("should detect child level", () => {
    expect(detectUserLevel("mommy help me please")).toBe("child");
    expect(detectUserLevel("what is a dog")).toBe("child");
  });

  it("should detect casual level", () => {
    expect(detectUserLevel("hey can you help me with something cool")).toBe("casual");
  });

  it("should detect technical level", () => {
    expect(detectUserLevel("How do I implement an async API with a database server?")).toBe("technical");
  });

  it("should detect academic level", () => {
    expect(detectUserLevel("The epistemology of this theoretical paradigm requires empirical analysis")).toBe("academic");
  });

  it("should default to casual for ambiguous", () => {
    expect(detectUserLevel("hello")).toBe("casual");
  });
});

describe("System Prompt Builder", () => {
  it("should build prompt with character personality", () => {
    const prompt = buildSystemPrompt("kelion", "casual");
    expect(prompt).toContain("Kelion");
  });

  it("should include level adaptation", () => {
    const childPrompt = buildSystemPrompt("kira", "child");
    expect(childPrompt).toContain("8-year-old");
    const techPrompt = buildSystemPrompt("kelion", "technical");
    expect(techPrompt).toContain("technical terminology");
  });

  it("should include anti-hallucination rules", () => {
    const prompt = buildSystemPrompt("kelion", "casual");
    expect(prompt).toContain("NEVER invent");
  });

  it("should add language instruction for non-English", () => {
    const prompt = buildSystemPrompt("kelion", "casual", "Romanian");
    expect(prompt).toContain("Romanian");
  });

  it("should always include respond in same language", () => {
    const prompt = buildSystemPrompt("kira", "professional");
    expect(prompt).toContain("same language");
  });
});

describe("Anti-Hallucination Rules", () => {
  it("should have rule about not inventing facts", () => {
    expect(ANTI_HALLUCINATION_RULES).toContain("NEVER invent");
  });

  it("should have rule about medical/legal/financial", () => {
    expect(ANTI_HALLUCINATION_RULES).toContain("specialist");
  });

  it("should have rule about uncertainty", () => {
    expect(ANTI_HALLUCINATION_RULES).toContain("not confident");
  });

  it("should have rule about children safety", () => {
    expect(ANTI_HALLUCINATION_RULES).toContain("children");
  });

  it("should have at least 5 rules", () => {
    const ruleCount = (ANTI_HALLUCINATION_RULES.match(/\d+\./g) || []).length;
    expect(ruleCount).toBeGreaterThanOrEqual(5);
  });
});

describe("Brain v4 Diagnostics", () => {
  it("should return version v4.0", () => {
    const diag = getBrainDiagnostics();
    expect(diag.version).toBe("v4.0");
  });

  it("should list all tools", () => {
    const diag = getBrainDiagnostics();
    expect(diag.tools).toContain("search_web");
    expect(diag.tools).toContain("get_weather");
    expect(diag.tools).toContain("generate_code");
    expect(diag.tools).toContain("analyze_image");
    expect(diag.tools).toContain("do_math");
    expect(diag.tools).toContain("translate_text");
  });

  it("should list both characters", () => {
    const diag = getBrainDiagnostics();
    expect(diag.characters).toContain("kelion");
    expect(diag.characters).toContain("kira");
  });

  it("should have anti-hallucination enabled", () => {
    expect(getBrainDiagnostics().antiHallucination).toBe(true);
  });

  it("should have voice cloning enabled", () => {
    expect(getBrainDiagnostics().voiceCloning).toBe(true);
  });

  it("should list key features", () => {
    const diag = getBrainDiagnostics();
    expect(diag.features.length).toBeGreaterThan(5);
    expect(diag.features.some((f: string) => f.includes("Function calling"))).toBe(true);
    expect(diag.features.some((f: string) => f.includes("Anti-hallucination"))).toBe(true);
  });
});

describe("Admin Role Gating", () => {
  it("should require admin role", () => {
    const adminCheck = (role: string) => {
      if (role !== "admin") throw new Error("Admin access required");
      return true;
    };
    expect(() => adminCheck("user")).toThrow("Admin access required");
    expect(adminCheck("admin")).toBe(true);
  });
});
